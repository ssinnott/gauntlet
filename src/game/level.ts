// The map: tile storage, line of sight, the player's field of view and the flow map monsters
// follow. No DOM here; everything is arrays over a w*h grid.
import { type Level, type Pos, T, F, isPassable, blocksLos, isWall, DIR_DX, DIR_DY } from './types.ts';

export const MAX_SIGHT = 20;

export function createLevel(w: number, h: number, depth: number): Level {
  return { depth, w, h, tiles: new Uint8Array(w * h).fill(T.GRANITE), flags: new Uint8Array(w * h), aux: new Uint8Array(w * h), monsters: [], items: [], rooms: [], feeling: 0, age: 0 };
}

export function inBounds(lv: Level, x: number, y: number): boolean { return x >= 0 && y >= 0 && x < lv.w && y < lv.h; }
export function tileAt(lv: Level, x: number, y: number): number { return inBounds(lv, x, y) ? lv.tiles[y * lv.w + x] : T.PERM; }
export function setTile(lv: Level, x: number, y: number, t: number): void { if (inBounds(lv, x, y)) lv.tiles[y * lv.w + x] = t; }
export function flagAt(lv: Level, x: number, y: number): number { return inBounds(lv, x, y) ? lv.flags[y * lv.w + x] : 0; }
export function hasFlag(lv: Level, x: number, y: number, f: number): boolean { return (flagAt(lv, x, y) & f) !== 0; }
export function addFlag(lv: Level, x: number, y: number, f: number): void { if (inBounds(lv, x, y)) lv.flags[y * lv.w + x] |= f; }
export function clearFlag(lv: Level, x: number, y: number, f: number): void { if (inBounds(lv, x, y)) lv.flags[y * lv.w + x] &= ~f; }
export function auxAt(lv: Level, x: number, y: number): number { return inBounds(lv, x, y) ? lv.aux[y * lv.w + x] : 0; }
export function setAux(lv: Level, x: number, y: number, v: number): void { if (inBounds(lv, x, y)) lv.aux[y * lv.w + x] = v; }

export function passable(lv: Level, x: number, y: number): boolean { return isPassable(tileAt(lv, x, y)); }
export function monsterAt(lv: Level, x: number, y: number) { return lv.monsters.find(m => m.x === x && m.y === y); }
export function itemsAt(lv: Level, x: number, y: number) { return lv.items.filter(i => i.x === x && i.y === y); }
export function isEmptyFloor(lv: Level, x: number, y: number): boolean {
  return tileAt(lv, x, y) === T.FLOOR && !monsterAt(lv, x, y);
}
/** A floor grid with nothing on it at all: no monster, no object, not a stair. */
export function isCleanFloor(lv: Level, x: number, y: number): boolean {
  return isEmptyFloor(lv, x, y) && !lv.items.some(i => i.x === x && i.y === y);
}
/** Count adjacent grids that are walls (used by the generator to find corridor spots). */
export function nextToWalls(lv: Level, x: number, y: number): number {
  let k = 0;
  if (isWall(tileAt(lv, x + 1, y))) k++;
  if (isWall(tileAt(lv, x - 1, y))) k++;
  if (isWall(tileAt(lv, x, y + 1))) k++;
  if (isWall(tileAt(lv, x, y - 1))) k++;
  return k;
}

/**
 * Bresenham-style line of sight, permissive at the ends: true if nothing between (x0,y0) and (x1,y1)
 * blocks sight. The end grids themselves may be walls (you can see a wall).
 */
export function los(lv: Level, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax <= 1 && ay <= 1) return true;
  const steps = Math.max(ax, ay);
  // Walk two lines (offset half a cell each way) and accept if either is clear: this is the classic
  // symmetric-ish permissive LOS that avoids the "can see you but you can't see me" corners.
  for (let pass = 0; pass < 2; pass++) {
    let clear = true;
    const off = pass === 0 ? 0.5 : 0.49999;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const fx = Math.floor(x0 + off + dx * t), fy = Math.floor(y0 + off + dy * t);
      if (blocksLos(tileAt(lv, fx, fy))) { clear = false; break; }
    }
    if (clear) return true;
  }
  return false;
}

/**
 * The path a projectile takes from (x0,y0) toward (x1,y1), up to `range` grids, stopping at the
 * first grid that blocks projection (the wall itself is the last entry so a bolt can hit it).
 * With `stopAtMonster`, the path stops at the first monster it enters (the target grid included).
 */
export function projectPath(lv: Level, x0: number, y0: number, x1: number, y1: number, range: number, stopAtMonster: boolean, out: Pos[] = []): Pos[] {
  out.length = 0;
  let dx = x1 - x0, dy = y1 - y0;
  if (dx === 0 && dy === 0) return out;
  // Extend the line past the target so a direction aims all the way to the range limit.
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const steps = Math.max(ax, ay);
  const n = Math.max(steps, range);
  const sx = dx / steps, sy = dy / steps;
  let px = x0, py = y0;
  for (let i = 1; i <= n; i++) {
    const fx = Math.floor(x0 + 0.5 + sx * i), fy = Math.floor(y0 + 0.5 + sy * i);
    if (fx === px && fy === py) continue;
    px = fx; py = fy;
    if (!inBounds(lv, fx, fy)) break;
    out.push({ x: fx, y: fy });
    if (blocksLos(tileAt(lv, fx, fy))) break;
    if (out.length >= range) break;
    if (stopAtMonster && monsterAt(lv, fx, fy)) break;
  }
  return out;
}

/**
 * Recompute VIEW and SEEN for the whole level from the player's position. A grid is in VIEW when it is
 * within MAX_SIGHT and there is line of sight to it; it is SEEN (and therefore MARKed) when it is also
 * lit -- by the player's own light within `lightRadius`, or because the grid GLOWs.
 * Blind players see nothing.
 */
export function updateView(lv: Level, px: number, py: number, lightRadius: number, blind: boolean, seeAll = false): void {
  const w = lv.w, fl = lv.flags;
  for (let i = 0; i < fl.length; i++) fl[i] &= ~(F.VIEW | F.SEEN);
  if (blind) return;
  const r = MAX_SIGHT;
  for (let y = Math.max(0, py - r); y <= Math.min(lv.h - 1, py + r); y++) {
    for (let x = Math.max(0, px - r); x <= Math.min(lv.w - 1, px + r); x++) {
      const d = Math.max(Math.abs(x - px), Math.abs(y - py));
      if (d > r) continue;
      if (!los(lv, px, py, x, y)) continue;
      const i = y * w + x;
      fl[i] |= F.VIEW;
      const lit = seeAll || (fl[i] & F.GLOW) !== 0 || d <= lightRadius || (isWall(lv.tiles[i]) && litNeighbour(lv, x, y, px, py, lightRadius));
      if (lit) fl[i] |= F.SEEN | F.MARK;
    }
  }
}
/** A wall is visible when a lit floor next to it faces the viewer. */
function litNeighbour(lv: Level, x: number, y: number, px: number, py: number, lightRadius: number): boolean {
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
    if (!inBounds(lv, nx, ny) || isWall(tileAt(lv, nx, ny))) continue;
    const i = ny * lv.w + nx;
    const dist = Math.max(Math.abs(nx - px), Math.abs(ny - py));
    if ((lv.flags[i] & F.GLOW) || dist <= lightRadius) return true;
  }
  return false;
}
export function playerCanSee(lv: Level, x: number, y: number): boolean { return hasFlag(lv, x, y, F.SEEN); }

/**
 * Flow map: BFS distance from the player through passable grids (doors count as passable, since
 * most monsters can open them). Monsters move down the gradient. Limited to `maxDist` steps.
 */
export function computeFlow(lv: Level, px: number, py: number, maxDist: number, out?: Uint16Array): Uint16Array {
  const w = lv.w, h = lv.h;
  const flow = out && out.length === w * h ? out : new Uint16Array(w * h);
  flow.fill(0xffff);
  const qx = new Int32Array(w * h), qy = new Int32Array(w * h);
  let head = 0, tail = 0;
  flow[py * w + px] = 0;
  qx[tail] = px; qy[tail] = py; tail++;
  while (head < tail) {
    const x = qx[head], y = qy[head]; head++;
    const d = flow[y * w + x];
    if (d >= maxDist) continue;
    for (let k = 1; k <= 9; k++) {
      if (k === 5) continue;
      const nx = x + DIR_DX[k], ny = y + DIR_DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const i = ny * w + nx;
      if (flow[i] !== 0xffff) continue;
      const t = lv.tiles[i];
      if (!(isPassable(t) || t === T.DOOR_CLOSED || t === T.SECRET_DOOR)) continue;
      flow[i] = d + 1;
      qx[tail] = nx; qy[tail] = ny; tail++;
    }
  }
  return flow;
}

/** BFS path over grids the player remembers as passable, for click-to-travel. Returns the steps (excluding start). */
export function findPath(lv: Level, x0: number, y0: number, x1: number, y1: number, maxLen = 400): Pos[] | null {
  if (!inBounds(lv, x1, y1)) return null;
  const w = lv.w, h = lv.h;
  const prev = new Int32Array(w * h).fill(-1);
  const qx = new Int32Array(w * h), qy = new Int32Array(w * h);
  let head = 0, tail = 0;
  prev[y0 * w + x0] = y0 * w + x0;
  qx[tail] = x0; qy[tail] = y0; tail++;
  let found = false;
  while (head < tail && !found) {
    const x = qx[head], y = qy[head]; head++;
    for (let k = 1; k <= 9; k++) {
      if (k === 5) continue;
      const nx = x + DIR_DX[k], ny = y + DIR_DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const i = ny * w + nx;
      if (prev[i] !== -1) continue;
      const t = lv.tiles[i];
      const known = (lv.flags[i] & F.MARK) !== 0;
      if (!(nx === x1 && ny === y1) && !(known && (isPassable(t) || t === T.DOOR_CLOSED))) continue;
      prev[i] = y * w + x;
      if (nx === x1 && ny === y1) { found = true; break; }
      qx[tail] = nx; qy[tail] = ny; tail++;
    }
  }
  if (!found) return null;
  const path: Pos[] = [];
  let i = y1 * w + x1;
  while (i !== y0 * w + x0) { path.push({ x: i % w, y: Math.floor(i / w) }); i = prev[i]; if (path.length > maxLen) return null; }
  return path.reverse();
}

/** Pick a random empty floor grid, optionally at least `minDist` away from (ax, ay). */
export function randomEmptyFloor(lv: Level, rnd: () => number, minDist = 0, ax = 0, ay = 0, tries = 2000): Pos | null {
  for (let i = 0; i < tries; i++) {
    const x = 1 + Math.floor(rnd() * (lv.w - 2)), y = 1 + Math.floor(rnd() * (lv.h - 2));
    if (!isCleanFloor(lv, x, y)) continue;
    if (hasFlag(lv, x, y, F.VAULT)) continue;
    if (minDist && Math.max(Math.abs(x - ax), Math.abs(y - ay)) < minDist) continue;
    return { x, y };
  }
  return null;
}
