// The town: a walled village with the eight stores as solid buildings, each with one entrance
// facing a road, grass and trees between them, and the dungeon entrance in the middle. Always lit.
import { type Level, type Pos, T, F } from '../types.ts';
import { createLevel, setTile, addFlag, tileAt } from '../level.ts';
import { randint0, oneIn, shuffle } from '../util.ts';
import { TOWN_W, TOWN_H } from '../../constants.ts';

export interface TownHooks {
  placeTownMonster(lv: Level, x: number, y: number): void;
}

export function generateTown(hooks: TownHooks, arrivedBy: 'up' | 'none'): { level: Level; start: Pos } {
  const lv = createLevel(TOWN_W, TOWN_H, 0);
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
    const edge = x === 0 || y === 0 || x === lv.w - 1 || y === lv.h - 1;
    setTile(lv, x, y, edge ? T.PERM : T.GRASS);
    addFlag(lv, x, y, F.GLOW | F.MARK);
  }
  // A cobbled cross of roads.
  const midY = Math.floor(lv.h / 2);
  for (let x = 1; x < lv.w - 1; x++) for (let y = midY - 1; y <= midY + 1; y++) setTile(lv, x, y, T.ROAD);
  for (const rx of [Math.floor(lv.w / 4), Math.floor(lv.w / 2), Math.floor(lv.w * 3 / 4)]) for (let y = 1; y < lv.h - 1; y++) for (let x = rx - 1; x <= rx + 1; x++) setTile(lv, x, y, T.ROAD);

  // Eight buildings in two rows of four, entrances toward the middle road.
  const order = shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  const bw = 9, bh = 6;
  const gapX = Math.floor((lv.w - 2 - 4 * bw) / 5);
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const x1 = 1 + gapX + col * (bw + gapX) + (col >= 2 ? 1 : 0);
    const y1 = row === 0 ? 3 : lv.h - 3 - bh;
    const x2 = x1 + bw - 1, y2 = y1 + bh - 1;
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) setTile(lv, x, y, T.PERM);
    const store = order[i];
    const doorX = x1 + 2 + randint0(bw - 4);
    const doorY = row === 0 ? y2 : y1;
    setTile(lv, doorX, doorY, T.SHOP_0 + store);
    // A path from the door to the road.
    const step = row === 0 ? 1 : -1;
    for (let y = doorY + step; y !== midY - step * 2; y += step) if (tileAt(lv, doorX, y) === T.GRASS) setTile(lv, doorX, y, T.ROAD);
  }
  // Trees scattered on the grass, never blocking a road or a door.
  for (let i = 0; i < 40; i++) {
    const x = 1 + randint0(lv.w - 2), y = 1 + randint0(lv.h - 2);
    if (tileAt(lv, x, y) !== T.GRASS) continue;
    let nearRoad = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(lv, x + dx, y + dy) !== T.GRASS && tileAt(lv, x + dx, y + dy) !== T.TREE) nearRoad = true;
    if (nearRoad && !oneIn(3)) continue;
    setTile(lv, x, y, T.TREE);
  }
  // The dungeon entrance sits on the central crossroads.
  const sx = Math.floor(lv.w / 2), sy = midY;
  setTile(lv, sx, sy, T.STAIRS_DOWN);
  // Townsfolk.
  const n = 4 + randint0(4);
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 50; t++) {
      const x = 1 + randint0(lv.w - 2), y = 1 + randint0(lv.h - 2);
      const tile = tileAt(lv, x, y);
      if ((tile === T.GRASS || tile === T.ROAD) && Math.abs(x - sx) + Math.abs(y - sy) > 6 && !lv.monsters.some(m => m.x === x && m.y === y)) { hooks.placeTownMonster(lv, x, y); break; }
    }
  }
  const start = arrivedBy === 'up' ? { x: sx, y: sy } : { x: sx, y: sy + 2 };
  return { level: lv, start };
}
