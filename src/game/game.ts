// The game: creation, level changes, and the turn loop that runs the world between the player's
// actions. Player commands live in commands.ts.
import { rng, freshSeed } from '../lib/engine/rng.ts';
import { type Player, type Level, type Item, type Pos, T, F, SLOTS } from './types.ts';
import type { Game } from './state.ts';
import { MessageLog } from './messages.ts';
import { createPlayer, computeBonuses, recomputeHp, recomputeMana, adj, makeHistory } from './player.ts';
import { assignFlavors, makeItem, makeAware, kindOf, itemFlags, senseItem, makeGold, makeObject, itemName, wieldSlot, isWeapon, isArmor, isWearable, getNextItemId, setNextItemId, setArtifactsMade, artifactsMadeList } from './items.ts';
import { createStores, maintainStore } from './stores.ts';
import { generateDungeon, type GenHooks } from './gen/dungeon.ts';
import { generateTown } from './gen/town.ts';
import { placeMonster, placeGenerator, themedFilter, monsterTurn, energyGain, monsterSpeed, updateMonsterVisibility, ensureFlow, raceOf, hasMFlag, createMonster, pickRace, nearFloor, removeMonster } from './monster.ts';
import { updateView, tileAt, setTile, addFlag, hasFlag, isCleanFloor } from './level.ts';
import { setTimed, refreshBonuses, teleportPlayer } from './effectsCore.ts';
import { takeHit } from './combat.ts';
import { dropNear, disturb } from './world.ts';
import { randint0, randint1, oneIn } from './util.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { RACE_BY_ID } from './data/races.ts';
import { MONSTER_BY_ID, MONSTERS } from './data/monsters.ts';
import { FOOD_MAX, FOOD_FULL, FOOD_HUNGRY, FOOD_WEAK, FOOD_FAINT, FOOD_STARVE, MAX_DEPTH, TOWN_DAWN } from '../constants.ts';
import { type Options, normalizeOptions } from './options.ts';
import type { LoreBook } from './lore.ts';
import { earthquakeAt } from './effects.ts';
import type { Stat } from './types.ts';

export interface BirthExtra {
  options?: Partial<Options>;
  /** Stats chosen at birth (point-buy or an accepted roll); rolled if absent. */
  stats?: Record<Stat, number>;
  history?: string;
  /** Monster memory carried over from earlier heroes. */
  lore?: LoreBook;
}

export function createGame(name: string, race: string, cls: string, sex: 'male' | 'female', seed = freshSeed(), extra: BirthExtra = {}): Game {
  rng.seed(seed);
  setNextItemId(1);
  setArtifactsMade([]);
  const player = createPlayer(name || 'Hero', race, cls, sex, extra.stats);
  player.history = extra.history || makeHistory(race, sex);
  const g: Game = {
    seed, turn: 1, player, bonuses: computeBonuses(player), level: null as unknown as Level, stores: createStores(), flavors: assignFlavors(), msg: new MessageLog(),
    nextMonsterId: 1, uniquesDead: [], flow: null, flowDirty: true, fx: [], levelChange: null, inStore: -1, totalWinner: false, repeating: null, running: null, travel: null, resting: 0,
    stats: { levelsVisited: 0, monstersKilled: 0, itemsFound: 0, goldFound: 0 }, arrivedBy: 'none',
    options: normalizeOptions(extra.options), lore: extra.lore ? JSON.parse(JSON.stringify(extra.lore)) : {}, artifactsSeen: [], egosKnown: [], savedLevels: {},
    hooks: {
      placeGoldAt: (x, y) => { dropNear(g, makeGold(g.level.depth, g.options.noSelling), x, y); },
      placeObjectAt: (x, y, level) => { const it = makeObject(level ?? g.level.depth, false, false); if (it) dropNear(g, it, x, y); },
      cloneMonster: (m) => { const pos = nearFloor(g.level, m.x, m.y, 2); if (pos) createMonster(g, m.race, pos.x, pos.y, false); },
      polymorphMonster: (m) => { const r = pickRace(g, g.level.depth + randint0(5), rr => !hasMFlag(rr, 'UNIQUE') && !hasMFlag(rr, 'GENERATOR')); if (!r) return; removeMonster(g, m); createMonster(g, r.id, m.x, m.y, false); },
      earthquake: (x, y) => earthquakeAt(g, x, y, 8),
    },
  };
  // Birth kit: known and wielded where sensible.
  const c = CLASS_BY_ID[cls];
  for (const [kid, n] of c.startItems) {
    const it = makeItem(kid, n);
    it.known = true; makeAware(g.flavors, kid);
    const k = kindOf(it);
    const slot = wieldSlot(k);
    if (slot && !player.equip[slot] && (isWeapon(k) || isArmor(k) || k.tval === 'bow' || k.tval === 'light')) player.equip[slot] = it;
    else if (k.tval === 'shot' || k.tval === 'arrow' || k.tval === 'bolt') player.quiver.push(it);
    else player.inven.push(it);
  }
  if (!player.equip.light) { const t = player.inven.find(i => i.kind === 'torch'); if (t) { t.number--; const one = makeItem('torch', 1); one.known = true; player.equip.light = one; if (t.number <= 0) player.inven.splice(player.inven.indexOf(t), 1); } }
  refreshBonuses(g);
  player.chp = player.mhp; player.csp = player.msp;
  g.msg.add(`Welcome, ${player.name} the ${RACE_BY_ID[race].name} ${c.name}. The town lies before you.`, '#ffd040');
  g.msg.shout(`${c.hero.toUpperCase()} ENTERS THE TOWN`, '#ffd040');
  enterLevel(g, 0, 'none');
  return g;
}

function genHooks(g: Game): GenHooks {
  return {
    placeMonster: (lv, depth, x, y, sleep, group) => { placeMonster(g, lv, depth, x, y, sleep, group); },
    placeThemedMonster: (lv, depth, x, y, theme) => { placeMonster(g, lv, depth + 3, x, y, true, false, themedFilter(theme)); },
    placeGenerator: (lv, depth, x, y) => placeGenerator(g, lv, depth, x, y),
    placeObject: (lv, depth, x, y, good, great) => { const it = makeObject(depth, good, great); if (it) lv.items.push({ x, y, item: it }); },
    placeGold: (lv, depth, x, y) => { lv.items.push({ x, y, item: makeGold(depth, g.options.noSelling) }); },
  };
}

/** Generate and enter a level. */
/** Is it daytime in the town? Angband: 10,000 game turns of day, then 10,000 of night. */
export function isDaytime(turn: number): boolean { return (turn % (2 * TOWN_DAWN)) < TOWN_DAWN; }

/** Can the player go below this depth? Sauron guards level 99 and Morgoth waits on 100. */
export function deepestAllowed(g: Game): number {
  if (!MONSTER_BY_ID['sauron'] || !MONSTER_BY_ID['morgoth']) return MAX_DEPTH;
  if (!g.uniquesDead.includes('sauron')) return 99;
  return MAX_DEPTH;
}

export function enterLevel(g: Game, depth: number, by: 'down' | 'up' | 'none' | 'teleport' | 'recall'): void {
  const p = g.player;
  depth = Math.max(0, Math.min(deepestAllowed(g), depth));
  const arrivedBy = g.options.connectedStairs ? (by === 'down' ? 'down' : by === 'up' ? 'up' : 'none') : 'none';
  // Persistent levels: stash the one we are leaving and restore the one we return to.
  if (g.options.persistentLevels && g.level && g.level.depth > 0) g.savedLevels[g.level.depth] = g.level;
  // The level is generated with the game rng, so the seed reproduces the run; the player's
  // position is set before monsters are placed so nothing spawns on top of them.
  let level: Level, start: Pos;
  const saved = g.options.persistentLevels ? g.savedLevels[depth] : undefined;
  if (saved && depth > 0) {
    level = saved;
    const want = arrivedBy === 'down' ? T.STAIRS_UP : arrivedBy === 'up' ? T.STAIRS_DOWN : -1;
    const cands: Pos[] = [];
    for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) if ((want < 0 ? isCleanFloor(level, x, y) : tileAt(level, x, y) === want) && !level.monsters.some(m => m.x === x && m.y === y)) cands.push({ x, y });
    start = cands.length ? cands[randint0(cands.length)] : { x: 1, y: 1 };
    // Monsters heal and wander a little while you were away.
    for (const m of level.monsters) { m.hp = Math.min(m.maxhp, m.hp + Math.floor(m.maxhp / 4)); m.energy = randint0(50); }
  } else if (depth === 0) {
    const day = isDaytime(g.turn);
    const r = generateTown({ placeTownMonster: (lv, x, y) => { const race = pickRace(g, 0); if (race) createMonster(g, race.id, x, y, true, lv); } }, arrivedBy === 'up' ? 'up' : 'none', day);
    level = r.level; start = r.start;
    level.daytime = day;
  } else {
    const r = generateDungeon(depth, genHooks(g), arrivedBy);
    level = r.level; start = r.start;
    // The quest monsters guard the bottom of the dungeon.
    if (depth === 99 && MONSTER_BY_ID['sauron'] && !g.uniquesDead.includes('sauron')) placeQuestor(g, level, 'sauron', start);
    if (depth === 100 && MONSTER_BY_ID['morgoth'] && !g.uniquesDead.includes('morgoth')) placeQuestor(g, level, 'morgoth', start);
  }
  g.level = level;
  g.levelChange = null;
  g.inStore = -1;
  g.flow = null; g.flowDirty = true;
  g.fx.length = 0;
  g.msg.banner = null;
  disturb(g);
  p.x = start.x; p.y = start.y; p.vx = undefined; p.vy = undefined;
  p.depth = depth;
  if (depth > p.maxDepth) p.maxDepth = depth;
  // Nothing may share the player's grid.
  for (const m of level.monsters.slice()) if (m.x === p.x && m.y === p.y) removeMonster(g, m);
  g.stats.levelsVisited++;
  refreshBonuses(g);
  updateView(level, p.x, p.y, g.bonuses.lightRadius, p.timed.blind > 0);
  updateMonsterVisibility(g);
  if (depth > 0) {
    if (!saved) level.feeling = levelFeeling(g);
    g.msg.add(feelingText(level.feeling), '#c0c0ff');
    if (depth > 0 && by === 'down') g.msg.add(`You enter a maze of down staircases. (${depth * 50} ft)`, '#a0a0a0');
    if (depth === 99 && level.monsters.some(m => m.race === 'sauron')) g.msg.shout('SAURON, THE SORCERER, AWAITS', '#ff4040');
    if (depth === 100 && level.monsters.some(m => m.race === 'morgoth')) g.msg.shout('MORGOTH, LORD OF DARKNESS', '#ff4040');
    if (g.options.ironman) removeUpStairs(level);
  } else {
    g.msg.add(level.daytime ? 'The sun is up.' : 'It is night. The town is dark.', '#a0a0a0');
  }
  autosaveHook?.(g);
}
function placeQuestor(g: Game, lv: Level, id: string, avoid: Pos): void {
  for (let t = 0; t < 200; t++) {
    const x = 1 + randint0(lv.w - 2), y = 1 + randint0(lv.h - 2);
    if (!isCleanFloor(lv, x, y) || Math.max(Math.abs(x - avoid.x), Math.abs(y - avoid.y)) < 20) continue;
    createMonster(g, id, x, y, true, lv); return;
  }
  const p = nearFloor(lv, avoid.x, avoid.y, 30, avoid); if (p) createMonster(g, id, p.x, p.y, true, lv);
}
function removeUpStairs(lv: Level): void { for (let i = 0; i < lv.tiles.length; i++) if (lv.tiles[i] === T.STAIRS_UP) lv.tiles[i] = T.FLOOR; }
export let autosaveHook: ((g: Game) => void) | null = null;
export function setAutosaveHook(f: ((g: Game) => void) | null): void { autosaveHook = f; }

function levelFeeling(g: Game): number {
  const lv = g.level;
  let danger = 0;
  for (const m of lv.monsters) { const r = raceOf(m); if (r.depth > lv.depth) danger += (r.depth - lv.depth) * 5; if (hasMFlag(r, 'UNIQUE')) danger += 30; }
  let loot = 0;
  for (const fi of lv.items) { const k = kindOf(fi.item); if (fi.item.artifact) loot += 200; else if (fi.item.ego) loot += 40; else if (k.level > lv.depth + 5) loot += 10; }
  const score = danger + loot;
  if (lv.rooms.length && hasFlag(lv, 0, 0, 0)) { /* noop */ }
  if (score >= 250) return 1; if (score >= 150) return 2; if (score >= 100) return 3; if (score >= 60) return 4; if (score >= 35) return 5; if (score >= 20) return 6; if (score >= 10) return 7; if (score >= 5) return 8; if (score > 0) return 9; return 10;
}
function feelingText(f: number): string {
  return ['', 'You feel there is something special about this level!', 'Omens of death haunt this place!', 'This place seems murderous.', 'This place seems terribly dangerous.',
    'You feel anxious about this place.', 'You feel nervous about this place.', 'This place does not seem too risky.', 'This place seems reasonably safe.', 'This seems a quiet, peaceful place.', 'What a boring place...'][f] || '';
}

/** Spend the player's energy and let the world run until it is the player's turn again. */
export function endTurn(g: Game, cost = 100): void {
  const p = g.player;
  p.energy -= cost;
  p.turns++;
  runWorld(g);
}

/** Advance game turns until the player has energy to act (or is dead / changing level). */
export function runWorld(g: Game): void {
  const p = g.player;
  let guard = 0;
  while (p.energy < 100 && !p.dead && !g.levelChange && guard++ < 10000) {
    g.turn++;
    g.level.age++;
    if (g.turn % 10 === 0) processWorld(g);
    if (p.dead || g.levelChange) break;
    ensureFlow(g);
    // Monsters act in a stable order; a monster killed mid-loop is skipped.
    const list = g.level.monsters.slice();
    for (const m of list) {
      if (p.dead || g.levelChange) break;
      if (!g.level.monsters.includes(m)) continue;
      m.energy += energyGain(monsterSpeed(m));
      let acts = 0;
      while (m.energy >= 100 && acts++ < 3 && g.level.monsters.includes(m) && !p.dead && !g.levelChange) {
        m.energy -= 100;
        monsterTurn(g, m);
      }
    }
    p.energy += energyGain(g.bonuses.speed);
  }
  if (!p.dead) {
    updateView(g.level, p.x, p.y, g.bonuses.lightRadius, p.timed.blind > 0);
    updateMonsterVisibility(g);
    // An awake, mobile monster right next to us stops running/resting/travelling.
    if ((g.running || g.resting || g.travel || g.repeating) && g.level.depth > 0) {
      for (const m of g.level.monsters) if (m.visible && m.sleep === 0 && !hasMFlag(raceOf(m), 'NEVER_MOVE') && Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1) { disturb(g); break; }
    }
  }
  g.msg.newTurn(g.turn);
}

/** Once per ten game turns: hunger, regeneration, timed effects, light, recall. */
export function processWorld(g: Game): void {
  const p = g.player, b = g.bonuses;
  // Hunger.
  if (p.food < FOOD_MAX) {
    let digest = 2;
    if (b.speed > 0) digest += Math.floor(b.speed / 2);
    if (p.timed.fast) digest += 3;
    if (b.flags.has('SLOW_DIGEST')) digest = Math.max(1, digest - 1);
    if (b.flags.has('REGEN')) digest += 1;
    const before = p.food;
    p.food = Math.max(0, p.food - digest);
    foodMessages(g, before, p.food);
    if (p.food < FOOD_STARVE) takeHit(g, randint1(4), 'starvation');
    if (p.food < FOOD_FAINT && oneIn(10) && !p.timed.paralyzed && !b.flags.has('FREE_ACT')) { g.msg.add('You faint from the lack of food.', '#ff8080'); setTimed(g, 'paralyzed', 1 + randint0(5)); }
  } else { p.food = FOOD_MAX - 1; }
  // Regeneration (none while poisoned, bleeding or stunned; a mortal wound never heals by itself).
  if (!p.timed.poisoned && !p.timed.cut && !p.timed.stun) {
    let pct = p.food < FOOD_WEAK ? 0 : p.food < FOOD_HUNGRY ? 1 : 2;
    if (g.resting) pct *= 2;
    if (b.flags.has('REGEN')) pct *= 2;
    if (pct && p.chp < p.mhp && (p.turns % Math.max(1, 6 - pct) === 0 || oneIn(4))) p.chp = Math.min(p.mhp, p.chp + Math.max(1, Math.floor(p.mhp * pct / 100)));
  }
  if (p.csp < p.msp && oneIn(3)) p.csp = Math.min(p.msp, p.csp + Math.max(1, Math.floor(p.msp / 30)));
  // Timed effects.
  const t = p.timed;
  if (t.fast) setTimed(g, 'fast', t.fast - 1); if (t.slow) setTimed(g, 'slow', t.slow - 1);
  if (t.blind) setTimed(g, 'blind', t.blind - 1); if (t.paralyzed) setTimed(g, 'paralyzed', t.paralyzed - 1);
  if (t.confused) setTimed(g, 'confused', t.confused - 1); if (t.afraid) setTimed(g, 'afraid', t.afraid - 1);
  if (t.image) setTimed(g, 'image', t.image - 1);
  if (t.poisoned) { takeHit(g, 1, 'poison'); setTimed(g, 'poisoned', t.poisoned - 1); }
  if (t.cut) {
    // Angband's cut tiers: graze 1, light 1, bad 1, nasty 1, severe 2, deep gash 3, mortal wound 3 (and it never closes by itself).
    const d = t.cut > 200 ? 3 : t.cut > 100 ? 2 : 1;
    takeHit(g, d, t.cut > 1000 ? 'a mortal wound' : 'a fatal wound');
    const adjust = t.cut > 1000 ? 0 : Math.max(1, adj.conHp(b.stat.CON) + 1) * (b.flags.has('REGEN') ? 2 : 1);
    if (adjust) setTimed(g, 'cut', t.cut - adjust);
  }
  if (t.stun) setTimed(g, 'stun', t.stun - Math.max(1, adj.conHp(b.stat.CON) + 1));
  for (const k of ['protevil', 'invuln', 'hero', 'shero', 'shield', 'blessed', 'sinvis', 'sinfra', 'oppose_acid', 'oppose_elec', 'oppose_fire', 'oppose_cold', 'oppose_pois', 'telepathy', 'stoneskin', 'regen', 'bold', 'terror', 'bloodlust', 'oppose_conf'] as const) if (t[k]) setTimed(g, k, t[k] - 1);
  // Cursed gear that bleeds you.
  if (b.flags.has('DRAIN_HP') && oneIn(10) && p.chp > 1) takeHit(g, 1, 'a cursed item');
  if (b.flags.has('DRAIN_MANA') && oneIn(10) && p.csp > 0) p.csp--;
  // Day and night in the town.
  if (p.depth === 0 && g.level.daytime !== undefined && g.level.daytime !== isDaytime(g.turn)) { g.level.daytime = isDaytime(g.turn); relightTown(g); }
  if (t.recall) { setTimed(g, 'recall', t.recall - 1); if (t.recall === 0) { g.msg.add('You feel yourself yanked ' + (p.depth === 0 ? 'downwards!' : 'upwards!'), '#ffd040'); g.levelChange = { depth: p.recallDepth, by: 'recall' }; } }
  if (t.deep_descent) { setTimed(g, 'deep_descent', t.deep_descent - 1); if (t.deep_descent === 0) { g.msg.add('The floor opens beneath you!', '#ffd040'); g.levelChange = { depth: Math.min(MAX_DEPTH, p.depth + 2), by: 'teleport' }; } }
  // Light fuel.
  const light = p.equip.light;
  if (light && !itemFlags(light).has('NO_FUEL') && light.timeout > 0) {
    light.timeout--;
    if (light.timeout === 0) { g.msg.add('Your light has gone out!', '#ff8080'); refreshBonuses(g); updateView(g.level, p.x, p.y, b.lightRadius, t.blind > 0); }
    else if (light.timeout === 100 || light.timeout === 50) g.msg.add('Your light is growing faint.', '#ffd040');
  }
  // Rods and activations recharge.
  for (const it of p.inven) if (it.timeout > 0 && kindOf(it).tval === 'rod') { it.timeout--; if (it.timeout === 0) g.msg.add(`Your ${itemName(it, g.flavors, { article: false, count: false })} ${it.number > 1 ? 'have' : 'has'} recharged.`); }
  for (const s of SLOTS) { const it = p.equip[s]; if (it && it.timeout > 0 && kindOf(it).tval !== 'light') it.timeout--; }
  // Cursed teleportation and experience drain.
  if (b.flags.has('TELEPORT') && oneIn(50)) { g.msg.add('Your equipment teleports you!', '#ff8080'); teleportPlayer(g, 40); }
  if (b.flags.has('DRAIN_EXP') && oneIn(10) && p.exp > 0) { p.exp = Math.max(0, p.exp - 1 - Math.floor(p.exp / 500)); }
  // Pseudo-identification of carried and worn gear.
  if (oneIn(p.cls === 'warrior' || p.cls === 'paladin' || p.cls === 'rogue' ? 8 : 20)) senseSomething(g);
  // Shout when hunger is a problem (Gauntlet!).
  if (p.food < FOOD_WEAK && g.turn % 300 === 0) g.msg.shout(`${CLASS_BY_ID[p.cls].hero.toUpperCase()} NEEDS FOOD BADLY`, '#ff8080');
}

function foodMessages(g: Game, before: number, after: number): void {
  const hero = CLASS_BY_ID[g.player.cls].hero.toUpperCase();
  if (before >= FOOD_HUNGRY && after < FOOD_HUNGRY) { g.msg.add('You are getting hungry.', '#ffd040'); g.msg.shout(`${hero} IS GETTING HUNGRY`, '#ffd040'); disturb(g); }
  if (before >= FOOD_WEAK && after < FOOD_WEAK) { g.msg.add('You are getting weak from hunger!', '#ff8080'); g.msg.shout(`${hero} NEEDS FOOD BADLY`, '#ff8080'); disturb(g); }
  if (before >= FOOD_FAINT && after < FOOD_FAINT) { g.msg.add('You are getting faint from hunger!', '#ff4040'); disturb(g); }
}

function senseSomething(g: Game): void {
  const p = g.player;
  const heavy = p.cls === 'warrior' || p.cls === 'paladin';
  const cands: Item[] = [];
  for (const s of SLOTS) { const it = p.equip[s]; if (it && !it.known && !it.sense) cands.push(it); }
  for (const it of p.inven) if (!it.known && !it.sense && isWearable(kindOf(it))) cands.push(it);
  if (!cands.length) return;
  const it = cands[randint0(cands.length)];
  const sense = senseItem(it, heavy);
  if (!sense) return;
  it.sense = sense;
  const inPack = p.inven.includes(it);
  g.msg.add(`You feel the ${itemName(it, g.flavors, { article: false, count: false, plainKind: true })} ${inPack ? 'in your pack' : 'you are wearing'} ${it.number > 1 ? 'are' : 'is'} ${sense}...`, sense === 'cursed' || sense === 'terrible' ? '#ff8080' : '#c0c0ff');
}

/** Sunrise or sunset while standing in the town: relight or darken it. */
function relightTown(g: Game): void {
  const lv = g.level, day = !!lv.daytime;
  g.msg.add(day ? 'The sun has risen.' : 'The sun has set.', '#ffd040');
  for (let i = 0; i < lv.tiles.length; i++) {
    const t = lv.tiles[i];
    const shop = t >= T.SHOP_0;
    if (day || shop) lv.flags[i] |= F.GLOW | F.MARK; else lv.flags[i] &= ~F.GLOW;
  }
  updateView(lv, g.player.x, g.player.y, g.bonuses.lightRadius, g.player.timed.blind > 0);
}

export function foodState(food: number): string {
  if (food < FOOD_FAINT) return 'Faint'; if (food < FOOD_WEAK) return 'Weak'; if (food < FOOD_HUNGRY) return 'Hungry'; if (food < FOOD_FULL) return 'Fed'; return 'Full';
}
export function goldForScore(g: Game): number { return g.player.gold; }
export function score(g: Game): number {
  const p = g.player;
  return p.maxExp + 100 * p.maxDepth + g.stats.monstersKilled * 5 + Math.floor(p.gold / 10) + (g.totalWinner ? 100000 : 0);
}

export const _keepGame = [MONSTER_BY_ID, MONSTERS, adj, recomputeHp, recomputeMana, addFlag, setTile, tileAt, isCleanFloor, nearFloor, T, F, dropNear];
export type { Game, Player };
