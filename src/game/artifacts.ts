// Which set of artifacts this hero's world contains.
//
// Normally it is the hand-written list in data/objects.ts -- the Tolkien relics everyone knows.
// With the randarts birth option it is a set rolled from the game seed instead (randart.ts).
// Everything that reads artifacts goes through here rather than importing the table directly, so
// the swap is one call and nothing else has to know.
//
// The rolled set deliberately REUSES the standard ids. Saves, the artifacts-seen list and every
// Item.artifact reference therefore keep working untouched; only the name and the numbers change.
import type { ArtifactKind } from './types.ts';
import { ARTIFACTS as STANDARD_ARTIFACTS } from './data/objects.ts';

function index(list: ArtifactKind[]): Record<string, ArtifactKind> {
  const m: Record<string, ArtifactKind> = {};
  for (const a of list) m[a.id] = a;
  return m;
}

let current: ArtifactKind[] = STANDARD_ARTIFACTS;
let currentById: Record<string, ArtifactKind> = index(STANDARD_ARTIFACTS);

/** Every artifact in play for the current hero. */
export function artifactList(): ArtifactKind[] { return current; }
export function artifactById(id: string): ArtifactKind | undefined { return currentById[id]; }
/** Swap the set. Pass null to go back to the famous ones. */
export function setArtifactSet(list: ArtifactKind[] | null): void {
  current = list && list.length ? list : STANDARD_ARTIFACTS;
  currentById = index(current);
}
export function usingRandarts(): boolean { return current !== STANDARD_ARTIFACTS; }
export { STANDARD_ARTIFACTS };
