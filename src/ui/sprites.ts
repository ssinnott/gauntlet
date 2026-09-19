// Procedural monster sprites and floor item icons, drawn in the 1985 Gauntlet manner: chunky cel-shaded
// silhouettes with a 1px dark outline, seen from the 3/4 top-down view. Every family in `SpriteKind` has its
// own drawing routine; `drawMonsterSprite` sets the palette / transform once and dispatches.
//
// Allocation notes: the palette for the current call lives in module-level variables (drawing is synchronous),
// shaded colours are memoised per input colour, and every path is traced directly on the context, so a call
// allocates nothing beyond what the canvas itself does.
import type { SpriteKind } from '../game/types.ts';
import { pathCapsule, pathEllipse, pathRrect, pathStar, pathTaperedCapsule, line } from '../lib/art/shapes.ts';
import { shade, mix, rgba } from '../lib/art/palettes.ts';

export interface SpriteOpts {
  /** Main and accent colours (hex). */
  color: string; color2?: string;
  /** Draw scale (1 = fills most of a 24px tile; 0.5 tiny; 1.8 huge). */
  size?: number;
  /** 1 faces right, -1 faces left. */
  facing?: 1 | -1;
  /** Animation phase 0..1 (looping), for idle bobbing / wing flaps / blob wobble. */
  phase?: number;
  /** Hit flash: draw in white. */
  flash?: boolean;
  /** Draw ghosted (remembered/detected but not seen). */
  alpha?: number;
  /** Asleep: draw eyes closed / slumped. */
  asleep?: boolean;
  /** Generators only: how intact, 3 down to 1. The machine visibly comes apart as it falls. */
  tier?: number;
}

const TAU = Math.PI * 2;
const OUT = '#120c14';
const WHITE = '#ffffff';
const EYE = '#fff7e8';
const BONE = '#e8e2d0';
const METAL = '#cfd6e6';
const METAL_DK = '#6a6e7a';
const WOOD = '#8a6a4a';
const GOLD = '#e8b83c';
const PAPER = '#efe6c8';
const GLASS = '#dfe9f5';
const PINK = '#ff9db0';
const FLAME = '#ff9a2a';
const FLAME2 = '#ffe14a';

/** Every family this module draws, in gallery order. */
export const SPRITE_KINDS: SpriteKind[] = [
  'blob', 'bat', 'bird', 'snake', 'spider', 'insect', 'worm', 'mold', 'jelly', 'eye', 'ghost', 'skeleton', 'zombie',
  'dog', 'cat', 'rodent', 'dragon', 'hydra', 'golem', 'quadruped', 'demon', 'vortex', 'elemental', 'tree', 'mimic',
  'generator', 'mushroom', 'centipede', 'giant', 'troll', 'ogre', 'orc', 'kobold', 'humanoid', 'yeek', 'ant', 'louse',
  'nether', 'angel', 'harpy', 'naga', 'wight', 'rig',
];

/** Item icons `drawItemIcon` understands, in gallery order. */
export const ITEM_ICONS: string[] = [
  'potion', 'scroll', 'wand', 'staff', 'rod', 'ring', 'amulet', 'food', 'weapon', 'bow', 'ammo', 'armor', 'shield', 'helm',
  'cloak', 'gloves', 'boots', 'light', 'book', 'chest', 'gold', 'key', 'flask', 'spike', 'junk', 'digger',
];

// ---------------------------------------------------------------------------------------------
// Palette state for the current call

let C = WHITE;   // main colour
let D = WHITE;   // main, shadow band
let L = WHITE;   // main, highlight
let C2 = WHITE;  // accent colour
let D2 = WHITE;  // accent, shadow band
let LW = 1;      // outline width in local units (about 1 screen px)
let PH = 0;      // animation phase 0..1
let SZ = 1;      // draw scale (for a few "how many heads" decisions)
let SLEEP = false;
let FLASH = false;
let TIER = 3;    // generator condition, 3 whole .. 1 nearly finished

const darkOf = new Map<string, string>();
const lightOf = new Map<string, string>();
const accentOf = new Map<string, string>();
const haloOf = new Map<string, string>();

function memo(map: Map<string, string>, c: string, f: number): string {
  let v = map.get(c);
  if (v === undefined) { v = shade(c, f); map.set(c, v); }
  return v;
}
function dark(c: string): string { return memo(darkOf, c, 0.7); }
function light(c: string): string { return memo(lightOf, c, 1.25); }
function accent(c: string): string {
  let v = accentOf.get(c);
  if (v === undefined) { v = mix(c, '#ffe08a', 0.55); accentOf.set(c, v); }
  return v;
}
function halo(c: string): string {
  let v = haloOf.get(c);
  if (v === undefined) { v = rgba(c, 0.35); haloOf.set(c, v); }
  return v;
}
/** A fixed colour, or white while flashing. */
function fc(c: string): string { return FLASH ? WHITE : c; }

function setPalette(color: string, color2: string | undefined, flash: boolean): void {
  FLASH = flash;
  if (flash) { C = D = L = C2 = D2 = WHITE; return; }
  C = color; D = dark(color); L = light(color);
  C2 = color2 ?? accent(color); D2 = dark(C2);
}

// ---------------------------------------------------------------------------------------------
// Path finishing helpers (all work on the current path)

/** Outline (stroked underneath, so `LW` px shows outside) then flat fill. */
function fin(ctx: CanvasRenderingContext2D, fill: string): void {
  ctx.strokeStyle = OUT; ctx.lineWidth = LW * 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.fillStyle = fill; ctx.fill();
}
/** Outline only (for a second pass over shapes already filled). */
function outlineOnly(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = OUT; ctx.lineWidth = LW * 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
}
/** Plain fill, no outline. */
function flat(ctx: CanvasRenderingContext2D, fill: string): void { ctx.fillStyle = fill; ctx.fill(); }
/**
 * Cel-shaded fill: outline, base colour, then (clipped to the path) a darker band on the lower-right and a small
 * highlight on the upper-left. (cx,cy,rx,ry) is the path's bounding ellipse; `rect` shifts the band as a rectangle
 * so boxy parts keep their corners.
 */
function cel(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, c = C, d = D, l = L, rect = false): void {
  fin(ctx, c);
  if (FLASH) return;
  ctx.save(); ctx.clip();
  ctx.fillStyle = d; ctx.fillRect(cx - rx - 2, cy - ry - 2, rx * 2 + 4, ry * 2 + 4);
  ctx.fillStyle = c;
  if (rect) ctx.fillRect(cx - rx - 2, cy - ry - 2, rx * 2 + 2 - rx * 0.22, ry * 2 + 2 - ry * 0.26);
  else { ctx.beginPath(); ctx.ellipse(cx - rx * 0.16, cy - ry * 0.18, rx * 1.02, ry * 1.02, 0, 0, TAU); ctx.fill(); }
  ctx.fillStyle = l; ctx.beginPath(); ctx.ellipse(cx - rx * 0.4, cy - ry * 0.45, Math.max(0.6, rx * 0.28), Math.max(0.5, ry * 0.22), 0, 0, TAU); ctx.fill();
  ctx.restore();
}
/** Circle with cel shading. */
function ballC(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c = C, d = D, l = L): void { pathEllipse(ctx, cx, cy, r, r); cel(ctx, cx, cy, r, r, c, d, l); }
/** Ellipse with cel shading. */
function ovalC(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, c = C, d = D, l = L): void { pathEllipse(ctx, cx, cy, rx, ry); cel(ctx, cx, cy, rx, ry, c, d, l); }
/** Rounded box with cel shading. */
function boxC(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, c = C, d = D, l = L): void { pathRrect(ctx, x, y, w, h, r); cel(ctx, x + w / 2, y + h / 2, w / 2, h / 2, c, d, l, true); }
/** Outlined capsule (limbs). */
function limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number, c: string): void { pathCapsule(ctx, x0, y0, x1, y1, r); fin(ctx, c); }
/** Outlined circle. */
function ball(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: string): void { pathEllipse(ctx, cx, cy, r, r); fin(ctx, c); }
/** Outlined ellipse. */
function oval(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, c: string): void { pathEllipse(ctx, cx, cy, rx, ry); fin(ctx, c); }
/** Outlined rounded box. */
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, c: string): void { pathRrect(ctx, x, y, w, h, r); fin(ctx, c); }
/** Outlined triangle. */
function tri(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: string): void {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); fin(ctx, c);
}
/** Outlined quad. */
function quad(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: string): void {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); fin(ctx, c);
}
/** A thin outlined stroke (tails, antennae, thin legs): dark line underneath, colour on top. */
function stick(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, c: string): void {
  line(ctx, x0, y0, x1, y1, OUT, w + LW * 2);
  line(ctx, x0, y0, x1, y1, c, w);
}
/** Two-segment outlined stroke (bent legs). */
function stick2(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, w: number, c: string): void {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = OUT; ctx.lineWidth = w + LW * 2; ctx.stroke();
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke();
}
/** Outlined quadratic curve (curly tails). */
function curl(ctx: CanvasRenderingContext2D, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w: number, c: string): void {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.strokeStyle = OUT; ctx.lineWidth = w + LW * 2; ctx.stroke();
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke();
}
/** A dot (no outline). */
function dot(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: string): void { pathEllipse(ctx, cx, cy, r, r); ctx.fillStyle = c; ctx.fill(); }

// Eyes ----------------------------------------------------------------------------------------

/** A cartoon eye: white, optional iris, dark pupil looking slightly forward. Asleep: a closed line. */
function eye(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, iris?: string): void {
  if (SLEEP) { line(ctx, cx - r, cy + r * 0.3, cx + r, cy + r * 0.3, OUT, Math.max(0.8, LW)); return; }
  dot(ctx, cx, cy, r, fc(EYE));
  if (iris) dot(ctx, cx + r * 0.15, cy, r * 0.62, fc(iris));
  dot(ctx, cx + r * 0.28, cy + r * 0.05, Math.max(0.45, r * 0.42), fc(OUT));
}
function eyes(ctx: CanvasRenderingContext2D, cx: number, cy: number, gap: number, r: number, iris?: string): void { eye(ctx, cx - gap, cy, r, iris); eye(ctx, cx + gap, cy, r, iris); }
/** A glowing eye: a plain coloured dot with a dark rim. Asleep: a line. */
function glow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: string): void {
  if (SLEEP) { line(ctx, cx - r, cy, cx + r, cy, OUT, Math.max(0.8, LW)); return; }
  dot(ctx, cx, cy, r + LW * 0.6, OUT);
  dot(ctx, cx, cy, r, fc(c));
}
function glows(ctx: CanvasRenderingContext2D, cx: number, cy: number, gap: number, r: number, c: string): void { glow(ctx, cx - gap, cy, r, c); glow(ctx, cx + gap, cy, r, c); }
/** Dark eye sockets (skulls, ghosts). Asleep: lines. */
function socket(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  if (SLEEP) { line(ctx, cx - rx, cy, cx + rx, cy, OUT, Math.max(0.8, LW)); return; }
  pathEllipse(ctx, cx, cy, rx, ry); ctx.fillStyle = OUT; ctx.fill();
}

// Shared body parts ---------------------------------------------------------------------------

/** Bat-style membrane wing on side s (-1 left, +1 right): root at (rx, ry), tip lifted by `lift`. */
function batWing(ctx: CanvasRenderingContext2D, s: number, rx: number, ry: number, span: number, lift: number, c: string): void {
  const tipX = s * (rx + span), tipY = ry - lift - span * 0.25;
  const f1x = s * (rx + span * 0.82), f1y = ry - lift * 0.3 + span * 0.12;
  const f2x = s * (rx + span * 0.5), f2y = ry - lift * 0.05 + span * 0.26;
  ctx.beginPath();
  ctx.moveTo(s * rx, ry);
  ctx.quadraticCurveTo(s * (rx + span * 0.35), ry - lift * 0.85 - span * 0.05, tipX, tipY); // swept leading edge
  ctx.quadraticCurveTo(s * (rx + span * 0.95), ry - lift * 0.5 + span * 0.02, f1x, f1y);      // scallop 1
  ctx.quadraticCurveTo(s * (rx + span * 0.66), ry - lift * 0.35 + span * 0.05, f2x, f2y);     // scallop 2
  ctx.quadraticCurveTo(s * (rx + span * 0.35), ry - lift * 0.15 + span * 0.12, s * (rx + span * 0.15), ry + span * 0.28); // scallop 3
  ctx.closePath();
  fin(ctx, c);
  // finger bones
  line(ctx, s * (rx + 1), ry - 0.5, f1x, f1y, OUT, LW * 0.8);
  line(ctx, s * (rx + 1), ry, f2x, f2y, OUT, LW * 0.8);
}
/** Feathered wing on side s: root (rx,ry), tip (rx+span, ry-lift), three scallops along the trailing edge. */
function featherWing(ctx: CanvasRenderingContext2D, s: number, rx: number, ry: number, span: number, lift: number, c: string, d: string): void {
  ctx.beginPath();
  ctx.moveTo(s * rx, ry);
  ctx.quadraticCurveTo(s * (rx + span * 0.4), ry - lift - span * 0.25, s * (rx + span), ry - lift);
  ctx.quadraticCurveTo(s * (rx + span * 0.85), ry - lift * 0.55 + 1, s * (rx + span * 0.72), ry - lift * 0.35 + 2);
  ctx.quadraticCurveTo(s * (rx + span * 0.55), ry - lift * 0.25 + 2, s * (rx + span * 0.42), ry + 2.5);
  ctx.quadraticCurveTo(s * (rx + span * 0.28), ry + 2.5, s * (rx + span * 0.15), ry + 3.5);
  ctx.closePath();
  fin(ctx, c);
  line(ctx, s * (rx + 1), ry + 1, s * (rx + span * 0.72), ry - lift * 0.35 + 2, d, LW * 0.9);
  line(ctx, s * (rx + 1), ry + 1.5, s * (rx + span * 0.42), ry + 2.5, d, LW * 0.9);
}
/** Two legs from hips (±spread, hipY) to feet (±spread*1.15, 0), plus feet. */
function legs(ctx: CanvasRenderingContext2D, hipY: number, spread: number, r: number, c: string, footC: string): void {
  limb(ctx, -spread, hipY, -spread * 1.15, -r * 0.6, r, c);
  limb(ctx, spread, hipY, spread * 1.15, -r * 0.6, r, c);
  oval(ctx, -spread * 1.25, -r * 0.5, r * 1.35, r * 0.7, footC);
  oval(ctx, spread * 1.35, -r * 0.5, r * 1.35, r * 0.7, footC);
}
/** Two arms from shoulders (±sx, sy) to hands (±hx, hy), with hands. */
function arms(ctx: CanvasRenderingContext2D, sx: number, sy: number, hx: number, hy: number, r: number, c: string, hand: string): void {
  limb(ctx, -sx, sy, -hx, hy, r, c); limb(ctx, sx, sy, hx, hy, r, c);
  ball(ctx, -hx, hy + r * 0.3, r * 1.1, hand); ball(ctx, hx, hy + r * 0.3, r * 1.1, hand);
}
/** A sword held at (hx,hy), blade pointing up-right. */
function sword(ctx: CanvasRenderingContext2D, hx: number, hy: number, len: number): void {
  const tx = hx + len * 0.28, ty = hy - len;
  pathTaperedCapsule(ctx, hx, hy - 1, tx, ty, 0.9, 0.2); fin(ctx, fc(METAL));
  line(ctx, hx - 1.8, hy - 0.4, hx + 1.8, hy - 1.6, OUT, LW * 2 + 1.2);
  line(ctx, hx - 1.8, hy - 0.4, hx + 1.8, hy - 1.6, fc(GOLD), 1.2);
}
/** A wooden club held at (hx,hy). */
function club(ctx: CanvasRenderingContext2D, hx: number, hy: number, len: number): void {
  pathTaperedCapsule(ctx, hx, hy, hx + len * 0.3, hy - len, 1, 2.2); fin(ctx, fc(WOOD));
  dot(ctx, hx + len * 0.3, hy - len + 0.5, 0.6, OUT);
}

// ---------------------------------------------------------------------------------------------
// Monsters

/** Draw one monster with its FEET at (x, y) -- the bottom-centre of its tile -- in the current ctx transform. */
export function drawMonsterSprite(ctx: CanvasRenderingContext2D, kind: SpriteKind, x: number, y: number, opts: SpriteOpts): void {
  const size = opts.size ?? 1, facing = opts.facing ?? 1, alpha = opts.alpha ?? 1;
  setPalette(opts.color, opts.color2, !!opts.flash);
  PH = opts.phase ?? 0; SLEEP = !!opts.asleep; SZ = size; TIER = opts.tier ?? 3;
  LW = Math.min(1.5, Math.max(0.45, 1 / size));
  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.scale(size * facing, size);
  if (SLEEP) ctx.scale(1, 0.92);
  drawKind(ctx, kind);
  ctx.restore();
}

function drawKind(ctx: CanvasRenderingContext2D, kind: SpriteKind): void {
  const w = Math.sin(PH * TAU); // -1..1 wobble
  switch (kind) {
    case 'blob': {
      const rx = 8 + w * 0.6, ry = 6.3 - w * 0.5;
      oval(ctx, -6.5, -0.8, 2, 1.1, D); oval(ctx, 6.8, -0.7, 1.6, 0.9, D);
      ctx.beginPath(); ctx.moveTo(-rx, 0); ctx.quadraticCurveTo(-rx, -ry * 2, 0, -ry * 2); ctx.quadraticCurveTo(rx, -ry * 2, rx, 0); ctx.closePath();
      cel(ctx, 0, -ry, rx, ry);
      eyes(ctx, 0.8, -ry - 1.2, 2.6, 1.5);
      line(ctx, -0.6, -ry + 2.4, 2.6, -ry + 2.2, OUT, LW);
      break;
    }
    case 'bat': {
      const cy = -12 + w * 0.8, lift = 2 + w * 5;
      batWing(ctx, -1, 2, cy - 1, 9.5, lift, C); batWing(ctx, 1, 2, cy - 1, 9.5, lift, C);
      tri(ctx, -1.2, cy - 2.5, -2.8, cy - 6.5, 0.3, cy - 3.5, C); tri(ctx, 1.2, cy - 2.5, 2.8, cy - 6.5, -0.3, cy - 3.5, C);
      ovalC(ctx, 0, cy, 3, 3.6);
      glows(ctx, 0, cy - 0.8, 1.3, 0.8, C2);
      line(ctx, -0.8, cy + 2, 0.8, cy + 2, fc(EYE), 0.8);
      break;
    }
    case 'bird': {
      const b = w * 0.6;
      tri(ctx, -4, -9 + b, -10, -12 + b, -9, -6.5 + b, D);
      stick(ctx, 0, -4.5, 0.5, 0, 1, fc(C2)); stick(ctx, 2.5, -4.5, 3, 0, 1, fc(C2));
      line(ctx, -1, 0, 2, 0, OUT, LW); line(ctx, 1.5, 0, 4.5, 0, OUT, LW);
      ovalC(ctx, -0.5, -8.5 + b, 5.5, 4);
      pathEllipse(ctx, -1.5, -9.5 + b, 3.6, 1.8, -0.35 - w * 0.4); fin(ctx, D);
      ballC(ctx, 5, -12.5 + b, 3);
      tri(ctx, 7.4, -13.4 + b, 11, -12 + b, 7.4, -11 + b, C2);
      eye(ctx, 5.5, -13.3 + b, 1);
      break;
    }
    case 'snake': {
      ovalC(ctx, 0, -3, 8.5, 3.2);
      ovalC(ctx, 1, -6.6, 6, 2.6);
      dot(ctx, -3, -3.2, 0.8, D); dot(ctx, 1, -2.5, 0.8, D); dot(ctx, 5, -3.4, 0.8, D);
      limb(ctx, 4, -8, 6 + w * 0.5, -14, 2, C);
      ovalC(ctx, 6.6 + w * 0.5, -15.6, 3.4, 2.4);
      eye(ctx, 7.6 + w * 0.5, -16.2, 0.9, C2);
      line(ctx, 9.8 + w * 0.5, -15.4, 12.2 + w * 0.5, -15, fc('#e0303a'), 0.9);
      line(ctx, 12.2 + w * 0.5, -15, 13 + w * 0.5, -16, fc('#e0303a'), 0.7);
      line(ctx, 12.2 + w * 0.5, -15, 13 + w * 0.5, -14.2, fc('#e0303a'), 0.7);
      break;
    }
    case 'spider': {
      for (let i = 0; i < 4; i++) {
        const kx = 3 + i * 1.9, ky = -10.5 + (i === 0 || i === 3 ? 2 : 0) + w * (i % 2 ? 0.6 : -0.6), fx = 4.5 + i * 2.1;
        stick2(ctx, -1.5, -6.5, -kx, ky, -fx, 0, 1.3, C);
        stick2(ctx, 1.5, -6.5, kx, ky, fx, 0, 1.3, C);
      }
      ballC(ctx, -2.5, -7.5, 5.2);
      ballC(ctx, 3.8, -6, 3.2);
      glow(ctx, 4.6, -7.2, 0.7, C2); glow(ctx, 6.2, -6.6, 0.7, C2); glow(ctx, 4.6, -5.4, 0.6, C2); glow(ctx, 6.2, -5, 0.6, C2);
      line(ctx, 5.5, -3.8, 5, -2.5, OUT, LW); line(ctx, 6.8, -3.8, 7.4, -2.5, OUT, LW);
      break;
    }
    case 'insect': {
      for (let i = 0; i < 3; i++) {
        const lx = -3.5 + i * 3.5;
        stick(ctx, lx, -4, lx - 2.5 - w * 0.4, 0, 1, C); stick(ctx, lx + 1, -4, lx + 3.5 + w * 0.4, 0, 1, C);
      }
      ovalC(ctx, 0, -6, 6.5, 4.5);
      line(ctx, 0, -10, 0, -2, OUT, LW);
      line(ctx, -2, -8.5, -4.5, -6, D, LW); line(ctx, 2, -8.5, 4.5, -6, D, LW);
      ballC(ctx, 6.8, -6, 2.6);
      stick(ctx, 8, -8, 10.5, -11.5 + w * 0.5, 0.8, C); stick(ctx, 8.8, -7.5, 11.5, -9 + w * 0.5, 0.8, C);
      glow(ctx, 8, -6.6, 0.9, C2);
      break;
    }
    case 'worm': {
      for (let i = 0; i < 6; i++) {
        const sx = -8.5 + i * 3.3, sy = -3.6 + Math.sin(PH * TAU + i * 1.1) * 0.9;
        if (i === 5) { ballC(ctx, sx, sy, 3.6); eye(ctx, sx + 1, sy - 1, 0.9); line(ctx, sx + 1.5, sy + 1.4, sx + 3, sy + 1, OUT, LW); }
        else ball(ctx, sx, sy, 3.1, i % 2 ? D : C);
      }
      break;
    }
    case 'mold': {
      ovalC(ctx, 0, -2.6, 9.2, 3);
      ball(ctx, -4.5, -4.5, 2.6, C); ball(ctx, 1.5, -5.6, 3.1, C); ball(ctx, 5.8, -3.8, 2.1, C);
      dot(ctx, -4, -4.2, 0.9, D); dot(ctx, 2.5, -5, 1, D); dot(ctx, -1, -2.5, 0.8, D); dot(ctx, 6.2, -3.4, 0.7, D);
      const b = w * 1.1;
      glow(ctx, -6.5, -8.5 + b, 0.9, C2); glow(ctx, 0.5, -10.5 - b, 0.9, C2); glow(ctx, 6.5, -8 + b, 0.8, C2); glow(ctx, 3.5, -11 + b * 0.5, 0.6, C2);
      break;
    }
    case 'jelly': {
      const rx = 6.5 + w * 0.4, top = -17 - w * 0.5;
      ctx.save(); ctx.globalAlpha *= 0.82;
      pathRrect(ctx, -rx, top, rx * 2, -top, rx * 0.95); cel(ctx, 0, top / 2, rx, -top / 2);
      dot(ctx, -2, -9.5, 2.1, D); dot(ctx, 2.5, -5.5, 1.5, D); dot(ctx, 1.5, -13, 1.1, D); dot(ctx, -3.5, -4, 1, D);
      ctx.restore();
      dot(ctx, -3.5, -13.5, 1.2, fc(L)); dot(ctx, -2, -15, 0.6, fc(L));
      break;
    }
    case 'eye': {
      const cy = -11 + w;
      stick(ctx, 0, cy + 6, 0.5 + w * 0.5, cy + 9.5, 1, C); stick(ctx, -2.5, cy + 5.5, -4 - w * 0.4, cy + 8.5, 1, C); stick(ctx, 2.5, cy + 5.5, 4 - w * 0.4, cy + 8.5, 1, C);
      ballC(ctx, 0, cy, 6.6);
      ball(ctx, 0.9, cy, 3.3, C2);
      dot(ctx, 1.2, cy, 1.6, OUT);
      dot(ctx, -1.2, cy - 2, 1, fc(EYE));
      if (SLEEP) { ctx.beginPath(); ctx.arc(0, cy, 6.6, Math.PI, 0); ctx.closePath(); fin(ctx, D); line(ctx, -6, cy, 6, cy, OUT, LW); }
      break;
    }
    case 'ghost': {
      const b = w * 1.2, base = -3 + b, top = -13 + b;
      ctx.save(); ctx.globalAlpha *= 0.85;
      ctx.beginPath();
      ctx.moveTo(-6.5, base); ctx.lineTo(-6.5, top); ctx.arc(0, top, 6.5, Math.PI, 0); ctx.lineTo(6.5, base);
      ctx.quadraticCurveTo(4.9, base + 3 + w, 3.25, base); ctx.quadraticCurveTo(1.6, base + 3 - w, 0, base);
      ctx.quadraticCurveTo(-1.6, base + 3 + w, -3.25, base); ctx.quadraticCurveTo(-4.9, base + 3 - w, -6.5, base);
      ctx.closePath();
      cel(ctx, 0, -8 + b, 6.5, 6.5);
      ctx.restore();
      socket(ctx, -2.3, -12.5 + b, 1.3, 1.8); socket(ctx, 2.3, -12.5 + b, 1.3, 1.8);
      pathEllipse(ctx, 0, -8.5 + b, 1.2, 1.5); flat(ctx, OUT);
      break;
    }
    case 'skeleton': {
      legs(ctx, -7.5, 2.2, 1.2, C, C);
      limb(ctx, -2, -7, 2, -7, 1.4, C);
      boxC(ctx, -3.6, -14, 7.2, 7, 1.6);
      line(ctx, -3, -12, 3, -12, D, LW); line(ctx, -3, -10.2, 3, -10.2, D, LW); line(ctx, -3, -8.4, 3, -8.4, D, LW);
      arms(ctx, 4.2, -13, 6.5, -7, 1.1, C, C);
      sword(ctx, 6.5, -7, 9);
      ballC(ctx, 0, -17.6, 3.7);
      socket(ctx, -1.4, -18.2, 1.1, 1.3); socket(ctx, 1.4, -18.2, 1.1, 1.3);
      line(ctx, -1.8, -15.3, 1.8, -15.3, OUT, LW);
      line(ctx, -0.9, -15.9, -0.9, -14.7, OUT, LW * 0.8); line(ctx, 0.3, -15.9, 0.3, -14.7, OUT, LW * 0.8);
      break;
    }
    case 'zombie': {
      limb(ctx, -2.2, -6.5, -3, 0, 1.7, D); limb(ctx, 2, -6, 3.6, 0, 1.7, D);
      oval(ctx, -3.4, -0.4, 2.2, 1, D); oval(ctx, 4.2, -0.4, 2.2, 1, D);
      ctx.beginPath(); ctx.moveTo(-4, -13); ctx.lineTo(4.5, -14); ctx.lineTo(5, -6.5); ctx.lineTo(-3.5, -6); ctx.closePath();
      cel(ctx, 0.5, -10, 4.5, 4, C, D, L, true);
      line(ctx, -1, -8, 0, -6.2, D, LW); line(ctx, 2.5, -9, 2.5, -6.4, D, LW);
      limb(ctx, 3, -12.5 + w * 0.3, 10.5, -11 + w * 0.3, 1.4, C2); ball(ctx, 10.8, -11 + w * 0.3, 1.5, C2);
      limb(ctx, 2, -10 - w * 0.3, 9.5, -9 - w * 0.3, 1.4, C2); ball(ctx, 9.8, -9 - w * 0.3, 1.5, C2);
      ballC(ctx, 2.5, -16.6, 3.5, C2, D2, C2);
      line(ctx, 3.8, -18.5, 6, -18, OUT, LW * 0.8);
      eye(ctx, 1.2, -16.8, 1); eye(ctx, 4, -17.2, 0.8);
      line(ctx, 2, -14.5, 5, -14.8, OUT, LW);
      break;
    }
    case 'dog': {
      const wag = w * 1.5;
      stick(ctx, -8, -9, -11, -13 + wag, 1.6, C);
      limb(ctx, -2, -6, -2.4, 0, 1.2, D); limb(ctx, 5, -6, 5.8, 0, 1.2, D);
      limb(ctx, -4.5, -6, -5.2, 0, 1.2, C); limb(ctx, 2.8, -6, 2.4, 0, 1.2, C);
      pathCapsule(ctx, -4.5, -8.5, 4, -8.5, 3.6); cel(ctx, 0, -8.5, 8, 3.6);
      tri(ctx, 6, -13.5, 5, -17.5, 8.8, -13.8, D);
      ballC(ctx, 7.5, -11.6, 3.2);
      box(ctx, 8.8, -11.6, 4.8, 2.8, 1, C);
      dot(ctx, 13.2, -11, 0.9, OUT);
      eye(ctx, 8.2, -12.6, 0.9);
      line(ctx, 9.5, -9, 11.5, -9, OUT, LW * 0.8);
      break;
    }
    case 'cat': {
      curl(ctx, -6.5, -6, -11, -9, -9 + w * 0.5, -15, 1.8, C);
      limb(ctx, -3, -5, -3.4, 0, 1, D); limb(ctx, 3.5, -5, 4, 0, 1, D);
      limb(ctx, -5, -5, -5.5, 0, 1, C); limb(ctx, 1.5, -5, 1.2, 0, 1, C);
      pathCapsule(ctx, -4, -6.2, 3, -6.2, 2.9); cel(ctx, -0.5, -6.2, 6, 2.9);
      tri(ctx, 3.8, -12, 3.6, -15.8, 6.4, -12.8, C); tri(ctx, 6.6, -12.8, 8.6, -15.8, 8.6, -12, C);
      ballC(ctx, 6, -10.2, 3.3);
      dot(ctx, 4.2, -14, 0.5, fc(PINK)); dot(ctx, 7.9, -14, 0.5, fc(PINK));
      if (SLEEP) { line(ctx, 4.2, -10.8, 5.8, -10.8, OUT, LW); line(ctx, 6.4, -10.8, 8, -10.8, OUT, LW); }
      else {
        dot(ctx, 5, -10.8, 1, fc(C2)); dot(ctx, 7.2, -10.8, 1, fc(C2));
        line(ctx, 5, -11.7, 5, -9.9, OUT, LW * 0.8); line(ctx, 7.2, -11.7, 7.2, -9.9, OUT, LW * 0.8);
      }
      dot(ctx, 8.8, -9, 0.6, fc(PINK));
      line(ctx, 8, -8.6, 11.5, -9.2, OUT, LW * 0.6); line(ctx, 8, -8.2, 11.5, -7.6, OUT, LW * 0.6);
      break;
    }
    case 'rodent': {
      curl(ctx, -5, -3, -10, -1, -12.5, -6 + w, 1, PINK);
      oval(ctx, -3, -0.5, 2, 1, D); oval(ctx, 3, -0.5, 2, 1, D);
      ovalC(ctx, 0, -4, 5.6, 3.3);
      ball(ctx, 3.6, -8.4, 1.8, C); dot(ctx, 3.6, -8.4, 0.9, fc(PINK));
      ovalC(ctx, 5.4, -5, 3.8, 2.3);
      dot(ctx, 9, -5.2, 0.9, fc(PINK));
      eye(ctx, 5.8, -6, 0.8);
      line(ctx, 7.5, -4.6, 10.5, -3.8, OUT, LW * 0.6); line(ctx, 7.5, -5.4, 10.5, -6.2, OUT, LW * 0.6);
      break;
    }
    case 'dragon': {
      const lift = 4 + w * 3;
      batWing(ctx, -1, 3, -13, 10, lift + 4, D); batWing(ctx, 1, 2, -13, 8, lift + 4, D);
      limb(ctx, -8, -7, -13, -3, 1.8, C); tri(ctx, -13, -1.5, -13, -5, -16.5, -3.6, C2);
      limb(ctx, -2, -5, -2, 0, 1.6, D); limb(ctx, 6, -5, 6.5, 0, 1.6, D);
      limb(ctx, -5, -5, -6, 0, 1.6, C); limb(ctx, 3, -5, 3, 0, 1.6, C);
      ovalC(ctx, -1, -8.5, 8.2, 5);
      pathEllipse(ctx, 0, -6, 5.5, 2.3); flat(ctx, fc(C2));
      line(ctx, -3, -6.8, 3, -6.8, D2, LW * 0.8); line(ctx, -3.5, -5.2, 3.5, -5.2, D2, LW * 0.8);
      tri(ctx, -5, -12.5, -3.5, -15.5, -2, -12.8, D); tri(ctx, -1, -13.2, 0.5, -16, 2, -13.4, D);
      limb(ctx, 5, -11, 8, -19, 2.4, C);
      tri(ctx, 7, -21.5, 5, -24.5, 8.5, -22.5, C2); tri(ctx, 9.5, -22.5, 9, -25.5, 11, -22.5, C2);
      ovalC(ctx, 9.6, -20.6, 4.2, 2.7);
      line(ctx, 10.5, -19, 13.5, -19, OUT, LW);
      dot(ctx, 11.5, -19.5, 0.45, fc(EYE)); dot(ctx, 12.7, -19.5, 0.45, fc(EYE));
      glow(ctx, 10.3, -21.4, 0.9, C2);
      break;
    }
    case 'hydra': {
      const heads = SZ >= 1.6 ? 5 : 3;
      limb(ctx, -5, -4, -6, 0, 1.6, D); limb(ctx, 5, -4, 6, 0, 1.6, D); limb(ctx, -2, -4, -2.5, 0, 1.6, C); limb(ctx, 2.5, -4, 3, 0, 1.6, C);
      ovalC(ctx, 0, -6.5, 8.5, 5);
      for (let k = 0; k < heads; k++) {
        // outer heads first, the middle one last so it sits on top: 0,2,1 or 0,4,1,3,2
        const i = k % 2 === 0 ? k / 2 : heads - 1 - (k - 1) / 2;
        const tt = (i / (heads - 1)) * 2 - 1; // -1..1 across the fan
        const sway = Math.sin(PH * TAU + i * 2) * 0.8;
        const hx = tt * 7.5 + sway, hy = -16 - (1 - Math.abs(tt)) * 3.5;
        limb(ctx, tt * 2.5, -9.5, hx * 0.9, hy + 2, 2, C);
        ballC(ctx, hx, hy, 2.5);
        eye(ctx, hx + 1, hy - 0.6, 0.8, C2);
        line(ctx, hx + 2.4, hy + 0.6, hx + 4, hy + 1.2, fc('#e0303a'), 0.7);
      }
      break;
    }
    case 'golem': {
      box(ctx, -5.8, -7.5, 4.6, 7.5, 1, D); box(ctx, 1.2, -7.5, 4.6, 7.5, 1, D);
      box(ctx, -9.8, -16.5, 3.6, 9.5, 1.2, C); box(ctx, 6.2, -16.5, 3.6, 9.5, 1.2, C);
      ball(ctx, -8, -6.5, 2.1, C); ball(ctx, 8, -6.5, 2.1, C);
      boxC(ctx, -6.5, -17.5, 13, 11, 1.5);
      line(ctx, -2, -15, 0, -12, D, LW); line(ctx, 0, -12, -1, -9, D, LW); line(ctx, 3.5, -10.5, 5.5, -8.5, D, LW);
      pathStar(ctx, 0.5, -12.5, 2, 0.9, 4, 0); flat(ctx, fc(C2));
      boxC(ctx, -3.6, -22.5, 7.2, 5.5, 1);
      if (SLEEP) { line(ctx, -2.8, -19.5, -0.6, -19.5, OUT, LW); line(ctx, 0.6, -19.5, 2.8, -19.5, OUT, LW); }
      else { ctx.fillStyle = fc(C2); ctx.fillRect(-2.8, -20.2, 2.2, 1.3); ctx.fillRect(0.6, -20.2, 2.2, 1.3); }
      break;
    }
    case 'quadruped': {
      stick(ctx, -8, -10, -10.5, -14 + w, 1.4, C); dot(ctx, -10.7, -14.3 + w, 1.2, D);
      limb(ctx, -3, -6, -3.5, 0, 1.7, D); limb(ctx, 6, -6, 6.8, 0, 1.7, D);
      limb(ctx, -6, -6, -7, 0, 1.7, C); limb(ctx, 3, -6, 2.6, 0, 1.7, C);
      oval(ctx, -7.6, -0.4, 2, 0.9, D); oval(ctx, 2.4, -0.4, 2, 0.9, D); oval(ctx, -3.8, -0.4, 2, 0.9, D); oval(ctx, 7.2, -0.4, 2, 0.9, D);
      ovalC(ctx, 0, -9, 8.4, 5);
      pathEllipse(ctx, -1, -12.5, 5, 2); flat(ctx, D);
      stick(ctx, 7, -15, 6, -18.5, 1.5, C2); stick(ctx, 9.5, -15, 10.5, -18.5, 1.5, C2);
      ballC(ctx, 8.4, -13, 3.6);
      box(ctx, 10, -13, 4.6, 3.2, 1.2, C);
      dot(ctx, 14.2, -12.2, 0.8, OUT);
      eye(ctx, 9, -14.2, 0.9);
      break;
    }
    case 'demon': {
      const lift = 3 + w * 2.5;
      batWing(ctx, -1, 3, -13, 9, lift, D); batWing(ctx, 1, 3, -13, 9, lift, D);
      curl(ctx, -3, -7, -10, -6, -10, -13 + w, 1.4, C); tri(ctx, -11.5, -13 + w, -8.5, -13 + w, -10, -16 + w, C);
      legs(ctx, -7.5, 2.6, 1.9, C, D);
      boxC(ctx, -4.8, -15.5, 9.6, 8.5, 2.2);
      line(ctx, 0, -14, 0, -9, D, LW);
      arms(ctx, 4.6, -14, 7.4, -7.5, 1.6, C, C);
      line(ctx, -8, -8, -9.2, -5.5, OUT, LW); line(ctx, -7.2, -7.5, -7.6, -5, OUT, LW);
      line(ctx, 8, -8, 9.2, -5.5, OUT, LW); line(ctx, 7.2, -7.5, 7.6, -5, OUT, LW);
      tri(ctx, -2.5, -20, -5.5, -25, -0.5, -21.5, C2); tri(ctx, 2.5, -20, 5.5, -25, 0.5, -21.5, C2);
      ballC(ctx, 0, -18.5, 3.7);
      glows(ctx, 0, -19.3, 1.4, 0.95, C2);
      line(ctx, -1.8, -16.4, 1.8, -16.4, OUT, LW);
      line(ctx, -1, -16.4, -1, -15.4, fc(EYE), 0.8); line(ctx, 0.8, -16.4, 0.8, -15.4, fc(EYE), 0.8);
      break;
    }
    case 'vortex': {
      const rot = PH * TAU, cy = -9;
      for (let k = 0; k < 3; k++) {
        const a0 = rot + k * TAU / 3, a1 = a0 + 1.95;
        ctx.beginPath(); ctx.arc(0, cy, 9, a0, a1); ctx.arc(0, cy, 5, a1 + 0.5, a0 + 0.55, true); ctx.closePath();
        fin(ctx, k === 1 ? L : C);
      }
      for (let k = 0; k < 3; k++) {
        const a0 = -rot * 1.3 + k * TAU / 3 + 1, a1 = a0 + 1.7;
        ctx.beginPath(); ctx.arc(0, cy, 5.2, a0, a1); ctx.arc(0, cy, 2.4, a1 + 0.6, a0 + 0.6, true); ctx.closePath();
        fin(ctx, k === 1 ? C : D);
      }
      ball(ctx, 0, cy, 1.8, C2);
      break;
    }
    case 'elemental': {
      for (let i = 0; i < 4; i++) {
        const cy = -3.2 - i * 4.4, rx = 6.6 - i * 1.05, ry = 3.7, cx = Math.sin(PH * TAU + i * 1.3) * 1.3;
        ovalC(ctx, cx, cy, rx, ry);
        if (i === 3) tri(ctx, cx - 2.6, cy - 1.5, cx + 2.8, cy - 1.5, cx + 0.6, cy - 7.5 - w, L);
        if (i === 2) {
          if (SLEEP) { line(ctx, cx - 3, cy, cx - 1, cy, OUT, LW); line(ctx, cx + 1, cy, cx + 3, cy, OUT, LW); }
          else { tri(ctx, cx - 3.2, cy - 1.2, cx - 0.8, cy - 0.2, cx - 2.8, cy + 0.8, C2); tri(ctx, cx + 3.2, cy - 1.2, cx + 0.8, cy - 0.2, cx + 2.8, cy + 0.8, C2); }
        }
      }
      break;
    }
    case 'tree': {
      ctx.beginPath(); ctx.moveTo(-5.5, 0); ctx.lineTo(-2.6, -3); ctx.lineTo(-2.4, -10); ctx.lineTo(2.4, -10); ctx.lineTo(2.6, -3); ctx.lineTo(5.5, 0); ctx.closePath();
      cel(ctx, 0, -5, 3, 5, C2, D2, C2, true);
      stick(ctx, -2.5, -8, -7.5 - w * 0.4, -10.5, 1.6, C2); stick(ctx, 2.5, -8.5, 7.5 + w * 0.4, -11, 1.6, C2);
      // canopy: stroke every lobe first, then fill them all, so the cluster reads as one silhouette
      for (let pass = 0; pass < 2; pass++) {
        pathEllipse(ctx, -5.2, -13, 4.6, 4.6); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathEllipse(ctx, 5.2, -13, 4.6, 4.6); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathEllipse(ctx, 0, -11.5, 5.2, 5.2); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathEllipse(ctx, 0, -17, 5.6, 5.6); if (pass) flat(ctx, C); else outlineOnly(ctx);
      }
      dot(ctx, 4.5, -11, 3, D); dot(ctx, 7, -14.5, 2.2, D); dot(ctx, 1.5, -8.5, 2.6, D);
      dot(ctx, -3, -17.5, 2, L); dot(ctx, -6.5, -13.5, 1.5, L);
      eyes(ctx, 0, -7, 1.3, 0.9);
      line(ctx, -1.2, -4.5, 1.2, -4.5, OUT, LW);
      break;
    }
    case 'mimic': {
      boxC(ctx, -7, -8.5, 14, 8.5, 1.5);
      ctx.fillStyle = D; ctx.fillRect(-4.6, -8.5, 1.6, 8.5); ctx.fillRect(3, -8.5, 1.6, 8.5);
      ctx.fillStyle = OUT; ctx.fillRect(-6.6, -12, 13.2, 3.8);
      pathEllipse(ctx, 1, -9, 2.8, 1.6); flat(ctx, fc('#e0303a'));
      boxC(ctx, -7, -16 - w * 0.4, 14, 5.5, 2);
      ctx.fillStyle = D; ctx.fillRect(-4.6, -16 - w * 0.4, 1.6, 5.5); ctx.fillRect(3, -16 - w * 0.4, 1.6, 5.5);
      for (let i = 0; i < 5; i++) {
        const tx = -5.2 + i * 2.6;
        ctx.beginPath(); ctx.moveTo(tx - 1, -10.6 - w * 0.4); ctx.lineTo(tx + 1, -10.6 - w * 0.4); ctx.lineTo(tx, -8.6 - w * 0.4); ctx.closePath(); flat(ctx, fc(EYE));
        ctx.beginPath(); ctx.moveTo(tx + 0.3, -8.5); ctx.lineTo(tx + 2.3, -8.5); ctx.lineTo(tx + 1.3, -10.4); ctx.closePath(); flat(ctx, fc(EYE));
      }
      box(ctx, -1.4, -14.3 - w * 0.4, 2.8, 2.4, 0.6, C2);
      glows(ctx, 0, -18 - w * 0.4, 3.5, 0.8, C2);
      break;
    }
    case 'generator': {
      const p = (w + 1) / 2;
      // Condition: whole, cracked open, or nearly finished. The mouth dims and the housing splits.
      const glow = TIER >= 3 ? 1 : TIER === 2 ? 0.66 : 0.36;
      oval(ctx, 0, -1.2, 9.6, 3, D);
      boxC(ctx, -7.6, -6.5, 15.2, 6, 2.8);
      if (TIER >= 2) boxC(ctx, -5.2, -10.5, 10.4, 5, 2.6);
      else { ctx.save(); ctx.rotate(0.2); boxC(ctx, -5.2, -9.6, 10.4, 4, 2.4); ctx.restore(); }
      ball(ctx, -4.2, -4.2, 1.7, L); dot(ctx, -4.7, -4.4, 0.5, OUT); dot(ctx, -3.6, -4.4, 0.5, OUT);
      if (TIER >= 2) { ball(ctx, 3.6, -8.5, 1.5, L); dot(ctx, 3.1, -8.7, 0.45, OUT); dot(ctx, 4.1, -8.7, 0.45, OUT); }
      dot(ctx, 5.5, -4, 1, D); dot(ctx, -1, -8, 0.9, D);
      // Cracks, one more for every stage it has lost.
      if (TIER <= 2) line(ctx, -4.6, -6.4, -1.8, -2.2, OUT, LW);
      if (TIER <= 1) { line(ctx, 2.4, -6.6, 5.6, -1.6, OUT, LW); line(ctx, -6.8, -3.4, -4.4, -1.2, OUT, LW); }
      if (!FLASH && glow > 0.4) { pathEllipse(ctx, 0, -14, (5.2 + p * 2) * glow, (5.2 + p * 2) * glow); flat(ctx, halo(C2)); }
      ball(ctx, 0, -14, (2.8 + p * 0.8) * glow, C2);
      dot(ctx, -0.9, -15, 0.9 * glow, fc(WHITE));
      if (TIER >= 2) { dot(ctx, -5.5, -12 - p, 0.6, fc(C2)); dot(ctx, 5.5, -13 + p, 0.6, fc(C2)); }
      if (TIER >= 3) dot(ctx, 1, -19.5 - p, 0.6, fc(C2));
      break;
    }
    case 'mushroom': {
      box(ctx, -2.3, -9, 4.6, 9, 1.6, C2);
      ctx.beginPath(); ctx.ellipse(0, -8.5, 7.6, 5.6 + w * 0.3, 0, Math.PI, 0); ctx.closePath();
      cel(ctx, 0, -11.2, 7.6, 2.8);
      line(ctx, -7, -8.5, 7, -8.5, D, LW);
      dot(ctx, -3.2, -11.5, 1.3, L); dot(ctx, 2, -13, 1, L); dot(ctx, 4.6, -10.5, 0.8, L);
      eyes(ctx, 0.2, -5.8, 1, 0.7);
      break;
    }
    case 'centipede': {
      for (let i = 0; i < 8; i++) {
        const sx = -10.5 + i * 2.9, sy = -2.6 + Math.sin(PH * TAU * 2 + i * 0.9) * 0.6;
        stick(ctx, sx, sy + 1, sx - 1.4, 0, 0.9, C); stick(ctx, sx, sy + 1, sx + 1.4, 0, 0.9, C);
      }
      for (let i = 0; i < 8; i++) {
        const sx = -10.5 + i * 2.9, sy = -2.6 + Math.sin(PH * TAU * 2 + i * 0.9) * 0.6;
        if (i === 7) {
          ballC(ctx, sx + 0.6, sy - 0.3, 2.8);
          stick(ctx, sx + 2, sy - 2, sx + 5, sy - 5.5 + w * 0.5, 0.8, C); stick(ctx, sx + 2.5, sy - 1, sx + 6, sy - 3 + w * 0.5, 0.8, C);
          line(ctx, sx + 3, sy + 1, sx + 4.5, sy + 2, OUT, LW); line(ctx, sx + 3.2, sy - 0.5, sx + 4.8, sy - 0.2, OUT, LW);
          glow(ctx, sx + 1.5, sy - 1, 0.7, C2);
        } else ball(ctx, sx, sy, 2.3, i % 2 ? D : C);
      }
      break;
    }
    case 'giant': {
      legs(ctx, -9, 3.6, 2.6, D, D2);
      boxC(ctx, -7.2, -19, 14.4, 11, 3);
      line(ctx, -6.5, -10.5, 6.5, -10.5, D, LW * 1.2); box(ctx, -1.3, -11.5, 2.6, 2, 0.4, C2);
      arms(ctx, 7.2, -17, 10, -8, 2.3, C, C2);
      club(ctx, 10, -8.5, 13);
      ballC(ctx, 0, -22.5, 4.2, C2, D2, C2);
      pathEllipse(ctx, 0, -19.6, 3.2, 1.8); flat(ctx, D2);
      pathRrect(ctx, -4, -26.5, 8, 3.4, 1.5); fin(ctx, D2);
      eyes(ctx, 0, -23.2, 1.5, 0.9);
      break;
    }
    case 'troll': {
      limb(ctx, -3.2, -6, -3.8, 0, 2, D); limb(ctx, 3, -6, 3.6, 0, 2, D);
      oval(ctx, -4.2, -0.4, 2.6, 1.1, D); oval(ctx, 4, -0.4, 2.6, 1.1, D);
      pathEllipse(ctx, 0, -10.5, 6.8, 5.4, -0.3); cel(ctx, 0, -10.5, 6.8, 5.4);
      limb(ctx, -5.5, -12, -8.5 - w * 0.3, -1.5, 1.9, C); ball(ctx, -8.8 - w * 0.3, -1.4, 2, D);
      limb(ctx, 5.5, -11.5, 8.5 + w * 0.3, -1.5, 1.9, C); ball(ctx, 8.8 + w * 0.3, -1.4, 2, D);
      ballC(ctx, 4, -15, 3.6);
      ball(ctx, 7.2, -14.6, 1.5, C2);
      line(ctx, 4.5, -12.5, 7.4, -12.6, OUT, LW);
      line(ctx, 5, -12.4, 5, -11, fc(EYE), 0.9);
      eyes(ctx, 3.8, -16.2, 1.3, 0.75);
      dot(ctx, 1.5, -7.5, 0.7, D); dot(ctx, -2.5, -13, 0.7, D);
      break;
    }
    case 'ogre': {
      limb(ctx, -3.4, -5.5, -3.8, 0, 2.4, C); limb(ctx, 3.4, -5.5, 3.8, 0, 2.4, C);
      oval(ctx, -4.2, -0.4, 2.8, 1.1, D2); oval(ctx, 4.2, -0.4, 2.8, 1.1, D2);
      ballC(ctx, 0, -10, 6.8);
      box(ctx, -4.5, -6.5, 9, 3.4, 1, C2);
      line(ctx, -1.5, -6.5, -1.5, -3.5, D2, LW); line(ctx, 1.5, -6.5, 1.5, -3.5, D2, LW);
      arms(ctx, 6.2, -14, 8.6, -6.5, 2.2, C, C);
      club(ctx, 8.6, -7, 11);
      ballC(ctx, 0, -18.2, 3.4);
      eyes(ctx, 0, -18.8, 1.3, 0.8);
      line(ctx, -1.5, -16.2, 1.8, -16.4, OUT, LW);
      line(ctx, 1, -16.3, 1, -17.3, fc(EYE), 0.9);
      break;
    }
    case 'orc': {
      legs(ctx, -7.5, 2.6, 1.8, D, D2);
      boxC(ctx, -4.6, -14.5, 9.2, 8, 2);
      box(ctx, -4.8, -12.5, 9.6, 2.2, 0.5, D2);
      quad(ctx, -4.5, -13, -1, -14, 1, -7, -2.5, -7.5, D);
      arms(ctx, 4.4, -13.5, 6.8, -7.5, 1.6, C, C);
      box(ctx, -9.5, -12.5, 4.5, 6, 1.5, D2);
      sword(ctx, 6.8, -7.5, 9);
      ballC(ctx, 0, -17.6, 3.7);
      ctx.beginPath(); ctx.arc(0, -18.4, 4.1, Math.PI, 0); ctx.lineTo(4.1, -17.2); ctx.lineTo(-4.1, -17.2); ctx.closePath(); fin(ctx, fc(METAL_DK));
      ctx.fillStyle = fc(METAL_DK); ctx.fillRect(-0.7, -18, 1.4, 3);
      glows(ctx, 0, -17.6, 1.6, 0.8, C2);
      line(ctx, -1.8, -15.2, 1.8, -15.2, OUT, LW);
      tri(ctx, -2.2, -15, -0.8, -15, -1.6, -17, fc(EYE)); tri(ctx, 0.8, -15, 2.2, -15, 1.6, -17, fc(EYE));
      break;
    }
    case 'kobold': {
      curl(ctx, -3, -4, -8, -3, -8, -7 + w * 0.5, 1.1, C);
      legs(ctx, -5.5, 2.2, 1.4, D, D2);
      boxC(ctx, -3.6, -10.5, 7.2, 5.5, 1.6);
      arms(ctx, 3.4, -9.8, 5.4, -5.5, 1.2, C, C);
      stick(ctx, 5.6, -4, 6, -15.5, 1.1, WOOD); tri(ctx, 5, -15, 7, -15, 6.1, -18, fc(METAL));
      tri(ctx, -1.5, -14, -4.5, -18, 0.5, -15.5, C); tri(ctx, 1.5, -14, 4.5, -18, 0.5, -15.5, C);
      ballC(ctx, 0.5, -13, 3.1);
      oval(ctx, 3.2, -12.2, 2.3, 1.4, C);
      dot(ctx, 5.2, -12.6, 0.6, OUT);
      eyes(ctx, 0.3, -13.8, 1.3, 0.85);
      break;
    }
    case 'humanoid': case 'rig': {
      legs(ctx, -7.5, 2.4, 1.8, D, D2);
      boxC(ctx, -4.6, -15, 9.2, 8.2, 2);
      line(ctx, -4.4, -8.8, 4.4, -8.8, D, LW * 1.2);
      arms(ctx, 4.4, -13.8, 6.6, -8, 1.5, C, C2);
      sword(ctx, 6.6, -8, 10);
      ballC(ctx, 0, -18, 3.6, C2, D2, C2);
      ctx.beginPath(); ctx.arc(0, -18.4, 3.8, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); fin(ctx, D);
      eyes(ctx, 0, -18.4, 1.3, 0.85);
      line(ctx, -0.8, -16, 1, -16, OUT, LW * 0.8);
      break;
    }
    case 'yeek': {
      limb(ctx, -1.6, -4, -2.2, 0, 1, C); limb(ctx, 1.6, -4, 2.2, 0, 1, C);
      boxC(ctx, -2.6, -8.8, 5.2, 5.2, 1.6);
      limb(ctx, -2.4, -8, -4.5 - w * 0.3, -4.5, 0.9, C); limb(ctx, 2.4, -8, 4.5 + w * 0.3, -4.5, 0.9, C);
      ballC(ctx, 0, -11.8, 3.5);
      eyes(ctx, 0, -12.2, 1.4, 1.2);
      dot(ctx, 0, -9.6, 0.5, OUT);
      break;
    }
    case 'ant': {
      stick(ctx, -1, -3.2, -3.6, 0, 0.8, C); stick(ctx, 0, -3.2, 0.4, 0, 0.8, C); stick(ctx, 1, -3.2, 3.6, 0, 0.8, C);
      stick(ctx, -0.5, -3.2, -2, 0, 0.8, D); stick(ctx, 0.5, -3.2, 2, 0, 0.8, D);
      ovalC(ctx, -4.2, -3.2, 3.3, 2.4);
      oval(ctx, 0, -3.8, 2.2, 1.7, C);
      ballC(ctx, 3.8, -4.2, 2);
      stick(ctx, 4.5, -5.8, 6.5, -8.5 + w * 0.4, 0.6, C); stick(ctx, 5.2, -5.4, 7.5, -7 + w * 0.4, 0.6, C);
      line(ctx, 5.5, -3.5, 7, -3, OUT, LW * 0.9); line(ctx, 5.5, -4.2, 7.2, -4.4, OUT, LW * 0.9);
      dot(ctx, 4.4, -4.6, 0.55, fc(EYE));
      break;
    }
    case 'louse': {
      stick(ctx, -2, -2.5, -3.5, 0, 0.7, C); stick(ctx, 0, -2.5, 0, 0, 0.7, C); stick(ctx, 2, -2.5, 3.5, 0, 0.7, C);
      ovalC(ctx, 0, -3, 3.6, 2.5);
      ball(ctx, 3.8, -3.2, 1.3, C);
      stick(ctx, 4.3, -4, 5.5, -5.5, 0.5, C);
      dot(ctx, 4.2, -3.5, 0.45, OUT);
      dot(ctx, 1.2, -3.8, 0.5, D); dot(ctx, -1.2, -3.2, 0.5, D);
      break;
    }
    case 'nether': {
      ctx.save(); ctx.globalAlpha *= 0.55;
      for (let i = 0; i < 3; i++) {
        const t = (PH + i / 3) % 1, wy = -13 - t * 9, wx = (i - 1) * 3 + Math.sin(t * TAU) * 1.5, r = 2.6 * (1 - t) + 0.5;
        ctx.globalAlpha *= 1 - t * 0.6;
        dot(ctx, wx, wy, r, C);
        ctx.globalAlpha /= 1 - t * 0.6;
      }
      pathEllipse(ctx, 0, -0.8, 6.5, 2.2); flat(ctx, C);
      ctx.restore();
      for (let pass = 0; pass < 2; pass++) {
        pathEllipse(ctx, 0, -6, 6.6, 5.2); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathEllipse(ctx, -3.2 + w * 0.5, -10.5, 4.4, 4.2); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathEllipse(ctx, 3.2 - w * 0.5, -11, 3.8, 3.8); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathEllipse(ctx, 0.5, -14.5 + w * 0.6, 3.5, 3.5); if (pass) flat(ctx, C); else outlineOnly(ctx);
      }
      dot(ctx, 3, -6, 2.5, D); dot(ctx, 4.5, -9.5, 1.6, D); dot(ctx, -4, -13.5, 1.5, L);
      glows(ctx, 0.2, -10.5, 2.2, 1.2, C2);
      break;
    }
    case 'angel': {
      const lift = 6 + w * 1.5;
      featherWing(ctx, -1, 3, -13.5, 10.5, lift, fc('#f6f2ff'), fc('#c8c0e0')); featherWing(ctx, 1, 3, -13.5, 10.5, lift, fc('#f6f2ff'), fc('#c8c0e0'));
      ctx.beginPath(); ctx.moveTo(-5.6, 0); ctx.lineTo(-3.6, -14.5); ctx.lineTo(3.6, -14.5); ctx.lineTo(5.6, 0); ctx.closePath();
      cel(ctx, 0, -7.2, 5.6, 7.2, C, D, L, true);
      line(ctx, -3.5, -12, 3.5, -12, C2, LW * 1.2);
      arms(ctx, 3.8, -13, 5.4, -7.5, 1.3, C, C2);
      sword(ctx, 5.4, -7.5, 10);
      ballC(ctx, 0, -18, 3.5, C2, D2, C2);
      ctx.beginPath(); ctx.arc(0, -18.5, 3.7, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); fin(ctx, fc(GOLD));
      eyes(ctx, 0, -18.3, 1.3, 0.85);
      pathEllipse(ctx, 0, -23.5 + w * 0.4, 4.2, 1.3); ctx.strokeStyle = OUT; ctx.lineWidth = 1.4 + LW * 2; ctx.stroke(); ctx.strokeStyle = fc(GOLD); ctx.lineWidth = 1.4; ctx.stroke();
      break;
    }
    case 'harpy': {
      const lift = 4 + w * 3;
      tri(ctx, -3, -6, -8, -3, -7.5, -8, D); tri(ctx, -3, -6, -9, -6, -6, -10, D);
      featherWing(ctx, -1, 3, -11, 9.5, lift, C, D); featherWing(ctx, 1, 3, -11, 9.5, lift, C, D);
      stick(ctx, -2, -6, -2.6, 0, 1.1, fc(C2)); stick(ctx, 2.2, -6, 2.8, 0, 1.1, fc(C2));
      line(ctx, -4, 0, -1, 0, OUT, LW); line(ctx, 1.4, 0, 4.4, 0, OUT, LW); line(ctx, -2.6, 0, -3, -1.5, OUT, LW); line(ctx, 2.8, 0, 2.4, -1.5, OUT, LW);
      ovalC(ctx, 0, -9.5, 4.2, 4.6);
      line(ctx, -2, -8, -1, -6, D, LW); line(ctx, 1, -8, 2, -6, D, LW);
      arms(ctx, 3.8, -12.5, 6, -9.5, 1.1, C2, C2);
      pathStar(ctx, 0, -16.5, 5.2, 3.4, 7, -0.3 + w * 0.05); fin(ctx, D);
      ballC(ctx, 0, -15.5, 3.2, C2, D2, C2);
      eyes(ctx, 0, -15.8, 1.2, 0.8);
      line(ctx, -0.8, -13.7, 0.8, -13.7, OUT, LW * 0.8);
      break;
    }
    case 'naga': {
      ovalC(ctx, 0, -3, 8.6, 3.2);
      tri(ctx, 8, -4.5, 11.5, -2.5 + w * 0.5, 8, -1.5, C);
      ovalC(ctx, -1, -6.6, 6, 2.6);
      dot(ctx, -4, -3, 0.8, D); dot(ctx, 1, -2.4, 0.8, D); dot(ctx, 5, -3.6, 0.8, D); dot(ctx, -2, -6.4, 0.7, D); dot(ctx, 2, -6.8, 0.7, D);
      pathEllipse(ctx, 0.3, -17, 4.4, 4.8); fin(ctx, D);
      pathRrect(ctx, -3.6, -15.5, 7.2, 8.5, 2.6); cel(ctx, 0, -11.2, 3.6, 4.2, C2, D2, C2);
      pathRrect(ctx, -3.8, -10, 7.6, 2.6, 1); fin(ctx, C);
      arms(ctx, 3.4, -14, 5.8, -9.5, 1.3, C2, C2);
      ballC(ctx, 0, -18.5, 3.3, C2, D2, C2);
      ctx.beginPath(); ctx.arc(0, -18.8, 3.6, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); fin(ctx, D);
      eyes(ctx, 0, -18.7, 1.3, 0.85, C);
      break;
    }
    case 'wight': {
      ctx.beginPath();
      ctx.moveTo(-7, 0); ctx.lineTo(-5.5, 0); ctx.lineTo(-4.5, -1.5); ctx.lineTo(-3, 0); ctx.lineTo(-1, -1.5); ctx.lineTo(1, 0); ctx.lineTo(3, -1.5); ctx.lineTo(4.5, 0); ctx.lineTo(5.5, -1.5); ctx.lineTo(7, 0);
      ctx.quadraticCurveTo(5.5, -10, 4.2, -16.5); ctx.arc(0, -16.5, 4.2, 0, Math.PI, true); ctx.quadraticCurveTo(-5.5, -10, -7, 0);
      ctx.closePath();
      cel(ctx, 0, -9, 7, 9);
      line(ctx, -2, -13, -3, -3, D, LW); line(ctx, 2.5, -12, 3.5, -3, D, LW);
      pathEllipse(ctx, 0.4, -15.8, 3, 2.6); flat(ctx, OUT);
      pathEllipse(ctx, 0.6, -15.4, 2.5, 2.3); flat(ctx, fc(BONE));
      socket(ctx, -0.3, -15.6, 0.8, 0.9); socket(ctx, 1.6, -15.6, 0.8, 0.9);
      if (!SLEEP) { dot(ctx, -0.3, -15.6, 0.4, fc(C2)); dot(ctx, 1.6, -15.6, 0.4, fc(C2)); }
      line(ctx, -0.6, -13.6, 1.8, -13.6, OUT, LW * 0.8);
      ball(ctx, -5.6, -7 + w * 0.3, 1.4, fc(BONE)); ball(ctx, 6.2, -6.5 - w * 0.3, 1.4, fc(BONE));
      line(ctx, -5.6, -6 + w * 0.3, -5.8, -4.5 + w * 0.3, OUT, LW * 0.8); line(ctx, -4.6, -6.2 + w * 0.3, -4.4, -4.8 + w * 0.3, OUT, LW * 0.8);
      line(ctx, 6.2, -5.5 - w * 0.3, 6.4, -4 - w * 0.3, OUT, LW * 0.8); line(ctx, 7.2, -5.7 - w * 0.3, 7.5, -4.3 - w * 0.3, OUT, LW * 0.8);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Item icons

/**
 * Draw a floor item icon centred at (x, y): 'potion' | 'scroll' | 'wand' | 'staff' | 'rod' | 'ring' | 'amulet' | 'food' |
 * 'weapon' | 'bow' | 'ammo' | 'armor' | 'shield' | 'helm' | 'cloak' | 'gloves' | 'boots' | 'light' | 'book' | 'chest' |
 * 'gold' | 'key' | 'flask' | 'spike' | 'junk' | 'digger'. Anything else draws a generic bundle.
 */
export function drawItemIcon(ctx: CanvasRenderingContext2D, icon: string, x: number, y: number, color: string, size = 1): void {
  setPalette(color, undefined, false);
  SLEEP = false; PH = 0;
  LW = Math.min(1.5, Math.max(0.5, 1 / size));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  drawIcon(ctx, icon);
  ctx.restore();
}

/** Ring of colour `c` (dark rim under), radius r, thickness t. */
function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, c: string, a0 = 0, a1 = TAU): void {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1);
  ctx.strokeStyle = OUT; ctx.lineWidth = t + LW * 2; ctx.stroke();
  ctx.strokeStyle = c; ctx.lineWidth = t; ctx.stroke();
}

function drawIcon(ctx: CanvasRenderingContext2D, icon: string): void {
  switch (icon) {
    case 'potion':
      box(ctx, -1.6, -7.5, 3.2, 2.4, 0.6, WOOD);
      box(ctx, -1.7, -5.6, 3.4, 3, 0.6, GLASS);
      ball(ctx, 0, 1.4, 4.8, GLASS);
      pathEllipse(ctx, 0, 2.2, 3.6, 3.4); flat(ctx, C);
      dot(ctx, -1.6, 0.4, 0.9, L);
      dot(ctx, -2.4, -0.4, 0.8, WHITE);
      break;
    case 'scroll':
      box(ctx, -5.5, -3.6, 11, 7.2, 1, PAPER);
      box(ctx, -6.6, -4.6, 2.6, 9.2, 1.1, '#d8ccaa'); box(ctx, 4, -4.6, 2.6, 9.2, 1.1, '#d8ccaa');
      line(ctx, -3, -1.5, 3, -1.5, C, 1); line(ctx, -3, 0.5, 2, 0.5, C, 1); line(ctx, -3, 2.3, 3, 2.3, C, 1);
      break;
    case 'wand':
      limb(ctx, -4.5, 4.5, 3, -3, 1, WOOD);
      pathStar(ctx, 4, -4, 2.8, 1.2, 4, 0); fin(ctx, C);
      break;
    case 'staff':
      limb(ctx, -1, 7, 1.2, -5.5, 1.1, WOOD);
      ball(ctx, 1.5, -6, 2.1, C); dot(ctx, 0.8, -6.7, 0.6, WHITE);
      break;
    case 'rod':
      limb(ctx, -5, 4, 5, -4, 1.3, METAL);
      ball(ctx, -5, 4, 1.6, C); ball(ctx, 5, -4, 1.6, C);
      line(ctx, -3.5, 1.5, 3, -3.5, WHITE, 0.6);
      break;
    case 'ring':
      ring(ctx, 0, 0.8, 4.2, 2.4, GOLD);
      pathStar(ctx, 0, -3.6, 2.4, 1.5, 4, 0); fin(ctx, C);
      dot(ctx, -0.6, -4.2, 0.5, WHITE);
      break;
    case 'amulet':
      ring(ctx, 0, 0, 5.5, 1, '#d8d8e4', Math.PI * 1.1, Math.PI * 1.9);
      line(ctx, -4.7, -1.7, -1, 2.8, OUT, LW * 2 + 1); line(ctx, 4.7, -1.7, 1, 2.8, OUT, LW * 2 + 1);
      line(ctx, -4.7, -1.7, -1, 2.8, '#d8d8e4', 1); line(ctx, 4.7, -1.7, 1, 2.8, '#d8d8e4', 1);
      pathStar(ctx, 0, 3.2, 3.6, 2, 4, 0); fin(ctx, C);
      dot(ctx, -0.8, 2.4, 0.6, WHITE);
      break;
    case 'food':
      box(ctx, -6, -3, 12, 6.5, 3.2, C);
      line(ctx, -3, -2.2, -2, 0, D, 1); line(ctx, 0, -2.2, 1, 0, D, 1); line(ctx, 3, -2.2, 4, 0, D, 1);
      dot(ctx, -3.5, -1.2, 0.8, L);
      break;
    case 'weapon':
      limb(ctx, -1.5, 1.5, -4.5, 4.5, 1.1, '#5a3a2a'); ball(ctx, -5, 5, 1.2, GOLD);
      pathTaperedCapsule(ctx, -0.5, 0.5, 6, -6, 1.2, 0.2); fin(ctx, METAL);
      line(ctx, -3.5, -1, 1.5, 3.5, OUT, LW * 2 + 1.6); line(ctx, -3.5, -1, 1.5, 3.5, C, 1.6);
      line(ctx, 0.5, -1.2, 4.5, -5, WHITE, 0.6);
      break;
    case 'bow':
      ring(ctx, 2, 0, 6.4, 1.6, WOOD, Math.PI * 0.62, Math.PI * 1.38);
      line(ctx, 0, -5.9, 0, 5.9, OUT, LW * 2 + 0.8); line(ctx, 0, -5.9, 0, 5.9, '#e8e4d8', 0.8);
      limb(ctx, -0.5, 0, 6.5, 0, 0.55, C);
      break;
    case 'ammo':
      stick(ctx, -5, 5, 5, -5, 1.1, WOOD);
      tri(ctx, 4, -6.5, 6.8, -6.8, 6.5, -4, METAL);
      tri(ctx, -5, 5, -6.5, 2, -3, 3.4, C); tri(ctx, -5, 5, -2, 6.5, -3.4, 3, C);
      break;
    case 'armor':
      ctx.beginPath(); ctx.moveTo(-6.5, -5); ctx.lineTo(-2.5, -6.5); ctx.lineTo(0, -4.5); ctx.lineTo(2.5, -6.5); ctx.lineTo(6.5, -5); ctx.lineTo(5.5, -0.5); ctx.lineTo(4, -1); ctx.lineTo(4, 6.5); ctx.lineTo(-4, 6.5); ctx.lineTo(-4, -1); ctx.lineTo(-5.5, -0.5); ctx.closePath();
      cel(ctx, 0, 0, 6.5, 6.5, C, D, L, true);
      line(ctx, 0, -3, 0, 5.5, D, 1);
      break;
    case 'shield':
      ctx.beginPath(); ctx.moveTo(-5.8, -5.5); ctx.lineTo(5.8, -5.5); ctx.lineTo(5.8, 0); ctx.quadraticCurveTo(5.8, 4.5, 0, 6.8); ctx.quadraticCurveTo(-5.8, 4.5, -5.8, 0); ctx.closePath();
      cel(ctx, 0, 0, 5.8, 6);
      line(ctx, 0, -4, 0, 5, D, 1.2); line(ctx, -4.5, -1, 4.5, -1, D, 1.2);
      ball(ctx, 0, -1, 1.5, GOLD);
      break;
    case 'helm':
      ctx.beginPath(); ctx.arc(0, 0.5, 5.6, Math.PI, 0); ctx.closePath(); cel(ctx, 0, -2.5, 5.6, 3);
      box(ctx, -6.8, 0, 13.6, 2.4, 1, D);
      ctx.fillStyle = D; ctx.fillRect(-0.9, -1, 1.8, 5);
      tri(ctx, -1, -5, 1, -5, 0, -8.5, C2);
      break;
    case 'cloak':
      ctx.beginPath(); ctx.moveTo(0, -6.5); ctx.lineTo(-6, 6); ctx.lineTo(-2, 5); ctx.lineTo(0, 6.5); ctx.lineTo(2, 5); ctx.lineTo(6, 6); ctx.closePath();
      cel(ctx, 0, 0, 6, 6.5, C, D, L, true);
      line(ctx, -1.5, -3, -3, 4, D, 1); line(ctx, 1.5, -3, 3, 4, D, 1);
      ball(ctx, 0, -5.4, 1.5, GOLD);
      break;
    case 'gloves':
      oval(ctx, -3.8, 0.5, 1.7, 2.4, C);
      pathRrect(ctx, -2.6, -5, 6.2, 11.5, 2.6); cel(ctx, 0.5, 0.7, 3.1, 5.7);
      line(ctx, -2.2, 3.5, 3.2, 3.5, D, 1);
      line(ctx, -0.5, -4.5, -0.5, 1.5, D, 0.8); line(ctx, 1.5, -4.5, 1.5, 1.5, D, 0.8);
      break;
    case 'boots':
      ctx.beginPath(); ctx.moveTo(-3.2, -6.5); ctx.lineTo(1, -6.5); ctx.lineTo(1, 1); ctx.lineTo(5.5, 3); ctx.lineTo(5.5, 6.5); ctx.lineTo(-3.2, 6.5); ctx.closePath();
      cel(ctx, 1, 0, 4.4, 6.5, C, D, L, true);
      ctx.fillStyle = D; ctx.fillRect(-3.2, 4.8, 8.7, 1.7);
      line(ctx, -3.2, -3.5, 1, -3.5, D, 1);
      break;
    case 'light':
      limb(ctx, 0, 6.5, 0, 0, 1.4, WOOD);
      box(ctx, -2.2, -1.5, 4.4, 2.2, 0.5, METAL_DK);
      ctx.beginPath(); ctx.moveTo(-3, -1.5); ctx.quadraticCurveTo(-3.6, -5.5, 0, -8); ctx.quadraticCurveTo(3.6, -5.5, 3, -1.5); ctx.closePath(); fin(ctx, FLAME);
      ctx.beginPath(); ctx.moveTo(-1.4, -1.5); ctx.quadraticCurveTo(-1.8, -4, 0.2, -5.5); ctx.quadraticCurveTo(1.8, -4, 1.4, -1.5); ctx.closePath(); flat(ctx, FLAME2);
      break;
    case 'book':
      pathRrect(ctx, -5.2, -6.2, 10.4, 12.4, 1); cel(ctx, 0, 0, 5.2, 6.2, C, D, L, true);
      ctx.fillStyle = D; ctx.fillRect(-5.2, -6.2, 2.2, 12.4);
      line(ctx, -1, -3, 3, -3, L, 1); line(ctx, -1, -0.5, 3, -0.5, L, 1);
      box(ctx, 3.2, 1, 2.6, 2.2, 0.4, GOLD);
      break;
    case 'chest':
      box(ctx, -6.5, -1.5, 13, 8, 1.2, C);
      pathRrect(ctx, -6.5, -6.5, 13, 5.2, 2.2); cel(ctx, 0, -4, 6.5, 2.6);
      ctx.fillStyle = D; ctx.fillRect(-3.8, -6.2, 1.6, 12.4); ctx.fillRect(2.2, -6.2, 1.6, 12.4);
      box(ctx, -1.5, -2.6, 3, 3, 0.6, GOLD); dot(ctx, 0, -1.2, 0.5, OUT);
      break;
    case 'gold':
      for (let pass = 0; pass < 2; pass++) {
        pathEllipse(ctx, -3.2, 3.5, 3.4, 1.9); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathEllipse(ctx, 3.4, 3.8, 3.4, 1.9); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathEllipse(ctx, 0, 0.8, 3.6, 2); if (pass) flat(ctx, C); else outlineOnly(ctx);
      }
      pathEllipse(ctx, 0, 0.2, 2.3, 1.1); flat(ctx, L);
      line(ctx, -5, 3.5, -1, 3.5, D, 0.8); line(ctx, 2, 3.8, 6, 3.8, D, 0.8);
      pathStar(ctx, 4.8, -4, 3, 0.8, 4, 0); flat(ctx, WHITE);
      pathStar(ctx, -5, -2.5, 1.6, 0.5, 4, 0); flat(ctx, WHITE);
      break;
    case 'key':
      for (let pass = 0; pass < 2; pass++) {
        pathEllipse(ctx, -4.5, 0, 4, 4); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathRrect(ctx, -1.5, -1.3, 10, 2.6, 1); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathRrect(ctx, 4.6, 0.8, 1.9, 3.4, 0.5); if (pass) flat(ctx, C); else outlineOnly(ctx);
        pathRrect(ctx, 7.2, 0.8, 1.7, 3.4, 0.5); if (pass) flat(ctx, C); else outlineOnly(ctx);
      }
      ball(ctx, -4.5, 0, 1.6, OUT);
      dot(ctx, -6, -1.8, 0.9, L);
      line(ctx, -1, -0.5, 6, -0.5, L, 0.7);
      break;
    case 'flask':
      box(ctx, -1.4, -7.5, 2.8, 2.2, 0.5, WOOD);
      box(ctx, -1.6, -5.8, 3.2, 3.6, 0.6, GLASS);
      ball(ctx, 0, 2, 5, GLASS);
      pathEllipse(ctx, 0, 3, 3.8, 3.2); flat(ctx, C);
      dot(ctx, -2.2, 0, 0.9, WHITE);
      break;
    case 'spike':
      pathTaperedCapsule(ctx, -4, -4, 5, 5, 1.6, 0.25); fin(ctx, METAL);
      box(ctx, -6.2, -6.2, 3.6, 3.6, 0.8, METAL_DK);
      line(ctx, -3, -2.5, 2, 2, WHITE, 0.5);
      break;
    case 'junk':
      tri(ctx, -6, 5, -2, -4, 1.5, 4, C);
      tri(ctx, 0.5, 5.5, 4.5, -1.5, 6.5, 5.5, D);
      dot(ctx, -2.5, 1.5, 1, D);
      break;
    case 'digger':
      limb(ctx, -4.5, -5.5, 1, 0.5, 1, WOOD);
      box(ctx, -6.6, -7.6, 3.4, 3.2, 1, WOOD);
      ctx.beginPath(); ctx.moveTo(-0.5, 0); ctx.lineTo(5, -1.5); ctx.lineTo(6.5, 4); ctx.lineTo(2, 6.8); ctx.closePath(); fin(ctx, METAL);
      line(ctx, 1.5, 1, 4.5, 4, D, 0.8);
      break;
    default:
      box(ctx, -4.5, -4.5, 9, 9, 2, C);
      dot(ctx, -2, -2, 1, L);
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Debug gallery

/** Representative colours per family for the gallery. */
const GALLERY_COLOR: Record<SpriteKind, string> = {
  rig: '#5a8ce0', blob: '#7bd44a', bat: '#6a4c9c', bird: '#e0c040', snake: '#4caf50', spider: '#4a3c3c', insect: '#a05a2c', worm: '#e08080',
  mold: '#7aa040', jelly: '#40c0e0', eye: '#e0d0b0', ghost: '#c8d8f0', skeleton: '#e8e2d0', zombie: '#6a8a40', dog: '#a0783c', cat: '#8a8a90',
  rodent: '#8a7060', dragon: '#d03030', hydra: '#40a060', golem: '#8a8070', quadruped: '#a08050', demon: '#c03040', vortex: '#60b0ff', elemental: '#ff8030',
  tree: '#3a9040', mimic: '#a06a30', generator: '#d8d0c0', mushroom: '#e08050', centipede: '#c0a030', giant: '#b0a090', troll: '#5a9a40', ogre: '#c09060',
  orc: '#508040', kobold: '#a06040', humanoid: '#5a8ce0', yeek: '#6080c0', ant: '#c04020', louse: '#c0c0a0', nether: '#4a2c6c', angel: '#f0f0f8',
  harpy: '#c08040', naga: '#40a080', wight: '#40405a',
};
const GALLERY_COLOR2: Partial<Record<SpriteKind, string>> = {
  rig: '#f0c8a0', humanoid: '#f0c8a0', giant: '#e0b090', kobold: '#ffd040', eye: '#e03030', dragon: '#f0c040', demon: '#ffe040', bat: '#ff4040',
  generator: '#ff5040', mimic: '#ffd040', tree: '#7a5030', angel: '#f0c8a0', harpy: '#f0c8a0', naga: '#f0c8a0', wight: '#80ff80', nether: '#c040ff',
  golem: '#ff9030', mold: '#ffe060', vortex: '#ffffff', elemental: '#ffe060', zombie: '#8ac070', ogre: '#8a4020', mushroom: '#f0e0c0', bird: '#ff9030',
};
const ICON_COLOR: Record<string, string> = {
  potion: '#e040a0', scroll: '#e8e0c0', wand: '#60c0ff', staff: '#a0ff60', rod: '#ff80c0', ring: '#40e0c0', amulet: '#a060ff', food: '#d0a060',
  weapon: '#c03030', bow: '#e0c040', ammo: '#60c060', armor: '#8090b0', shield: '#c04040', helm: '#a0a8c0', cloak: '#408040', gloves: '#a07040',
  boots: '#6a4a30', light: '#ffa030', book: '#a03060', chest: '#a06a30', gold: '#f0c030', key: '#f0c030', flask: '#ffd040', spike: '#a0a0a0', junk: '#807870', digger: '#8a7a6a',
};

/**
 * Draw every family in a grid (`cols` per row, 30x34 px cells) at (x, y), then a row of item icons; returns nothing.
 * Labels are drawn in a tiny font so a screenshot can be checked by eye.
 */
export function drawSpriteGallery(ctx: CanvasRenderingContext2D, x: number, y: number, cols: number, phase = 0.25): void {
  const cw = 30, ch = 34;
  ctx.save();
  ctx.font = '5px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  let row = 0;
  for (let i = 0; i < SPRITE_KINDS.length; i++) {
    const kind = SPRITE_KINDS[i], col = i % cols; row = (i / cols) | 0;
    const cx = x + col * cw + cw / 2, fy = y + row * ch + ch - 8;
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + col * cw + 1, y + row * ch + 1, cw - 2, ch - 2);
    drawMonsterSprite(ctx, kind, cx, fy, { color: GALLERY_COLOR[kind], color2: GALLERY_COLOR2[kind], phase });
    ctx.fillStyle = '#b0b0c0'; ctx.fillText(kind, cx, fy + 1.5);
  }
  row++;
  for (let i = 0; i < ITEM_ICONS.length; i++) {
    const icon = ITEM_ICONS[i], col = i % cols, r = row + ((i / cols) | 0);
    const cx = x + col * cw + cw / 2, cy = y + r * ch + ch / 2 - 3;
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + col * cw + 1, y + r * ch + 1, cw - 2, ch - 2);
    drawItemIcon(ctx, icon, cx, cy, ICON_COLOR[icon] ?? '#ffffff');
    ctx.fillStyle = '#b0b0c0'; ctx.fillText(icon, cx, cy + 9.5);
  }
  ctx.restore();
}
