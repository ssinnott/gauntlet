// Cel-shading system for rigs: every colour gets a 3-tone ramp (highlight / base / shadow) plus a 1px rim tone,
// and parts are painted as flat bands (offset sub-shapes or clipped half-planes), never gradients. Light comes from
// the top-left in root space; `enter()` in rig.js keeps `rig.light` pointing at the light in the current part space.
// All helpers are allocation-free after the first use of a colour (tone ramps are cached per rig).
import { hexToRgb, rgbToHex } from './palettes.ts';
import { pathTaperedCapsule } from './shapes.ts';

/**
 * Unit vector toward the light in the CURRENT part space. `enter()` / `leave()` / the light-rotation helper in rig.js
 * rewrite `x` and `y` in place (one object per rig, never reallocated), which is why this is mutable.
 */
export interface LightDir {
  x: number;
  y: number;
}

/** The ramp factors a tone ramp is built from: the module's `RAMP`, or `{ ...RAMP, ...build.ramp }` on a rig. */
export interface Ramp {
  /** Highlight factor (> 1 = brighter than base). */
  hi: number;
  /** Shadow factor (< 1 = darker than base); `deep` is this times 0.78. */
  sh: number;
  /** Rim-light factor (> 1); the tone `rimRect` / `rimTop` draw with. */
  rim: number;
}

/** One colour's tone ramp: what `makeTones` returns and what `tones` caches per rig, per colour. */
export interface Tones {
  /** The colour exactly as passed in, unshaded. */
  base: string;
  /** Lit tone (`ramp.hi`). */
  hi: string;
  /** Shadow tone (`ramp.sh`). */
  sh: string;
  /** 1 px rim tone (`ramp.rim`). */
  rim: string;
  /** Deeper shadow (`ramp.sh * 0.78`). */
  deep: string;
}

/**
 * The part of a rig this module reads, as a structural contract: rig.ts declares its `Rig` so that a `Rig` is
 * assignable to a `ShadeTarget`, and anything else rig-shaped (a prop, a portrait, a test double) can be shaded
 * without owning a full rig. Only the fields shading.ts actually touches are listed -- `palette` / `paletteFar`,
 * `pxScale`, `joints`, `parts` and the rest of the rig never reach these functions, and requiring them here would
 * be a contract this module does not keep.
 */
export interface ShadeTarget {
  /** Per-rig tone cache, keyed by the colour string handed to `tones`. `buildRig` starts it as `new Map()`. */
  tones: Map<string, Tones>;
  /** Ramp factors for `makeTones` (`{ ...RAMP, ...build.ramp }` on a rig). */
  ramp: Readonly<Ramp>;
  /** Colour hook: returns the flash override while one is active, else the colour it was given. */
  col(hex: string): string;
  /** Flash colour replacing every fill while it is set; null (or absent) when not flashing. */
  override?: string | null;
  /** false on a `build.shading: false` rig: outline + flat fill only, no bands. */
  shading: boolean;
  /** Unit vector toward the light in the part space currently on the stack. */
  light: LightDir;
  /** Outline colour (near-black). */
  outline: string;
  /** Outline half-width: `outlinePath` strokes `ow * 2` so exactly `ow` px shows outside the fill. */
  ow: number;
  /** Contact-shadow alpha (0 = off; `build.contactShadow`). */
  contactAlpha: number;
  /** 2 on a `build.tones: 2` rig (base + shadow only), 3 otherwise. */
  tonesN: number;
  /** Per-rig `THIN_R` override; null / absent falls back to the module default. */
  thinR?: number | null;
  /** Per-rig `HI_MIN` override; null / absent falls back to the module default. */
  hiMin?: number | null;
  /** Per-rig `FLAT_R` override; null / absent falls back to the module default. */
  flatR?: number | null;
}

/** Unit vector toward the light in root space (top-left). */
export const LIGHT_X = -0.7071, LIGHT_Y = -0.7071;
/** Default ramp factors (build.shading may override { hi, sh, rim }). */
export const RAMP: Readonly<Ramp> = Object.freeze({ hi: 1.22, sh: 0.66, rim: 1.55 });
/**
 * Readability rule: parts narrower than this radius get TWO tones (base + shadow), no highlight.
 * A shadow band and a highlight band ARE dividing lines — a 5 px limb carrying both is three stripes of colour
 * across something 5 px wide, which reads as noise, not as form. The budget is one boundary on a narrow part,
 * so the thresholds are set where a part is genuinely big enough to hold a second one: at 6.5 a limb has to be
 * ~13 px across before it gets a highlight. Override per rig with build.thinR.
 * Shading budget knobs stored on the rig by buildRig: thinR, hiMin, flatR, tonesN (build.tones: 2 = no highlights at
 * all; light marks are then explicit 1 px rims via rimRect / rimTop on big shapes only).
 */
export const THIN_R = 6.5;
/** Below this radius a part is a single flat tone (plus outline). Override per rig with build.flatR. */
export const FLAT_R = 5;
/** Smallest half-extent (px) of a clipped shape (celPath / celRect / celPoly) that still gets a highlight cap; build.hiMin. */
export const HI_MIN = 10;
function thinR(rig: ShadeTarget): number { return rig.thinR != null ? rig.thinR : THIN_R; }
/**
 * Highlight gate: false on a `build.tones: 2` rig (base + shadow only, light marks come from explicit rims), and for
 * any shape whose half-extent is below rig.hiMin (clipped shapes) — capsules/balls compare against thinR instead.
 */
export function wantHi(rig: ShadeTarget, ext: number): boolean { return rig.tonesN !== 2 && ext >= (rig.hiMin != null ? rig.hiMin : HI_MIN); }
/** Shadow gate: below rig.flatR a limb-like part is one flat tone plus its outline. */
export function wantSh(rig: ShadeTarget, r: number): boolean { return r >= (rig.flatR != null ? rig.flatR : FLAT_R); }
function wantHiR(rig: ShadeTarget, r: number): boolean { return rig.tonesN !== 2 && r >= thinR(rig); }

const R = Math.round;
function c255(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : v; }
/** Shade a colour: shadows go cooler / bluer, highlights warmer (pixel-art hue shift). */
export function toneOf(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (f < 1) return rgbToHex(c255(r * f), c255(g * (f + 0.03)), c255(b * (f + 0.12) + 8));
  return rgbToHex(c255(r * f + 14), c255(g * f + 6), c255(b * (f - 0.08)));
}
/** Build a tone ramp object for a base colour. */
export function makeTones(hex: string, ramp: Readonly<Ramp> = RAMP): Tones {
  return { base: hex, hi: toneOf(hex, ramp.hi), sh: toneOf(hex, ramp.sh), rim: toneOf(hex, ramp.rim), deep: toneOf(hex, ramp.sh * 0.78) };
}
/**
 * Cached tone ramp for `hex` on this rig. First use of a colour allocates its ramp; later uses do not.
 * Non-hex colours (rgba strings) get a flat ramp.
 */
export function tones(rig: ShadeTarget, hex: string): Tones {
  let t = rig.tones.get(hex);
  if (!t) {
    t = hex && hex[0] === '#' ? makeTones(hex, rig.ramp) : { base: hex, hi: hex, sh: hex, rim: hex, deep: hex };
    rig.tones.set(hex, t);
  }
  return t;
}

/** Outline-stroke the current path (2*ow wide so exactly `ow` px shows outside the fill). */
export function outlinePath(ctx: CanvasRenderingContext2D, rig: ShadeTarget): void {
  ctx.strokeStyle = rig.col(rig.outline); ctx.lineWidth = rig.ow * 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
}

/**
 * Paint the current path as a cel-shaded part: outline, base fill, then (clipped to the path) a shadow half-plane on
 * the side away from the light and a highlight cap toward it.
 * @param cx,cy part centre; ext radius covering the part; sh shadow coverage (0..1 of the diameter, from the far edge);
 *        hi highlight coverage (0..1 of the radius from the lit edge, 0 = none).
 * While the rig flashes (`rig.override`) only outline + flat fill are drawn.
 */
export function celPath(ctx: CanvasRenderingContext2D, rig: ShadeTarget, hex: string, cx: number, cy: number, ext: number, sh = 0.36, hi = 0.35): void {
  outlinePath(ctx, rig);
  const t = tones(rig, hex);
  ctx.fillStyle = rig.col(t.base); ctx.fill();
  if (rig.override || !rig.shading || !wantSh(rig, ext)) return;
  ctx.save(); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(Math.atan2(rig.light.y, rig.light.x)); // +x points at the light
  const E = ext + 3;
  ctx.fillStyle = t.sh; ctx.fillRect(-E, -E, E - ext + ext * 2 * sh, E * 2);
  if (hi > 0 && wantHi(rig, ext)) { ctx.fillStyle = t.hi; ctx.fillRect(ext - ext * hi, -E, E, E * 2); }
  ctx.restore();
}

/** Capsule between two points: outline, base, shadow capsule offset away from the light, highlight sliver toward it. */
export function celCapsule(ctx: CanvasRenderingContext2D, rig: ShadeTarget, x0: number, y0: number, x1: number, y1: number, r: number, hex: string, hiFrac = 0.3): void {
  pathCap(ctx, x0, y0, x1, y1, r);
  outlinePath(ctx, rig);
  const t = tones(rig, hex);
  ctx.fillStyle = rig.col(t.base); ctx.fill();
  if (rig.override || !rig.shading || !wantSh(rig, r)) return;
  const lx = rig.light.x, ly = rig.light.y;
  const rs = r * 0.6, off = r - rs; // thinner capsule shifted away from the light stays inside the silhouette
  pathCap(ctx, x0 - lx * off, y0 - ly * off, x1 - lx * off, y1 - ly * off, rs);
  ctx.fillStyle = t.sh; ctx.fill();
  if (hiFrac > 0 && wantHiR(rig, r)) {
    const rh = Math.max(0.7, r * hiFrac * 0.5), offh = r - rh - 0.6;
    pathCap(ctx, x0 + lx * offh, y0 + ly * offh, x1 + lx * offh, y1 + ly * offh, rh);
    ctx.fillStyle = t.hi; ctx.fill();
  }
}

/** Tapered capsule (r0 at the start, r1 at the end): same bands as celCapsule; the anatomy helper for limbs. */
export function celTaper(ctx: CanvasRenderingContext2D, rig: ShadeTarget, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, hex: string, hiFrac = 0.3): void {
  pathTaperedCapsule(ctx, x0, y0, x1, y1, r0, r1);
  outlinePath(ctx, rig);
  const t = tones(rig, hex);
  ctx.fillStyle = rig.col(t.base); ctx.fill();
  const rm = Math.max(r0, r1);
  if (rig.override || !rig.shading || !wantSh(rig, rm)) return;
  const lx = rig.light.x, ly = rig.light.y, k = 0.6;
  const o0 = r0 - r0 * k, o1 = r1 - r1 * k;
  pathTaperedCapsule(ctx, x0 - lx * o0, y0 - ly * o0, x1 - lx * o1, y1 - ly * o1, r0 * k, r1 * k);
  ctx.fillStyle = t.sh; ctx.fill();
  if (hiFrac > 0 && wantHiR(rig, rm)) {
    const rh0 = Math.max(0.7, r0 * hiFrac * 0.5), rh1 = Math.max(0.7, r1 * hiFrac * 0.5);
    const h0 = r0 - rh0 - 0.6, h1 = r1 - rh1 - 0.6;
    pathTaperedCapsule(ctx, x0 + lx * h0, y0 + ly * h0, x1 + lx * h1, y1 + ly * h1, rh0, rh1);
    ctx.fillStyle = t.hi; ctx.fill();
  }
}

/** Ball: outline, base, crescent shadow away from the light, 2px highlight dot toward it. */
export function celBall(ctx: CanvasRenderingContext2D, rig: ShadeTarget, cx: number, cy: number, r: number, hex: string, hi = true): void {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  outlinePath(ctx, rig);
  const t = tones(rig, hex);
  ctx.fillStyle = rig.col(t.base); ctx.fill();
  if (rig.override || !rig.shading || !wantSh(rig, r)) return;
  const lx = rig.light.x, ly = rig.light.y;
  const rs = r * 0.72, off = r - rs;
  ctx.beginPath(); ctx.arc(cx - lx * off, cy - ly * off, rs, 0, Math.PI * 2);
  ctx.fillStyle = t.sh; ctx.fill();
  if (hi && wantHiR(rig, r)) { ctx.fillStyle = t.hi; ctx.fillRect(Math.round(cx + lx * r * 0.5) - 1, Math.round(cy + ly * r * 0.5) - 1, 2, 2); }
}

/** Rounded rect: outline, base, shadow band on the far side, highlight toward the light (clipped). */
export function celRect(ctx: CanvasRenderingContext2D, rig: ShadeTarget, x: number, y: number, w: number, h: number, rr: number, hex: string, sh = 0.36, hi = 0.3): void {
  pathRR(ctx, x, y, w, h, rr);
  celPath(ctx, rig, hex, x + w / 2, y + h / 2, Math.hypot(w, h) / 2, sh, hi);
}

/** Polygon (flat [x0,y0,...] array): outline + cel bands. Centre / extent are computed from the points. */
export function celPoly(ctx: CanvasRenderingContext2D, rig: ShadeTarget, pts: readonly number[], hex: string, sh = 0.36, hi = 0.3): void {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (i) ctx.lineTo(x, y);
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  ctx.closePath();
  celPath(ctx, rig, hex, (minx + maxx) / 2, (miny + maxy) / 2, Math.hypot(maxx - minx, maxy - miny) / 2, sh, hi);
}

/** 1px rim light along the lit edges of an axis-aligned rect (call after the fill). */
export function rimRect(ctx: CanvasRenderingContext2D, rig: ShadeTarget, x: number, y: number, w: number, h: number, hex: string): void {
  if (rig.override || !rig.shading) return;
  ctx.fillStyle = tones(rig, hex).rim;
  const lx = rig.light.x, ly = rig.light.y;
  if (ly < -0.3) ctx.fillRect(x + 1, y, w - 2, 1);
  if (lx < -0.3) ctx.fillRect(x, y + 1, 1, h - 2);
  if (lx > 0.3) ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
}

/**
 * Single 1 px rim light along the top (lit) edge of a BIG shape, as a straight run (x0,y0)->(x1,y1) in part space,
 * inset 1 px from the outline (shoulder line, boot top, weapon-head edge). The only highlight a `tones: 2` rig draws.
 */
export function rimTop(ctx: CanvasRenderingContext2D, rig: ShadeTarget, x0: number, y0: number, x1: number, y1: number, hex: string): void {
  if (rig.override || !rig.shading) return;
  ctx.strokeStyle = tones(rig, hex).rim; ctx.lineWidth = 1; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(x0, y0 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();
}

/** Flat 1px-outlined fill without shading (details: buckles, straps, rivets). */
export function flat(ctx: CanvasRenderingContext2D, rig: ShadeTarget, hex: string, outline = true): void {
  if (outline) outlinePath(ctx, rig);
  ctx.fillStyle = rig.col(hex); ctx.fill();
}

/**
 * An INKED detail band: a rounded rect at integer coordinates with a 1 px outline stroked under it (ART_STYLE 0.2 -
 * a fill that introduces a new internal boundary must carry the line; never fake one with a tone seam). This is the
 * outlined replacement for a bare `ctx.fillRect` on a strap, a rank band, a plate or a stripe: one stroke, one fill,
 * ZERO clips and ~3 path commands, so it costs far less than routing the same mark through celRect.
 * Use it for MATERIAL changes only (band 0.4d); form inside one material still takes a tone step and no line, and a
 * band under 4 px wide is widened or demoted to a tone seam rather than inked down to 1 px of colour (0.7).
 */
export function band(ctx: CanvasRenderingContext2D, rig: ShadeTarget, x: number, y: number, w: number, h: number, hex: string, rr = 1): void {
  pathRR(ctx, R(x), R(y), R(w), R(h), rr);
  flat(ctx, rig, hex);
}

/**
 * Contact shadow: a translucent dark capsule offset ~1 px away from the light, drawn UNDER a near limb so the limb
 * separates from whatever it crosses (torso, apron, far limb). Alpha from rig.contactAlpha (build.contactShadow).
 */
export function contactCapsule(ctx: CanvasRenderingContext2D, rig: ShadeTarget, x0: number, y0: number, x1: number, y1: number, r: number): void {
  if (rig.override || !rig.contactAlpha) return;
  const ox = -rig.light.x * 1.2, oy = -rig.light.y * 1.2;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * rig.contactAlpha;
  pathCap(ctx, x0 + ox, y0 + oy, x1 + ox, y1 + oy, r + rig.ow);
  ctx.fillStyle = rig.outline; ctx.fill();
  ctx.globalAlpha = a;
}

// tiny path helpers kept local so shading.js has no dependency on shapes.js
export function pathCap(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  const a = len > 0.0001 ? Math.atan2(dy, dx) : 0;
  ctx.beginPath();
  ctx.arc(x0, y0, r, a + Math.PI / 2, a - Math.PI / 2);
  ctx.arc(x1, y1, r, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
}
export function pathRR(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr); ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h); ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}
