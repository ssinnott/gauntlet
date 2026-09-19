// On-screen controls, so the game is playable on a phone.
//
// Nothing here duplicates a command: every button synthesises the KeyEvent the keyboard would have
// produced and hands it to the ordinary keymap, so a button can never drift out of step with what
// the key does.
//
// Two layouts. On the map it is a thumb pad on the left and a page of commands on the right. With
// an overlay open it becomes a navigation bar instead, because the menus, the inventory and the
// stores are keyboard lists -- given ESC, up, down, Tab and Enter, all of them are usable by touch
// without rewriting a single screen.
import { VIEW_W, VIEW_H, MAP_X, MAP_Y, MAP_W, MAP_H } from '../constants.ts';
import { drawText } from '../lib/engine/text.ts';
import { rrect } from '../lib/art/shapes.ts';

export interface TouchButton {
  x: number; y: number; w: number; h: number;
  label: string;
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  /** Set for the page flipper, which is handled here rather than sent on as a key. */
  page?: boolean;
}

const PAD_CX = 74, PAD_CY = VIEW_H - 78, PAD_R = 58, PAD_INNER = 19;
/** Keypad digit per sector, starting due east and going anticlockwise. */
const SECTOR_DIR = [6, 9, 8, 7, 4, 1, 2, 3];
/** The key that means each direction. Home/End/PageUp/PageDown are the diagonals the keymap knows. */
const DIR_KEY: Record<number, string> = { 1: 'End', 2: 'ArrowDown', 3: 'PageDown', 4: 'ArrowLeft', 6: 'ArrowRight', 7: 'Home', 8: 'ArrowUp', 9: 'PageUp' };

const PAGES: [string, string][][] = [
  [['INV', 'i'], ['WEAR', 'w'], ['QUAFF', 'q'], ['READ', 'r'], ['CAST', 'm'],
   ['FIRE', 'f'], ['REST', 'R'], ['DOWN', '>'], ['UP', '<'], ['MORE', '']],
  [['LOOK', 'x'], ['MAP', 'M'], ['HERO', 'C'], ['EAT', 'E'], ['WAND', 'a'],
   ['STAFF', 'u'], ['ROD', 'z'], ['THROW', 'v'], ['TAKE', 'g'], ['MORE', '']],
  [['OPEN', 'o'], ['CLOSE', 'c'], ['DIG', 'T'], ['DISARM', 'D'], ['STUDY', 'G'],
   ['KNOW', '~'], ['OPTS', '='], ['JUNK', 'O'], ['HELP', '?'], ['MORE', '']],
];

const BTN_W = 62, BTN_H = 30, BTN_GAP = 5;
const GRID_X = 250, GRID_Y = VIEW_H - 74;

export class TouchPad {
  /** Set the first time a real touch arrives; the option forces it on regardless. */
  detected = false;
  page = 0;

  /** Buttons for the map view. */
  private mapButtons(): TouchButton[] {
    const out: TouchButton[] = [];
    const page = PAGES[this.page % PAGES.length];
    page.forEach(([label, key], i) => {
      const col = i % 5, row = (i / 5) | 0;
      out.push({
        x: GRID_X + col * (BTN_W + BTN_GAP), y: GRID_Y + row * (BTN_H + BTN_GAP),
        w: BTN_W, h: BTN_H, label, key, page: key === '',
      });
    });
    return out;
  }

  /** Buttons for whatever overlay is on top: enough to drive any keyboard list. */
  private overlayButtons(): TouchButton[] {
    const items: [string, string, boolean?][] = [['ESC', 'Escape'], ['UP', 'ArrowUp'], ['DOWN', 'ArrowDown'], ['LEFT', 'ArrowLeft'], ['RIGHT', 'ArrowRight'], ['TAB', 'Tab'], ['ENTER', 'Enter'], ['YES', 'y'], ['NO', 'n']];
    const w = 66, h = 30, gap = 5;
    const total = items.length * w + (items.length - 1) * gap;
    const x0 = (VIEW_W - total) / 2;
    return items.map(([label, key], i) => ({ x: x0 + i * (w + gap), y: VIEW_H - 40, w, h, label, key }));
  }

  buttons(overlayOpen: boolean): TouchButton[] { return overlayOpen ? this.overlayButtons() : this.mapButtons(); }
  nextPage(): void { this.page = (this.page + 1) % PAGES.length; }

  /**
   * What a tap means. Returns a direction key, a button, or null when the tap belongs to the map
   * (click-to-travel and the rest keep working).
   */
  hit(x: number, y: number, overlayOpen: boolean): TouchButton | null {
    for (const b of this.buttons(overlayOpen)) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    if (overlayOpen) return null;
    const dx = x - PAD_CX, dy = y - PAD_CY;
    const r = Math.hypot(dx, dy);
    if (r > PAD_R) return null;
    // The hub is "stay here and pick up what is under you".
    if (r < PAD_INNER) return { x: PAD_CX, y: PAD_CY, w: 0, h: 0, label: '.', key: 'g' };
    // Screen y grows downwards, so the angle is negated to read anticlockwise from east.
    const a = Math.atan2(-dy, dx);
    const sector = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    const dir = SECTOR_DIR[sector];
    return { x: PAD_CX, y: PAD_CY, w: 0, h: 0, label: String(dir), key: DIR_KEY[dir] };
  }

  draw(ctx: CanvasRenderingContext2D, overlayOpen: boolean): void {
    ctx.save();
    ctx.globalAlpha = 0.72;
    if (!overlayOpen) this.drawPad(ctx);
    for (const b of this.buttons(overlayOpen)) {
      rrect(ctx, b.x, b.y, b.w, b.h, 5, 'rgba(24,20,36,0.85)', '#5a5470', 2);
      drawText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 - 3, { size: 1, color: '#ffe060', align: 'center' });
    }
    ctx.restore();
  }

  private drawPad(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.arc(PAD_CX, PAD_CY, PAD_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(24,20,36,0.7)';
    ctx.fill();
    ctx.strokeStyle = '#5a5470';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Eight arrow heads around the ring.
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const px = PAD_CX + Math.cos(a) * (PAD_R - 16), py = PAD_CY - Math.sin(a) * (PAD_R - 16);
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * 7, py - Math.sin(a) * 7);
      ctx.lineTo(px + Math.cos(a + 2.4) * 7, py - Math.sin(a + 2.4) * 7);
      ctx.lineTo(px + Math.cos(a - 2.4) * 7, py - Math.sin(a - 2.4) * 7);
      ctx.closePath();
      ctx.fillStyle = '#ffe060';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(PAD_CX, PAD_CY, PAD_INNER, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(60,54,84,0.9)';
    ctx.fill();
    ctx.strokeStyle = '#5a5470';
    ctx.stroke();
    drawText(ctx, 'GET', PAD_CX, PAD_CY - 4, { size: 1, color: '#ffe060', align: 'center' });
  }
}
export const _keepTouch = [MAP_X, MAP_Y, MAP_W, MAP_H];
