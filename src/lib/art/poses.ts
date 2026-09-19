// Pose objects and interpolation helpers (ARCHITECTURE.md section 4). Angles in degrees.
// Convention: armR/legR are the NEAR limbs (closest to the viewer), armL/legL the FAR limbs.

/** A root/torso/head placement: offset plus rotation. */
export type PoseTransform = { x: number; y: number; rot: number };
/** An arm or a leg: the two segment angles. */
export type PoseLimb = { upper: number; lower: number };
/** A hand, foot or weapon: rotation only. */
export type PoseHinge = { rot: number };
/** A weapon smear arc; see the `smear` field of `DEFAULT_POSE` for what the four numbers mean. */
export type PoseSmear = { from: number; to: number; a: number; r: number };

/** A fully populated pose: what `makePose` allocates and what `copyPose`/`lerpPose` write into. */
export type Pose = {
  root: PoseTransform;
  torso: PoseTransform;
  head: PoseTransform;
  armR: PoseLimb;
  armL: PoseLimb;
  legR: PoseLimb;
  legL: PoseLimb;
  handR: PoseHinge;
  handL: PoseHinge;
  footR: PoseHinge;
  footL: PoseHinge;
  weapon: PoseHinge;
  squash: number;
  stretch: number;
  grip: number;
  face: number;
  weaponBack: number;
  smear: PoseSmear;
};

/** A `Pose` frozen one group deep, which is exactly what `Object.freeze` leaves `DEFAULT_POSE` as. */
export type FrozenPose = Readonly<{ [K in keyof Pose]: Pose[K] extends number ? number : Readonly<Pose[K]> }>;

/** Fully specified default pose. Any partial pose is resolved against this. */
export const DEFAULT_POSE: FrozenPose = Object.freeze({
  root: Object.freeze({ x: 0, y: 0, rot: 0 }),
  torso: Object.freeze({ rot: 0, x: 0, y: 0 }),
  head: Object.freeze({ rot: 0, x: 0, y: 0 }),
  armR: Object.freeze({ upper: 20, lower: 10 }),
  armL: Object.freeze({ upper: -20, lower: 10 }),
  legR: Object.freeze({ upper: 0, lower: 0 }),
  legL: Object.freeze({ upper: 0, lower: 0 }),
  handR: Object.freeze({ rot: 0 }),
  handL: Object.freeze({ rot: 0 }),
  footR: Object.freeze({ rot: 0 }),
  footL: Object.freeze({ rot: 0 }),
  weapon: Object.freeze({ rot: 0 }),
  squash: 1,
  stretch: 1,
  /** 0..1 blend of the far arm onto a two-handed weapon's grip (2-bone IK; only used when build.weapon.twoHanded). */
  grip: 0,
  /** Facial expression index (see FACE); stepped, never interpolated. */
  face: 0,
  /** 1 = the weapon is drawn in the back layer (behind the body: rested on the shoulder / slung); stepped, never interpolated. */
  weaponBack: 0,
  /** Weapon smear arc in root space: from/to angles in degrees (0 = forward, -90 = up), a = alpha, r = radius (0 = auto). from/to step, a/r lerp. */
  smear: Object.freeze({ from: 0, to: 0, a: 0, r: 0 }),
});

/** Named facial expressions for `pose.face` (P() accepts the names). */
export const FACE = Object.freeze({ neutral: 0, angry: 1, hurt: 2, happy: 3, shout: 4, dazed: 5, grit: 6, closed: 7 });
/** The expression names in `FACE`. The animation layer keys off these. */
export type FaceName = keyof typeof FACE;
/** A face, however it is written: a `FACE` index or one of its names. */
export type FaceRef = FaceName | number;
/** Resolve a face name or number to an index. */
export function faceIndex(v: FaceRef | null | undefined): number { return typeof v === 'number' ? v : (v != null && FACE[v] != null ? FACE[v] : 0); }

/** A partial pose: every group and every number optional. This is what anims are authored in. */
export type PartialPose = {
  root?: Partial<PoseTransform>;
  torso?: Partial<PoseTransform>;
  head?: Partial<PoseTransform>;
  armR?: Partial<PoseLimb>;
  armL?: Partial<PoseLimb>;
  legR?: Partial<PoseLimb>;
  legL?: Partial<PoseLimb>;
  handR?: Partial<PoseHinge>;
  handL?: Partial<PoseHinge>;
  footR?: Partial<PoseHinge>;
  footL?: Partial<PoseHinge>;
  weapon?: Partial<PoseHinge>;
  squash?: number;
  stretch?: number;
  grip?: number;
  /** An index or a `FACE` name; `copyPose` and `P` resolve names through `faceIndex`. */
  face?: FaceRef;
  weaponBack?: number;
  smear?: Partial<PoseSmear>;
};

/** One group of numbers inside a pose (`root`, `armR`, `smear`, ...), read by key. */
type PoseGroup = Record<string, number>;
/** What one top-level pose key holds: a number, or one of those groups. */
type PoseValue = number | PoseGroup;
/**
 * A pose seen as a plain table. The walks below index poses by a computed key, which `strict` only
 * allows through a type that has an index signature, so they take this view of the very same
 * object. It is a type-level alias: no copy, no conversion, nothing that runs.
 */
type PoseTable = Record<string, PoseValue>;

const KEYS = Object.keys(DEFAULT_POSE) as (keyof Pose)[];
/** Keys whose numbers are held (stepped) rather than interpolated. */
const STEP: Readonly<Record<string, boolean | undefined>> = Object.freeze({ face: true, from: true, to: true, weaponBack: true });

/** Allocate a fresh, fully populated pose object. */
export function makePose(partial: PartialPose | null = null): Pose {
  const out: PoseTable = {};
  for (const k of KEYS) {
    const d: PoseValue = DEFAULT_POSE[k];
    if (typeof d === 'number') out[k] = d;
    else { out[k] = {}; for (const s of Object.keys(d)) (out[k] as PoseGroup)[s] = d[s]; }
  }
  if (partial) copyPose(partial, out as Pose);
  return out as Pose;
}

/** Overlay a (partial) pose onto `out` (which must be fully populated). Missing values in `src` become defaults when `reset` is true. */
export function copyPose(src: PartialPose | null | undefined, out: Pose, reset = false): Pose {
  const dst = out as PoseTable;
  for (const k of KEYS) {
    const d: PoseValue = DEFAULT_POSE[k];
    const v = src ? src[k] : undefined;
    if (typeof d === 'number') { dst[k] = v != null ? (k === 'face' ? faceIndex(v as FaceRef) : v as number) : (reset ? d : dst[k]); continue; }
    const o = dst[k] as PoseGroup;
    for (const s of Object.keys(d)) {
      const sv = v && (v as PoseGroup)[s] != null ? (v as PoseGroup)[s] : undefined;
      o[s] = sv != null ? sv : (reset ? d[s] : o[s]);
    }
  }
  return out;
}

/** Scratch pose used when no `out` is given (do not keep references across frames). */
export const SCRATCH_POSE = makePose();

/**
 * Deep-interpolate two (possibly partial) poses into `out` (default: shared scratch object; no allocation).
 * @returns out
 */
export function lerpPose(a: PartialPose | null | undefined, b: PartialPose | null | undefined, t: number, out: Pose = SCRATCH_POSE): Pose {
  const dst = out as PoseTable;
  for (const k of KEYS) {
    const d: PoseValue = DEFAULT_POSE[k];
    const av = a ? a[k] : undefined, bv = b ? b[k] : undefined;
    if (typeof d === 'number') {
      if (STEP[k]) { dst[k] = av != null ? (k === 'face' ? faceIndex(av as FaceRef) : av as number) : d; continue; }
      const x = av != null ? av as number : d, y = bv != null ? bv as number : d;
      dst[k] = x + (y - x) * t;
      continue;
    }
    const o = dst[k] as PoseGroup;
    for (const s of Object.keys(d)) {
      const x = av && (av as PoseGroup)[s] != null ? (av as PoseGroup)[s] : d[s];
      if (STEP[s]) { o[s] = x; continue; }
      const y = bv && (bv as PoseGroup)[s] != null ? (bv as PoseGroup)[s] : d[s];
      o[s] = x + (y - x) * t;
    }
  }
  return out;
}

/** Easing curves for keyframes (frame.ease). t in [0,1]. */
export const EASE = Object.freeze({
  linear: (t: number) => t,
  in: (t: number) => t * t * t,
  out: (t: number) => 1 - (1 - t) * (1 - t) * (1 - t),
  inout: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  overshoot: (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  snap: (t: number) => (t < 0.5 ? 0 : 1),
});
/** The easing names in `EASE`, as `frame.ease` spells them. */
export type EaseName = keyof typeof EASE;
/** Apply a named easing to t (unknown names = linear). */
export function ease(name: EaseName | null | undefined, t: number): number { const f = name && EASE[name]; return f ? f(t) : t; }

/** Swap near/far limbs (armR<->armL, legR<->legL, handR<->handL, footR<->footL) into `out`. */
export function mirrorPose(pose: PartialPose | null | undefined, out: Pose = makePose()): Pose {
  copyPose(pose, out, true);
  const swap = <K extends keyof Pose>(a: K, b: K) => { const tmp = out[a]; out[a] = out[b]; out[b] = tmp; };
  swap('armR', 'armL'); swap('legR', 'legL'); swap('handR', 'handL'); swap('footR', 'footL');
  return out;
}

/** Add `delta` (partial pose, numbers are added) onto `pose` in place. Handy for procedural bob/lean. */
export function addPose(pose: Pose, delta: PartialPose): Pose {
  // Two views of the same object (see PoseTable): this walk adds into the numbers and writes into
  // the groups, and each needs the value type of its own branch. Type-level only.
  const nums = pose as unknown as Record<string, number>;
  const groups = pose as unknown as Record<string, PoseGroup>;
  for (const k of Object.keys(delta)) {
    const d = (delta as unknown as PoseTable)[k];
    if (typeof d === 'number') nums[k] += d;
    else if (groups[k]) for (const s of Object.keys(d)) groups[k][s] = (groups[k][s] || 0) + d[s];
  }
  return pose;
}

/** The shorthand `P()` accepts: arrays and bare numbers as well as the group objects themselves. */
export type PoseSpec = {
  root?: number[] | Partial<PoseTransform>;
  torso?: number | number[] | Partial<PoseTransform>;
  head?: number | number[] | Partial<PoseTransform>;
  armR?: number[] | Partial<PoseLimb>;
  armL?: number[] | Partial<PoseLimb>;
  legR?: number[] | Partial<PoseLimb>;
  legL?: number[] | Partial<PoseLimb>;
  handR?: number | Partial<PoseHinge>;
  handL?: number | Partial<PoseHinge>;
  footR?: number | Partial<PoseHinge>;
  footL?: number | Partial<PoseHinge>;
  weapon?: number | Partial<PoseHinge>;
  squash?: number;
  stretch?: number;
  grip?: number;
  face?: FaceRef;
  weaponBack?: number;
  smear?: number[] | Partial<PoseSmear>;
};

/** Every form a `PoseSpec` value can take, for the key-walk below. */
type PoseSpecValue = number | number[] | FaceRef | Partial<PoseTransform> | Partial<PoseLimb> | Partial<PoseHinge> | Partial<PoseSmear>;

/** Shorthand builder for authoring anims: P({ armR: [upper, lower], legL: [u, l], torso: rot, head: rot, root: [x, y, rot] ... }). */
export function P(spec: PoseSpec = {}): PartialPose {
  const o: Record<string, PoseSpecValue> = {};
  for (const k of Object.keys(spec)) {
    const v = (spec as unknown as Record<string, PoseSpecValue>)[k];
    if (k === 'armR' || k === 'armL' || k === 'legR' || k === 'legL') o[k] = Array.isArray(v) ? { upper: v[0], lower: v[1] } : v;
    else if (k === 'torso' || k === 'head') o[k] = typeof v === 'number' ? { rot: v } : Array.isArray(v) ? { rot: v[0], x: v[1], y: v[2] } : v;
    else if (k === 'root') o[k] = Array.isArray(v) ? { x: v[0], y: v[1], rot: v[2] || 0 } : v;
    else if (k === 'handR' || k === 'handL' || k === 'weapon' || k === 'footR' || k === 'footL') o[k] = typeof v === 'number' ? { rot: v } : v;
    else if (k === 'smear') o[k] = Array.isArray(v) ? { from: v[0], to: v[1], a: v[2] != null ? v[2] : 0.45, r: v[3] || 0 } : v;
    else if (k === 'face') o[k] = faceIndex(v as FaceRef);
    else o[k] = v;
  }
  return o as unknown as PartialPose;
}
