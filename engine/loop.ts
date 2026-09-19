// Fixed-timestep game loop (ARCHITECTURE.md section 3). Logic at exactly 60 Hz, render per rAF.
//
// LIBRARY SEAM: in both games this module read `DT` and `MAX_STEPS_PER_FRAME` from the game's own
// `src/constants.js`, which a library cannot import. They are now `dt` / `maxSteps` on the options object,
// defaulting to the 1 / 60 and 5 that both games define today, so an existing `createLoop({ update, render })`
// call behaves exactly as it did before.

/** Options for `createLoop`. Only `update` and `render` are required; the rest carry both games' values. */
export interface LoopOptions {
  /** Advance the simulation by one fixed step. */
  update: () => void;
  /** Draw one frame. */
  render: () => void;
  /** In testMode the loop never self-runs; `step(n)` drives it (n fixed updates + 1 render). */
  testMode?: boolean;
  /** Gates the fixed step without gating rendering; see the note on `createLoop`. */
  canUpdate?: (() => boolean) | null;
  /** Fixed timestep in seconds (logic runs at exactly 60 Hz). */
  dt?: number;
  /** Max fixed updates per animation frame (spiral-of-death clamp). */
  maxSteps?: number;
}

/** The main loop returned by `createLoop`. */
export interface Loop {
  /** Whether this loop was built in testMode. */
  testMode: boolean;
  /** Start the rAF loop. No-op in testMode unless `force` is set (netplay tests need the real gated loop). */
  start(force?: boolean): void;
  /** Stop the rAF loop. */
  stop(): void;
  /** Run n fixed updates then one render, ignoring `canUpdate`. Used by tests; also works in normal mode. */
  step(n?: number): void;
  /** Frames per second over the last half second; always 60 in testMode. */
  readonly fps: number;
  /** Whether the rAF loop is running. */
  readonly running: boolean;
  /** Fixed updates run so far. */
  readonly frame: number;
  /** True when the last tick was held back by `canUpdate` (netplay draws a waiting overlay on this). */
  readonly gated: boolean;
}

/**
 * Create the main loop.
 *   In testMode the loop never self-runs; `step(n)` drives it (n fixed updates + 1 render).
 *   `canUpdate` gates the fixed step without gating rendering: lockstep netcode returns false while
 *   waiting for the peer's input, so the game keeps drawing (and can show "waiting for peer")
 *   without advancing the simulation. `step(n)` ignores the gate so tests stay in control.
 */
export function createLoop({ update, render, testMode = false, canUpdate = null, dt = 1 / 60, maxSteps = 5 }: LoopOptions): Loop {
  let running = false;
  let rafId = 0;
  let last = 0;
  let acc = 0;
  let fps = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let frame = 0;
  let lastGated = false;

  function tick(now: number): void {
    if (!running) return;
    const dtSec = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += dtSec;
    let steps = 0;
    let gated = false;
    while (acc >= dt && steps < maxSteps) {
      if (canUpdate && !canUpdate()) { gated = true; break; }
      update();
      frame++;
      acc -= dt;
      steps++;
    }
    lastGated = gated;
    if (steps === maxSteps) acc = 0;      // drop backlog rather than spiral
    // A gated break leaves steps < MAX, so the guard above never fires and `acc` keeps growing for
    // the whole stall. A 300 ms wait would then replay ~18 queued steps in bursts of 5 the instant
    // the peer's input arrives, fast-forwarding the match. Keep at most one step of credit.
    else if (gated) acc = Math.min(acc, dt);
    render();
    fpsFrames++;
    fpsTime += dtSec;
    if (fpsTime >= 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }
    rafId = requestAnimationFrame(tick);
  }

  const loop: Loop = {
    testMode,
    /** Start the rAF loop. No-op in testMode unless `force` is set (netplay tests need the real gated loop). */
    start(force = false) {
      if ((testMode && !force) || running) return;
      running = true;
      last = performance.now();
      acc = 0;
      rafId = requestAnimationFrame(tick);
    },
    /** Stop the rAF loop. */
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    /** Run n fixed updates then one render, ignoring `canUpdate`. Used by tests; also works in normal mode. */
    step(n = 1) {
      for (let i = 0; i < n; i++) { update(); frame++; }
      render();
    },
    get fps() { return testMode ? 60 : fps; },
    get running() { return running; },
    get frame() { return frame; },
    /** True when the last tick was held back by `canUpdate` (netplay draws a waiting overlay on this). */
    get gated() { return lastGated; },
  };
  return loop;
}
