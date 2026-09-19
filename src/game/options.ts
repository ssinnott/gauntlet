// Player options: the birth options are fixed once the character is made; the game options can be
// changed from the `=` menu at any time.
export interface Options {
  // --- Birth options (locked once the game starts)
  /** Arriving by stairs puts you on a matching staircase. */
  connectedStairs: boolean;
  /** No up staircases and no Word of Recall back to town once you leave it. */
  ironman: boolean;
  /** Stores pay nothing; gold drops are larger to compensate. */
  noSelling: boolean;
  /** Every monster casts like a SMART one. */
  smartMonsters: boolean;
  /** Levels are remembered when you leave them and restored when you return. */
  persistentLevels: boolean;
  /** The artifact set is generated fresh for this hero instead of the standard one. */
  randarts: boolean;
  // --- Game options
  /** Pick up gold, keys and items by walking over them (Gauntlet style). */
  autoPickup: boolean;
  /** Show floating damage numbers. */
  damageNumbers: boolean;
  /** A monster coming into view interrupts running and resting. */
  disturbNear: boolean;
  /** Ask before quaffing or reading an unknown item. */
  confirmUnknown: boolean;
  /** Ask before walking onto a known trap. */
  confirmTraps: boolean;
  /** Hit a monster's flavour text in the message bar when it dies. */
  verboseLore: boolean;
  /** Arcade sound effects. */
  sound: boolean;
  /** The arcade narrator speaks the shouted banners. */
  voice: boolean;
  /** Always draw the on-screen touch controls (they appear by themselves on a touch device). */
  touchControls: boolean;
  /** Honour the ignore settings: ignored items are not picked up and not drawn. */
  ignoreItems: boolean;
}
export const DEFAULT_OPTIONS: Options = { connectedStairs: true, ironman: false, noSelling: false, smartMonsters: false, persistentLevels: false, randarts: false, autoPickup: true, damageNumbers: true, disturbNear: true, confirmUnknown: false, confirmTraps: true, verboseLore: false, sound: true, voice: true, touchControls: false, ignoreItems: true };
export const BIRTH_OPTIONS: (keyof Options)[] = ['connectedStairs', 'ironman', 'noSelling', 'smartMonsters', 'persistentLevels', 'randarts'];
export const GAME_OPTIONS: (keyof Options)[] = ['autoPickup', 'damageNumbers', 'disturbNear', 'confirmUnknown', 'confirmTraps', 'verboseLore', 'sound', 'voice', 'touchControls', 'ignoreItems'];
export const OPTION_TEXT: Record<keyof Options, [string, string]> = {
  connectedStairs: ['Connected stairs', 'Arrive on a staircase of the kind you took'],
  ironman: ['Ironman', 'No up staircases and no recall to town; the only way is down'],
  noSelling: ['No selling', 'Stores pay nothing for your finds, but the dungeon is richer in gold'],
  smartMonsters: ['Smart monsters', 'Every spellcaster picks its spells cleverly'],
  persistentLevels: ['Persistent levels', 'Levels live on while you are away and are waiting when you return'],
  randarts: ['Random artifacts', 'Roll a fresh set of artifacts for this hero instead of the famous ones'],
  autoPickup: ['Auto pickup', 'Pick up items as you walk over them'],
  damageNumbers: ['Damage numbers', 'Show floating numbers when things get hit'],
  disturbNear: ['Disturb on sight', 'Stop running and resting when a monster appears'],
  confirmUnknown: ['Confirm unknown items', 'Ask before quaffing or reading something unidentified'],
  confirmTraps: ['Confirm traps', 'Ask before stepping onto a visible trap'],
  verboseLore: ['Verbose lore', 'Show a monster\'s description the first time you meet it'],
  sound: ['Sound', 'Arcade sound effects'],
  voice: ['Narrator', 'The arcade voice announces what befalls you'],
  touchControls: ['Touch controls', 'Always show the on-screen pad (it appears by itself when you tap)'],
  ignoreItems: ['Ignore junk', 'Honour the ignore settings from the knowledge browser'],
};
export function normalizeOptions(o: Partial<Options> | undefined): Options { return { ...DEFAULT_OPTIONS, ...(o || {}) }; }
