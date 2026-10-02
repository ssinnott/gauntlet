// On-screen controls, so the game can be watched on a phone.
//
// Nothing here duplicates a command: every button synthesises the KeyEvent the keyboard would have
// produced and hands it to the ordinary keymap, so a button can never drift out of step with what
// the key does.
//
// Two layouts. On the map it is a block of buttons for the screens worth looking at: the hero plays
// itself, so there is no pad to steer it with and no command to give it. With an overlay open it
// becomes a navigation bar instead, because the menus, the inventory and the knowledge browser are
// keyboard lists -- given ESC, up, down, Tab and Enter, all of them are usable by touch without
// rewriting a single screen.
import { VIEW_W, VIEW_H, MAP_X, MAP_Y, MAP_W, MAP_H } from '../constants.ts';
import { drawText } from '../lib/engine/text.ts';
import { rrect } from '../lib/art/shapes.ts';

export interface TouchButton {
  x: number; y: number; w: number; h: number;
  label: string;
  key: string;
  shift?: boolean;
  ctrl?: boolean;
}

/** The map's buttons. Each opens a screen, and the bot plays on behind it. */
const BUTTONS: [string, string][] = [
  ['INV', 'i'], ['LOOK', 'x'], ['MAP', 'M'], ['HERO', 'C'],
  ['KNOW', '~'], ['OPTS', '='], ['JUNK', 'O'], ['HELP', '?'],
];
const COLS = 4;

const BTN_W = 62, BTN_H = 30, BTN_GAP = 5;
const GRID_X = 250, GRID_Y = VIEW_H - 74;

export class TouchPad {
  /** Set the first time a real touch arrives; the option forces it on regardless. */
  detected = false;

  /** Buttons for the map view. */
  private mapButtons(): TouchButton[] {
    return BUTTONS.map(([label, key], i) => ({
      x: GRID_X + (i % COLS) * (BTN_W + BTN_GAP), y: GRID_Y + ((i / COLS) | 0) * (BTN_H + BTN_GAP),
      w: BTN_W, h: BTN_H, label, key,
    }));
  }

  /**
   * Buttons for whatever overlay is on top: enough to drive any keyboard list. YES and NO only
   * appear where the overlay actually asks a question -- on the title screen 'n' means NEW GAME,
   * so a bar that always offered NO dropped a curious player into character creation.
   */
  private overlayButtons(yesNo: boolean): TouchButton[] {
    const items: [string, string, boolean?][] = [['ESC', 'Escape'], ['UP', 'ArrowUp'], ['DOWN', 'ArrowDown'], ['LEFT', 'ArrowLeft'], ['RIGHT', 'ArrowRight'], ['TAB', 'Tab'], ['ENTER', 'Enter']];
    if (yesNo) items.push(['YES', 'y'], ['NO', 'n']);
    const w = 66, h = 30, gap = 5;
    const total = items.length * w + (items.length - 1) * gap;
    const x0 = (VIEW_W - total) / 2;
    return items.map(([label, key], i) => ({ x: x0 + i * (w + gap), y: VIEW_H - 40, w, h, label, key }));
  }

  buttons(overlayOpen: boolean, yesNo = false): TouchButton[] { return overlayOpen ? this.overlayButtons(yesNo) : this.mapButtons(); }

  /** What a tap means: a button, or null when the tap belongs to the map or the screen underneath. */
  hit(x: number, y: number, overlayOpen: boolean, yesNo = false): TouchButton | null {
    for (const b of this.buttons(overlayOpen, yesNo)) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, overlayOpen: boolean, yesNo = false): void {
    ctx.save();
    ctx.globalAlpha = 0.72;
    for (const b of this.buttons(overlayOpen, yesNo)) {
      rrect(ctx, b.x, b.y, b.w, b.h, 5, 'rgba(24,20,36,0.85)', '#5a5470', 2);
      drawText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 - 3, { size: 1, color: '#ffe060', align: 'center' });
    }
    ctx.restore();
  }
}
export const _keepTouch = [MAP_X, MAP_Y, MAP_W, MAP_H];
