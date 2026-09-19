// Arcade sound, synthesised on the spot.
//
// Nothing is downloaded and no asset files exist: every sound is a shaped oscillator or a burst of
// filtered noise, which keeps the promise that the game has no runtime dependencies and still
// builds into one self-contained HTML file.
//
// The game logic never comes here. src/game/ pushes plain string ids onto Game.sounds (see
// playSound in state.ts) and this module drains them once a frame, so the headless simulator runs
// the same code with no DOM in sight.
import type { Game } from '../game/state.ts';
import type { SoundId } from '../game/state.ts';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let broken = false;
/** Browsers refuse to start audio until the player has touched something. */
let unlocked = false;

function audio(): AudioContext | null {
  if (broken) return null;
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) { broken = true; return null; }
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    // One second of white noise, reused by every impact.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  } catch { broken = true; ctx = null; return null; }
}

/**
 * Call from every key press and tap until it takes: browsers block audio until a gesture, and on
 * iOS a resume() that lands a frame after the tap simply does not work. Latching "unlocked" on the
 * attempt rather than the result silenced the whole session after one miss -- and worse, a
 * suspended context's clock does not advance, so everything scheduled into it piles up and fires
 * at once whenever it finally starts.
 */
export function unlockAudio(): void {
  if (unlocked || broken) return;
  const c = audio();
  if (!c) return;
  if (c.state === 'running') { unlocked = true; return; }
  try {
    void c.resume().then(() => { unlocked = c.state === 'running'; }).catch(() => { /* the next gesture tries again */ });
  } catch { /* the next gesture tries again */ }
}

export function setVolume(v: number): void { if (master) master.gain.value = Math.max(0, Math.min(1, v)); }

interface ToneOpts { type?: OscillatorType; f0: number; f1?: number; dur: number; gain?: number; delay?: number; }

function tone(o: ToneOpts): void {
  const c = ctx, m = master;
  if (!c || !m) return;
  try {
    const at = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'square';
    const f1 = o.f1 ?? o.f0;
    osc.frequency.setValueAtTime(Math.max(1, o.f0), at);
    if (f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + o.dur);
    const peak = o.gain ?? 0.3;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.01, o.dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
    osc.connect(g); g.connect(m);
    osc.start(at);
    osc.stop(at + o.dur + 0.03);
  } catch { /* a dropped sound is never worth an exception */ }
}

function noise(dur: number, gain: number, cutoff: number, kind: BiquadFilterType = 'lowpass', delay = 0, sweepTo?: number): void {
  const c = ctx, m = master;
  if (!c || !m || !noiseBuf) return;
  try {
    const at = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = kind;
    f.frequency.setValueAtTime(cutoff, at);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f); f.connect(g); g.connect(m);
    src.start(at);
    src.stop(at + dur + 0.03);
  } catch { /* as above */ }
}

/** Every sound in the game, as a recipe. Short, bright and a little harsh: it is an arcade. */
const RECIPES: Record<SoundId, () => void> = {
  hit: () => { noise(0.06, 0.5, 1800); tone({ type: 'square', f0: 190, f1: 90, dur: 0.07, gain: 0.25 }); },
  crit: () => { noise(0.10, 0.7, 2600); tone({ type: 'square', f0: 260, f1: 90, dur: 0.12, gain: 0.35 }); tone({ type: 'square', f0: 520, f1: 180, dur: 0.14, gain: 0.2, delay: 0.03 }); },
  miss: () => { noise(0.05, 0.18, 3000, 'highpass'); },
  hurt: () => { tone({ type: 'sawtooth', f0: 320, f1: 110, dur: 0.20, gain: 0.34 }); noise(0.08, 0.3, 900); },
  kill: () => { tone({ type: 'sawtooth', f0: 240, f1: 60, dur: 0.24, gain: 0.3 }); noise(0.12, 0.3, 1200); },
  kill_unique: () => { [523, 440, 330].forEach((f, i) => tone({ type: 'square', f0: f, f1: f * 0.75, dur: 0.22, gain: 0.3, delay: i * 0.1 })); noise(0.3, 0.3, 900, 'lowpass', 0.2); },
  player_die: () => { tone({ type: 'sawtooth', f0: 330, f1: 40, dur: 1.2, gain: 0.4 }); noise(0.8, 0.25, 800, 'lowpass', 0.1, 120); },
  levelup: () => { [392, 523, 659, 784].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.16, gain: 0.26, delay: i * 0.07 })); },
  gold: () => { tone({ type: 'square', f0: 1200, dur: 0.05, gain: 0.22 }); tone({ type: 'square', f0: 1700, dur: 0.07, gain: 0.2, delay: 0.05 }); },
  pickup: () => { tone({ type: 'square', f0: 820, f1: 1250, dur: 0.06, gain: 0.2 }); },
  drop: () => { tone({ type: 'square', f0: 420, f1: 200, dur: 0.07, gain: 0.18 }); },
  wield: () => { noise(0.09, 0.3, 4200, 'highpass'); tone({ type: 'square', f0: 640, f1: 880, dur: 0.07, gain: 0.16 }); },
  quaff: () => { tone({ type: 'sine', f0: 280, f1: 720, dur: 0.2, gain: 0.26 }); },
  read: () => { noise(0.14, 0.22, 2600, 'highpass'); },
  eat: () => { noise(0.07, 0.3, 700); noise(0.07, 0.26, 600, 'lowpass', 0.11); },
  zap: () => { tone({ type: 'sawtooth', f0: 1300, f1: 220, dur: 0.18, gain: 0.26 }); },
  cast: () => { tone({ type: 'sine', f0: 420, f1: 1500, dur: 0.22, gain: 0.24 }); tone({ type: 'sine', f0: 630, f1: 2100, dur: 0.2, gain: 0.12, delay: 0.03 }); },
  fail: () => { tone({ type: 'square', f0: 220, f1: 140, dur: 0.22, gain: 0.24 }); },
  bolt: () => { tone({ type: 'sawtooth', f0: 950, f1: 300, dur: 0.15, gain: 0.24 }); },
  ball: () => { noise(0.32, 0.4, 1600, 'lowpass', 0, 200); tone({ type: 'sawtooth', f0: 220, f1: 60, dur: 0.3, gain: 0.26 }); },
  breath: () => { noise(0.5, 0.42, 500, 'bandpass', 0, 2400); },
  shoot: () => { tone({ type: 'square', f0: 1500, f1: 600, dur: 0.07, gain: 0.2 }); noise(0.05, 0.2, 5000, 'highpass'); },
  throw: () => { tone({ type: 'square', f0: 740, f1: 300, dur: 0.1, gain: 0.18 }); },
  stairs: () => { [330, 392, 494].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.1, gain: 0.2, delay: i * 0.06 })); },
  door: () => { noise(0.16, 0.3, 700, 'lowpass', 0, 260); },
  bash: () => { noise(0.22, 0.6, 500, 'lowpass', 0, 150); tone({ type: 'square', f0: 110, f1: 55, dur: 0.2, gain: 0.3 }); },
  dig: () => { for (let i = 0; i < 3; i++) noise(0.05, 0.3, 1400, 'lowpass', i * 0.09); },
  trap: () => { tone({ type: 'square', f0: 160, f1: 700, dur: 0.22, gain: 0.3 }); tone({ type: 'square', f0: 170, f1: 660, dur: 0.22, gain: 0.2, delay: 0.02 }); },
  teleport: () => { tone({ type: 'sine', f0: 220, f1: 2400, dur: 0.3, gain: 0.24 }); noise(0.2, 0.18, 1200, 'highpass', 0.1); },
  summon: () => { tone({ type: 'sawtooth', f0: 80, f1: 440, dur: 0.4, gain: 0.3 }); },
  heal: () => { [523, 659, 784].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 0.22, gain: 0.2, delay: i * 0.05 })); },
  curse: () => { tone({ type: 'sawtooth', f0: 300, f1: 70, dur: 0.5, gain: 0.3 }); },
  spawn: () => { tone({ type: 'square', f0: 480, f1: 1150, dur: 0.12, gain: 0.22 }); noise(0.08, 0.2, 2000); },
  generator_hurt: () => { noise(0.2, 0.5, 900, 'lowpass', 0, 250); tone({ type: 'square', f0: 220, f1: 90, dur: 0.22, gain: 0.3 }); },
  generator_die: () => { noise(0.55, 0.6, 1800, 'lowpass', 0, 120); tone({ type: 'sawtooth', f0: 320, f1: 40, dur: 0.6, gain: 0.35 }); tone({ type: 'square', f0: 160, f1: 40, dur: 0.5, gain: 0.2, delay: 0.08 }); },
  shop: () => { tone({ type: 'sine', f0: 880, dur: 0.1, gain: 0.2 }); tone({ type: 'sine', f0: 1320, dur: 0.14, gain: 0.18, delay: 0.09 }); },
  study: () => { [440, 554, 659].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 0.18, gain: 0.2, delay: i * 0.06 })); },
  lowhp: () => { tone({ type: 'square', f0: 880, dur: 0.09, gain: 0.3 }); tone({ type: 'square', f0: 880, dur: 0.09, gain: 0.3, delay: 0.14 }); },
};

/** At most this many sounds start in one frame, so a big turn does not turn into a wall of noise. */
const MAX_PER_FRAME = 3;

/**
 * Play (and clear) whatever the game asked for this frame. Duplicates within a frame collapse: ten
 * monsters dying at once is one death sound, not ten.
 */
export function playQueuedSounds(g: Game): void {
  const q = g.sounds;
  if (!q.length) return;
  if (!g.options.sound || !unlocked || broken) { q.length = 0; return; }
  const c = audio();
  // Never schedule into a context that is not actually running: its clock is stopped, so the whole
  // backlog would fire in one blast the moment it resumed.
  if (!c || c.state !== 'running') { q.length = 0; return; }
  const seen = new Set<SoundId>();
  let played = 0;
  for (const id of q) {
    if (seen.has(id)) continue;
    seen.add(id);
    const r = RECIPES[id];
    if (!r) continue;
    r();
    if (++played >= MAX_PER_FRAME) break;
  }
  q.length = 0;
}

/**
 * Play every recipe once. The smoke test drives the game through the debug API, which bypasses
 * Input and therefore never unlocks audio, so without this no sound recipe would ever run in a
 * browser during the checks -- and a recipe that throws (WebAudio rejects a zero target on an
 * exponential ramp, for one) would ship unnoticed. Returns how many were played.
 */
export function playEverySound(): number {
  const c = audio();
  if (!c) return 0;
  try { void c.resume(); } catch { /* the recipes are still exercised */ }
  let n = 0;
  for (const id of Object.keys(RECIPES) as SoundId[]) { RECIPES[id](); n++; }
  return n;
}

// ---------------------------------------------------------------------------------------------
// The narrator

let voiceBroken = false;
let lastSpoken = '';

/** The arcade voice. Shouted banners only: "WARRIOR NEEDS FOOD BADLY". */
export function speak(text: string): void {
  if (voiceBroken || !text || text === lastSpoken) return;
  lastSpoken = text;
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance !== 'function') { voiceBroken = true; return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.toLowerCase());
    u.rate = 0.85;
    u.pitch = 0.5;
    u.volume = 0.9;
    synth.speak(u);
  } catch { voiceBroken = true; }
}
export function stopSpeaking(): void { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }
/** Forget the last line, so the same banner can be spoken again later. */
export function resetNarrator(): void { lastSpoken = ''; }
