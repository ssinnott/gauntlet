// Generic humanoid paper-doll rig (ARCHITECTURE.md section 4), rendered as a chunky cel-shaded pixel sprite.
// Local space: authored facing right, origin at the feet centre, y negative = up. Angles in degrees:
// limb 0 = hanging down, positive = swings forward (toward facing). torso/head positive = lean forward.
//
// Rendering rules (see art/shading.js): 1px near-black outline, 3-tone cel bands with a top-left light, joints
// snapped to the DEVICE pixel grid at any rig scale, optional per-rig secondary-motion chains (art/secondary.js)
// and weapon smear arcs.
// Public API (backward compatible): buildRig, drawRig, jointScreen, computeJoints, markFull, DEFAULT_PROPORTIONS.
// New build fields (all optional): outlineWidth (default 1), shading (false = flat fills), ramp {hi, sh, rim},
// snap (false = no device-grid snapping), smearColor, hairStyle ('short'|'bald'), jaw, face { noMouth, eyeY, pupil, brow }.
// New proportions: bulge (0..1 limb taper, default 0.5), neckR. New weapon fields: twoHanded + grip (px along the
// weapon where the far hand goes, negative = behind the near hand toward the pommel; the far arm is solved with 2-bone
// IK when pose.grip > 0 and its fist is drawn on the handle at the joint it actually reached), headAt (px from the near
// hand to the weapon-head centre, used by the tools/sheet.js pose audit).
// New part hooks: parts.beard (after the face, in head space), parts.hair (replaces the default hair cap), parts.neck,
// parts.shoulder (at the shoulder joint, torso space, over the upper arm), parts.smear.
// LIMB SPACE (parts.armUpper / armLower / legUpper / legLower): origin at the segment's own joint (shoulder, elbow,
// hip, knee) and +Y ALONG THE BONE toward the next joint — a segment is drawn from (0, 0) to (0, info.len), and a
// band across it is w = 2r wide on x by a few px tall on y. It is NOT +x: this space is entered at -limbAngle, and
// only hand space (entered at -handAngle + 90) and foot space put +x along the part. A hook that draws its segment
// along +x lays the bone across the joint instead of down it, and the limb comes apart in every pose but a horizontal
// one — see the git history of pip.js, where all four limbs were authored that way.
// Readability knobs (all optional, defaults tuned for the 2x display): farShade (0.62) + farDesat (0.25) build
// rig.paletteFar (far limbs ~40 % darker and greyer); contactShadow (true = alpha 0.3, or a number, or false) draws a
// 1 px translucent dark capsule under every limb (near limbs over the torso, far limbs over the back layer) so a limb
// separates from what it crosses; thinR (6.5) is the radius below which cel parts get two tones instead of three,
// hiMin (10) the smallest clipped shape that still gets a highlight cap, flatR (5) the flat-tone floor — that triple is
// the DEFAULT shading profile (shading.ts's THIN_R / HI_MIN / FLAT_R), not any one game's: a game whose sprites are
// smaller or less chunky supplies its own through build.thinR / build.hiMin / build.flatR, and 4 / 6 / 2.5 is the
// other profile in use today; tones: 2
// drops highlight caps altogether (rimRect / rimTop then carry the light); palette.sleeve colours the upper arms + cuffs
// separately from palette.primary (torso) so arms read against the body. Pose key `weaponBack` (stepped 0/1) draws the
// weapon in the back layer (rested on the shoulder, slung) — the near arm then draws no weapon in front.
// rig.tick counts drawRig calls (procedural effects: chimney puffs, lens flicker); rig.chainFrame is an alias.
import { rad } from '../engine/math.ts';
import { farPalette } from './palettes.ts';
import type { Palette } from './palettes.ts';
import { SCRATCH_POSE, copyPose } from './poses.ts';
import type { PartialPose, Pose } from './poses.ts';
import { LIGHT_X, LIGHT_Y, RAMP, tones, celTaper, contactCapsule } from './shading.ts';
import type { LightDir, Ramp, Tones } from './shading.ts';
import { drawLimbSegs, limbRadii, drawFist, drawBoot, drawTorsoShape, drawBelt, drawNeck, drawSkull, drawFace, drawStick } from './rigParts.ts';
import type { FaceOpts, Info, PartHook, PartRig, Point } from './rigParts.ts';
import { stepChain, resetChain } from './secondary.ts';
import type { ChainRig } from './secondary.ts';

// ---------- the public contract: what a rig is built FROM and what a rig IS ----------

/** The rig's measurements at scale 1, in px (see DEFAULT_PROPORTIONS for the reference values). */
export interface Proportions {
  /** Head radius. */
  headR: number;
  /** Neck length, from the neck joint to the base of the skull. */
  neck: number;
  /** Torso width at the shoulders. */
  torsoW: number;
  /** Torso height, hip centre to shoulder line. */
  torsoH: number;
  /** Hip-block width. */
  hip: number;
  /** Shoulder-to-elbow length. */
  upperArm: number;
  /** Elbow-to-wrist length. */
  lowerArm: number;
  /** Hand (fist) radius. */
  handR: number;
  /** Hip-to-knee length. */
  upperLeg: number;
  /** Knee-to-ankle length. */
  lowerLeg: number;
  /** Foot length, ankle to toe. */
  footL: number;
  /** Arm radius at the shoulder (the forearm is this + 0.5). */
  armR: number;
  /** Leg radius at the hip (the shin is this - 0.5). */
  legR: number;
  /** Foot height, ankle to sole. */
  footH: number;
  /** Half the shoulder separation: the near shoulder sits at +this, the far one at -this - 2. */
  shoulderX: number;
  /** Half the hip separation: the near hip sits at +this, the far one at -this. */
  hipX: number;
  /** 0..1 limb taper: how much wider a limb is at its root than at its tip (see rigParts.limbRadii). */
  bulge: number;
  /** Neck radius. */
  neckR: number;
}

/** Reference proportions at scale 1 (~72-76 px tall). */
export const DEFAULT_PROPORTIONS: Readonly<Proportions> = Object.freeze({
  headR: 9, neck: 3, torsoW: 22, torsoH: 26, hip: 18, upperArm: 13, lowerArm: 12, handR: 4, upperLeg: 15, lowerLeg: 15, footL: 10,
  armR: 4.5, legR: 5.5, footH: 5, shoulderX: 2, hipX: 4, bulge: 0.5, neckR: 3.5,
});

/** A custom renderer for a weapon or an accessory, called in the space rig.ts has already entered for it. */
export type RigDraw = (ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose) => void;

/** The hand a weapon or a hand-attached accessory hangs off. 'handR' is the NEAR hand (see poses.ts). */
export type HandName = 'handR' | 'handL';

/** Where an accessory is drawn: a joint space rig.ts enters for it, or 'root' for the rig's own space. */
export type AccessoryAttach = 'head' | 'torso' | 'back' | 'hip' | HandName | 'root';

/** The weapon a rig carries (`build.weapon`), drawn in hand space with +x along the blade. */
export interface RigWeapon {
  /** Which hand holds it; anything but 'handL' is the near hand. */
  attach?: HandName;
  /** Length in px along the blade from the hand (default 30). */
  length?: number;
  /** Two-handed: the far arm reaches for the grip with 2-bone IK, blended by pose.grip. */
  twoHanded?: boolean;
  /** px along the weapon where the far hand goes, negative = behind the near hand toward the pommel (default 12). */
  grip?: number;
  /** px from the near hand to the weapon-head centre, used by the tools/sheet.js pose audit. */
  headAt?: number;
  /** Custom renderer (hand space, +x along the blade); falls back to parts.weapon, then to drawStick. */
  draw?: RigDraw;
}

/** One accessory (`build.accessories`): a hat, a satchel, a boiler, a coat tail. */
export interface RigAccessory {
  /** The space it is drawn in (default 'torso'). 'head' accessories are drawn with the head. */
  attach?: AccessoryAttach;
  /** 'back' puts it in the back layer whatever it is attached to. */
  layer?: 'back' | 'front';
  /** Its renderer, called in the attached space. */
  draw: RigDraw;
}

/**
 * The part-hook table (`build.parts`): a renderer per part name, each called in that part's own local space (see
 * the LIMB SPACE note at the top of this file). Every name here is one rig.ts actually calls; a hook under any
 * other key would never run. A game that wants more extends this interface rather than widening it.
 */
export interface RigParts {
  /** Hip to knee, limb space. */
  legUpper?: PartHook<Rig>;
  /** Knee to ankle, limb space. */
  legLower?: PartHook<Rig>;
  /** Foot / boot, ankle space (+x toward the toe). */
  foot?: PartHook<Rig>;
  /** Shoulder to elbow, limb space. */
  armUpper?: PartHook<Rig>;
  /** Elbow to wrist, limb space. */
  armLower?: PartHook<Rig>;
  /** Fist, hand space (+x along the forearm). */
  hand?: PartHook<Rig>;
  /** At the shoulder joint, torso space, over the upper arm. */
  shoulder?: PartHook<Rig>;
  /** The weapon, hand space; only consulted when build.weapon has no draw of its own. */
  weapon?: PartHook<Rig>;
  /** Torso space, origin at the hip centre. */
  torso?: PartHook<Rig>;
  /** Neck, entered at the head angle. */
  neck?: PartHook<Rig>;
  /** Hip block, hip space. */
  hips?: PartHook<Rig>;
  /** Skull, head space. */
  head?: PartHook<Rig>;
  /** Replaces the default hair cap, head space. */
  hair?: PartHook<Rig>;
  /** Face, head space. */
  face?: PartHook<Rig>;
  /** After the face, head space. */
  beard?: PartHook<Rig>;
  /** After the beard, head space. */
  hat?: PartHook<Rig>;
  /** Back layer, torso space (behind every body part). */
  back?: PartHook<Rig>;
  /** Replaces the default weapon smear arc, root space. */
  smear?: PartHook<Rig>;
}

/**
 * What buildRig accepts. Every field is optional: `buildRig()` is a valid, drawable rig.
 *
 * A game carries its own data on the build too (a clan, a kit, a spec its part hooks read back off `rig.build`);
 * it declares `interface GoblinBuild extends RigBuild { clan: Clan }` and, where its hooks need to see it,
 * `interface GoblinRig extends Rig { build: GoblinBuild }` — the same move rigParts.ts's `PartHook<R>` exists for.
 * This interface stays closed so a misspelled `outlineWidth` is still an error.
 *
 * The four SkullOpts fields (jaw, hairStyle, noHair, noNose) are here because the whole build is handed to
 * drawSkull as its options object.
 */
export interface RigBuild {
  /** Overrides for any of DEFAULT_PROPORTIONS. */
  proportions?: Partial<Proportions>;
  /**
   * Palette overrides, merged over `basePalette`. A game's own named palettes live in the game (see palettes.ts),
   * so a partial palette here needs `basePalette` to fill the slots it leaves out.
   */
  palette?: Partial<Palette>;
  /**
   * LIBRARY SEAM: the palette `palette` is merged over. In both games this was `PALETTES.hero`, read straight out
   * of the game's own palettes.js — which a library cannot import, because the schema is shared and the VALUES are
   * per-game (docs/EXTRACTION_CANDIDATES.md: "ship the schema, the helpers and the contract; the palettes stay in
   * each game"). A game passes its `getPalette(name)` here and gets exactly the old two-level merge back.
   */
  basePalette?: Palette;
  /** Rig scale (default 1); multiplied by the draw scale to give the device-pixel grid joints snap on. */
  scale?: number;
  /** Contact shadows under the limbs: true = alpha 0.3, a number = that alpha, false = off (the default). */
  contactShadow?: boolean | number;
  /** Far-limb brightness factor (default 0.62). */
  farShade?: number;
  /** Far-limb desaturation, 0..1 (default 0.25). */
  farDesat?: number;
  /** Radius below which cel parts get two tones instead of three (default: shading.ts's THIN_R). */
  thinR?: number;
  /** Smallest clipped shape that still gets a highlight cap (default: shading.ts's HI_MIN). */
  hiMin?: number;
  /** Radius below which a part is one flat tone (default: shading.ts's FLAT_R). */
  flatR?: number;
  /** 2 drops every highlight cap; anything else leaves the 3-tone ramp alone. */
  tones?: number;
  /** Outline colour (default '#1a1018'). */
  outline?: string;
  /** Outline width in DEVICE px (default 1); drawRig divides it by the draw scale. */
  outlineWidth?: number;
  /** Per-part renderers (see RigParts). */
  parts?: RigParts;
  /** Accessories, drawn in their attached spaces. */
  accessories?: RigAccessory[];
  /** The weapon this rig carries. */
  weapon?: RigWeapon | null;
  /** false = flat fills, outline only, no cel bands. */
  shading?: boolean;
  /** Overrides for the tone ramp factors { hi, sh, rim }. */
  ramp?: Partial<Ramp>;
  /** false = no device-grid snapping (portraits and props that are not on the pixel grid). */
  snap?: boolean;
  /** Smear-arc colour (default: the palette's metal). */
  smearColor?: string | null;
  /** Default hair style, 'short' | 'bald' (default 'short'). */
  hairStyle?: string;
  /** Jaw width as a fraction of the head radius (drawSkull's default is 0.35). */
  jaw?: number;
  /** Options for the default face renderer (`rig.faceOpts`). */
  face?: FaceOpts | null;
  /** drawSkull pass-through: draw no hair cap. */
  noHair?: boolean;
  /** drawSkull pass-through: draw no nose bump, for rigs that draw their own. */
  noNose?: boolean;
}

/** The three angles of one leg in root space, degrees (0 = hanging down, positive = forward). */
export interface LegAngles {
  /** Thigh angle. */
  upper: number;
  /** Shin angle (absolute, not relative to the thigh). */
  lower: number;
  /** Foot angle (absolute). */
  foot: number;
}

/** The three angles of one arm in root space, degrees (0 = hanging down, positive = forward). */
export interface ArmAngles {
  /** Upper-arm angle, including the torso lean. */
  upper: number;
  /** Forearm angle (absolute). */
  lower: number;
  /** Hand angle (absolute). */
  hand: number;
}

/**
 * Every joint computeJoints solves, in ROOT space (before the root offset and rotation drawRig applies).
 * The 'N' suffix is the NEAR side of a pair and 'F' the far side, matching poses.js's armR/armL convention.
 * The point objects are reused every frame — read them, never retain them.
 */
export interface Joints {
  hipN: Point;
  hipF: Point;
  kneeN: Point;
  kneeF: Point;
  ankleN: Point;
  ankleF: Point;
  legN: LegAngles;
  legF: LegAngles;
  /** Torso pivot, at the hip centre. */
  torso: Point;
  /** Torso lean in degrees (pose.torso.rot). */
  torsoAngle: number;
  shoulderN: Point;
  shoulderF: Point;
  elbowN: Point;
  elbowF: Point;
  wristN: Point;
  wristF: Point;
  handN: Point;
  handF: Point;
  armN: ArmAngles;
  armF: ArmAngles;
  neck: Point;
  head: Point;
  /** Head angle in degrees (torso lean + pose.head.rot). */
  headAngle: number;
  /** Tip of the weapon, root space. */
  weaponTip: Point;
  /** Weapon angle in degrees as a limb angle (0 = down, 90 = forward, 180 = up). */
  weaponAngle: number;
  /** The point on a two-handed weapon the far hand reaches for. */
  grip: Point;
  /** Top of the head (head.y - headR): the rig's silhouette ceiling. */
  top: number;
}

/**
 * The root transform of the last drawRig call, kept so jointScreen can map a joint into screen space without
 * re-deriving it. One object per rig, rewritten in place.
 */
export interface RigTransform {
  /** Screen x of the feet, rounded. */
  x: number;
  /** Screen y of the feet, rounded. */
  y: number;
  /** x scale: facing * draw scale * squash. */
  fs: number;
  /** y scale: draw scale * stretch. */
  ss: number;
  /** pose.root.x, snapped to the device grid on a snapping rig. */
  rx: number;
  /** pose.root.y, snapped to the device grid on a snapping rig. */
  ry: number;
  /** cos of pose.root.rot. */
  c: number;
  /** sin of pose.root.rot. */
  s: number;
}

/**
 * A built rig: everything drawRig, the default part renderers and a game's own part hooks read.
 *
 * It extends `PartRig` (and so `ShadeTarget`) on purpose rather than by luck: those are the structural contracts
 * shading.ts and rigParts.ts state, and declaring the extension here is what makes "a Rig can be shaded" a
 * compile-time fact instead of a convention. `ChainRig` is secondary.js's one-field view of the same object.
 *
 * Nothing on a rig is reallocated per frame — the joints, the transform, the light and the part-info object are
 * all rewritten in place, which is why so much of this is mutable.
 */
export interface Rig extends PartRig, ChainRig {
  /** The build description this rig was made from, kept so hooks can read their own fields back off it. */
  build: RigBuild;
  /** Rig scale (build.scale). */
  scale: number;
  /** Resolved proportions: DEFAULT_PROPORTIONS with build.proportions merged over it. */
  p: Proportions;
  /** The near-side palette. */
  palette: Palette;
  /** The far-side palette: every colour through farShade (darker and greyer). */
  paletteFar: Palette;
  /** Contact-shadow alpha under near limbs (0 = off). */
  contactAlpha: number;
  /** Per-rig THIN_R override; null = shading.ts's default. */
  thinR: number | null;
  /** Per-rig HI_MIN override; null = shading.ts's default. */
  hiMin: number | null;
  /** Per-rig FLAT_R override; null = shading.ts's default. */
  flatR: number | null;
  /** 2 on a build.tones: 2 rig, 3 otherwise. */
  tonesN: number;
  /** Outline colour. */
  outline: string;
  /** Outline half-width in the CURRENT space: build.outlineWidth divided by the draw scale. */
  ow: number;
  /** The part-hook table (build.parts, or {}). */
  parts: RigParts;
  /** The accessories (build.accessories, or []). */
  accessories: RigAccessory[];
  /** The weapon, or null. */
  weapon: RigWeapon | null;
  /** y of the hip line in root space (negative = above the feet). */
  hipY: number;
  /** Total height in rig px, feet to the top of the head. */
  height: number;
  /** Torso width in rig px. */
  width: number;
  /** The solved joints of the last computeJoints call. */
  joints: Joints;
  /** Flash colour replacing every fill while it is set (drawRig sets it), else null. */
  override: string | null;
  /** 1 = facing right, -1 = facing left, from the last drawRig call. */
  facing: number;
  /** The root transform of the last drawRig call. */
  tf: RigTransform;
  /** Reusable info object passed to part hooks; do not retain it. */
  partInfo: Info;
  /** Colour helper for hooks: returns the flash override when active, else the colour. */
  col(hex: string): string;
  /** false on a build.shading: false rig. */
  shading: boolean;
  /** Tone ramp factors: RAMP with build.ramp merged over it. */
  ramp: Ramp;
  /** Per-rig tone cache, keyed by colour. */
  tones: Map<string, Tones>;
  /** false on a build.snap: false rig: no device-grid snapping. */
  snap: boolean;
  /** Device-pixel scale of the last drawRig call ((o.scale || 1) * rig.scale). */
  pxScale: number;
  /** Unit vector toward the light in the CURRENT part space (updated by enter/leave). */
  light: LightDir;
  /** Smear-arc colour, or null for the palette's metal. */
  smearColor: string | null;
  /** Default hair style ('short' | 'bald'). */
  hairStyle: string;
  /** Jaw width as a fraction of the head radius, or undefined for drawSkull's own default. */
  jaw: number | undefined;
  /** Options for the default face renderer (build.face). */
  faceOpts: FaceOpts | null;
  /** drawRig calls so far (procedural effects: chimney puffs, lens flicker). */
  tick: number;
  /** Alias of tick. */
  chainFrame: number;
  /** Unused by rig.ts; kept for content that caches the pose it last drew. */
  lastPose: Pose | null;
}

/** A pose markFull() has stamped: drawRig hands it straight to computeJoints instead of resolving it. */
export type FullPose = Pose & { readonly __full: true };

/** What drawRig accepts: a partial pose, resolved against DEFAULT_POSE, or one markFull() has already stamped. */
export type DrawPose = FullPose | (PartialPose & { readonly __full?: undefined });

/**
 * Is this pose already complete, so `drawRig` can use it directly instead of copying it into the
 * scratch pose?
 *
 * Written as a type predicate rather than an inline `pose.__full` test on purpose. Narrowing a
 * union through an OPTIONAL discriminant only works when `strictNullChecks` is on, and this library
 * is consumed by two games that are mid-migration and still compile with `strict: false`. A
 * predicate narrows identically under both, so the library typechecks in its consumers' configs
 * rather than only in its own. (Found exactly this way: rig.ts was clean under the library's strict
 * config and reported four errors under Foodie Truck's.)
 */
export function isFullPose(pose: DrawPose): pose is FullPose { return pose.__full === true; }

/** The per-draw options of drawRig (`o`). */
export interface DrawRigOpts {
  /** Screen x of the feet. */
  x: number;
  /** Screen y of the feet. */
  y: number;
  /** 1 = facing right (default), -1 = facing left. */
  facing?: number;
  /** Tint colour composited over the silhouette (goes through the offscreen). */
  tint?: string | null;
  /** Tint strength (default 0.5). */
  tintAlpha?: number;
  /** Hit flash: the whole rig in white (goes through the offscreen). */
  flash?: boolean;
  /** Multiplied into the context's globalAlpha. */
  alpha?: number;
  /** Draw scale, multiplied by the rig's own. */
  scale?: number;
  /** false skips the secondary-motion step. */
  secondary?: boolean;
  /** true skips the secondary-motion step. */
  still?: boolean;
}

/** Far-limb darkening (brightness factor) and desaturation; build.farShade / build.farDesat override. */
const FAR_SHADE = 0.62, FAR_DESAT = 0.25;
/**
 * Default contact-shadow alpha (build.contactShadow: true | false | number). OFF by default: the translucent dark
 * capsule under every limb segment was eight extra marks per keyframe whose whole job was to separate a limb from
 * what it crosses — which a 1 px outline that actually lands on the pixel grid now does on its own, without the
 * soft grey haze. A rig that genuinely needs it can still set build.contactShadow: true (or a number).
 */
const CONTACT_ALPHA = 0;
// Flash / tint offscreen: must contain every rig pose (Regent Engine at scale 2.4 spans x -205..165, y -267..162 around the feet;
// dodge rolls rotate the body below the feet line), otherwise hit flashes render as clipped silhouettes.
const OFF_W = 480, OFF_H = 480, OFF_OX = 240, OFF_OY = 300;
let offCanvas: HTMLCanvasElement | null = null, offCtx: CanvasRenderingContext2D | null = null;
function getOffscreen(): CanvasRenderingContext2D {
  if (!offCanvas) { offCanvas = document.createElement('canvas'); offCanvas.width = OFF_W; offCanvas.height = OFF_H; offCtx = offCanvas.getContext('2d'); }
  return offCtx!;
}

/**
 * A limb root pushed `d` px along the limb, so the wide end of the tube ends up INSIDE the body instead of butting
 * against its edge. A limb whose root sits exactly on the silhouette reads as bolted on; one that starts a little
 * way inside reads as attached, because the torso overlaps it the way a shoulder overlaps an arm.
 * Two scratch objects, alternating, because both limbs of a pair are live at once and this file allocates nothing.
 */
const SUNK: [Point, Point] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
let sunkFlip = 0;
function sunk(a: Point, b: Point, d: number): Point {
  if (!d) return a;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const o = SUNK[(sunkFlip = 1 - sunkFlip)];
  o.x = a.x + dx / len * d; o.y = a.y + dy / len * d;
  return o;
}

const pt = (): Point => ({ x: 0, y: 0 });
function makeJoints(): Joints {
  return {
    hipN: pt(), hipF: pt(), kneeN: pt(), kneeF: pt(), ankleN: pt(), ankleF: pt(), legN: { upper: 0, lower: 0, foot: 0 }, legF: { upper: 0, lower: 0, foot: 0 },
    torso: pt(), torsoAngle: 0, shoulderN: pt(), shoulderF: pt(), elbowN: pt(), elbowF: pt(), wristN: pt(), wristF: pt(),
    handN: pt(), handF: pt(), armN: { upper: 0, lower: 0, hand: 0 }, armF: { upper: 0, lower: 0, hand: 0 },
    neck: pt(), head: pt(), headAngle: 0, weaponTip: pt(), weaponAngle: 0, grip: pt(), top: 0,
  };
}

/**
 * The joints read by a computed key — J['hip' + side], J['leg' + side], J['arm' + far]. `strict` only allows an
 * index access through a type that HAS an index signature, so the walks below take one of these views of the very
 * same object. Type-level only: no copy, no conversion, nothing that runs.
 */
type PointsByName = Record<string, Point>;
type LegAnglesBySide = Record<string, LegAngles>;
type ArmAnglesBySide = Record<string, ArmAngles>;

/**
 * Precompute a rig from a build description (see ARCHITECTURE.md section 4 for the build shape).
 * @returns rig with { build, scale, p (proportions), palette, paletteFar, outline, ow, joints, height, width, col(hex), tones, chains, light }
 */
export function buildRig(build: RigBuild = {}): Rig {
  const p = { ...DEFAULT_PROPORTIONS, ...(build.proportions || {}) };
  // `as Palette`: the eight slots are the contract a build has to satisfy BETWEEN basePalette and palette (see
  // RigBuild.basePalette), and TypeScript cannot see across the merge of two partials. The alternative — a
  // library-owned default palette — would be exactly the per-game colour data palettes.ts refuses to hold.
  const palette = { ...(build.basePalette || {}), ...(build.palette || {}) } as Palette;
  const hipY = -(p.upperLeg + p.lowerLeg + p.footH - 2);
  if (!palette.sleeve) palette.sleeve = palette.primary;
  const cs = build.contactShadow;
  const rig: Rig = {
    build, scale: build.scale || 1, p, palette,
    paletteFar: farPalette(palette, build.farShade != null ? build.farShade : FAR_SHADE, build.farDesat != null ? build.farDesat : FAR_DESAT),
    /** Contact-shadow alpha under near limbs (0 = off). */
    contactAlpha: cs === false ? 0 : cs === true ? 0.3 : typeof cs === 'number' ? cs : CONTACT_ALPHA,
    /** Shading budget (see shading.js): thinR = radius below which cel parts get 2 tones; hiMin = smallest half-extent
     *  of a clipped shape that gets a highlight cap; flatR = radius below which a part is one flat tone; tonesN = 2
     *  (build.tones: 2) drops every highlight cap so the only light marks are explicit rimRect / rimTop rims. */
    thinR: build.thinR != null ? build.thinR : null, hiMin: build.hiMin != null ? build.hiMin : null, flatR: build.flatR != null ? build.flatR : null,
    tonesN: build.tones === 2 ? 2 : 3,
    outline: build.outline || '#1a1018', ow: build.outlineWidth != null ? build.outlineWidth : 1,
    parts: build.parts || {}, accessories: build.accessories || [], weapon: build.weapon || null,
    hipY, height: (-(hipY) + p.torsoH - 2 + p.neck + p.headR * 2), width: p.torsoW,
    joints: makeJoints(), override: null, facing: 1,
    tf: { x: 0, y: 0, fs: 1, ss: 1, rx: 0, ry: 0, c: 1, s: 0 },
    /** Reusable info object passed to part hooks ({ name, far, pal, len, r, color, w, h }); do not retain it. */
    // `pal` starts null, exactly as rigParts.ts's `Info` documents: info() fills it before any hook ever sees it.
    partInfo: { name: '', far: false, pal: null as unknown as Palette, len: 0, r: 0, color: '', w: 0, h: 0, length: 0 },
    /** Colour helper for hooks: returns the flash override when active, else the colour. */
    col(hex: string): string { return rig.override || hex; },
    // ---- shading / pixel-sprite state ----
    shading: build.shading !== false, ramp: { ...RAMP, ...(build.ramp || {}) }, tones: new Map(), snap: build.snap !== false,
    /**
     * Device-pixel scale of the last drawRig ((o.scale || 1) * rig.scale). Joints snap on THIS grid, not the rig's
     * local one — the game renders 1:1 into the 640x360 internal canvas and blits it at a whole-number scale, so
     * one internal pixel IS one sprite pixel and `sc` is the only scale between rig space and that grid.
     * Defaults to the rig's own scale so the six places that call computeJoints() outside a draw (portraits, the
     * heroes' import-time floor solve, the contact sheets, the invariant suite) snap on a sane grid rather than
     * on whatever the previous draw happened to leave behind.
     */
    pxScale: build.scale || 1,
    /** Unit vector toward the light in the CURRENT part space (updated by enter/leave). */
    light: { x: LIGHT_X, y: LIGHT_Y },
    smearColor: build.smearColor || null, hairStyle: build.hairStyle || 'short', jaw: build.jaw, faceOpts: build.face || null,
    /** Secondary-motion chains by name (art/secondary.js getChain). */
    chains: {}, tick: 0, chainFrame: 0, lastPose: null,
  };
  return rig;
}

const SIDES = ['N', 'F'];
const NOOP = (v: number): number => v;
// Snap to the DEVICE pixel grid: round(v * sc) / sc, where sc is rig.pxScale. Module scope (and so a mutable
// module-level grid) because computeJoints runs per rig per frame and is never re-entrant, and rig.js allocates
// nothing per draw.
let SNAP_G = 1;
const SNAP = (v: number): number => Math.round(v * SNAP_G) / SNAP_G;
function angLerp(a: number, b: number, t: number): number { let d = (b - a) % 360; if (d > 180) d -= 360; else if (d < -180) d += 360; return a + d * t; }

/** Compute joint positions (root space, before root offset/rotation) for a resolved pose into rig.joints. */
export function computeJoints(rig: Rig, pose: Pose): Joints {
  const p = rig.p, J = rig.joints, hipY = rig.hipY;
  const JP = J as unknown as PointsByName, JL = J as unknown as LegAnglesBySide, JA = J as unknown as ArmAnglesBySide;
  SNAP_G = rig.pxScale || 1;
  const S = rig.snap ? SNAP : NOOP;
  const ta = pose.torso.rot;
  // legs (attached to the hips, unaffected by torso lean)
  for (let i = 0; i < 2; i++) {
    const side = SIDES[i];
    const leg = side === 'N' ? pose.legR : pose.legL, foot = side === 'N' ? pose.footR : pose.footL;
    const hip = JP['hip' + side], knee = JP['knee' + side], ankle = JP['ankle' + side], ang = JL['leg' + side];
    // The hips were the one pair never put through S: they are authored as whole numbers, which looked snapped
    // while the grid was rig-local and is not on the device grid (hipX 4 at scale 0.85 lands on device x 3.4).
    hip.x = S(side === 'N' ? p.hipX : -p.hipX); hip.y = S(hipY);
    ang.upper = leg.upper; ang.lower = leg.upper + leg.lower; ang.foot = ang.lower * 0.35 + foot.rot;
    knee.x = S(hip.x + Math.sin(rad(ang.upper)) * p.upperLeg); knee.y = S(hip.y + Math.cos(rad(ang.upper)) * p.upperLeg);
    ankle.x = S(knee.x + Math.sin(rad(ang.lower)) * p.lowerLeg); ankle.y = S(knee.y + Math.cos(rad(ang.lower)) * p.lowerLeg);
  }
  // torso pivot at hip centre
  J.torso.x = S(pose.torso.x); J.torso.y = S(hipY + pose.torso.y); J.torsoAngle = ta;
  const c = Math.cos(rad(ta)), s = Math.sin(rad(ta));
  const tx = J.torso.x, ty = J.torso.y;
  const shY = -(p.torsoH - 5);
  J.shoulderN.x = S(tx + p.shoulderX * c - shY * s); J.shoulderN.y = S(ty + p.shoulderX * s + shY * c);
  J.shoulderF.x = S(tx + (-p.shoulderX - 2) * c - (shY + 1) * s); J.shoulderF.y = S(ty + (-p.shoulderX - 2) * s + (shY + 1) * c);
  const nY = -p.torsoH + 2;
  J.neck.x = S(tx - nY * s); J.neck.y = S(ty + nY * c);
  J.headAngle = ta + pose.head.rot;
  const hc = Math.cos(rad(J.headAngle)), hs = Math.sin(rad(J.headAngle));
  const hy = -(p.neck + p.headR) + pose.head.y, hx = pose.head.x;
  J.head.x = S(J.neck.x + hx * hc - hy * hs); J.head.y = S(J.neck.y + hx * hs + hy * hc);
  J.top = J.head.y - p.headR;
  // arms (relative to torso lean)
  for (let i = 0; i < 2; i++) {
    const side = SIDES[i];
    const arm = side === 'N' ? pose.armR : pose.armL, hand = side === 'N' ? pose.handR : pose.handL;
    const sh = JP['shoulder' + side], el = JP['elbow' + side], wr = JP['wrist' + side], hd = JP['hand' + side], ang = JA['arm' + side];
    ang.upper = ta + arm.upper; ang.lower = ang.upper + arm.lower; ang.hand = ang.lower + hand.rot;
    el.x = S(sh.x + Math.sin(rad(ang.upper)) * p.upperArm); el.y = S(sh.y + Math.cos(rad(ang.upper)) * p.upperArm);
    wr.x = S(el.x + Math.sin(rad(ang.lower)) * p.lowerArm); wr.y = S(el.y + Math.cos(rad(ang.lower)) * p.lowerArm);
    hd.x = S(wr.x + Math.sin(rad(ang.lower)) * p.handR * 0.6); hd.y = S(wr.y + Math.cos(rad(ang.lower)) * p.handR * 0.6);
  }
  // weapon tip. Hand space +x runs along the forearm and weapon.rot turns clockwise on screen, so the weapon's limb
  // angle (0 = down, 90 = forward, 180 = up) is the hand angle MINUS weapon.rot.
  if (rig.weapon) {
    const near = rig.weapon.attach !== 'handL';
    const hd = near ? J.handN : J.handF, a = (near ? J.armN.hand : J.armF.hand) - pose.weapon.rot;
    const len = rig.weapon.length || 30;
    J.weaponAngle = a;
    J.weaponTip.x = hd.x + Math.sin(rad(a)) * len; J.weaponTip.y = hd.y + Math.cos(rad(a)) * len;
    // two-handed grip: the far hand reaches for a point along the weapon (2-bone IK blended by pose.grip)
    const g = pose.grip;
    if (rig.weapon.twoHanded && g > 0) {
      const gd = rig.weapon.grip != null ? rig.weapon.grip : 12;
      const G = J.grip; G.x = hd.x + Math.sin(rad(a)) * gd; G.y = hd.y + Math.cos(rad(a)) * gd;
      const far = near ? 'F' : 'N';
      const sh = JP['shoulder' + far], el = JP['elbow' + far], wr = JP['wrist' + far], hf = JP['hand' + far], ang = JA['arm' + far];
      const L1 = p.upperArm, L2 = p.lowerArm;
      const dx = G.x - sh.x, dy = G.y - sh.y;
      const d = Math.min(L1 + L2 - 0.5, Math.max(Math.abs(L1 - L2) + 0.5, Math.hypot(dx, dy)));
      const th = Math.atan2(dx, dy) * 180 / Math.PI;
      const A = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))) * 180 / Math.PI;
      // pick the elbow that hangs lower (natural bend), then blend from the FK angles
      const u1 = th + A, u2 = th - A;
      const u = Math.cos(rad(u1)) >= Math.cos(rad(u2)) ? u1 : u2;
      const ex = sh.x + Math.sin(rad(u)) * L1, ey = sh.y + Math.cos(rad(u)) * L1;
      const lo = Math.atan2(G.x - ex, G.y - ey) * 180 / Math.PI;
      ang.upper = angLerp(ang.upper, u, g); ang.lower = angLerp(ang.lower, lo, g);
      el.x = S(sh.x + Math.sin(rad(ang.upper)) * L1); el.y = S(sh.y + Math.cos(rad(ang.upper)) * L1);
      wr.x = S(el.x + Math.sin(rad(ang.lower)) * L2); wr.y = S(el.y + Math.cos(rad(ang.lower)) * L2);
      // the hand stays attached to the wrist: it reaches toward the grip but never further than a hand length, so an
      // out-of-reach grip (authoring error, or a mid-swing lerp) shows a stretched arm instead of a floating fist
      let gx = G.x - wr.x, gy = G.y - wr.y;
      const gl = Math.hypot(gx, gy), gmax = p.handR * 0.6 + 1.5;
      if (gl > gmax) { gx *= gmax / gl; gy *= gmax / gl; }
      const fx = wr.x + Math.sin(rad(ang.lower)) * p.handR * 0.6, fy = wr.y + Math.cos(rad(ang.lower)) * p.handR * 0.6;
      hf.x = S(fx + (wr.x + gx - fx) * g); hf.y = S(fy + (wr.y + gy - fy) * g);
      ang.hand = ang.lower + (far === 'F' ? pose.handL.rot : pose.handR.rot);
    }
  }
  return J;
}

// ---------- local-space helpers (exported for content hooks that nest their own spaces) ----------
/** Push a local space (translate + rotate) and point rig.light at the light in that space. Pair with leave(). */
export function enter(ctx: CanvasRenderingContext2D, rig: Rig, x: number, y: number, angDeg?: number): void {
  ctx.save(); ctx.translate(x, y);
  if (angDeg) { ctx.rotate(rad(angDeg)); setLight(rig, angDeg); }
}
/** Pop a local space and restore the root-space light. */
export function leave(ctx: CanvasRenderingContext2D, rig: Rig): void { ctx.restore(); rig.light.x = LIGHT_X; rig.light.y = LIGHT_Y; }
/** Point rig.light at the light for a space rotated by `angDeg` from root (nested spaces: pass the total angle). */
export function setLight(rig: Rig, angDeg: number): void {
  const c = Math.cos(rad(angDeg)), s = Math.sin(rad(angDeg));
  rig.light.x = LIGHT_X * c + LIGHT_Y * s; rig.light.y = -LIGHT_X * s + LIGHT_Y * c;
}
/** Fill the rig's reusable part-info object handed to custom part hooks (never retained by hooks). */
function info(rig: Rig, name: string, far: boolean, pal: Palette, len: number, r: number, color: string, w?: number, h?: number): Info {
  const o = rig.partInfo;
  o.name = name; o.far = far; o.pal = pal; o.len = len; o.r = r; o.color = color; o.w = w; o.h = h; o.length = len;
  return o;
}

function drawLeg(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose, side: 'N' | 'F'): void {
  const J = rig.joints, p = rig.p, pal = side === 'N' ? rig.palette : rig.paletteFar, far = side === 'F';
  const JP = J as unknown as PointsByName, JL = J as unknown as LegAnglesBySide;
  const hip = JP['hip' + side], knee = JP['knee' + side], ankle = JP['ankle' + side], ang = JL['leg' + side];
  const hooks = rig.parts;
  contactCapsule(ctx, rig, hip.x, hip.y, knee.x, knee.y, p.legR); contactCapsule(ctx, rig, knee.x, knee.y, ankle.x, ankle.y, p.legR - 0.5);
  if (hooks.legUpper || hooks.legLower) {
    // A rig may hook one half of a limb and leave the other generic. The generic half is built from the SAME radius
    // profile the one-path limb uses, so the two halves meet at the knee without a step.
    const [rA, rB, rC] = limbRadii(p.legR, p.legR - 0.5, p.bulge);
    if (hooks.legUpper) { enter(ctx, rig, hip.x, hip.y, -ang.upper); hooks.legUpper(ctx, rig, pose, info(rig, 'legUpper', far, pal, p.upperLeg, p.legR, pal.secondary)); leave(ctx, rig); }
    else { const s0 = sunk(hip, knee, p.legR * 0.35); celTaper(ctx, rig, s0.x, s0.y, knee.x, knee.y, rA, rB, pal.secondary); }
    if (hooks.legLower) { enter(ctx, rig, knee.x, knee.y, -ang.lower); hooks.legLower(ctx, rig, pose, info(rig, 'legLower', far, pal, p.lowerLeg, p.legR - 1, pal.secondary)); leave(ctx, rig); }
    else celTaper(ctx, rig, knee.x, knee.y, ankle.x, ankle.y, rB, rC, pal.secondary);
  } else {
    // root sunk into the pelvis: the thigh starts under the hip block rather than on its edge
    drawLimbSegs(ctx, rig, sunk(hip, knee, p.legR * 0.35), knee, ankle, p.legR, p.legR - 0.5, pal.secondary, pal.secondary, false, p.bulge);
  }
  // foot / boot
  enter(ctx, rig, ankle.x, ankle.y, -ang.foot);
  if (hooks.foot) hooks.foot(ctx, rig, pose, info(rig, 'foot', far, pal, p.footL, 0, pal.dark, p.footL, p.footH));
  else drawBoot(ctx, rig, p.footL, p.footH, pal.dark, pal.accent);
  leave(ctx, rig);
}

/**
 * The fist (or the rig's `hand` hook) in hand space. Module scope, not a closure inside drawArm: this file
 * allocates nothing per draw. `skip` is the far hand of a two-handed grip, which the weapon arm draws on the
 * handle instead.
 */
function drawHandPart(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose, hooks: RigParts, pal: Palette, p: Proportions, far: boolean, skip: boolean | null | undefined): void {
  if (skip) return;
  if (hooks.hand) hooks.hand(ctx, rig, pose, info(rig, 'hand', far, pal, 0, p.handR, pal.skin));
  else drawFist(ctx, rig, p.handR, pal.skin);
}

function drawArm(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose, side: 'N' | 'F', withWeapon: boolean): void {
  const J = rig.joints, p = rig.p, pal = side === 'N' ? rig.palette : rig.paletteFar, far = side === 'F';
  const JP = J as unknown as PointsByName, JA = J as unknown as ArmAnglesBySide;
  const sh = JP['shoulder' + side], el = JP['elbow' + side], wr = JP['wrist' + side], hd = JP['hand' + side], ang = JA['arm' + side];
  const hooks = rig.parts, sleeve = pal.sleeve || pal.primary;
  contactCapsule(ctx, rig, sh.x, sh.y, el.x, el.y, p.armR); contactCapsule(ctx, rig, el.x, el.y, hd.x, hd.y, p.armR + 0.5);
  if (hooks.armUpper || hooks.armLower) {
    const [rA, rB, rC] = limbRadii(p.armR, p.armR + 0.5, p.bulge);
    if (hooks.armUpper) { enter(ctx, rig, sh.x, sh.y, -ang.upper); hooks.armUpper(ctx, rig, pose, info(rig, 'armUpper', far, pal, p.upperArm, p.armR, sleeve)); leave(ctx, rig); }
    else { const s0 = sunk(sh, el, p.armR * 0.45); celTaper(ctx, rig, s0.x, s0.y, el.x, el.y, rA, rB, sleeve); }
    if (hooks.armLower) { enter(ctx, rig, el.x, el.y, -ang.lower); hooks.armLower(ctx, rig, pose, info(rig, 'armLower', far, pal, p.lowerArm, p.armR - 0.5, pal.skin)); leave(ctx, rig); }
    else celTaper(ctx, rig, el.x, el.y, wr.x, wr.y, rB, rC, pal.skin);
  } else {
    // root sunk into the torso. Only the TUBE moves: the shoulder hook below still enters at the true joint, so a
    // rig's epaulette or pauldron stays where its author put it.
    drawLimbSegs(ctx, rig, sunk(sh, el, p.armR * 0.45), el, wr, p.armR, p.armR + 0.5, sleeve, pal.skin, true, p.bulge);
  }
  if (hooks.shoulder) { enter(ctx, rig, sh.x, sh.y, J.torsoAngle); hooks.shoulder(ctx, rig, pose, info(rig, 'shoulder', far, pal, 0, p.armR + 1, pal.accent)); leave(ctx, rig); }
  // hand space: +x along the forearm direction (plus hand.rot); weapons draw along +x.
  // pose.weaponBack: the weapon was already drawn in the back layer (drawWeaponBack), so the hand draws bare.
  const weaponHere = withWeapon && rig.weapon && !(pose.weaponBack > 0.5) && ((rig.weapon.attach !== 'handL') === (side === 'N'));
  // the far hand of a two-handed weapon is drawn on the handle (over the weapon) by the weapon arm instead
  const twoHanded = rig.weapon && rig.weapon.twoHanded && pose.grip > 0.5 && !(pose.weaponBack > 0.5);
  const handAng = -ang.hand + 90;
  enter(ctx, rig, hd.x, hd.y, handAng);
  if (weaponHere && twoHanded) {
    // the other hand, drawn under this fist and the weapon at its real joint position projected into weapon space
    // (exactly on the grip when the IK reached it; still attached to its arm when it did not)
    const other = side === 'N' ? J.handF : J.handN, palO = side === 'N' ? rig.paletteFar : rig.palette;
    const a = rad(J.weaponAngle), ca = Math.sin(a), sa = Math.cos(a); // cos/sin of the weapon-space rotation (90 - weaponAngle)
    const dx = other.x - hd.x, dy = other.y - hd.y;
    ctx.save(); ctx.rotate(rad(pose.weapon.rot)); setLight(rig, handAng + pose.weapon.rot);
    ctx.translate(dx * ca + dy * sa - p.handR * 0.5, -dx * sa + dy * ca);
    if (hooks.hand) hooks.hand(ctx, rig, pose, info(rig, 'hand', side === 'N', palO, 0, p.handR, palO.skin));
    else drawFist(ctx, rig, p.handR, palO.skin);
    ctx.restore(); setLight(rig, handAng);
  }
  if (weaponHere) {
    ctx.save(); ctx.rotate(rad(pose.weapon.rot)); setLight(rig, handAng + pose.weapon.rot);
    // `rig.weapon!`: weaponHere is false whenever rig.weapon is null, but the narrowing does not survive the alias
    // (rig.weapon is a mutable property — the games swap weapons through it, so it cannot be readonly either).
    if (rig.weapon!.draw) rig.weapon!.draw(ctx, rig, pose);
    else if (hooks.weapon) hooks.weapon(ctx, rig, pose, info(rig, 'weapon', far, pal, rig.weapon!.length || 30, 0, pal.metal));
    else drawStick(ctx, rig, rig.weapon!.length || 30, pal.metal, pal.dark);
    ctx.restore(); setLight(rig, handAng);
  }
  // The hand draws AFTER the weapon, so it closes around the grip instead of hiding behind it. A fist under its
  // own weapon is the single most common "why does that look wrong" in the cast: 692 px of hand disappeared.
  drawHandPart(ctx, rig, pose, hooks, pal, p, far, twoHanded && !weaponHere && withWeapon);
  leave(ctx, rig);
}

function drawTorso(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose): void {
  const J = rig.joints, p = rig.p, pal = rig.palette, hooks = rig.parts;
  enter(ctx, rig, J.torso.x, J.torso.y, J.torsoAngle);
  if (hooks.torso) hooks.torso(ctx, rig, pose, info(rig, 'torso', false, pal, 0, 0, pal.primary, p.torsoW, p.torsoH));
  else drawTorsoShape(ctx, rig, p.torsoW, p.torsoH, p.hip, pal.primary);
  leave(ctx, rig);
  // neck (drawn before the head)
  if (hooks.neck) { enter(ctx, rig, J.neck.x, J.neck.y, J.headAngle); hooks.neck(ctx, rig, pose, info(rig, 'neck', false, pal, p.neck, p.neckR, pal.skin)); leave(ctx, rig); }
  else drawNeck(ctx, rig, J.neck, J.head, pal.skin, p.neckR);
}

function drawHips(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose): void {
  const p = rig.p, pal = rig.palette, hooks = rig.parts;
  // same device grid as the hip joints, so the belt's edges land where the thigh roots do
  enter(ctx, rig, 0, rig.joints.hipN.y, 0);
  if (hooks.hips) hooks.hips(ctx, rig, pose, info(rig, 'hips', false, pal, 0, 0, pal.secondary, p.hip, 11));
  else drawBelt(ctx, rig, p.hip, pal.secondary, pal.dark, pal.accent);
  leave(ctx, rig);
}

function drawHead(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose): void {
  const J = rig.joints, p = rig.p, pal = rig.palette, hooks = rig.parts, r = p.headR;
  enter(ctx, rig, J.head.x, J.head.y, J.headAngle);
  if (hooks.head) hooks.head(ctx, rig, pose, info(rig, 'head', false, pal, 0, r, pal.skin));
  else drawSkull(ctx, rig, r, pal.skin, hooks.hair ? null : pal.hair, rig.build);
  if (hooks.hair) hooks.hair(ctx, rig, pose, info(rig, 'hair', false, pal, 0, r, pal.hair));
  if (hooks.face) hooks.face(ctx, rig, pose, info(rig, 'face', false, pal, 0, r, pal.dark));
  else drawFace(ctx, rig, r, pose.face | 0, rig.faceOpts);
  if (hooks.beard) hooks.beard(ctx, rig, pose, info(rig, 'beard', false, pal, 0, r, pal.hair));
  if (hooks.hat) hooks.hat(ctx, rig, pose, info(rig, 'hat', false, pal, 0, r, pal.dark));
  const acc = rig.accessories;
  for (let i = 0; i < acc.length; i++) if (acc[i].attach === 'head') acc[i].draw(ctx, rig, pose);
  leave(ctx, rig);
}

function drawAccessories(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose, layer: 'back' | 'front'): void {
  const J = rig.joints, list = rig.accessories;
  for (let i = 0; i < list.length; i++) {
    const acc = list[i];
    const at = acc.attach || 'torso';
    const isBack = at === 'back' || acc.layer === 'back';
    if (at === 'head') continue; // drawn with the head
    if (layer === 'back' ? !isBack : isBack) continue;
    if (at === 'back' || at === 'torso') enter(ctx, rig, J.torso.x, J.torso.y, J.torsoAngle);
    else if (at === 'hip') enter(ctx, rig, 0, rig.hipY, 0);
    else if (at === 'handR') enter(ctx, rig, J.handN.x, J.handN.y, -J.armN.hand + 90);
    else if (at === 'handL') enter(ctx, rig, J.handF.x, J.handF.y, -J.armF.hand + 90);
    else ctx.save(); // 'root'
    acc.draw(ctx, rig, pose);
    leave(ctx, rig);
  }
  if (layer === 'back' && rig.parts.back) { enter(ctx, rig, J.torso.x, J.torso.y, J.torsoAngle); rig.parts.back(ctx, rig, pose, info(rig, 'back', false, rig.palette, 0, 0, rig.palette.primary)); leave(ctx, rig); }
}

/** Weapon smear: translucent arc sector around the weapon shoulder between two root-space angles (pose.smear). */
function drawSmear(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose): void {
  const sm = pose.smear;
  if (!sm || sm.a <= 0.01) return;
  const J = rig.joints, p = rig.p, near = !rig.weapon || rig.weapon.attach !== 'handL';
  const sh = near ? J.shoulderN : J.shoulderF;
  const r = sm.r || (p.upperArm + p.lowerArm + (rig.weapon ? (rig.weapon.length || 30) * 0.9 : p.handR * 2));
  if (rig.parts.smear) { rig.parts.smear(ctx, rig, pose, info(rig, 'smear', false, rig.palette, r, r, rig.smearColor || rig.palette.metal)); return; }
  let a0 = rad(sm.from), a1 = rad(sm.to);
  if (a1 < a0) { const t = a0; a0 = a1; a1 = t; }
  if (a1 - a0 > Math.PI * 1.95) a1 = a0 + Math.PI * 1.95;
  const col = rig.smearColor || rig.palette.metal, t = tones(rig, col);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.min(1, sm.a);
  ctx.beginPath(); ctx.arc(sh.x, sh.y, r, a0, a1); ctx.arc(sh.x, sh.y, r * 0.45, a1, a0, true); ctx.closePath();
  ctx.fillStyle = rig.col(t.base); ctx.fill();
  ctx.globalAlpha = prev * Math.min(1, sm.a * 1.4);
  ctx.strokeStyle = rig.col(t.hi); ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(sh.x, sh.y, r * 0.92, a0 + (a1 - a0) * 0.08, a1 - (a1 - a0) * 0.05); ctx.stroke();
  ctx.beginPath(); ctx.arc(sh.x, sh.y, r * 0.66, a0 + (a1 - a0) * 0.2, a1 - (a1 - a0) * 0.15); ctx.stroke();
  ctx.globalAlpha = prev;
}

/** Weapon drawn behind the body (pose.weaponBack): same hand space as the near-arm draw, before every body part. */
function drawWeaponBack(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose): void {
  if (!rig.weapon || !(pose.weaponBack > 0.5)) return;
  const J = rig.joints, near = rig.weapon.attach !== 'handL';
  const hd = near ? J.handN : J.handF, handAng = -(near ? J.armN.hand : J.armF.hand) + 90;
  enter(ctx, rig, hd.x, hd.y, handAng + pose.weapon.rot);
  if (rig.weapon.draw) rig.weapon.draw(ctx, rig, pose);
  else if (rig.parts.weapon) rig.parts.weapon(ctx, rig, pose, info(rig, 'weapon', false, rig.palette, rig.weapon.length || 30, 0, rig.palette.metal));
  else drawStick(ctx, rig, rig.weapon.length || 30, rig.palette.metal, rig.palette.dark);
  leave(ctx, rig);
}

function drawBody(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose): void {
  drawAccessories(ctx, rig, pose, 'back');
  drawWeaponBack(ctx, rig, pose);
  drawLeg(ctx, rig, pose, 'F');
  drawArm(ctx, rig, pose, 'F', true);
  drawTorso(ctx, rig, pose);
  // The near leg goes UNDER the hip block, not over it. A thigh painted on top of the belt reads as a leg stuck to
  // the front of the body; with the hips over it, the leg emerges from inside the pelvis the way a leg does.
  drawLeg(ctx, rig, pose, 'N');
  drawHips(ctx, rig, pose);
  drawHead(ctx, rig, pose);
  drawSmear(ctx, rig, pose);
  drawArm(ctx, rig, pose, 'N', true);
  drawAccessories(ctx, rig, pose, 'front');
}

/** Advance every secondary-motion chain from the anchor joints' screen motion since the last animated draw. */
function stepChains(rig: Rig, pose: Pose): void {
  const ch = rig.chains;
  for (const k in ch) {
    const c = ch[k];
    const ang = c.joint === 'torso' ? rig.joints.torsoAngle : rig.joints.headAngle;
    jointScreen(rig, c.joint, c.pt);
    const inv = 1 / (Math.abs(rig.tf.fs) || 1);
    if (c.init) {
      const dx = (c.pt.x - c.lastX) * rig.facing * inv, dy = (c.pt.y - c.lastY) * inv;
      if (Math.abs(dx) > c.teleport || Math.abs(dy) > c.teleport) resetChain(c);
      else stepChain(c, dx, dy, ang - c.lastAng + pose.root.rot - c.lastRoot);
    }
    c.init = true; c.lastX = c.pt.x; c.lastY = c.pt.y; c.lastAng = ang; c.lastRoot = pose.root.rot;
  }
}

/**
 * Draw a rig at screen coords (feet position). The pose may be partial; it is resolved against DEFAULT_POSE.
 * @param rig from buildRig
 * @param pose partial or full pose
 * Squash/stretch pivot at the feet; a pose that sets only `squash` gets a volume-preserving stretch for free.
 * @param o
 *   secondary: false / still: true skip the secondary-motion step (chains are only stepped for AnimPlayer poses anyway)
 */
export function drawRig(ctx: CanvasRenderingContext2D, rig: Rig, pose: DrawPose | null | undefined, o: DrawRigOpts): void {
  const P: Pose = pose && isFullPose(pose) ? pose : copyPose(pose, SCRATCH_POSE, true);
  const facing = o.facing || 1, sc = (o.scale || 1) * rig.scale;
  // The draw scale has to be known BEFORE the joints are computed: they snap on the device grid it defines, and
  // the outline is authored in device pixels, so its stroke width is divided by the scale ctx.scale() will apply.
  rig.pxScale = sc;
  rig.ow = (rig.build.outlineWidth != null ? rig.build.outlineWidth : 1) / sc;
  computeJoints(rig, P);
  const squash = P.squash, stretch = P.stretch === 1 && squash !== 1 ? 1 / squash : P.stretch;
  const fs = facing * sc * squash, ss = sc * stretch;
  const t = rig.tf; t.x = Math.round(o.x); t.y = Math.round(o.y); t.fs = fs; t.ss = ss;
  t.rx = rig.snap ? Math.round(P.root.x * sc) / sc : P.root.x; t.ry = rig.snap ? Math.round(P.root.y * sc) / sc : P.root.y;
  t.c = Math.cos(rad(P.root.rot)); t.s = Math.sin(rad(P.root.rot));
  rig.facing = facing;
  rig.light.x = LIGHT_X; rig.light.y = LIGHT_Y;
  rig.tick++; rig.chainFrame = rig.tick;
  if (pose && isFullPose(pose) && o.secondary !== false && !o.still) stepChains(rig, P);
  const useOff = o.flash || o.tint;
  ctx.save();
  if (o.alpha != null && o.alpha < 1) ctx.globalAlpha *= o.alpha;
  if (useOff) {
    const g = getOffscreen();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, OFF_W, OFF_H);
    g.translate(OFF_OX, OFF_OY); g.scale(fs, ss); g.translate(t.rx, t.ry); g.rotate(rad(P.root.rot));
    rig.override = o.flash ? '#ffffff' : null;
    drawBody(g, rig, P);
    rig.override = null;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = o.flash ? 1 : (o.tintAlpha != null ? o.tintAlpha : 0.5);
    // `as string`: this branch runs only when `useOff` is truthy, so a falsy `flash` means `tint` is the colour
    // that made it truthy. The narrowing does not survive the alias, and the ternary is the original code.
    g.fillStyle = o.flash ? '#ffffff' : o.tint as string;
    g.fillRect(0, 0, OFF_W, OFF_H);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    ctx.drawImage(offCanvas!, t.x - OFF_OX, t.y - OFF_OY);
  } else {
    ctx.translate(t.x, t.y); ctx.scale(fs, ss); ctx.translate(t.rx, t.ry); ctx.rotate(rad(P.root.rot));
    drawBody(ctx, rig, P);
  }
  ctx.restore();
}

/**
 * Screen position of a joint after the last drawRig call (e.g. 'handN', 'weaponTip', 'head', 'torso').
 * @returns out
 */
export function jointScreen(rig: Rig, name: string, out: Point = { x: 0, y: 0 }): Point {
  const j = (rig.joints as unknown as Record<string, Point | undefined>)[name] || rig.joints.torso, t = rig.tf;
  const lx = j.x * t.c - j.y * t.s + t.rx, ly = j.x * t.s + j.y * t.c + t.ry;
  out.x = t.x + lx * t.fs; out.y = t.y + ly * t.ss;
  return out;
}

/** Mark a fully populated pose so drawRig can skip resolution (AnimPlayer does this for its pose). */
export function markFull(pose: Pose): FullPose { Object.defineProperty(pose, '__full', { value: true, enumerable: false }); return pose as FullPose; }
