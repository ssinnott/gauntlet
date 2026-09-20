// The autoplay bot: a hero that plays itself with exactly the commands a player has. No map
// cheats, no free healing -- it only knows what the player knows (findPath walks remembered
// grids), and every action goes through commands.ts, so it takes its turn like anyone else.
// `=` toggles it as the Autoplay game option, ctrl+A does the same from the map; tools/sim.ts
// drives the same brain headless so `npm run check` plays a few characters with it.
//
// It sizes up every fight before it picks one: what the monster does to it in a turn, what it
// does to the monster, and so how many hit points killing the thing would cost. Anything dearer
// than it can spare is shot at from a distance, walked away from or left behind on the stairs,
// which is what keeps a first-level hero alive on the first floor.
import { FOOD_HUNGRY, FOOD_WEAK } from '../constants.ts';
import { T, F, DIR_DX, DIR_DY, dirOf, isPassable, isShop, type BlowEffect, type Item, type Monster, type Pos, type Effect, type SpellDef } from './types.ts';
import { tileAt, flagAt, monsterAt, itemsAt, inBounds, los } from './level.ts';
import { kindOf, isKnown, isAmmo, isWearable, wieldSlot, itemName, itemDice, getNextItemId, setNextItemId } from './items.ts';
import { maintainStore, storeBuy, storeSell, storeWants, buyPrice, sellPrice } from './stores.ts';
import { refreshBonuses } from './effectsCore.ts';
import { raceOf, hasMFlag, energyGain, monsterSpeed } from './monster.ts';
import { meleeSkill, bowSkill } from './player.ts';
import { randint1, distance } from './util.ts';
import * as C from './commands.ts';
import type { Game } from './state.ts';

/** Quaff and run below this share of maximum hit points. */
const PANIC = 0.45;
/** Rest below this share, when nothing is watching. */
const HURT = 0.7;
/** The share of maximum hit points the bot means to still have when a fight it picked is over. */
const MARGIN = 0.3;
/** Gold kept back when shopping, so there is always something for a potion. */
const RESERVE = 20;
/** What the bot likes to leave town with. */
const SHOPPING: [string, number][] = [['ration', 5], ['potion_clw', 6], ['scroll_phase_door', 4], ['flask_oil', 15], ['torch', 3]];
/** Below this depth it will walk back up to town for potions when the last one is gone. */
const RESTOCK_DEPTH = 3;

// -----------------------------------------------------------------------------------------
// Looking around

function visibleMonsters(g: Game, range = 10): Monster[] {
  const p = g.player;
  return g.level.monsters.filter(m => m.visible && distance(p.x, p.y, m.x, m.y) <= range);
}
/** The awake monsters in view that could come for the hero; things that never move only count next to it. */
function foes(g: Game, range = 10): Monster[] {
  const p = g.player;
  return visibleMonsters(g, range).filter(m => m.sleep === 0 && (!hasMFlag(raceOf(m), 'NEVER_MOVE') || distance(p.x, p.y, m.x, m.y) <= 1));
}
function isAdjacent(g: Game, m: Monster): boolean { return distance(g.player.x, g.player.y, m.x, m.y) <= 1; }
/**
 * The closest awake monster the bot can see and shoot at. One that would come to it first; then
 * one that never will, which is target practice from two grids away.
 */
function nearestTarget(g: Game): Monster | null {
  const p = g.player;
  let best: Monster | null = null, bd = 1e9;
  for (const m of visibleMonsters(g)) {
    const d = distance(p.x, p.y, m.x, m.y);
    const rank = d + (hasMFlag(raceOf(m), 'NEVER_MOVE') ? 100 : 0);
    if (m.sleep === 0 && !m.afraid && rank < bd && d > 1 && los(g.level, p.x, p.y, m.x, m.y)) { bd = rank; best = m; }
  }
  return best;
}
function hasEffect(e: Effect | undefined, kind: Effect['kind']): boolean {
  if (!e) return false;
  if (e.kind === kind) return true;
  return e.kind === 'seq' && e.effects.some(s => hasEffect(s, kind));
}
/** Items the bot understands: unknown flavours are never drunk blind. */
function known(g: Game, it: Item): boolean { return isKnown(it, g.flavors); }
function findItem(g: Game, pred: (it: Item) => boolean): Item | null {
  for (const it of g.player.inven) if (pred(it)) return it;
  return null;
}
function countKind(g: Game, kindId: string): number {
  let n = 0;
  for (const it of [...g.player.inven, ...g.player.quiver]) if (it.kind === kindId) n += it.number;
  return n;
}
function healingPotion(g: Game): Item | null {
  return findItem(g, it => kindOf(it).tval === 'potion' && known(g, it) && hasEffect(kindOf(it).effect, 'heal'));
}
function escapeScroll(g: Game): Item | null {
  return findItem(g, it => kindOf(it).tval === 'scroll' && known(g, it) && hasEffect(kindOf(it).effect, 'teleport') && !g.player.timed.blind && !g.player.timed.confused);
}
/** A proper meal; a hero getting weak from hunger will take a scrap of anything that is not a mushroom. */
function foodItem(g: Game): Item | null {
  const least = g.player.food < FOOD_WEAK ? 1 : 500;
  return findItem(g, it => { const k = kindOf(it); return k.tval === 'food' && (k.pval || 0) >= least && !k.id.startsWith('mushroom_'); });
}

// -----------------------------------------------------------------------------------------
// Sizing up a fight: averages only, from the dice and the to-hit rolls of combat.ts.

/** The chance an attack of skill `chance` lands on armour `ac`, as testHit and the monster blows roll it. */
function hitChance(chance: number, ac: number): number {
  if (chance <= 0) return 0.05;
  return 0.05 + 0.9 * Math.max(0, 1 - Math.floor(ac * 3 / 4) / chance);
}
const avgDice = (d: [number, number] | undefined): number => d ? d[0] * (d[1] + 1) / 2 : 0;
/** combat.ts's blow power for the effects that differ much from a plain hit. */
const BLOW_POWER: Partial<Record<BlowEffect, number>> = { HURT: 60, SHATTER: 60, UN_BONUS: 20, DISENCHANT: 20, UN_POWER: 15 };
/** How many turns the monster gets for each of the hero's. */
function paceOf(g: Game, m: Monster): number { return energyGain(monsterSpeed(m)) / Math.max(1, energyGain(g.bonuses.speed)); }
/**
 * Hit points the monster takes off the hero in one of the hero's turns, misses and its pace
 * included. A thing that never moves only has its blows when the hero stands next to it.
 */
function threatOf(g: Game, m: Monster, nextTo = isAdjacent(g, m)): number {
  const r = raceOf(m), b = g.bonuses;
  let dam = 0;
  if (!hasMFlag(r, 'NEVER_BLOW') && !(hasMFlag(r, 'NEVER_MOVE') && !nextTo)) for (const blow of r.blows) {
    // A touch that poisons, blinds or drains is worth a couple of points beyond its dice.
    const nuisance = blow.effect === 'HURT' ? 0 : 2;
    dam += hitChance((BLOW_POWER[blow.effect] ?? 8) + r.depth * 3, b.ac + b.toAc) * (avgDice(blow.dice) + nuisance);
  }
  if (r.spells?.length && r.spellFreq) dam += (3 + r.depth) / r.spellFreq;
  return dam * paceOf(g, m);
}
/** What the hero's blows do to the monster in a turn. Nothing at all against a paralyser it cannot shrug off. */
function meleeOf(g: Game, m: Monster): number {
  const p = g.player, b = g.bonuses, r = raceOf(m);
  if (p.timed.afraid) return 0;
  if (r.blows.some(bl => bl.effect === 'PARALYZE') && !b.flags.has('FREE_ACT')) return 0;
  const w = p.equip.weapon;
  const dam = (w ? avgDice(itemDice(w)) + w.toDam : 1) + b.toDam;
  return b.blows * hitChance(meleeSkill(p, b), r.ac) * Math.max(0, dam);
}
/** The damage a bolt, ball or drain does on average; anything else is not an attack. */
function effectDamage(e: Effect | undefined): number {
  if (!e) return 0;
  switch (e.kind) {
    case 'seq': return e.effects.reduce((s, x) => s + effectDamage(x), 0);
    case 'bolt': return avgDice(e.dice) + (e.base || 0);
    case 'ball': return e.dam + avgDice(e.dice);
    case 'breath': case 'burst': case 'drain_life': case 'vampiric': return e.dam;
    default: return 0;
  }
}
interface Shot { dam: number; go: (dir: number, target: Pos) => void; }
/**
 * The strongest thing the hero can send at the monster from where it stands: a shot, a spell, a
 * wand or a flask. `spare` leaves the flasks and charges in the pack, for a target that is only
 * worth what the hero can throw at it for free.
 */
function bestRanged(g: Game, m: Monster, spare = false): Shot | null {
  const p = g.player, b = g.bonuses, r = raceOf(m);
  const dist = distance(p.x, p.y, m.x, m.y);
  let best: Shot | null = null;
  const offer = (dam: number, go: Shot['go']) => { if (dam > 0 && (!best || dam > best.dam)) best = { dam, go }; };
  const bow = p.equip.bow;
  if (bow && dist <= 6 + 2 * b.might) {
    const ammo = p.quiver.find(a => kindOf(a).tval === kindOf(bow).ammo);
    if (ammo) offer((avgDice(itemDice(ammo)) + ammo.toDam + bow.toDam) * b.might * Math.max(1, b.shots) * hitChance(bowSkill(p, b) + ammo.toHit * 3 - dist, r.ac), (dir, target) => C.fire(g, ammo, dir, target));
  }
  if (!p.timed.blind && !p.timed.confused && dist <= 18) {
    for (const s of C.spellsAvailable(g)) {
      if (!p.learned.includes(s.id) || C.spellMana(g, s) > p.csp) continue;
      const fail = C.spellFail(g, s);
      if (fail >= 50) continue;
      offer(effectDamage(s.effect) * (1 - fail / 100), (dir, target) => C.cast(g, s, { dir, target }));
    }
    if (!spare) for (const it of p.inven) {
      const k = kindOf(it);
      if (k.tval === 'wand' && known(g, it) && it.charges > 0) offer(effectDamage(k.effect) * 0.8, (dir, target) => C.aim(g, it, dir, target));
    }
  }
  if (!spare && dist <= 8 && !hasMFlag(r, 'IM_FIRE')) {
    const oil = findItem(g, it => kindOf(it).tval === 'flask');
    if (oil) offer(7 * hitChance(b.skills.throw + b.toHit * 3, r.ac), (dir, target) => C.throwItem(g, oil, dir, target));
  }
  return best;
}
/** Hit points the hero expects to lose killing the monster, or Infinity if it never would. */
function fightCost(g: Game, m: Monster, nextTo?: boolean): number {
  const dpt = Math.max(meleeOf(g, m), bestRanged(g, m)?.dam ?? 0);
  if (dpt <= 0) return Infinity;
  return Math.ceil(m.hp / dpt) * threatOf(g, m, nextTo);
}
/** Would the hero still have its margin left after killing this? */
function worth(g: Game, m: Monster, nextTo?: boolean): boolean { return fightCost(g, m, nextTo) <= g.player.chp - g.player.mhp * MARGIN; }
/** Likely to die from one turn of the hero's best attack. */
function oneHit(g: Game, m: Monster): boolean { return Math.max(meleeOf(g, m), bestRanged(g, m)?.dam ?? 0) >= m.hp; }
/** Hit the monster with whatever does the most: a blade when it is as good as anything, else a spell, a shot or a flask. */
function attack(g: Game, m: Monster): boolean {
  const p = g.player;
  const dir = dirOf(m.x - p.x, m.y - p.y);
  if (dir === 5) return false;
  const target = { x: m.x, y: m.y };
  const melee = isAdjacent(g, m) ? meleeOf(g, m) : 0;
  const shot = bestRanged(g, m);
  if (melee > 0 && (!shot || melee >= m.hp || melee * 1.4 >= shot.dam)) { C.moveDir(g, dir); return true; }
  if (shot) { shot.go(dir, target); return true; }
  if (melee > 0) { C.moveDir(g, dir); return true; }
  return false;
}
/** A healing spell the hero would trust its life to: known, affordable, and not a coin toss. */
function healSpell(g: Game): SpellDef | null {
  const p = g.player;
  if (p.timed.confused || (p.timed.blind && !C.spellsAvailable(g).some(s => s.realm === 'prayer'))) return null;
  const usable = C.spellsAvailable(g).filter(s => p.learned.includes(s.id) && C.spellMana(g, s) <= p.csp && C.spellFail(g, s) < 35 && hasEffect(s.effect, 'heal'));
  return usable.length ? usable[0] : null;
}

// -----------------------------------------------------------------------------------------
// Getting about: exploring, walking round things, and backing away from them.

/**
 * Grids the hero should not set foot on this turn: every monster in view it cannot afford to
 * fight, and the eight grids round each, where that monster gets its blows in. The grey mold in
 * the corridor is walked round, or the corridor is given up, but it is never walked into.
 */
let hazard = new Set<number>();
function markHazards(g: Game): void {
  hazard = new Set();
  const w = g.level.w;
  for (const m of visibleMonsters(g, 12)) {
    if (m.sleep > 0 || worth(g, m, true)) continue;
    for (let d = 1; d <= 9; d++) hazard.add((m.y + DIR_DY[d]) * w + m.x + DIR_DX[d]);
  }
}
function unknownNeighbour(g: Game, x: number, y: number): number {
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
    if (!inBounds(g.level, nx, ny)) continue;
    if (probed.has(ny * g.level.w + nx) || hazard.has(ny * g.level.w + nx)) continue;
    if (!(flagAt(g.level, nx, ny) & F.MARK)) return d;
  }
  return 0;
}
/** Breadth-first over remembered, walkable grids; returns the closest frontier. */
function frontier(g: Game): Pos | null {
  const lv = g.level, p = g.player, w = lv.w;
  const seen = new Uint8Array(lv.w * lv.h);
  const qx: number[] = [p.x], qy: number[] = [p.y];
  seen[p.y * w + p.x] = 1;
  for (let head = 0; head < qx.length; head++) {
    const x = qx[head], y = qy[head];
    if ((x !== p.x || y !== p.y) && unknownNeighbour(g, x, y)) return { x, y };
    for (let d = 1; d <= 9; d++) {
      if (d === 5) continue;
      const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
      if (!inBounds(lv, nx, ny) || seen[ny * w + nx]) continue;
      seen[ny * w + nx] = 1;
      const t = tileAt(lv, nx, ny);
      if (!(flagAt(lv, nx, ny) & F.MARK) || hazard.has(ny * w + nx)) continue;
      if (!isPassable(t) && t !== T.DOOR_CLOSED) continue;
      qx.push(nx); qy.push(ny);
    }
  }
  return null;
}
/** The nearest remembered tile of a kind, or null. */
function nearestTile(g: Game, match: (t: number) => boolean): Pos | null {
  const lv = g.level, p = g.player;
  let best: Pos | null = null, bd = 1e9;
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
    if (!(flagAt(lv, x, y) & F.MARK) || !match(tileAt(lv, x, y))) continue;
    const d = distance(p.x, p.y, x, y);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}
/** A monster the hero knows is standing there. */
function seenMonsterAt(g: Game, x: number, y: number): Monster | null {
  const m = monsterAt(g.level, x, y);
  return m && (m.visible || m.detected) ? m : null;
}
/**
 * findPath over remembered grids, but stepping round every monster the hero can see rather
 * than through it: the way to a shop must not run into the veteran dozing in the road.
 */
function pathAround(g: Game, x1: number, y1: number): Pos[] | null {
  const lv = g.level, w = lv.w, h = lv.h, p = g.player;
  if (!inBounds(lv, x1, y1)) return null;
  const prev = new Int32Array(w * h).fill(-1);
  const qx: number[] = [p.x], qy: number[] = [p.y];
  prev[p.y * w + p.x] = p.y * w + p.x;
  let found = false;
  for (let head = 0; head < qx.length && !found; head++) {
    const x = qx[head], y = qy[head];
    for (let k = 1; k <= 9; k++) {
      if (k === 5) continue;
      const nx = x + DIR_DX[k], ny = y + DIR_DY[k];
      if (!inBounds(lv, nx, ny)) continue;
      const i = ny * w + nx;
      if (prev[i] !== -1) continue;
      const t = tileAt(lv, nx, ny), goal = nx === x1 && ny === y1;
      if (!goal && !((flagAt(lv, nx, ny) & F.MARK) && (isPassable(t) || t === T.DOOR_CLOSED))) continue;
      if (!goal && (t === T.TRAP || hazard.has(i) || seenMonsterAt(g, nx, ny))) continue;
      prev[i] = y * w + x;
      if (goal) { found = true; break; }
      qx.push(nx); qy.push(ny);
    }
  }
  if (!found) return null;
  const path: Pos[] = [];
  for (let i = y1 * w + x1; i !== p.y * w + p.x; i = prev[i]) { path.push({ x: i % w, y: Math.floor(i / w) }); if (path.length > 400) return null; }
  return path.reverse();
}
/**
 * Walk toward a spot, round whatever is in the way. Without a remembered path to somewhere near
 * it shoves one step that way instead -- but only into ground it can actually enter, since
 * bumping a permanent wall costs no turn and would spin, and never toward something far off,
 * since a shove that ends at a wall and a walk back to try again is a loop.
 */
function headFor(g: Game, x: number, y: number, shove = true): boolean {
  const p = g.player;
  if (x === p.x && y === p.y) return false;
  const path = pathAround(g, x, y);
  if (path) { g.travel = path; C.travelStep(g); return true; }
  if (C.travelTo(g, x, y)) { C.travelStep(g); return true; }
  if (!shove || distance(p.x, p.y, x, y) > 8) return false;
  const d = dirOf(x - p.x, y - p.y);
  if (d === 5) return false;
  const nx = p.x + DIR_DX[d], ny = p.y + DIR_DY[d];
  const t = tileAt(g.level, nx, ny);
  if (monsterAt(g.level, nx, ny) || isPassable(t) || t === T.DOOR_CLOSED || isShop(t)) { C.moveDir(g, d); return true; }
  return false;
}
/** Open ground the bot has not walked on yet, or a probe into the dark beside it. */
function explore(g: Game): boolean {
  const p = g.player;
  const d = unknownNeighbour(g, p.x, p.y);
  if (d) {
    const nx = p.x + DIR_DX[d], ny = p.y + DIR_DY[d];
    const t = tileAt(g.level, nx, ny);
    // Walking into unremembered rock only maps it (no turn passes), which is progress either way --
    // but the town's permanent walls are never remembered, so note the grid and never poke it twice.
    probed.add(ny * g.level.w + nx);
    C.moveDir(g, d);
    if (isPassable(t) || t === T.DOOR_CLOSED) return true;
  }
  const f = frontier(g);
  if (f && headFor(g, f.x, f.y)) return true;
  return false;
}
/**
 * Step onto the neighbouring grid that leaves the foes furthest behind, leaning toward `goal`.
 * False when there is no such grid, when the step would still leave something in reach (a
 * free hit for it), or when something next to the hero is faster than it can walk.
 */
function stepAway(g: Game, from: Monster[], goal: Pos | null): boolean {
  const p = g.player, lv = g.level;
  if (!from.length) return false;
  if (from.some(m => isAdjacent(g, m) && paceOf(g, m) > 1)) return false;
  const score = (x: number, y: number): number => {
    let near = 1e9, sum = 0;
    for (const m of from) { const d = distance(x, y, m.x, m.y); near = Math.min(near, d); sum += d; }
    return Math.min(near, 4) * 100 + sum * 4 - (goal ? distance(x, y, goal.x, goal.y) : 0);
  };
  let best = 0, bs = score(p.x, p.y), bestNear = 0;
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const nx = p.x + DIR_DX[d], ny = p.y + DIR_DY[d];
    if (!inBounds(lv, nx, ny) || !(flagAt(lv, nx, ny) & (F.MARK | F.SEEN))) continue;
    const t = tileAt(lv, nx, ny);
    if (!isPassable(t) || t === T.TRAP || hazard.has(ny * lv.w + nx) || seenMonsterAt(g, nx, ny)) continue;
    const s = score(nx, ny);
    if (s > bs) { bs = s; best = d; bestNear = Math.min(...from.map(m => distance(nx, ny, m.x, m.y))); }
  }
  if (!best || bestNear <= 1) return false;
  C.moveDir(g, best);
  return true;
}
/** Remembered walkable grids round (x, y): how many sides a fight there can come from. */
function openness(g: Game, x: number, y: number): number {
  let n = 0;
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
    if (!inBounds(g.level, nx, ny)) continue;
    const t = tileAt(g.level, nx, ny);
    if ((flagAt(g.level, nx, ny) & F.MARK) && (isPassable(t) || t === T.DOOR_CLOSED)) n++;
  }
  return n;
}
/**
 * A pack is coming: a corridor grid beside the hero, where they arrive one at a time, is worth
 * the step. Only while none of them is adjacent yet, since the step would be a free blow.
 */
function holdCorridor(g: Game, pack: Monster[]): boolean {
  const p = g.player, lv = g.level;
  if (pack.some(m => isAdjacent(g, m))) return false;
  const now = openness(g, p.x, p.y);
  if (now <= 3) return false;
  let best = 0, bo = now;
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const nx = p.x + DIR_DX[d], ny = p.y + DIR_DY[d];
    if (!inBounds(lv, nx, ny) || !(flagAt(lv, nx, ny) & F.MARK)) continue;
    const t = tileAt(lv, nx, ny);
    if (!isPassable(t) || t === T.TRAP || hazard.has(ny * lv.w + nx) || seenMonsterAt(g, nx, ny)) continue;
    if (pack.some(m => distance(nx, ny, m.x, m.y) <= 1)) continue;
    const o = openness(g, nx, ny);
    if (o < bo) { bo = o; best = d; }
  }
  if (!best || bo > 3) return false;
  C.moveDir(g, best);
  return true;
}

// -----------------------------------------------------------------------------------------
// Shopping

/** Buy the supplies on the list, sell what the store wants and the bot will not use. */
export function autoShop(g: Game): void {
  const s = g.stores[g.inStore];
  const p = g.player;
  maintainStore(g, s);
  for (const it of [...p.inven]) {
    if (p.gold > 5000) break;
    const k = kindOf(it);
    if (!storeWants(s, it) || k.tval === 'gold') continue;
    // Keep anything wielded, the shopping list, and books; sell the rest of the loot.
    if (SHOPPING.some(w => w[0] === it.kind) || k.tval === 'food' || k.tval.endsWith('book')) continue;
    if (isWearable(k) && !p.equip[wieldSlot(k) || 'weapon']) continue;
    if (sellPrice(g, s, it) <= 0) continue;
    const sold = C.removeFromInventory(g, it, it.number);
    storeSell(g, s, sold, sold.number);
    refreshBonuses(g);
  }
  for (const [kindId, want] of SHOPPING) {
    while (countKind(g, kindId) < want) {
      const stock = s.stock.find(it => it.kind === kindId);
      if (!stock) break;
      const price = buyPrice(g, s, stock);
      if (price > p.gold - RESERVE) break;
      const bought = storeBuy(g, s, stock, 1);
      if (!bought) break;
      bought.id = getNextItemId(); setNextItemId(bought.id + 1);
      if (!C.addToInventory(g, bought)) break;
      g.msg.add(`You bought ${itemName(bought, g.flavors)} for ${price} gold.`, '#ffd040');
    }
  }
  refreshBonuses(g);
  shopped.add(s.type);
  g.inStore = -1;
}
/** Which store still sells something the bot is short of? */
function wantedStore(g: Game): number {
  const short = SHOPPING.filter(([id, n]) => countKind(g, id) < n).map(w => w[0]);
  if (!short.length || g.player.gold < 50) return -1;
  if (!shopped.has(0) && short.some(id => id === 'ration' || id === 'flask_oil' || id === 'torch')) return 0;
  if (!shopped.has(4) && (short.includes('potion_clw') || short.includes('scroll_phase_door'))) return 4;
  return -1;
}

// -----------------------------------------------------------------------------------------
// Patience, and where a hero of this level belongs

/**
 * The bot's memory of the level it is on: how long it has been here (a breeding pit or a level
 * whose last corner it cannot reach must not hold it for ever), whether it has seen anything
 * breed, and what its hit points were a turn ago (something unseen may be chewing on it).
 */
let levelKey = '';
let stepsOnLevel = 0;
let breedersSeen = false;
let lastHp = 0;
/** Turns left of treating an attacker the hero cannot see as real. */
let unseen = 0;
/**
 * Turns left of knowing something is hunting the hero that it cannot kill. Phase Door buys a
 * dozen grids, not safety: a fast hunter like Grip is back within the minute, so the level has to
 * be left rather than explored around. Long enough to walk the length of a level to the stairs.
 */
let hunted = 0;
/** Stores already visited on this trip to town: a shop it cannot afford is not worth a second look. */
let shopped = new Set<number>();
/** Grids the bot has already walked into once; a wall it cannot remember is not worth a second try. */
let probed = new Set<number>();
/** Forget the current level (a new hero, or a save loaded over this one). */
export function resetAutoplay(): void { levelKey = ''; stepsOnLevel = 0; breedersSeen = false; lastHp = 0; unseen = 0; hunted = 0; shopped = new Set(); probed = new Set(); hazard = new Set(); }
/** Bot turns spent on the level the hero is standing on. */
function levelAge(g: Game): number {
  const key = `${g.player.name}|${g.level.depth}|${g.stats.levelsVisited}`;
  if (key !== levelKey) { levelKey = key; stepsOnLevel = 0; breedersSeen = false; lastHp = g.player.chp; unseen = 0; hunted = 0; shopped = new Set(); probed = new Set(); }
  return ++stepsOnLevel;
}
/** A look round, but not a survey: a hundred-by-sixty level has corners not worth the turns. */
const LOOK_ROUND = 200;
const GIVE_UP = 500;
const SWARM_GIVE_UP = 150;
/** The deepest floor a hero of this level should be walking about on: Angband's rule of thumb, half the level and a bit. */
function depthFor(lev: number): number { return lev < 3 ? 1 : lev < 10 ? Math.floor(lev / 2) + 1 : lev - 4; }
/** The nearest known staircase of the kinds the bot is willing to take, or null. */
function exitStairs(g: Game, down: boolean, up: boolean): Pos | null {
  const p = g.player;
  const a = down ? nearestTile(g, t => t === T.STAIRS_DOWN) : null;
  const b = up ? nearestTile(g, t => t === T.STAIRS_UP) : null;
  if (a && b) return distance(p.x, p.y, a.x, a.y) <= distance(p.x, p.y, b.x, b.y) ? a : b;
  return a || b;
}

// -----------------------------------------------------------------------------------------
// One bot turn

/**
 * Play one action. `step` only paces the housekeeping (searching, studying, tidying the pack),
 * so the caller can pass a plain counter. Never throws: a bot that dies is a bot that died.
 */
export function autoplayStep(g: Game, step: number): void {
  const p = g.player;
  const turns = p.turns;
  decide(g, step);
  // A decision that cost no turn (a wall bumped and mapped, a study that found no book) must
  // not be made again on the same board: let the world move first.
  if (p.turns === turns && !p.dead && !g.levelChange && g.inStore < 0) C.passTurn(g);
}
function decide(g: Game, step: number): void {
  const p = g.player, lv = g.level;
  if (p.dead || g.levelChange) return;
  if (g.inStore >= 0) { autoShop(g); return; }
  if (p.timed.paralyzed || p.timed.stun > 100) { C.passTurn(g); return; }

  const age = levelAge(g);
  const town = lv.depth === 0;
  const threats = visibleMonsters(g);
  const awake = foes(g);
  const close = foes(g, 4);
  const adjacent = close.filter(m => isAdjacent(g, m));
  const here = tileAt(lv, p.x, p.y);
  // Hit points fell with nothing awake in view to blame and no wound to bleed from: something
  // the hero cannot see is on it, and standing still (let alone resting) is the wrong answer.
  const bleeding = p.timed.poisoned > 0 || p.timed.cut > 0 || p.food < FOOD_WEAK;
  if (p.chp < lastHp && !awake.length && !bleeding) unseen = 4; else if (unseen) unseen--;
  lastHp = p.chp;
  if (threats.some(m => hasMFlag(raceOf(m), 'MULTIPLY'))) breedersSeen = true;
  // Something awake and mobile that the hero cannot kill: it will follow, and a level with one
  // on it is not explorable any more, whatever happens to be out of sight this turn.
  if (!town && awake.some(m => !hasMFlag(raceOf(m), 'NEVER_MOVE') && !worth(g, m, true))) hunted = 150;
  else if (hunted) hunted--;
  markHazards(g);

  // Finish what is already running, unless something turned up.
  if (g.resting) { if (awake.length || unseen) g.resting = 0; else { C.restStep(g); return; } }
  if (g.travel) { if (close.length) g.travel = null; else { C.travelStep(g); return; } }
  if (g.running) { if (awake.length) g.running = null; else { C.runStep(g); return; } }

  // What the neighbourhood would cost to clear, against what the hero can spare. The clock
  // ticks before the fighting does, or a breeding pit would hold the bot on one grid for ever.
  const budget = p.chp - p.mhp * MARGIN;
  const overmatched = close.reduce((s, m) => s + fightCost(g, m), 0) > budget;
  const swarm = awake.length > 4;
  // Fleeing means the level has stopped being worth fighting for: breeders, a crowd, something
  // it cannot beat, or something it cannot see. It heads for the stairs and hits only what is in
  // the way or would die in one blow.
  const fleeing = !town && (breedersSeen || swarm || overmatched || unseen > 0 || hunted > 0);
  // Which way out. Too deep for its level (a trap door, say), or out of potions with the town
  // close above, and it climbs; otherwise it dives only as far as its level warrants.
  const tooDeep = lv.depth > depthFor(p.lev);
  const starving = p.food < FOOD_HUNGRY && !foodItem(g);
  const needTown = lv.depth <= RESTOCK_DEPTH && p.gold >= 60 && (countKind(g, 'potion_clw') === 0 || starving);
  const wantUp = !town && !g.options.ironman && (tooDeep || needTown);
  const mayDive = !wantUp && lv.depth + 1 <= depthFor(p.lev);
  const hurt = p.chp < p.mhp * HURT;
  // Explore while there is ground left to cover -- but once the way down is known, a look round
  // is enough; the last corner of the level is not worth the turns, and a swarm even less.
  const more = town ? null : frontier(g);
  const down = town ? null : nearestTile(g, t => t === T.STAIRS_DOWN);
  const staying = town || (!!more && !fleeing && !wantUp && age < (swarm ? SWARM_GIVE_UP : GIVE_UP) && !(down && age > LOOK_ROUND));
  // The way off this level, once it is leaving: a known staircase it is willing to take. A hurt
  // hero on the run climbs, since a fresh level one floor up is gentler than one floor down;
  // one in good shape takes the nearest. Going deeper is fine in an emergency, and the only way
  // on for an ironman hero.
  const upKnown = g.options.ironman ? null : nearestTile(g, t => t === T.STAIRS_UP);
  const takeDown = fleeing || mayDive || g.options.ironman;
  const takeUp = !g.options.ironman && (fleeing || wantUp || !mayDive);
  const exit = town || staying ? null : exitStairs(g, takeDown && !(fleeing && hurt && upKnown), takeUp);
  const goal = exit || more;

  // 1. Staying alive. A hero one or two more blows from death drinks before it is at PANIC.
  const incoming = adjacent.reduce((s, m) => s + threatOf(g, m), 0);
  const panic = p.chp < p.mhp * PANIC || (incoming > 0 && p.chp < p.mhp * HURT && p.chp <= incoming * 2 + 2);
  if (panic) {
    const potion = healingPotion(g), spell = healSpell(g);
    // Something taking half the hero's hit points a turn outdrinks any potion: get away first.
    const outdrunk = adjacent.length > 0 && incoming * 2 >= p.mhp;
    if (!outdrunk) {
      if (potion) { C.quaff(g, potion); return; }
      if (spell) { C.cast(g, spell, {}); return; }
    }
    if (close.length || unseen) {
      // Stairs are the oldest escape in the game, and the bot stands on some often enough.
      if (here === T.STAIRS_DOWN) { C.goDown(g); return; }
      if (here === T.STAIRS_UP && !g.options.ironman) { C.goUp(g); return; }
      const scroll = escapeScroll(g);
      if (scroll) { C.read(g, scroll, {}); return; }
      if (stepAway(g, close, goal)) return;
      if (potion) { C.quaff(g, potion); return; }
      if (spell) { C.cast(g, spell, {}); return; }
    } else if (awake.length) {
      // Something is coming, and there is no resting with it in view: put ground between them.
      if (stepAway(g, awake, goal)) return;
    } else if (hurt) { C.rest(g, -1); C.restStep(g); return; }
  }
  if (p.food < FOOD_HUNGRY) {
    const meal = foodItem(g);
    if (meal) { C.eat(g, meal); return; }
  }

  // 2. Whatever is in arm's reach. A thing it cannot afford to trade blows with is backed away
  //    from while backing away works; cornered, it reads its way out or fights after all.
  if (adjacent.length) {
    const easy = adjacent.filter(m => oneHit(g, m));
    const menace = adjacent.some(m => !worth(g, m));
    if (p.timed.afraid) {
      if (stepAway(g, close, goal)) return;
      const shot = bestRanged(g, adjacent[0]);
      if (shot) { shot.go(dirOf(adjacent[0].x - p.x, adjacent[0].y - p.y), { x: adjacent[0].x, y: adjacent[0].y }); return; }
      const scroll = escapeScroll(g);
      if (scroll) { C.read(g, scroll, {}); return; }
      C.passTurn(g); return;
    }
    if (menace || (fleeing && !easy.length)) {
      // Standing on a staircase with a thing like that beside it, the hero takes the stairs.
      if (here === T.STAIRS_DOWN && (town || takeDown || fleeing)) { C.goDown(g); return; }
      if (here === T.STAIRS_UP && !town && !g.options.ironman) { C.goUp(g); return; }
      if (stepAway(g, close, goal)) return;
      if (menace) { const scroll = escapeScroll(g); if (scroll) { C.read(g, scroll, {}); return; } }
    }
    const pick = easy[0] || adjacent.reduce((a, b) => fightCost(g, b) < fightCost(g, a) ? b : a);
    if (attack(g, pick)) return;
  }
  // Something asleep beside the hero is free hits, if it is a fight the hero would pick awake.
  if (!fleeing && !p.timed.afraid) {
    for (let d = 1; d <= 9; d++) {
      if (d === 5) continue;
      const m = seenMonsterAt(g, p.x + DIR_DX[d], p.y + DIR_DY[d]);
      if (m && m.sleep > 0 && worth(g, m) && attack(g, m)) return;
    }
  }

  // 3. Housekeeping that is safe with nothing close: learn spells, wear what was found.
  if (!close.length && !unseen) {
    if (C.newSpellCount(g) > 0 && C.study(g)) return;
    const gear = findItem(g, it => { const k = kindOf(it); return isWearable(k) && !isAmmo(k) && !!wieldSlot(k) && !p.equip[wieldSlot(k)!]; });
    if (gear) { C.wield(g, gear); return; }
  }

  // 4. The town: stock up, then find the way down.
  if (town) {
    const want = wantedStore(g);
    if (want >= 0) {
      const door = nearestTile(g, t => isShop(t) && t - T.SHOP_0 === want);
      if (door && headFor(g, door.x, door.y, false)) return;
      // A door it can see but not reach is not worth walking at; the shop is given up on.
      if (door) shopped.add(want);
      // The shop has not been found yet: no hero walks into the dungeon without potions.
      else if (explore(g)) return;
    }
    const stairs = nearestTile(g, t => t === T.STAIRS_DOWN);
    if (stairs) {
      if (stairs.x === p.x && stairs.y === p.y) { C.goDown(g); return; }
      if (headFor(g, stairs.x, stairs.y)) return;
    }
    if (explore(g)) return;
    C.passTurn(g);
    return;
  }

  // 5. Off this level, when it is finished, dull or dangerous -- but not on a sliver of health,
  //    unless something is chasing the hero down the stairs anyway.
  if (!staying && (!hurt || fleeing)) {
    if (here === T.STAIRS_DOWN && takeDown) { C.goDown(g); return; }
    if (here === T.STAIRS_UP && takeUp) { C.goUp(g); return; }
  }

  // 6. Shoot what is coming while it is still coming: every shot before it arrives is free, and
  //    the thing it could not face hand to hand may never arrive. Not at breeders (a bottomless
  //    supply) and not when the hero should be leaving anyway.
  const pack = foes(g, 6);
  if (!fleeing && pack.length >= 2 && holdCorridor(g, pack)) return;
  const target = nearestTarget(g);
  if (target && !breedersSeen && !unseen && !swarm && (worth(g, target) || overmatched)) {
    const shot = bestRanged(g, target, hasMFlag(raceOf(target), 'NEVER_MOVE'));
    if (shot) { shot.go(dirOf(target.x - p.x, target.y - p.y), { x: target.x, y: target.y }); return; }
  }

  // 7. Housekeeping, only when nothing is breathing down the hero's neck.
  if (!close.length && !unseen) {
    if (itemsAt(lv, p.x, p.y).length && C.pickupHere(g, false)) return;
    const chest = itemsAt(lv, p.x, p.y).find(fi => kindOf(fi.item).tval === 'chest');
    if (chest) { C.openChest(g, chest); return; }
    if (!awake.length && (p.chp < p.mhp * HURT || p.csp < p.msp / 2)) { C.rest(g, -1); C.restStep(g); return; }
    if (staying && step % 31 === 30) { C.searchAround(g); return; }
  }

  // 8. Move: on into the dark, or off this level.
  if (exit && headFor(g, exit.x, exit.y)) return;
  if (!staying && close.length && stepAway(g, close, goal)) return;
  if (explore(g)) return;
  if (down && headFor(g, down.x, down.y)) return;
  // Walled in: dig at the softest neighbour, or feel around for a secret door.
  if (step % 3 === 0) { C.searchAround(g); return; }
  for (let d = 1; d <= 9; d++) {
    const dd = ((step + d) % 9) + 1;
    if (dd === 5) continue;
    const t = tileAt(lv, p.x + DIR_DX[dd], p.y + DIR_DY[dd]);
    if (t === T.RUBBLE || t === T.MAGMA || t === T.QUARTZ || t === T.MAGMA_K || t === T.QUARTZ_K) { C.tunnelInto(g, p.x + DIR_DX[dd], p.y + DIR_DY[dd]); return; }
  }
  const up = nearestTile(g, t => t === T.STAIRS_UP);
  if (up && !g.options.ironman) {
    if (up.x === p.x && up.y === p.y) { C.goUp(g); return; }
    if (headFor(g, up.x, up.y)) return;
  }
  if (adjacent.length && attack(g, adjacent[0])) return;
  let dir = randint1(9); if (dir === 5) dir = 1;
  C.moveDir(g, dir);
}
