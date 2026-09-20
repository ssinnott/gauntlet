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

export const SONGS: SongDef[] = [
  // ---- [Lays of Beleriand] ----
  { id: 'song_kindler', upkeep: 1, effects: [{ at: 1, kind: 'bonus', field: 'lightRadius', amount: 1, name: 'Song of the Kindler', desc: 'You name the Kindler of the Stars, and the dark draws back a pace. Your light reaches one square further for as long as you sing.' }] },
  { id: 'song_silence', upkeep: 1, effects: [{ at: 1, kind: 'skill', skill: 'stealth', amount: 3, name: 'Song of Silence', desc: 'A song so low it is felt rather than heard, and it swallows the noise you make. +3 stealth while it lasts.' }] },
  { id: 'song_staunching', upkeep: 1, effects: [], timed: 'regen' },
  { id: 'song_delvings', upkeep: 1, effects: [{ at: 1, kind: 'skill', skill: 'search', amount: 35, name: 'Song of Delvings', desc: 'You sing to the rock and listen to how it answers. +35 searching, so hidden doors and traps give themselves away as you walk.' }] },
  { id: 'song_elbereth', upkeep: 2, effects: [], aura: { kind: 'fear', power: 15, radius: 4 } },
  { id: 'song_freedom', upkeep: 2, effects: [{ at: 1, kind: 'flag', flag: 'FREE_ACT', name: 'Song of Freedom', desc: 'No chain and no spell holds a singer in the middle of a verse. Grants free action for as long as you sing.' }] },
  // ---- [The Lay of Leithian] ----
  { id: 'song_lorien', upkeep: 2, effects: [], aura: { kind: 'sleep', power: 20, radius: 3 } },
  { id: 'song_valour', upkeep: 2, effects: [], timed: 'hero' },
  { id: 'song_trees', upkeep: 2, effects: [{ at: 1, kind: 'bonus', field: 'lightRadius', amount: 2, name: 'Song of the Two Trees', desc: 'Silver and gold, remembered rather than seen. Your light reaches two squares further; it replaces the Kindler rather than adding to it.' }] },
  { id: 'song_slaying', upkeep: 3, effects: [{ at: 1, kind: 'bonus', field: 'toDam', amount: 10, name: 'Song of Slaying', desc: 'You set your blows to the beat and they land like hammer strokes. +10 damage while it lasts.' }] },
  { id: 'song_beguiling', upkeep: 3, effects: [], aura: { kind: 'confuse', power: 30, radius: 3 } },
  { id: 'song_sharpsight', upkeep: 2, effects: [], timed: 'sinvis' },
  // ---- [The Children of Hurin] ----
  { id: 'song_mastery', upkeep: 3, effects: [], aura: { kind: 'slow', power: 35, radius: 5 } },
  { id: 'song_stone', upkeep: 3, effects: [], timed: 'stoneskin' },
  { id: 'song_challenge', upkeep: 3, effects: [{ at: 1, kind: 'bonus', field: 'toHit', amount: 15, name: 'Song of Challenge', desc: 'You name your lineage aloud and dare the dark to answer it. Nothing steadies an arm like having said it out loud: +15 to hit.' }] },
  { id: 'song_nirnaeth', upkeep: 4, effects: [], aura: { kind: 'fear', power: 45, radius: 6 } },
  { id: 'song_wrath', upkeep: 4, effects: [], timed: 'shero' },
  { id: 'song_warding', upkeep: 3, effects: [{ at: 1, kind: 'bonus', field: 'ac', amount: 25, name: 'Song of Warding', desc: 'A ward sung rather than carved, and it holds only while the sound does. +25 armour.' }] },
  // ---- [The Fall of the Noldor] ----
  { id: 'song_lament', upkeep: 4, effects: [], timed: 'protevil' },
  { id: 'song_farlistening', upkeep: 4, effects: [], timed: 'telepathy' },
  { id: 'song_binding', upkeep: 4, effects: [], aura: { kind: 'sleep', power: 60, radius: 5 } },
  { id: 'song_swiftfeet', upkeep: 4, effects: [{ at: 1, kind: 'bonus', field: 'speed', amount: 2, name: 'Song of Swift Feet', desc: 'A dancing measure, and your feet keep it whether you meant them to or not. +2 speed while it lasts.' }] },
  { id: 'song_oath', upkeep: 4, effects: [{ at: 1, kind: 'bonus', field: 'blows', amount: 1, name: 'Song of the Oath', desc: 'The oath that ruined a house, sung by someone who should know better. One more blow every round, for as long as you are fool enough to hold the note.' }] },
  // ---- [The Music of the Ainur] ----
  { id: 'song_dooming', upkeep: 4, effects: [], aura: { kind: 'slow', power: 80, radius: 6 } },
  { id: 'song_elderking', upkeep: 4, effects: [{ at: 1, kind: 'bonus', field: 'ac', amount: 45, name: 'Song of the Elder King', desc: 'You sing the winds of Manwe about yourself and nothing gets through them cleanly. +45 armour.' }] },
  { id: 'song_everwhite', upkeep: 4, effects: [{ at: 1, kind: 'bonus', field: 'speed', amount: 3, name: 'Song of the Everwhite', desc: 'The high thin air of the Everwhite Mountain, and your feet barely touch the stone. +3 speed; it replaces Swift Feet rather than adding to it.' }] },
  { id: 'song_theme', upkeep: 4, effects: [], aura: { kind: 'confuse', power: 100, radius: 8 } },
];

export const SONG_BY_ID: Record<string, SongDef> = Object.fromEntries(SONGS.map(s => [s.id, s]));
export function isSong(spellId: string): boolean { return !!SONG_BY_ID[spellId]; }
