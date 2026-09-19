// Which generator builds a level. Most levels are the classic rooms-and-corridors Angband layout;
// now and then the dungeon opens into a cavern or closes into a labyrinth instead, which is the
// cheapest way to stop depth 40 looking exactly like depth 10.
//
// Everything goes through here -- the game and the headless simulator alike -- so the simulator's
// connectivity check covers all three kinds.
import type { Level, Pos } from '../types.ts';
import { oneIn } from '../util.ts';
import { type GenHooks, generateDungeon } from './dungeon.ts';
import { generateCavern } from './cavern.ts';
import { generateLabyrinth } from './labyrinth.ts';

/** One level in this many is a labyrinth, from depth 5. */
function labyrinthOdds(depth: number): number { return depth >= 25 ? 16 : 24; }
/** One level in this many is a cavern, from depth 8, and more often deep down. */
function cavernOdds(depth: number): number { return depth >= 40 ? 9 : 14; }

export function generateLevel(depth: number, hooks: GenHooks, arrivedBy: 'down' | 'up' | 'none'): { level: Level; start: Pos } {
  if (depth >= 5 && oneIn(labyrinthOdds(depth))) {
    const r = generateLabyrinth(depth, hooks, arrivedBy);
    if (r) return r;
  }
  if (depth >= 8 && oneIn(cavernOdds(depth))) {
    const r = generateCavern(depth, hooks, arrivedBy);
    if (r) return r;
  }
  const r = generateDungeon(depth, hooks, arrivedBy);
  r.level.kind ??= 'classic';
  return r;
}
