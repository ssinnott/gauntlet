// Randarts: a fresh set of artifacts rolled for one hero.
//
// Each standard artifact is replaced by one of the same base object, depth and rarity, so the set
// keeps the shape of the original -- a deep weapon artifact is still a deep weapon artifact, and
// the allocation code in items.ts needs no changes at all. What changes is the name and everything
// under it, bought out of a power budget that grows with depth so a level 20 relic cannot come out
// with four immunities and speed.
//
// It is rolled from its OWN rng instance seeded off the game seed, so generating it consumes none
// of the gameplay sequence: a seed reproduces the same run whether or not randarts are on.
import { makeRng, type RngInstance } from '../lib/engine/rng.ts';
import type { ArtifactKind, Effect, ObjectFlag, ObjectKind } from './types.ts';
import { OBJECT_BY_ID } from './data/objects.ts';
import { STANDARD_ARTIFACTS } from './artifacts.ts';

/** Kept on everything, as the hand-written artifacts are: relics do not burn or corrode. */
const IGNORE_ALL: ObjectFlag[] = ['IGNORE_ACID', 'IGNORE_ELEC', 'IGNORE_FIRE', 'IGNORE_COLD'];

interface Buy { flag: ObjectFlag; cost: number; }

const GENERIC: Buy[] = [
  { flag: 'SUST_STR', cost: 2 }, { flag: 'SUST_INT', cost: 2 }, { flag: 'SUST_WIS', cost: 2 },
  { flag: 'SUST_DEX', cost: 2 }, { flag: 'SUST_CON', cost: 3 }, { flag: 'SUST_CHR', cost: 1 },
  { flag: 'RES_ACID', cost: 6 }, { flag: 'RES_ELEC', cost: 6 }, { flag: 'RES_FIRE', cost: 6 }, { flag: 'RES_COLD', cost: 6 },
  { flag: 'RES_POIS', cost: 14 }, { flag: 'RES_LITE', cost: 8 }, { flag: 'RES_DARK', cost: 8 },
  { flag: 'RES_BLIND', cost: 10 }, { flag: 'RES_CONF', cost: 12 }, { flag: 'RES_SOUND', cost: 12 },
  { flag: 'RES_SHARDS', cost: 10 }, { flag: 'RES_NETHER', cost: 14 }, { flag: 'RES_NEXUS', cost: 10 },
  { flag: 'RES_CHAOS', cost: 16 }, { flag: 'RES_DISEN', cost: 14 }, { flag: 'RES_FEAR', cost: 5 },
  { flag: 'FREE_ACT', cost: 10 }, { flag: 'HOLD_LIFE', cost: 10 }, { flag: 'SEE_INVIS', cost: 6 },
  { flag: 'SLOW_DIGEST', cost: 3 }, { flag: 'REGEN', cost: 5 }, { flag: 'FEATHER', cost: 3 },
  { flag: 'LITE', cost: 4 }, { flag: 'TELEPATHY', cost: 28 },
];
/** The four immunities are what a set with no budget discipline gives away too freely. */
const IMMUNITIES: Buy[] = [
  { flag: 'IM_ACID', cost: 45 }, { flag: 'IM_ELEC', cost: 45 }, { flag: 'IM_FIRE', cost: 52 }, { flag: 'IM_COLD', cost: 45 },
];
const WEAPON_ONLY: Buy[] = [
  { flag: 'SLAY_ANIMAL', cost: 5 }, { flag: 'SLAY_EVIL', cost: 10 }, { flag: 'SLAY_UNDEAD', cost: 7 },
  { flag: 'SLAY_DEMON', cost: 7 }, { flag: 'SLAY_ORC', cost: 4 }, { flag: 'SLAY_TROLL', cost: 5 },
  { flag: 'SLAY_GIANT', cost: 6 }, { flag: 'SLAY_DRAGON', cost: 8 }, { flag: 'KILL_DRAGON', cost: 18 },
  { flag: 'BRAND_ACID', cost: 16 }, { flag: 'BRAND_ELEC', cost: 16 }, { flag: 'BRAND_FIRE', cost: 16 },
  { flag: 'BRAND_COLD', cost: 16 }, { flag: 'BRAND_POIS', cost: 14 },
  { flag: 'IMPACT', cost: 8 }, { flag: 'VORPAL', cost: 12 }, { flag: 'BLESSED', cost: 3 },
];
/** Flags driven by the single shared pval, with what one point costs. */
const PVAL_FLAGS: { flag: ObjectFlag; per: number; max: number }[] = [
  { flag: 'STR', per: 7, max: 5 }, { flag: 'INT', per: 6, max: 5 }, { flag: 'WIS', per: 6, max: 5 },
  { flag: 'DEX', per: 7, max: 5 }, { flag: 'CON', per: 8, max: 5 }, { flag: 'CHR', per: 3, max: 5 },
  { flag: 'STEALTH', per: 5, max: 4 }, { flag: 'SEARCH', per: 2, max: 5 }, { flag: 'INFRA', per: 2, max: 5 },
  { flag: 'TUNNEL', per: 2, max: 4 },
];
const CURSES: ObjectFlag[] = ['AGGRAVATE', 'TELEPORT', 'DRAIN_EXP', 'DRAIN_HP', 'DRAIN_MANA', 'NO_TELEPORT'];

interface Activation { effect: Effect; timeout: number; minLevel: number; text: string; cost: number; }
const ACTIVATIONS: Activation[] = [
  { effect: { kind: 'light_room' }, timeout: 15, minLevel: 1, text: 'lights the room', cost: 4 },
  { effect: { kind: 'detect', what: ['monsters'] }, timeout: 30, minLevel: 3, text: 'senses living things nearby', cost: 6 },
  { effect: { kind: 'probe' }, timeout: 30, minLevel: 5, text: 'lays a creature\'s nature bare', cost: 6 },
  { effect: { kind: 'cure', cure: ['afraid', 'confused'] }, timeout: 20, minLevel: 5, text: 'clears the head', cost: 5 },
  { effect: { kind: 'satisfy_hunger' }, timeout: 100, minLevel: 5, text: 'satisfies hunger', cost: 5 },
  { effect: { kind: 'teleport', range: 100 }, timeout: 40, minLevel: 8, text: 'carries you away', cost: 8 },
  { effect: { kind: 'bolt', element: 'fire', dice: [9, 8] }, timeout: 30, minLevel: 10, text: 'looses a bolt of fire', cost: 8 },
  { effect: { kind: 'bolt', element: 'cold', dice: [6, 8] }, timeout: 25, minLevel: 10, text: 'looses a bolt of frost', cost: 7 },
  { effect: { kind: 'timed', effect: 'hero', base: 25 }, timeout: 50, minLevel: 12, text: 'fills you with courage', cost: 8 },
  { effect: { kind: 'map' }, timeout: 75, minLevel: 15, text: 'maps the surrounding area', cost: 10 },
  { effect: { kind: 'heal', amount: 35 }, timeout: 50, minLevel: 15, text: 'closes your wounds', cost: 10 },
  { effect: { kind: 'ball', element: 'cold', dam: 48, radius: 2 }, timeout: 50, minLevel: 18, text: 'casts a ball of frost', cost: 12 },
  { effect: { kind: 'ball', element: 'acid', dam: 60, radius: 2 }, timeout: 55, minLevel: 20, text: 'casts a ball of acid', cost: 12 },
  { effect: { kind: 'timed', effect: 'shield', base: 30 }, timeout: 80, minLevel: 22, text: 'raises a mystic shield', cost: 12 },
  { effect: { kind: 'ball', element: 'fire', dam: 72, radius: 2 }, timeout: 60, minLevel: 25, text: 'casts a ball of fire', cost: 14 },
  { effect: { kind: 'ball', element: 'elec', dam: 64, radius: 3 }, timeout: 60, minLevel: 25, text: 'calls down lightning', cost: 14 },
  { effect: { kind: 'detect', what: ['all'] }, timeout: 60, minLevel: 28, text: 'reveals all that is near', cost: 14 },
  { effect: { kind: 'drain_life', dam: 90 }, timeout: 70, minLevel: 30, text: 'drains the life from a foe', cost: 16 },
  { effect: { kind: 'earthquake' }, timeout: 80, minLevel: 32, text: 'shatters the ground', cost: 14 },
  { effect: { kind: 'dispel', what: 'evil', dam: 60 }, timeout: 100, minLevel: 35, text: 'banishes evil', cost: 18 },
  { effect: { kind: 'heal', amount: 120 }, timeout: 120, minLevel: 38, text: 'heals grievous wounds', cost: 20 },
  { effect: { kind: 'restore_stat', stat: 'all' }, timeout: 200, minLevel: 40, text: 'restores your strength of body and mind', cost: 20 },
  { effect: { kind: 'timed', effect: 'fast', base: 20 }, timeout: 150, minLevel: 45, text: 'hastens you', cost: 26 },
  { effect: { kind: 'breath', element: 'fire', dam: 160 }, timeout: 140, minLevel: 50, text: 'breathes fire', cost: 26 },
  { effect: { kind: 'timed', effect: 'invuln', base: 8 }, timeout: 300, minLevel: 65, text: 'makes you briefly invulnerable', cost: 34 },
];

const SYLLABLES = [
  'ad', 'ag', 'al', 'am', 'an', 'ar', 'as', 'ath', 'bar', 'bel', 'bor', 'brin', 'cal', 'car', 'cel', 'corm',
  'dag', 'dan', 'del', 'dir', 'dol', 'dor', 'dun', 'ed', 'el', 'em', 'en', 'er', 'esk', 'fal', 'fim', 'fin',
  'gal', 'gar', 'gil', 'glin', 'gor', 'grim', 'gund', 'hal', 'har', 'hel', 'hir', 'il', 'im', 'ing', 'ir',
  'kel', 'khor', 'lam', 'las', 'lin', 'lith', 'lor', 'mal', 'mar', 'meg', 'mor', 'nal', 'nar', 'neth', 'nim',
  'nor', 'ol', 'om', 'or', 'orn', 'pel', 'quel', 'ran', 'reg', 'rim', 'ring', 'rond', 'ros', 'sar', 'sel',
  'sil', 'sir', 'tal', 'tar', 'thal', 'thang', 'thel', 'thir', 'thon', 'tir', 'tur', 'ul', 'um', 'ung', 'ur',
  'val', 'var', 'vel', 'vor', 'wen', 'wyn', 'yr', 'zag', 'zir',
];

function randName(r: RngInstance, quoted: boolean): string {
  let s = '';
  const n = 2 + r.int(0, 1);
  for (let i = 0; i < n; i++) s += SYLLABLES[r.int(0, SYLLABLES.length - 1)];
  s = s[0].toUpperCase() + s.slice(1);
  return quoted ? `'${s}'` : `of ${s}`;
}

const WEAPON_TVALS = ['sword', 'hafted', 'polearm', 'digger'];
const ARMOUR_TVALS = ['soft_armor', 'hard_armor', 'dragon_armor', 'shield', 'helm', 'crown', 'cloak', 'gloves', 'boots'];

/** Roll the whole set. Same ids, same base objects, same depths; everything else fresh. */
export function buildRandartSet(seed: number): ArtifactKind[] {
  const r = makeRng(((seed ^ 0x5eed5eed) >>> 0) || 1);
  return STANDARD_ARTIFACTS.map(a => rollArtifact(r, a));
}

function rollArtifact(r: RngInstance, base: ArtifactKind): ArtifactKind {
  const k: ObjectKind | undefined = OBJECT_BY_ID[base.kind];
  const tval = k ? k.tval : 'sword';
  const weapon = WEAPON_TVALS.includes(tval);
  const launcher = tval === 'bow';
  const armour = ARMOUR_TVALS.includes(tval);
  const jewel = tval === 'ring' || tval === 'amulet';
  const lightSource = tval === 'light';
  const level = base.level, rarity = base.rarity;

  // One relic in a dozen is a trap: more power than it should have, and a reason to regret it.
  const cursed = r.chance(1 / 12);
  let budget = Math.round((18 + level * 1.5 + rarity * 4) * (cursed ? 1.7 : 1));

  const flags: ObjectFlag[] = [...IGNORE_ALL];
  const out: ArtifactKind = { id: base.id, name: '', kind: base.kind, level, rarity, cost: 0, flags };
  const spend = (n: number) => { budget -= n; };
  const startBudget = budget;

  // Combat numbers, which are most of what a weapon artifact is.
  if (weapon || launcher) {
    const hit = 4 + r.int(0, 8 + Math.floor(level / 5));
    const dam = 4 + r.int(0, 8 + Math.floor(level / 5));
    out.toHit = cursed ? -hit : hit;
    out.toDam = cursed ? -dam : dam;
    spend(Math.round((hit + dam) * 0.6));
    if (weapon) {
      const dice = base.dice ?? k?.dice;
      if (dice) out.dice = r.chance(0.4) ? [dice[0] + r.int(0, 1), dice[1] + r.int(0, 2)] : [dice[0], dice[1]];
      if (out.dice) spend((out.dice[0] * out.dice[1] - (dice ? dice[0] * dice[1] : 0)) * 2);
    }
  }
  if (armour || jewel || lightSource) {
    const ac = 3 + r.int(0, 10 + Math.floor(level / 6));
    out.toAc = cursed ? -ac : ac;
    spend(Math.round(ac * 0.7));
    if (armour && base.ac !== undefined) out.ac = base.ac;
  }
  // Lights keep burning: a relic lamp that needs oil is a joke.
  if (lightSource) { flags.push('NO_FUEL'); flags.push('LITE'); }

  // An artifact has ONE pval, shared by every flag that reads it, so it gets one pval line. Rolling
  // a stat line and then a speed line on top let the second silently overwrite the first: the
  // budget was charged for +6 speed and the relic shipped with +1 because MIGHT had reset the
  // field. Speed and the attack multipliers get first refusal; a stat line fills in otherwise.
  let pvalTaken = false;
  // Speed is the one bonus that changes how the game is played, so it is priced accordingly.
  if (!cursed && budget >= 40 && r.chance(0.12)) {
    const sp = 1 + r.int(0, Math.min(5, Math.floor(budget / 22)));
    flags.push('SPEED');
    out.pval = sp;
    spend(sp * 22);
    pvalTaken = true;
  }
  // Extra blows and shots, likewise.
  if (!pvalTaken && weapon && !cursed && budget >= 35 && r.chance(0.10)) {
    const blows = 1 + r.int(0, 1);
    flags.push('BLOWS'); out.pval = blows; spend(28 * blows); pvalTaken = true;
  }
  if (!pvalTaken && launcher && !cursed && budget >= 30) {
    if (r.chance(0.4)) { flags.push('SHOTS'); out.pval = 1; spend(26); pvalTaken = true; }
    else if (r.chance(0.4)) { flags.push('MIGHT'); out.pval = 1; spend(26); pvalTaken = true; }
  }
  const pvalPicks = PVAL_FLAGS.filter(p => !(weapon && p.flag === 'TUNNEL' && r.chance(0.5)));
  if (!pvalTaken && r.chance(0.75)) {
    const first = pvalPicks[r.int(0, pvalPicks.length - 1)];
    const affordable = Math.max(1, Math.min(first.max, Math.floor(budget / 2 / first.per)));
    const pval = 1 + r.int(0, affordable - 1);
    out.pval = cursed ? -pval : pval;
    flags.push(first.flag);
    spend(first.per * pval);
    if (r.chance(0.35) && budget > 0) {
      const second = pvalPicks[r.int(0, pvalPicks.length - 1)];
      if (second.flag !== first.flag) { flags.push(second.flag); spend(second.per * pval); }
    }
  }

  // Now buy abilities until the budget runs out.
  const pool: Buy[] = [...GENERIC];
  if (weapon) pool.push(...WEAPON_ONLY);
  // Immunities are endgame perks. Budget alone is not enough of a gate: a cursed relic gets its
  // budget multiplied, which was letting a level 10 artifact buy immunity to fire.
  if (level >= 40 && budget >= 60 && r.chance(0.2)) pool.push(...IMMUNITIES);
  let guard = 0;
  while (budget > 1 && guard++ < 40) {
    const affordable = pool.filter(b => b.cost <= budget && !flags.includes(b.flag));
    if (!affordable.length) break;
    const pick = affordable[r.int(0, affordable.length - 1)];
    flags.push(pick.flag);
    spend(pick.cost);
    if (r.chance(0.18)) break; // stop early sometimes, so not everything is maxed out
  }

  // An activation, if there is anything left to pay for it.
  const acts = ACTIVATIONS.filter(a => a.minLevel <= level + 5 && a.cost <= Math.max(6, budget + 10));
  if (acts.length && r.chance(0.45)) {
    const a = acts[r.int(0, acts.length - 1)];
    out.activation = a.effect;
    out.activationTimeout = a.timeout;
    flags.push('ACTIVATE');
    spend(a.cost);
    out.desc = `A nameless relic out of the elder days. It ${a.text} when activated.`;
  } else {
    out.desc = 'A nameless relic out of the elder days.';
  }

  if (cursed) {
    flags.push('CURSED');
    flags.push(CURSES[r.int(0, CURSES.length - 1)]);
    if (r.chance(0.3)) flags.push('HEAVY_CURSE');
    out.desc += ' Something about it is deeply wrong.';
  }

  out.name = randName(r, weapon || launcher || r.chance(0.25));
  const spent = Math.max(1, startBudget - budget);
  out.cost = Math.max(500, Math.round(spent * 700 + level * 500));
  return out;
}
