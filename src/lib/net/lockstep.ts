// Deterministic lockstep frame scheduler (docs/MULTIPLAYER.md, model M1).
//
// Every peer simulates every frame identically and they exchange only input masks. This module owns
// the frame bookkeeping and nothing else: it has no knowledge of transports, screens or the World,
// so it is fully unit testable in Node (tools/nettest.js).
//
// It schedules for a PARTY of two to four. Nothing here is written in terms of "the other peer":
// the frame is ready when every slot still in the match has input for it, which is the same rule
// whether that is one other player or three.
//
// Delay is applied when input is RECORDED, not when it is applied: input polled during frame F is
// scheduled for frame F + delay. Every peer does this symmetrically, so a packet's frame numbers
// are already delay-adjusted when they arrive. Frames 0..delay-1 are pre-filled with neutral input
// so the opening frames need no special case.

const RING = 1024;            // ~17s of frames; a stall long enough to wrap is a dead connection
const MASK = RING - 1;

/**
 * A run of consecutive input masks: `masks[0]` belongs to `baseFrame` and `masks[i]` to
 * `baseFrame + i`. This is exactly the body of an INPUT message (net/protocol.js encodeInput).
 */
export interface InputWindow {
  /** The frame `masks[0]` was recorded for. */
  baseFrame: number;
  /** One uint16 input mask per frame, oldest first. */
  masks: number[];
}

/** The first disagreement between our checksum and a peer's: enough to name who diverged, and when. */
export interface Desync {
  /** The frame both peers hashed. */
  frame: number;
  /** The slot whose checksum differed from ours. */
  slot: number;
  /** Our checksum for that frame. */
  mine: number;
  /** Their checksum for that frame. */
  theirs: number;
}

/** Options for `createLockstep`. Only `localSlot` is required; the rest are the tuned defaults. */
export interface LockstepOptions {
  /** Which slot this peer plays. Clamped into the party. */
  localSlot: number;
  /** Party size: how many slots the match schedules for. */
  players?: number;
  /** Frames between recording input and simulating it. */
  delay?: number;
  /** Frames of input repeated in every INPUT packet. */
  redundancy?: number;
  /** Exchange a checksum every this many frames. */
  checksumEvery?: number;
}

/** The frame bookkeeping for one peer in one match. */
export interface Lockstep {
  /** Next frame to simulate. */
  frame: number;
  /** Which slot this peer plays, after clamping. */
  localSlot: number;
  /** Party size: how many slots this match schedules for. */
  players: number;
  /** Every slot but ours, in order. */
  remoteSlots: number[];
  /** Frames between recording input and simulating it, after clamping. */
  delay: number;
  /** Consecutive frames spent waiting for remote input (0 when running). */
  stalled: number;
  /** Highest frame we hold input for, per slot (diagnostics / connection health). */
  remoteFrames: number[];
  /** Highest frame we have scheduled local input for. */
  lastRecorded: number;
  /** Set once when two peers' checksums disagree: { frame, slot, mine, theirs }. */
  desync: Desync | null;
  /** The first remote slot still holding the current frame up, or -1 when nothing is. */
  readonly remoteFrame: number;
  /** Record this frame's local device input and return the INPUT packet to send. */
  recordLocal(mask: number): InputWindow;
  /** The current redundancy window WITHOUT recording new input. */
  resend(): InputWindow;
  /** The contiguous run of input we hold for another slot, or null when there is none. */
  tailOf(slot: number, max?: number): InputWindow | null;
  /** Feed a decoded INPUT message from `slot`. */
  receiveInput(slot: number, baseFrame: number, list: ArrayLike<number>): void;
  /** True when every slot's input for the current frame is known. */
  canAdvance(): boolean;
  /** The slots whose input the current frame is waiting on (for the "waiting" overlay). */
  missing(): number[];
  /** Input masks for the current frame, one per slot. */
  inputs(): number[];
  /** Consume the current frame. Call only when canAdvance() is true. */
  advance(): void;
  /** Call when canAdvance() is false, to age the stall for disconnect detection. */
  stall(): void;
  /** Retire a slot from `frame` on. False when it is not ours to drop or was already dropped. */
  dropSlot(slot: number, frame: number): boolean;
  /** The frame `slot` left on, or -1 if they are still playing. */
  dropFrameOf(slot: number): number;
  /** True once the simulation has reached the frame `slot` was retired on. */
  isGone(slot: number, frame?: number): boolean;
  /** Slots still played by a person over the wire. */
  livingRemotes(): number[];
  /** Should a checksum be exchanged for `frame`? */
  isChecksumFrame(frame: number): boolean;
  /** Record our own checksum for a frame and compare it against every peer's that already arrived. */
  noteLocalChecksum(frame: number, sum: number): void;
  /** Feed a CHECKSUM message from `slot`. */
  receiveChecksum(slot: number, frame: number, sum: number): void;
}

export function createLockstep({ localSlot, players = 2, delay = 3, redundancy = 8, checksumEvery = 30 }: LockstepOptions): Lockstep {
  // delay 0 deadlocks: frame 0 would need input neither peer has scheduled yet, and each peer only
  // schedules input for a frame it has already simulated. Zero-delay lockstep needs rollback (M2).
  delay = Math.max(1, delay | 0);
  const n = Math.max(2, players | 0);
  localSlot = Math.min(Math.max(0, localSlot | 0), n - 1);
  const masks = Array.from({ length: n }, () => new Uint16Array(RING));
  const stamp = Array.from({ length: n }, () => new Int32Array(RING).fill(-1));
  /** First frame each slot is no longer part of the match, or -1 while they are still playing. */
  const dropAt = new Int32Array(n).fill(-1);
  const localSums = new Map<number, number>();                 // frame -> our checksum (bounded; kept for every peer to compare against)
  const pendingSums = new Map<number, Map<number, number>>();  // frame -> Map(slot -> their checksum) that arrived before ours

  const put = (slot: number, frame: number, mask: number) => {
    if (frame < 0) return;
    const i = frame & MASK;
    if (stamp[slot][i] === frame) return;       // already have it; ignore duplicates from redundancy
    stamp[slot][i] = frame;
    masks[slot][i] = mask & 0xffff;
  };
  /** A dropped slot is satisfied for every frame from its drop frame on: it presses nothing. */
  const gone = (slot: number, frame: number) => dropAt[slot] >= 0 && frame >= dropAt[slot];
  const has = (slot: number, frame: number) => gone(slot, frame) || stamp[slot][frame & MASK] === frame;
  const get = (slot: number, frame: number) => (!gone(slot, frame) && stamp[slot][frame & MASK] === frame ? masks[slot][frame & MASK] : 0);

  // Neutral input for the opening frames: nobody has pressed anything yet.
  for (let f = 0; f < delay; f++) for (let s = 0; s < n; s++) put(s, f, 0);

  const ls: Lockstep = {
    /** Next frame to simulate. */
    frame: 0,
    localSlot,
    /** Party size: how many slots this match schedules for. */
    players: n,
    /** Every slot but ours, in order. */
    remoteSlots: Array.from({ length: n }, (_, i) => i).filter((i) => i !== localSlot),
    delay,
    /** Consecutive frames spent waiting for remote input (0 when running). */
    stalled: 0,
    /** Highest frame we hold input for, per slot (diagnostics / connection health). */
    remoteFrames: new Array(n).fill(-1),
    /** Highest frame we have scheduled local input for. */
    lastRecorded: delay - 1,
    /** Set once when two peers' checksums disagree: { frame, slot, mine, theirs }. */
    desync: null,

    /** The first remote slot still holding the current frame up, or -1 when nothing is. */
    get remoteFrame() { let m = -1; for (const s of ls.remoteSlots) m = Math.max(m, ls.remoteFrames[s]); return m; },

    /**
     * Record this frame's local device input and return the INPUT packet to send.
     * Call exactly once per simulated frame, before advance().
     */
    recordLocal(mask) {
      const target = ls.frame + delay;
      put(localSlot, target, mask);
      ls.lastRecorded = target;
      return window(target);
    },

    /**
     * The current redundancy window WITHOUT recording new input. Send this on a timer whenever the
     * party is stalled. Without it, two peers that stall on the same frame never transmit again -
     * each is waiting for input the other will only send after advancing - and the match deadlocks
     * permanently. Cheap insurance: it is the same 23-byte packet.
     */
    resend() { return window(ls.lastRecorded); },

    /**
     * The contiguous run of input we hold for another slot, ending at the last frame we heard from
     * them. Peers broadcast this for whoever they are stalled on, so a player who has gone quiet is
     * still heard through the others: everyone converges on the same last frame that player played,
     * which is what makes a drop land on one agreed frame instead of three different ones.
     */
    tailOf(slot, max = 16) {
      if (slot === localSlot || slot < 0 || slot >= n) return null;
      const hi = ls.remoteFrames[slot];
      if (hi < 0 || !has(slot, hi)) return null;
      let lo = hi;
      while (lo > 0 && hi - lo + 1 < max && has(slot, lo - 1)) lo--;
      const out = [];
      for (let f = lo; f <= hi; f++) out.push(get(slot, f));
      return { baseFrame: lo, masks: out };
    },

    /** Feed a decoded INPUT message from `slot`. */
    receiveInput(slot, baseFrame, list) {
      if (slot === localSlot || slot < 0 || slot >= n) return;   // our own input is never taken off the wire
      for (let i = 0; i < list.length; i++) {
        const f = baseFrame + i;
        if (f >= ls.frame + RING) continue;     // absurdly far ahead: ignore rather than corrupt the ring
        put(slot, f, list[i]);
        if (f > ls.remoteFrames[slot]) ls.remoteFrames[slot] = f;
      }
    },

    /** True when every slot's input for the current frame is known. */
    canAdvance() {
      for (let s = 0; s < n; s++) if (!has(s, ls.frame)) return false;
      return true;
    },

    /** The slots whose input the current frame is waiting on (for the "waiting" overlay). */
    missing() {
      const out = [];
      for (let s = 0; s < n; s++) if (!has(s, ls.frame)) out.push(s);
      return out;
    },

    /** Input masks for the current frame, one per slot. */
    inputs() { const out = new Array(n); for (let s = 0; s < n; s++) out[s] = get(s, ls.frame); return out; },

    /** Consume the current frame. Call only when canAdvance() is true. */
    advance() { ls.frame++; ls.stalled = 0; },

    /** Call when canAdvance() is false, to age the stall for disconnect detection. */
    stall() { ls.stalled++; },

    /**
     * Retire a slot from `frame` on: the host has declared that peer gone (net/protocol.js DROP).
     * The frame is part of the message precisely so that every remaining peer stops waiting for
     * them on the SAME frame - a slot dropped at three different moments is three simulations.
     * Frames before it still need their real input, so a drop never rewrites what has been played.
     */
    dropSlot(slot, frame) {
      if (slot < 0 || slot >= n || slot === localSlot) return false;
      if (dropAt[slot] >= 0) return false;                  // first declaration wins; a repeat is a resend
      dropAt[slot] = Math.max(0, frame | 0);
      return true;
    },
    /** The frame `slot` left on, or -1 if they are still playing. */
    dropFrameOf(slot) { return slot >= 0 && slot < n ? dropAt[slot] : -1; },
    /** True once the simulation has reached the frame `slot` was retired on. */
    isGone(slot, frame = ls.frame) { return slot >= 0 && slot < n && gone(slot, frame); },
    /** Slots still played by a person over the wire. */
    livingRemotes() { return ls.remoteSlots.filter((s) => dropAt[s] < 0); },

    /** Should a checksum be exchanged for `frame`? */
    isChecksumFrame(frame) { return frame % checksumEvery === 0; },

    /**
     * Record our own checksum for a frame and compare it against every peer's that already arrived.
     * Ours is KEPT (bounded by an LRU) rather than consumed by the first comparison: with four
     * players three separate peers will each want to be checked against this same number.
     */
    noteLocalChecksum(frame, sum) {
      localSums.set(frame, sum >>> 0);
      if (localSums.size > 256) localSums.delete(localSums.keys().next().value!);
      const waiting = pendingSums.get(frame);
      if (!waiting) return;
      pendingSums.delete(frame);
      for (const [slot, theirs] of waiting) compare(frame, slot, sum >>> 0, theirs);
    },

    /** Feed a CHECKSUM message from `slot`. */
    receiveChecksum(slot, frame, sum) {
      const mine = localSums.get(frame);
      if (mine !== undefined) { compare(frame, slot, mine, sum >>> 0); return; }
      if (!pendingSums.has(frame)) pendingSums.set(frame, new Map());
      pendingSums.get(frame)!.set(slot, sum >>> 0);
      if (pendingSums.size > 64) pendingSums.delete(pendingSums.keys().next().value!);
    },
  };

  function window(target: number): InputWindow {
    const from = Math.max(0, target - redundancy + 1);
    const out = [];
    for (let f = from; f <= target; f++) out.push(get(localSlot, f));
    return { baseFrame: from, masks: out };
  }

  function compare(frame: number, slot: number, mine: number, theirs: number): void {
    if (mine !== theirs && !ls.desync) ls.desync = { frame, slot, mine, theirs };
  }

  return ls;
}
