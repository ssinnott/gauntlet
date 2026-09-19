// Caverns: whole levels with no rooms and no corridors, grown by a cellular automaton the way
// Angband 4.2 does it. Random noise is smoothed until it settles into blobs and winding passages,
// then everything but the largest cave is filled back in, which is what guarantees the level is
// connected -- there is no tunnelling step to fall back on.
import { rng } from '../../lib/engine/rng.ts';
import { type Level, type Pos, T, F } from '../types.ts';
import { createLevel, setTile, addFlag, randomEmptyFloor } from '../level.ts';
import { randint0, randint1, oneIn } from '../util.ts';
import { DUN_W, DUN_H } from '../../constants.ts';
import { type GenHooks, populate, borderPerm, streamer, pickStart, pickTrap } from './dungeon.ts';

/** Share of the interior the cave must cover, or the noise is thrown away and rolled again. */
const MIN_FILL = 0.25;
/** Smoothing passes. Fewer leaves noise; more only rounds the corners off. */
const SMOOTH_PASSES = 5;
/** Open grids in the initial noise. Below about 52% the cave breaks into disconnected pockets. */
const FILL_PCT = 55;

export function generateCavern(depth: number, hooks: GenHooks, arrivedBy: 'down' | 'up' | 'none'): { level: Level; start: Pos } | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const lv = createLevel(DUN_W, DUN_H, depth);
    if (!carve(lv, depth)) continue;
    if (!populate(lv, depth, hooks, false)) continue;
    // A cavern is several times the open area of a rooms-and-corridors level, so the standard
    // allocation would leave it feeling abandoned. Stock the extra ground.
    const extraMon = 8 + randint1(8) + Math.floor(depth / 8);
    for (let i = 0; i < extraMon; i++) { const p = randomEmptyFloor(lv, () => rng.next()); if (p) hooks.placeMonster(lv, depth, p.x, p.y, true, true); }
    for (let i = 0, n = 3 + randint1(4); i < n; i++) { const p = randomEmptyFloor(lv, () => rng.next()); if (p) hooks.placeObject(lv, depth, p.x, p.y, false, false); }
    for (let i = 0, n = 2 + randint1(3); i < n; i++) { const p = randomEmptyFloor(lv, () => rng.next()); if (p) hooks.placeGold(lv, depth, p.x, p.y); }
    const start = pickStart(lv, arrivedBy);
    if (!start) continue;
    lv.kind = 'cavern';
    // A cavern is bigger and darker than a normal level, and worth a little on the feeling.
    lv.rating += 4;
    return { level: lv, start };
  }
  return null;
}

function carve(lv: Level, depth: number): boolean {
  const w = lv.w, h = lv.h;
  const open = new Uint8Array(w * h);
  const next = new Uint8Array(w * h);
  // 1. Noise at the density that settles into caves rather than soup or swiss cheese.
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) open[y * w + x] = randint0(100) < FILL_PCT ? 1 : 0;
  // 2. Smooth with the 4-5 rule: five walls around a grid closes it, and four closes it only if it
  //    was already rock. That hysteresis is what makes the pattern settle instead of running away
  //    to solid stone or to an open field. Outside the border counts as wall, so the cave pulls
  //    away from the edges of the map.
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) { walls++; continue; }
            if (!open[ny * w + nx]) walls++;
          }
        }
        next[y * w + x] = walls >= 5 || (walls === 4 && !open[y * w + x]) ? 0 : 1;
      }
    }
    open.set(next);
  }
  // 3. Keep the largest cave and fill the rest in. Connectivity falls out of this, so there is
  //    nothing left to check afterwards.
  const label = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < open.length; i++) {
    if (!open[i] || label[i] >= 0) continue;
    let size = 0;
    label[i] = id; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const jx = j % w, jy = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = jx + dx, ny = jy + dy;
        if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
        const k = ny * w + nx;
        if (!open[k] || label[k] >= 0) continue;
        label[k] = id; stack.push(k);
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  if (bestSize < (w - 2) * (h - 2) * MIN_FILL) return false;
  for (let i = 0; i < lv.tiles.length; i++) lv.tiles[i] = label[i] === best ? T.FLOOR : T.GRANITE;
  borderPerm(lv);
  // 4. Veins to dig, rubble to clear, and the odd lit pocket so a cavern is not uniformly black.
  for (let i = 0; i < 2 + randint0(3); i++) streamer(lv, T.MAGMA, 40 + randint0(70), 2);
  for (let i = 0; i < 1 + randint0(2); i++) streamer(lv, T.QUARTZ, 50 + randint0(70), 3);
  for (let i = 0; i < lv.tiles.length; i++) {
    if (lv.tiles[i] === T.MAGMA && oneIn(10)) lv.tiles[i] = T.MAGMA_K;
    else if (lv.tiles[i] === T.QUARTZ && oneIn(7)) lv.tiles[i] = T.QUARTZ_K;
  }
  for (let i = 0, n = randint1(6) + 3; i < n; i++) { const p = randomEmptyFloor(lv, () => rng.next()); if (p) setTile(lv, p.x, p.y, T.RUBBLE); }
  for (let i = 0, n = randint1(3); i < n; i++) {
    const p = randomEmptyFloor(lv, () => rng.next());
    if (!p) continue;
    const r = 2 + randint0(3);
    for (let y = p.y - r; y <= p.y + r; y++) for (let x = p.x - r; x <= p.x + r; x++) addFlag(lv, x, y, F.GLOW);
  }
  void depth; void pickTrap;
  return true;
}
