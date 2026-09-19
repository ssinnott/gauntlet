// The whole game in one object, plus the visual-effect events the renderer drains. Systems are
// plain functions over this state, so the headless simulator can drive them without a DOM.
import type { Player, PlayerBonuses, Level, Store, Pos, Element } from './types.ts';
import type { IgnoreSettings } from './ignore.ts';
import type { Flavors } from './items.ts';
import type { MessageLog } from './messages.ts';
import type { Options } from './options.ts';
import type { LoreBook } from './lore.ts';

export type Fx =
  | { type: 'bolt'; path: Pos[]; element: Element; beam?: boolean }
  | { type: 'ball'; x: number; y: number; radius: number; element: Element; cells: Pos[] }
  | { type: 'hit'; x: number; y: number; text: string; color: string }
  | { type: 'flash'; x: number; y: number; color: string }
  | { type: 'shake'; amount: number }
  | { type: 'missile'; path: Pos[]; icon: string; color: string }
  | { type: 'melee'; x: number; y: number; dx: number; dy: number };

/**
 * A sound the game logic asks for. These are plain ids, never audio objects: src/game/ must stay
 * free of the DOM, so the UI (src/ui/audio.ts) drains the queue each frame and synthesises them.
 */
export type SoundId =
  | 'hit' | 'miss' | 'crit' | 'hurt' | 'kill' | 'kill_unique' | 'player_die' | 'levelup'
  | 'gold' | 'pickup' | 'drop' | 'wield' | 'quaff' | 'read' | 'eat' | 'zap' | 'cast' | 'fail'
  | 'bolt' | 'ball' | 'breath' | 'shoot' | 'throw'
  | 'stairs' | 'door' | 'bash' | 'dig' | 'trap' | 'teleport' | 'summon' | 'heal' | 'curse'
  | 'spawn' | 'generator_hurt' | 'generator_die' | 'shop' | 'study' | 'lowhp';

/** How many queued sounds to keep. The headless simulator never drains the queue, so it is capped. */
export const SOUND_QUEUE_MAX = 24;

export interface Game {
  seed: number;
  /** Game turns (10 per player turn at normal speed). */
  turn: number;
  player: Player;
  bonuses: PlayerBonuses;
  level: Level;
  stores: Store[];
  flavors: Flavors;
  msg: MessageLog;
  nextMonsterId: number;
  uniquesDead: string[];
  /** Flow map from the player (monsters path along it); rebuilt when the player moves. */
  flow: Uint16Array | null;
  flowDirty: boolean;
  /**
   * Noise flow: BFS from the player whose cost rises with the hero's stealth, so a quiet hero is
   * harder to track. Monsters that cannot see the player follow it downhill. Never saved.
   */
  noise: Uint16Array | null;
  /**
   * Scent: the game turn the player last stood on each grid (0 = never). Trackers follow the path
   * you actually walked rather than the straight line to you. Never saved.
   */
  scent: Uint16Array | null;
  /** The turn counter scent grids are stamped with (see layScent). Never saved. */
  scentStamp: number;
  fx: Fx[];
  /** Sounds the UI has not played yet (see SoundId). */
  sounds: SoundId[];
  /** Set when the level must be regenerated at the end of the current command. */
  levelChange: { depth: number; by: 'down' | 'up' | 'teleport' | 'recall' } | null;
  /** Which store the player is standing in (UI opens the store screen). */
  inStore: number;
  /** A generic "the player needs to pick from a list" the command layer asks the UI for. */
  totalWinner: boolean;
  /** Repeat count for a command such as tunnelling/disarming. */
  repeating: { cmd: string; dir: number; left: number } | null;
  /** Running (shift-move) state. */
  running: { dir: number; steps: number } | null;
  /** Click-to-travel path. */
  travel: Pos[] | null;
  /** Resting state: turns left, or -1 for "as needed". */
  resting: number;
  /** For the level feeling and the sim: counts. */
  stats: { levelsVisited: number; monstersKilled: number; itemsFound: number; goldFound: number };
  /** When set, the next level generation puts the player on this kind of stairs. */
  arrivedBy: 'down' | 'up' | 'none';
  /** Birth and game options. */
  options: Options;
  /** Monster memory. */
  lore: LoreBook;
  /**
   * smart_learn: what each monster race has worked out about this hero's defences (see smart.ts).
   * Per hero, never merged into the browser-wide monster memory.
   */
  monsterKnows: Record<string, string[]>;
  /** The monster whose attack is resolving, so resistance checks know who to teach. Never saved. */
  attacker: import('./types.ts').Monster | null;
  /** Artifacts the player has seen (by id) and identified. */
  artifactsSeen: string[];
  /** Ego kinds identified at least once (they are then recognised on pickup). */
  egosKnown: string[];
  /** Levels kept for the persistent-levels option, keyed by depth. */
  savedLevels: Record<number, Level>;
  /** Which items the hero cannot be bothered to pick up. */
  ignore: IgnoreSettings;
  /** Transient: show ignored items anyway (the 'K' toggle). Not saved. */
  showIgnored: boolean;
  /** The last thing the player did that can be repeated with `n` (set by the UI). */
  lastCommand?: (() => void) | null;
  /** Late-bound helpers that would otherwise create import cycles. */
  hooks: {
    placeGoldAt(x: number, y: number): void;
    placeObjectAt(x: number, y: number, level?: number): void;
    cloneMonster(m: import('./types.ts').Monster): void;
    polymorphMonster(m: import('./types.ts').Monster): void;
    earthquake(x: number, y: number): void;
  };
}

/** Ask the UI for a sound. Bounded, because the headless simulator never drains the queue. */
export function playSound(g: Game, id: SoundId): void {
  const q = g.sounds;
  if (q.length >= SOUND_QUEUE_MAX) q.shift();
  q.push(id);
}
