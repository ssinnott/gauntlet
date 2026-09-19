// The map view: a 3/4 top-down dungeon in Gauntlet colours. Floors are flat, walls are raised blocks
// with a lit top and a shaded front face, and everything on a tile is drawn in row order so a body
// south of a wall overlaps it. Effects (bolts, balls, hit numbers, shakes) animate here too.
import { TILE, WALL_H, MAP_X, MAP_Y, MAP_W, MAP_H, MAP_COLS, MAP_ROWS } from '../constants.ts';
import { type Level, type Monster, type Pos, T, F, isShop, isWall } from '../game/types.ts';
import { tileAt, flagAt, auxAt } from '../game/level.ts';
import { raceOf, hasMFlag } from '../game/monster.ts';
import { kindOf, itemIcon } from '../game/items.ts';
import { isIgnored } from '../game/ignore.ts';
import type { Game, Fx } from '../game/state.ts';
import { drawMonsterSprite, drawItemIcon } from './sprites.ts';
import { drawHero, heroPlay, type HeroSprite } from './hero.ts';
import { drawText } from '../lib/engine/text.ts';
import { shade, mix, rgba } from '../lib/art/palettes.ts';
import { ELEMENT_COLOR } from '../game/projection.ts';
import { clamp, lerp } from '../lib/engine/math.ts';

// Palette: Gauntlet's blue-grey stone, warm torchlight, bright hazards.
const COL = {
  void: '#07060b', floor: '#3a3d52', floorLine: '#2e3144', floorLit: '#494c66', wallTop: '#6b6f8c', wallEdge: '#8a8fb0', wallFront: '#3f4260', wallFrontLine: '#2b2d44',
  perm: '#5a4a6a', permTop: '#7a6a8a', magma: '#5a3a30', magmaTop: '#7a4a3a', quartz: '#a8a4b8', quartzTop: '#d0ccdc', treasure: '#ffd040',
  door: '#8a5a2a', doorDark: '#5a3a1a', doorIron: '#9098a8', rubble: '#6a6a72', stairs: '#1a1a26', trap: '#ff4060', grass: '#3a6a34', grassLit: '#4c8040', road: '#8a7a5a', roadLine: '#6a5c44', tree: '#2a5a2a', treeTop: '#4a8a3a', trunk: '#5a3a1a', water: '#2a4a8a',
  building: '#7a5a48', buildingTop: '#a07860', buildingLine: '#4a3628',
};
const SHOP_COLORS = ['#e0c060', '#c04040', '#4060c0', '#e0e0e0', '#40c060', '#a040c0', '#404040', '#f0a040'];
const SHOP_SHORT = ['GENERAL', 'ARMOURY', 'WEAPONS', 'TEMPLE', 'ALCHEMY', 'MAGIC', 'BLACK MKT', 'HOME'];

interface ActiveFx { fx: Fx; t: number; life: number; }

export class MapRenderer {
  camX = 0; camY = 0;           // camera top-left in world px
  shake = 0;
  active: ActiveFx[] = [];
  phase = 0;
  hero: HeroSprite | null = null;
  heroFlash = 0;
  /** Cursor for look/target mode, in tiles; null when off. */
  cursor: Pos | null = null;
  /** Tiles highlighted (e.g. the travel path). */
  hilite: Pos[] = [];
  /** Locate mode: the camera centres on this tile instead of the player. */
  camLock: Pos | null = null;

  /** Per-frame update: interpolate positions, tick effects. */
  update(g: Game, dtFrames = 1): void {
    this.phase = (this.phase + 0.012 * dtFrames) % 1;
    const p = g.player;
    // Visual position: slide from the previous tile to the current one.
    if (p.vx == null) { p.vx = p.x; p.vy = p.y; }
    else { p.vx = approachTile(p.vx, p.x, 0.35); p.vy = approachTile(p.vy!, p.y, 0.35); }
    for (const m of g.level.monsters) {
      if (m.vx == null) { m.vx = m.x; m.vy = m.y; }
      else { m.vx = approachTile(m.vx, m.x, 0.3); m.vy = approachTile(m.vy!, m.y, 0.3); }
      if (m.hitFlash) m.hitFlash--;
      if (m.attackAnim) m.attackAnim--;
    }
    // Camera follows the visual position and clamps to the level.
    const lv = g.level;
    const cx = this.camLock ? this.camLock.x : p.vx!, cy = this.camLock ? this.camLock.y : p.vy!;
    const wx = (cx + 0.5) * TILE - MAP_W / 2, wy = (cy + 0.5) * TILE - MAP_H / 2;
    const maxX = Math.max(0, lv.w * TILE - MAP_W), maxY = Math.max(0, lv.h * TILE - MAP_H);
    const tx = clamp(wx, 0, maxX), ty = clamp(wy, 0, maxY);
    this.camX = lv.w * TILE < MAP_W ? (lv.w * TILE - MAP_W) / 2 : lerp(this.camX, tx, 0.25);
    this.camY = lv.h * TILE < MAP_H ? (lv.h * TILE - MAP_H) / 2 : lerp(this.camY, ty, 0.25);
    // Drain new effects.
    for (const fx of g.fx) {
      const life = fx.type === 'bolt' ? Math.max(6, fx.path.length * 1.5) : fx.type === 'ball' ? 16 : fx.type === 'hit' ? 40 : fx.type === 'flash' ? 12 : fx.type === 'shake' ? 1 : fx.type === 'missile' ? Math.max(6, fx.path.length * 2) : 10;
      if (fx.type === 'shake') this.shake = Math.max(this.shake, fx.amount);
      else if (fx.type === 'melee') { if (this.hero) heroPlay(this.hero, 'attack'); }
      else this.active.push({ fx, t: 0, life });
    }
    g.fx.length = 0;
    for (const a of this.active) a.t += dtFrames;
    this.active = this.active.filter(a => a.t < a.life);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.5 * dtFrames);
    if (this.heroFlash > 0) this.heroFlash -= dtFrames;
    if (this.hero) {
      const moving = Math.abs(p.vx! - p.x) > 0.02 || Math.abs(p.vy! - p.y) > 0.02;
      const cur = this.hero.player.name;
      if (p.dead) heroPlay(this.hero, 'dead');
      else if ((cur === 'attack' || cur === 'hurt') && !this.hero.player.done) { /* let it finish */ }
      else heroPlay(this.hero, moving ? 'walk' : 'idle');
    }
  }
  /** Are effects still playing that should block input? */
  busy(): boolean { return this.active.some(a => a.fx.type === 'bolt' || a.fx.type === 'ball' || a.fx.type === 'missile'); }

  /** Screen position (internal px) of a tile's top-left. */
  tileToScreen(x: number, y: number): Pos { return { x: MAP_X + Math.round(x * TILE - this.camX), y: MAP_Y + Math.round(y * TILE - this.camY) }; }
  screenToTile(sx: number, sy: number): Pos { return { x: Math.floor((sx - MAP_X + this.camX) / TILE), y: Math.floor((sy - MAP_Y + this.camY) / TILE) }; }

  draw(ctx: CanvasRenderingContext2D, g: Game): void {
    const lv = g.level, p = g.player;
    ctx.save();
    ctx.beginPath(); ctx.rect(MAP_X, MAP_Y, MAP_W, MAP_H); ctx.clip();
    ctx.fillStyle = COL.void; ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H);
    let ox = 0, oy = 0;
    if (this.shake > 0) { ox = Math.round((Math.random() - 0.5) * this.shake * 2); oy = Math.round((Math.random() - 0.5) * this.shake * 2); }
    const camX = Math.round(this.camX) - ox, camY = Math.round(this.camY) - oy;
    const x0 = Math.max(0, Math.floor(camX / TILE) - 1), y0 = Math.max(0, Math.floor(camY / TILE) - 2);
    const x1 = Math.min(lv.w - 1, x0 + MAP_COLS + 2), y1 = Math.min(lv.h - 1, y0 + MAP_ROWS + 3);
    const sx = (x: number) => MAP_X + x * TILE - camX;
    const sy = (y: number) => MAP_Y + y * TILE - camY;
    const halluc = p.timed.image > 0;
    // Pass 1: floors and everything flat.
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const f = flagAt(lv, x, y);
      if (!(f & F.MARK)) continue;
      const seen = (f & F.SEEN) !== 0;
      const t = tileAt(lv, x, y);
      if (isWall(t) || t === T.PERM || t === T.TREE) { this.drawFloor(ctx, sx(x), sy(y), lv.depth === 0 ? T.GRASS : T.FLOOR, seen, x, y, lv.depth); continue; }
      this.drawFloor(ctx, sx(x), sy(y), t, seen, x, y, lv.depth);
      if (t === T.TRAP) this.drawTrap(ctx, sx(x), sy(y), auxAt(lv, x, y), seen);
      if (t === T.STAIRS_DOWN || t === T.STAIRS_UP) this.drawStairs(ctx, sx(x), sy(y), t === T.STAIRS_DOWN, seen);
      if (t === T.DOOR_OPEN || t === T.DOOR_BROKEN) this.drawOpenDoor(ctx, sx(x), sy(y), t === T.DOOR_BROKEN, seen);
      if (t === T.RUBBLE) this.drawRubble(ctx, sx(x), sy(y), seen);
      if (f & F.TEMP) { ctx.fillStyle = rgba('#ffe080', seen ? 0.6 : 0.3); ctx.fillRect(sx(x) + 6, sy(y) + 6, TILE - 12, TILE - 12); }
    }
    // Travel-path and cursor highlights.
    for (const h of this.hilite) { ctx.fillStyle = 'rgba(255,220,80,0.18)'; ctx.fillRect(sx(h.x), sy(h.y), TILE, TILE); }
    // Pass 2: row by row -- walls (with their fronts), then items, then monsters and the player on that row.
    const drawn = new Set<Monster>();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const f = flagAt(lv, x, y);
        if (!(f & F.MARK)) continue;
        const seen = (f & F.SEEN) !== 0;
        const t = tileAt(lv, x, y);
        if (isWall(t) || t === T.PERM) this.drawWall(ctx, lv, x, y, sx(x), sy(y), t, seen);
        else if (t === T.DOOR_CLOSED) this.drawClosedDoor(ctx, sx(x), sy(y), auxAt(lv, x, y) > 0, seen);
        else if (t === T.TREE) this.drawTree(ctx, sx(x), sy(y), seen, x, y);
        else if (isShop(t)) this.drawShop(ctx, sx(x), sy(y), t - T.SHOP_0, seen, lv, x, y);
      }
      // Items on this row.
      for (const fi of lv.items) {
        if (isIgnored(g, fi.item)) continue;
        if (fi.y !== y || fi.x < x0 || fi.x > x1) continue;
        const f = flagAt(lv, fi.x, fi.y);
        if (!(f & F.MARK)) continue;
        const k = kindOf(fi.item);
        const seen = (f & F.SEEN) !== 0;
        ctx.save(); if (!seen) ctx.globalAlpha = 0.55;
        drawItemIcon(ctx, halluc ? 'junk' : itemIcon(k), sx(fi.x) + TILE / 2, sy(fi.y) + TILE / 2 + 2, k.tval === 'gold' ? '#ffd040' : k.color, 1);
        ctx.restore();
      }
      // Monsters whose visual row is this one.
      for (const m of lv.monsters) {
        if (drawn.has(m)) continue;
        const my = Math.round(m.vy ?? m.y);
        if (my !== y) continue;
        drawn.add(m);
        if (!m.visible && !m.detected) continue;
        const r = raceOf(m);
        const mx = sx(m.vx ?? m.x) + TILE / 2, myy = sy(m.vy ?? m.y) + TILE - 2;
        const seen = (flagAt(lv, m.x, m.y) & F.SEEN) !== 0;
        drawMonsterSprite(ctx, halluc ? (['blob', 'eye', 'demon', 'dragon', 'ghost'] as const)[(m.id + Math.floor(this.phase * 5)) % 5] : r.sprite, mx, myy + (m.attackAnim ? -2 : 0), {
          color: r.color, color2: r.color2, size: r.size || 1, facing: m.facing, phase: (this.phase + m.id * 0.17) % 1, flash: (m.hitFlash || 0) > 0 && ((m.hitFlash || 0) & 2) !== 0, alpha: seen ? 1 : 0.5, asleep: m.sleep > 0, tier: m.tier,
        });
        // Health bar for wounded visible monsters.
        if (m.hp < m.maxhp && seen) {
          const w = 16, hx = mx - w / 2, hy = myy + 1;
          ctx.fillStyle = '#000'; ctx.fillRect(hx - 1, hy - 1, w + 2, 4);
          const pct = m.hp / m.maxhp;
          ctx.fillStyle = pct > 0.6 ? '#40e040' : pct > 0.3 ? '#e0c040' : '#e04040';
          ctx.fillRect(hx, hy, Math.max(1, Math.round(w * pct)), 2);
        }
        if (m.afraid && seen) drawText(ctx, '!', mx + 6, myy - 22 - (r.size || 1) * 6, { size: 1, color: '#ffe060' });
        if (m.confused && seen) drawText(ctx, '?', mx - 10, myy - 22 - (r.size || 1) * 6, { size: 1, color: '#e0a0ff' });
      }
      // The player.
      if (Math.round(p.vy ?? p.y) === y && this.hero) {
        const px = sx(p.vx ?? p.x) + TILE / 2, py = sy(p.vy ?? p.y) + TILE - 2;
        const tint = p.timed.poisoned ? '#40c040' : p.timed.stun ? '#c0c0ff' : p.timed.invuln ? '#ffe080' : p.timed.shero ? '#ff6060' : null;
        drawHero(ctx, this.hero, px, py, p.facing, { flash: this.heroFlash > 0 && (Math.floor(this.heroFlash) & 2) !== 0, tint, alpha: p.timed.blind ? 0.7 : 1 });
        // Light halo.
        if (!p.timed.blind && lv.depth > 0) {
          const r = Math.max(1, g.bonuses.lightRadius) * TILE * 1.1;
          const grad = ctx.createRadialGradient(px, py - 8, r * 0.3, px, py - 8, r);
          grad.addColorStop(0, 'rgba(255,200,120,0.10)'); grad.addColorStop(1, 'rgba(255,200,120,0)');
          ctx.fillStyle = grad; ctx.fillRect(px - r, py - 8 - r, r * 2, r * 2);
        }
      }
    }
    // Darken remembered-but-unseen grids with a subtle overlay so lit areas pop.
    // (Done per tile in drawFloor/drawWall through `seen`.)
    // Effects.
    this.drawFx(ctx, sx, sy, g);
    // Cursor.
    if (this.cursor) { const c = this.cursor; ctx.strokeStyle = '#ffe060'; ctx.lineWidth = 2; ctx.strokeRect(sx(c.x) + 1, sy(c.y) + 1, TILE - 2, TILE - 2); }
    // Blindness / hallucination overlays.
    if (p.timed.blind) { ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H); }
    if (halluc) { ctx.fillStyle = `hsla(${(this.phase * 720) % 360},80%,50%,0.12)`; ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H); }
    ctx.restore();
  }

  private drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, seen: boolean, gx: number, gy: number, depth: number): void {
    const h = hash(gx, gy);
    let base: string, line: string;
    if (t === T.GRASS) { base = seen ? COL.grassLit : COL.grass; line = shade(base, 0.85); }
    else if (t === T.ROAD || isShop(t)) { base = COL.road; line = COL.roadLine; }
    else if (t === T.WATER) { base = COL.water; line = shade(COL.water, 1.2); }
    else { base = seen ? COL.floorLit : COL.floor; line = COL.floorLine; }
    if (!seen) base = shade(base, 0.55), line = shade(line, 0.55);
    // A little hue shift with depth keeps deep levels feeling different.
    if (t === T.FLOOR && depth > 0) base = mix(base, depth > 40 ? '#4a2a3a' : depth > 20 ? '#2a3a4a' : '#3a3d52', Math.min(0.5, depth / 100));
    ctx.fillStyle = base; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = line;
    if (t === T.GRASS) { if (h & 1) ctx.fillRect(x + 4 + (h >> 2 & 7), y + 6 + (h >> 5 & 7), 2, 3); if (h & 8) ctx.fillRect(x + 14 + (h >> 3 & 3), y + 12 + (h >> 6 & 5), 2, 3); }
    else if (t === T.ROAD || isShop(t)) { ctx.fillRect(x, y + TILE - 1, TILE, 1); if (h & 2) ctx.fillRect(x + (h & 15), y + (h >> 4 & 15), 3, 2); }
    else if (t === T.WATER) { ctx.fillRect(x + (h & 7), y + 8, 8, 1); }
    else {
      // Stone slabs: a grout line on two sides, an occasional crack.
      ctx.fillRect(x, y + TILE - 1, TILE, 1); ctx.fillRect(x + TILE - 1, y, 1, TILE);
      if ((h & 7) === 0) ctx.fillRect(x + 4 + (h >> 3 & 7), y + 4 + (h >> 6 & 7), 6, 1);
      if ((h & 31) === 5) { ctx.fillStyle = shade(base, 1.12); ctx.fillRect(x + 3 + (h >> 5 & 7), y + 3 + (h >> 8 & 7), 3, 3); }
    }
  }
  private drawWall(ctx: CanvasRenderingContext2D, lv: Level, gx: number, gy: number, x: number, y: number, t: number, seen: boolean): void {
    const town = lv.depth === 0;
    let top: string, side: string, edge: string;
    if (t === T.PERM) { top = town ? COL.buildingTop : COL.permTop; side = town ? COL.building : COL.perm; edge = shade(top, 1.25); }
    else if (t === T.MAGMA || t === T.MAGMA_K) { top = COL.magmaTop; side = COL.magma; edge = shade(top, 1.2); }
    else if (t === T.QUARTZ || t === T.QUARTZ_K) { top = COL.quartzTop; side = COL.quartz; edge = '#ffffff'; }
    else { top = COL.wallTop; side = COL.wallFront; edge = COL.wallEdge; }
    if (!seen) { top = shade(top, 0.5); side = shade(side, 0.5); edge = shade(edge, 0.5); }
    const below = tileAt(lv, gx, gy + 1);
    const openBelow = !isWall(below) && below !== T.PERM && below !== T.TREE && (flagAt(lv, gx, gy + 1) & F.MARK);
    // Top face, raised by WALL_H.
    ctx.fillStyle = top; ctx.fillRect(x, y - WALL_H, TILE, TILE);
    ctx.fillStyle = edge; ctx.fillRect(x, y - WALL_H, TILE, 1); ctx.fillRect(x, y - WALL_H, 1, TILE);
    ctx.fillStyle = shade(top, 0.8); ctx.fillRect(x + TILE - 1, y - WALL_H, 1, TILE); ctx.fillRect(x, y - WALL_H + TILE - 1, TILE, 1);
    const h = hash(gx, gy);
    if (t === T.MAGMA_K || t === T.QUARTZ_K) { ctx.fillStyle = COL.treasure; ctx.fillRect(x + 5 + (h & 7), y - WALL_H + 6 + (h >> 3 & 7), 3, 3); ctx.fillRect(x + 12 + (h >> 5 & 5), y - WALL_H + 13 + (h >> 7 & 5), 2, 2); }
    else if (t === T.MAGMA || t === T.QUARTZ) { ctx.fillStyle = shade(top, t === T.MAGMA ? 0.7 : 0.85); ctx.fillRect(x + 4 + (h & 7), y - WALL_H + 4 + (h >> 3 & 7), 4, 2); ctx.fillRect(x + 10 + (h >> 5 & 7), y - WALL_H + 12 + (h >> 7 & 7), 5, 2); }
    else if (t === T.PERM && town) { ctx.fillStyle = COL.buildingLine; for (let i = 0; i < 3; i++) ctx.fillRect(x, y - WALL_H + 6 + i * 6, TILE, 1); }
    // Front face.
    if (openBelow) {
      ctx.fillStyle = side; ctx.fillRect(x, y + TILE - WALL_H, TILE, WALL_H);
      ctx.fillStyle = shade(side, 0.7);
      ctx.fillRect(x, y + TILE - WALL_H + 4, TILE, 1);
      ctx.fillRect(x + (h & 1 ? 6 : 14), y + TILE - WALL_H, 1, 4); ctx.fillRect(x + (h & 1 ? 16 : 4), y + TILE - WALL_H + 5, 1, 5);
      ctx.fillRect(x, y + TILE - 1, TILE, 1);
    }
  }
  private drawClosedDoor(ctx: CanvasRenderingContext2D, x: number, y: number, locked: boolean, seen: boolean): void {
    const door = seen ? COL.door : shade(COL.door, 0.5), dark = seen ? COL.doorDark : shade(COL.doorDark, 0.5);
    ctx.fillStyle = dark; ctx.fillRect(x + 2, y - WALL_H + 2, TILE - 4, TILE + WALL_H - 4);
    ctx.fillStyle = door; ctx.fillRect(x + 4, y - WALL_H + 4, TILE - 8, TILE + WALL_H - 8);
    ctx.fillStyle = seen ? COL.doorIron : shade(COL.doorIron, 0.5);
    ctx.fillRect(x + 4, y - 2, TILE - 8, 2); ctx.fillRect(x + 4, y + 10, TILE - 8, 2);
    ctx.fillStyle = locked ? '#ffd040' : COL.doorIron; ctx.fillRect(x + TILE - 9, y + 4, 3, 3);
    if (locked && seen) { ctx.fillStyle = '#ffd040'; ctx.fillRect(x + TILE - 10, y + 3, 5, 1); }
  }
  private drawOpenDoor(ctx: CanvasRenderingContext2D, x: number, y: number, broken: boolean, seen: boolean): void {
    const door = seen ? COL.door : shade(COL.door, 0.5);
    ctx.fillStyle = door;
    if (broken) { ctx.fillRect(x + 3, y + 14, 8, 6); ctx.fillRect(x + 13, y + 10, 7, 4); }
    else { ctx.fillRect(x + 1, y - WALL_H + 2, 4, TILE + WALL_H - 4); ctx.fillStyle = seen ? COL.doorIron : shade(COL.doorIron, 0.5); ctx.fillRect(x + 1, y + 2, 4, 2); }
  }
  private drawRubble(ctx: CanvasRenderingContext2D, x: number, y: number, seen: boolean): void {
    const c = seen ? COL.rubble : shade(COL.rubble, 0.5);
    ctx.fillStyle = shade(c, 0.6); ctx.fillRect(x + 3, y + 10, 10, 9); ctx.fillRect(x + 12, y + 6, 9, 12);
    ctx.fillStyle = c; ctx.fillRect(x + 4, y + 9, 8, 7); ctx.fillRect(x + 13, y + 5, 7, 10); ctx.fillRect(x + 8, y + 15, 6, 5);
    ctx.fillStyle = shade(c, 1.3); ctx.fillRect(x + 5, y + 9, 3, 2); ctx.fillRect(x + 14, y + 5, 3, 2);
  }
  private drawStairs(ctx: CanvasRenderingContext2D, x: number, y: number, down: boolean, seen: boolean): void {
    ctx.fillStyle = seen ? COL.stairs : '#0c0c14';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    const c = seen ? '#9a9ab8' : '#4a4a5a';
    for (let i = 0; i < 4; i++) { ctx.fillStyle = shade(c, down ? 1 - i * 0.2 : 0.4 + i * 0.2); ctx.fillRect(x + 4 + i * 2, y + 4 + i * 4, TILE - 8 - i * 4, 3); }
    ctx.fillStyle = seen ? '#ffe060' : '#8a7a30';
    drawText(ctx, down ? '>' : '<', x + TILE - 8, y + 2, { size: 1, color: seen ? '#ffe060' : '#8a7a30', shadow: false });
  }
  private drawTrap(ctx: CanvasRenderingContext2D, x: number, y: number, kind: number, seen: boolean): void {
    const c = seen ? COL.trap : shade(COL.trap, 0.5);
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + 18, y + 18); ctx.moveTo(x + 18, y + 6); ctx.lineTo(x + 6, y + 18); ctx.stroke();
    if (kind === 0 || kind === 1 || kind === 2) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x + 5, y + 5, 14, 14); }
    ctx.strokeStyle = c; ctx.strokeRect(x + 4.5, y + 4.5, 15, 15);
  }
  private drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, seen: boolean, gx: number, gy: number): void {
    const h = hash(gx, gy);
    const top = seen ? COL.treeTop : shade(COL.treeTop, 0.5), dark = seen ? COL.tree : shade(COL.tree, 0.5);
    ctx.fillStyle = seen ? COL.trunk : shade(COL.trunk, 0.5); ctx.fillRect(x + 10, y + 8, 4, 14);
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x + 12, y + 4 + (h & 3), 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = top; ctx.beginPath(); ctx.arc(x + 9, y + 1 + (h & 3), 7, 0, Math.PI * 2); ctx.fill();
  }
  private drawShop(ctx: CanvasRenderingContext2D, x: number, y: number, idx: number, seen: boolean, lv: Level, gx: number, gy: number): void {
    // The entrance sits in the building's wall: draw the wall front here with a door and a sign.
    const top = seen ? COL.buildingTop : shade(COL.buildingTop, 0.5), side = seen ? COL.building : shade(COL.building, 0.5);
    const above = tileAt(lv, gx, gy - 1) === T.PERM;
    ctx.fillStyle = side; ctx.fillRect(x, y - WALL_H, TILE, TILE + WALL_H);
    ctx.fillStyle = shade(side, 0.75); for (let i = 0; i < 4; i++) ctx.fillRect(x, y - WALL_H + 3 + i * 8, TILE, 1);
    if (!above) { ctx.fillStyle = top; ctx.fillRect(x, y - WALL_H, TILE, 6); }
    // Door.
    ctx.fillStyle = COL.doorDark; ctx.fillRect(x + 6, y + 2, 12, TILE - 2);
    ctx.fillStyle = seen ? COL.door : shade(COL.door, 0.5); ctx.fillRect(x + 7, y + 3, 10, TILE - 3);
    ctx.fillStyle = '#ffd040'; ctx.fillRect(x + 14, y + 12, 2, 2);
    // Sign with the store number in its colour.
    const c = seen ? SHOP_COLORS[idx] : shade(SHOP_COLORS[idx], 0.5);
    ctx.fillStyle = '#1a1420'; ctx.fillRect(x + 5, y - WALL_H - 4, 14, 11);
    ctx.fillStyle = c; ctx.fillRect(x + 6, y - WALL_H - 3, 12, 9);
    drawText(ctx, String(idx + 1), x + 9, y - WALL_H - 2, { size: 1, color: '#100c14', shadow: false });
    // Name label when near.
    void SHOP_SHORT;
  }

  private drawFx(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, g: Game): void {
    for (const a of this.active) {
      const fx = a.fx, k = a.t / a.life;
      if (fx.type === 'bolt') {
        const col = ELEMENT_COLOR[fx.element];
        const n = fx.path.length;
        const head = Math.min(n - 1, Math.floor(k * n * 1.2));
        const tail = fx.beam ? 0 : Math.max(0, head - 3);
        for (let i = tail; i <= head; i++) {
          const p = fx.path[i];
          const cx = sx(p.x) + TILE / 2, cy = sy(p.y) + TILE / 2;
          const r = fx.beam ? 5 : 3 + (i === head ? 3 : 0);
          ctx.fillStyle = rgba(col, i === head || fx.beam ? 0.95 : 0.4);
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
          if (i === head) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill(); }
        }
      } else if (fx.type === 'ball') {
        const col = ELEMENT_COLOR[fx.element];
        const cells = fx.cells.length ? fx.cells : [{ x: fx.x, y: fx.y }];
        const rad = (fx.radius + 0.5) * k;
        for (const c of cells) {
          const d = Math.max(Math.abs(c.x - fx.x), Math.abs(c.y - fx.y));
          if (d > rad + 0.5) continue;
          ctx.fillStyle = rgba(col, Math.max(0, 0.7 - k * 0.6 - d * 0.1));
          ctx.fillRect(sx(c.x) + 2, sy(c.y) + 2, TILE - 4, TILE - 4);
        }
        ctx.strokeStyle = rgba(col, 1 - k); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sx(fx.x) + TILE / 2, sy(fx.y) + TILE / 2, rad * TILE, 0, Math.PI * 2); ctx.stroke();
      } else if (fx.type === 'hit') {
        const cx = sx(fx.x) + TILE / 2, cy = sy(fx.y) - 6 - k * 14;
        drawText(ctx, fx.text, cx, cy, { size: 1, color: fx.color, align: 'center', alpha: 1 - k * k });
      } else if (fx.type === 'flash') {
        ctx.fillStyle = rgba(fx.color, 0.7 * (1 - k)); ctx.fillRect(sx(fx.x) - 2, sy(fx.y) - 2, TILE + 4, TILE + 4);
      } else if (fx.type === 'missile') {
        const n = fx.path.length; if (!n) continue;
        const i = Math.min(n - 1, Math.floor(k * n));
        const p = fx.path[i];
        drawItemIcon(ctx, fx.icon === 'ammo' ? 'ammo' : fx.icon === 'flask' ? 'flask' : fx.icon === 'potion' ? 'potion' : 'junk', sx(p.x) + TILE / 2, sy(p.y) + TILE / 2, fx.color, 0.8);
      }
    }
    void g;
  }
}

function approachTile(v: number, target: number, rate: number): number {
  if (Math.abs(target - v) > 3) return target; // teleported: snap
  const n = v + (target - v) * rate;
  return Math.abs(target - n) < 0.02 ? target : n;
}
/** A cheap per-tile hash for deterministic floor detail. */
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return (h ^ (h >>> 16)) >>> 0;
}
export const _keep = [hasMFlag, drawHero];
