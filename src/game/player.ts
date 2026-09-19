// The player: birth, stat tables, derived bonuses from equipment, experience, hunger and the
// timed effects. Angband's xtra1.c / birth.c in spirit, with stats on a 3..40 internal scale
// (18/10 = 19, 18/50 = 23, 18/100 = 28, up to 18/220 = 40).
import { rng } from '../lib/engine/rng.ts';
import { type Player, type PlayerBonuses, type Stat, type Item, type SkillSet, type ObjectFlag, type Timed, STATS, SLOTS, type SlotName } from './types.ts';
import { RACE_BY_ID } from './data/races.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { kindOf, itemFlags, isWeapon, artifactOf } from './items.ts';
import { FOOD_MAX } from '../constants.ts';
import { clamp } from './util.ts';

export const TIMED_NAMES: Timed[] = ['fast', 'slow', 'blind', 'paralyzed', 'confused', 'afraid', 'image', 'poisoned', 'cut', 'stun', 'protevil', 'invuln', 'hero', 'shero', 'shield', 'blessed', 'sinvis', 'sinfra', 'oppose_acid', 'oppose_elec', 'oppose_fire', 'oppose_cold', 'oppose_pois', 'telepathy', 'recall', 'deep_descent', 'stoneskin', 'regen', 'bold', 'terror', 'bloodlust', 'oppose_conf'];

/** Experience needed for each level (Angband's player_exp table, index = level - 2). */
export const EXP_TABLE = [10, 25, 45, 70, 100, 140, 200, 280, 380, 500, 650, 850, 1100, 1400, 1800, 2300, 2900, 3600, 4400, 5400, 6800, 8400, 10200, 12500, 17500, 25000, 35000, 50000, 75000, 100000, 150000, 200000, 275000, 350000, 450000, 550000, 700000, 850000, 1000000, 1250000, 1500000, 1800000, 2100000, 2400000, 2700000, 3000000, 3500000, 4000000, 4500000, 5000000];
export const MAX_LEVEL = 50;

/** Display a 3..40 stat as Angband does: "18/50". */
export function statText(v: number): string {
  if (v <= 18) return String(v);
  const over = (v - 18) * 10;
  return over >= 220 ? '18/***' : `18/${over < 10 ? '0' + over : over}`;
}

/** Adjustment tables indexed by stat value 3..40 (Angband's adj_* tables, condensed). */
function tab(v: number, table: number[]): number { return table[clamp(v, 3, 40) - 3]; }
const ADJ_STR_TH = [-3, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 4, 4, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const ADJ_STR_TD = [-2, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20];
const ADJ_STR_WGT = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
const ADJ_STR_HOLD = [4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80];
const ADJ_STR_DIG = [0, 0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 100, 100, 100, 100];
const ADJ_STR_BLOW = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 240, 240];
const ADJ_DEX_TA = [-4, -3, -2, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 5, 6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15, 15];
const ADJ_DEX_TH = [-3, -2, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 15];
const ADJ_DEX_BLOW = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 11, 11];
const ADJ_DEX_DIS = [-8, -6, -4, -3, -2, -1, -1, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 8, 8, 8, 9, 9, 9, 9, 10];
const ADJ_INT_DIS = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10];
const ADJ_INT_DEV = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 15, 16, 16, 17, 17, 18];
const ADJ_WIS_SAV = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 15, 16, 16, 17, 17, 18];
const ADJ_CON_HP = [-5, -3, -2, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 5, 6, 7, 8, 9, 9, 10, 11, 12, 12, 12, 12, 12];
const ADJ_MAG_MANA = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 225, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 800, 800, 800, 800, 800, 800];
const ADJ_MAG_FAIL = [99, 99, 99, 99, 99, 50, 30, 20, 15, 12, 11, 10, 9, 8, 7, 6, 6, 5, 5, 5, 4, 4, 4, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const ADJ_MAG_STUDY = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5];
const ADJ_CHR_GOLD = [130, 125, 122, 120, 118, 116, 114, 112, 110, 108, 106, 104, 103, 102, 101, 100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 80, 80, 80, 80];

export const adj = {
  strTh: (v: number) => tab(v, ADJ_STR_TH), strTd: (v: number) => tab(v, ADJ_STR_TD), strWgt: (v: number) => tab(v, ADJ_STR_WGT), strHold: (v: number) => tab(v, ADJ_STR_HOLD),
  strDig: (v: number) => tab(v, ADJ_STR_DIG), strBlow: (v: number) => tab(v, ADJ_STR_BLOW), dexTa: (v: number) => tab(v, ADJ_DEX_TA), dexTh: (v: number) => tab(v, ADJ_DEX_TH),
  dexBlow: (v: number) => tab(v, ADJ_DEX_BLOW), dexDis: (v: number) => tab(v, ADJ_DEX_DIS), intDis: (v: number) => tab(v, ADJ_INT_DIS), intDev: (v: number) => tab(v, ADJ_INT_DEV),
  wisSav: (v: number) => tab(v, ADJ_WIS_SAV), conHp: (v: number) => tab(v, ADJ_CON_HP), magMana: (v: number) => tab(v, ADJ_MAG_MANA), magFail: (v: number) => tab(v, ADJ_MAG_FAIL),
  magStudy: (v: number) => tab(v, ADJ_MAG_STUDY), chrGold: (v: number) => tab(v, ADJ_CHR_GOLD),
};

/** Roll birth stats (Angband's 3 + 3d5... condensed: 8 + d10 spread, race/class mods applied). */
export function rollStats(race: string, cls: string, rnd: (a: number, b: number) => number = (a, b) => rng.int(a, b)): Record<Stat, number> {
  const r = RACE_BY_ID[race], c = CLASS_BY_ID[cls];
  const out = {} as Record<Stat, number>;
  for (const s of STATS) {
    let v = 8 + rnd(1, 5) + rnd(1, 5) + rnd(0, 2);
    v += r.stats[s] + c.stats[s];
    out[s] = clamp(v, 3, 20);
  }
  return out;
}
/** Point-based birth: the cost to raise a base stat from v to v + 1 (before race/class modifiers). */
export function statCost(v: number): number { return v < 14 ? 1 : v < 16 ? 2 : v < 17 ? 3 : v < 18 ? 4 : 6; }
export const POINT_BUDGET = 20;
/** Apply race and class modifiers to bought base stats. */
export function boughtStats(base: Record<Stat, number>, race: string, cls: string): Record<Stat, number> {
  const r = RACE_BY_ID[race], c = CLASS_BY_ID[cls];
  const out = {} as Record<Stat, number>;
  for (const s of STATS) out[s] = clamp(base[s] + r.stats[s] + c.stats[s], 3, 20);
  return out;
}
/** A few lines of history for the character sheet (Angband's player_history, in miniature). */
export function makeHistory(race: string, sex: 'male' | 'female', rnd: (n: number) => number = n => rng.int(0, n - 1)): string {
  const r = RACE_BY_ID[race];
  const pick = (a: string[]) => a[rnd(a.length)];
  const origin = r.history && r.history.length ? pick(r.history) : pick(['You are the illegitimate and unacknowledged child of a serf.', 'You are one of several children of a yeoman.', 'You are the only child of a guildsman.', 'You are the first child of a landed knight.', 'You are the heir of a noble house.']);
  const look = pick(['You have dark brown eyes, straight black hair and an average complexion.', 'You have blue eyes, wavy blond hair and a fair complexion.', 'You have green eyes, curly red hair and a ruddy complexion.', 'You have grey eyes, straight brown hair and a dark complexion.', 'You have hazel eyes, wild auburn hair and a pale complexion.']);
  const rep = pick(['You are a credit to the family.', 'You are the black sheep of the family.', 'You are a well liked child.', 'You are a shunned child.', 'You are of average fame.']);
  return `${origin} ${rep} ${look}`.replace(/\bYou are (a|the) (well liked|shunned) child/, sex === 'female' ? 'You are $1 $2 daughter' : 'You are $1 $2 son');
}

export function createPlayer(name: string, race: string, cls: string, sex: 'male' | 'female', chosenStats?: Record<Stat, number>): Player {
  const stats = chosenStats || rollStats(race, cls);
  const timed = {} as Record<Timed, number>;
  for (const t of TIMED_NAMES) timed[t] = 0;
  const equip = {} as Record<SlotName, Item | null>;
  for (const s of SLOTS) equip[s] = null;
  const p: Player = {
    name, race, cls, sex, x: 0, y: 0, statBase: { ...stats }, statCur: { ...stats }, lev: 1, exp: 0, maxExp: 0,
    mhp: 10, chp: 10, msp: 0, csp: 0, food: FOOD_MAX * 0.6, gold: 0, depth: 0, maxDepth: 0, energy: 100, timed, equip, inven: [], quiver: [],
    learned: [], cast: [], keys: 0, searching: false, dead: false, deathCause: '', turns: 0, kills: 0, recallDepth: 0, facing: 1,
  };
  p.gold = 600 - Math.max(0, (Object.values(stats).reduce((a, b) => a + b, 0) - 60)) * 10 + rng.int(0, 100);
  p.gold = Math.max(100, p.gold);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Derived bonuses

export function computeBonuses(p: Player): PlayerBonuses {
  const r = RACE_BY_ID[p.race], c = CLASS_BY_ID[p.cls];
  const flags = new Set<ObjectFlag>(r.flags);
  const stat = { ...p.statCur };
  let toAc = 0, ac = 0, toHit = 0, toDam = 0, speed = 0, lightRadius = 0, weight = 0, infra = 0;
  let extraBlows = 0, extraShots = 0, extraMight = 0;
  const skills: SkillSet = { ...r.skills };
  for (const k of Object.keys(skills) as (keyof SkillSet)[]) skills[k] += c.skills[k] + Math.floor(c.skillsGrowth[k] * p.lev / 10);
  for (const s of SLOTS) {
    const it = p.equip[s];
    if (!it) continue;
    const k = kindOf(it);
    weight += k.weight * it.number;
    const fl = itemFlags(it);
    for (const f of fl) flags.add(f);
    ac += k.ac || 0; toAc += it.toAc;
    // Weapon and bow to-hit/dam are applied in combat, not globally (Angband distinguishes them).
    if (s !== 'weapon' && s !== 'bow') { toHit += it.toHit; toDam += it.toDam; }
    const pv = it.pval;
    if (fl.has('STR')) stat.STR += pv; if (fl.has('INT')) stat.INT += pv; if (fl.has('WIS')) stat.WIS += pv;
    if (fl.has('DEX')) stat.DEX += pv; if (fl.has('CON')) stat.CON += pv; if (fl.has('CHR')) stat.CHR += pv;
    if (fl.has('STEALTH')) skills.stealth += pv; if (fl.has('SEARCH')) { skills.search += pv * 5; skills.perception += pv * 5; }
    if (fl.has('SPEED')) speed += pv; if (fl.has('BLOWS')) extraBlows += pv; if (fl.has('SHOTS')) extraShots += pv; if (fl.has('MIGHT')) extraMight += pv;
    if (fl.has('TUNNEL')) skills.digging += pv * 20;
    if (fl.has('INFRA')) infra += pv;
    if (s === 'light') {
      const art = artifactOf(it);
      lightRadius = Math.max(lightRadius, art ? (it.pval || 3) : (it.timeout > 0 || fl.has('NO_FUEL') ? (k.pval || 1) : 0));
    }
    if (fl.has('LITE') && s !== 'light') lightRadius += 1;
  }
  for (const it of p.inven) weight += kindOf(it).weight * it.number;
  for (const it of p.quiver) weight += kindOf(it).weight * it.number;
  for (const s of STATS) stat[s] = clamp(stat[s], 3, 40);
  // Timed effects.
  const t = p.timed;
  if (t.fast) speed += 10; if (t.slow) speed -= 10;
  if (t.hero) { toHit += 12; } if (t.shero) { toHit += 24; toAc -= 10; }
  if (t.blessed) { toAc += 5; toHit += 10; }
  if (t.shield) toAc += 50;
  if (t.stun > 50) { toHit -= 20; toDam -= 20; } else if (t.stun) { toHit -= 5; toDam -= 5; }
  if (t.sinvis) flags.add('SEE_INVIS'); if (t.telepathy) flags.add('TELEPATHY');
  if (t.stoneskin) { toAc += 40; speed -= 5; }
  if (t.regen) flags.add('REGEN');
  if (t.bold) flags.add('RES_FEAR');
  if (t.terror) { speed += 10; }
  if (t.bloodlust) { toHit += 10; toDam += 5; }
  if (t.oppose_conf) flags.add('RES_CONF');
  if (t.sinfra) infra += 5;
  if (t.image) { /* hallucination is cosmetic */ }
  // Stat-derived.
  toHit += adj.strTh(stat.STR) + adj.dexTh(stat.DEX);
  toDam += adj.strTd(stat.STR);
  toAc += adj.dexTa(stat.DEX);
  skills.disarm += adj.dexDis(stat.DEX) + adj.intDis(stat.INT);
  skills.device += adj.intDev(stat.INT);
  skills.save += adj.wisSav(stat.WIS);
  skills.digging += adj.strDig(stat.STR);
  // Weight limit and slowdown.
  const weightLimit = adj.strWgt(stat.STR) * 100;
  if (weight > weightLimit) speed -= Math.floor((weight - weightLimit) / 100);
  // Blows (Angband's blows table, condensed): from STR-driven "hold" and DEX.
  const weapon = p.equip.weapon;
  let blows = 1;
  let heavyWeapon = false;
  if (weapon) {
    const wk = kindOf(weapon);
    const hold = adj.strHold(stat.STR) * 10;
    if (hold < wk.weight) { heavyWeapon = true; toHit += 2 * (hold - wk.weight) / 10; }
    const div = Math.max(wk.weight, c.minWeight);
    const strIndex = Math.min(11, Math.floor(adj.strBlow(stat.STR) * c.attackMultiplier / div));
    const dexIndex = adj.dexBlow(stat.DEX);
    const BLOWS_TABLE = [
      [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2], [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 4], [1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5], [1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5],
      [1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5], [2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 6], [2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 6], [2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 6],
      [3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 6], [3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6], [3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6], [3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6],
    ];
    blows = Math.min(c.maxAttacks, BLOWS_TABLE[Math.min(11, strIndex)][Math.min(11, dexIndex)]);
    if (heavyWeapon) blows = 1;
    if (p.cls === 'warrior' && blows < 2 && p.lev >= 10) blows = 2;
    blows += extraBlows;
  }
  // Shots.
  const bow = p.equip.bow;
  let shots = 1, might = 0, heavyBow = false;
  if (bow) {
    const bk = kindOf(bow);
    might = (bk.multiplier || 2) + extraMight;
    shots += extraShots;
    if (p.cls === 'ranger' && bk.ammo === 'arrow') shots += Math.floor(p.lev / 20) + 1 > 1 ? Math.floor((p.lev + 20) / 20) : 0;
    if (p.cls === 'rogue' && bk.ammo === 'shot') shots += Math.floor(p.lev / 20) + 1;
    if (p.cls === 'archer') shots += 1 + Math.floor(p.lev / 15);
    const hold = adj.strHold(stat.STR) * 10;
    if (hold < bk.weight) heavyBow = true;
  }
  if (p.timed.afraid) { /* fear blocks melee entirely; handled in combat */ }
  // Archers and rangers get extra shots; the class table says how fast.
  return { stat, ac, toAc, toHit: Math.round(toHit), toDam, blows, shots, might, speed, skills, lightRadius, flags, weight, weightLimit, heavyWeapon, heavyBow, infra };
}

/** Max hp from level, race+class hit die and CON. */
export function recomputeHp(p: Player, b: PlayerBonuses): void {
  const r = RACE_BY_ID[p.race], c = CLASS_BY_ID[p.cls];
  const die = r.hitDie + c.hitDie;
  // Deterministic per-level rolls (seeded by the name) so max hp does not fluctuate.
  let mhp = die;
  let seed = 0; for (let i = 0; i < p.name.length; i++) seed = (seed * 31 + p.name.charCodeAt(i)) >>> 0;
  for (let l = 2; l <= p.lev; l++) { seed = (seed * 1103515245 + 12345) >>> 0; mhp += 1 + Math.floor((seed >>> 8) % die); }
  mhp += adj.conHp(b.stat.CON) * p.lev;
  mhp = Math.max(p.lev + 1, mhp);
  if (p.mhp !== mhp) { if (p.chp > 0) p.chp = Math.max(1, Math.round(p.chp * mhp / Math.max(1, p.mhp))); p.mhp = mhp; }
  if (p.chp > p.mhp) p.chp = p.mhp;
}
export function recomputeMana(p: Player, b: PlayerBonuses): void {
  const c = CLASS_BY_ID[p.cls];
  if (!c.realm || p.lev < c.firstSpellLevel) { p.msp = 0; p.csp = 0; return; }
  const levels = p.lev - c.firstSpellLevel + 1;
  let msp = Math.floor(adj.magMana(b.stat[c.spellStat]) * levels / 100) + 1;
  // Gloves hurt mages; heavy armour hurts everyone.
  if ((c.realm === 'magic' || c.realm === 'necro') && p.equip.gloves) { const fl = itemFlags(p.equip.gloves); if (!fl.has('FREE_ACT') && !(fl.has('DEX') && p.equip.gloves.pval > 0)) msp = Math.floor(msp * 3 / 4); }
  let armorWeight = 0;
  for (const s of ['body', 'cloak', 'shield', 'helm', 'gloves', 'boots'] as SlotName[]) { const it = p.equip[s]; if (it) armorWeight += kindOf(it).weight; }
  const maxWeight = c.realm === 'magic' || c.realm === 'necro' ? 300 : 350;
  if (armorWeight > maxWeight) msp -= Math.floor((armorWeight - maxWeight) / 10);
  msp = Math.max(0, msp);
  if (p.msp !== msp) { p.csp = Math.min(p.csp, msp); p.msp = msp; }
}

export function expToLevel(p: Player, lev: number): number {
  const c = CLASS_BY_ID[p.cls], r = RACE_BY_ID[p.race];
  if (lev <= 1) return 0;
  return Math.floor(EXP_TABLE[lev - 2] * (100 + r.expPct + c.expPct) / 100);
}
/** Recompute level from exp. Returns levels gained (or lost). */
export function checkLevel(p: Player): number {
  let gained = 0;
  while (p.lev > 1 && p.exp < expToLevel(p, p.lev)) { p.lev--; gained--; }
  while (p.lev < MAX_LEVEL && p.exp >= expToLevel(p, p.lev + 1)) { p.lev++; gained++; }
  return gained;
}
export function title(p: Player): string { return CLASS_BY_ID[p.cls].titles[Math.min(9, Math.floor((p.lev - 1) / 5))]; }

/** Skill with weapon (Angband's to-hit chance builder) uses skills.melee + toHit * 3. */
export function meleeSkill(p: Player, b: PlayerBonuses): number {
  const w = p.equip.weapon;
  return b.skills.melee + (b.toHit + (w ? w.toHit : 0)) * 3;
}
export function bowSkill(p: Player, b: PlayerBonuses): number {
  const w = p.equip.bow;
  return b.skills.bows + (b.toHit + (w ? w.toHit : 0)) * 3;
}

/** Class weapon restrictions: priests want blunt weapons (or blessed blades). */
export function weaponPenalty(p: Player, it: Item): boolean {
  if (p.cls !== 'priest') return false;
  const k = kindOf(it);
  if (!isWeapon(k) || k.tval === 'hafted') return false;
  return !itemFlags(it).has('BLESSED');
}

/** Total armour class shown to the player. */
export function totalAc(b: PlayerBonuses): number { return b.ac + b.toAc; }

export function drainStat(p: Player, s: Stat, amount = 1): boolean {
  if (p.statCur[s] <= 3) return false;
  const before = p.statCur[s];
  let v = before;
  if (v > 18) { v -= amount * (v > 28 ? 5 : 2); if (v < 18) v = 18; } else v -= amount;
  p.statCur[s] = Math.max(3, v);
  return p.statCur[s] < before;
}
export function restoreStat(p: Player, s: Stat): boolean {
  if (p.statCur[s] >= p.statBase[s]) return false;
  p.statCur[s] = p.statBase[s];
  return true;
}
export function gainStat(p: Player, s: Stat): boolean {
  if (p.statBase[s] >= 40) return false;
  const v = p.statBase[s];
  p.statBase[s] = v < 18 ? v + 1 : Math.min(40, v + 1 + rng.int(0, 2));
  p.statCur[s] = Math.max(p.statCur[s], p.statBase[s]);
  return true;
}
