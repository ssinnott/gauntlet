// Headless simulation: creates characters of every class, walks them through the town and the
// dungeon with a simple bot for thousands of turns, exercises every store, and checks invariants.
// No DOM: this proves the game logic stands on its own, and it catches crashes long before a
// browser would. Usage: node tools/sim.ts [seeds] [turns]
import { createGame, enterLevel, score } from '../src/game/game.ts';
import { moveDir, goDown, goUp, pickupHere, quaff, read, eat, wield, dropItem, rest, restStep, cast, study, spellsAvailable, newSpellCount, fire, throwItem, aim, useStaff, zap, searchAround, travelTo, travelStep, run, runStep, openChest } from '../src/game/commands.ts';
import { maintainStore, storeBuy, storeSell, buyPrice, storeWants } from '../src/game/stores.ts';
import { kindOf, itemName } from '../src/game/items.ts';
import { needsDir, needsItem } from '../src/game/effects.ts';
import { serialize, deserialize } from '../src/game/save.ts';
import { generateDungeon, isConnected } from '../src/game/gen/dungeon.ts';
import { tileAt, monsterAt, passable } from '../src/game/level.ts';
import { T, isPassable } from '../src/game/types.ts';
import { CLASSES } from '../src/game/data/classes.ts';
import { RACES } from '../src/game/data/races.ts';
import { MONSTERS } from '../src/game/data/monsters.ts';
import { OBJECTS } from '../src/game/data/objects.ts';
import { rng } from '../src/lib/engine/rng.ts';
import type { Game } from '../src/game/state.ts';

const SEEDS = Number(process.argv[2] || 6);
const TURNS = Number(process.argv[3] || 3000);
let failures = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

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
  if (diver && step % 200 === 199 && lv.depth > 0 && !g.levelChange) { g.levelChange = { depth: Math.min(60, lv.depth + 3), by: 'teleport' }; return; }
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

// 1. Level generation at many depths: connected and populated.
let genOk = 0, genTotal = 0;
const dummy = createGame('Gen', 'human', 'warrior', 'male', 12345);
for (const depth of [1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 75, 99]) {
  for (let i = 0; i < 3; i++) {
    genTotal++;
    const r = generateDungeon(depth, {
      placeMonster: () => {}, placeThemedMonster: () => {}, placeGenerator: () => {}, placeObject: () => {}, placeGold: () => {},
    }, 'down');
    if (isConnected(r.level) && passable(r.level, r.start.x, r.start.y)) genOk++;
  }
}
console.log(`generation: ${genOk}/${genTotal} levels connected`);
ok(genOk >= genTotal * 0.9, 'too many disconnected levels');
void dummy;

// 2. Play.
let deaths = 0, maxDepth = 0, totalKills = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const cls = CLASSES[(seed - 1) % CLASSES.length], race = RACES[(seed * 3) % RACES.length];
  let g: Game;
  try { g = createGame('Sim' + seed, race.id, cls.id, seed % 2 ? 'male' : 'female', seed * 7919); }
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
  if (g.player.dead) deaths++;
  maxDepth = Math.max(maxDepth, g.player.maxDepth);
  totalKills += g.player.kills;
  console.log(`  seed ${seed}${seed % 2 === 0 ? ' (diver)' : ''}: ${race.name} ${cls.name} lv ${g.player.lev}, depth ${g.level.depth} (max ${g.player.maxDepth}), ${g.player.kills} kills, ${g.player.gold} gold, ${g.player.inven.length} items, ${g.player.dead ? 'died: ' + g.player.deathCause : 'alive'}, score ${score(g)}`);
}
console.log(`play: ${SEEDS} runs, ${deaths} deaths, deepest ${maxDepth}, ${totalKills} kills`);
ok(totalKills > 0, 'nobody killed anything');
ok(maxDepth > 0, 'nobody entered the dungeon');
const unused = itemName;
void unused;
console.log(failures ? `\nSIM FAILED (${failures})` : '\nSIM OK');
process.exit(failures ? 1 : 0);
