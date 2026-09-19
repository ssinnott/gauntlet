// Labyrinths: a proper maze filling part of the level, carved by a randomised depth-first search
// (Angband's labyrinth_gen). The backtracker produces a perfect maze -- every cell reachable, no
// loops -- and then a few walls are knocked through to give it loops, which keeps it connected and
// makes it survivable rather than a single dead-ended thread.
import { rng } from '../../lib/engine/rng.ts';
import { type Level, type Pos, T, F } from '../types.ts';
import { createLevel, setTile, addFlag, tileAt, randomEmptyFloor } from '../level.ts';
import { randint0, randint1, oneIn } from '../util.ts';
import { DUN_W, DUN_H } from '../../constants.ts';
import { type GenHooks, populate, borderPerm, pickStart } from './dungeon.ts';

/** One wall in this many is knocked through afterwards to make loops. */
const LOOP_CHANCE = 14;

export function generateLabyrinth(depth: number, hooks: GenHooks, arrivedBy: 'down' | 'up' | 'none'): { level: Level; start: Pos } | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const lv = createLevel(DUN_W, DUN_H, depth);
    carve(lv, depth);
    if (!populate(lv, depth, hooks, false)) continue;
    const start = pickStart(lv, arrivedBy);
    if (!start) continue;
    lv.kind = 'labyrinth';
    lv.rating += 6;
    return { level: lv, start };
  }
  return null;
}

function carve(lv: Level, depth: number): void {
  // The maze lives on odd coordinates: cell (cx, cy) is tile (ox + 2cx, oy + 2cy) and the wall
  // between two cells is the tile halfway between them.
  const cw = 24 + randint0(16), ch = 11 + randint0(8);
  const mw = cw * 2 + 1, mh = ch * 2 + 1;
  const ox = 1 + randint0(Math.max(1, lv.w - mw - 1));
  const oy = 1 + randint0(Math.max(1, lv.h - mh - 1));
  const tx = (cx: number) => ox + cx * 2, ty = (cy: number) => oy + cy * 2;

  const visited = new Uint8Array(cw * ch);
  const stack: number[] = [];
  const first = randint0(cw * ch);
  visited[first] = 1;
  stack.push(first);
  setTile(lv, tx(first % cw), ty((first / cw) | 0), T.FLOOR);
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cx = cur % cw, cy = (cur / cw) | 0;
    // Unvisited neighbours, in a shuffled order.
    const cand: number[] = [];
    if (cx > 0 && !visited[cur - 1]) cand.push(4);
    if (cx < cw - 1 && !visited[cur + 1]) cand.push(6);
    if (cy > 0 && !visited[cur - cw]) cand.push(8);
    if (cy < ch - 1 && !visited[cur + cw]) cand.push(2);
    if (!cand.length) { stack.pop(); continue; }
    const d = cand[randint0(cand.length)];
    const nx = cx + (d === 4 ? -1 : d === 6 ? 1 : 0);
    const ny = cy + (d === 8 ? -1 : d === 2 ? 1 : 0);
    const n = ny * cw + nx;
    // Carve the cell and the wall between.
    setTile(lv, tx(nx), ty(ny), T.FLOOR);
    setTile(lv, (tx(cx) + tx(nx)) >> 1, (ty(cy) + ty(ny)) >> 1, T.FLOOR);
    visited[n] = 1;
    stack.push(n);
  }
  // Loops: knock through walls between cells that are already both carved. A perfect maze is one
  // long dead end, which is tedious to walk and lethal to be chased through.
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      if (cx < cw - 1 && oneIn(LOOP_CHANCE)) setTile(lv, tx(cx) + 1, ty(cy), T.FLOOR);
      if (cy < ch - 1 && oneIn(LOOP_CHANCE)) setTile(lv, tx(cx), ty(cy) + 1, T.FLOOR);
    }
  }
  borderPerm(lv);
  // Doors across some passages, and rubble to squeeze past.
  for (let i = 0, n = 4 + randint0(8); i < n; i++) {
    const p = randomEmptyFloor(lv, () => rng.next());
    if (!p) continue;
    const ew = tileAt(lv, p.x - 1, p.y) === T.FLOOR && tileAt(lv, p.x + 1, p.y) === T.FLOOR;
    const ns = tileAt(lv, p.x, p.y - 1) === T.FLOOR && tileAt(lv, p.x, p.y + 1) === T.FLOOR;
    if (ew !== ns) setTile(lv, p.x, p.y, oneIn(4) ? T.SECRET_DOOR : T.DOOR_CLOSED);
  }
  for (let i = 0, n = randint1(4); i < n; i++) { const p = randomEmptyFloor(lv, () => rng.next()); if (p) setTile(lv, p.x, p.y, T.RUBBLE); }
  // Shallow labyrinths are lit, which is how Angband keeps them from being pure tedium. Deeper ones
  // are dark, and considerably worse.
  if (depth < 30 || oneIn(4)) {
    for (let y = oy; y < oy + mh; y++) for (let x = ox; x < ox + mw; x++) if (tileAt(lv, x, y) !== T.PERM) addFlag(lv, x, y, F.GLOW);
  }
}
