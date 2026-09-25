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
import { T, F, DIR_DX, DIR_DY, dirOf, isPassable, isShop, type BlowEffect, type Item, type FloorItem, type Monster, type ObjectKind, type Pos, type SlotName, type Effect, type SpellDef, type Timed } from './types.ts';
import { tileAt, flagAt, monsterAt, itemsAt, inBounds, projectPath } from './level.ts';
import { kindOf, isKnown, isAmmo, isWearable, wieldSlot, itemName, itemDice, itemFlags, canStack, getNextItemId, setNextItemId } from './items.ts';
import { isIgnored, itemQuality, alwaysPickUp } from './ignore.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { isSong } from './data/songs.ts';
import { maintainStore, storeBuy, storeSell, storeWants, buyPrice, sellPrice } from './stores.ts';
import { refreshBonuses } from './effectsCore.ts';
import { raceOf, hasMFlag, energyGain, monsterSpeed } from './monster.ts';
import { meleeSkill, bowSkill } from './player.ts';
import { castsFromHealth } from './quirks.ts';
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
/**
 * The way home, and the way back down. It is never sold, but it costs what a young hero's whole
 * quiver of cures costs, so it is only bought once the hero is going deep enough for the walk
 * home to be worth more than another potion -- by its own level, before it needs one.
 */
const RECALL = 'scroll_word_of_recall';
function shoppingList(g: Game): [string, number][] {
  const p = g.player;
  const books = wantedBooks(g);
  if (g.options.ironman || (depthFor(p.lev) <= RESTOCK_DEPTH && p.maxDepth <= RESTOCK_DEPTH)) return [...SHOPPING, ...books];
  return [...SHOPPING, [RECALL, 2], ...books];
}
/** At or above this depth it walks back up to town for potions; below it, it reads its way up. */
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
 * one that never will, which is target practice from two grids away. Never a breeder: there is
 * always another behind it, and each is a blow's work when it arrives, not an arrow's or a spell's.
 */
function nearestTarget(g: Game): Monster | null {
  const p = g.player;
  let best: Monster | null = null, bd = 1e9;
  for (const m of visibleMonsters(g)) {
    if (hasMFlag(raceOf(m), 'MULTIPLY')) continue;
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
/** A Word of Recall the hero could read now. Reading one while its word is already spoken cancels it. */
function recallScroll(g: Game): Item | null {
  const p = g.player;
  if (g.options.ironman || p.timed.recall || p.timed.blind || p.timed.confused) return null;
  return findItem(g, it => kindOf(it).tval === 'scroll' && known(g, it) && hasEffect(kindOf(it).effect, 'recall'));
}
/**
 * Whether resting would do anything at all. Below the weak mark the game cancels a rest the turn
 * it starts (commands.restStep), so a hungry hero that keeps asking to rest only burns the turn
 * over and over -- it starved on the first floor, at full gold, with the town up one staircase,
 * because resting came before walking and the rest never happened. Hungry, it should be moving.
 */
function canRest(g: Game): boolean { return g.player.food >= FOOD_WEAK; }
/** A proper meal; a hero getting weak from hunger will take a scrap of anything that is not a mushroom. */
function foodItem(g: Game): Item | null {
  const least = g.player.food < FOOD_WEAK ? 1 : 500;
  return findItem(g, it => { const k = kindOf(it); return k.tval === 'food' && (k.pval || 0) >= least && !k.id.startsWith('mushroom_'); });
}

// -----------------------------------------------------------------------------------------
// The rest of the kit: spells, staves, rods and the potions that are not cures for wounds. A
// caster that only ever throws its biggest bolt runs dry and dies with a Phase Door it never
// spoke, so this decides what the hero can pay for, what it holds back, and which trick answers
// whatever is standing over it.

/** Something the bot has decided to do, handed back so the caller can choose to spend the turn. */
type Act = () => void;
/**
 * What the hero may spend on a spell right now. A blood mage holds no mana at all and pays in
 * hit points, so its pool is its own life: a quarter of it for an attack, and down to the last
 * point when the spell is the thing that saves it.
 */
function spendable(g: Game, urgent = false): number {
  const p = g.player;
  if (!castsFromHealth(p)) return p.csp;
  if (urgent) return Math.max(0, p.chp - 1);
  return Math.max(0, Math.min(p.chp - Math.ceil(p.mhp * PANIC), Math.ceil(p.mhp / 4)));
}
/** Does this effect clear a condition the hero is under? */
function curesTimed(e: Effect | undefined, t: Timed): boolean {
  if (!e) return false;
  if (e.kind === 'seq') return e.effects.some(x => curesTimed(x, t));
  if (e.kind === 'heal' || e.kind === 'cure') return (e.cure || []).includes(t);
  return e.kind === 'timed' && e.effect === t && !!e.clear;
}
/**
 * The spells the hero could get off this turn, cheapest first. Blind and confused are filtered
 * here because cast() refuses both (a priest prays blind; nobody casts confused), so every
 * caller gets the same answer. Rebuilt only when something about the hero changes: sizing up a
 * fight asks for this list once per monster per turn.
 */
let books: { key: string; list: SpellDef[] } | null = null;
function spellbook(g: Game): SpellDef[] {
  const p = g.player;
  if (p.timed.confused) return [];
  if (p.timed.blind && CLASS_BY_ID[p.cls]?.realm !== 'prayer') return [];
  const key = `${p.cls}|${p.lev}|${p.learned.length}|${p.msp}|${C.knownBooks(g).map(b => b.kind).join()}`;
  if (books && books.key === key) return books.list;
  const list = C.spellsAvailable(g).filter(s => p.learned.includes(s.id) && !isSong(s.id))
    .sort((a, b) => C.spellMana(g, a) - C.spellMana(g, b));
  books = { key, list };
  return list;
}
/** The cheapest spell of a kind the hero knows, whether or not it can pay for it this turn. */
function cheapestSpell(g: Game, want: (s: SpellDef) => boolean): SpellDef | null {
  for (const s of spellbook(g)) if (want(s) && C.spellFail(g, s) < 50) return s;
  return null;
}
/** The cheapest spell of a kind the hero can pay for and expects to get off. */
function pickSpell(g: Game, want: (s: SpellDef) => boolean, budget: number, maxFail = 40): SpellDef | null {
  for (const s of spellbook(g)) if (want(s) && C.spellMana(g, s) <= budget && C.spellFail(g, s) < maxFail) return s;
  return null;
}
/**
 * Mana held back from attacking: the way out and the cure the hero will want when the fight
 * turns. A caster that empties its pool on the approach has nothing left by the time the thing
 * arrives, which is how most of them died. Never more than half the pool, and a blow that ends
 * the fight may always dip into it (see bestRanged).
 */
let keepMana = 0;
function reserveMana(g: Game): number {
  const p = g.player;
  if (castsFromHealth(p) || !p.msp) return 0;
  let n = 0;
  const out = cheapestSpell(g, s => hasEffect(s.effect, 'teleport'));
  if (out && !escapeScroll(g)) n += C.spellMana(g, out);
  const mend = cheapestSpell(g, s => hasEffect(s.effect, 'heal'));
  if (mend && !healingPotion(g)) n += C.spellMana(g, mend);
  return Math.min(n, Math.floor(p.msp / 2));
}
/** The conditions that stop a hero acting at all; a cure for one of these is worth a spell slot. */
const BLOCKERS: Timed[] = ['blind', 'confused', 'afraid', 'poisoned'];
/**
 * Which spell to learn next. The bot used to take whatever came first in the book, which is how
 * a druid's first prayer was Remove Hunger -- leaving a level-one druid with nothing to fight
 * with at all -- and how every mage spent its second pick on Detect Monsters, which the bot
 * never casts. Order them by what the bot actually does with a spell instead: something to kill
 * with, something to mend with, something to run with, then the tricks, then the cures.
 */
function studyChoice(g: Game): string | undefined {
  const p = g.player;
  const cands = C.spellsAvailable(g).filter(s => !p.learned.includes(s.id) && C.spellLevel(g, s) <= p.lev);
  if (!cands.length) return undefined;
  const rank = (s: SpellDef): number =>
    effectDamage(s.effect) > 0 || s.effect.kind === 'crush' ? 0
      : hasEffect(s.effect, 'heal') ? 1
      : hasEffect(s.effect, 'teleport') ? 2
      : DISABLE.includes(s.effect.kind) ? 3
      : CROWD.includes(s.effect.kind) ? 4
      : BLOCKERS.some(t => curesTimed(s.effect, t)) ? 5 : 6;
  // Cheapest first within a rank: a hero has to be able to pay for what it learns.
  return [...cands].sort((a, b) => rank(a) - rank(b) || C.spellMana(g, a) - C.spellMana(g, b))[0].id;
}
/** The store that sells the hero's own kind of book, or -1 for a hero with no realm. */
function bookStore(g: Game): number {
  const realm = CLASS_BY_ID[g.player.cls]?.realm;
  return !realm ? -1 : realm === 'prayer' || realm === 'nature' ? 3 : 5;
}
/**
 * The books the hero ought to be carrying. Its first one above all: fire and acid burn books, and
 * a caster that has lost its own casts nothing whatever -- the bot used to walk on with an empty
 * spell list and never think to buy another. Then the next book up, but only once it is owed a
 * spell and carries nothing that could teach it one.
 */
function wantedBooks(g: Game): [string, number][] {
  const p = g.player, realm = CLASS_BY_ID[p.cls]?.realm;
  if (!realm) return [];
  const owned = C.knownBooks(g).map(b => b.kind);
  if (!owned.length) return [[`${realm}_book_1`, 1]];
  if (C.newSpellCount(g) <= 0) return [];
  if (C.spellsAvailable(g).some(s => !p.learned.includes(s.id) && C.spellLevel(g, s) <= p.lev)) return [];
  for (const s of C.classSpells(g)) {
    if (p.learned.includes(s.id) || C.spellLevel(g, s) > p.lev || owned.includes(s.book)) continue;
    return [[s.book, 1]];
  }
  return [];
}

/** A staff, wand or rod the hero could use now: one it knows, with a charge left or its rod cooled. */
function readyDevice(g: Game, tval: 'staff' | 'rod' | 'wand', want: (k: ObjectKind) => boolean): Item | null {
  return findItem(g, it => {
    const k = kindOf(it);
    if (k.tval !== tval || !known(g, it) || !want(k)) return false;
    return tval === 'rod' ? it.timeout <= 0 : it.charges > 0;
  });
}
/** Using a staff, or zapping a rod at something; readyDevice has already ruled out a charging one. */
function deviceAct(g: Game, it: Item, target?: Pos): Act {
  return kindOf(it).tval === 'rod' ? () => C.zap(g, it, 5, target ?? null) : () => C.useStaff(g, it, {});
}
/** Fuel left in the light the hero is carrying, or Infinity for one that never burns down. */
function lightLeft(g: Game): number {
  const light = g.player.equip.light;
  if (!light) return 0;
  return itemFlags(light).has('NO_FUEL') ? Infinity : light.timeout;
}
/**
 * Putting the light back on. A torch that burns out is not a small thing: the hero cannot read
 * a scroll by it, which is its way out, and cannot see what is walking up to it either. A dead
 * torch is topped up from a spare rather than swapped, so the stub does not go back in the pack
 * to be wielded again next turn.
 */
function lightFix(g: Game): Act | null {
  const p = g.player, light = p.equip.light;
  const burning = (it: Item) => kindOf(it).tval === 'light' && (it.timeout > 0 || itemFlags(it).has('NO_FUEL'));
  if (!light) {
    const spare = findItem(g, burning);
    return spare ? () => C.wield(g, spare) : null;
  }
  if (itemFlags(light).has('NO_FUEL')) return null;
  const lk = kindOf(light);
  // A lantern in the pack is worth more than the torch in hand, whatever the torch has left.
  const lantern = findItem(g, it => kindOf(it).id === 'lantern' && burning(it));
  if (lantern && lk.id !== 'lantern') return () => C.wield(g, lantern);
  const fuel = lk.id === 'lantern' ? findItem(g, it => kindOf(it).tval === 'flask')
    : lk.id === 'torch' ? findItem(g, it => kindOf(it).id === 'torch' && it.timeout > 0) : null;
  return fuel ? () => C.refuel(g, fuel) : null;
}
/** Fuel below this and the bot tops up while it is quiet: the game warns at 100 and 50. */
const LIGHT_LOW = 500;

/** A potion the hero knows will clear a condition. */
function curePotion(g: Game, t: Timed): Item | null {
  return findItem(g, it => kindOf(it).tval === 'potion' && known(g, it) && curesTimed(kindOf(it).effect, t));
}
/**
 * Out of here: a scroll first, since paper is cheaper than the mana a caster still needs, then a
 * word, then a staff or rod -- which is also the only one of the three a blinded hero can use.
 */
function escapeAct(g: Game): Act | null {
  const scroll = escapeScroll(g);
  if (scroll) return () => C.read(g, scroll, {});
  const spell = pickSpell(g, s => hasEffect(s.effect, 'teleport'), spendable(g, true), 45);
  if (spell) return () => C.cast(g, spell, {});
  for (const tval of ['staff', 'rod'] as const) {
    const dev = readyDevice(g, tval, k => hasEffect(k.effect, 'teleport'));
    if (dev) return deviceAct(g, dev);
  }
  return null;
}
/** Hit points back: a potion, a prayer, or a staff of curing. */
function healAct(g: Game): Act | null {
  const potion = healingPotion(g);
  if (potion) return () => C.quaff(g, potion);
  const spell = healSpell(g);
  if (spell) return () => C.cast(g, spell, {});
  for (const tval of ['staff', 'rod'] as const) {
    const dev = readyDevice(g, tval, k => hasEffect(k.effect, 'heal'));
    if (dev) return deviceAct(g, dev);
  }
  return null;
}
/** Clear a condition: the cure the hero knows, the potion in its pack, or a staff. */
function cureAct(g: Game, t: Timed): Act | null {
  const spell = pickSpell(g, s => curesTimed(s.effect, t), spendable(g, true), 40);
  if (spell) return () => C.cast(g, spell, {});
  const potion = curePotion(g, t);
  if (potion) return () => C.quaff(g, potion);
  for (const tval of ['staff', 'rod'] as const) {
    const dev = readyDevice(g, tval, k => curesTimed(k.effect, t));
    if (dev) return deviceAct(g, dev);
  }
  return null;
}
/**
 * Taking one monster out of the fight, best trick first. This is what a hero with six hit points
 * has instead of a sword: the thing it cannot kill is sent away, put to sleep or frightened off.
 */
const DISABLE: Effect['kind'][] = ['teleport_other', 'sleep_monster', 'scare_monster', 'confuse_monster', 'slow_monster'];
function disableAct(g: Game, m: Monster): Act | null {
  const p = g.player, r = raceOf(m);
  if (!canReach(g, m)) return null;
  const target = { x: m.x, y: m.y };
  // Every trick but teleport is a contest against the monster's depth, and some things shrug one
  // off outright: a turn spent on a spell that cannot land is a turn the monster spends biting.
  const power = p.lev * 2 + 10;
  const lands = (kind: Effect['kind']): boolean => {
    if (kind === 'teleport_other') return true;
    if (r.depth >= power) return false;
    if (kind === 'sleep_monster') return !hasMFlag(r, 'NO_SLEEP') && !hasMFlag(r, 'UNIQUE');
    if (kind === 'scare_monster') return !hasMFlag(r, 'NO_FEAR');
    if (kind === 'confuse_monster') return !hasMFlag(r, 'NO_CONF');
    return !hasMFlag(r, 'UNIQUE');
  };
  for (const kind of DISABLE) {
    if (!lands(kind)) continue;
    const spell = pickSpell(g, s => s.effect.kind === kind, spendable(g, true), 45);
    if (spell) return () => C.cast(g, spell, { dir: 5, target });
    const rod = readyDevice(g, 'rod', k => k.effect?.kind === kind);
    if (rod) return () => C.zap(g, rod, 5, target);
    const wand = readyDevice(g, 'wand', k => k.effect?.kind === kind);
    if (wand) return () => C.aim(g, wand, 5, target);
  }
  return null;
}
/** The same for a room full of them: one word over the whole crowd. */
const CROWD: Effect['kind'][] = ['sleep_monsters', 'scare_monsters', 'confuse_monsters', 'slow_monsters'];
function crowdAct(g: Game): Act | null {
  for (const kind of CROWD) {
    const spell = pickSpell(g, s => s.effect.kind === kind, spendable(g, true), 45);
    if (spell) return () => C.cast(g, spell, {});
    const staff = readyDevice(g, 'staff', k => k.effect?.kind === kind);
    if (staff) return () => C.useStaff(g, staff, {});
  }
  return null;
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
interface Shot { dam: number; cost: number; go: () => void; }
/**
 * The best thing the hero can send at the monster from where it stands: a shot, a spell, a wand,
 * a rod or a flask. Everything is aimed at the monster's grid (direction 5 plus a target, as the
 * player's `t` does), never at a keypad direction, which only lines up on a row, column or
 * diagonal. `spare` leaves the flasks and charges in the pack, for a target that is only worth
 * what can be thrown at it for free.
 *
 * Between two things that would kill it, the cheaper wins. A mage that answers every kobold with
 * the biggest thing in the book is a mage with an empty pool when something worse turns up, so a
 * shot or a flask beats a spell that does the same job, and the small spell beats the big one.
 */
function bestRanged(g: Game, m: Monster, spare = false): Shot | null {
  const p = g.player, b = g.bonuses, r = raceOf(m);
  const dist = distance(p.x, p.y, m.x, m.y);
  if ((m.x === p.x && m.y === p.y) || !canReach(g, m)) return null;
  const dir = 5, target = { x: m.x, y: m.y };
  let best: Shot | null = null;
  // Half again the monster's hit points: what it takes for an average that runs through a to-hit
  // roll to be a kill the bot can count on, and so to be worth giving up a stronger attack for.
  const lethal = m.hp * 1.5;
  const better = (dam: number, cost: number): boolean => {
    if (!best) return true;
    const kills = dam >= lethal, was = best.dam >= lethal;
    if (kills !== was) return kills;
    return kills ? cost < best.cost : dam > best.dam;
  };
  const offer = (dam: number, cost: number, go: () => void) => { if (dam > 0 && better(dam, cost)) best = { dam, cost, go }; };
  const bow = p.equip.bow;
  if (bow && dist <= 6 + 2 * b.might) {
    const ammo = p.quiver.find(a => kindOf(a).tval === kindOf(bow).ammo);
    if (ammo) offer((avgDice(itemDice(ammo)) + ammo.toDam + bow.toDam) * b.might * Math.max(1, b.shots) * hitChance(bowSkill(p, b) + ammo.toHit * 3 - dist, r.ac), 0, () => C.fire(g, ammo, dir, target));
  }
  if (dist <= 18) {
    const purse = spendable(g), loose = Math.max(0, purse - keepMana);
    for (const s of spellbook(g)) {
      const cost = C.spellMana(g, s);
      if (cost > purse) continue;
      const fail = C.spellFail(g, s);
      if (fail >= 50) continue;
      // Crush either ends a small enough monster outright or does nothing at all.
      const raw = s.effect.kind === 'crush' ? (m.hp < p.lev * s.effect.mult ? m.hp : 0) : effectDamage(s.effect);
      const dam = raw * (1 - fail / 100);
      // The held-back mana is the way out: only a blow that ends the fight may dip into it.
      if (cost > loose && dam < lethal) continue;
      offer(dam, cost, () => C.cast(g, s, { dir, target }));
    }
    if (!spare && !p.timed.blind && !p.timed.confused) for (const it of p.inven) {
      const k = kindOf(it);
      if (!known(g, it)) continue;
      if (k.tval === 'wand' && it.charges > 0) offer(effectDamage(k.effect) * 0.8, 0, () => C.aim(g, it, dir, target));
      else if (k.tval === 'rod' && it.timeout <= 0) offer(effectDamage(k.effect) * 0.8, 0, () => C.zap(g, it, dir, target));
    }
  }
  if (!spare && dist <= 8 && !hasMFlag(r, 'IM_FIRE')) {
    const oil = findItem(g, it => kindOf(it).tval === 'flask');
    if (oil) offer(7 * hitChance(b.skills.throw + b.toHit * 3, r.ac), 0, () => C.throwItem(g, oil, dir, target));
  }
  return best;
}
/** Hit points the hero expects to lose killing the monster, or Infinity if it never would. */
function fightCost(g: Game, m: Monster, nextTo?: boolean): number {
  const dpt = Math.max(meleeOf(g, m), bestRanged(g, m)?.dam ?? 0);
  if (dpt <= 0) return Infinity;
  return Math.ceil(m.hp / dpt) * threatOf(g, m, nextTo);
}
/**
 * Hit points the hero stakes on taking the monster on: the whole fight, as fightCost has it. A
 * thing that never moves is another matter: the hero can step out of its reach whenever it
 * likes, rest, and come back, so only the next couple of exchanges are at stake. Held to the
 * whole-fight rule, a grey mold was more than a first-level warrior could spare, so it stood
 * across its corridor all level and the hero paced up to it and away.
 */
function stake(g: Game, m: Monster, nextTo?: boolean): number {
  if (!hasMFlag(raceOf(m), 'NEVER_MOVE')) return fightCost(g, m, nextTo);
  return Math.max(meleeOf(g, m), bestRanged(g, m)?.dam ?? 0) > 0 ? threatOf(g, m, nextTo) * 2 : Infinity;
}
/** Would the hero still have its margin left after that? */
function worth(g: Game, m: Monster, nextTo?: boolean): boolean { return stake(g, m, nextTo) <= g.player.chp - g.player.mhp * MARGIN; }
/** A paralysing touch the hero has no free action against: held still beside it, it is held again the moment it can move. */
function paralyses(g: Game, m: Monster): boolean {
  return !g.bonuses.flags.has('FREE_ACT') && raceOf(m).blows.some(bl => bl.effect === 'PARALYZE');
}
/**
 * Whether backing away from these gets the hero anywhere: they are slower than it, or never move
 * at all, or the stairs are a few steps off. From anything as quick it is a step back, a step
 * after it, and the same fight a grid further on -- six in ten of the bot's retreats used to end
 * with it fighting the thing it had backed away from all the same.
 */
function canBackOff(g: Game, from: Monster[], exit: Pos | null): boolean {
  const p = g.player;
  if (exit && distance(p.x, p.y, exit.x, exit.y) <= 5) return true;
  return from.every(m => hasMFlag(raceOf(m), 'NEVER_MOVE') || paceOf(g, m) < 1);
}
/**
 * Not worth a flask or a charge: a fight the hero's blade settles for a third of what it can
 * spare. The bot threw oil at white icky things, ran short, and walked back to town for more.
 */
function trifling(g: Game, m: Monster): boolean {
  const p = g.player, melee = meleeOf(g, m);
  return melee > 0 && Math.ceil(m.hp / melee) * threatOf(g, m, true) <= (p.chp - p.mhp * MARGIN) / 3;
}
/** Danger taken away per turn spent on the monster: what it does each turn over the turns to kill it. */
function relief(g: Game, m: Monster): number {
  const dpt = Math.max(meleeOf(g, m), bestRanged(g, m)?.dam ?? 0);
  return dpt > 0 ? threatOf(g, m) / Math.ceil(m.hp / dpt) : 0;
}
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
/**
 * A song worth striking up. The bot sings only with mana to spare, because a song spends mana for
 * as long as it runs: starting one on an empty pool buys a single turn of it and nothing more.
 */
function songToSing(g: Game): SpellDef | null {
  const p = g.player;
  if ((p.songs || []).length) return null;
  // A song spends from the pool every turn it runs, so a bard who pays in blood never starts one.
  if (castsFromHealth(p) || p.csp < p.msp * 0.5) return null;
  const usable = C.spellsAvailable(g).filter(s => p.learned.includes(s.id) && isSong(s.id) && C.spellMana(g, s) <= p.csp && C.spellFail(g, s) < 40);
  return usable.length ? usable[usable.length - 1] : null;
}
/** A healing spell the hero would trust its life to: known, affordable, and not a coin toss. */
function healSpell(g: Game): SpellDef | null {
  return pickSpell(g, s => hasEffect(s.effect, 'heal'), spendable(g, true), 35);
}

// -----------------------------------------------------------------------------------------
// Exploring, the way a player does it: pick a way and keep to it. The bot used to walk to
// whichever unseen grid was nearest, and in a dark room or at a junction the nearest one is
// behind the hero as often as in front of it, so it turned round every few steps and crossed the
// same floor again and again. Now it keeps a bearing -- the way it has been going -- and the
// frontier it set out for: a corridor is followed to its end and a room is crossed to its far
// door, and only when the way it is going runs out does it turn round for what it passed.

/**
 * Grids the hero should not set foot on this turn: every monster in view it cannot afford to
 * fight, and the eight grids round each, where that monster gets its blows in. The grey mold in
 * the corridor is walked round, or the corridor is given up, but it is never walked into.
 */
let hazard = new Set<number>();
/**
 * Grids next to a rooted thing the hero would fight but has no reason to brush past: a mold gets a
 * blow at anything that walks by. Walked round when there is room, and walked through (fighting it
 * on the way) when it is standing in the only corridor.
 */
let nuisance = new Set<number>();
/** The grids of those rooted things themselves: a way on may run through one, fighting it. */
let fightable = new Set<number>();
function markHazards(g: Game): void {
  hazard = new Set(); nuisance = new Set(); fightable = new Set();
  const lv = g.level, w = lv.w;
  const ring = (to: Set<number>, x: number, y: number) => { for (let d = 1; d <= 9; d++) to.add((y + DIR_DY[d]) * w + x + DIR_DX[d]); };
  // A rooted thing seen gone from its grid is dead: nothing else ever moves it.
  for (const i of [...rooted.keys()]) if ((lv.flags[i] & F.SEEN) && !seenMonsterAt(g, i % w, Math.floor(i / w))) rooted.delete(i);
  for (const m of visibleMonsters(g, 12)) {
    if (hasMFlag(raceOf(m), 'NEVER_MOVE')) { rooted.set(m.y * w + m.x, m); continue; }
    // A paralyser is given a wide berth asleep or awake: one touch and the hero stands there until it lets go.
    if (paralyses(g, m) || (m.sleep === 0 && !worth(g, m, true))) ring(hazard, m.x, m.y);
  }
  // The rooted ones, in view or not: a floating eye need never let go of a hero it has paralysed,
  // and one the hero cannot beat is never walked past; one it can is walked wide of when there is room.
  for (const m of rooted.values()) {
    if (paralyses(g, m) || !worth(g, m, true)) { ring(hazard, m.x, m.y); continue; }
    ring(nuisance, m.x, m.y);
    fightable.add(m.y * w + m.x);
  }
}
/**
 * The things that never move, by grid, kept after they drop out of sight. A mold in a dark
 * corridor is only seen from two grids away, and the bot, which forgot it the moment it was out
 * of view, chose one way while it could see the mold and the other while it could not: it stood
 * between the two, a step each way, for two thousand turns.
 */
let rooted = new Map<number, Monster>();

/** The way the hero has been exploring: its recent steps, averaged, so its length is how steady that way has been. */
let bearing = { x: 0, y: 0 };
/** Fold one step of exploring into the bearing: a few steps round a corner turn it, one sidestep does not. */
function steer(dx: number, dy: number): void {
  const len = Math.hypot(dx, dy);
  if (!len) return;
  bearing = { x: bearing.x * 0.65 + dx / len * 0.35, y: bearing.y * 0.65 + dy / len * 0.35 };
}
/** The frontier grid the hero set out for, held until it is reached, seen to be nothing, or cut off. */
let frontier: Pos | null = null;
/** The monster the hero is waiting for, and how far off it was: waiting only pays while it is coming. */
let awaiting: { id: number; d: number } | null = null;
/** Set when the travel path is a walk to the frontier: that is re-planned every step, not followed blind. */
let scouting = false;
/** What was left of that walk: kept while it still leads to the same frontier and nothing now stands on it. */
let route: Pos[] | null = null;
/** Set by explore(): this turn's step was one of exploring, so it counts toward the bearing. */
let exploring = false;
/** Steps a frontier straight behind the hero costs over one straight ahead: the price of turning round. */
const TURN_COST = 16;
/** Steps a frontier on the far side of the hero from the unseen part of the level costs. */
const PULL_COST = 6;
/** What each unseen grid round a frontier is worth, in steps, up to GAIN_CAP of them: an open end beats a missed corner. */
const GAIN_EACH = 0.5, GAIN_CAP = 12;
/** How much cheaper another frontier has to be before the hero gives up the one it set out for. */
const SWITCH = 6;
/** Steps the hero will add to a walk to keep out of a mold's reach, rather than fight its way past. */
const DETOUR = 8;
/** Unseen grids within two of (x, y): how much a walk there could show. */
function unseenNear(g: Game, x: number, y: number): number {
  const lv = g.level;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(lv, nx, ny) && !(flagAt(lv, nx, ny) & F.MARK) && !probed.has(ny * lv.w + nx)) n++;
  }
  return n;
}
/**
 * The way to the part of the level the hero has not seen, full strength while that is well off
 * to one side. This is what picks a direction on arrival -- a hero that comes down by the east
 * wall sets off west -- and which way to turn at a dead end.
 */
function unexplored(g: Game): { x: number; y: number } {
  const lv = g.level, p = g.player;
  let sx = 0, sy = 0, n = 0;
  for (let y = 1; y < lv.h - 1; y++) for (let x = 1; x < lv.w - 1; x++) if (!(lv.flags[y * lv.w + x] & F.MARK)) { sx += x; sy += y; n++; }
  if (!n) return { x: 0, y: 0 };
  const dx = sx / n - p.x, dy = sy / n - p.y, len = Math.hypot(dx, dy);
  if (len < 1) return { x: 0, y: 0 };
  const k = Math.min(1, len / 16) / len;
  return { x: dx * k, y: dy * k };
}
/** The way from the hero to a grid, at full strength. */
function toward(p: Pos, to: Pos): { x: number; y: number } {
  const dx = to.x - p.x, dy = to.y - p.y, len = Math.hypot(dx, dy);
  return len ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
}
/**
 * What walking to a frontier costs, in steps: the walk, turning away from the bearing, turning
 * away from the unseen part of the level, less what it could show.
 */
function frontierCost(g: Game, x: number, y: number, steps: number, pull: { x: number; y: number }): number {
  const p = g.player;
  const vx = x - p.x, vy = y - p.y, len = Math.hypot(vx, vy) || 1;
  const turn = (1 - (bearing.x * vx + bearing.y * vy) / len) / 2;
  const away = (1 - (pull.x * vx + pull.y * vy) / len) / 2;
  return steps + TURN_COST * turn + PULL_COST * away - GAIN_EACH * Math.min(GAIN_CAP, unseenNear(g, x, y));
}
/** A monster the hero knows is standing there. */
function seenMonsterAt(g: Game, x: number, y: number): Monster | null {
  const m = monsterAt(g.level, x, y);
  return m && (m.visible || m.detected) ? m : null;
}
/** A grid the hero has never seen, has not already walked into, and has nothing it fears standing over. */
function unknownAt(g: Game, x: number, y: number): boolean {
  if (!inBounds(g.level, x, y)) return false;
  const i = y * g.level.w + x;
  return !probed.has(i) && !hazard.has(i) && !(g.level.flags[i] & F.MARK);
}
function unknownNeighbour(g: Game, x: number, y: number): number {
  for (let d = 1; d <= 9; d++) if (d !== 5 && unknownAt(g, x + DIR_DX[d], y + DIR_DY[d])) return d;
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
 * One breadth-first walk over remembered, walkable grids: the frontier to explore next, the
 * nearest rubble with unseen ground behind it (a blocked corridor), and the nearest vein showing
 * treasure. A bare streamer leads nowhere but rock, so it is not counted. Grids a monster it
 * cannot beat is standing over are no way on, so the walk does not spread there.
 *
 * The frontier is the cheapest by frontierCost, and the one the hero is already walking to stays
 * chosen until another is cheaper by SWITCH: a nearer one turning up behind it as it walks is not
 * enough to turn it round, and two about as good as each other cannot take turns at being best.
 * A hero on its way out with the stairs in sight but no way to them yet is `lure`d their way.
 */
function survey(g: Game, lure: Pos | null = null): { open: Pos | null; openSteps: number; rubble: DigSite | null; treasure: DigSite | null } {
  const lv = g.level, p = g.player, w = lv.w;
  const seen = new Uint8Array(lv.w * lv.h);
  const qx: number[] = [p.x], qy: number[] = [p.y], qs: number[] = [0];
  seen[p.y * w + p.x] = 1;
  const pull = lure ? toward(p, lure) : unexplored(g);
  let open: Pos | null = null, openSteps = 0, openCost = Infinity, rubble: DigSite | null = null, treasure: DigSite | null = null;
  let kept: Pos | null = null, keptSteps = 0, keptCost = Infinity;
  for (let head = 0; head < qx.length; head++) {
    const x = qx[head], y = qy[head], steps = qs[head];
    if ((x !== p.x || y !== p.y) && unknownNeighbour(g, x, y)) {
      const cost = frontierCost(g, x, y, steps, pull);
      if (cost < openCost) { open = { x, y }; openSteps = steps; openCost = cost; }
      if (frontier && frontier.x === x && frontier.y === y) { kept = frontier; keptSteps = steps; keptCost = cost; }
    }
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
  if (kept && (steady || keptCost <= openCost + SWITCH)) { open = kept; openSteps = keptSteps; }
  frontier = open;
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
function pathAround(g: Game, x1: number, y1: number, avoid: Set<number> | null = null, through: Set<number> | null = null): Pos[] | null {
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
      if (!goal && (t === T.TRAP || hazard.has(i) || avoid?.has(i) || ((seenMonsterAt(g, nx, ny) || rooted.has(i)) && !through?.has(i)))) continue;
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
 * Walk toward a spot, round whatever is in the way, and wide of a mold's reach when there is room
 * to be. Without a remembered path to somewhere near it shoves one step that way instead -- but
 * only into ground it can actually enter, since bumping a permanent wall costs no turn and would
 * spin, and never toward something far off, since a shove that ends at a wall and a walk back to
 * try again is a loop.
 */
function headFor(g: Game, x: number, y: number, shove = true): boolean {
  const p = g.player;
  if (x === p.x && y === p.y) return false;
  // Wide of a mold when that costs a few steps; through it, fighting, when it is the way on. The
  // long way round a grey mold in a corridor took a warrior out of sight of it, where the short
  // way looked clear, and back into sight of it, where it did not.
  const wide = nuisance.size ? pathAround(g, x, y, nuisance) : null;
  const plain = pathAround(g, x, y, null, fightable);
  const path = wide && (!plain || wide.length <= plain.length + DETOUR) ? wide : plain;
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
/** The unseen grid beside the hero that lies most nearly the way it is going, or 0. */
function probeDir(g: Game): number {
  const p = g.player;
  let best = 0, bd = -Infinity;
  for (let d = 1; d <= 9; d++) {
    if (d === 5 || !unknownAt(g, p.x + DIR_DX[d], p.y + DIR_DY[d])) continue;
    const ahead = (DIR_DX[d] * bearing.x + DIR_DY[d] * bearing.y) / Math.hypot(DIR_DX[d], DIR_DY[d]);
    if (ahead > bd) { bd = ahead; best = d; }
  }
  return best;
}
/** Open ground the bot has not walked on yet, or a probe into the dark beside it. */
function explore(g: Game, open: Pos | null): boolean {
  const p = g.player;
  const d = probeDir(g);
  if (d) {
    const nx = p.x + DIR_DX[d], ny = p.y + DIR_DY[d];
    const t = tileAt(g.level, nx, ny);
    // Walking into unremembered rock only maps it (no turn passes), which is progress either way --
    // but the town's permanent walls are never remembered, so note the grid and never poke it twice.
    probed.add(ny * g.level.w + nx);
    C.moveDir(g, d);
    exploring = true;
    if (isPassable(t) || t === T.DOOR_CLOSED) return true;
    // Bumping rubble or a vein tunnels into it, which is a turn: whether to keep at it is decided next step.
    if (diggable(t)) { g.repeating = null; return true; }
  }
  if (!open) return false;
  const end = route && route[route.length - 1];
  if (end && end.x === open.x && end.y === open.y && clearRoute(g, route!)) { g.travel = route; C.travelStep(g); }
  else if (!headFor(g, open.x, open.y)) return false;
  scouting = exploring = true;
  return true;
}
/** A route still safe to walk: it starts beside the hero, and nothing it would step round now stands on it. */
function clearRoute(g: Game, path: Pos[]): boolean {
  const p = g.player, lv = g.level;
  if (Math.max(Math.abs(path[0].x - p.x), Math.abs(path[0].y - p.y)) !== 1) return false;
  return path.every(q => {
    const i = q.y * lv.w + q.x, t = tileAt(lv, q.x, q.y);
    return (isPassable(t) || t === T.DOOR_CLOSED) && t !== T.TRAP && !hazard.has(i) && !nuisance.has(i) && !rooted.has(i) && !seenMonsterAt(g, q.x, q.y);
  });
}
/**
 * Step onto the neighbouring grid that leaves the foes furthest behind, leaning toward `goal`.
 * False when there is no such grid, when the step would still leave something in reach (a
 * free hit for it), or when something next to the hero is faster than it can walk. `onward`
 * steps only where it is no further from the goal: a hero on its way to the stairs that backs
 * away from the worms between it and them has only to walk up to them again.
 */
function stepAway(g: Game, from: Monster[], goal: Pos | null, onward = false): boolean {
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
    if (onward && goal && distance(nx, ny, goal.x, goal.y) > distance(p.x, p.y, goal.x, goal.y)) continue;
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
  // The escapes, and the way home: a Word of Recall thrown away to make room for a rusty dagger
  // is a walk up a dozen staircases to buy the next one.
  if (k.tval === 'scroll' && known(g, it) && (hasEffect(k.effect, 'teleport') || hasEffect(k.effect, 'recall'))) return KEEP_KIT;
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

/**
 * Loot the bot is willing to part with: not its kit, not its own books, not gear it is using.
 * The walk to a shop and the selling itself ask the same question, so they ask it here.
 */
function wouldSell(g: Game, it: Item): boolean {
  const k = kindOf(it), p = g.player;
  if (k.tval === 'gold') return false;
  if (SHOPPING.some(w => w[0] === it.kind) || it.kind === RECALL || k.tval === 'food' || k.tval.endsWith('book')) return false;
  if (isWearable(k) && !p.equip[wieldSlot(k) || 'weapon']) return false;
  return true;
}
/** What a store would pay for everything in the pack the bot would hand over. */
function sellableAt(g: Game, type: number): number {
  const s = g.stores[type];
  if (!s) return 0;
  let n = 0;
  for (const it of g.player.inven) if (wouldSell(g, it) && storeWants(s, it)) n += sellPrice(g, s, it) * it.number;
  return n;
}
/** Gold in the pack worth crossing the town for; below this the walk costs more than it pays. */
const SELL_WORTH = 40;

/** Buy the supplies on the list, sell what the store wants and the bot will not use. */
export function autoShop(g: Game): void {
  const s = g.stores[g.inStore];
  const p = g.player;
  maintainStore(g, s);
  for (const it of [...p.inven]) {
    if (p.gold > 5000) break;
    if (!storeWants(s, it) || !wouldSell(g, it)) continue;
    if (sellPrice(g, s, it) <= 0) continue;
    const sold = C.removeFromInventory(g, it, it.number);
    storeSell(g, s, sold, sold.number);
    refreshBonuses(g);
  }
  for (const [kindId, want] of shoppingList(g)) {
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
/** Which store still sells something the bot is short of, or would buy what it is lugging about? */
function wantedStore(g: Game): number {
  const short = shoppingList(g).filter(([id, n]) => countKind(g, id) < n).map(w => w[0]);
  const bs = bookStore(g);
  // A caster with no book of its own is not a caster at all: that comes before food and cures.
  if (bs >= 0 && !shopped.has(bs) && !C.knownBooks(g).length && g.player.gold >= 30) return bs;
  if (short.length && g.player.gold >= 50) {
    if (!shopped.has(0) && short.some(id => id === 'ration' || id === 'flask_oil' || id === 'torch' || id === RECALL)) return 0;
    if (!shopped.has(4) && (short.includes('potion_clw') || short.includes('scroll_phase_door'))) return 4;
    if (bs >= 0 && !shopped.has(bs) && short.some(id => id.includes('_book_'))) return bs;
  }
  // Nothing to buy, or nothing it can afford yet. An armful of loot is gold the hero has not
  // picked up, and gold is what the next armful of cures is bought with -- so take it to whoever
  // pays the most for it. A visit sells first and buys with the proceeds, so one trip does both.
  let best = -1, bv = SELL_WORTH;
  for (let type = 0; type <= 5; type++) {
    if (shopped.has(type)) continue;
    const v = sellableAt(g, type);
    if (v > bv) { bv = v; best = type; }
  }
  return best;
}

// -----------------------------------------------------------------------------------------
// Patience, and where a hero of this level belongs

/**
 * The bot's memory of the level it is on: how long it has been here (a breeding pit or a level
 * whose last corner it cannot reach must not hold it for ever), the breeders it has met, and what
 * its hit points were a turn ago (something unseen may be chewing on it).
 */
let levelKey = '';
let stepsOnLevel = 0;
let lastHp = 0;
/** Every breeder the hero has laid eyes on here, by monster id: how many it has had to deal with. */
let breedersMet = new Set<number>();
/**
 * The breeders have got away from the hero: a crowd of them in view at once, or so many met that
 * killing them plainly is not keeping up. One mouse is a mouse -- the bot used to give a level up
 * the moment it saw a breeder, and a weak one is three hit points that die to a single blow --
 * but a floor that is filling up is not worth exploring, and once it is given up it stays given up.
 */
let infested = false;
/** Breeders in view at once, or met on the level, that make it infested. */
const SWARMING = 4, OVERRUN = 12;
/** Turns left of treating an attacker the hero cannot see as real. */
let unseen = 0;
/**
 * Turns left of knowing something is hunting the hero that it cannot kill. Phase Door buys a
 * dozen grids, not safety: a fast hunter like Grip is back within the minute, so the level has to
 * be left rather than explored around. Long enough to walk the length of a level to the stairs.
 */
let hunted = 0;
/**
 * Turns left of knowing the neighbourhood is more than the hero can take on: a crowd, or more
 * than it can afford close by. Worked out afresh each turn, a jackal stepping over the edge of
 * reach and back again had the hero turning to run and turning to fight on alternate turns.
 */
let beset = 0;
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
/**
 * The level is finished with: explored, looked round, or out of time. That does not change back.
 * The bot used to decide it afresh every turn, and anything that tipped it -- a monster stepping
 * out of view, a corridor opening up -- sent the hero back to exploring from the foot of the
 * stairs it had just walked to, and then back to the stairs.
 */
let done = false;
/**
 * The grids the hero last stood on. Two good reasons pulling opposite ways, each winning the
 * moment the hero steps toward the other -- loot one way and the frontier the other, with a
 * frightened jackal at the edge of reach deciding which -- and the hero steps back and forth for
 * the rest of the level. However it came about, it sees that it is doing it, and for a while it
 * stops listening to second thoughts: no turning back for loot or treasure, no backing off, no
 * stepping aside to meet something or to hold a corridor mouth, no better frontier -- just on.
 */
let trail: number[] = [];
let steady = 0;
/** Forget the level being explored: where the hero was going, and what it had seen there. */
function forgetLevel(): void {
  shopped = new Set(); probed = new Set(); passed = new Set(); junked = new Set(); dig = null; hopeless = new Set();
  rooted = new Map(); bearing = { x: 0, y: 0 }; frontier = null; scouting = false; route = null; awaiting = null; done = false;
  breedersMet = new Set(); infested = false; trail = []; steady = 0;
}
/** Forget the current level (a new hero, or a save loaded over this one). */
export function resetAutoplay(): void {
  levelKey = ''; stepsOnLevel = 0; lastHp = 0; unseen = 0; hunted = 0; beset = 0;
  forgetLevel(); hazard = new Set(); nuisance = new Set(); fightable = new Set(); idle = 0; books = null; keepMana = 0;
}
/** Bot turns spent on the level the hero is standing on. */
function levelAge(g: Game): number {
  const key = `${g.player.name}|${g.level.depth}|${g.stats.levelsVisited}`;
  if (key !== levelKey) {
    levelKey = key; stepsOnLevel = 0; lastHp = g.player.chp; unseen = 0; hunted = 0; beset = 0;
    forgetLevel();
  }
  return ++stepsOnLevel;
}
/**
 * Turns spent shopping before the town has had its share of the hero's life. Long enough to walk
 * an unmapped town and find both shops, which is the first thing any hero does.
 */
const TOWN_PATIENCE = 400;
/** A look round, but not a survey: a hundred-by-sixty level has corners not worth the turns. */
const LOOK_ROUND = 200;
const GIVE_UP = 500;
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
  exploring = false;
  decide(g, step);
  if (exploring && g.level.depth === depth) steer(p.x - x, p.y - y);
  if (g.level.depth === depth && (p.x !== x || p.y !== y)) {
    trail.push(p.y * g.level.w + p.x);
    if (trail.length > 6) trail.shift();
    const [a, b] = trail;
    if (trail.length === 6 && trail.every((t, i) => t === (i % 2 ? b : a))) { steady = 20; trail = []; }
  }
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
  if (steady) steady--;
  // What the hero will not spend on attacking, settled before anything sizes up a fight: every
  // estimate below (and bestRanged with it) is made on the mana the bot is actually willing to use.
  keepMana = reserveMana(g);
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
  const breeding = threats.filter(m => hasMFlag(raceOf(m), 'MULTIPLY'));
  for (const m of breeding) breedersMet.add(m.id);
  if (!town && (breeding.length >= SWARMING || breedersMet.size >= OVERRUN)) infested = true;
  // Something awake and mobile that the hero cannot kill: it will follow, and a level with one
  // on it is not explorable any more, whatever happens to be out of sight this turn.
  if (!town && awake.some(m => !hasMFlag(raceOf(m), 'NEVER_MOVE') && !worth(g, m, true))) hunted = 150;
  else if (hunted) hunted--;
  markHazards(g);

  // Finish what is already running, unless something turned up. A walk to the frontier is not
  // finished but re-planned: every step shows the hero something, and what it shows (loot, the
  // stairs it is looking for, the frontier turning out to be a corner) is worth acting on now.
  // The route itself is kept while it is still clear (see explore): planned afresh every step, a
  // way that depended on whether some monster happened to be in view flipped with it, and the
  // hero stepped back and forth between the two.
  if (g.resting) { if (awake.length || unseen) g.resting = 0; else { C.restStep(g); return; } }
  route = scouting ? g.travel : null;
  if (g.travel) { if (close.length || scouting) g.travel = null; else { C.travelStep(g); return; } }
  scouting = false;
  if (g.running) { if (awake.length) g.running = null; else { C.runStep(g); return; } }
  // The bot paces its own tunnelling (below); a repeat left over from the player is not its business.
  g.repeating = null;

  // What the neighbourhood would cost to clear, against what the hero can spare. The clock
  // ticks before the fighting does, or a breeding pit would hold the bot on one grid for ever.
  const budget = p.chp - p.mhp * MARGIN;
  const overmatched = close.length > 0 && close.reduce((s, m) => s + stake(g, m), 0) > budget;
  const swarm = awake.length > 4;
  if (!town && (overmatched || swarm)) beset = 20; else if (beset) beset--;
  // Fleeing means the level has stopped being worth fighting for: breeders out of hand, a crowd,
  // something it cannot beat, or something it cannot see. It heads for the stairs and hits only
  // what is in the way or would die in one blow.
  const spent = p.chp < p.mhp * MARGIN;
  const fleeing = !town && (infested || beset > 0 || spent || unseen > 0 || hunted > 0);
  // Which way out. Too deep for its level (a trap door, say), or out of potions with the town
  // close above, and it climbs; otherwise it dives only as far as its level warrants.
  const tooDeep = lv.depth > depthFor(p.lev);
  // The pack running dry, rather than the pack already empty. The bot used to notice only when
  // the last cure was gone, so it fought the back half of every trip on an empty pack with the
  // gold for a full one in its pocket -- and a hero with no light cannot even read its way out
  // of trouble. One of each is the mark: enough left to walk home on, not so little that the
  // walk is the dangerous part.
  const lowOnKit = countKind(g, 'potion_clw') <= 1 || !foodItem(g) || (lightLeft(g) <= 0 && !lightFix(g))
    || (countKind(g, 'scroll_phase_door') === 0 && countKind(g, 'flask_oil') <= 2);
  const bookless = !!CLASS_BY_ID[p.cls]?.realm && !C.knownBooks(g).length;
  const restock = (p.gold >= 60 && lowOnKit) || (bookless && p.gold >= 30);
  const needTown = lv.depth <= RESTOCK_DEPTH && restock;
  // A word already spoken is a trip home booked: no walking up the stairs as well.
  const wantUp = !town && !g.options.ironman && !p.timed.recall && (tooDeep || needTown);
  const mayDive = !wantUp && lv.depth + 1 <= depthFor(p.lev);
  const hurt = p.chp < p.mhp * HURT;
  // The stairs the bot knows about, and whether there is anything left to walk to. A hurt hero
  // on the run climbs, since a fresh level one floor up is gentler than one floor down; one in
  // good shape takes the nearest. Going deeper is fine in an emergency, and the only way on for
  // an ironman hero.
  const down = town ? null : nearestTile(g, t => t === T.STAIRS_DOWN);
  const upKnown = town || g.options.ironman ? null : nearestTile(g, t => t === T.STAIRS_UP);
  // On its way out with a staircase in sight but no known way to it, the search for one leans its way.
  const lure = town || !(done || fleeing || wantUp) ? null
    : exitStairs(g, mayDive || g.options.ironman || (fleeing && !wantUp), !g.options.ironman && (fleeing || wantUp || !mayDive));
  let { open, openSteps, rubble, treasure } = survey(g, lure);
  // Nothing left to reach: the level is finished, or something the hero will not walk past is
  // standing in the way. The grids it steps around are the likeliest reason -- on a crowded
  // floor, eight grids apiece for every monster it cannot beat wall the level off -- so look
  // again without them. Shut out with a staircase on the map, it leaves (shooting the thing on
  // its way if it can, see below); with none, it goes past after all, since a hero that cannot
  // reach new ground cannot find the way off either, and stands in the middle of the floor until
  // something kills it. A way on past a mold is worth more than a level it has shut itself out of.
  let blocked = false;
  if (!town && !open && !rubble && !treasure && hazard.size) {
    const avoided = hazard;
    hazard = new Set();
    const past = survey(g, lure);
    if (!(past.open || past.rubble || past.treasure)) hazard = avoided;
    else if (down || upKnown) { hazard = avoided; blocked = true; }
    else ({ open, openSteps, rubble, treasure } = past);
  }
  const more = open || rubble || treasure;
  // Explore while there is ground left to cover -- but once the way on is known, a look round is
  // enough; the last corner of the level is not worth the turns, and a swarm even less. The way
  // on is the staircase the hero would actually leave by: down while its level allows, else up.
  // A down staircase is no reason to stop looking for the up one, and it was the bot's undoing:
  // a hero finished with the first floor, too green for the second, walked to the down stairs it
  // knew, would not take them, went to look for the up stairs, and came back, for thousands of turns.
  const onward = town ? null : exitStairs(g, mayDive || g.options.ironman, !g.options.ironman && (wantUp || !mayDive));
  if (!town && ((!more && !blocked) || age >= GIVE_UP || (onward && age > LOOK_ROUND))) done = true;
  const staying = town || (!done && !blocked && !fleeing && !wantUp);
  let takeDown = mayDive || g.options.ironman || (fleeing && !wantUp);
  let takeUp = !g.options.ironman && (fleeing || wantUp || !mayDive);
  let exit = town || staying ? null : exitStairs(g, takeDown && !(fleeing && hurt && upKnown), takeUp);
  // Leaving, with no staircase of the kind it wants on the map: it goes on exploring until it
  // finds one. Only with nothing left to explore, or twice its patience spent, does it settle
  // for any staircase at all -- down and straight back up is a new level, which is what it wanted.
  if (!town && !staying && !exit && (!more || age >= GIVE_UP * 2)) {
    takeDown = true; takeUp = !g.options.ironman;
    exit = exitStairs(g, true, takeUp);
  }
  // Where backing away should lean: the way out if it has one, else whatever is left to look at.
  const goal: Pos | null = exit || open || rubble?.dig || treasure?.dig || null;

  // 1. Staying alive. A hero one or two more blows from death drinks before it is at PANIC.
  const incoming = adjacent.reduce((s, m) => s + threatOf(g, m), 0);
  const panic = p.chp < p.mhp * PANIC || (incoming > 0 && hurt && p.chp <= incoming * 2 + 2);
  if (panic) {
    const mend = healAct(g);
    // Whether drinking is worth the turn. A potion only gives back what the hero is missing --
    // one twenty points strong, drunk eight short of full, is eight points -- so against
    // something taking eight a turn it buys nothing at all and the hero has stood still for it.
    // Three cures poured into a full-ish hero while a dog chews on it is how the bot used to
    // die: what it needed was to not be standing there. Anything taking half the hero's maximum
    // in a turn outdrinks any potion whatever the headroom.
    const outdrunk = adjacent.length > 0 && (incoming * 2 >= p.mhp || incoming >= (p.mhp - p.chp) * 0.75);
    if (!outdrunk && mend) { mend(); return; }
    if (close.length || unseen) {
      // Stairs are the oldest escape in the game, and the bot stands on some often enough.
      if (here === T.STAIRS_DOWN) { C.goDown(g); return; }
      if (here === T.STAIRS_UP && !g.options.ironman) { C.goUp(g); return; }
      const out = escapeAct(g);
      if (out) { out(); return; }
      // Nothing left to run with: take the thing that is killing it out of the fight instead --
      // one word over the crowd when it is a crowd, or the worst of them sent away.
      const worst = adjacent.length ? adjacent.reduce((a, b) => threatOf(g, b) > threatOf(g, a) ? b : a) : null;
      const off = (close.length > 2 ? crowdAct(g) : null) || (worst ? disableAct(g, worst) : null);
      if (off) { off(); return; }
      if (stepAway(g, close, goal)) return;
      if (mend) { mend(); return; }
    } else if (awake.length) {
      // Something is coming, and there is no resting with it in view: put ground between them.
      if (stepAway(g, awake, goal)) return;
    } else if (hurt && canRest(g)) { C.rest(g, -1); C.restStep(g); return; }
  }
  // Blind or confused: a hero in either state cannot cast, cannot read its way out, and cannot
  // see what is coming. Neither wears off any faster for being walked around, so it is cured
  // before the meal, the dig and the fight.
  for (const t of ['blind', 'confused'] as const) {
    if (!p.timed[t]) continue;
    const fix = cureAct(g, t);
    if (fix) { fix(); return; }
  }
  // The light has gone out. Nothing else the hero might do this turn is worth as much as being
  // able to see, and scrolls cannot be read in the dark at all.
  if (lightLeft(g) <= 0) { const lit = lightFix(g); if (lit) { lit(); return; } }
  if (p.food < FOOD_HUNGRY) {
    const meal = foodItem(g);
    if (meal) { C.eat(g, meal); return; }
  }
  // Out of potions a dozen floors down, where the stairs home are a long walk through everything
  // the hero came past: speak the word instead and carry on until it takes hold.
  if (!town && lv.depth > RESTOCK_DEPTH && restock) {
    const scroll = recallScroll(g);
    if (scroll) { C.read(g, scroll, {}); return; }
  }
  // Hunted by something it cannot beat, and no staircase on the map to leave by. Walking is no
  // answer to a thing that is faster than the hero, and the scrolls only buy a dozen grids at a
  // time. Speak the word instead: it comes back to a level of its own depth that this thing is
  // not on, which is the whole point of going home.
  if (!town && hunted > 0 && !adjacent.length && !exitStairs(g, true, !g.options.ironman)) {
    const scroll = recallScroll(g);
    if (scroll) { C.read(g, scroll, {}); return; }
  }
  // A dig in progress: keep at it while nothing is coming, and give up on a grid that will not yield.
  if (dig) {
    const t = tileAt(lv, dig.x, dig.y);
    if (!diggable(t) || distance(p.x, p.y, dig.x, dig.y) > 1 || !(staying || dig.forced)) dig = null;
    else if (dig.turns >= DIG_PATIENCE * 3) { hopeless.add(dig.y * lv.w + dig.x); dig = null; }
    else if (!close.length && !hurt) { dig.turns++; C.tunnelInto(g, dig.x, dig.y); g.repeating = null; return; }
  }

  // A song, struck up once the hero has seen what is coming but before it is in trouble. Singing
  // costs a turn, so it goes after staying alive and before closing: a bard one blow from death
  // should be drinking, not starting a verse.
  if (close.length && !hurt) { const song = songToSing(g); if (song) { C.cast(g, song, {}); return; } }

  // 2. Whatever is in arm's reach. A thing it cannot afford to trade blows with is backed away
  //    from while backing away works; cornered, it reads its way out or fights after all.
  //    Overrun by breeders, it does not stop for the ones at its side -- there is always another,
  //    and a blackguard stood swatting fruit flies, one that would die to every blow, until they
  //    killed it -- but pushes on for the stairs, and swats the ones in its way (see step 7).
  const reach = infested ? adjacent.filter(m => !hasMFlag(raceOf(m), 'MULTIPLY')) : adjacent;
  if (reach.length) {
    const easy = reach.filter(m => oneHit(g, m));
    const menace = reach.some(m => !worth(g, m) || paralyses(g, m));
    if (p.timed.afraid) {
      if (stepAway(g, close, goal)) return;
      const out = escapeAct(g);
      if (out) { out(); return; }
      const cure = cureAct(g, 'afraid');
      if (cure) { cure(); return; }
      const away = fleeDir(g, dirOf(reach[0].x - p.x, reach[0].y - p.y));
      if (away) { C.moveDir(g, away); return; }
      // Cornered: too afraid to swing, nowhere to run. Shoot it if it can be seen, else cower and
      // let the fear wear off -- a turn has to pass for that.
      const shot = bestRanged(g, reach[0]);
      if (shot) { shot.go(); return; }
      C.passTurn(g); return;
    }
    if (menace || (fleeing && !easy.length)) {
      // Standing on a staircase with a thing like that beside it, the hero takes the stairs.
      if (here === T.STAIRS_DOWN && takeDown) { C.goDown(g); return; }
      if (here === T.STAIRS_UP && !g.options.ironman) { C.goUp(g); return; }
      // Send the thing it cannot beat away, or put it to sleep. That is a caster's answer to a
      // fight it would lose, and it beats a step back from something faster than the hero is.
      if (menace) {
        const bad = reach.find(mm => !worth(g, mm) || paralyses(g, mm));
        const off = bad ? disableAct(g, bad) : null;
        if (off) { off(); return; }
      }
      // Backing off, only when it gets the hero somewhere (canBackOff); from something as quick as
      // it, the fight comes to it anyway, and better here than cornered with less to fight it on.
      if (!steady && canBackOff(g, close, exit) && stepAway(g, close, goal)) return;
      if (menace) { const out = escapeAct(g); if (out) { out(); return; } }
    }
    // With something it cannot beat at its side, the blow goes where it takes the most danger
    // away: the hero that shot the fruit fly beside it because the fly would die was bitten to
    // death by Grip while it did.
    const pick = menace ? reach.reduce((a, b) => relief(g, b) > relief(g, a) ? b : a)
      : easy[0] || reach.reduce((a, b) => fightCost(g, b) < fightCost(g, a) ? b : a);
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
    // A shop it cannot find is not worth combing the town for while the dungeon waits.
    if (want >= 0 && age <= TOWN_PATIENCE) {
      const door = nearestTile(g, t => isShop(t) && t - T.SHOP_0 === want);
      if (door && headFor(g, door.x, door.y, false)) return;
      // A door it can see but not reach is not worth walking at; the shop is given up on.
      if (door) shopped.add(want);
      // The shop has not been found yet: no hero walks into the dungeon without potions.
      else if (explore(g, open)) return;
    }
    // Nothing more to buy, or nothing more it can reach. With what it came for in the pack and
    // floors below it has already cleared, read the word again and be dropped back where it left
    // off, rather than walking down through all of them.
    if (countKind(g, 'potion_clw') >= 2 && foodItem(g) && p.maxDepth > RESTOCK_DEPTH && p.maxDepth <= depthFor(p.lev)) {
      const scroll = recallScroll(g);
      if (scroll) { C.read(g, scroll, {}); return; }
    }
    // With the word spoken the stairs are the slow way down, and walking out now would only
    // strand the hero on the first floor when it takes hold.
    const stairs = p.timed.recall ? null : nearestTile(g, t => t === T.STAIRS_DOWN);
    if (stairs) {
      if (stairs.x === p.x && stairs.y === p.y) { C.goDown(g); return; }
      if (headFor(g, stairs.x, stairs.y)) return;
    }
    if (explore(g, open)) return;
    C.passTurn(g);
    return;
  }

  // 4. Off this level, when it is finished, dull or dangerous -- but not on a sliver of health,
  //    unless something is chasing the hero down the stairs anyway, or it is too hungry to rest.
  if (!staying && (!hurt || fleeing || !canRest(g)) && (age > 1 || awake.length)) {
    if (here === T.STAIRS_DOWN && takeDown) { C.goDown(g); return; }
    if (here === T.STAIRS_UP && takeUp) { C.goUp(g); return; }
  }

  // 5. Shoot what is coming while it is still coming: every shot before it arrives is free, and
  //    the thing it could not face hand to hand may never arrive. A pack in the open is met at a
  //    corridor mouth instead, where they come one at a time. Not at breeders (a bottomless
  //    supply, see nearestTarget) and not when the hero should be leaving anyway. Flasks and
  //    charges are kept for what is worth them: a thing that never moves is target practice for
  //    arrows and spells alone, unless it is standing between the hero and the rest of the level,
  //    and so is anything the hero's blade would settle cheaply.
  // A pack of worm masses is not met at a corridor mouth: nothing it can outwalk is.
  const pack = foes(g, 6).filter(m => paceOf(g, m) >= 1);
  if (!fleeing && !steady && pack.length >= 2 && holdCorridor(g, pack)) return;
  const target = nearestTarget(g);
  if (target && !infested && !unseen && !swarm && (worth(g, target) || overmatched)) {
    const shot = bestRanged(g, target, (hasMFlag(raceOf(target), 'NEVER_MOVE') && !blocked) || trifling(g, target));
    if (shot) { shot.go(); return; }
  }
  // Something awake that the hero cannot beat, coming for it. A trick takes it out of the fight
  // whatever its speed; and when it is as quick as the hero or quicker, walking away from it only
  // brings it along (or buys it free blows in the back), so while it is still crossing the room
  // the hero puts shots into it -- unless the stairs are a few steps off. A hunter like Grip
  // kills more of the bot's heroes than anything else in the dungeon, and a hero with a wand, a
  // flask or a bolt to its name is not helpless against one.
  if (target && !infested && !unseen && !swarm && !worth(g, target) && !hasMFlag(raceOf(target), 'NEVER_MOVE')) {
    const off = disableAct(g, target);
    if (off) { off(); return; }
    if (!canBackOff(g, [target], exit)) { const shot = bestRanged(g, target); if (shot) { shot.go(); return; } }
  }
  // A crowd it cannot meet at a corridor mouth: one word over the lot of them.
  if (swarm && close.length >= 3) { const off = crowdAct(g); if (off) { off(); return; } }

  // 6. Housekeeping, only when nothing is breathing down the hero's neck.
  if (!close.length && !unseen) {
    if (C.newSpellCount(g) > 0) { const learn = studyChoice(g); if (learn && C.study(g, learn)) return; }
    // A light growing faint is topped up now, not once it is out and something is coming.
    if (lightLeft(g) < LIGHT_LOW) { const lit = lightFix(g); if (lit) { lit(); return; } }
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
    if (!awake.length && canRest(g) && (hurt || p.csp < p.msp / 2)) { C.rest(g, -1); C.restStep(g); return; }
    // Loot the bot has seen and walked past: worth a detour while the level is still its business,
    // and a few steps even when it is on its way out -- but not with something hunting it.
    const loot = fleeing || steady ? null : nearestLoot(g);
    if (loot && (staying || distance(p.x, p.y, loot.x, loot.y) <= 6)) {
      if (headFor(g, loot.x, loot.y)) return;
      passed.add(loot.item.id);
    }
    // A vein showing treasure is loot too, at the price of the digging.
    if (staying && !steady && treasure && goDig(g, treasure)) return;
    if (staying && step % 31 === 30) { C.searchAround(g); return; }
  }

  // 7. Move. Something it means to fight is on its way: meet it. Wandering on to explore or to
  //    loot only drags it along behind, hands it the first blow, and turned the hero round every
  //    time the thing stepped in and out of reach -- off for the loot, back for the frontier. While
  //    it is coming the hero waits, and swings first; one that is not coming, or that fights from a
  //    distance, it goes to.
  const coming = staying && !steady ? close.find(m => !hasMFlag(raceOf(m), 'NEVER_MOVE') && !m.afraid && worth(g, m)) : undefined;
  if (coming) {
    const d = distance(p.x, p.y, coming.x, coming.y), nearing = awaiting?.id === coming.id && d < awaiting.d;
    awaiting = { id: coming.id, d };
    if (nearing && !raceOf(coming).spells?.length) { C.passTurn(g); return; }
    if (headFor(g, coming.x, coming.y)) return;
  } else awaiting = null;
  // On into the dark, through what blocks it, or off this level. Standing on the way out and not
  // taking it -- too hurt, with something in view that will not let it rest, or only just arrived
  // -- it waits there: a hero that wanders off to explore only walks back.
  if (exit && exit.x === p.x && exit.y === p.y) { C.passTurn(g); return; }
  // With no known way to the stairs, a shove toward them walked into a dead end, the frontier led
  // back out of it, and the next shove walked in again: while there is ground left to explore, the
  // way to them is found by exploring.
  if (exit && headFor(g, exit.x, exit.y, !more)) return;
  // On the way out, it backs off only from what it should not fight -- not from a snake it can
  // walk past, which it did a step at a time, each time the snake came in and out of view.
  if (!staying && !steady && (overmatched || close.some(m => !worth(g, m))) && canBackOff(g, close, exit) && stepAway(g, close, goal, true)) return;
  // Rubble across the way on is cleared when that is quicker than walking round to the next unseen corner.
  if (rubble && (!open || rubble.steps + digTurns(g, T.RUBBLE) < openSteps) && goDig(g, rubble)) return;
  if (explore(g, open)) return;
  if (rubble && goDig(g, rubble)) return;
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
