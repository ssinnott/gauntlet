// Shared world helpers: dropping objects near a grid, disturbing the player's repeated actions,
// and light/darkness of grids.
import { type Item, type Pos, F, T } from './types.ts';
import { tileAt, inBounds, addFlag, clearFlag, hasFlag } from './level.ts';
import { canHoldObject, DIR_DX, DIR_DY } from './types.ts';
import { canStack, absorb } from './items.ts';
import { randint0 } from './util.ts';
import type { Game } from './state.ts';

/** Stop running, resting, repeating and travelling. */
export function disturb(g: Game): void {
  g.running = null;
  g.resting = 0;
  g.repeating = null;
  g.travel = null;
}

/** Drop an item on (x, y) or the nearest grid that can hold it; stacks with what is there. */
export function dropNear(g: Game, it: Item, x: number, y: number): Pos | null {
  const lv = g.level;
  const cands: Pos[] = [];
  for (let r = 0; r <= 3 && !cands.length; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (!inBounds(lv, nx, ny) || !canHoldObject(tileAt(lv, nx, ny))) continue;
      if (lv.items.filter(f => f.x === nx && f.y === ny).length >= 8) continue;
      cands.push({ x: nx, y: ny });
    }
  }
  if (!cands.length) return null;
  const p = cands[randint0(cands.length)];
  for (const f of lv.items) if (f.x === p.x && f.y === p.y && canStack(f.item, it, g.flavors)) { absorb(f.item, it); return p; }
  lv.items.push({ x: p.x, y: p.y, item: it });
  if (hasFlag(lv, p.x, p.y, F.SEEN)) g.stats.itemsFound++;
  return p;
}

/** Light or darken the room the grid belongs to (flood over ROOM grids), or a radius if no room. */
export function lightArea(g: Game, x: number, y: number, light: boolean): void {
  const lv = g.level;
  const inRoom = hasFlag(lv, x, y, F.ROOM);
  const seen = new Set<number>();
  const stack = [y * lv.w + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (seen.has(i)) continue;
    seen.add(i);
    const cx = i % lv.w, cy = Math.floor(i / lv.w);
    if (light) addFlag(lv, cx, cy, F.GLOW | F.MARK); else clearFlag(lv, cx, cy, F.GLOW);
    for (let d = 1; d <= 9; d++) {
      if (d === 5) continue;
      const nx = cx + DIR_DX[d], ny = cy + DIR_DY[d];
      if (!inBounds(lv, nx, ny)) continue;
      const j = ny * lv.w + nx;
      if (seen.has(j)) continue;
      if (inRoom) { if (hasFlag(lv, nx, ny, F.ROOM)) stack.push(j); else { if (light) addFlag(lv, nx, ny, F.GLOW | F.MARK); else clearFlag(lv, nx, ny, F.GLOW); } }
      else if (Math.max(Math.abs(nx - x), Math.abs(ny - y)) <= 3 && tileAt(lv, nx, ny) !== T.PERM) { if (tileAt(lv, cx, cy) === T.FLOOR || tileAt(lv, cx, cy) === T.DOOR_OPEN || (cx === x && cy === y)) stack.push(j); }
    }
  }
}
