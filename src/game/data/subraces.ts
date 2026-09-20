// Sub-races: the bloodline or the region a hero comes from, three for each of the seventeen races.
//
// These are deliberately small. A sub-race is a stat tweak of a point or two and one modest perk,
// which is a different job from a subclass: it colours a character rather than building one. The
// perk is a `Feature` at level 1, so it goes through the same bonus refresh as everything else.
import type { SubraceDef } from '../types.ts';

export const SUBRACES: SubraceDef[] = [];

export const SUBRACE_BY_ID: Record<string, SubraceDef> = Object.fromEntries(SUBRACES.map(s => [s.id, s]));
/** The three sub-races of a race, in birth-screen order. */
export function subracesOf(race: string): SubraceDef[] { return SUBRACES.filter(s => s.race === race); }
