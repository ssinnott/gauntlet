// Dungeon generation in the Angband tradition: rooms of several shapes scattered over a block grid,
// winding tunnels that pierce room walls and get doors, magma and quartz streamers with treasure,
// rubble, hidden traps, several staircases each way, and lesser vaults. Monsters and objects are
// placed afterwards by the callbacks in `GenHooks` so this file knows nothing about their tables.
import { rng } from '../../lib/engine/rng.ts';
import { type Level, type Pos, type Room, T, F, isWall, isPassable, DIR_DX, DIR_DY } from '../types.ts';
import { createLevel, tileAt, setTile, addFlag, hasFlag, setAux, isCleanFloor, nextToWalls, inBounds, randomEmptyFloor } from '../level.ts';
import { randint0, randint1, oneIn, randnor, shuffle } from '../util.ts';
import { DUN_W, DUN_H } from '../../constants.ts';
import { TRAP_KINDS } from '../types.ts';

export interface GenHooks {
  /** Place a random monster suited to `depth` at (x, y); `sleep` = asleep, `group` allows friends. */
  placeMonster(lv: Level, depth: number, x: number, y: number, sleep: boolean, group: boolean): void;
  /** Place a monster nest / pit occupant of a theme at (x, y). */
  placeThemedMonster(lv: Level, depth: number, x: number, y: number, theme: string): void;
  /** Place a Gauntlet generator (monster spawner) at (x, y). */
  placeGenerator(lv: Level, depth: number, x: number, y: number): void;
  /** Drop a random object at (x, y). */
  placeObject(lv: Level, depth: number, x: number, y: number, good: boolean, great: boolean): void;
  placeGold(lv: Level, depth: number, x: number, y: number): void;
}

const BLOCK = 11;
const ROOM_ATTEMPTS = 80;

export function generateDungeon(depth: number, hooks: GenHooks, arrivedBy: 'down' | 'up' | 'none'): { level: Level; start: Pos } {
  for (let attempt = 0; attempt < 20; attempt++) {
    const lv = createLevel(DUN_W, DUN_H, depth);
    const ok = build(lv, depth, hooks);
    if (!ok) continue;
    const start = pickStart(lv, arrivedBy);
    if (!start) continue;
    return { level: lv, start };
  }
  // A generator that fails twenty times in a row is a bug, but never strand the player: a plain cave.
  const lv = createLevel(DUN_W, DUN_H, depth);
  for (let y = 1; y < lv.h - 1; y++) for (let x = 1; x < lv.w - 1; x++) setTile(lv, x, y, T.FLOOR);
  borderPerm(lv);
  setTile(lv, 5, 5, T.STAIRS_UP); setTile(lv, lv.w - 6, lv.h - 6, T.STAIRS_DOWN);
  return { level: lv, start: { x: 6, y: 5 } };
}

function borderPerm(lv: Level): void {
  for (let x = 0; x < lv.w; x++) { setTile(lv, x, 0, T.PERM); setTile(lv, x, lv.h - 1, T.PERM); }
  for (let y = 0; y < lv.h; y++) { setTile(lv, 0, y, T.PERM); setTile(lv, lv.w - 1, y, T.PERM); }
}

function build(lv: Level, depth: number, hooks: GenHooks): boolean {
  const bw = Math.floor(lv.w / BLOCK), bh = Math.floor(lv.h / BLOCK);
  const used = new Uint8Array(bw * bh);
  const centres: Pos[] = [];

  // Rooms: keep trying until the block grid is full or the attempts run out.
  const wanted = 9 + randint1(6);
  for (let i = 0; i < ROOM_ATTEMPTS && centres.length < wanted; i++) {
    const kind = pickRoomKind(depth);
    const bx = randint0(bw), by = randint0(bh);
    const r = buildRoom(lv, depth, kind, bx, by, used, bw, bh);
    if (r) centres.push(r);
  }
  if (centres.length < 3) return false;
  // Tunnels: connect each room to the next in a shuffled order, then one extra link for a loop.
  shuffle(centres);
  for (let i = 1; i < centres.length; i++) tunnel(lv, centres[i - 1], centres[i]);
  if (centres.length > 3) tunnel(lv, centres[randint0(centres.length)], centres[randint0(centres.length)]);
  borderPerm(lv);
  // Streamers.
  for (let i = 0; i < 2 + randint0(2); i++) streamer(lv, T.MAGMA, 30 + randint0(60), 2);
  for (let i = 0; i < 1 + randint0(2); i++) streamer(lv, T.QUARTZ, 40 + randint0(60), 3);
  // Doors at corridor junctions and where tunnels enter rooms.
  placeDoors(lv, depth);
  // Stairs.
  if (!allocStairs(lv, T.STAIRS_DOWN, 1 + randint0(2)) || !allocStairs(lv, T.STAIRS_UP, 1 + randint0(2))) return false;
  // Rubble and traps.
  for (let i = 0, n = randint1(3) + 1; i < n; i++) allocCorridor(lv, T.RUBBLE);
  const traps = randnor(Math.min(depth, 20) / 3 + 2, 2);
  for (let i = 0; i < traps; i++) { const p = randomEmptyFloor(lv, () => rng.next()); if (p) { setTile(lv, p.x, p.y, T.TRAP_HIDDEN); setAux(lv, p.x, p.y, pickTrap(depth)); } }
  // Monsters: Angband's 14 + randint(8), plus one per extra depth band, all asleep.
  const nMon = 14 + randint1(8) + Math.floor(depth / 5);
  for (let i = 0; i < nMon; i++) {
    const p = randomEmptyFloor(lv, () => rng.next());
    if (p) hooks.placeMonster(lv, depth, p.x, p.y, true, true);
  }
  // Gauntlet generators: one or two per level from depth 2, more deeper.
  if (depth >= 2) {
    const nGen = 1 + randint0(2) + (depth >= 15 ? 1 : 0) + (depth >= 30 ? 1 : 0);
    for (let i = 0; i < nGen; i++) { const p = randomEmptyFloor(lv, () => rng.next()); if (p) hooks.placeGenerator(lv, depth, p.x, p.y); }
  }
  // Objects and gold.
  const nObj = Math.max(1, randnor(9, 3)), nGold = Math.max(1, randnor(3, 2)), nRoomObj = Math.max(1, randnor(4, 3));
  for (let i = 0; i < nObj; i++) allocObjectAt(lv, depth, hooks, 'any', false);
  for (let i = 0; i < nGold; i++) allocObjectAt(lv, depth, hooks, 'any', true);
  for (let i = 0; i < nRoomObj; i++) allocObjectAt(lv, depth, hooks, 'room', false);
  // Occasional treasure in mineral veins.
  for (let i = 0; i < lv.tiles.length; i++) {
    if (lv.tiles[i] === T.MAGMA && oneIn(12)) lv.tiles[i] = T.MAGMA_K;
    else if (lv.tiles[i] === T.QUARTZ && oneIn(8)) lv.tiles[i] = T.QUARTZ_K;
  }
  runPending(lv, hooks);
  lv.feeling = 0;
  return true;
}

type RoomKind = 'simple' | 'overlap' | 'cross' | 'inner' | 'circle' | 'nest' | 'vault' | 'pillars' | 'moat';
function pickRoomKind(depth: number): RoomKind {
  const r = randint0(100);
  if (depth >= 5 && r < 4) return 'nest';
  if (depth >= 8 && r < 7) return 'vault';
  if (r < 15) return 'inner';
  if (r < 25) return 'cross';
  if (r < 35) return 'overlap';
  if (r < 42) return 'circle';
  if (r < 50) return 'pillars';
  if (depth >= 10 && r < 56) return 'moat';
  return 'simple';
}

/**
 * Reserve blocks for a room. Like Angband, a room also reserves the ring of blocks around it, which
 * is what keeps rooms apart and leaves most of the level as solid rock for the tunnels to wind through.
 */
function claim(used: Uint8Array, bw: number, bh: number, bx0: number, by0: number, bx1: number, by1: number): boolean {
  if (bx0 < 0 || by0 < 0 || bx1 >= bw || by1 >= bh) return false;
  for (let y = by0 - 1; y <= by1 + 1; y++) for (let x = bx0 - 1; x <= bx1 + 1; x++) {
    if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
    if (used[y * bw + x]) return false;
  }
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) used[y * bw + x] = 1;
  return true;
}

function carveRect(lv: Level, x1: number, y1: number, x2: number, y2: number, t: number, lit: boolean, room: boolean): void {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
    setTile(lv, x, y, t);
    if (room) addFlag(lv, x, y, F.ROOM);
    if (lit) addFlag(lv, x, y, F.GLOW);
  }
}
/** Mark the wall ring around a room (so it glows with the room and reads as the room's outer wall). */
function ringWalls(lv: Level, x1: number, y1: number, x2: number, y2: number, lit: boolean): void {
  for (let y = y1 - 1; y <= y2 + 1; y++) for (let x = x1 - 1; x <= x2 + 1; x++) {
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) continue;
    if (tileAt(lv, x, y) === T.GRANITE) { if (lit) addFlag(lv, x, y, F.GLOW); }
  }
}

function buildRoom(lv: Level, depth: number, kind: RoomKind, bx: number, by: number, used: Uint8Array, bw: number, bh: number): Pos | null {
  const lit = depth <= randint1(25);
  let w: number, h: number;
  if (kind === 'vault' || kind === 'nest' || kind === 'moat' || kind === 'inner') { w = 2; h = 1; }
  else if (kind === 'cross' || kind === 'overlap' || kind === 'circle') { w = 2; h = 1; }
  else { w = oneIn(3) ? 2 : 1; h = 1; }
  if (!claim(used, bw, bh, bx, by, bx + w - 1, by + h - 1)) return null;
  const px0 = bx * BLOCK + 1, py0 = by * BLOCK + 1;
  const px1 = (bx + w) * BLOCK - 2, py1 = (by + h) * BLOCK - 2;
  if (px1 >= lv.w - 1 || py1 >= lv.h - 1) return null;
  const cx = Math.floor((px0 + px1) / 2), cy = Math.floor((py0 + py1) / 2);
  const room: Room = { x1: px0, y1: py0, x2: px1, y2: py1, lit };

  switch (kind) {
    case 'simple': {
      const rw = randint1(11) + 4, rh = randint1(4) + 2;
      const x1 = Math.max(px0, cx - (rw >> 1)), y1 = Math.max(py0, cy - (rh >> 1));
      const x2 = Math.min(px1, x1 + rw), y2 = Math.min(py1, y1 + rh);
      carveRect(lv, x1, y1, x2, y2, T.FLOOR, lit, true); ringWalls(lv, x1, y1, x2, y2, lit);
      room.x1 = x1; room.y1 = y1; room.x2 = x2; room.y2 = y2;
      if (oneIn(20)) for (let y = y1; y <= y2; y += 2) for (let x = x1; x <= x2; x += 2) setTile(lv, x, y, T.GRANITE); // pillared
      break;
    }
    case 'pillars': {
      const x1 = px0 + 1, y1 = py0 + 1, x2 = px1 - 1, y2 = py1 - 1;
      carveRect(lv, x1, y1, x2, y2, T.FLOOR, lit, true); ringWalls(lv, x1, y1, x2, y2, lit);
      for (let y = y1 + 1; y < y2; y += 2) for (let x = x1 + 1; x < x2; x += 3) setTile(lv, x, y, T.GRANITE);
      room.x1 = x1; room.y1 = y1; room.x2 = x2; room.y2 = y2;
      break;
    }
    case 'overlap': {
      for (let k = 0; k < 2; k++) {
        const x1 = cx - randint1(8), x2 = cx + randint1(8), y1 = cy - randint1(3), y2 = cy + randint1(3);
        carveRect(lv, Math.max(px0, x1), Math.max(py0, y1), Math.min(px1, x2), Math.min(py1, y2), T.FLOOR, lit, true);
      }
      break;
    }
    case 'cross': {
      const a = randint1(3) + 1, b = randint1(3) + 1;
      carveRect(lv, Math.max(px0, cx - a), Math.max(py0, cy - 7), Math.min(px1, cx + a), Math.min(py1, cy + 7), T.FLOOR, lit, true);
      carveRect(lv, Math.max(px0, cx - 10), Math.max(py0, cy - b), Math.min(px1, cx + 10), Math.min(py1, cy + b), T.FLOOR, lit, true);
      if (oneIn(3)) { setTile(lv, cx, cy, T.GRANITE); if (a > 1 && b > 1) { setTile(lv, cx - 1, cy, T.GRANITE); setTile(lv, cx + 1, cy, T.GRANITE); } }
      break;
    }
    case 'circle': {
      const r = 3 + randint0(3);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - 2 * r; x <= cx + 2 * r; x++) {
        const dx = (x - cx) / 2, dy = y - cy;
        if (dx * dx + dy * dy <= r * r + 0.5 && x > px0 - 1 && x < px1 + 1 && y > py0 - 1 && y < py1 + 1) { setTile(lv, x, y, T.FLOOR); addFlag(lv, x, y, F.ROOM); if (lit) addFlag(lv, x, y, F.GLOW); }
      }
      if (oneIn(2)) setTile(lv, cx, cy, T.GRANITE);
      break;
    }
    case 'inner': case 'moat': case 'nest': case 'vault': {
      const x1 = px0 + 1, y1 = py0 + 1, x2 = px1 - 1, y2 = py1 - 1;
      carveRect(lv, x1, y1, x2, y2, T.FLOOR, lit, true); ringWalls(lv, x1, y1, x2, y2, lit);
      room.x1 = x1; room.y1 = y1; room.x2 = x2; room.y2 = y2;
      // Inner room walls.
      const ix1 = x1 + 2, iy1 = y1 + 2, ix2 = x2 - 2, iy2 = y2 - 2;
      for (let x = ix1; x <= ix2; x++) { setTile(lv, x, iy1, T.GRANITE); setTile(lv, x, iy2, T.GRANITE); }
      for (let y = iy1; y <= iy2; y++) { setTile(lv, ix1, y, T.GRANITE); setTile(lv, ix2, y, T.GRANITE); }
      // A door into the inner room on a random side.
      const side = randint0(4);
      const dx = side === 0 ? ix1 : side === 1 ? ix2 : ix1 + 1 + randint0(ix2 - ix1 - 1);
      const dy = side === 2 ? iy1 : side === 3 ? iy2 : iy1 + 1 + randint0(iy2 - iy1 - 1);
      setTile(lv, dx, dy, kind === 'vault' ? T.SECRET_DOOR : T.DOOR_CLOSED);
      if (kind === 'vault' || depth > 10 && oneIn(2)) setAux(lv, dx, dy, 1 + randint0(Math.min(7, 1 + depth / 5)));
      if (kind === 'inner') {
        // Treasure in the inner room, sometimes guarded.
        const ox = ix1 + 1 + randint0(ix2 - ix1 - 1), oy = iy1 + 1 + randint0(iy2 - iy1 - 1);
        pending(lv).push((h: GenHooks) => { h.placeObject(lv, depth, ox, oy, true, false); if (oneIn(2)) h.placeMonster(lv, depth + 2, ox, oy, true, false); });
        if (oneIn(3)) for (let y = iy1 + 2; y < iy2 - 1; y += 2) for (let x = ix1 + 2; x < ix2 - 1; x += 2) setTile(lv, x, y, T.GRANITE);
      } else if (kind === 'moat') {
        // The inner room is ringed by water-like rubble... we have no water in the dungeon, so a pillar maze.
        for (let y = iy1 + 1; y < iy2; y++) for (let x = ix1 + 1; x < ix2; x++) if ((x + y) % 2 === 0 && oneIn(2)) setTile(lv, x, y, T.RUBBLE);
        pending(lv).push((h: GenHooks) => { for (let i = 0; i < 3; i++) { const ox = ix1 + 1 + randint0(ix2 - ix1 - 1), oy = iy1 + 1 + randint0(iy2 - iy1 - 1); if (isCleanFloor(lv, ox, oy)) h.placeObject(lv, depth, ox, oy, oneIn(2), false); } });
      } else if (kind === 'nest') {
        const theme = pickNestTheme(depth);
        pending(lv).push((h: GenHooks) => {
          for (let y = iy1 + 1; y < iy2; y++) for (let x = ix1 + 1; x < ix2; x++) if (isCleanFloor(lv, x, y) && !oneIn(3)) h.placeThemedMonster(lv, depth, x, y, theme);
        });
      } else {
        // Lesser vault: flagged so stairs and teleports avoid it; full of good loot and tough monsters.
        for (let y = iy1; y <= iy2; y++) for (let x = ix1; x <= ix2; x++) { addFlag(lv, x, y, F.VAULT); if (isWall(tileAt(lv, x, y)) && tileAt(lv, x, y) !== T.SECRET_DOOR) setTile(lv, x, y, T.PERM); }
        pending(lv).push((h: GenHooks) => {
          for (let y = iy1 + 1; y < iy2; y++) for (let x = ix1 + 1; x < ix2; x++) {
            if (!isCleanFloor(lv, x, y)) continue;
            const r = randint0(10);
            if (r < 3) h.placeMonster(lv, depth + 5, x, y, true, false);
            else if (r < 5) h.placeObject(lv, depth + 5, x, y, true, oneIn(4));
            else if (r < 6) { setTile(lv, x, y, T.TRAP_HIDDEN); setAux(lv, x, y, pickTrap(depth)); }
          }
        });
      }
      break;
    }
  }
  lv.rooms.push(room);
  return { x: cx, y: cy };
}

type Pending = Array<(h: GenHooks) => void>;
function pending(lv: Level): Pending {
  const o = lv as unknown as { __pending?: Pending };
  o.__pending ??= [];
  return o.__pending;
}
/** Run the room-content placers (called by generateDungeon after monsters are otherwise placed). */
export function runPending(lv: Level, hooks: GenHooks): void {
  const o = lv as unknown as { __pending?: Pending };
  for (const f of o.__pending || []) f(hooks);
  delete o.__pending;
}

export function pickNestTheme(depth: number): string {
  const themes: string[] = ['animal'];
  if (depth >= 5) themes.push('kobold', 'jelly');
  if (depth >= 10) themes.push('orc');
  if (depth >= 20) themes.push('troll', 'undead');
  if (depth >= 30) themes.push('giant', 'demon');
  if (depth >= 40) themes.push('dragon');
  return themes[randint0(themes.length)];
}

function pickTrap(depth: number): number {
  const n = TRAP_KINDS.length;
  // Trap doors and pits are common everywhere; the nastier runes turn up deeper.
  for (let i = 0; i < 20; i++) {
    const k = randint0(n);
    if (k >= 6 && depth < 5) continue;
    if (k >= 11 && depth < 15) continue;
    return k;
  }
  return 1;
}

/** Carve a winding tunnel from a to b through granite only, piercing room walls (which get doors later). */
function tunnel(lv: Level, a: Pos, b: Pos): void {
  let x = a.x, y = a.y;
  let dx = Math.sign(b.x - x), dy = Math.sign(b.y - y);
  if (dx && dy) { if (oneIn(2)) dx = 0; else dy = 0; }
  let steps = 0;
  const marks: Pos[] = [];
  while ((x !== b.x || y !== b.y) && steps++ < 2000) {
    // Occasionally change direction; always correct toward the target when way off.
    if (oneIn(8) || (dx === 0 && dy === 0)) {
      const px = Math.sign(b.x - x), py = Math.sign(b.y - y);
      if (oneIn(6) && !(px === 0 && py === 0)) { const r = randint0(4); dx = r === 0 ? 1 : r === 1 ? -1 : 0; dy = r === 2 ? 1 : r === 3 ? -1 : 0; }
      else if (px !== 0 && (py === 0 || oneIn(2))) { dx = px; dy = 0; } else if (py !== 0) { dx = 0; dy = py; }
    }
    const nx = x + dx, ny = y + dy;
    if (nx <= 0 || ny <= 0 || nx >= lv.w - 1 || ny >= lv.h - 1) { dx = Math.sign(b.x - x); dy = Math.sign(b.y - y); if (dx && dy) dy = 0; continue; }
    const t = tileAt(lv, nx, ny);
    if (t === T.PERM) { dx = Math.sign(b.x - x); dy = Math.sign(b.y - y); if (dx && dy) dy = 0; if (dx === 0 && dy === 0) break; continue; }
    if (t === T.GRANITE) {
      // Entering a room wall? Only from a floor grid on the far side, and mark for a door.
      const beyond = tileAt(lv, nx + dx, ny + dy);
      const wasRoomWall = hasFlag(lv, nx + dx, ny + dy, F.ROOM) && beyond === T.FLOOR;
      setTile(lv, nx, ny, T.FLOOR);
      if (wasRoomWall) marks.push({ x: nx, y: ny });
    }
    x = nx; y = ny;
  }
  for (const m of marks) if (oneIn(3)) { const d = randint0(6); setTile(lv, m.x, m.y, d === 0 ? T.SECRET_DOOR : d < 3 ? T.DOOR_CLOSED : d < 5 ? T.DOOR_OPEN : T.DOOR_BROKEN); }
}

function streamer(lv: Level, t: number, len: number, chanceK: number): void {
  let x = randint1(lv.w - 2), y = randint1(lv.h - 2);
  let dir = randint1(9); if (dir === 5) dir = 1;
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < 4; j++) {
      const ox = x + randint0(5) - 2, oy = y + randint0(5) - 2;
      if (tileAt(lv, ox, oy) === T.GRANITE) setTile(lv, ox, oy, oneIn(chanceK * 10) ? (t === T.MAGMA ? T.MAGMA_K : T.QUARTZ_K) : t);
    }
    x += DIR_DX[dir]; y += DIR_DY[dir];
    if (x <= 0 || y <= 0 || x >= lv.w - 1 || y >= lv.h - 1) break;
    if (oneIn(8)) { dir = randint1(9); if (dir === 5) dir = 9; }
  }
}

function placeDoors(lv: Level, depth: number): void {
  for (let y = 1; y < lv.h - 1; y++) for (let x = 1; x < lv.w - 1; x++) {
    if (tileAt(lv, x, y) !== T.FLOOR || hasFlag(lv, x, y, F.ROOM)) continue;
    // A corridor grid with walls on two opposite sides and an opening ahead of a room, or a junction.
    const n = nextToWalls(lv, x, y);
    if (n !== 2) continue;
    const horiz = isWall(tileAt(lv, x - 1, y)) && isWall(tileAt(lv, x + 1, y));
    const vert = isWall(tileAt(lv, x, y - 1)) && isWall(tileAt(lv, x, y + 1));
    if (!horiz && !vert) continue;
    const intoRoom = (horiz && (hasFlag(lv, x, y - 1, F.ROOM) || hasFlag(lv, x, y + 1, F.ROOM))) || (vert && (hasFlag(lv, x - 1, y, F.ROOM) || hasFlag(lv, x + 1, y, F.ROOM)));
    if (intoRoom ? oneIn(2) : oneIn(30)) {
      const r = randint0(10);
      setTile(lv, x, y, r < 4 ? T.DOOR_CLOSED : r < 7 ? T.DOOR_OPEN : r < 8 ? T.DOOR_BROKEN : T.SECRET_DOOR);
      if (r < 4 && oneIn(4)) setAux(lv, x, y, 1 + randint0(Math.min(7, 1 + Math.floor(depth / 5))));
    }
  }
}

function allocStairs(lv: Level, t: number, n: number): boolean {
  for (let i = 0; i < n; i++) {
    let placed = false;
    for (let j = 0; j < 3000 && !placed; j++) {
      const x = randint1(lv.w - 2), y = randint1(lv.h - 2);
      if (!isCleanFloor(lv, x, y) || hasFlag(lv, x, y, F.VAULT)) continue;
      if (nextToWalls(lv, x, y) < 2) continue;
      setTile(lv, x, y, t); placed = true;
    }
    if (!placed && i === 0) return false;
  }
  return true;
}
function allocCorridor(lv: Level, t: number): void {
  for (let j = 0; j < 1000; j++) {
    const x = randint1(lv.w - 2), y = randint1(lv.h - 2);
    if (!isCleanFloor(lv, x, y) || hasFlag(lv, x, y, F.ROOM) || nextToWalls(lv, x, y) < 2) continue;
    setTile(lv, x, y, t); return;
  }
}
function allocObjectAt(lv: Level, depth: number, hooks: GenHooks, where: 'any' | 'room' | 'corridor', gold: boolean): void {
  for (let j = 0; j < 500; j++) {
    const x = randint1(lv.w - 2), y = randint1(lv.h - 2);
    if (!isCleanFloor(lv, x, y) || hasFlag(lv, x, y, F.VAULT)) continue;
    if (where === 'room' && !hasFlag(lv, x, y, F.ROOM)) continue;
    if (where === 'corridor' && hasFlag(lv, x, y, F.ROOM)) continue;
    if (gold) hooks.placeGold(lv, depth, x, y); else hooks.placeObject(lv, depth, x, y, false, false);
    return;
  }
}

/** Where the player appears: on a staircase of the matching kind (connected stairs), else anywhere. */
function pickStart(lv: Level, arrivedBy: 'down' | 'up' | 'none'): Pos | null {
  const want = arrivedBy === 'down' ? T.STAIRS_UP : arrivedBy === 'up' ? T.STAIRS_DOWN : -1;
  const cands: Pos[] = [];
  if (want >= 0) for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (tileAt(lv, x, y) === want && !lv.monsters.some(m => m.x === x && m.y === y)) cands.push({ x, y });
  if (cands.length) return cands[randint0(cands.length)];
  return randomEmptyFloor(lv, () => rng.next());
}

/** Sanity used by the simulator: every floor grid should reach a down staircase. */
export function isConnected(lv: Level): boolean {
  let sx = -1, sy = -1;
  for (let y = 0; y < lv.h && sx < 0; y++) for (let x = 0; x < lv.w; x++) if (tileAt(lv, x, y) === T.STAIRS_DOWN) { sx = x; sy = y; break; }
  if (sx < 0) return false;
  const seen = new Uint8Array(lv.w * lv.h);
  const stack = [sy * lv.w + sx]; seen[sy * lv.w + sx] = 1;
  while (stack.length) {
    const i = stack.pop()!; const x = i % lv.w, y = Math.floor(i / lv.w);
    for (let d = 1; d <= 9; d++) {
      if (d === 5) continue;
      const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
      if (!inBounds(lv, nx, ny)) continue;
      const j = ny * lv.w + nx;
      if (seen[j]) continue;
      const t = lv.tiles[j];
      if (!(isPassable(t) || t === T.DOOR_CLOSED || t === T.SECRET_DOOR || t === T.RUBBLE)) continue;
      seen[j] = 1; stack.push(j);
    }
  }
  let reach = 0, total = 0;
  for (let i = 0; i < lv.tiles.length; i++) if (lv.tiles[i] === T.FLOOR) { total++; if (seen[i]) reach++; }
  return reach / Math.max(1, total) > 0.85;
}
