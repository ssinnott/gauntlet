// Primitive drawing helpers shared by rigs, props and backdrops. All draw at the current transform.
// Convention: (ctx, geometry..., fill, stroke, lineWidth). Pass a falsy fill/stroke to skip it.

/** Anything the canvas accepts as a `fillStyle` / `strokeStyle`. */
export type PaintStyle = string | CanvasGradient | CanvasPattern;
/** A fill or stroke that may be omitted: any falsy value skips that pass (see the note above). */
export type MaybePaintStyle = PaintStyle | null | undefined | false;
/** Polygon points, in either accepted form: flat `[x0,y0,x1,y1,...]` or paired `[[x,y],...]`. */
export type PolyPoints = readonly number[] | readonly (readonly number[])[];
/** A path-tracing callback, as taken by `outlined`. */
export type PathFn = (ctx: CanvasRenderingContext2D) => void;

/** Trace a rounded rectangle path (no fill/stroke). */
export function pathRrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 3): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr); ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h); ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}
/** Trace an ellipse path. */
export function pathEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
}
/** Trace a capsule (thick line with round caps) from (x0,y0) to (x1,y1) with radius r. */
export function pathCapsule(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  const a = len > 0.0001 ? Math.atan2(dy, dx) : 0;
  ctx.beginPath();
  ctx.arc(x0, y0, r, a + Math.PI / 2, a - Math.PI / 2);
  ctx.arc(x1, y1, r, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
}
/** Trace a polygon path from a flat [x0,y0,x1,y1,...] or [[x,y],...] array. */
export function pathPoly(ctx: CanvasRenderingContext2D, pts: PolyPoints, close = true): void {
  ctx.beginPath();
  if (pts.length && Array.isArray(pts[0])) {
    // Same array, read through the arm of PolyPoints the branch has just established: `pts[i]`
    // with a computed index is not narrowed by the check above. Type-level only.
    const paired = pts as readonly (readonly number[])[];
    ctx.moveTo(paired[0][0], paired[0][1]);
    for (let i = 1; i < paired.length; i++) ctx.lineTo(paired[i][0], paired[i][1]);
  } else {
    const flat = pts as readonly number[];
    ctx.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
  }
  if (close) ctx.closePath();
}
/** Trace a gear outline. */
export function pathGear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, teeth = 8, rot = 0, toothDepth = r * 0.28): void {
  ctx.beginPath();
  const n = Math.max(3, teeth | 0), inner = r - toothDepth;
  for (let i = 0; i < n; i++) {
    const a0 = rot + (i / n) * Math.PI * 2, a1 = a0 + Math.PI * 2 / n;
    const t1 = a0 + (a1 - a0) * 0.2, t2 = a0 + (a1 - a0) * 0.3, t3 = a0 + (a1 - a0) * 0.7, t4 = a0 + (a1 - a0) * 0.8;
    if (i === 0) ctx.moveTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner);
    ctx.lineTo(cx + Math.cos(t1) * inner, cy + Math.sin(t1) * inner);
    ctx.lineTo(cx + Math.cos(t2) * r, cy + Math.sin(t2) * r);
    ctx.lineTo(cx + Math.cos(t3) * r, cy + Math.sin(t3) * r);
    ctx.lineTo(cx + Math.cos(t4) * inner, cy + Math.sin(t4) * inner);
    ctx.lineTo(cx + Math.cos(a1) * inner, cy + Math.sin(a1) * inner);
  }
  ctx.closePath();
}

/** Fill and/or stroke the current path. Stroke is drawn first so the fill sits on top (outline look). */
export function paint(ctx: CanvasRenderingContext2D, fill?: MaybePaintStyle, stroke?: MaybePaintStyle, lineWidth = 2): void {
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth * 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}

/** Rounded rectangle. */
export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill?: MaybePaintStyle, stroke?: MaybePaintStyle, lineWidth = 1): void { pathRrect(ctx, x, y, w, h, r); paint(ctx, fill, stroke, lineWidth); }
/** Ellipse. */
export function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, fill?: MaybePaintStyle, stroke?: MaybePaintStyle, lineWidth = 1): void { pathEllipse(ctx, cx, cy, rx, ry); paint(ctx, fill, stroke, lineWidth); }
/** Circle. */
export function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill?: MaybePaintStyle, stroke?: MaybePaintStyle, lineWidth = 1): void { pathEllipse(ctx, cx, cy, r, r); paint(ctx, fill, stroke, lineWidth); }
/** Capsule. */
export function capsule(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number, fill?: MaybePaintStyle, stroke?: MaybePaintStyle, lineWidth = 1): void { pathCapsule(ctx, x0, y0, x1, y1, r); paint(ctx, fill, stroke, lineWidth); }
/** Polygon. */
export function poly(ctx: CanvasRenderingContext2D, pts: PolyPoints, fill?: MaybePaintStyle, stroke?: MaybePaintStyle, lineWidth = 1, close = true): void { pathPoly(ctx, pts, close); paint(ctx, fill, stroke, lineWidth); }
/** Plain line. */
export function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: PaintStyle, lineWidth = 1): void {
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}
/**
 * Gear with optional hub hole.
 * @param rot rotation in radians
 * @param holeR radius of the centre hole (drawn with `holeColor` or skipped)
 */
export function gear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, teeth: number, fill?: MaybePaintStyle, stroke?: MaybePaintStyle, lineWidth = 1, rot = 0, holeR = 0, holeColor: MaybePaintStyle = null): void {
  pathGear(ctx, cx, cy, r, teeth, rot);
  paint(ctx, fill, stroke, lineWidth);
  if (holeR > 0) {
    pathEllipse(ctx, cx, cy, holeR, holeR);
    paint(ctx, holeColor || 'rgba(0,0,0,0.35)', stroke, lineWidth);
    if (stroke) { ctx.lineWidth = lineWidth; ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI * 2); ctx.stroke(); }
  }
}
/** A row of `count` rivets (small shaded circles) between two points. */
export function rivetLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, count: number, r = 1.5, color: PaintStyle = '#c8a050', dark: PaintStyle = 'rgba(0,0,0,0.4)'): void {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}
/** A pipe (capsule with dark rim + highlight) and optional flanges at both ends. */
export function pipe(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, color: PaintStyle, dark: PaintStyle = 'rgba(0,0,0,0.45)', light: PaintStyle = 'rgba(255,255,255,0.25)', flanges = true): void {
  const r = w / 2;
  capsule(ctx, x0, y0, x1, y1, r, color, dark, 1);
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  line(ctx, x0 + nx * r * 0.45, y0 + ny * r * 0.45, x1 + nx * r * 0.45, y1 + ny * r * 0.45, light, Math.max(1, r * 0.35));
  if (flanges) {
    const fw = r * 1.35;
    for (const [px, py] of [[x0 + dx / len * r, y0 + dy / len * r], [x1 - dx / len * r, y1 - dy / len * r]]) {
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(dy, dx));
      rrect(ctx, -2, -fw, 4, fw * 2, 1, color, dark, 1);
      ctx.restore();
    }
  }
}
/**
 * Outlined fill helper: `pathFn(ctx)` traces a path; it is stroked with `outline` (width*2, so `width` px shows outside)
 * and then filled. Use for any custom part that needs the rig-style outline.
 */
export function outlined(ctx: CanvasRenderingContext2D, pathFn: PathFn, fill?: MaybePaintStyle, outline?: MaybePaintStyle, width = 2): void {
  pathFn(ctx);
  paint(ctx, fill, outline, width);
}
/** Star / burst polygon (spikes alternating outer/inner radius). */
export function pathStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, rOuter: number, rInner: number, points = 5, rot = 0): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner, a = rot + (i / (points * 2)) * Math.PI * 2;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

/**
 * Trace a tapered capsule (a limb segment): circle radius r0 at (x0,y0), r1 at (x1,y1), joined by the external tangents.
 * Degenerates to a plain capsule when r0 == r1 and to a circle when one end swallows the other.
 */
export function pathTaperedCapsule(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, append = false): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (!append) ctx.beginPath();
  if (len < 0.0001 || Math.abs(r0 - r1) >= len) {
    const big = r0 >= r1, cx = big ? x0 : x1, cy = big ? y0 : y1, r = Math.max(r0, r1);
    ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    return;
  }
  const a = Math.atan2(dy, dx), t = Math.asin((r0 - r1) / len);
  const s0 = a + Math.PI / 2 + t;
  ctx.moveTo(x0 + Math.cos(s0) * r0, y0 + Math.sin(s0) * r0);
  ctx.arc(x0, y0, r0, s0, a - Math.PI / 2 - t);
  ctx.arc(x1, y1, r1, a - Math.PI / 2 - t, a + Math.PI / 2 + t);
  ctx.closePath();
}
/** Trace a polygon with every corner rounded by radius r (flat [x0,y0,x1,y1,...] list). */
export function pathRoundedPoly(ctx: CanvasRenderingContext2D, pts: readonly number[], r = 2): void {
  const n = pts.length >> 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const pi = ((i + n - 1) % n) * 2, ni = ((i + 1) % n) * 2;
    const px = pts[pi], py = pts[pi + 1], cx = pts[i * 2], cy = pts[i * 2 + 1], nx = pts[ni], ny = pts[ni + 1];
    const d0 = Math.hypot(cx - px, cy - py) || 1, d1 = Math.hypot(nx - cx, ny - cy) || 1;
    const rr = Math.min(r, d0 / 2, d1 / 2);
    const sx = cx + (px - cx) / d0 * rr, sy = cy + (py - cy) / d0 * rr;
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    ctx.arcTo(cx, cy, nx, ny, rr);
  }
  ctx.closePath();
}
/** Trace an annular arc band (a weapon "smear" / sweep) around (cx,cy) from angle a0 to a1 (radians), radii rIn..rOut. */
export function pathArcBand(ctx: CanvasRenderingContext2D, cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number): void {
  const ccw = a1 < a0;
  ctx.beginPath();
  ctx.arc(cx, cy, rOut, a0, a1, ccw);
  ctx.arc(cx, cy, rIn, a1, a0, !ccw);
  ctx.closePath();
}
