// Monster memory: what the player has learned about each race (kills, sightings, blows and spells
// seen), kept on the game and merged into a browser-wide store so knowledge carries between heroes.
import type { Game } from './state.ts';
import type { Monster, MonsterRace, MonsterSpell } from './types.ts';
import { MONSTER_BY_ID } from './data/monsters.ts';

export interface MonsterLore {
  /** Times this hero (and earlier heroes) killed one. */
  kills: number;
  /** Times a hero was killed by one. */
  deaths: number;
  /** Times one came into view. */
  sights: number;
  /** Which of the race's blows have been observed (by index). */
  blows: number[];
  /** Spells and breaths seen cast. */
  spells: MonsterSpell[];
  /** Resistances and vulnerabilities observed ('IM_FIRE', 'HURT_LITE'...). */
  flags: string[];
  /** Drops observed: max number of items seen at once. */
  drops: number;
}
export type LoreBook = Record<string, MonsterLore>;

export function emptyLore(): MonsterLore { return { kills: 0, deaths: 0, sights: 0, blows: [], spells: [], flags: [], drops: 0 }; }
export function loreOf(g: Game, raceId: string): MonsterLore { return g.lore[raceId] ??= emptyLore(); }
export function noteSight(g: Game, m: Monster): void { loreOf(g, m.race).sights++; }
export function noteKill(g: Game, m: Monster): void { loreOf(g, m.race).kills++; }
export function noteDeath(g: Game, raceId: string): void { loreOf(g, raceId).deaths++; }
export function noteBlow(g: Game, m: Monster, index: number): void { const l = loreOf(g, m.race); if (!l.blows.includes(index)) l.blows.push(index); }
export function noteSpell(g: Game, m: Monster, s: MonsterSpell): void { const l = loreOf(g, m.race); if (!l.spells.includes(s)) l.spells.push(s); }
export function noteFlag(g: Game, m: Monster, f: string): void { const l = loreOf(g, m.race); if (!l.flags.includes(f)) l.flags.push(f); }
export function noteDrop(g: Game, m: Monster, n: number): void { const l = loreOf(g, m.race); if (n > l.drops) l.drops = n; }

/** Knowledge of a race's depth, speed and hit points comes with kills (Angband's r_tkills thresholds). */
export function knowsDetails(l: MonsterLore, r: MonsterRace): boolean {
  if (l.kills >= 1 && r.flags.includes('UNIQUE')) return true;
  return l.kills >= Math.max(1, Math.floor(r.depth / 10)) || l.sights >= 20;
}

/** Merge one lore book into another (max of counts, union of lists). */
export function mergeLore(into: LoreBook, from: LoreBook): LoreBook {
  for (const id of Object.keys(from)) {
    if (!MONSTER_BY_ID[id]) continue;
    const a = into[id] ??= emptyLore(), b = from[id];
    a.kills = Math.max(a.kills, b.kills); a.deaths = Math.max(a.deaths, b.deaths); a.sights = Math.max(a.sights, b.sights); a.drops = Math.max(a.drops, b.drops);
    for (const x of b.blows) if (!a.blows.includes(x)) a.blows.push(x);
    for (const x of b.spells) if (!a.spells.includes(x)) a.spells.push(x);
    for (const x of b.flags) if (!a.flags.includes(x)) a.flags.push(x);
  }
  return into;
}
