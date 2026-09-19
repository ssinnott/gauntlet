// Keyframe animation player (ARCHITECTURE.md section 4). Frame durations are in fixed steps (60 Hz).
//
// Moved here from game/animation.js, where it still sits (byte-identical) in both games: nothing in
// it is genre-specific -- it is the rig's animation player -- so in the library it belongs next to
// rig.ts under art/. The only structural change is the import specifiers, '../art/poses.js' ->
// './poses.ts' and '../art/rig.js' -> './rig.ts'. Every other line is the original's.
//
// It also hosts the shared animation data types (Frame, Anim, AnimSet, FrameMove), taken from Aether
// & Brass's types/content.d.ts -- see docs/TYPESCRIPT.md, "types/content.d.ts is itself shared". The
// combat-specific declarations there (Hit, Hitbox, HitType, Reaction, Hooks, SpawnMod, Trial and the
// dialogue types) stay in that game; a cooking game has no hitboxes. The rationale that file gives
// for itself carries over intact, and with it the one design decision that makes it work:
//
//   `src/content/` is the largest layer in the game and the one where a mistake is quietest: a
//   misspelled key in an animation frame or a hook object does not throw, it silently does nothing,
//   and the symptom is an enemy that behaves subtly wrong three stages later.
//
// So `Frame` has NO INDEX SIGNATURE, deliberately: a misspelled frame key has to be a compile error
// rather than a field that silently does nothing. Each game adds its own frame fields by declaration
// merging into `Frame` (or by extending it), never by widening it here.
import { lerpPose, makePose, copyPose, ease, faceIndex } from './poses.ts';
import type { EaseName, FaceRef, PartialPose } from './poses.ts';
import { markFull } from './rig.ts';
import type { FullPose } from './rig.ts';

/** Root motion for a frame, px/frame along facing. */
export interface FrameMove {
  x?: number;
  y?: number;
  z?: number;
  vy?: number;
}

/**
 * One entry of a frame's `fx` list: a named effect the owner spawns on frame entry, with whatever
 * parameters that kind takes. The open `unknown` tail is what lets each game author its own effect
 * kinds without declaring them here; the player never reads past `kind`, it only forwards the object
 * (this is the one shape in the file that carries an index signature, and it is never `any`).
 */
export interface FrameFx {
  kind: string;
  x?: number;
  y?: number;
  [k: string]: unknown;
}

/** A weapon smear arc for one frame, in root-space degrees; drawn by rig.ts. */
export interface FrameSmear {
  /** Start and end of the arc. */
  from?: number;
  to?: number;
  /** Radius of the arc. */
  r?: number;
  /** Alpha at this frame (default 0.45), faded toward the next frame's unless `fade` is false. */
  a?: number;
  fade?: boolean;
}

/**
 * One animation frame. `dur` is frames at 60 fps; everything else is optional.
 *
 * No index signature, on purpose (see the header). A game adds its own fields with
 *
 *   declare module '<this module>' { interface Frame { hitbox?: Hitbox | null; ... } }
 *
 * or by extending this interface. Merging only works for keys this file does NOT declare, which is
 * why the fields the player forwards without interpreting live in `FrameSlots` rather than here.
 */
export interface Frame {
  dur: number;
  pose?: PartialPose | null;
  /** Lerp toward the next frame's pose over `dur` (default true; false steps). */
  interp?: boolean;
  /** Root motion along facing, px/frame. */
  move?: FrameMove | number;
  fx?: FrameFx[];
  sfx?: string;
  /** Raised as an `event` entry in `AnimPlayer.events` on frame entry, for the owner to act on. */
  event?: string;
  /** Motion smear and easing — rig-level presentation, not in the doc. */
  smear?: FrameSmear;
  ease?: EaseName;
  /** Facial expression override for this frame (a `FACE` name or index; see poses.ts). */
  face?: FaceRef;
}

/**
 * The frame fields the player only forwards or truthiness-tests, never interprets: what a hit, an
 * area, a spawn or a cancel window actually is belongs to the game, not to the engine.
 *
 * They are deliberately NOT declared on `Frame`. A game gives them their real types by merging into
 * `Frame`, and TypeScript requires merged declarations of the same property to be identical, so a
 * `hitbox?: unknown` here would forbid the `hitbox?: Hitbox | null` that Aether & Brass needs. The
 * player reads them through `PlayerFrame` instead -- a view of the very same object, with no copy
 * and nothing that runs -- where each one resolves to the game's own type once merged.
 */
export interface FrameSlots {
  hitbox?: unknown;
  hitboxes?: unknown;
  area?: unknown;
  spawn?: unknown;
  projectile?: unknown;
  hit?: unknown;
  cancel?: unknown;
}

/** A frame as the player sees it: the declared fields plus the game's own (see `FrameSlots`). */
export type PlayerFrame = Frame & FrameSlots;

/** One named animation. */
export interface Anim {
  loop: boolean;
  frames: Frame[];
}

/**
 * A fighter's animation set. Keyed by name rather than a fixed list: content aliases entries
 * (`anims.run = anims.walk`), patches sets by spread, and plays names looked up at runtime
 * (`f.play('flee')`), so the key set is genuinely open.
 */
export type AnimSet = Record<string, Anim>;

/** One entry of `AnimPlayer.events`: an `event`/`sfx` name, or one `fx` spec, with the frame it came from. */
export interface AnimEvent {
  type: 'event' | 'sfx' | 'fx';
  name: string;
  value: string | FrameFx;
  frameIndex: number;
}

/** Options for `play`. */
export interface PlayOpts {
  /** Restart an animation that is already the one playing. */
  restart?: boolean;
  /** Played instead when `name` is missing. Defaults to 'idle'. */
  fallback?: string;
  /** Steps advanced per tick; 1 is authored speed. */
  speed?: number;
}

/** A [dur, pose, extra] tuple as `frames` takes them. */
export type FrameTuple = [dur: number, pose?: PartialPose | null, extra?: Partial<PlayerFrame> | null];

const EMPTY: Frame = Object.freeze({ dur: 1, pose: null });

/**
 * Plays named animations from an `anims` table: { name: { loop, frames: [ { dur, pose, interp, hitbox, move, fx, sfx, cancel, event,
 *   ease: 'in'|'out'|'inout'|'overshoot'|'snap',   // easing of the lerp toward the next frame (default linear)
 *   smear: { from, to, a, r, fade },                // weapon smear arc (root-space degrees) drawn by rig.js; alpha fades toward the next frame
 *   face: 'angry'|'hurt'|...                        // facial expression override for this frame (see poses.js FACE)
 * } ] } }.
 * `pose` is a fully populated, interpolated pose object reused every tick (never keep references across frames).
 * `events` accumulates { type: 'event'|'sfx'|'fx', name, value, frameIndex } entries as frames are entered; the owner
 * reads and clears it (`events.length = 0`) each step.
 */
export class AnimPlayer {
  // The fields, for the checker only, in constructor order. `declare` because these are the .js
  // constructor's own assignments and nothing else: a plain field declaration would emit a class
  // field per name (es2022 defines them before the constructor body runs), and this file is not
  // allowed to add a line of runtime. `declare` erases under both tsc and esbuild, so the emitted
  // class is the original's.
  declare anims: AnimSet;
  declare name: string | null;
  declare def: Anim | null;
  declare frameIndex: number;
  declare frameTime: number;
  declare time: number;
  declare done: boolean;
  declare speed: number;
  declare newFrame: boolean;
  declare instance: number;
  declare events: AnimEvent[];
  declare pose: FullPose;
  declare overlay: AnimSet | null;

  /** @param anims animation table */
  constructor(anims: AnimSet = {}) {
    this.anims = anims;
    this.name = null;
    this.def = null;
    this.frameIndex = 0;
    this.frameTime = 0;
    this.time = 0;
    this.done = false;
    this.speed = 1;
    /** True on the tick a new frame was entered (also right after play()). Use for `once` hitboxes. */
    this.newFrame = false;
    /** Increments every time an attack-like animation (re)starts; used as the hit-instance id. */
    this.instance = 0;
    this.events = [];
    this.pose = markFull(makePose());
    /** Optional table consulted before `anims` (a held pickup weapon's attack1..N; game/weapons.js). */
    this.overlay = null;
  }
  /** Install (or clear with `null`/falsy) the overlay table; see `tableFor`. */
  setOverlay(table: AnimSet | null | undefined): void { this.overlay = table || null; }
  /** The table `name` should resolve from: the overlay if it defines `name`, else the base `anims`. */
  tableFor(name: string): AnimSet { return this.overlay && this.overlay[name] ? this.overlay : this.anims; }
  /** Current frame object (or a static empty frame). */
  get frame(): PlayerFrame { return this.def ? this.def.frames[this.frameIndex] || EMPTY : EMPTY; }
  /** Convenience: current frame's hitbox / move / cancel fields. */
  get hitbox() { return this.frame.hitbox || null; }
  get move() { return this.frame.move || null; }
  get cancel() { return this.frame.cancel || null; }
  /** Total frames (steps) in the current animation. */
  get length(): number { if (!this.def) return 0; let n = 0; for (const f of this.def.frames) n += f.dur || 1; return n; }
  /** True if `name` exists in the table. */
  has(name: string): boolean { const t = this.tableFor(name); return !!(t && t[name] && t[name].frames && t[name].frames.length); }
  /**
   * Play an animation. Falls back to `fallback` (or idle) when missing. Restarting the same anim requires restart=true.
   * @returns true if the animation is (now) playing
   */
  play(name: string, { restart = false, fallback = 'idle', speed = 1 }: PlayOpts = {}): boolean {
    let n: string | null = name;
    if (!this.has(n)) n = this.has(fallback) ? fallback : null;
    if (n === null) { this.name = null; this.def = null; this.done = true; return false; }
    if (n === this.name && !restart) return true;
    this.name = n;
    this.def = this.tableFor(n)[n];
    this.frameIndex = 0;
    this.frameTime = 0;
    this.time = 0;
    this.done = false;
    this.speed = speed;
    this.instance++;
    this.newFrame = true;
    this._emitFrameEvents();
    this._updatePose();
    return true;
  }
  /** Advance one fixed step. */
  tick(): void {
    this.newFrame = false;
    if (!this.def) return;
    const frames = this.def.frames;
    if (this.done) { this._updatePose(); return; }
    this.time += this.speed;
    this.frameTime += this.speed;
    let guard = 0;
    while (this.frameTime >= (frames[this.frameIndex].dur || 1) && guard++ < 64) {
      this.frameTime -= frames[this.frameIndex].dur || 1;
      if (this.frameIndex + 1 < frames.length) { this.frameIndex++; this.newFrame = true; this._emitFrameEvents(); }
      else if (this.def.loop) { this.frameIndex = 0; this.newFrame = true; this._emitFrameEvents(); }
      else { this.done = true; this.frameTime = (frames[this.frameIndex].dur || 1) - 0.0001; break; }
    }
    this._updatePose();
  }
  /** Progress through the current animation in [0,1]. */
  get progress(): number { const L = this.length; return L ? Math.min(1, this.time / L) : 1; }
  /** Set the pose to a static (partial) pose without an animation table entry. */
  setStaticPose(pose: PartialPose | null | undefined): void { this.name = null; this.def = null; this.done = true; copyPose(pose, this.pose, true); }
  _emitFrameEvents(): void {
    const f = this.frame;
    if (f.sfx) this.events.push({ type: 'sfx', name: f.sfx, value: f.sfx, frameIndex: this.frameIndex });
    if (f.fx) for (const fx of f.fx) this.events.push({ type: 'fx', name: fx.kind, value: fx, frameIndex: this.frameIndex });
    if (f.event) this.events.push({ type: 'event', name: f.event, value: f.event, frameIndex: this.frameIndex });
  }
  _updatePose(): void {
    // Both `!`s: every call site reaches here with a def (play() has just assigned one, tick() has
    // returned early without one), and where it would not, the original throws here -- which the
    // assertion keeps, since it is erased.
    const frames = this.def!.frames, f = frames[this.frameIndex];
    const interp = f.interp !== false && !this.done;
    let next = f;
    if (interp) next = this.frameIndex + 1 < frames.length ? frames[this.frameIndex + 1] : (this.def!.loop ? frames[0] : f);
    let t = interp ? Math.min(1, this.frameTime / (f.dur || 1)) : 0;
    if (f.ease) t = ease(f.ease, t);
    const pose = lerpPose(f.pose, next.pose, t, this.pose);
    // frame-level overrides (authoring convenience): smear arc and facial expression live on the frame, not the pose
    if (f.face != null) pose.face = faceIndex(f.face);
    const sm = f.smear;
    if (sm) {
      const ps = pose.smear;
      ps.from = sm.from || 0; ps.to = sm.to || 0; ps.r = sm.r || 0;
      const a0 = sm.a != null ? sm.a : 0.45, a1 = next !== f && next.smear ? (next.smear.a != null ? next.smear.a : 0.45) : 0;
      ps.a = sm.fade === false ? a0 : a0 + (a1 - a0) * t;
    }
  }
}

/** Helper for authoring: build a frame list from [dur, pose, extra] tuples. */
export function frames(list: FrameTuple[]): PlayerFrame[] {
  return list.map(([dur, pose, extra]) => ({ dur, pose, ...(extra || {}) }));
}

// ---------- frame data (training room: screens/training.js frame-data readout) ----------
// `Frame['event']` rather than `string`: the set is asked about `f.event`, which is optional, and an
// absent event is simply not in it.
const ACTIVE_EVENTS = new Set<Frame['event']>(['spawnProjectile', 'shockwave', 'area', 'grapple']);
/** Startup / active / recovery frame counts, as `animTiming` returns them (frozen, and cached per def). */
export interface AnimTiming {
  startup: number;
  active: number;
  recovery: number;
  total: number;
}
const EMPTY_TIMING: Readonly<AnimTiming> = Object.freeze({ startup: 0, active: 0, recovery: 0, total: 0 });
const TIMING = new WeakMap<Anim, Readonly<AnimTiming>>();
/** True for a frame that can connect: a hitbox, an area, a spawn, or an event that spawns one. */
export function isActiveFrame(f: PlayerFrame): boolean { return !!(f.hitbox || f.hitboxes || f.area || f.spawn || f.projectile || f.hit || ACTIVE_EVENTS.has(f.event)); }
/** Startup / active / recovery frame counts of one anim def (cached per def; a frame with no dur counts 1, like tick()). */
export function animTiming(def: Anim | null | undefined): Readonly<AnimTiming> {
  if (!def || !def.frames || !def.frames.length) return EMPTY_TIMING;
  const cached = TIMING.get(def);
  if (cached) return cached;
  let first = -1, last = -1, total = 0;
  for (let i = 0; i < def.frames.length; i++) {
    const f = def.frames[i], dur = f.dur || 1;
    total += dur;
    if (isActiveFrame(f)) { if (first < 0) first = i; last = i; }
  }
  let out: Readonly<AnimTiming>;
  if (first < 0) out = Object.freeze({ startup: total, active: 0, recovery: 0, total });
  else {
    let startup = 0, active = 0, recovery = 0;
    for (let i = 0; i < def.frames.length; i++) {
      const dur = def.frames[i].dur || 1;
      if (i < first) startup += dur; else if (i <= last) active += dur; else recovery += dur;
    }
    out = Object.freeze({ startup, active, recovery, total });
  }
  TIMING.set(def, out);
  return out;
}
