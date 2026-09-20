// The autoplay bot: a hero that plays itself with exactly the commands a player has. No map
// cheats, no free healing -- it only knows what the player knows (findPath walks remembered
// grids), and every action goes through commands.ts, so it takes its turn like anyone else.
// `=` toggles it as the Autoplay game option, ctrl+A does the same from the map; tools/sim.ts
// drives the same brain headless so `npm run check` plays a few characters with it.
//
// It sizes up every fight before it picks one: what the monster does to it in a turn, what it
// does to the monster, and so how many hit points killing the thing would cost. Anything dearer
// than it can spare is shot at from a distance, walked round or left behind on the stairs, which
// is what keeps a first-level hero alive on the first floor.
import { FOOD_HUNGRY, FOOD_WEAK, INVEN_MAX, QUIVER_SLOTS } from '../constants.ts';
import { T, F, DIR_DX, DIR_DY, dirOf, isPassable, isShop, type BlowEffect, type Item, type FloorItem, type Monster, type ObjectKind, type Pos, type SlotName, type Effect, type SpellDef } from './types.ts';
import { tileAt, flagAt, monsterAt, itemsAt, inBounds, projectPath } from './level.ts';
import { kindOf, isKnown, isAmmo, isWearable, wieldSlot, itemName, itemDice, canStack, getNextItemId, setNextItemId } from './items.ts';
import { isIgnored, itemQuality, alwaysPickUp } from './ignore.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { maintainStore, storeBuy, storeSell, storeWants, buyPrice, sellPrice } from './stores.ts';
import { refreshBonuses } from './effectsCore.ts';
import { raceOf, hasMFlag, energyGain, monsterSpeed } from './monster.ts';
import { meleeSkill, bowSkill } from './player.ts';
import { randint0, distance } from './util.ts';
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
/** Above this depth it will walk back up to town for potions when the last one is gone. */
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
 * Whether a shot, bolt or thrown flask from the hero's grid would reach the monster: the path a
 * projectile takes ends on its grid. Line of sight is not enough -- a bolt travels a different
 * line from the eye and stops at the first monster or wall in its way.
 */
function canReach(g: Game, m: Monster, range = 20): boolean {
  const p = g.player;
  const path = projectPath(g.level, p.x, p.y, m.x, m.y, range, true);
  const end = path[path.length - 1];
  return !!end && end.x === m.x && end.y === m.y;
}
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
    if (m.sleep === 0 && !m.afraid && rank < bd && d > 1 && canReach(g, m)) { bd = rank; best = m; }
  }
  return best;
}
/** Ground the hero can step onto this turn: no monster, and a tile a move actually enters. */
function canEnter(g: Game, x: number, y: number): boolean {
  if (!inBounds(g.level, x, y) || monsterAt(g.level, x, y)) return false;
  const t = tileAt(g.level, x, y);
  return isPassable(t) || t === T.DOOR_CLOSED || isShop(t);
}
/**
 * The open neighbour that puts the most ground between the hero and the monster in direction
 * `from`, or 0 when there is none. Straight away from it into a wall is not a step at all: it
 * costs no turn, so a frightened hero facing a wall would stand there for ever.
 */
function fleeDir(g: Game, from: number): number {
  const p = g.player;
  const mx = p.x + DIR_DX[from], my = p.y + DIR_DY[from];
  let best = 0, bd = -1;
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const nx = p.x + DIR_DX[d], ny = p.y + DIR_DY[d];
    if (!canEnter(g, nx, ny)) continue;
    let score = distance(mx, my, nx, ny) * 4;
    for (const m of visibleMonsters(g, 4)) score -= Math.max(0, 4 - distance(m.x, m.y, nx, ny));
    if (score > bd) { bd = score; best = d; }
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
interface Shot { dam: number; go: () => void; }
/**
 * The strongest thing the hero can send at the monster from where it stands: a shot, a spell, a
 * wand or a flask. Everything is aimed at the monster's grid (direction 5 plus a target, as the
 * player's `t` does), never at a keypad direction, which only lines up on a row, column or
 * diagonal. `spare` leaves the flasks and charges in the pack, for a target that is only worth
 * what can be thrown at it for free.
 */
function bestRanged(g: Game, m: Monster, spare = false): Shot | null {
  const p = g.player, b = g.bonuses, r = raceOf(m);
  const dist = distance(p.x, p.y, m.x, m.y);
  if ((m.x === p.x && m.y === p.y) || !canReach(g, m)) return null;
  const dir = 5, target = { x: m.x, y: m.y };
  let best: Shot | null = null;
  const offer = (dam: number, go: () => void) => { if (dam > 0 && (!best || dam > best.dam)) best = { dam, go }; };
  const bow = p.equip.bow;
  if (bow && dist <= 6 + 2 * b.might) {
    const ammo = p.quiver.find(a => kindOf(a).tval === kindOf(bow).ammo);
    if (ammo) offer((avgDice(itemDice(ammo)) + ammo.toDam + bow.toDam) * b.might * Math.max(1, b.shots) * hitChance(bowSkill(p, b) + ammo.toHit * 3 - dist, r.ac), () => C.fire(g, ammo, dir, target));
  }
  if (!p.timed.blind && !p.timed.confused && dist <= 18) {
    for (const s of C.spellsAvailable(g)) {
      if (!p.learned.includes(s.id) || C.spellMana(g, s) > p.csp) continue;
      const fail = C.spellFail(g, s);
      if (fail >= 50) continue;
      offer(effectDamage(s.effect) * (1 - fail / 100), () => C.cast(g, s, { dir, target }));
    }
    if (!spare) for (const it of p.inven) {
      const k = kindOf(it);
      if (k.tval === 'wand' && known(g, it) && it.charges > 0) offer(effectDamage(k.effect) * 0.8, () => C.aim(g, it, dir, target));
    }
  }
  if (!spare && dist <= 8 && !hasMFlag(r, 'IM_FIRE')) {
    const oil = findItem(g, it => kindOf(it).tval === 'flask');
    if (oil) offer(7 * hitChance(b.skills.throw + b.toHit * 3, r.ac), () => C.throwItem(g, oil, dir, target));
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
  const melee = isAdjacent(g, m) ? meleeOf(g, m) : 0;
  const shot = bestRanged(g, m);
  const swing = () => { const d = dirOf(m.x - p.x, m.y - p.y); if (d === 5) return false; C.moveDir(g, d); return true; };
  if (melee > 0 && (!shot || melee >= m.hp || melee * 1.4 >= shot.dam)) return swing();
  if (shot) { shot.go(); return true; }
  return melee > 0 ? swing() : false;
}
/** A healing spell the hero would trust its life to: known, affordable, and not a coin toss. */
function healSpell(g: Game): SpellDef | null {
  const p = g.player;
  if (p.timed.confused || (p.timed.blind && !C.spellsAvailable(g).some(s => s.realm === 'prayer'))) return null;
  const usable = C.spellsAvailable(g).filter(s => p.learned.includes(s.id) && C.spellMana(g, s) <= p.csp && C.spellFail(g, s) < 35 && hasEffect(s.effect, 'heal'));
  return usable.length ? usable[0] : null;
}

// -----------------------------------------------------------------------------------------
// Exploring: the nearest remembered grid that still has unseen ground beside it.

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
/** A monster the hero knows is standing there. */
function seenMonsterAt(g: Game, x: number, y: number): Monster | null {
  const m = monsterAt(g.level, x, y);
  return m && (m.visible || m.detected) ? m : null;
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

// -----------------------------------------------------------------------------------------
// Digging: rubble across the way on, and veins with treasure showing.

/** Can a hero with no special tools tunnel through this? */
function diggable(t: number): boolean { return t === T.RUBBLE || t === T.MAGMA || t === T.QUARTZ || t === T.MAGMA_K || t === T.QUARTZ_K; }
/** Turns the hero can expect to spend clearing a grid of this kind (see commands.tunnelInto). */
function digTurns(g: Game, t: number): number {
  const need = t === T.RUBBLE ? 200 : t === T.MAGMA || t === T.MAGMA_K ? 400 : t === T.QUARTZ || t === T.QUARTZ_K ? 800 : 1600;
  return need / Math.max(1, g.bonuses.skills.digging);
}
/** Longest dig the bot will plan for, in expected turns; three times that and it gives the grid up. */
const DIG_PATIENCE = 60;
/** A grid worth digging, the walkable grid to dig it from, and the walk to get there. */
type DigSite = { dig: Pos; from: Pos; steps: number };
/**
 * One breadth-first walk over remembered, walkable grids, closest first: the nearest grid with
 * unseen ground beside it, the nearest rubble with unseen ground behind it (a blocked corridor), and
 * the nearest vein showing treasure. A bare streamer leads nowhere but rock, so it is not counted.
 * Grids a monster it cannot beat is standing over are no way on, so the walk does not spread there.
 */
function survey(g: Game): { open: Pos | null; openSteps: number; rubble: DigSite | null; treasure: DigSite | null } {
  const lv = g.level, p = g.player, w = lv.w;
  const seen = new Uint8Array(lv.w * lv.h);
  const qx: number[] = [p.x], qy: number[] = [p.y], qs: number[] = [0];
  seen[p.y * w + p.x] = 1;
  let open: Pos | null = null, openSteps = 0, rubble: DigSite | null = null, treasure: DigSite | null = null;
  for (let head = 0; head < qx.length && !(open && rubble && treasure); head++) {
    const x = qx[head], y = qy[head], steps = qs[head];
    if (!open && (x !== p.x || y !== p.y) && unknownNeighbour(g, x, y)) { open = { x, y }; openSteps = steps; }
    for (let d = 1; d <= 9; d++) {
      if (d === 5) continue;
      const nx = x + DIR_DX[d], ny = y + DIR_DY[d], i = ny * w + nx;
      if (!inBounds(lv, nx, ny) || seen[i]) continue;
      seen[i] = 1;
      if (!(flagAt(lv, nx, ny) & F.MARK) || hazard.has(i)) continue;
      const t = tileAt(lv, nx, ny);
      if (diggable(t)) {
        if (hopeless.has(i) || digTurns(g, t) > DIG_PATIENCE) continue;
        const site = { dig: { x: nx, y: ny }, from: { x, y }, steps };
        if (!rubble && t === T.RUBBLE && unknownNeighbour(g, nx, ny)) rubble = site;
        else if (!treasure && (t === T.MAGMA_K || t === T.QUARTZ_K)) treasure = site;
        continue;
      }
      if (!isPassable(t) && t !== T.DOOR_CLOSED) continue;
      qx.push(nx); qy.push(ny); qs.push(steps + 1);
    }
  }
  return { open, openSteps, rubble, treasure };
}
/** Start on a grid beside the hero; the turn is spent, and the next steps keep at it. */
function startDig(g: Game, x: number, y: number, forced = false): void {
  dig = { x, y, turns: 1, forced };
  C.tunnelInto(g, x, y);
  g.repeating = null;
}
/** Dig the site if the hero stands beside it, else walk there; false when it cannot be reached. */
function goDig(g: Game, site: DigSite): boolean {
  const p = g.player;
  if (distance(p.x, p.y, site.dig.x, site.dig.y) <= 1) { startDig(g, site.dig.x, site.dig.y); return true; }
  if (headFor(g, site.from.x, site.from.y)) return true;
  hopeless.add(site.dig.y * g.level.w + site.dig.x);
  return false;
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
/**
 * findPath over remembered grids, but stepping round every monster the hero can see and every
 * grid one it cannot beat has covered: the way to a shop must not run into the veteran dozing in
 * the road, nor the way on through the mold in the corridor.
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
function explore(g: Game, open: Pos | null): boolean {
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
    // Bumping rubble or a vein tunnels into it, which is a turn: whether to keep at it is decided next step.
    if (diggable(t)) { g.repeating = null; return true; }
  }
  if (open && headFor(g, open.x, open.y)) return true;
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
// Loot: the nearest remembered item worth the walk.

/** The empty slot a piece of gear would go into, minding the hero's second ring finger. */
function emptySlot(g: Game, k: ObjectKind): SlotName | null {
  const slot = wieldSlot(k), p = g.player;
  if (!slot) return null;
  if (slot === 'ring1' && p.equip.ring1) return p.equip.ring2 ? null : 'ring2';
  return p.equip[slot] ? null : slot;
}
/** Is this a book of the hero's own realm? Another realm's is so much weight. */
function ownBook(g: Game, k: ObjectKind): boolean {
  const realm = CLASS_BY_ID[g.player.cls]?.realm;
  return !!realm && k.tval === `${realm}_book`;
}
// How much the bot wants to keep a thing, worst to best. This is an order, not a price: it only
// decides what goes over the side when the pack is full and something better is underfoot.
const KEEP_JUNK = 0;     // cursed or broken gear: weight, and nothing else
const KEEP_DULL = 15;    // known and ordinary: a spare robe, a read scroll's twin
const KEEP_SPARE = 30;   // an unknown flavour -- a lottery ticket, and it sells
const KEEP_DEVICE = 45;  // wands, staves, rods: the bot fights with these
const KEEP_GEAR = 60;    // armour and weapons it could wear or swap to
const KEEP_KIT = 90;     // food, cures, escapes, oil, light, its own spellbooks
const KEEP_PRIZE = 100;  // artifacts, egos, anything the hero marked to keep
/** What the pack is worth holding on to, by the bot's lights. */
function keepValue(g: Game, it: Item): number {
  const k = kindOf(it);
  if (it.artifact || alwaysPickUp(it)) return KEEP_PRIZE;
  const q = itemQuality(it);
  if (q === 'special' || q === 'excellent') return KEEP_PRIZE;
  // A caster that throws its own spellbook away cannot cast again: that is never junk.
  if (ownBook(g, k)) return KEEP_PRIZE;
  if (k.tval === 'flask') return KEEP_KIT;
  if (k.tval === 'light' && countKind(g, it.kind) <= 4) return KEEP_KIT;
  if (k.tval === 'food' && (k.pval || 0) >= 500) return KEEP_KIT;
  if (k.tval === 'potion' && known(g, it) && hasEffect(k.effect, 'heal')) return KEEP_KIT;
  if (k.tval === 'scroll' && known(g, it) && hasEffect(k.effect, 'teleport')) return KEEP_KIT;
  if (isWearable(k)) {
    if (q === 'worthless') return KEEP_JUNK;
    if (emptySlot(g, k)) return KEEP_GEAR;
    return q === 'good' ? KEEP_GEAR : KEEP_DULL;
  }
  if (k.tval === 'wand' || k.tval === 'staff' || k.tval === 'rod') return KEEP_DEVICE;
  return known(g, it) ? KEEP_DULL : KEEP_SPARE;
}
/** The thing the bot would throw away first, or null when the pack holds nothing spare. */
function junkInPack(g: Game): Item | null {
  let worst: Item | null = null, wv = 1e9, wc = 1e9;
  for (const it of g.player.inven) {
    const v = keepValue(g, it), c = kindOf(it).cost;
    if (v >= KEEP_PRIZE) continue;
    if (v > wv || (v === wv && c >= wc)) continue;
    worst = it; wv = v; wc = c;
  }
  return worst;
}
/** Room for this find: a free slot, a stack to join, or something duller to drop for it. */
function roomFor(g: Game, it: Item): boolean {
  const k = kindOf(it), p = g.player;
  if (isAmmo(k)) return p.quiver.length < QUIVER_SLOTS || p.quiver.some(q => canStack(q, it, g.flavors));
  if (p.inven.length < INVEN_MAX || p.inven.some(o => canStack(o, it, g.flavors))) return true;
  const junk = junkInPack(g);
  return !!junk && keepValue(g, it) > keepValue(g, junk);
}
/** Would the bot take this if it stood on it? Gold, keys and chests never need room in the pack. */
function wantsItem(g: Game, it: Item): boolean {
  const k = kindOf(it);
  if (k.tval === 'gold' || k.tval === 'key' || k.tval === 'chest') return true;
  if (isIgnored(g, it) || junked.has(it.id)) return false;
  return roomFor(g, it);
}
/** The closest item on a grid the bot remembers, skipping what it has already given up on. */
function nearestLoot(g: Game): FloorItem | null {
  const lv = g.level, p = g.player;
  let best: FloorItem | null = null, bd = 1e9;
  for (const fi of lv.items) {
    if (fi.x === p.x && fi.y === p.y) continue;
    if (!(flagAt(lv, fi.x, fi.y) & F.MARK) || passed.has(fi.item.id) || !wantsItem(g, fi.item)) continue;
    if (hazard.has(fi.y * lv.w + fi.x)) continue;
    const d = distance(p.x, p.y, fi.x, fi.y);
    if (d < bd) { bd = d; best = fi; }
  }
  return best;
}
/**
 * A full pack is the commonest reason a bot walks over a ring. Throw the dullest thing in it away
 * when what is underfoot beats it -- that is a turn spent, like any drop, and the pickup follows
 * next step. What the bot throws away it remembers, or it would pick the same rag straight back up.
 */
function shedForLoot(g: Game): boolean {
  const p = g.player, lv = g.level;
  if (p.inven.length < INVEN_MAX) return false;
  const junk = junkInPack(g);
  if (!junk) return false;
  const prize = itemsAt(lv, p.x, p.y).find(fi => {
    const k = kindOf(fi.item);
    if (k.tval === 'gold' || k.tval === 'key' || k.tval === 'chest' || isAmmo(k)) return false;
    if (isIgnored(g, fi.item) || junked.has(fi.item.id)) return false;
    if (p.inven.some(o => canStack(o, fi.item, g.flavors))) return false;
    return keepValue(g, fi.item) > keepValue(g, junk);
  });
  if (!prize) return false;
  junked.add(junk.id);
  C.dropItem(g, junk, junk.number);
  // Room again: loot the bot gave up on for want of space is worth another look.
  passed.clear();
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
/** Items the bot stood on and still could not take, or could not reach: not worth another walk. */
let passed = new Set<number>();
/** Items the bot threw away to make room: its own leavings, never picked back up on purpose. */
let junked = new Set<number>();
/** The grid being tunnelled and the turns sunk into it; `forced` when it is the only way off the grid. */
let dig: { x: number; y: number; turns: number; forced: boolean } | null = null;
/** Grids the bot dug at for too long, or could not get beside: not worth another try. */
let hopeless = new Set<number>();
/** Forget the current level (a new hero, or a save loaded over this one). */
export function resetAutoplay(): void {
  levelKey = ''; stepsOnLevel = 0; breedersSeen = false; lastHp = 0; unseen = 0; hunted = 0;
  shopped = new Set(); probed = new Set(); passed = new Set(); junked = new Set(); hazard = new Set();
  dig = null; hopeless = new Set(); idle = 0;
}
/** Bot turns spent on the level the hero is standing on. */
function levelAge(g: Game): number {
  const key = `${g.player.name}|${g.level.depth}|${g.stats.levelsVisited}`;
  if (key !== levelKey) {
    levelKey = key; stepsOnLevel = 0; breedersSeen = false; lastHp = g.player.chp; unseen = 0; hunted = 0;
    shopped = new Set(); probed = new Set(); passed = new Set(); junked = new Set(); dig = null; hopeless = new Set();
  }
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

/** Free actions in a row before the bot gives the clock a nudge. */
const IDLE_LIMIT = 4;
let idle = 0;

// -----------------------------------------------------------------------------------------
// One bot turn

/**
 * Play one action. `step` only paces the housekeeping (searching, studying, tidying the pack),
 * so the caller can pass a plain counter. Never throws: a bot that dies is a bot that died.
 */
export function autoplayStep(g: Game, step: number): void {
  const p = g.player;
  const turn = g.turn, x = p.x, y = p.y, depth = g.level.depth;
  decide(g, step);
  // Some actions are free: bumping a wall, a probe into rock, an order the game refused. Free is
  // fine once or twice, but a bot that keeps choosing one is stuck, and only the clock moving
  // (fear fading, a monster stepping aside, a door giving) will change its mind.
  const free = g.turn === turn && p.x === x && p.y === y && g.level.depth === depth && !g.levelChange && g.inStore < 0 && !p.dead;
  idle = free ? idle + 1 : 0;
  if (idle >= IDLE_LIMIT) { idle = 0; C.passTurn(g); }
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
  // The bot paces its own tunnelling (below); a repeat left over from the player is not its business.
  g.repeating = null;

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
  const { open, openSteps, rubble, treasure } = survey(g);
  const more = open || rubble || treasure;
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
  // Where backing away should lean: the way out if it has one, else whatever is left to look at.
  const goal: Pos | null = exit || open || rubble?.dig || treasure?.dig || null;

  // 1. Staying alive. A hero one or two more blows from death drinks before it is at PANIC.
  const incoming = adjacent.reduce((s, m) => s + threatOf(g, m), 0);
  const panic = p.chp < p.mhp * PANIC || (incoming > 0 && hurt && p.chp <= incoming * 2 + 2);
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
  // A dig in progress: keep at it while nothing is coming, and give up on a grid that will not yield.
  if (dig) {
    const t = tileAt(lv, dig.x, dig.y);
    if (!diggable(t) || distance(p.x, p.y, dig.x, dig.y) > 1 || !(staying || dig.forced)) dig = null;
    else if (dig.turns >= DIG_PATIENCE * 3) { hopeless.add(dig.y * lv.w + dig.x); dig = null; }
    else if (!close.length && !hurt) { dig.turns++; C.tunnelInto(g, dig.x, dig.y); g.repeating = null; return; }
  }

  // 2. Whatever is in arm's reach. A thing it cannot afford to trade blows with is backed away
  //    from while backing away works; cornered, it reads its way out or fights after all.
  if (adjacent.length) {
    const easy = adjacent.filter(m => oneHit(g, m));
    const menace = adjacent.some(m => !worth(g, m));
    if (p.timed.afraid) {
      if (stepAway(g, close, goal)) return;
      const scroll = escapeScroll(g);
      if (scroll) { C.read(g, scroll, {}); return; }
      const away = fleeDir(g, dirOf(adjacent[0].x - p.x, adjacent[0].y - p.y));
      if (away) { C.moveDir(g, away); return; }
      // Cornered: too afraid to swing, nowhere to run. Shoot it if it can be seen, else cower and
      // let the fear wear off -- a turn has to pass for that.
      const shot = bestRanged(g, adjacent[0]);
      if (shot) { shot.go(); return; }
      C.passTurn(g); return;
    }
    if (menace || (fleeing && !easy.length)) {
      // Standing on a staircase with a thing like that beside it, the hero takes the stairs.
      if (here === T.STAIRS_DOWN && takeDown) { C.goDown(g); return; }
      if (here === T.STAIRS_UP && !g.options.ironman) { C.goUp(g); return; }
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

  // 3. The town: stock up, then find the way down.
  if (town) {
    const want = wantedStore(g);
    if (want >= 0) {
      const door = nearestTile(g, t => isShop(t) && t - T.SHOP_0 === want);
      if (door && headFor(g, door.x, door.y, false)) return;
      // A door it can see but not reach is not worth walking at; the shop is given up on.
      if (door) shopped.add(want);
      // The shop has not been found yet: no hero walks into the dungeon without potions.
      else if (explore(g, open)) return;
    }
    const stairs = nearestTile(g, t => t === T.STAIRS_DOWN);
    if (stairs) {
      if (stairs.x === p.x && stairs.y === p.y) { C.goDown(g); return; }
      if (headFor(g, stairs.x, stairs.y)) return;
    }
    if (explore(g, open)) return;
    C.passTurn(g);
    return;
  }

  // 4. Off this level, when it is finished, dull or dangerous -- but not on a sliver of health,
  //    unless something is chasing the hero down the stairs anyway.
  if (!staying && (!hurt || fleeing)) {
    if (here === T.STAIRS_DOWN && takeDown) { C.goDown(g); return; }
    if (here === T.STAIRS_UP && takeUp) { C.goUp(g); return; }
  }

  // 5. Shoot what is coming while it is still coming: every shot before it arrives is free, and
  //    the thing it could not face hand to hand may never arrive. A pack in the open is met at a
  //    corridor mouth instead, where they come one at a time. Not at breeders (a bottomless
  //    supply) and not when the hero should be leaving anyway.
  const pack = foes(g, 6);
  if (!fleeing && pack.length >= 2 && holdCorridor(g, pack)) return;
  const target = nearestTarget(g);
  if (target && !breedersSeen && !unseen && !swarm && (worth(g, target) || overmatched)) {
    const shot = bestRanged(g, target, hasMFlag(raceOf(target), 'NEVER_MOVE'));
    if (shot) { shot.go(); return; }
  }

  // 6. Housekeeping, only when nothing is breathing down the hero's neck.
  if (!close.length && !unseen) {
    if (C.newSpellCount(g) > 0 && C.study(g)) return;
    // A hero with one ring on and a bare finger should put the other one on, so ask for the slot
    // this kind would actually go into rather than the one it names.
    const gear = findItem(g, it => { const k = kindOf(it); return isWearable(k) && !isAmmo(k) && !!emptySlot(g, k); });
    if (gear) { C.wield(g, gear); return; }
    if (itemsAt(lv, p.x, p.y).length && C.pickupHere(g, false, false, it => junked.has(it.id))) return;
    if (shedForLoot(g)) return;
    const chest = itemsAt(lv, p.x, p.y).find(fi => kindOf(fi.item).tval === 'chest');
    if (chest) { C.openChest(g, chest); return; }
    // Whatever is still underfoot could not be taken and is not worth shedding for: remember that,
    // or the walk below would bring the bot straight back here.
    for (const fi of itemsAt(lv, p.x, p.y)) passed.add(fi.item.id);
    if (!awake.length && (hurt || p.csp < p.msp / 2)) { C.rest(g, -1); C.restStep(g); return; }
    // Loot the bot has seen and walked past: worth a detour while the level is still its business,
    // and a few steps even when it is on its way out.
    const loot = nearestLoot(g);
    if (loot && (staying || distance(p.x, p.y, loot.x, loot.y) <= 6)) {
      if (headFor(g, loot.x, loot.y)) return;
      passed.add(loot.item.id);
    }
    // A vein showing treasure is loot too, at the price of the digging.
    if (staying && treasure && goDig(g, treasure)) return;
    if (staying && step % 31 === 30) { C.searchAround(g); return; }
  }

  // 7. Move: on into the dark, through what blocks it, or off this level.
  if (exit && headFor(g, exit.x, exit.y)) return;
  if (!staying && down && headFor(g, down.x, down.y)) return;
  if (!staying && close.length && stepAway(g, close, goal)) return;
  // Rubble across the way on is cleared when that is quicker than walking round to the next unseen corner.
  if (rubble && (!open || rubble.steps + digTurns(g, T.RUBBLE) < openSteps) && goDig(g, rubble)) return;
  if (explore(g, open)) return;
  if (rubble && goDig(g, rubble)) return;
  if (down && headFor(g, down.x, down.y)) return;
  // Walled in: dig at the softest neighbour, or feel around for a secret door.
  if (step % 3 === 0) { C.searchAround(g); return; }
  let soft = 0, softTurns = 1e9;
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d];
    const t = tileAt(lv, x, y);
    if (!diggable(t) || hopeless.has(y * lv.w + x) || digTurns(g, t) >= softTurns) continue;
    soft = d; softTurns = digTurns(g, t);
  }
  if (soft) { startDig(g, p.x + DIR_DX[soft], p.y + DIR_DY[soft], true); return; }
  const up = nearestTile(g, t => t === T.STAIRS_UP);
  if (up && !g.options.ironman) {
    if (up.x === p.x && up.y === p.y) { C.goUp(g); return; }
    if (headFor(g, up.x, up.y)) return;
  }
  if (adjacent.length && attack(g, adjacent[0])) return;
  const ways: number[] = [];
  for (let d = 1; d <= 9; d++) if (d !== 5 && canEnter(g, p.x + DIR_DX[d], p.y + DIR_DY[d])) ways.push(d);
  if (ways.length) { C.moveDir(g, ways[randint0(ways.length)]); return; }
  C.passTurn(g);
}
