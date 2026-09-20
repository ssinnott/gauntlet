// Headless simulation: creates characters of every class, walks them through the town and the
// dungeon with a simple bot for thousands of turns, exercises every store, and checks invariants.
// No DOM: this proves the game logic stands on its own, and it catches crashes long before a
// browser would. Usage: node tools/sim.ts [seeds] [turns]
import { createGame, enterLevel, score } from '../src/game/game.ts';
import { moveDir, goDown, goUp, pickupHere, quaff, read, eat, wield, dropItem, rest, restStep, cast, study, spellsAvailable, newSpellCount, fire, throwItem, aim, useStaff, zap, searchAround, travelTo, travelStep, run, runStep, openChest } from '../src/game/commands.ts';
import { maintainStore, storeBuy, storeSell, buyPrice, storeWants } from '../src/game/stores.ts';
import { kindOf, itemName, inscriptionTags, inscriptionConfirms, makeItem, makeAware } from '../src/game/items.ts';
import { isIgnored, itemQuality, toggleIgnoreKind } from '../src/game/ignore.ts';
import { needsDir, needsItem } from '../src/game/effects.ts';
import { serialize, deserialize } from '../src/game/save.ts';
import { isConnected } from '../src/game/gen/dungeon.ts';
import { generateLevel } from '../src/game/gen/level.ts';
import { generateCavern } from '../src/game/gen/cavern.ts';
import { generateLabyrinth } from '../src/game/gen/labyrinth.ts';
import { tileAt, monsterAt, passable, createLevel } from '../src/game/level.ts';
import { T, isPassable } from '../src/game/types.ts';
import { CLASSES } from '../src/game/data/classes.ts';
import { RACES } from '../src/game/data/races.ts';
import { MONSTERS, MONSTER_BY_ID } from '../src/game/data/monsters.ts';
import { OBJECTS } from '../src/game/data/objects.ts';
import { rng } from '../src/lib/engine/rng.ts';
import type { Options } from '../src/game/options.ts';
import { type Game, FX_QUEUE_MAX, SOUND_QUEUE_MAX } from '../src/game/state.ts';
import type { Item } from '../src/game/types.ts';
import { characterDump } from '../src/game/dump.ts';
import { describeRace } from '../src/game/recall.ts';
import { bashDoor, jamDoor, disarm, passTurn } from '../src/game/commands.ts';
import { autoplayStep } from '../src/game/autoplay.ts';
import { createMonster } from '../src/game/monster.ts';

const SEEDS = Number(process.argv[2] || 6);
const TURNS = Number(process.argv[3] || 3000);
let failures = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

/** Where two serialized games first differ, with a little context. For diagnosing a failure. */
function firstDifference(a: string, b: string): string {
  if (a === b) return 'identical';
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return `differ at ${i} of ${a.length}/${b.length}: ...${a.slice(from, i + 40)} | ...${b.slice(from, i + 40)}`;
}

function check(g: Game, where: string): void {
  const p = g.player, lv = g.level;
  ok(p.chp <= p.mhp, `${where}: chp ${p.chp} > mhp ${p.mhp}`);
  ok(p.x >= 0 && p.y >= 0 && p.x < lv.w && p.y < lv.h, `${where}: player off map`);
  ok(isPassable(tileAt(lv, p.x, p.y)), `${where}: player standing in tile ${tileAt(lv, p.x, p.y)}`);
  const seen = new Set<number>();
  for (const m of lv.monsters) { const k = m.y * lv.w + m.x; ok(!seen.has(k), `${where}: two monsters at ${m.x},${m.y}`); seen.add(k); ok(!(m.x === p.x && m.y === p.y), `${where}: monster on player: ${m.race}#${m.id} (next ${g.nextMonsterId}, energy ${m.energy}, depth ${g.level.depth}, turn ${g.turn}, ptimed ${JSON.stringify(Object.fromEntries(Object.entries(p.timed).filter(e => e[1])))}) at ${m.x},${m.y}; last: ${g.msg.list.slice(-4).map(x => x.text).join(" | ")}`); ok(m.hp > 0, `${where}: dead monster still on level`); }
  ok(p.inven.length <= 23, `${where}: inventory overflow`);
  for (const it of p.inven) ok(it.number > 0, `${where}: empty stack in pack`);
}

/**
 * A crude bot: fight what is adjacent, otherwise wander toward unexplored space, use stairs, use items.
 * Even seeds play a "diver" that is healed whenever it drops low, so deep monsters, spells, breath,
 * generators, vaults and artifacts all get exercised; odd seeds play honestly and mostly die early.
 */
function botTurn(g: Game, step: number, diver: boolean): void {
  const p = g.player, lv = g.level;
  if (p.dead) return;
  if (diver && step % 200 === 199 && lv.depth > 0 && !g.levelChange) { g.levelChange = { depth: Math.min(100, lv.depth + 5), by: 'teleport' }; return; }
  if (diver) { p.timed.invuln = 5; if (p.chp < p.mhp) { p.chp = p.mhp; } p.food = 12000; for (const t of Object.keys(p.timed) as (keyof typeof p.timed)[]) if (['blind', 'paralyzed', 'confused', 'poisoned', 'cut', 'stun', 'afraid', 'slow'].includes(t)) p.timed[t] = 0; }
  if (g.inStore >= 0) { shopAround(g); g.inStore = -1; return; }
  if (g.levelChange) { enterLevel(g, g.levelChange.depth, g.levelChange.by); return; }
  if (g.resting) { restStep(g); return; }
  if (g.travel) { travelStep(g); return; }
  if (g.running) { runStep(g); return; }
  // In town: head for the dungeon entrance, ignore the townsfolk.
  if (lv.depth === 0 && !g.travel && g.inStore < 0) {
    const t = tileAt(lv, p.x, p.y);
    if (t === T.STAIRS_DOWN) { goDown(g); return; }
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (tileAt(lv, x, y) === T.STAIRS_DOWN) { if (!travelTo(g, x, y)) moveDir(g, rng.int(1, 9)); return; }
  }
  // Divers: every so often, walk to a known down staircase (the whole level is revealed for them).
  if (diver && lv.depth > 0 && step % 60 === 0 && !g.travel) {
    for (let i = 0; i < lv.flags.length; i++) lv.flags[i] |= 1;
    let best: { x: number; y: number } | null = null, bd = 1e9;
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (tileAt(lv, x, y) === T.STAIRS_DOWN) { const d = Math.abs(x - p.x) + Math.abs(y - p.y); if (d < bd) { bd = d; best = { x, y }; } }
    if (best && travelTo(g, best.x, best.y)) return;
  }
  // Use things.
  if (step % 17 === 0 && p.inven.length) {
    const it = p.inven[rng.int(0, p.inven.length - 1)];
    const k = kindOf(it);
    const eff = k.effect;
    const dir = rng.int(1, 9);
    if (k.tval === 'potion') quaff(g, it);
    else if (k.tval === 'scroll' && eff && !needsItem(eff)) read(g, it, { dir });
    else if (k.tval === 'scroll' && eff && needsItem(eff)) { const tgt = p.equip.weapon || p.inven[0]; read(g, it, { dir, chosen: tgt }); }
    else if (k.tval === 'food') eat(g, it);
    else if (k.tval === 'wand') aim(g, it, dir);
    else if (k.tval === 'staff') useStaff(g, it, { chosen: p.inven[0] });
    else if (k.tval === 'rod') zap(g, it, dir, null, { chosen: p.inven[0] });
    else if (k.tval === 'flask') throwItem(g, it, dir);
    else if (['sword', 'hafted', 'polearm', 'bow', 'soft_armor', 'hard_armor', 'shield', 'helm', 'cloak', 'gloves', 'boots', 'ring', 'amulet', 'light'].includes(k.tval)) wield(g, it);
    else if (step % 51 === 0) dropItem(g, it, 1);
    return;
  }
  if (step % 23 === 0 && p.quiver.length && p.equip.bow) { fire(g, p.quiver[0], rng.int(1, 9)); return; }
  if (step % 29 === 0 && newSpellCount(g) > 0) { study(g); return; }
  if (step % 13 === 0) { const sp = spellsAvailable(g).filter(s => p.learned.includes(s.id)); if (sp.length) { cast(g, sp[rng.int(0, sp.length - 1)], { dir: rng.int(1, 9), chosen: p.inven[0] }); return; } }
  if (step % 41 === 0 && p.chp < p.mhp / 2) { rest(g, -1); return; }
  if (step % 37 === 0) { searchAround(g); return; }
  if (step % 43 === 0) { const d = rng.int(1, 9); if (d !== 5) { if (rng.chance(0.5)) bashDoor(g, d); else if (rng.chance(0.5)) jamDoor(g, d); else disarm(g, d); } else passTurn(g); return; }
  // Stairs.
  const t = tileAt(lv, p.x, p.y);
  if (t === T.STAIRS_DOWN && (diver || rng.chance(0.7))) { goDown(g); return; }
  if (t === T.STAIRS_UP && rng.chance(0.2)) { goUp(g); return; }
  // Chest?
  const chest = lv.items.find(fi => fi.x === p.x && fi.y === p.y && kindOf(fi.item).tval === 'chest');
  if (chest) { openChest(g, chest); return; }
  // Attack an adjacent monster, else wander (prefer a direction that is passable).
  if (lv.depth > 0) for (let d = 1; d <= 9; d++) { if (d === 5) continue; const m = monsterAt(lv, p.x + [0, -1, 0, 1, -1, 0, 1, -1, 0, 1][d], p.y + [0, 1, 1, 1, 0, 0, 0, -1, -1, -1][d]); if (m && m.visible) { moveDir(g, d); return; } }
  if (step % 7 === 0) {
    // Travel toward a random known stair or a random spot.
    const x = rng.int(1, lv.w - 2), y = rng.int(1, lv.h - 2);
    if (travelTo(g, x, y)) return;
  }
  if (step % 5 === 0) { run(g, rng.int(1, 9)); return; }
  let dir = rng.int(1, 9); if (dir === 5) dir = 1;
  moveDir(g, dir);
  if (step % 3 === 0) pickupHere(g, true);
}

function shopAround(g: Game): void {
  const s = g.stores[g.inStore];
  maintainStore(g, s);
  ok(s.type === 7 || s.stock.length >= 8, `store ${s.type} understocked (${s.stock.length})`);
  // Buy something affordable, sell something the store wants.
  const affordable = s.stock.filter(it => buyPrice(g, s, it) <= g.player.gold);
  if (affordable.length) {
    const it = affordable[rng.int(0, affordable.length - 1)];
    const before = g.player.gold;
    const bought = storeBuy(g, s, it, 1);
    ok(!!bought, `buy failed in store ${s.type}`);
    if (bought && s.type !== 7) ok(g.player.gold < before, 'gold did not decrease on purchase');
    if (bought) { bought.id = 1e6 + rng.int(0, 1e6); if (g.player.inven.length < 23) g.player.inven.push(bought); }
  }
  const sellable = g.player.inven.filter(it => storeWants(s, it));
  if (sellable.length) { const it = sellable[0]; const before = g.player.gold; g.player.inven.splice(g.player.inven.indexOf(it), 1); const paid = storeSell(g, s, it, it.number); ok(s.type === 7 || paid >= 0, 'negative sale price'); ok(g.player.gold === before + paid, 'gold mismatch on sale'); }
}

console.log(`data: ${MONSTERS.length} monsters, ${OBJECTS.length} objects, ${RACES.length} races, ${CLASSES.length} classes`);

// Command inscriptions parse as Angband's do: `@q1` tags a command letter, `!k` / `!*` ask first.
{
  const it = { inscription: '@q1@q2@r3!k' } as unknown as Item;
  ok(inscriptionTags(it, 'q').join('') === '12' && inscriptionTags(it, 'r').join('') === '3' && inscriptionTags(it, 'f').length === 0, 'inscription @ tags');
  ok(inscriptionConfirms(it, 'k') && !inscriptionConfirms(it, 'q'), 'inscription ! confirmations');
  ok(inscriptionConfirms({ inscription: 'my sword !*' } as unknown as Item, 'd') && !inscriptionConfirms({} as Item, 'd'), 'inscription !* confirms everything');
}

// 1. Level generation at many depths: connected and populated.
let genOk = 0, genTotal = 0;
const kinds: Record<string, number> = {};
const dummy = createGame('Gen', 'human', 'warrior', 'male', 12345);
for (const depth of [1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 75, 99]) {
  for (let i = 0; i < 3; i++) {
    genTotal++;
    const r = generateLevel(depth, {
      placeMonster: () => {}, placeThemedMonster: () => {}, placeGenerator: () => {}, placeObject: () => {}, placeGold: () => {},
    }, 'down');
    kinds[r.level.kind || 'classic'] = (kinds[r.level.kind || 'classic'] || 0) + 1;
    if (isConnected(r.level) && passable(r.level, r.start.x, r.start.y)) genOk++;
  }
}
console.log(`generation: ${genOk}/${genTotal} levels connected (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')})`);
ok(genOk >= genTotal * 0.9, 'too many disconnected levels');

// 1b. The alternative level types, built directly so they are covered every run rather than
// whenever the dice feel like it. Both guarantee connectivity by construction, so the bar is 100%.
{
  const noHooks = { placeMonster: () => {}, placeThemedMonster: () => {}, placeGenerator: () => {}, placeObject: () => {}, placeGold: () => {} };
  let cOk = 0, cTot = 0, lOk = 0, lTot = 0;
  for (const depth of [8, 20, 45, 80]) {
    for (let i = 0; i < 4; i++) {
      cTot++;
      const c = generateCavern(depth, noHooks, 'down');
      if (c && isConnected(c.level) && passable(c.level, c.start.x, c.start.y)) cOk++;
      lTot++;
      const l = generateLabyrinth(depth, noHooks, 'down');
      if (l && isConnected(l.level) && passable(l.level, l.start.x, l.start.y)) lOk++;
    }
  }
  console.log(`  caverns ${cOk}/${cTot} connected, labyrinths ${lOk}/${lTot} connected`);
  ok(cOk === cTot, `cavern generation: only ${cOk}/${cTot} usable`);
  ok(lOk === lTot, `labyrinth generation: only ${lOk}/${lTot} usable`);
}
void dummy;

// 2. Determinism. The README promises that every roll goes through the seeded rng, so a seed
// reproduces a run. Nothing checked that until now, and it is the foundation any future lockstep
// multiplayer would stand on, so the bar here is byte-for-byte identical saves, not "close enough".
//
// The script has to get INTO the dungeon and stay alive, or the assertion is nearly empty: a bot
// that wanders the town exercises town generation and nothing else, and would happily pass while
// level generation, generators, randarts, monster learning and the persistent-level catch-up were
// all quietly non-deterministic.
{
  const STEPS = 2400, SPLIT = 1100;
  const SETS: [string, Partial<Options>][] = [
    ['default options', {}],
    ['randarts, persistent levels, smart monsters', { randarts: true, persistentLevels: true, smartMonsters: true }],
  ];
  // Fixed cadences, never the clock and never an unseeded roll. The dive and the climb are chosen
  // so neither lands on SPLIT-1, which would leave a level change pending across the save.
  const scripted = (g: Game, i: number): void => {
    if (g.player.dead) return;
    if (g.levelChange) { enterLevel(g, g.levelChange.depth, g.levelChange.by); return; }
    if (g.inStore >= 0) { g.inStore = -1; return; }
    // Keep it alive, fed and mobile: a corpse exercises nothing, and the run has to get deep. This
    // is what the diver in botTurn below does, and it is deterministic -- no roll is involved.
    g.player.timed.invuln = 5;
    g.player.chp = g.player.mhp;
    g.player.food = 8000;
    for (const k of ['blind', 'paralyzed', 'confused', 'poisoned', 'cut', 'stun', 'afraid', 'slow'] as const) g.player.timed[k] = 0;
    if (i % 151 === 7) { g.levelChange = { depth: Math.min(90, g.level.depth + 3), by: 'teleport' }; return; }
    // Climb back to a level already visited, so persistent levels really do get caught up.
    if (i % 311 === 43 && g.level.depth > 4) { g.levelChange = { depth: g.level.depth - 2, by: 'up' }; return; }
    if (g.resting) { restStep(g); return; }
    const t = tileAt(g.level, g.player.x, g.player.y);
    if (t === T.STAIRS_DOWN && i % 37 === 0) { goDown(g); return; }
    if (i % 23 === 0) { searchAround(g); return; }
    if (i % 13 === 0) { rest(g, 2); return; }
    if (i % 7 === 0) { pickupHere(g, true); return; }
    let d = rng.int(1, 9);
    if (d === 5) d = 1;
    moveDir(g, d);
  };
  const play = (steps: number, options: Partial<Options>): Game => {
    const g = createGame('Det', 'dwarf', 'warrior', 'male', 90210, { options });
    for (let i = 0; i < steps; i++) scripted(g, i);
    return g;
  };

  for (const [label, options] of SETS) {
    const first = play(STEPS, options);
    const firstJson = serialize(first);
    const second = serialize(play(STEPS, options));
    ok(firstJson === second, `${label}: the same seed did not reproduce the same run (${firstDifference(firstJson, second)})`);

    // And a save/restore must not perturb what comes next: save.ts stores the rng state for exactly
    // this reason, so continuing through a round trip has to match continuing without one.
    const live = play(SPLIT, options);
    const json = serialize(live);
    for (let i = SPLIT; i < STEPS; i++) scripted(live, i);
    const direct = serialize(live);
    const restored = deserialize(json);
    for (let i = SPLIT; i < STEPS; i++) scripted(restored, i);
    const viaSave = serialize(restored);
    ok(direct === viaSave, `${label}: saving and restoring perturbed the run (${firstDifference(direct, viaSave)})`);

    // The run has to have gone somewhere, or the two assertions above prove very little.
    const reached = first.player.maxDepth, levels = first.stats.levelsVisited;
    const learned = Object.keys(first.monsterKnows).length, kept = Object.keys(first.savedLevels).length;
    ok(reached >= 20 && levels >= 8, `${label}: the scripted run only reached depth ${reached} over ${levels} levels, so it guards little`);
    console.log(`determinism (${label}): depth ${reached}, ${levels} levels, ${kept} kept, ${learned} races learnt, byte for byte across a save at ${SPLIT}`);
  }
}

// 2b. The persistent-level catch-up, on its own. The scripted run above revisits levels, but the
// arrivals step inside catchUpLevel is easily masked: generator spawns and breeders run first and
// can take up all the headroom, after which the arrival loop never executes. A focused check with a
// long, fixed absence exercises it directly.
{
  // Depth matters here. A deep level is already near the population ceiling, so the generator and
  // breeder steps use up all the headroom and the arrival loop never executes at all; a shallow
  // level has room, so every step of the catch-up is really exercised.
  const runCatchUp = (depth: number): string => {
    const g = createGame('Catch', 'dwarf', 'warrior', 'male', 24680, { options: { persistentLevels: true } });
    enterLevel(g, depth, 'down');
    for (const away of [300, 7000, 40000, 120000]) {
      enterLevel(g, 0, 'up');
      g.turn += away;
      enterLevel(g, depth, 'down');
    }
    return serialize(g);
  };
  for (const depth of [1, 3, 20]) {
    const a = runCatchUp(depth), b = runCatchUp(depth);
    ok(a === b, `depth ${depth}: the persistent-level catch-up is not reproducible from the seed (${firstDifference(a, b)})`);
    // The level the catch-up hands back has to be a legal one: nothing stacked, nothing standing
    // inside a shut door or a wall it cannot pass, nothing on the hero, and no generator left
    // claiming a tier its hit points do not support.
    const g = deserialize(a);
    const lv = g.level;
    const grid = new Set<number>();
    let stacked = 0, inDoor = 0, inWall = 0, onPlayer = 0, wrongTier = 0;
    for (const m of lv.monsters) {
      const k = m.y * lv.w + m.x;
      if (grid.has(k)) stacked++;
      grid.add(k);
      if (m.x === g.player.x && m.y === g.player.y) onPlayer++;
      const t = tileAt(lv, m.x, m.y);
      const r = MONSTER_BY_ID[m.race];
      const ghost = r.flags.includes('PASS_WALL') || r.flags.includes('KILL_WALL');
      if (t === T.DOOR_CLOSED || t === T.SECRET_DOOR) { if (!ghost) inDoor++; }
      else if (!isPassable(t) && !ghost) inWall++;
      if (r.flags.includes('GENERATOR')) {
        const f = m.maxhp > 0 ? m.hp / m.maxhp : 1;
        const want = f > 2 / 3 ? 3 : f > 1 / 3 ? 2 : 1;
        if (m.tier !== undefined && m.tier !== want) wrongTier++;
      }
    }
    ok(stacked === 0, `depth ${depth}: ${stacked} monsters share a grid after the catch-up`);
    ok(inDoor === 0, `depth ${depth}: ${inDoor} monsters are standing inside a shut door after the catch-up`);
    ok(inWall === 0, `depth ${depth}: ${inWall} monsters are inside a wall they cannot pass after the catch-up`);
    ok(onPlayer === 0, `depth ${depth}: ${onPlayer} monsters are on the hero's arrival grid`);
    ok(wrongTier === 0, `depth ${depth}: ${wrongTier} generators claim a tier their hit points do not support`);
    console.log(`catch-up at depth ${depth}: four absences up to 120000 turns reproduce byte for byte (${lv.monsters.length} monsters, all on legal ground)`);
  }
}

// 2c. Ignore settings. Auto-pickup is on by default, so a mistake here does not litter the floor --
// it throws away your armour. Every case below was a real bug: grading a base kind's built-in
// to-hit penalty as damage condemned heavy armour, ignoring an item by kind hid the ego version of
// it, and an item whose whole worth is an ability (a Ring of Speed has no plusses at all) graded
// 'average' and went straight past.
{
  const g = createGame('Ign', 'human', 'warrior', 'male', 31337);
  const make = (kind: string, tweak: (it: Item) => void = () => {}): Item => { const it = makeItem(kind, 1); tweak(it); return it; };
  const known = (it: Item): Item => { it.known = true; return it; };

  for (const gp of Object.keys(g.ignore.quality) as (keyof typeof g.ignore.quality)[]) g.ignore.quality[gp] = 'all';
  const artifact = known(make('short_sword', it => { it.artifact = 'sting'; }));
  ok(!isIgnored(g, artifact), 'an artifact was ignored');
  ok(!isIgnored(g, make('long_sword')), 'an unidentified weapon was ignored, though nothing is known about it');

  // Heavy armour carries a built-in to-hit penalty; that is the base kind, not damage.
  g.ignore.quality.body = 'worthless';
  const heavy = known(make('hard_leather_armor'));
  ok(itemQuality(heavy) !== 'worthless', `plain armour with a built-in to-hit penalty graded ${itemQuality(heavy)}`);
  ok(!isIgnored(g, heavy), 'armour with a built-in to-hit penalty was ignored at the mildest setting');
  const damaged = known(make('hard_leather_armor', it => { it.toAc = -4; it.cursed = true; }));
  ok(isIgnored(g, damaged), 'genuinely damaged armour was not ignored');

  // An item whose worth is an ability, not a number.
  g.ignore.quality.ring = 'good';
  const speed = known(make('ring_speed', it => { it.pval = 5; }));
  ok(itemQuality(speed) === 'excellent', `a known Ring of Speed graded ${itemQuality(speed)}`);
  ok(!isIgnored(g, speed), 'a known Ring of Speed was ignored at "leave all but the excellent"');

  // Ignoring a kind must not hide the ego version of that kind.
  g.ignore.quality.weapon = 'none';
  toggleIgnoreKind(g, 'long_sword');
  makeAware(g.flavors, 'long_sword');
  ok(isIgnored(g, known(make('long_sword'))), 'a plain example of an ignored kind was not ignored');
  ok(!isIgnored(g, known(make('long_sword', it => { it.ego = 'slay_evil'; }))), 'an ego item was hidden by ignoring its base kind');
  ok(!isIgnored(g, make('long_sword')), 'an unidentified example of an ignored kind was ignored');
  console.log('ignore: artifacts, unknowns, ability items and ego items all survive the strictest settings');
}

// 2d. Nothing may grow without bound. The queues the UI drains are not drained headless -- which is
// what a lockstep replay would also be -- so each needs a cap, and only the sound queue had one.
{
  const g = createGame('Grow', 'human', 'warrior', 'male', 4242);
  enterLevel(g, 3, 'down');
  for (let i = 0; i < 5000; i++) { g.player.chp = g.player.mhp; g.player.food = 8000; passTurn(g); }
  ok(g.fx.length <= FX_QUEUE_MAX, `the effect queue grew to ${g.fx.length} over 5000 headless turns`);
  ok(g.sounds.length <= SOUND_QUEUE_MAX, `the sound queue grew to ${g.sounds.length} over 5000 headless turns`);
  ok(g.msg.list.length <= 300, `the message log grew to ${g.msg.list.length}`);
  console.log(`growth: after 5000 parked turns, fx ${g.fx.length}, sounds ${g.sounds.length}, messages ${g.msg.list.length}`);
}

// 3. Monster senses. The play loop below never catches a monster that fails to close, because its
// bot moves every turn and so keeps re-triggering the approach. A hero who STANDS STILL is the case
// that matters, and it is how a pack that circles forever hides: review found exactly that, with
// wolves holding station at six paces round a resting hero and never landing a blow.
{
  const noErratic = (r: typeof MONSTERS[number]): boolean => !r.flags.includes('RAND_25') && !r.flags.includes('RAND_50') && !r.flags.includes('NEVER_MOVE') && r.blows.length > 0;
  const room = (g: Game, w: number, h: number, floorTo: number): void => {
    const lv = createLevel(w, h, 8);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x <= floorTo; x++) { lv.tiles[y * w + x] = T.FLOOR; lv.flags[y * w + x] |= 1 | 2; }
    g.level = lv;
    g.flow = null; g.noise = null; g.scent = null; g.scentStamp = 0; g.flowDirty = true;
    g.player.chp = g.player.mhp = 9999;
  };
  // A pack must close on a motionless hero.
  const packs = MONSTERS.filter(r => r.flags.includes('FRIENDS') && noErratic(r) && r.depth <= 12).slice(0, 3);
  for (const race of packs) {
    const g = createGame('Pack', 'human', 'warrior', 'male', 606);
    room(g, 41, 41, 39);
    g.player.x = 20; g.player.y = 20;
    for (let i = 0; i < 5; i++) createMonster(g, race.id, 28 + (i % 2), 16 + i * 2, false, g.level);
    for (const m of g.level.monsters) m.sleep = 0;
    let adjacent = false;
    for (let t = 0; t < 300 && !adjacent; t++) {
      passTurn(g);
      adjacent = g.level.monsters.some(m => Math.max(Math.abs(m.x - g.player.x), Math.abs(m.y - g.player.y)) <= 1);
    }
    ok(adjacent, `a pack of ${race.id} never reached a standing hero in 300 turns`);
  }
  // And a wall-passer stranded in rock must still come through it: no field reaches such a grid.
  const ghost = MONSTERS.find(r => r.flags.includes('PASS_WALL') && noErratic(r));
  if (ghost) {
    const g = createGame('Rock', 'human', 'warrior', 'male', 707);
    room(g, 61, 41, 20);
    g.player.x = 15; g.player.y = 20;
    const m = createMonster(g, ghost.id, 5, 20, false, g.level);
    if (m) {
      m.x = 34; m.y = 20; m.sleep = 0;
      let reached = false;
      for (let t = 0; t < 300 && !reached; t++) {
        passTurn(g);
        reached = Math.max(Math.abs(m.x - g.player.x), Math.abs(m.y - g.player.y)) <= 1;
      }
      ok(reached, `a ${ghost.id} stranded in rock never reached the hero in 300 turns`);
    }
  }
  console.log(`senses: ${packs.length} pack races close on a standing hero; a wall-passer comes through rock`);
}

// 4. Play.
let deaths = 0, maxDepth = 0, totalKills = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const cls = CLASSES[(seed - 1) % CLASSES.length], race = RACES[(seed * 3) % RACES.length];
  let g: Game;
  const opts = seed % 3 === 0 ? { ironman: true, smartMonsters: true } : seed % 3 === 1 ? { noSelling: true, persistentLevels: true, connectedStairs: false } : { randarts: true };
  try { g = createGame('Sim' + seed, race.id, cls.id, seed % 2 ? 'male' : 'female', seed * 7919, { options: opts }); }
  catch (e) { failures++; console.log(`  FAIL: createGame seed ${seed}: ${(e as Error).stack}`); continue; }
  let step = 0;
  try {
    for (step = 0; step < TURNS && !g.player.dead; step++) {
      botTurn(g, step, seed % 2 === 0);
      if (step % 25 === 0) check(g, `seed ${seed} step ${step}`);
      if (step === Math.floor(TURNS / 2)) {
        // Round-trip through the save format mid-run.
        const json = serialize(g);
        const g2 = deserialize(json);
        ok(g2.player.name === g.player.name && g2.level.depth === g.level.depth && g2.player.gold === g.player.gold, `seed ${seed}: save round trip mismatch`);
        ok(g2.level.monsters.length === g.level.monsters.length, `seed ${seed}: save lost monsters`);
        g = g2;
      }
    }
  } catch (e) {
    failures++;
    console.log(`  FAIL: seed ${seed} (${cls.id}) crashed at step ${step} depth ${g.level.depth}: ${(e as Error).stack}`);
    continue;
  }
  // The text systems must never throw.
  try { const d = characterDump(g); ok(d.length > 200, `seed ${seed}: dump too short`); for (const r of MONSTERS.slice(0, 40)) describeRace(g, r); for (const r of MONSTERS.slice(-40)) describeRace(g, r, true); }
  catch (e) { failures++; console.log(`  FAIL: seed ${seed} dump/recall: ${(e as Error).stack}`); }
  if (g.player.dead) deaths++;
  maxDepth = Math.max(maxDepth, g.player.maxDepth);
  totalKills += g.player.kills;
  console.log(`  seed ${seed}${seed % 2 === 0 ? ' (diver)' : ''}: ${race.name} ${cls.name} lv ${g.player.lev}, depth ${g.level.depth} (max ${g.player.maxDepth}), ${g.player.kills} kills, ${g.player.gold} gold, ${g.player.inven.length} items, ${g.player.dead ? 'died: ' + g.player.deathCause : 'alive'}, score ${score(g)}`);
}
console.log(`play: ${SEEDS} runs, ${deaths} deaths, deepest ${maxDepth}, ${totalKills} kills`);
ok(totalKills > 0, 'nobody killed anything');
ok(maxDepth > 0, 'nobody entered the dungeon');
// 3. Autoplay: the bot the `=` menu (and ctrl+A) turns on, playing honestly with no cheats.
{
  let botDeaths = 0, botDepth = 0, botKills = 0, botGold = 0;
  const runs = Math.max(2, Math.min(SEEDS, 4));
  // Every third seed: the same four heroes each run, spread wider than the first four.
  for (let run = 1; run <= runs; run++) {
    const seed = run * 3;
    const cls = CLASSES[(seed * 5) % CLASSES.length], race = RACES[(seed * 2) % RACES.length];
    let g: Game;
    try { g = createGame('Bot' + seed, race.id, cls.id, seed % 2 ? 'female' : 'male', seed * 104729); }
    catch (e) { failures++; console.log(`  FAIL: autoplay createGame seed ${seed}: ${(e as Error).stack}`); continue; }
    let step = 0, idle = 0, worstIdle = 0;
    try {
      for (step = 0; step < TURNS && !g.player.dead; step++) {
        const turn = g.turn, x = g.player.x, y = g.player.y, depth = g.level.depth;
        autoplayStep(g, step);
        if (g.levelChange) enterLevel(g, g.levelChange.depth, g.levelChange.by);
        // A bot that neither moves nor spends a turn is bumping a wall; a few in a row is a probe,
        // dozens is a hero stuck for good (fear that never fades, a corner it cannot leave).
        idle = g.turn === turn && g.player.x === x && g.player.y === y && g.level.depth === depth ? idle + 1 : 0;
        worstIdle = Math.max(worstIdle, idle);
        if (step % 25 === 0) check(g, `autoplay seed ${seed} step ${step}`);
      }
      ok(worstIdle < 20, `autoplay seed ${seed}: the bot spent ${worstIdle} steps in a row on one grid without a turn passing; last: ${g.msg.list.slice(-4).map(m => m.text).join(' | ')}`);
    } catch (e) {
      failures++;
      console.log(`  FAIL: autoplay seed ${seed} (${cls.id}) crashed at step ${step} depth ${g.level.depth}: ${(e as Error).stack}`);
      continue;
    }
    if (g.player.dead) botDeaths++;
    botDepth = Math.max(botDepth, g.player.maxDepth);
    botKills += g.player.kills;
    botGold += g.player.gold;
    console.log(`  bot ${seed}: ${race.name} ${cls.name} lv ${g.player.lev}, depth ${g.level.depth} (max ${g.player.maxDepth}), ${g.player.kills} kills, ${g.player.gold} gold, ${g.player.dead ? 'died: ' + g.player.deathCause : 'alive'}`);
  }
  console.log(`autoplay: ${runs} runs, ${botDeaths} deaths, deepest ${botDepth}, ${botKills} kills, ${botGold} gold in hand`);
  ok(botDepth > 0, 'autoplay never found the way into the dungeon');
  ok(botKills > 0, 'autoplay never killed anything');
}

const unused = itemName;
void unused;
console.log(failures ? `\nSIM FAILED (${failures})` : '\nSIM OK');
process.exit(failures ? 1 : 0);
