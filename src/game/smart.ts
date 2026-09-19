// smart_learn: what a monster has worked out about the hero by attacking them.
//
// Angband 3.0 gives SMART monsters a set of flags recording which of the player's defences they
// have seen work, and they stop wasting turns on attacks that bounce. Before this, a SMART monster
// here simply read the player's equipment, which is omniscience rather than cunning.
//
// Knowledge is kept per RACE for the current hero. A species that has watched you shrug off fire
// passes the word around; it does not survive your death, and it is never written to the
// browser-wide monster memory, which would be absurd -- the dead do not gossip with the newborn.
import type { Element, MonsterRace, ObjectFlag, Timed } from './types.ts';
import type { Monster } from './types.ts';
import type { Game } from './state.ts';
import { MONSTER_BY_ID } from './data/monsters.ts';

/** One thing a monster can have learnt about the hero. */
export type Lesson =
  | 'RES_ACID' | 'RES_ELEC' | 'RES_FIRE' | 'RES_COLD' | 'RES_POIS'
  | 'RES_LITE' | 'RES_DARK' | 'RES_SOUND' | 'RES_CONF' | 'RES_CHAOS' | 'RES_NETHER'
  | 'RES_NEXUS' | 'RES_DISEN' | 'RES_SHARDS' | 'RES_BLIND' | 'RES_FEAR'
  | 'FREE_ACT' | 'SAVE' | 'NO_MANA';

/** Which lesson an element teaches when it fails to bite. */
export const ELEM_LESSON: Partial<Record<Element, Lesson>> = {
  acid: 'RES_ACID', elec: 'RES_ELEC', fire: 'RES_FIRE', cold: 'RES_COLD', ice: 'RES_COLD', pois: 'RES_POIS',
  lite: 'RES_LITE', dark: 'RES_DARK', sound: 'RES_SOUND', conf: 'RES_CONF', chaos: 'RES_CHAOS',
  nether: 'RES_NETHER', nexus: 'RES_NEXUS', disen: 'RES_DISEN', shards: 'RES_SHARDS',
};

/** How each lesson reads in the monster recall. */
export const LESSON_TEXT: Record<Lesson, string> = {
  RES_ACID: 'you shrug off acid', RES_ELEC: 'lightning does not trouble you', RES_FIRE: 'you shrug off fire',
  RES_COLD: 'cold does not trouble you', RES_POIS: 'poison is wasted on you', RES_LITE: 'light does not dazzle you',
  RES_DARK: 'darkness does not blind you', RES_SOUND: 'noise does not stun you', RES_CONF: 'you cannot be confused',
  RES_CHAOS: 'chaos washes over you', RES_NETHER: 'nether cannot touch your life', RES_NEXUS: 'nexus cannot shift you',
  RES_DISEN: 'your gear resists disenchantment', RES_SHARDS: 'shards do not cut you', RES_BLIND: 'you cannot be blinded',
  RES_FEAR: 'you cannot be frightened', FREE_ACT: 'you cannot be held', SAVE: 'your will is hard to break',
  NO_MANA: 'you carry no magic worth draining',
};

/** Does this race learn at all? Mindless and stupid things never do. */
export function raceLearns(g: Game, r: MonsterRace): boolean {
  if (r.flags.includes('EMPTY_MIND') || r.flags.includes('STUPID')) return false;
  return r.flags.includes('SMART') || g.options.smartMonsters;
}

/**
 * Teach whichever monster's attack is resolving right now. Game.attacker is set by monsterMelee and
 * monsterCastSpell, so a trap or a potion that happens to be resisted teaches nobody.
 */
export function monsterLearn(g: Game, lesson: Lesson): void {
  const m = g.attacker;
  if (!m) return;
  const r = MONSTER_BY_ID[m.race];
  if (!r || !raceLearns(g, r)) return;
  const list = g.monsterKnows[m.race] ??= [];
  if (!list.includes(lesson)) list.push(lesson);
}

export function monsterKnowsLesson(g: Game, m: Monster, lesson: Lesson): boolean {
  const list = g.monsterKnows[m.race];
  return !!list && list.includes(lesson);
}
export function lessonsKnown(g: Game, raceId: string): Lesson[] {
  return (g.monsterKnows[raceId] || []) as Lesson[];
}

/**
 * Called whenever an element lands on the hero: if a defence was in play, whoever threw it now
 * knows. Immunities, permanent resists and a temporary opposition all count -- the monster sees the
 * attack fizzle, not the reason.
 */
export function learnResist(g: Game, elem: Element, flags: Set<ObjectFlag>, timed: Record<Timed, number>): void {
  if (!g.attacker) return;
  const has = (f: ObjectFlag) => flags.has(f);
  let learnt = false;
  switch (elem) {
    case 'acid': learnt = has('IM_ACID') || has('RES_ACID') || timed.oppose_acid > 0; break;
    case 'elec': learnt = has('IM_ELEC') || has('RES_ELEC') || timed.oppose_elec > 0; break;
    case 'fire': learnt = has('IM_FIRE') || has('RES_FIRE') || timed.oppose_fire > 0; break;
    case 'cold': case 'ice': learnt = has('IM_COLD') || has('RES_COLD') || timed.oppose_cold > 0; break;
    case 'pois': learnt = has('RES_POIS') || timed.oppose_pois > 0; break;
    case 'lite': learnt = has('RES_LITE'); break;
    case 'dark': learnt = has('RES_DARK'); break;
    case 'sound': learnt = has('RES_SOUND'); break;
    case 'conf': learnt = has('RES_CONF') || timed.oppose_conf > 0; break;
    case 'chaos': learnt = has('RES_CHAOS'); break;
    case 'nether': learnt = has('RES_NETHER'); break;
    case 'nexus': learnt = has('RES_NEXUS'); break;
    case 'disen': learnt = has('RES_DISEN'); break;
    case 'shards': learnt = has('RES_SHARDS'); break;
    default: return;
  }
  const lesson = ELEM_LESSON[elem];
  if (learnt && lesson) monsterLearn(g, lesson);
}

/** Run a monster's attack with it marked as the attacker, so the resistance checks can teach it. */
export function asAttacker<T>(g: Game, m: Monster, f: () => T): T {
  const was = g.attacker;
  g.attacker = m;
  try { return f(); } finally { g.attacker = was; }
}
