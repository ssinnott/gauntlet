// Secondary motion: chains of lagging segments (beards, hair, ponytails, scarves, coat-tails, chimney puffs) that
// react to how their anchor joint moved since the previous frame. State lives on the rig (one chain per name), is
// created lazily on first use and updated once per drawRig call with an AnimPlayer pose; nothing allocates per frame.
//
// Content usage (inside a part hook or accessory draw, in the anchor's local space):
//   const ch = getChain(rig, 'beard', 3, { rest: [0, 1], stiffness: 0.12, damping: 0.72, gain: 2.5 });
//   for (let i = 0; i < ch.n; i++) { ctx.rotate(rad(ch.ang[i])); ...draw segment i, then translate to its tip... }
// `ch.ang[i]` is the extra rotation (degrees, clockwise) of segment i relative to segment i-1.
import { rad } from '../engine/math.ts';

/** Option bag for `getChain`. Every field falls back to `DEFAULTS`, except `joint`, which defaults to 'head'. */
export interface ChainOpts {
  /** Anchor joint name (default 'head'). */
  joint?: string;
  /** Unit direction the chain hangs toward at rest ([0,1] = down, [-1,0] = back). */
  rest?: [number, number];
  /** How strongly each segment is pulled back toward its target angle. */
  stiffness?: number;
  /** Per-step velocity retention. */
  damping?: number;
  /** px of anchor motion -> degrees of swing. */
  gain?: number;
  /** How much anchor rotation is lagged. */
  rotGain?: number;
  /** How strongly segment i chases i-1. */
  follow?: number;
  /** Angle limit per segment (degrees); hitting it bounces the velocity. */
  maxAng?: number;
  /** Anchor motion above this (px, either axis) is a teleport and resets the chain instead of swinging it. */
  teleport?: number;
}

/** One chain's live state, stored on `rig.chains[name]` and stepped once per animated `drawRig`. */
export interface Chain {
  /** Segment count. */
  n: number;
  /** Anchor joint name. */
  joint: string;
  /** Per-segment angle (degrees, clockwise) relative to the previous segment. */
  ang: Float32Array;
  /** Per-segment angular velocity (degrees per step). */
  vel: Float32Array;
  /** Rest direction x (from `opts.rest`). */
  rx: number;
  /** Rest direction y (from `opts.rest`). */
  ry: number;
  stiffness: number;
  damping: number;
  gain: number;
  rotGain: number;
  follow: number;
  maxAng: number;
  teleport: number;
  /** False until the first step has recorded an anchor position to difference against. */
  init: boolean;
  lastX: number;
  lastY: number;
  lastAng: number;
  lastRoot: number;
  /** Scratch point the caller writes the anchor's screen position into; never reallocated. */
  pt: { x: number; y: number };
  /** Sum of ang[0..i] (degrees). */
  total(i: number): number;
}

/** The slice of a rig this module touches: the map of named chains `buildRig` starts empty. */
export interface ChainRig {
  chains: Record<string, Chain>;
}

/** Every `ChainOpts` field except `joint`, all present: exactly what `DEFAULTS` supplies to the merge in `getChain`. */
type ChainDefaults = Required<Omit<ChainOpts, 'joint'>>;

const DEFAULTS: Readonly<ChainDefaults> = Object.freeze<ChainDefaults>({ rest: [0, 1], stiffness: 0.14, damping: 0.7, gain: 2.2, rotGain: 0.6, follow: 0.35, maxAng: 55, teleport: 60 });

/**
 * Get (or lazily create) a named chain on a rig.
 * @param rig from buildRig
 * @param name chain id
 * @param n segment count
 * @param opts
 *   joint: anchor joint name (default 'head'); rest: unit direction the chain hangs toward at rest ([0,1] = down, [-1,0] = back);
 *   gain: px of anchor motion -> degrees of swing; rotGain: how much anchor rotation is lagged; follow: how strongly segment i chases i-1.
 */
export function getChain(rig: ChainRig, name: string, n: number = 3, opts: ChainOpts | null = null): Chain {
  let ch = rig.chains[name];
  if (ch) return ch;
  const o = { ...DEFAULTS, ...(opts || {}) };
  ch = rig.chains[name] = {
    n, joint: o.joint || 'head', ang: new Float32Array(n), vel: new Float32Array(n), rx: o.rest[0], ry: o.rest[1],
    stiffness: o.stiffness, damping: o.damping, gain: o.gain, rotGain: o.rotGain, follow: o.follow, maxAng: o.maxAng, teleport: o.teleport,
    init: false, lastX: 0, lastY: 0, lastAng: 0, lastRoot: 0, pt: { x: 0, y: 0 },
    /** Sum of ang[0..i] (degrees). */
    total(i: number): number { let s = 0; for (let k = 0; k <= i && k < this.n; k++) s += this.ang[k]; return s; },
  };
  return ch;
}

/**
 * Step one chain given the anchor's screen motion (dx, dy in local px, facing-corrected) and rotation delta (degrees).
 * Called by rig.js; exported so tools can drive chains directly.
 */
export function stepChain(ch: Chain, dx: number, dy: number, dAng: number): void {
  // lateral component of the anchor motion relative to the rest direction (clockwise positive)
  const lateral = (dx * ch.ry - dy * ch.rx) * ch.gain - dAng * ch.rotGain;
  const ang = ch.ang, vel = ch.vel, n = ch.n;
  for (let i = 0; i < n; i++) {
    const target = i > 0 ? ang[i - 1] * ch.follow : 0;
    let v = vel[i] + (target - ang[i]) * ch.stiffness + lateral * (1 - i * 0.18);
    v *= ch.damping;
    let a = ang[i] + v;
    if (a > ch.maxAng) { a = ch.maxAng; v *= -0.3; } else if (a < -ch.maxAng) { a = -ch.maxAng; v *= -0.3; }
    ang[i] = a; vel[i] = v;
  }
}

/** Reset a chain to rest (used on teleports / respawn). */
export function resetChain(ch: Chain): void { ch.ang.fill(0); ch.vel.fill(0); ch.init = false; }

/** Convenience for drawing: rotate the context by segment i's angle (degrees). */
export function chainRotate(ctx: CanvasRenderingContext2D, ch: Chain, i: number): void { ctx.rotate(rad(ch.ang[i])); }
