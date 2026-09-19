// Default part renderers for rig.js, drawn as chunky cel-shaded pixel-sprite shapes (1px outline, 3-tone bands,
// top-left light). Every function draws in the part's local space set up by rig.js and allocates nothing.
// Content may import these to compose custom parts (e.g. draw the default boot and add a strap).
import { celCapsule, celBall, celRect, celPoly, celPath, tones, pathRR, rimRect, rimTop, outlinePath, wantSh } from './shading.ts';
import { pathTaperedCapsule } from './shapes.ts';
import { FACE } from './poses.ts';
import type { Palette } from './palettes.ts';
import type { Pose } from './poses.ts';
import type { ShadeTarget } from './shading.ts';

/** A joint position in the space the part is drawn in: what rig.ts's `joints` hold and hand to these renderers. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The part of a rig these renderers read, as a structural contract, exactly as `ShadeTarget` is for shading.ts:
 * everything shading needs, plus the two fields the default parts read off the rig itself. rig.ts declares its
 * `Rig` so that a `Rig` is assignable to a `PartRig`, and a prop or a portrait that is only rig-SHAPED can be
 * drawn with these without owning a full rig. `p` (proportions), `joints`, `parts` and the rest never reach these
 * functions: a part is handed its geometry as arguments, or on the `Info` object.
 */
export interface PartRig extends ShadeTarget {
  /** The rig's own (near) palette. A far limb's colours arrive as arguments or on `Info.pal`, already darkened. */
  palette: Palette;
  /** Default hair style ('short' | 'bald'; `build.hairStyle`). Only 'bald' is special-cased — anything else draws the cap. */
  hairStyle: string;
}

/**
 * The reusable info object a part hook is handed as its fourth argument. rig.ts owns ONE of these per rig and
 * refills it before every hook call, so a hook may read it but must never retain it past its own call.
 * `pal` is null on the object rig.ts allocates and is filled before the first hook ever sees it.
 */
export interface Info {
  /** Which hook is being drawn: 'legUpper', 'legLower', 'foot', 'hand', 'armUpper', 'torso', 'head', 'face', ... */
  name: string;
  /** True for the FAR limb of a pair — `pal` is then the far palette, so a hook colouring from it never darkens twice. */
  far: boolean;
  /** The palette this part colours from: the rig's own, or its far palette on a far limb. */
  pal: Palette;
  /** Segment length in px along the bone (a limb segment is drawn from (0, 0) to (0, len)); 0 where a part has no length. */
  len: number;
  /** Radius in px (limb radius, hand radius, head radius); 0 where a part has no radius. */
  r: number;
  /** The default colour for this part, taken from `pal`. */
  color: string;
  /** Box width in px, for the parts that have a box (foot, torso, hips); undefined for the parts that do not. */
  w: number | undefined;
  /** Box height in px, for the parts that have a box (foot, torso, hips); undefined for the parts that do not. */
  h: number | undefined;
  /** Alias of `len`, kept for call-site compatibility. */
  length: number;
}

/**
 * The signature every part renderer shares. A rig's `build.parts` table keys these by part name and rig.ts calls
 * them in that part's own local space (see the LIMB SPACE note at the top of rig.js: +y runs ALONG the bone).
 * Foodie Truck's critter rig overrides the defaults below by name through this type, so it is a public contract.
 * The rig is a type parameter so a game whose hooks read more of their own rig than a `PartRig` (a `faceOpts`, a
 * build spec) can name that rig — `PartHook<CritterRig>` — instead of widening anything to `any`.
 */
export type PartHook<R extends PartRig = PartRig> = (ctx: CanvasRenderingContext2D, rig: R, pose: Pose, info: Info) => void;

/** Options for `drawFist`. */
export interface FistOpts {
  /** Cuff colour: a 2 px band down the wrist edge of the mitten. */
  glove?: string;
}

/** Options for `drawSkull`. A rig's whole `build` is passed straight in at some call sites, so every field is optional. */
export interface SkullOpts {
  /** Jaw width as a fraction of the head radius (default 0.35). */
  jaw?: number;
  /** Hair style for this skull, overriding `rig.hairStyle`. */
  hairStyle?: string;
  /** Draw no hair cap. */
  noHair?: boolean;
  /** Draw no nose bump, for rigs that draw their own (Brunhild's wedge sits below the eye row). */
  noNose?: boolean;
}

/** Options for `drawFace` and `drawMouth` (`rig.faceOpts`, from `build.face`). */
export interface FaceOpts {
  /** Force the big whites (5x4 / 4x4) on or off; by default a head radius >= 9.5 gets them. */
  big?: boolean;
  /** Move the eye line by this many px. */
  eyeY?: number;
  /** Pupil colour (default '#1a1418'). */
  pupil?: string;
  /** Brow colour (default the palette's hair, else the outline). */
  brow?: string;
  /** Draw no mouth, for bearded rigs. */
  noMouth?: boolean;
  /** Move the mouth by this many px. */
  mouthY?: number;
}

/** One node of the limb tube: [x, y, radius], as `limbRadii` profiles it. Internal to `drawLimbSegs`. */
type LimbNode = [number, number, number];

const R = Math.round;

/**
 * The one radius profile a limb has: [root, joint, tip]. Widest at the shoulder or hip, ONE shared radius at the
 * elbow or knee, narrowest at the wrist or ankle. Exported because a rig may hook one half of a limb and leave the
 * other to the default renderer — rig.js builds the generic half from these same numbers so the two halves meet
 * without a step, which is the defect (a forearm ~15 % fatter than the end of the bicep) that inked a collar into
 * every elbow before any outline was drawn.
 */
export function limbRadii(r1: number, r2: number, bulge = 0): [number, number, number] {
  const base = (r1 + r2) / 2;
  return [base * (1 + 0.16 * bulge), base * (1 - 0.10 * bulge), base * (1 - 0.20 * bulge)];
}

/**
 * A whole limb as ONE shape (root space): shoulder -> elbow -> wrist, or hip -> knee -> ankle.
 *
 * It used to be five or six separately outlined objects — a ball cap at the shoulder, two tapered capsules, a cuff
 * ring, and a shadow band restarting inside each segment — which is why an arm read as a stack of parts rather than
 * as an arm. Worse, the radii did not meet: the upper segment ended at r1*0.94 while the lower one STARTED at
 * r2*1.04 (r2 = r1 + 0.5), so the forearm was visibly fatter than the end of the bicep and the mismatch inked
 * itself into a collar at the elbow before any outline was drawn.
 *
 * Now the subpaths are appended into one path, stroked ONCE and filled ONCE: the stroke does cross the internal
 * seams, and the fill immediately covers them. What survives is the outer contour. A second material below the
 * elbow, and the shadow, are then painted CLIPPED INSIDE that silhouette, so they are colour changes within one
 * outlined shape rather than new outlined objects — see ART_STYLE §0.2.
 *
 * `bulge` (0..1, proportions.bulge) drives one radius profile down the whole limb: widest at the root, narrowest at
 * the wrist/ankle, with a single shared radius at the joint so there is no step.
 * `capAtA` is kept for call-site compatibility and is now unused — the shoulder/hip disc it drew was one of the
 * objects this function exists to stop drawing.
 */
export function drawLimbSegs(ctx: CanvasRenderingContext2D, rig: PartRig, a: Point, b: Point, c: Point, r1: number, r2: number, fill1: string, fill2: string, capAtA = true, bulge = 0): void {
  const [rA, rB, rC] = limbRadii(r1, r2, bulge);
  const nodes: LimbNode[] = [[a.x, a.y, rA], [b.x, b.y, rB], [c.x, c.y, rC]];
  const tube = () => {
    ctx.beginPath();
    for (let i = 0; i < nodes.length - 1; i++) {
      const p = nodes[i], q = nodes[i + 1];
      pathTaperedCapsule(ctx, p[0], p[1], q[0], q[1], p[2], q[2], true);
    }
  };
  tube();
  outlinePath(ctx, rig);                  // strokes the internal seam too...
  ctx.fillStyle = rig.col(tones(rig, fill1).base);
  ctx.fill();                             // ...and this covers it
  if (rig.override || !rig.shading) return;

  ctx.save();
  tube(); ctx.clip();                     // everything below stays inside the limb silhouette
  const mid = Math.floor(nodes.length / 2);
  const two = fill2 !== fill1;
  if (two) {                              // skin below the elbow: a colour change with no line of its own
    ctx.beginPath();
    for (let i = mid; i < nodes.length - 1; i++) {
      const p = nodes[i], q = nodes[i + 1];
      pathTaperedCapsule(ctx, p[0], p[1], q[0], q[1], p[2], q[2], true);
    }
    ctx.fillStyle = tones(rig, fill2).base; ctx.fill();
  }
  if (wantSh(rig, rA)) {                  // ONE shadow down the limb, not one per segment restarting at the joint
    const lx = rig.light.x, ly = rig.light.y, k = 0.6;
    const band = (list: LimbNode[], tone: string) => {
      ctx.beginPath();
      for (let i = 0; i < list.length - 1; i++) {
        const p = list[i], q = list[i + 1];
        pathTaperedCapsule(ctx, p[0] - lx * (p[2] - p[2] * k), p[1] - ly * (p[2] - p[2] * k),
          q[0] - lx * (q[2] - q[2] * k), q[1] - ly * (q[2] - q[2] * k), p[2] * k, q[2] * k, true);
      }
      ctx.fillStyle = tone; ctx.fill();
    };
    if (!two) band(nodes, tones(rig, fill1).sh);
    else { band(nodes.slice(0, mid + 1), tones(rig, fill1).sh); band(nodes.slice(mid), tones(rig, fill2).sh); }
  }
  ctx.restore();
}

/** Mitten fist with a thumb (hand space: +x along the forearm, origin at the wrist). */
export function drawFist(ctx: CanvasRenderingContext2D, rig: PartRig, r: number, skin: string, opts: FistOpts | null = null): void {
  const w = R(r * 2.2), h = R(r * 2), x0 = R(-r * 0.6), y0 = R(-r);
  celRect(ctx, rig, x0, y0, w, h, R(r * 0.8), skin, 0.4, 0.25);
  // thumb: small ball on the lit side (the 1px knuckle notches were dropped in the readability pass)
  celBall(ctx, rig, x0 + R(r * 0.9), y0, R(r * 0.55), skin, false);
  if (opts && opts.glove) { ctx.fillStyle = rig.col(opts.glove); ctx.fillRect(x0 - 1, y0, 2, h); }
}

/** Boot with a sole, heel, toe cap and strap (ankle space: origin at the ankle, y down, toe toward +x). */
export function drawBoot(ctx: CanvasRenderingContext2D, rig: PartRig, footL: number, footH: number, hex: string, accent: string | null = null): void {
  const heel = R(footL * 0.42), toe = R(footL * 0.62), top = -R(footH * 1.0), sole = R(footH * 0.5);
  // upper: heel block + toe wedge as one silhouette
  celPoly(ctx, rig, [-heel, top, heel * 0.6, top, toe - 2, sole - 3, toe, sole - 1, toe, sole, -heel, sole], hex, 0.34, 0.3);
  if (rig.override) return;
  const t = tones(rig, hex);
  // sole (2px, darkest) + 1px heel step
  ctx.fillStyle = t.deep; ctx.fillRect(-heel, sole - 1, toe + heel, 2); ctx.fillRect(-heel, sole - 3, 3, 2);
  // one buckle on the instep (readability pass: the 2px strap and 1px rim were noise at 1x — anything < 2px goes)
  if (footH >= 5) { ctx.fillStyle = rig.col(accent || rig.palette.accent); ctx.fillRect(R(heel * 0.6) - 3, top + 1, 3, 3); }
}

/** Shaped torso silhouette (torso space: origin at the hip centre, y up negative). Shoulders wide, waist narrow. */
export function drawTorsoShape(ctx: CanvasRenderingContext2D, rig: PartRig, W: number, H: number, hip: number, hex: string): void {
  const hw = R(W / 2), hh = R(hip / 2 * 0.92);
  celPoly(ctx, rig, [-hw - 1, -H + 4, -hw + 4, -H, hw - 4, -H, hw + 1, -H + 4, hw, R(-H * 0.5), hh, 2, -hh, 2, -hw, R(-H * 0.5)], hex, 0.36, 0.28);
  if (rig.override) return;
  const t = tones(rig, hex);
  // collar notch + chest seam + two buttons
  ctx.fillStyle = t.deep; ctx.fillRect(-3, -H, 6, 3); ctx.fillRect(0, -H + 5, 1, H - 8);
  ctx.fillStyle = rig.col(rig.palette.accent); ctx.fillRect(2, -H + 8, 2, 2); ctx.fillRect(2, -H + 14, 2, 2);
}

/** Belt with buckle and rivets over a short trouser block (hip space: origin at hip centre). */
export function drawBelt(ctx: CanvasRenderingContext2D, rig: PartRig, hip: number, hex: string, beltHex: string, buckleHex: string): void {
  const hw = R(hip / 2);
  celRect(ctx, rig, -hw, -5, hip, 11, 3, hex, 0.4, 0.2);
  if (rig.override) { ctx.fillStyle = rig.col(beltHex); ctx.fillRect(-hw + 1, -5, hip - 2, 3); return; }
  const t = tones(rig, beltHex);
  ctx.fillStyle = t.base; ctx.fillRect(-hw + 1, -5, hip - 2, 4);
  ctx.fillStyle = t.sh; ctx.fillRect(-hw + 1, -2, hip - 2, 1);
  ctx.fillStyle = rig.col(buckleHex); ctx.fillRect(1, -6, 5, 5);
  ctx.fillStyle = t.sh; ctx.fillRect(2, -5, 3, 3);
  ctx.fillStyle = tones(rig, buckleHex).hi; ctx.fillRect(-hw + 3, -4, 1, 1); ctx.fillRect(hw - 4, -4, 1, 1);
}

/** Neck (root space, between the neck joint and the head centre). */
export function drawNeck(ctx: CanvasRenderingContext2D, rig: PartRig, n: Point, h: Point, skin: string, r = 3.5): void {
  celCapsule(ctx, rig, n.x, n.y, n.x + (h.x - n.x) * 0.5, n.y + (h.y - n.y) * 0.5, r, skin, 0);
}

// ---- head path pieces, appended into one path by drawSkull (head space, rig faces +x) ----------------------
function pathSkull(ctx: CanvasRenderingContext2D, r: number, jaw: number): void {
  ctx.ellipse(0, -r * 0.05, r, r * 0.98, 0, Math.PI * 1.02, Math.PI * 2.02);
  ctx.lineTo(r * 0.98, r * jaw); ctx.lineTo(r * 0.6, r * 0.95); ctx.lineTo(-r * 0.55, r * 0.95); ctx.lineTo(-r * 0.98, r * jaw);
  ctx.closePath();
}
/**
 * Ear. Pushed out to -0.88r so it actually breaks the skull's contour: at the old -0.55r the circle sits ENTIRELY
 * inside the skull outline at every head size, so in a union path it would contribute nothing to the silhouette
 * and simply vanish. As a bump it costs no outlined object and still reads as an ear.
 */
function pathEar(ctx: CanvasRenderingContext2D, r: number): void {
  const er = R(r * 0.26);
  ctx.moveTo(-r * 0.88 + er, r * 0.15);
  ctx.arc(-r * 0.88, r * 0.15, er, 0, Math.PI * 2);
}
function pathNose(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.moveTo(r * 0.7, r * 0.05); ctx.lineTo(r * 1.15, r * 0.3); ctx.lineTo(r * 0.7, r * 0.45); ctx.closePath();
}
function pathHair(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.moveTo(r * 0.62, -r * 0.62);
  ctx.lineTo(r * 0.3, -r * 0.9); ctx.lineTo(r * 0.05, -r * 1.02); ctx.lineTo(-r * 0.35, -r * 0.98); ctx.lineTo(-r * 0.8, -r * 0.7);
  ctx.lineTo(-r * 1.02, -r * 0.2); ctx.lineTo(-r * 1.0, r * 0.25); ctx.lineTo(-r * 0.8, r * 0.1); ctx.lineTo(-r * 0.7, -r * 0.35);
  ctx.lineTo(-r * 0.3, -r * 0.62); ctx.lineTo(r * 0.15, -r * 0.6);
  ctx.closePath();
}

/**
 * Skull + jaw + ear + nose as ONE path (head space): stroke the union once, fill it once, exactly as drawLimbSegs
 * does for a limb. The ear and the nose become bumps in the head's contour instead of a ball and a wedge inked onto
 * a face — a head was four separately outlined objects, which is what made faces read as a bundle of shapes.
 * `opts.noNose` for rigs that draw their own (Brunhild's wedge sits below the eye row); `opts.noHair` / `hairStyle`.
 */
export function drawSkull(ctx: CanvasRenderingContext2D, rig: PartRig, r: number, skin: string, hair: string | null, opts: SkullOpts | null = null): void {
  const jaw = opts && opts.jaw != null ? opts.jaw : 0.35;
  const style = (opts && opts.hairStyle) || rig.hairStyle;
  const hairOn = !!hair && !(opts && opts.noHair) && style !== 'bald';
  ctx.beginPath();
  pathSkull(ctx, r, jaw);
  pathEar(ctx, r);
  if (!(opts && opts.noNose)) pathNose(ctx, r);
  celPath(ctx, rig, skin, 0, 0, r, 0.3, 0.3);
  if (hairOn) drawHairCap(ctx, rig, r, hair, style);
}

/** Hair mass: a cap over the top/back of the skull. The three 1-2 px clump marks are gone — under the mark floor. */
export function drawHairCap(ctx: CanvasRenderingContext2D, rig: PartRig, r: number, hair: string, style = 'short'): void {
  if (style === 'bald') return;
  ctx.beginPath(); pathHair(ctx, r);
  celPath(ctx, rig, hair, -r * 0.2, -r * 0.5, r, 0.4, 0.3);
}

/**
 * One brow as a single slanted bar of thickness `t`: (x0,y0) -> (x1,y1). Inherits the current fillStyle.
 * Exported because the goblin rig (content/enemies/common.js) hooks its own face and so never got ccc343f's brows;
 * a second copy of four lines is how two faces in one game drift apart.
 */
export function brow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, t: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 + t); ctx.lineTo(x0, y0 + t);
  ctx.closePath(); ctx.fill();
}

/**
 * Face: whites of the eyes with pupils, brows and a mouth, all driven by the expression index (poses.js FACE).
 * Head space, rig faces right; the near eye sits at +x. `opts.noMouth` for bearded rigs, `opts.eyeY` to move the eye line.
 */
export function drawFace(ctx: CanvasRenderingContext2D, rig: PartRig, r: number, face: number, opts: FaceOpts | null = null): void {
  // readability pass: the WHITES scale with the head — radius >= 9.5 (or opts.big) gets 5x4 / 4x4, smaller heads
  // keep 4x3 / 3x3. Pupils and brows do NOT scale: they are 3 px everywhere, because below that they are erased by
  // the section 0.7 mark floor and the face loses its eyes.
  const big = opts && opts.big != null ? !!opts.big : r >= 9.5;
  const ink = rig.col(rig.outline), white = rig.col('#f8f4ec'), ey = R(-r * 0.15) + (opts && opts.eyeY || 0);
  const ex = R(r * 0.45), fx = R(-r * 0.12) - (big ? 1 : 0), pupil = rig.col(opts && opts.pupil || '#1a1418');
  const angry = face === FACE.angry || face === FACE.shout || face === FACE.grit;
  const closed = face === FACE.closed || face === FACE.happy;
  // Pupil width and brow thickness have DIFFERENT constraints and must not share a number.
  // A pupil below 3 px does not survive the section 0.7 mark floor, and a face whose pupils the floor has eaten
  // has no eyes at all. A brow at 3 px is not a brow, it is a lid: it lands on the eye and the whole socket reads
  // as one dark slab. So pupils are 3 px flat, brows stay 2 px, and the brow row sits clear of the whites.
  const ew = big ? 5 : 4, fw = big ? 4 : 3, eh = big ? 4 : 3, pw = 3, bt = 2;
  if (face === FACE.dazed) {
    ctx.fillStyle = ink;
    for (let i = 0; i < 3; i++) { ctx.fillRect(ex - 1 + i, ey - 1 + i, 1, 1); ctx.fillRect(ex + 1 - i, ey - 1 + i, 1, 1); ctx.fillRect(fx - 1 + i, ey - 1 + i, 1, 1); ctx.fillRect(fx + 1 - i, ey - 1 + i, 1, 1); }
  } else if (closed) {
    ctx.fillStyle = ink;
    if (face === FACE.happy) { ctx.fillRect(ex - 1, ey, 1, bt); ctx.fillRect(ex, ey - 1, ew - 2, bt); ctx.fillRect(ex + ew - 2, ey, 1, bt); ctx.fillRect(fx - 1, ey, 1, bt); ctx.fillRect(fx, ey - 1, fw - 2, bt); ctx.fillRect(fx + fw - 2, ey, 1, bt); }
    else { ctx.fillRect(ex - 1, ey, ew, bt); ctx.fillRect(fx - 1, ey, fw, bt); }
  } else {
    // whites + pupils (pupils look toward facing; hurt = wide eyes with small pupils)
    const wide = face === FACE.hurt ? 1 : 0;
    // the whites grow with the pupil, or a 3 px pupil swallows them and the eye reads as a solid dot. They grow
    // DOWNWARD only: growing upward would push the white under the brow row and reintroduce the lid.
    ctx.fillStyle = white; ctx.fillRect(ex - 1, ey - 1 - wide, ew + 1, eh + wide + 1); ctx.fillRect(fx - 1, ey - 1 - wide, fw + 1, eh + wide + 1);
    ctx.fillStyle = pupil;
    if (face === FACE.hurt) { ctx.fillRect(ex + 1, ey, pw, 1); ctx.fillRect(fx, ey, pw, 1); }
    else { ctx.fillRect(ex + 1, ey - (angry ? 0 : 1), pw, 2); ctx.fillRect(fx, ey - (angry ? 0 : 1), pw, 2); }
    if (angry) { ctx.fillStyle = ink; ctx.fillRect(ex - 1, ey - 1, ew, 1); ctx.fillRect(fx - 1, ey - 1, fw, 1); } // lids pressed down
  }
  // brows (stepped)
  ctx.fillStyle = rig.col(opts && opts.brow || rig.palette.hair || ink);
  const by = ey - 3 - (big ? 1 : 0);
  // An angry brow was a staircase of five 1-2 px rects. One slanted bar is the same expression in one mark, and
  // reads at play size instead of dissolving into a smudge.
  if (angry) { brow(ctx, ex - 2, by - 1, ex + ew - 1, by + 1, bt); brow(ctx, fx - 1, by, fx + fw - 1, by + 1, bt); }
  else if (face === FACE.hurt) { brow(ctx, ex - 2, by + 1, ex + ew - 2, by - 1, bt); brow(ctx, fx - 1, by + 1, fx + fw - 1, by - 1, bt); }
  else if (face === FACE.happy) { ctx.fillRect(ex - 2, by - 1, ew, bt); ctx.fillRect(fx - 1, by - 1, fw, bt); }
  else { ctx.fillRect(ex - 2, by, ew, bt); ctx.fillRect(fx - 1, by, fw, bt); }
  if (opts && opts.noMouth) return;
  drawMouth(ctx, rig, r, face, opts);
}

/** Mouth only (head space), for rigs that draw their own eyes. */
export function drawMouth(ctx: CanvasRenderingContext2D, rig: PartRig, r: number, face: number, opts: FaceOpts | null = null): void {
  const ink = rig.col(rig.outline), mx = R(r * 0.45), my = R(r * 0.5) + (opts && opts.mouthY || 0);
  ctx.fillStyle = ink;
  if (face === FACE.shout) { ctx.fillRect(mx - 1, my - 1, 4, 4); ctx.fillStyle = rig.col('#a03030'); ctx.fillRect(mx, my + 1, 2, 1); ctx.fillStyle = rig.col('#f8f4ec'); ctx.fillRect(mx, my - 1, 2, 1); }
  else if (face === FACE.hurt) { ctx.fillRect(mx, my - 1, 2, 3); }
  else if (face === FACE.angry || face === FACE.grit) { ctx.fillRect(mx - 1, my + 1, 1, 1); ctx.fillRect(mx, my, 3, 1); ctx.fillRect(mx + 3, my + 1, 1, 1); if (face === FACE.grit) { ctx.fillStyle = rig.col('#f8f4ec'); ctx.fillRect(mx, my + 1, 3, 1); } }
  else if (face === FACE.happy) { ctx.fillRect(mx - 1, my - 1, 1, 1); ctx.fillRect(mx, my, 3, 1); ctx.fillRect(mx + 3, my - 1, 1, 1); }
  else if (face === FACE.dazed) { ctx.fillRect(mx - 1, my, 1, 1); ctx.fillRect(mx, my + 1, 2, 1); ctx.fillRect(mx + 2, my, 1, 1); }
  else ctx.fillRect(mx, my, 3, 1);
}

/** Generic weapon: a shaded stick with a wrapped grip (hand space, +x along the blade). */
export function drawStick(ctx: CanvasRenderingContext2D, rig: PartRig, len: number, hex: string, gripHex: string | null): void {
  celRect(ctx, rig, -4, -2, len, 4, 2, hex, 0.4, 0.3);
  if (rig.override) return;
  ctx.fillStyle = rig.col(gripHex || rig.palette.dark);
  for (let x = -3; x < 6; x += 3) ctx.fillRect(x, -2, 2, 4);
}

export { pathRR, rimRect, rimTop };
