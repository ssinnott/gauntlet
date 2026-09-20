// Subclasses: three specialisations for each class, chosen at birth.
//
// Unlike a sub-race, a subclass is meant to change the run. Each one overrides some of the parent
// class's numbers -- the hit die, how many blows it can reach, how heavy a weapon it swings well,
// when its spells start -- and unlocks three features at levels 1, 10 and 25, so the two halves of
// a class diverge as the character grows rather than at the character sheet.
import type { SubclassDef } from '../types.ts';

export const SUBCLASSES: SubclassDef[] = [];

export const SUBCLASS_BY_ID: Record<string, SubclassDef> = Object.fromEntries(SUBCLASSES.map(s => [s.id, s]));
/** The three subclasses of a class, in birth-screen order. */
export function subclassesOf(cls: string): SubclassDef[] { return SUBCLASSES.filter(s => s.cls === cls); }
