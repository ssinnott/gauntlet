// What a bard's songs do while they are being sung.
//
// The SpellDef of the same id in spells.ts carries the name, the book, the level it is learnt at
// and the mana it costs to strike up. This table carries the part that makes a song a song: the
// mana it costs to keep going, and the effect that lasts as long as it does.
//
// Effects reuse the sub-race and subclass feature vocabulary, so a song that steadies the singer's
// nerve and a bloodline that does the same are the same three fields, applied by the same loop in
// player.ts. A song that works on the listeners instead carries an `aura`, which effectsCore.ts
// applies once per world turn.
import type { SongDef } from '../types.ts';

export const SONGS: SongDef[] = [];

export const SONG_BY_ID: Record<string, SongDef> = Object.fromEntries(SONGS.map(s => [s.id, s]));
export function isSong(spellId: string): boolean { return !!SONG_BY_ID[spellId]; }
