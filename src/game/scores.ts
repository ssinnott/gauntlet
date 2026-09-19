// The high score table: kept in the browser between heroes. Pure data and ranking; main.ts does
// the localStorage part.
import type { Game } from './state.ts';
import { score, foodState } from './game.ts';
import { RACE_BY_ID } from './data/races.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { title } from './player.ts';

export interface ScoreEntry {
  name: string; race: string; cls: string; title: string; lev: number; depth: number; maxDepth: number; score: number; cause: string; turns: number; kills: number; gold: number; date: string; winner: boolean;
}
export const SCORES_KEY = 'gauntlet-of-angband.scores.v1';
export const SCORES_MAX = 50;

export function scoreEntry(g: Game): ScoreEntry {
  const p = g.player;
  return { name: p.name, race: RACE_BY_ID[p.race].name, cls: CLASS_BY_ID[p.cls].name, title: title(p), lev: p.lev, depth: p.depth, maxDepth: p.maxDepth, score: score(g), cause: g.totalWinner && !p.dead ? 'retired in glory' : p.deathCause || 'unknown', turns: Math.floor(g.turn / 10), kills: p.kills, gold: p.gold, date: new Date().toISOString().slice(0, 10), winner: g.totalWinner };
}
/** Insert an entry, keep the table sorted and bounded, and return the new rank (1-based). */
export function addScore(list: ScoreEntry[], e: ScoreEntry): number {
  list.push(e);
  list.sort((a, b) => b.score - a.score);
  if (list.length > SCORES_MAX) list.length = SCORES_MAX;
  return list.indexOf(e) + 1;
}
export const _keep = [foodState];
