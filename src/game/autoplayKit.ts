// The autoplay bot's kit: what it carries, wears, drinks, reads, sells and buys. autoplay.ts
// decides when to fight, run, explore and go to town; this file answers the questions about
// things -- is this potion worth drinking blind, is that sword better than the one in hand, what
// is worth carrying home, what the hero needs from which shop -- with only what a player could
// know. An unknown flavour is judged by everything it might turn out to be, never by what it is,
// and an unidentified sword by its dice and the feel of it, never by its plusses.
//
// The bot used to be a magpie. It never drank a potion it had not bought (a found Cure Light
// Wounds is not "known" in the item's own sense, only its flavour is), never tried a flavour to
// learn it, wore whatever fitted an empty slot -- cursed gloves included -- and nothing that was
// merely better, and only went to a shop that owed it forty gold, so the pack filled with broken
// daggers, rags and unknown potions while the gold for the next set of cures stayed on the floor.
import { FOOD_FULL, FOOD_WEAK, INVEN_MAX, QUIVER_SLOTS } from '../constants.ts';
import { type Effect, type Item, type ObjectFlag, type ObjectKind, type Monster, type Player, type SlotName, type Store, type Timed, F, SLOTS, STATS, BOOK_TVALS, REALM_BOOK } from './types.ts';
import { OBJECTS, OBJECT_BY_ID } from './data/objects.ts';
import { MONSTERS } from './data/monsters.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { kindOf, isAware, isKnown, isWearable, isWeapon, isArmor, isAmmo, wieldSlot, itemDice, itemFlags, itemName, itemValue, canStack, getNextItemId, setNextItemId } from './items.ts';
import { computeBonuses, recomputeHp, recomputeMana, hasQuirk } from './player.ts';
import { needsItem, type EffectCtx } from './effects.ts';
import { raceOf, hasMFlag, energyGain } from './monster.ts';
import { hasFlag } from './level.ts';
import { toggleIgnoreKind } from './ignore.ts';
import { buyPrice, storeWants, storeBuy, storeSell, maintainStore } from './stores.ts';
import { refreshBonuses } from './effectsCore.ts';
import * as C from './commands.ts';
import type { Game } from './state.ts';

/** Something the bot has decided to do, handed back so the caller can choose to spend the turn. */
export type Act = () => void;

// -----------------------------------------------------------------------------------------
// Reading an effect

export function hasEffect(e: Effect | undefined, kind: Effect['kind']): boolean {
  if (!e) return false;
  if (e.kind === kind) return true;
  return e.kind === 'seq' && e.effects.some(s => hasEffect(s, kind));
}
/** Every step of an effect, through any sequence. */
function leaves(e: Effect | undefined): Effect[] { return !e ? [] : e.kind === 'seq' ? e.effects.flatMap(leaves) : [e]; }
/** Does this effect clear a condition the hero is under? */
export function curesTimed(e: Effect | undefined, t: Timed): boolean {
  if (!e) return false;
  if (e.kind === 'seq') return e.effects.some(x => curesTimed(x, t));
  if (e.kind === 'heal' || e.kind === 'cure') return (e.cure || []).includes(t);
  return e.kind === 'timed' && e.effect === t && !!e.clear;
}
/** Does this effect put the hero under a timed blessing of this kind? */
function grants(e: Effect | undefined, t: Timed): boolean { return leaves(e).some(l => l.kind === 'timed' && !l.clear && l.effect === t); }
export const avgDice = (d: [number, number] | undefined): number => d ? d[0] * (d[1] + 1) / 2 : 0;
/** The chance an attack of skill `chance` lands on armour `ac`, as testHit and the monster blows roll it. */
export function hitChance(chance: number, ac: number): number {
  if (chance <= 0) return 0.05;
  return 0.05 + 0.9 * Math.max(0, 1 - Math.floor(ac * 3 / 4) / chance);
}
/** The damage a bolt, ball or drain does on average; anything else is not an attack. */
export function effectDamage(e: Effect | undefined): number {
  if (!e) return 0;
  switch (e.kind) {
    case 'seq': return e.effects.reduce((s, x) => s + effectDamage(x), 0);
    case 'bolt': return avgDice(e.dice) + (e.base || 0);
    case 'ball': return e.dam + avgDice(e.dice);
    case 'breath': case 'burst': case 'drain_life': case 'vampiric': return e.dam;
    default: return 0;
  }
}
/** Hit points an effect gives back to a hero of `mhp` hit points. */
export function healOf(e: Effect | undefined, mhp: number): number {
  let n = 0;
  for (const l of leaves(e)) if (l.kind === 'heal') n += l.percent ? Math.max(l.amount, Math.floor(mhp * l.percent / 100)) : l.amount;
  return n;
}
/** The most hit points a single use could take off the hero. */
function hurtOf(e: Effect | undefined): number {
  let n = 0;
  for (const l of leaves(e)) if (l.kind === 'damage_self') n += l.dice[0] * l.dice[1];
  return n;
}

// -----------------------------------------------------------------------------------------
// What the hero carries, and what each thing is for

/**
 * Does the hero know what this is? A potion, scroll or device is known by its flavour once that
 * has been learnt -- the one drunk to learn it is no different from the next one found -- and a
 * piece of gear only once identified.
 */
export function known(g: Game, it: Item): boolean { return isWearable(kindOf(it)) ? isKnown(it, g.flavors) : isAware(g.flavors, it.kind); }
export function findItem(g: Game, pred: (it: Item) => boolean): Item | null {
  for (const it of g.player.inven) if (pred(it)) return it;
  return null;
}
export function countKind(g: Game, kindId: string): number {
  let n = 0;
  for (const it of [...g.player.inven, ...g.player.quiver]) if (it.kind === kindId) n += it.number;
  return n;
}
/** What the bot uses a thing for. Kinds it has learnt are filed by their effect; flavours it has not are 'unknown'. */
export type Role = 'heal' | 'cure' | 'escape' | 'recall' | 'food' | 'buff' | 'boon' | 'restore' | 'mana' | 'detect' | 'identify' | 'enchant'
  | 'uncurse' | 'recharge' | 'acquire' | 'attack' | 'control' | 'mass' | 'junk' | 'none' | 'unknown' | 'gear' | 'light' | 'ammo' | 'book' | 'fuel' | 'misc';
/** Effects nobody wants to be on the end of: the kinds that carry one are thrown away once learnt. */
const JUNK_EFFECTS: Effect['kind'][] = ['damage_self', 'lose_stat', 'lose_exp', 'aggravate', 'summon', 'curse', 'poison_self', 'darkness', 'create_traps', 'haste_monster', 'heal_monster', 'clone_monster', 'nothing'];
const HARMFUL_TIMED: Timed[] = ['blind', 'confused', 'poisoned', 'slow', 'paralyzed', 'afraid', 'image', 'stun', 'cut'];
/** The timed effects worth a turn in a fight. Infravision and the like are not. */
const FIGHT_TIMED: Timed[] = ['fast', 'hero', 'shero', 'blessed', 'protevil', 'shield', 'stoneskin', 'oppose_acid', 'oppose_elec', 'oppose_fire', 'oppose_cold', 'oppose_pois', 'oppose_conf', 'regen', 'bold', 'invuln'];
export const DISABLE_ONE: Effect['kind'][] = ['teleport_other', 'sleep_monster', 'scare_monster', 'confuse_monster', 'slow_monster'];
export const DISABLE_ALL: Effect['kind'][] = ['sleep_monsters', 'scare_monsters', 'confuse_monsters', 'slow_monsters'];
const roles = new Map<string, Role>();
function kindRole(k: ObjectKind): Role {
  let r = roles.get(k.id);
  if (!r) { r = fileKind(k); roles.set(k.id, r); }
  return r;
}
function fileKind(k: ObjectKind): Role {
  if (k.tval === 'food' && !k.flavored) return 'food';
  const ls = leaves(k.effect);
  if (!ls.length) return 'none';
  for (const l of ls) {
    if (JUNK_EFFECTS.includes(l.kind)) return 'junk';
    if (l.kind === 'nourish' && l.amount < 0) return 'junk';
    if (l.kind === 'timed' && !l.clear && HARMFUL_TIMED.includes(l.effect)) return 'junk';
  }
  const has = (kind: Effect['kind']) => ls.some(l => l.kind === kind);
  if (has('acquirement')) return 'acquire';
  if (has('gain_stat') || has('gain_exp')) return 'boon';
  if (has('identify')) return 'identify';
  if (has('teleport') || has('teleport_level')) return 'escape';
  if (has('recall')) return 'recall';
  if (has('enchant')) return 'enchant';
  if (has('remove_curse') || has('dispel_curse')) return 'uncurse';
  if (has('recharge')) return 'recharge';
  if (ls.some(l => l.kind === 'heal' && (l.amount >= 15 || (l.percent ?? 0) > 0)) && !has('timed')) return 'heal';
  if (has('restore_stat') || has('restore_exp')) return 'restore';
  if (has('mana')) return 'mana';
  if (ls.some(l => l.kind === 'timed' && !l.clear && FIGHT_TIMED.includes(l.effect))) return 'buff';
  if (has('heal') || has('cure') || ls.some(l => l.kind === 'timed' && l.clear)) return 'cure';
  if (has('nourish') || has('satisfy_hunger')) return 'food';
  if (has('map') || has('detect')) return 'detect';
  if (ls.some(l => effectDamage(l) > 0)) return 'attack';
  if (ls.some(l => DISABLE_ONE.includes(l.kind) || DISABLE_ALL.includes(l.kind))) return 'control';
  if (has('dispel') || has('banish') || has('mass_banish') || has('destruction')) return 'mass';
  return 'none';
}
export function roleOf(g: Game, it: Item): Role {
  const k = kindOf(it);
  if (isAmmo(k)) return 'ammo';
  if (k.tval === 'light') return 'light';
  if (isWearable(k)) return 'gear';
  if (BOOK_TVALS.includes(k.tval)) return 'book';
  if (k.tval === 'flask') return 'fuel';
  if (!k.flavored) return k.tval === 'food' ? 'food' : 'misc';
  if (!isAware(g.flavors, it.kind)) return 'unknown';
  return kindRole(k);
}
/** Is this a book of the hero's own realm? Another realm's is so much weight. */
export function ownBook(g: Game, k: ObjectKind): boolean {
  const realm = CLASS_BY_ID[g.player.cls]?.realm;
  return !!realm && k.tval === REALM_BOOK[realm];
}
/** A scroll can be read: eyes, wits and something to read it by. */
export function canRead(g: Game): boolean {
  const p = g.player;
  return !p.timed.blind && !p.timed.confused && (g.bonuses.lightRadius > 0 || hasFlag(g.level, p.x, p.y, F.GLOW));
}
/** Could the hero use this right now, as far as its own state goes: a staff with charges, a rod that has cooled, a device it can work. */
function ready(g: Game, it: Item): boolean {
  const k = kindOf(it);
  if (k.tval === 'scroll') return canRead(g);
  if (k.tval === 'staff' || k.tval === 'wand') return it.charges > 0 && !g.player.timed.confused && workable(g, it);
  if (k.tval === 'rod') return it.timeout <= 0 && !g.player.timed.confused && workable(g, it);
  return k.tval === 'potion' || k.tval === 'food';
}
/**
 * Whether the hero can expect to get a staff, wand or rod to work: a device too deep for its skill
 * fails, the turn is gone, and nothing has changed, so the bot would choose it again. A known kind
 * is judged by its fail chance, as a spell is, and a coin toss or worse is not worth the turn; an
 * unknown one by how the hero's tries with it have gone (see fumbles).
 */
export function workable(g: Game, it: Item): boolean {
  return known(g, it) ? C.deviceFail(g, it) < 50 : !beyond(g, it);
}
/**
 * Unknown devices the hero could not get to work, by kind: the tries in a row that came to
 * nothing, and its device skill when it made them. A failure teaches nothing -- the flavour is
 * neither learnt nor tried -- so a half-troll warrior with a Staff of Speed it could never work
 * stood on one grid trying it every turn, for as long as nothing came to interrupt it. A few
 * failures and the thing is left for a shopkeeper to name, or for the hero to grow into: once it
 * is better with devices, it tries again.
 */
const fumbles = new Map<string, { n: number; skill: number }>();
const FUMBLES = 3;
function beyond(g: Game, it: Item): boolean {
  const f = fumbles.get(it.kind);
  return !!f && f.n >= FUMBLES && g.bonuses.skills.device <= f.skill;
}
/** Try an unknown device, and count the try if it would not work. */
function trial(g: Game, it: Item, act: Act): Act {
  return () => {
    act();
    if (isAware(g.flavors, it.kind) || g.flavors.tried.includes(it.kind)) { fumbles.delete(it.kind); return; }
    const skill = g.bonuses.skills.device, f = fumbles.get(it.kind);
    fumbles.set(it.kind, { n: f && f.skill >= skill ? f.n + 1 : 1, skill });
  };
}
/** Use a consumable or device on the hero or the level: the one verb for each kind of thing. */
export function useAct(g: Game, it: Item, target?: Monster | null): Act {
  const k = kindOf(it);
  const at = target ? { x: target.x, y: target.y } : null;
  switch (k.tval) {
    case 'potion': return () => C.quaff(g, it);
    case 'food': return () => C.eat(g, it);
    case 'scroll': return () => C.read(g, it, { ...itemCtx(g, it), dir: 5, target: at });
    case 'staff': return () => C.useStaff(g, it, { ...itemCtx(g, it), dir: 5, target: at });
    case 'wand': return () => C.aim(g, it, 5, at);
    default: return () => C.zap(g, it, 5, at, itemCtx(g, it));
  }
}

// -----------------------------------------------------------------------------------------
// Learning flavours by use

/** The deepest kind of object the hero could plausibly be carrying: chests, vaults and lucky rolls run a little deep. */
function deepestFind(g: Game): number { return Math.max(g.player.maxDepth, g.level.depth) * 1.25 + 15; }
/**
 * The most an unlearnt flavour of this kind could hurt the hero, over everything it might be. A
 * Potion of Death drunk blind is the end of anyone, so once one could be lying about, no unknown
 * potion is drunk to find out: a shopkeeper names it instead.
 */
function worstUnknown(g: Game, tval: string): number {
  const deepest = deepestFind(g);
  let worst = 0;
  for (const k of OBJECTS) if (k.tval === tval && k.flavored && k.level <= deepest && !isAware(g.flavors, k.id)) worst = Math.max(worst, hurtOf(k.effect));
  return worst;
}
/**
 * Try an unknown potion, scroll, staff or rod to learn what it is, which is how a player learns
 * them. Only when the caller has found somewhere quiet, with the hero healthy enough to take the
 * worst the flavour could be, and never a flavour already tried for nothing: that one is for a
 * shopkeeper to name. A mushroom can take a point of strength for good, so mushrooms go to the
 * general store unlearnt; wands and aimed rods wait for something to point at (aimTestAct); a ring
 * waits for a Scroll of Identify, because the cursed ones do not come off. In the town only
 * potions are tried: a Scroll of Teleport Level read there drops the hero on the first floor
 * before it has shopped, and the shops name scrolls and staffs for nothing anyway.
 */
export function sampleAct(g: Game): Act | null {
  const p = g.player;
  if (p.timed.confused || p.timed.blind || p.timed.image || p.chp < p.mhp * 0.8) return null;
  const town = g.level.depth === 0;
  for (const it of p.inven) {
    const k = kindOf(it);
    if (!k.flavored || isAware(g.flavors, it.kind) || g.flavors.tried.includes(it.kind)) continue;
    if (k.tval !== 'potion' && (town || (k.tval !== 'scroll' && k.tval !== 'staff' && k.tval !== 'rod'))) continue;
    if (k.tval === 'staff' ? !workable(g, it) : !ready(g, it)) continue;
    if (p.chp <= worstUnknown(g, k.tval) + 5) continue;
    // Salt water empties the stomach: only with a meal in the pack to refill it.
    if (k.tval === 'potion' && p.food < FOOD_FULL && !mealItem(g, true)) continue;
    return k.tval === 'staff' || k.tval === 'rod' ? trial(g, it, useAct(g, it)) : useAct(g, it);
  }
  return null;
}
/** Point an unknown wand or rod at something, to learn what it does. The caller picks something weak and some way off. */
export function aimTestAct(g: Game, m: Monster): Act | null {
  const p = g.player;
  if (p.timed.confused || p.timed.blind) return null;
  for (const it of p.inven) {
    const k = kindOf(it);
    if ((k.tval !== 'wand' && k.tval !== 'rod') || isAware(g.flavors, it.kind) || g.flavors.tried.includes(it.kind)) continue;
    if ((k.tval === 'rod' && it.timeout > 0) || !workable(g, it)) continue;
    return trial(g, it, useAct(g, it, m));
  }
  return null;
}

// -----------------------------------------------------------------------------------------
// The object a scroll asks for

/**
 * What to answer when a scroll or staff asks for an object -- Identify, Enchant, Recharge -- as a
 * player answers the prompt the game puts up when it is read: the unknown thing most worth
 * knowing, the weapon in hand, the thinnest armour, the emptiest wand.
 */
export function itemCtx(g: Game, it: Item): EffectCtx {
  const e = kindOf(it).effect;
  const need = e ? needsItem(e) : null;
  if (!need) return {};
  const p = g.player;
  let chosen: Item | null = null;
  if (need === 'identify') chosen = identifyTarget(g);
  else if (need === 'enchant_weapon') chosen = p.equip.weapon || p.equip.bow;
  else if (need === 'enchant_armor') chosen = armourToEnchant(g);
  else if (need === 'recharge') chosen = rechargeTarget(g);
  else if (need === 'brand_ammo') chosen = p.quiver[0] || null;
  return chosen ? { chosen } : {};
}
/** The unknown thing most worth knowing: rings and amulets first, then gear that feels good, then devices, then the rest. */
export function identifyTarget(g: Game): Item | null {
  const p = g.player;
  let best: Item | null = null, bv = 0;
  for (const it of [...p.inven, ...SLOTS.map(s => p.equip[s]).filter((x): x is Item => !!x), ...p.quiver]) {
    if (known(g, it)) continue;
    const k = kindOf(it);
    let v = 0;
    if (k.tval === 'ring' || k.tval === 'amulet') v = isAware(g.flavors, it.kind) ? 6 : 10;
    // Not a cursed one: unnamed, a shop pays its kind's price for it; named, nothing at all.
    else if (isWearable(k)) v = it.sense === 'special' || it.sense === 'excellent' ? 9 : it.sense === 'good' ? 7 : it.sense === 'cursed' || it.sense === 'terrible' ? 0 : it.sense === 'average' ? 1 : 4;
    else if (k.tval === 'wand' || k.tval === 'staff' || k.tval === 'rod') v = isAware(g.flavors, it.kind) ? 1 : 5;
    else if (k.flavored) v = g.flavors.tried.includes(it.kind) ? 3 : 2;
    if (v > bv) { bv = v; best = it; }
  }
  return best;
}
const ARMOUR_SLOTS: SlotName[] = ['body', 'shield', 'helm', 'cloak', 'gloves', 'boots'];
/** The worn armour with the least magic on it, which is where an enchantment is likeliest to take. */
function armourToEnchant(g: Game): Item | null {
  let best: Item | null = null;
  for (const s of ARMOUR_SLOTS) { const it = g.player.equip[s]; if (it && !it.artifact && (!best || it.toAc < best.toAc)) best = it; }
  return best;
}
/** A wand or staff worth recharging: one the bot fights or escapes with, run dry. */
function rechargeTarget(g: Game): Item | null {
  return findItem(g, it => { const k = kindOf(it); return (k.tval === 'wand' || k.tval === 'staff') && known(g, it) && it.charges <= 1 && ['attack', 'control', 'escape', 'heal'].includes(kindRole(k)); });
}

// -----------------------------------------------------------------------------------------
// Quiet chores: the things worth a turn when nothing is coming

/** Is something the hero wears cursed (it knows: the curse announced itself when it went on)? */
function cursedWorn(g: Game): boolean { return SLOTS.some(s => g.player.equip[s]?.cursed); }
/** Does this effect put back something the hero has lost? */
function restoresLoss(g: Game, e: Effect | undefined): boolean {
  const p = g.player;
  for (const l of leaves(e)) {
    if (l.kind === 'restore_exp' && p.exp < p.maxExp) return true;
    if (l.kind === 'restore_stat' && (l.stat === 'all' ? STATS : [l.stat]).some(s => p.statCur[s] < p.statBase[s])) return true;
  }
  return false;
}
/**
 * Drink what makes the hero stronger, read what improves its gear or names its finds, put back what
 * it has lost. The bot carried Potions of Strength and Scrolls of Enchant Armour about unused; a
 * player drinks the one and reads the other the moment it is safe to.
 */
export function choreAct(g: Game): Act | null {
  const p = g.player;
  for (const it of p.inven) {
    if (!known(g, it) || !ready(g, it)) continue;
    const k = kindOf(it), role = kindRole(k);
    if (role === 'boon' || role === 'acquire') return useAct(g, it);
    if (role === 'restore' && restoresLoss(g, k.effect)) return useAct(g, it);
    if (role === 'uncurse' && cursedWorn(g)) return useAct(g, it);
    if (role === 'enchant' && (k.effect && needsItem(k.effect) === 'enchant_armor' ? armourToEnchant(g) : p.equip.weapon || p.equip.bow)) return useAct(g, it);
    if (role === 'identify' && identifyTarget(g)) return useAct(g, it);
    if (role === 'recharge' && rechargeTarget(g)) return useAct(g, it);
  }
  return null;
}
/** What a detection is worth on arrival: the stairs most, then the loot, then the traps. Monsters show up on their own. */
function detectWorth(e: Effect | undefined): number {
  let v = 0;
  for (const l of leaves(e)) {
    if (l.kind === 'map') v = Math.max(v, 3);
    if (l.kind === 'detect') for (const w of l.what) v = Math.max(v, w === 'stairs' || w === 'all' ? 3 : w === 'objects' || w === 'gold' || w === 'enchanted' ? 2 : w === 'traps' || w === 'doors' ? 1 : 0);
  }
  return v;
}
/**
 * On a new level, read the map: Magic Mapping and Door/Stair Location find the way on, which is
 * the thing the bot spends most of its turns looking for, and the detections find the loot. Each
 * kind once a level; the caller keeps `used`.
 */
export function detectAct(g: Game, used: Set<string>): Act | null {
  let best: Item | null = null, bv = 0;
  for (const it of g.player.inven) {
    if (used.has(it.kind) || !known(g, it) || kindRole(kindOf(it)) !== 'detect' || !ready(g, it)) continue;
    const v = detectWorth(kindOf(it).effect);
    if (v > bv) { bv = v; best = it; }
  }
  if (!best) return null;
  const it = best;
  used.add(it.kind);
  return useAct(g, it);
}
/**
 * Learnt to be worthless or worse -- Salt Water, Summon Undead, a Mushroom of Stupidity -- or gear
 * the hero will not wear and no shop would give a copper for (a broken dagger, a cursed sword once
 * it is named): thrown away. A kind that is never worth anything goes on the ignore list as a
 * player would put it there, so the walk over the next one does not pick it up again; gear is only
 * ever ignored there once it is known to be no better than average, so a magic one still gets a look.
 */
function junkItem(g: Game): Item | null {
  for (const it of g.player.inven) {
    const role = roleOf(g, it);
    if (it.artifact) continue;
    if (role === 'junk' || (role === 'gear' && itemValue(it, g.flavors, isKnown(it, g.flavors)) <= 0 && !wanted(g, it))) return it;
  }
  return null;
}
export function junkAct(g: Game, dropped?: (it: Item) => void): Act | null {
  const it = junkItem(g);
  if (!it) return null;
  return () => {
    if ((roleOf(g, it) === 'junk' || kindOf(it).cost <= 0) && !g.ignore.kinds.includes(it.kind)) toggleIgnoreKind(g, it.kind);
    dropped?.(it);
    C.dropItem(g, it, it.number);
  };
}
/** Roughly what the shops would pay for everything the hero means to sell: worth a trip home when the pack is full of it. */
export function haulValue(g: Game): number {
  let n = 0;
  for (const it of [...g.player.inven, ...g.player.quiver]) {
    const extra = surplus(g, it);
    if (extra > 0) n += Math.floor(itemValue(it, g.flavors, isKnown(it, g.flavors)) * extra / 1.6);
  }
  return n;
}

// -----------------------------------------------------------------------------------------
// In a fight

/** Hit-point cures the hero knows, and what each gives back. */
function healers(g: Game): { it: Item; amount: number; buff: boolean }[] {
  const p = g.player, out: { it: Item; amount: number; buff: boolean }[] = [];
  for (const it of p.inven) {
    const k = kindOf(it);
    if (k.tval !== 'potion' || !known(g, it)) continue;
    const role = kindRole(k), amount = healOf(k.effect, p.mhp);
    if (role === 'heal' || (role === 'buff' && amount >= 10)) out.push({ it, amount, buff: role !== 'heal' });
  }
  return out;
}
/** Known potions that mend wounds, the fighting draughts that heal a little not counted. */
export function healCount(g: Game): number { return healers(g).filter(h => !h.buff).reduce((n, h) => n + h.it.number, 0); }
/**
 * The potion to drink for wounds. With time to be choosy, the smallest that mends most of the
 * wound -- a Cure Light Wounds for a scratch, not the Potion of Healing; when it is that or death,
 * the strongest. A Potion of Heroism heals a little too, and is drunk for that only when nothing
 * meant for wounds is left. The bot used to take the first potion in the pack that healed at all,
 * which put Heroism ahead of Cure Serious Wounds.
 */
export function healPotion(g: Game, dire: boolean): { it: Item; amount: number } | null {
  const missing = g.player.mhp - g.player.chp;
  let best: { it: Item; amount: number } | null = null, bv = -Infinity;
  for (const h of healers(g)) {
    const v = (h.buff ? -10000 : 0) + (dire ? h.amount : h.amount >= missing * 0.7 ? 5000 - h.amount : h.amount);
    if (v > bv) { bv = v; best = h; }
  }
  return best;
}
/** Known escapes, nearest first by default; `far` wants the long jump, or off the level altogether. */
export function escapeItem(g: Game, far: boolean): Item | null {
  let best: Item | null = null, bv = -Infinity;
  for (const it of g.player.inven) {
    const k = kindOf(it);
    if (!known(g, it) || kindRole(k) !== 'escape' || !ready(g, it) || (k.tval !== 'scroll' && k.tval !== 'staff')) continue;
    let reach = 0;
    for (const l of leaves(k.effect)) reach = Math.max(reach, l.kind === 'teleport' ? l.range : l.kind === 'teleport_level' ? (g.level.depth > 0 ? 500 : -1) : 0);
    if (reach < 0) continue;
    // Phase Door unless it has to be far: paper is cheaper than a Teleportation the hero may want later.
    const v = far ? reach : -reach;
    if (v > bv) { bv = v; best = it; }
  }
  return best;
}
/**
 * A fighting draught or blessing worth the turn now. `melee` is a hero about to trade blows, for
 * whom Heroism and Berserk Strength are worth drinking; `desperate` is a fight it may not win,
 * which is what a Potion of Speed is kept for. Protection from Evil only against evil things no
 * deeper than the hero, which is all it turns, and a resistance only against something that
 * breathes or casts that element. `spell` offers the same from the hero's own book.
 */
export function buffAct(g: Game, foes: Monster[], opts: { melee: boolean; desperate: boolean; spell?: (t: Timed) => Act | null }): Act | null {
  const p = g.player;
  const breathes = (re: RegExp) => foes.some(m => (raceOf(m).spells || []).some(s => re.test(s)));
  const want = (t: Timed): boolean => {
    if (p.timed[t]) return false;
    switch (t) {
      case 'fast': return opts.desperate;
      case 'protevil': return foes.some(m => hasMFlag(raceOf(m), 'EVIL') && raceOf(m).depth <= p.lev);
      case 'shero': return opts.melee && !p.timed.hero;
      case 'hero': return opts.melee && !p.timed.shero;
      case 'blessed': case 'shield': case 'stoneskin': return true;
      case 'oppose_fire': return breathes(/FIRE|PLASMA/);
      case 'oppose_cold': return breathes(/COLD|ICE/);
      case 'oppose_pois': return breathes(/POIS/);
      case 'oppose_acid': return breathes(/ACID/);
      case 'oppose_elec': return breathes(/ELEC/);
      default: return false;
    }
  };
  const ORDER: Timed[] = ['fast', 'protevil', 'shield', 'stoneskin', 'shero', 'hero', 'blessed', 'oppose_fire', 'oppose_cold', 'oppose_pois', 'oppose_acid', 'oppose_elec'];
  for (const t of ORDER) {
    if (!want(t)) continue;
    const cast = opts.spell?.(t);
    if (cast) return cast;
    const it = findItem(g, i => known(g, i) && kindRole(kindOf(i)) === 'buff' && ready(g, i) && grants(kindOf(i).effect, t));
    if (it) return useAct(g, it);
  }
  return null;
}
/** A caster nearly out of mana in a fight drinks it back. */
export function manaAct(g: Game): Act | null {
  const p = g.player;
  if (!p.msp || p.csp >= p.msp * 0.25) return null;
  const it = findItem(g, i => known(g, i) && kindRole(kindOf(i)) === 'mana' && ready(g, i));
  return it ? useAct(g, it) : null;
}
/** One word over the crowd from a scroll or staff: Monster Confusion, Sleep Monsters. */
export function crowdItem(g: Game): Item | null {
  for (const kind of DISABLE_ALL) {
    const it = findItem(g, i => known(g, i) && ready(g, i) && (kindOf(i).tval === 'scroll' || kindOf(i).tval === 'staff') && kindOf(i).effect?.kind === kind);
    if (it) return it;
  }
  return null;
}
/**
 * The last resort, when there is no running and no fighting it: Banishment, Mass Banishment,
 * *Destruction*, or a dispel that bites the things doing the killing.
 */
export function massAct(g: Game, foes: Monster[]): Act | null {
  const evil = foes.some(m => hasMFlag(raceOf(m), 'EVIL')), undead = foes.some(m => hasMFlag(raceOf(m), 'UNDEAD'));
  for (const it of g.player.inven) {
    if (!known(g, it) || kindRole(kindOf(it)) !== 'mass' || !ready(g, it)) continue;
    for (const l of leaves(kindOf(it).effect)) {
      if (l.kind === 'mass_banish' || l.kind === 'banish') return useAct(g, it);
      if (l.kind === 'destruction' && g.level.depth > 0) return useAct(g, it);
      if (l.kind === 'dispel' && (l.what === 'all' || (l.what === 'evil' && evil) || (l.what === 'undead' && undead))) return useAct(g, it);
    }
  }
  return null;
}
/**
 * A meal: food proper, then the drinks and scrolls that fill a stomach. With `any` (a hero getting
 * weak from hunger) a scrap of anything that is not a mushroom will do.
 */
export function mealItem(g: Game, any = g.player.food < FOOD_WEAK): Item | null {
  const least = any ? 1 : 500;
  const food = findItem(g, it => { const k = kindOf(it); return k.tval === 'food' && (k.pval || 0) >= least && !k.id.startsWith('mushroom_'); });
  if (food) return food;
  return findItem(g, it => { const k = kindOf(it); return k.tval !== 'food' && known(g, it) && kindRole(k) === 'food' && ready(g, it); });
}

// -----------------------------------------------------------------------------------------
// Gear: what it is believed to be, and what it would do for the hero

const STAT_FLAGS: ObjectFlag[] = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR', 'STEALTH', 'SEARCH', 'INFRA'];
/** Gear stripped to its kind, for a worn thing the hero has no measure of yet. */
function plain(it: Item): Item {
  const k = kindOf(it);
  return { ...it, toHit: k.toHit ?? 0, toDam: k.toDam ?? 0, toAc: k.toAc ?? 0, pval: k.pval ?? 0, flags: [], ego: undefined, artifact: undefined, cursed: false };
}
/**
 * A piece of gear as the hero believes it to be, or null when there is nothing it could safely
 * believe. Identified, it is what it is. Until then the hero sees its kind -- a sword's dice, a
 * mail coat's base armour -- and, once carried a while, how it feels, which is turned into a guess
 * at its plusses. A ring or amulet of an unlearnt flavour is a mystery, and so is one of a kind
 * that can come cursed (a Ring of Strength may be -3): both wait for a Scroll of Identify. Anything
 * the hero knows or feels to be cursed is null too: it does not come off once on.
 */
export function believed(g: Game, it: Item): Item | null {
  const k = kindOf(it);
  if (isKnown(it, g.flavors)) return it.cursed ? null : it;
  if (k.flavored) {
    if (!isAware(g.flavors, it.kind)) return null;
    const fl = k.flags || [];
    if (fl.includes('CURSED') || fl.some(f => STAT_FLAGS.includes(f))) return null;
    return { ...plain(it), toAc: k.toAc ?? (k.id.endsWith('_protection') ? 9 : 0) };
  }
  const feel = it.sense;
  if (feel === 'cursed' || feel === 'terrible') return null;
  const bump = feel === 'special' ? 8 : feel === 'excellent' ? 5 : feel === 'good' ? 2 : 0;
  const base = plain(it), swing = isWeapon(k) || k.tval === 'bow';
  return { ...base, toHit: base.toHit + (swing ? bump : 0), toDam: base.toDam + (swing ? bump : 0), toAc: base.toAc + (isArmor(k) ? bump : 0) };
}
/** What the hero believes of what it is wearing: the real thing once known, else its kind and feel. */
function worn(g: Game, it: Item | null): Item | null { return !it ? null : isKnown(it, g.flavors) ? it : believed(g, it) ?? plain(it); }

/**
 * How long each unknown piece of gear has gone without the hero getting a feeling for it, in
 * chances to have had one. Pseudo-identification picks one unfelt piece every few turns, and a
 * cursed piece always feels cursed, so gear carried long enough without a word is very likely not
 * cursed -- which is how a player decides to try on the plain-looking helm. Three chances and the
 * odds of a hidden curse are one in twenty.
 */
const unfelt = new Map<number, number>();
let feltAt = -1;
function senseable(k: ObjectKind): boolean { return isWeapon(k) || isArmor(k) || k.tval === 'bow'; }
export function noteCarried(g: Game): void {
  const p = g.player;
  const turns = feltAt < 0 ? 0 : (g.turn - feltAt) / 10;
  feltAt = g.turn;
  if (turns <= 0 || turns > 2000) return;
  const cands = [...SLOTS.map(s => p.equip[s]), ...p.inven].filter((it): it is Item => !!it && !it.known && !it.sense && senseable(kindOf(it)));
  if (!cands.length) return;
  const every = p.cls === 'warrior' || p.cls === 'paladin' || p.cls === 'rogue' ? 8 : 20;
  for (const it of cands) unfelt.set(it.id, (unfelt.get(it.id) || 0) + turns / (every * cands.length));
}
/** Safe enough to put on: known, felt, or carried long enough to have felt cursed if it were. An empty slot asks less. */
function trusted(g: Game, it: Item, emptySlot: boolean): boolean {
  if (isKnown(it, g.flavors) || it.sense || !senseable(kindOf(it))) return true;
  return (unfelt.get(it.id) || 0) >= (emptySlot ? 1 : 3);
}
export function forgetCarried(): void { unfelt.clear(); feltAt = -1; fumbles.clear(); }

/** Monster armour about the depth the hero works: what a weapon has to get through. */
const typicalAcCache = new Map<number, number>();
function typicalAc(depth: number): number {
  const d = Math.max(1, Math.min(100, Math.round(depth)));
  let v = typicalAcCache.get(d);
  if (v === undefined) {
    let n = 0, s = 0;
    for (const r of MONSTERS) if (Math.abs(r.depth - d) <= 3 && !r.flags.includes('UNIQUE')) { s += r.ac; n++; }
    v = n ? s / n : 20 + d;
    typicalAcCache.set(d, v);
  }
  return v;
}
/** How much more a brand or slay makes a blow worth, across the monsters it will meet. */
function slayFactor(w: Item): number {
  const f = itemFlags(w);
  let m = (['BRAND_ACID', 'BRAND_ELEC', 'BRAND_FIRE', 'BRAND_COLD', 'BRAND_POIS'] as ObjectFlag[]).some(b => f.has(b)) ? 2.2 : 1;
  if (f.has('SLAY_EVIL')) m += 0.4;
  if (f.has('SLAY_ANIMAL')) m += 0.25;
  for (const s of ['SLAY_UNDEAD', 'SLAY_DEMON', 'SLAY_ORC', 'SLAY_TROLL', 'SLAY_GIANT', 'SLAY_DRAGON', 'KILL_DRAGON'] as ObjectFlag[]) if (f.has(s)) m += 0.12;
  if (f.has('VORPAL')) m += 0.3;
  return m;
}
/** What an ability is worth on top of the numbers, roughly as a fraction of the hero's whole strength. */
const FLAG_WORTH: Partial<Record<ObjectFlag, number>> = {
  FREE_ACT: 0.35, SEE_INVIS: 0.12, HOLD_LIFE: 0.12, TELEPATHY: 0.3, REGEN: 0.12, SLOW_DIGEST: 0.04, FEATHER: 0.03, LITE: 0.05,
  RES_ACID: 0.08, RES_ELEC: 0.08, RES_FIRE: 0.08, RES_COLD: 0.08, RES_POIS: 0.2, RES_FEAR: 0.06, RES_BLIND: 0.12, RES_CONF: 0.12,
  RES_LITE: 0.04, RES_DARK: 0.04, RES_SOUND: 0.05, RES_SHARDS: 0.05, RES_NETHER: 0.08, RES_NEXUS: 0.05, RES_CHAOS: 0.08, RES_DISEN: 0.08,
  IM_ACID: 0.25, IM_ELEC: 0.25, IM_FIRE: 0.25, IM_COLD: 0.25,
  SUST_STR: 0.02, SUST_INT: 0.02, SUST_WIS: 0.02, SUST_DEX: 0.02, SUST_CON: 0.02, SUST_CHR: 0.01,
  AGGRAVATE: -0.8, TELEPORT: -0.4, DRAIN_EXP: -0.4, DRAIN_HP: -0.3, DRAIN_MANA: -0.15, NO_TELEPORT: -0.1,
};
/**
 * The hero's best spell damage a turn, for a caster whose gear only decides how much it hits with
 * when the mana is gone. The same for every set of gear weighed in one turn, so worked out once.
 */
let punch = { key: '', value: 0 };
function spellPunch(g: Game): number {
  const p = g.player, key = `${g.turn}|${p.lev}|${p.learned.length}|${C.knownBooks(g).length}`;
  if (punch.key === key) return punch.value;
  let best = 0;
  for (const s of C.spellsAvailable(g)) {
    if (!p.learned.includes(s.id)) continue;
    const fail = C.spellFail(g, s);
    if (fail < 50) best = Math.max(best, effectDamage(s.effect) * (1 - fail / 100));
  }
  punch = { key, value: best };
  return best;
}
/**
 * How strong a set of gear makes the hero, on a log scale so that the parts multiply: what it
 * deals a turn (blade, bow or spell, the best of them and a little of the rest), how often a blow
 * of this depth gets through its armour, its speed, its hit points and mana as the gear's stats
 * would give them, its light, and the abilities and curses the gear carries. All of it from
 * computeBonuses, so weight, heavy weapons, blows and the class's own rules are counted as the
 * game counts them. `inven` is the pack as it would be, since what is carried slows the hero too.
 */
function loadoutScore(g: Game, equip: Record<SlotName, Item | null>, inven: Item[]): number {
  const p = g.player;
  const q: Player = { ...p, equip, inven };
  const b = computeBonuses(q);
  const depth = Math.max(1, p.maxDepth, g.level.depth);
  const ac = typicalAc(depth);
  const w = equip.weapon;
  const perBlow = w ? avgDice(itemDice(w)) * slayFactor(w) + w.toDam + b.toDam : (hasQuirk(p, 'bear_hands') ? 4.5 : 1) + b.toDam;
  const melee = b.blows * hitChance(b.skills.melee + (b.toHit + (w ? w.toHit : 0)) * 3, ac) * Math.max(0.5, perBlow);
  let ranged = 0;
  const bow = equip.bow;
  if (bow) {
    const want = kindOf(bow).ammo;
    const ammo = p.quiver.filter(a => kindOf(a).tval === want).sort((a, c) => avgDice(itemDice(c)) + c.toDam - avgDice(itemDice(a)) - a.toDam)[0];
    const per = (ammo ? avgDice(itemDice(ammo)) + ammo.toDam : 2.5) + bow.toDam;
    ranged = per * b.might * Math.max(1, b.shots) * hitChance(b.skills.bows + (b.toHit + bow.toHit) * 3, ac) * (ammo ? 1 : 0.6);
  }
  const spell = spellPunch(g);
  const top = Math.max(melee, ranged, spell);
  const offense = top + 0.3 * (melee + ranged + spell - top);
  const incoming = hitChance(60 + depth * 3, b.ac + b.toAc);
  const hp = { ...q } as Player;
  recomputeHp(hp, b);
  let score = Math.log(Math.max(0.5, offense)) - Math.log(Math.max(0.05, incoming)) + 1.2 * Math.log(energyGain(b.speed) / energyGain(0))
    + 0.8 * Math.log(Math.max(1, hp.mhp)) + 0.3 * Math.log(1 + b.lightRadius) + 0.02 * b.skills.stealth;
  const c = CLASS_BY_ID[p.cls];
  if (c.realm && p.msp > 0) {
    const mp = { ...q } as Player;
    recomputeMana(mp, b);
    score += 0.4 * Math.log((1 + mp.msp) / (1 + p.msp));
    // A glove spoils an arcane caster's aim as well as its mana.
    const gl = equip.gloves;
    if ((c.realm === 'magic' || c.realm === 'necro') && gl && !itemFlags(gl).has('FREE_ACT')) score -= 0.15;
  }
  for (const f of b.flags) score += FLAG_WORTH[f] ?? 0;
  return score;
}
function wornLoadout(g: Game): Record<SlotName, Item | null> {
  const eq = {} as Record<SlotName, Item | null>;
  for (const s of SLOTS) eq[s] = worn(g, g.player.equip[s]);
  return eq;
}
/** Below this a change of gear is not worth the turn, or the second thoughts. */
const UPGRADE = 0.02;
/**
 * Where a piece of gear would go and how much stronger it would make the hero there: either ring
 * finger, the slot its kind names otherwise. Null for what cannot go on (ammunition, a slot held
 * by something cursed), what the hero cannot judge yet, and lights that burn: the light code
 * tends those.
 */
export function gearGain(g: Game, it: Item, before?: number): { slot: SlotName; gain: number } | null {
  const p = g.player, k = kindOf(it);
  if (!isWearable(k) || isAmmo(k)) return null;
  if (k.tval === 'light' && !itemFlags(it).has('NO_FUEL')) return null;
  const mine = believed(g, it);
  if (!mine) return null;
  const now = wornLoadout(g);
  const rest = p.inven.filter(o => o !== it);
  const base = before ?? loadoutScore(g, now, p.inven);
  let best: { slot: SlotName; gain: number } | null = null;
  for (const slot of (wieldSlot(k) === 'ring1' ? ['ring1', 'ring2'] : [wieldSlot(k)!]) as SlotName[]) {
    const cur = p.equip[slot];
    if (cur?.cursed) continue;
    const gain = loadoutScore(g, { ...now, [slot]: mine }, cur ? [...rest, cur] : rest) - base;
    if (!best || gain > best.gain) best = { slot, gain };
  }
  return best;
}
/**
 * Put on the best upgrade in the pack, if there is one worth the turn: better by the hero's whole
 * measure, not just by the number on it, and safe to put on. A ring that is to replace the second
 * of two comes off first; wield() would take the first.
 */
export function gearAct(g: Game): Act | null {
  const p = g.player;
  const base = loadoutScore(g, wornLoadout(g), p.inven);
  let best: { it: Item; slot: SlotName; gain: number } | null = null;
  for (const it of p.inven) {
    const d = gearGain(g, it, base);
    if (!d || d.gain <= UPGRADE || (best && d.gain <= best.gain)) continue;
    if (!trusted(g, it, !p.equip[d.slot])) continue;
    best = { it, ...d };
  }
  if (!best) return null;
  const { it, slot } = best;
  if (slot === 'ring2' && p.equip.ring1 && p.equip.ring2) { const off = p.equip.ring2; return () => { C.takeOff(g, off); }; }
  return () => C.wield(g, it);
}
/** Is this unworn piece of gear one the bot means to put on, now or once it has a feel for it? */
function wanted(g: Game, it: Item): boolean {
  const d = gearGain(g, it);
  return !!d && d.gain > UPGRADE;
}

// -----------------------------------------------------------------------------------------
// Keeping and selling

/** The deepest a hero of this level should walk about on: Angband's rule of thumb, half the level and a bit. */
function depthFor(lev: number): number { return lev < 3 ? 1 : lev < 10 ? Math.floor(lev / 2) + 1 : lev - 4; }
/**
 * The deepest floor this hero should walk about on: the rule of thumb by level, but no deeper than
 * its hit points will carry it -- a ten-point priest is a first-floor priest whatever its level --
 * and the first floor for a hero with no weapon or no armour on, as after a death.
 */
export function homeDepth(g: Game): number {
  const p = g.player;
  const dressed = (!!p.equip.weapon || hasQuirk(p, 'bear_hands')) && !!p.equip.body;
  return dressed ? Math.max(1, Math.min(depthFor(p.lev), Math.floor(p.mhp / 10))) : 1;
}
/** At or above this depth the bot walks back up to town for potions; below it, it reads its way up. */
export const RESTOCK_DEPTH = 3;
/** The way home, and the way back down. */
const RECALL = 'scroll_word_of_recall';
/** Will the hero want Words of Recall: going deep enough for the walk home to be worth more than another potion. */
function wantsRecall(g: Game): boolean {
  return !g.options.ironman && (homeDepth(g) > RESTOCK_DEPTH || g.player.maxDepth > RESTOCK_DEPTH);
}
/** The ammunition the hero's launcher fires, or null. */
function ammoTval(g: Game): string | null { const bow = g.player.equip.bow; return bow ? kindOf(bow).ammo || null : null; }
/**
 * How many of this the hero means to keep; anything beyond is for a shopkeeper. Its kit, the
 * fighting draughts, the books of its own realm and the ammunition its launcher takes are kept;
 * gear it is not wearing and will not wear is sold, and so is anything learnt to be of no use. In
 * town an unknown flavour the hero could not learn by trying is sold too, which names it for good.
 */
export function keepCount(g: Game, it: Item): number {
  const k = kindOf(it), town = g.level.depth === 0;
  switch (roleOf(g, it)) {
    case 'book': return ownBook(g, k) ? 1 : 0;
    case 'food': return k.tval === 'food' ? ((k.pval || 0) >= 2000 ? 8 : 3) : 3;
    case 'heal': case 'escape': case 'boon': case 'acquire': case 'enchant': return 99;
    case 'recall': return g.options.ironman ? 0 : 3;
    case 'cure': case 'restore': case 'uncurse': case 'mass': return 3;
    case 'buff': case 'mana': case 'detect': case 'recharge': return 5;
    case 'identify': return 8;
    case 'attack': case 'control': return k.tval === 'scroll' ? 3 : 99;
    case 'unknown': return town && (g.flavors.tried.includes(it.kind) || k.tval !== 'potion') ? 0 : 99;
    case 'ammo': return k.tval === ammoTval(g) ? 99 : 0;
    case 'fuel': return 25;
    case 'light': {
      const lit = g.player.equip.light;
      if (lit && itemFlags(lit).has('NO_FUEL')) return 0;
      return k.id === 'torch' ? (lit && kindOf(lit).id === 'lantern' ? 1 : 5) : 1;
    }
    case 'gear': return wanted(g, it) || (!town && !isKnown(it, g.flavors) && !it.sense) ? 1 : 0;
    default: return 0;
  }
}
/** How many of this stack to part with: several stacks of one kind share the one allowance. */
export function surplus(g: Game, it: Item): number {
  const keep = keepCount(g, it);
  if (keep >= 99) return 0;
  let before = 0;
  for (const o of [...g.player.inven, ...g.player.quiver]) { if (o === it) break; if (o.kind === it.kind) before += o.number; }
  return Math.max(0, Math.min(it.number, before + it.number - keep));
}

// -----------------------------------------------------------------------------------------
// Shopping

/** The store that sells the hero's own kind of book, or -1 for a hero with no realm. */
export function bookStore(g: Game): number {
  const realm = CLASS_BY_ID[g.player.cls]?.realm;
  return !realm ? -1 : realm === 'prayer' || realm === 'nature' ? 3 : 5;
}
/**
 * The books the hero ought to be carrying: its first one above all (fire and acid burn books, and
 * death takes them), any book holding a spell it has learnt, and the next book up once it is owed
 * a spell and carries nothing that could teach it one.
 */
function wantedBooks(g: Game): string[] {
  const p = g.player, realm = CLASS_BY_ID[p.cls]?.realm;
  if (!realm) return [];
  const owned = C.knownBooks(g).map(b => b.kind);
  const out: string[] = [];
  if (!owned.length) out.push(`${REALM_BOOK[realm]}_1`);
  for (const s of C.classSpells(g)) if (p.learned.includes(s.id) && !owned.includes(s.book) && !out.includes(s.book)) out.push(s.book);
  if (C.newSpellCount(g) > 0 && !C.spellsAvailable(g).some(s => !p.learned.includes(s.id) && C.spellLevel(g, s) <= p.lev)) {
    for (const s of C.classSpells(g)) {
      if (p.learned.includes(s.id) || C.spellLevel(g, s) > p.lev || owned.includes(s.book) || out.includes(s.book)) continue;
      out.push(s.book);
      break;
    }
  }
  return out.filter(id => !!OBJECT_BY_ID[id]);
}
/** One thing the hero is short of, which stores might sell it, and roughly what it costs. */
export interface Need { kind?: string; slot?: SlotName | 'any'; count: number; est: number; stores: number[] }
const est = (kind: string): number => Math.ceil((OBJECT_BY_ID[kind]?.cost ?? 10) * 1.3) + 1;
/** Does the hero have a light that is burning, or a spare it could light? */
function lit(g: Game): boolean {
  const burning = (it: Item | null) => !!it && kindOf(it).tval === 'light' && (it.timeout > 0 || itemFlags(it).has('NO_FUEL'));
  return burning(g.player.equip.light) || g.player.inven.some(burning);
}
/**
 * Everything the hero should leave town with, most urgent first. A light, a meal, a weapon and a
 * cure before anything else: a hero who has just woken naked in the town with a few hundred gold
 * spends it on a torch and a sword before a fifteenth flask of oil. Then armour, escapes, books,
 * ammunition, the rest of the kit, the way home, scrolls to name its finds, and last whatever the
 * armoury and the weaponsmith have that beats what it wears. Each need carries the shops that sell
 * it; a shopper keeps back the price of every need above the one it is buying for.
 */
export function shoppingNeeds(g: Game): Need[] {
  const p = g.player, out: Need[] = [];
  // What earlier lines have already asked for, so the second "up to six" does not ask again for the first three.
  const planned = new Map<string, number>();
  const kit = (kind: string, want: number, stores: number[], have = countKind(g, kind)) => {
    const n = want - have - (planned.get(kind) || 0);
    if (n <= 0) return;
    out.push({ kind, count: n, est: est(kind), stores });
    planned.set(kind, (planned.get(kind) || 0) + n);
  };
  if (!lit(g)) kit('torch', 1, [0]);
  const meals = p.inven.reduce((n, it) => n + (kindOf(it).tval === 'food' && (kindOf(it).pval || 0) >= 2000 ? it.number : 0), 0);
  // A full stomach (a hero just woken in the town has one) needs one meal in the pack, not three.
  kit('ration', p.food >= 6000 ? 1 : 3, [0], meals);
  // The first book is the caster's weapon when its spells are what it kills with -- a mage's Magic
  // Missile -- and it comes before the sword. A priest's first prayers (Bless, Call Light) are not:
  // a hero woken naked with thirty gold buys the mace first.
  const books = wantedBooks(g), bs = bookStore(g);
  const bookless = books.length > 0 && !C.knownBooks(g).length;
  const fightsWithSpells = C.classSpells(g).some(s => p.learned.includes(s.id) && effectDamage(s.effect) > 0);
  if (bookless && fightsWithSpells) kit(books[0], 1, [bs]);
  if (!p.equip.weapon && !hasQuirk(p, 'bear_hands')) out.push({ slot: 'weapon', count: 1, est: 15, stores: [2, 3] });
  if (bookless && !fightsWithSpells) kit(books[0], 1, [bs]);
  kit('potion_clw', 2, [4, 0, 3], healCount(g));
  // A flask of oil is two dice of fire for the price of a ration: the cheapest weapon in the game,
  // and the one a hero woke naked can afford.
  kit('flask_oil', 5, [0]);
  if (!p.equip.body) out.push({ slot: 'body', count: 1, est: 22, stores: [1] });
  kit('scroll_phase_door', 2, [4], countKind(g, 'scroll_phase_door'));
  // Death keeps the purse and nothing else, so the purse is not emptied on what the next death
  // would take: past the essentials, enough is kept back to buy them all again.
  out.push({ count: 1, est: respawnFund(g), stores: [] });
  for (const b of books) if (!planned.has(b)) kit(b, 1, [bs]);
  const ammo = ammoTval(g);
  if (ammo) {
    const have = p.quiver.reduce((n, a) => n + (kindOf(a).tval === ammo ? a.number : 0), 0);
    kit(ammo === 'shot' ? 'iron_shot' : ammo, 40, [0, 2], have);
  }
  kit('potion_clw', 6, [4, 0, 3], healCount(g));
  kit('scroll_phase_door', 5, [4]);
  kit('ration', 5, [0], meals);
  if (lit(g) && kindOf(p.equip.light || p.inven.find(i => kindOf(i).tval === 'light')!).id === 'lantern') kit('flask_oil', 15, [0]);
  else { kit('torch', 3, [0]); kit('flask_oil', 10, [0]); }
  if (wantsRecall(g)) kit(RECALL, 2, [4, 0]);
  if (cursedWorn(g)) kit('scroll_remove_curse', 1, [3, 4]);
  // Identify is for rings, amulets and gear that feels good, not for every unknown potion.
  const named = identifyTarget(g);
  if ((named && isWearable(kindOf(named))) || p.gold > 1500) kit('scroll_identify', 2, [4]);
  if (p.lev >= 10) kit('potion_csw', 4, [4]);
  out.push({ slot: 'any', count: 1, est: 0, stores: [1, 2, 0] });
  return out;
}
/** Gold to keep back for buying the essentials again after a death: more as the hero's kit grows dearer. */
function respawnFund(g: Game): number { return 120 + 15 * g.player.lev; }
/**
 * The gold a need keeps back from the needs below it: its price, or as much of it as `spare` could
 * pay this trip. A need the purse cannot meet at all holds nothing back -- a hero woken naked with
 * twelve gold cannot buy the mace, and keeping its price back left it unable to buy the flasks of oil
 * it could afford instead. The respawn fund (no shops) is always kept.
 */
function held(n: Need, spare: number): number {
  if (!n.stores.length) return n.est * n.count;
  return Math.max(0, Math.min(n.count, Math.floor(spare / Math.max(1, n.est)))) * n.est;
}
/** The gold to keep back from a gear upgrade, for the next trip's cures. */
const CUSHION = 40;
/**
 * Which stores are worth the walk: those selling something the hero needs and can afford once
 * everything more urgent is paid for, and every one that buys something it is carrying for sale --
 * whatever that would fetch, since a pack full of rags is the reason the next ring is left on the
 * floor. The armoury and the weaponsmith are a look round for an upgrade only with gold to spare.
 */
export function storesWorthVisiting(g: Game): Set<number> {
  const p = g.player, out = new Set<number>();
  let reserve = 0;
  for (const n of shoppingNeeds(g)) {
    const spare = p.gold - reserve;
    if (n.slot === 'any' ? spare >= 120 + CUSHION : spare >= n.est) for (const s of n.stores) out.add(s);
    reserve += held(n, spare);
  }
  const forSale = [...p.inven, ...p.quiver].filter(it => surplus(g, it) > 0);
  for (let type = 0; type <= 5; type++) if (g.stores[type] && forSale.some(it => storeWants(g.stores[type], it))) out.add(type);
  return out;
}
/** Room in the pack (or the quiver) for this. */
function fits(g: Game, it: Item): boolean {
  const p = g.player;
  if (isAmmo(kindOf(it))) return p.quiver.some(q => canStack(q, it, g.flavors)) || p.quiver.length < QUIVER_SLOTS;
  return p.inven.some(o => canStack(o, it, g.flavors)) || p.inven.length < INVEN_MAX;
}
/** Buy `n` of a stock item; null when the pack has no room or the purse no gold. */
function purchase(g: Game, s: Store, stock: Item, n: number): Item | null {
  const p = g.player, price = buyPrice(g, s, stock) * n;
  if (price > p.gold || !fits(g, stock)) return null;
  const bought = storeBuy(g, s, stock, n);
  if (!bought) return null;
  bought.id = getNextItemId(); setNextItemId(bought.id + 1);
  if (!C.addToInventory(g, bought)) return null;
  g.msg.add(`You bought ${itemName(bought, g.flavors)} for ${price} gold.`, '#ffd040');
  return bought;
}
/** Hand over everything here this shop will take and the hero does not want, whatever it fetches. */
function sellPass(g: Game, s: Store): void {
  for (const it of [...g.player.inven, ...g.player.quiver]) {
    if (!storeWants(s, it)) continue;
    const n = surplus(g, it);
    if (n <= 0) continue;
    const name = itemName({ ...it, number: n }, g.flavors);
    const sold = C.removeFromInventory(g, it, n);
    const price = storeSell(g, s, sold, sold.number);
    g.msg.add(price > 0 ? `You sold ${name} for ${price} gold.` : `You leave ${name} with the shopkeeper.`, '#ffd040');
  }
}
/**
 * The best thing in this shop's stock to wear in `slot` (or anywhere, for 'any') that the hero
 * can pay for out of `budget`: the biggest gain, and of two about as good the cheaper.
 */
function bestGearBuy(g: Game, s: Store, slot: SlotName | 'any', budget: number, least: number): Item | null {
  const base = loadoutScore(g, wornLoadout(g), g.player.inven);
  let best: Item | null = null, bv = least;
  for (const it of s.stock) {
    const k = kindOf(it);
    if (!isWearable(k) || isAmmo(k) || it.cursed) continue;
    if (slot !== 'any' && wieldSlot(k) !== slot) continue;
    const price = buyPrice(g, s, it);
    if (price > budget) continue;
    const d = gearGain(g, it, base);
    if (!d) continue;
    const v = d.gain - price / 100000;
    if (v > bv) { bv = v; best = it; }
  }
  return best;
}
/**
 * One visit to a shop: sell what it takes, buy down the list of needs -- keeping back what every
 * more urgent need will cost in another shop -- put on what was bought for wearing, and sell what
 * that replaced. In the store the hero sees the stock, so it judges gear by what it really is.
 */
export function shopVisit(g: Game, s: Store): void {
  const p = g.player;
  maintainStore(g, s);
  sellPass(g, s);
  let reserve = 0;
  for (const need of shoppingNeeds(g)) {
    if (!need.stores.includes(s.type)) { reserve += held(need, p.gold - reserve); continue; }
    if (need.kind) {
      let left = need.count;
      while (left > 0) {
        const stock = s.stock.find(it => it.kind === need.kind);
        if (!stock || buyPrice(g, s, stock) > p.gold - reserve) break;
        if (!purchase(g, s, stock, 1)) break;
        left--;
      }
      reserve += held({ ...need, count: left }, p.gold - reserve);
      continue;
    }
    // Gear: the one empty slot, or (for 'any') a few upgrades while the money lasts.
    for (let i = 0; i < (need.slot === 'any' ? 3 : 1); i++) {
      const budget = p.gold - reserve - (need.slot === 'any' ? CUSHION : 0);
      const pick = budget > 0 ? bestGearBuy(g, s, need.slot!, budget, need.slot === 'any' ? 0.03 : 0) : null;
      if (!pick) break;
      const bought = purchase(g, s, pick, 1);
      if (!bought) break;
      C.wield(g, bought);
    }
    // Nothing here for the empty slot: its price is still owed to the other shop that might have one.
    if (need.slot !== 'any' && !p.equip[need.slot!]) reserve += held(need, p.gold - reserve);
  }
  sellPass(g, s);
  refreshBonuses(g);
}
