// The whole game in one object, plus the visual-effect events the renderer drains. Systems are
// plain functions over this state, so the headless simulator can drive them without a DOM.
import type { Player, PlayerBonuses, Level, Store, Pos, Element } from './types.ts';
import type { Flavors } from './items.ts';
import type { MessageLog } from './messages.ts';

export type Fx =
  | { type: 'bolt'; path: Pos[]; element: Element; beam?: boolean }
  | { type: 'ball'; x: number; y: number; radius: number; element: Element; cells: Pos[] }
  | { type: 'hit'; x: number; y: number; text: string; color: string }
  | { type: 'flash'; x: number; y: number; color: string }
  | { type: 'shake'; amount: number }
  | { type: 'missile'; path: Pos[]; icon: string; color: string }
  | { type: 'melee'; x: number; y: number; dx: number; dy: number };

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
  fx: Fx[];
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
  /** Late-bound helpers that would otherwise create import cycles. */
  hooks: {
    placeGoldAt(x: number, y: number): void;
    placeObjectAt(x: number, y: number, level?: number): void;
    cloneMonster(m: import('./types.ts').Monster): void;
    polymorphMonster(m: import('./types.ts').Monster): void;
  };
}
