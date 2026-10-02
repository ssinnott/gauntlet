// The touch bar: what a phone gets in place of a keyboard. The hero plays itself, so the map has no
// buttons at all and nothing covers it; the bar appears only while a screen is open, because the
// menus, the inventory and the birth screen are keyboard lists -- given ESC, up, down, Tab and
// Enter, all of them are usable by touch without rewriting a single screen.
//
// Nothing here duplicates a command: every button synthesises the KeyEvent the keyboard would have
// produced and hands it to the ordinary keymap, so a button can never drift out of step with what
// the key does.
import { VIEW_W, VIEW_H } from '../constants.ts';
import { drawText } from '../lib/engine/text.ts';
import { rrect } from '../lib/art/shapes.ts';

export interface TouchButton {
  x: number; y: number; w: number; h: number;
  label: string;
  key: string;
  shift?: boolean;
  ctrl?: boolean;
}

export class TouchBar {
  /** Set the first time a real touch arrives; the option forces it on regardless. */
  detected = false;

  /**
   * The bar's buttons: enough to drive any keyboard list. YES and NO only appear where the screen
   * actually asks a question -- on the title screen 'n' means NEW GAME, so a bar that always offered
   * NO dropped a curious player into character creation.
   */
  buttons(yesNo = false): TouchButton[] {
    const items: [string, string, boolean?][] = [['ESC', 'Escape'], ['UP', 'ArrowUp'], ['DOWN', 'ArrowDown'], ['LEFT', 'ArrowLeft'], ['RIGHT', 'ArrowRight'], ['TAB', 'Tab'], ['ENTER', 'Enter']];
    if (yesNo) items.push(['YES', 'y'], ['NO', 'n']);
    const w = 66, h = 30, gap = 5;
    const total = items.length * w + (items.length - 1) * gap;
    const x0 = (VIEW_W - total) / 2;
    return items.map(([label, key], i) => ({ x: x0 + i * (w + gap), y: VIEW_H - 40, w, h, label, key }));
  }

  /** The button a tap landed on, or null when the tap belongs to the screen underneath. */
  hit(x: number, y: number, yesNo = false): TouchButton | null {
    for (const b of this.buttons(yesNo)) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, yesNo = false): void {
    ctx.save();
    ctx.globalAlpha = 0.72;
    for (const b of this.buttons(yesNo)) {
      rrect(ctx, b.x, b.y, b.w, b.h, 5, 'rgba(24,20,36,0.85)', '#5a5470', 2);
      drawText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 - 3, { size: 1, color: '#ffe060', align: 'center' });
    }
    ctx.restore();
  }
}
