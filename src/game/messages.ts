// The message log. Messages are plain text with a colour; identical consecutive messages collapse.
import type { Message } from './types.ts';

export const MSG_MAX = 300;

export class MessageLog {
  list: Message[] = [];
  /** Messages produced since the player last acted (rendered in the top bar). */
  fresh: Message[] = [];
  /** A Gauntlet-style announcement ("WARRIOR NEEDS FOOD BADLY"). */
  banner: { text: string; color: string; ttl: number } | null = null;
  turn = 0;

  add(text: string, color = '#e8e4d8'): void {
    const last = this.list[this.list.length - 1];
    if (last && last.text === text && last.turn === this.turn) { last.count++; return; }
    const m: Message = { text, color, turn: this.turn, count: 1 };
    this.list.push(m);
    if (this.list.length > MSG_MAX) this.list.splice(0, this.list.length - MSG_MAX);
    this.fresh.push(m);
    if (this.fresh.length > 6) this.fresh.shift();
  }
  shout(text: string, color = '#ffd040'): void { this.banner = { text, color, ttl: 180 }; }
  /** Called when a new player turn starts: keeps the fresh list to what happened since. */
  newTurn(turn: number): void { this.turn = turn; this.fresh.length = 0; }
  /**
   * The tail of the log, plus the turn counter. The counter matters: `add` collapses a repeat only
   * when it happens on the same turn, so a log restored without it would start collapsing on a
   * different boundary than the game it came from.
   */
  toJSON(): { list: Message[]; turn: number } { return { list: this.list.slice(-60), turn: this.turn }; }
}
