// Keyboard and pointer input. Keys are queued as events for the command layer; held movement keys
// auto-repeat so walking feels like Gauntlet rather than a typewriter.
export interface KeyEvent { key: string; shift: boolean; ctrl: boolean; alt: boolean; code: string; }
export interface PointerEvent2 { x: number; y: number; button: number; kind: 'down' | 'move' | 'up'; }

export class Input {
  keys = new Set<string>();
  queue: KeyEvent[] = [];
  pointer: PointerEvent2[] = [];
  mouse = { x: -1, y: -1 };
  /** Auto-repeat bookkeeping for held direction keys. */
  private heldDir: string | null = null;
  private heldSince = 0;
  private lastRepeat = 0;

  constructor(private canvas: HTMLCanvasElement, private toInternal: (cx: number, cy: number) => { x: number; y: number }) {
    canvas.addEventListener('keydown', e => this.onKey(e));
    canvas.addEventListener('keyup', e => { this.keys.delete(e.key); if (e.key === this.heldDir) this.heldDir = null; });
    window.addEventListener('blur', () => { this.keys.clear(); this.heldDir = null; });
    canvas.addEventListener('pointerdown', e => { const p = toInternal(e.clientX, e.clientY); this.pointer.push({ x: p.x, y: p.y, button: e.button, kind: 'down' }); canvas.focus(); e.preventDefault(); });
    canvas.addEventListener('pointermove', e => { const p = toInternal(e.clientX, e.clientY); this.mouse = p; });
    canvas.addEventListener('pointerup', e => { const p = toInternal(e.clientX, e.clientY); this.pointer.push({ x: p.x, y: p.y, button: e.button, kind: 'up' }); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => e.preventDefault(), { passive: false });
    canvas.focus();
  }
  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Tab' || e.key === ' ' || e.key.startsWith('Arrow') || e.key === 'Backspace') e.preventDefault();
    if (e.ctrlKey && (e.key === 's' || e.key === 'S' || e.key === 'x' || e.key === 'X')) e.preventDefault();
    if (e.repeat) return; // we do our own repeat for direction keys; other keys never repeat
    this.keys.add(e.key);
    const ev: KeyEvent = { key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, code: e.code };
    this.queue.push(ev);
    if (dirOfKey(ev, false) !== 0) { this.heldDir = e.key; this.heldSince = performance.now(); this.lastRepeat = this.heldSince; }
  }
  /** Held direction key repeat: after 220 ms, one step every 90 ms. Returns a synthetic key or null. */
  repeat(now: number, shift: boolean): KeyEvent | null {
    if (!this.heldDir || !this.keys.has(this.heldDir)) return null;
    if (now - this.heldSince < 220) return null;
    if (now - this.lastRepeat < 90) return null;
    this.lastRepeat = now;
    return { key: this.heldDir, shift, ctrl: false, alt: false, code: '' };
  }
  drain(): KeyEvent[] { const q = this.queue; this.queue = []; return q; }
  drainPointer(): PointerEvent2[] { const q = this.pointer; this.pointer = []; return q; }
}

/** Keypad direction (1-9) for arrows, vi keys and the numpad; 0 if not a direction key. */
export function dirOfKey(e: KeyEvent, allowVi = true): number {
  switch (e.key) {
    case 'ArrowLeft': return 4; case 'ArrowRight': return 6; case 'ArrowUp': return 8; case 'ArrowDown': return 2;
    case 'Home': return 7; case 'PageUp': return 9; case 'End': return 1; case 'PageDown': return 3;
  }
  if (e.code && e.code.startsWith('Numpad') && e.code.length === 7) { const d = Number(e.code[6]); if (d >= 1 && d <= 9) return d; }
  if (/^[1-9]$/.test(e.key) && (e.code.startsWith('Numpad') || !allowVi)) return Number(e.key);
  if (/^[1-9]$/.test(e.key)) return Number(e.key);
  if (!allowVi) return 0;
  const vi: Record<string, number> = { h: 4, j: 2, k: 8, l: 6, y: 7, u: 9, b: 1, n: 3, H: 4, J: 2, K: 8, L: 6, Y: 7, U: 9, B: 1, N: 3 };
  return vi[e.key] || 0;
}
