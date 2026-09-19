// Named palettes and colour helpers. Palette shape: { skin, hair, primary, secondary, accent, metal, dark, glow }.
//
// That header line, and every helper below it, is byte-identical in Aether & Brass's and Foodie Truck's
// src/art/palettes.js (verified: lines 1-45 of both files diff clean). Only the helpers and the shape are
// shared. The values are not, and they do not come here: the named palettes (`PALETTES`, `getPalette`) and the
// environment ladder (`ENV`) are per-game data -- steampunk brass, soot and lamp-light in one game, a
// countryside sky/grass/timber ladder in the other -- and stay in each game. See
// docs/EXTRACTION_CANDIDATES.md: "ship the schema, the helpers and the contract; the palettes stay in each game."

/** The three channels `hexToRgb` returns, each 0..255. Arithmetic on them may leave the range; `rgbToHex` clamps and rounds. */
export type Rgb = [number, number, number];

/**
 * Any object that maps slot names to colours: a `Palette`, or a game's own `ENV` ladder. `shadePalette` and
 * `farPalette` take one of these and rewrite only the values that are strings beginning with '#', which is why
 * the value type admits more than a hex string -- anything else is passed through untouched.
 */
export interface ColorMap {
  [key: string]: string | undefined;
}

/**
 * The palette shape both games agree on. The eight required slots are the contract; what they mean is per-game
 * (Aether & Brass: `skin` is skin and `hair` is hair; Foodie Truck: `skin` is fur and `hair` is dark fur /
 * markings / brows). The named extras below are Foodie Truck's critter slots, and the index signature -- from
 * `ColorMap` -- is for the rest: a game adds its own keys (Aether & Brass uses `rank`, `iron`, `bronze`, `rod`,
 * `joint`) precisely so `farPalette` darkens them on the far side too, which a module constant would not get.
 */
export interface Palette extends ColorMap {
  /** Skin; fur, in a game whose cast is animals. */
  skin: string;
  /** Hair; dark fur, markings and brows on a critter. */
  hair: string;
  /** The main garment: coat, chassis, apron. */
  primary: string;
  /** The second garment mass: trousers, thighs, legs. */
  secondary: string;
  /** Trims, claws, hat bands, bells. */
  accent: string;
  /** Bright worked metal: steel, brass rods, ball joints. */
  metal: string;
  /** The darkest slot: boots, foot plates, a nose. */
  dark: string;
  /** Emissive: boiler fire, eyes, sparks. */
  glow: string;
  /** Light fur -- muzzle, belly, inner ear, paw pads (Foodie Truck's critters). */
  belly?: string;
  /** The hip block (Foodie Truck's critters). */
  shorts?: string;
  /** Sleeve colour. Both games' `buildRig` fills this from `primary` when it is absent. */
  sleeve?: string;
}

/** Parse '#rgb' / '#rrggbb' to [r,g,b]. */
export function hexToRgb(hex: string): Rgb {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** [r,g,b] to '#rrggbb'. */
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
/** Multiply a colour's brightness (f < 1 darker, > 1 lighter). */
export function shade(hex: string, f: number): string { const [r, g, b] = hexToRgb(hex); return rgbToHex(r * f, g * f, b * f); }
/** Mix two colours by t. */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
/** 'rgba(...)' string with alpha. */
export function rgba(hex: string, a: number): string { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
/** Return a new palette with every colour shaded by f (used for far limbs). */
export function shadePalette<P extends ColorMap>(p: P, f: number): P {
  const o: ColorMap = {};
  for (const k of Object.keys(p)) o[k] = typeof p[k] === 'string' && p[k][0] === '#' ? shade(p[k], f) : p[k];
  return o as P; // every key of p, copied or shaded: the result is a P. Type-level only.
}
/**
 * Darken AND desaturate a colour (far-side limbs): brightness x f, then pulled `desat` (0..1) toward its own grey,
 * with a slight cool cast so far parts sit behind the near ones instead of merging with them.
 */
export function farShade(hex: string, f: number, desat: number = 0.25): string {
  const [r, g, b] = hexToRgb(hex);
  const L = (r * 0.3 + g * 0.59 + b * 0.11) * f;
  const rr = r * f, gg = g * f, bb = b * f;
  return rgbToHex(rr + (L - rr) * desat, gg + (L - gg) * desat, bb + (L - bb) * desat + 6);
}
/** Far-limb palette: every colour through farShade (readability pass: far limbs ~35-40 % darker and greyer). */
export function farPalette<P extends ColorMap>(p: P, f: number = 0.62, desat: number = 0.25): P {
  const o: ColorMap = {};
  for (const k of Object.keys(p)) o[k] = typeof p[k] === 'string' && p[k][0] === '#' ? farShade(p[k], f, desat) : p[k];
  return o as P; // every key of p, copied or shaded: the result is a P. Type-level only.
}
