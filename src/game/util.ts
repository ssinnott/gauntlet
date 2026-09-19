// Small numeric helpers shared by every system. All randomness goes through the engine's seeded rng.
import { rng } from '../lib/engine/rng.ts';

/** Roll `n` dice of `s` sides. */
export function damroll(n: number, s: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += rng.int(1, s);
  return t;
}
/** Angband's randint0: 0..n-1. */
export function randint0(n: number): number { return n <= 1 ? 0 : Math.floor(rng.next() * n); }
/** Angband's randint1: 1..n. */
export function randint1(n: number): number { return n <= 1 ? 1 : 1 + Math.floor(rng.next() * n); }
/** Angband's one_in_(n). */
export function oneIn(n: number): boolean { return randint0(n) === 0; }
/** Normal-ish distribution around `mean` with standard deviation `sd` (Angband's randnor). */
export function randnor(mean: number, sd: number): number {
  let s = 0;
  for (let i = 0; i < 4; i++) s += rng.next();
  return Math.round(mean + (s - 2) * sd * 1.15);
}
/** Angband's m_bonus: a level-scaled random bonus up to `max`. */
export function mBonus(max: number, level: number, maxLevel = 100): number {
  if (level > maxLevel) level = maxLevel;
  const bonus = Math.floor(max * level / maxLevel);
  const extra = (max * level) % maxLevel;
  const stand = Math.max(1, Math.floor(max / 4));
  let b = bonus + (randint0(maxLevel) < extra ? 1 : 0);
  const v = randnor(0, stand);
  b += v;
  return Math.max(0, Math.min(max, b));
}
export function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
export function chebyshev(x0: number, y0: number, x1: number, y1: number): number { return Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); }
/** Angband's distance(): Chebyshev with a diagonal correction. */
export function distance(x0: number, y0: number, x1: number, y1: number): number {
  const ax = Math.abs(x1 - x0), ay = Math.abs(y1 - y0);
  return ax > ay ? ax + (ay >> 1) : ay + (ax >> 1);
}
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = randint0(i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr;
}
/** Pick by weight from a list. */
export function weightedPick<T>(items: T[], weight: (t: T) => number): T | undefined {
  let total = 0;
  for (const it of items) total += weight(it);
  if (total <= 0) return undefined;
  let r = rng.next() * total;
  for (const it of items) { r -= weight(it); if (r < 0) return it; }
  return items[items.length - 1];
}
export function capitalize(s: string): string { return s.length ? s[0].toUpperCase() + s.slice(1) : s; }
export function plural(n: number, s: string): string {
  if (n === 1) return s;
  if (/(s|x|ch|sh)$/.test(s)) return s + 'es';
  if (/[^aeiou]y$/.test(s)) return s.slice(0, -1) + 'ies';
  return s + 's';
}
