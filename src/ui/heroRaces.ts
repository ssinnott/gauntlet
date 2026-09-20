// The race half of the hero sprite: the body the class kit is drawn on. Ears, hair, beards, tusks,
// snouts, war paint, tails and bare feet, each a part hook or an accessory drawn in the space rig.ts
// enters for it. Head space: origin at the head centre, the rig faces +x, up is -y, and every
// measurement is a multiple of the head radius r so the same marks fit a hobbit's head and a troll's.
import type { Rig, RigAccessory, RigParts } from '../lib/art/rig.ts';
import { drawSkull, drawHairCap, brow, type FaceOpts, type PartHook } from '../lib/art/rigParts.ts';
import { celPoly, celBall, celRect, celTaper, tones } from '../lib/art/shading.ts';
import type { Palette } from '../lib/art/palettes.ts';
import type { RaceLook, HairStyle, BeardStyle } from '../game/types.ts';

const R = Math.round;
const IVORY = '#f0ead8', WOAD = '#3a70d0', CLAY = '#ece4d4', NOSE = '#2a1c18';

/** What raceRig hands buildHero: the hooks, the accessories and the skull options the look resolves to. */
export interface RaceRig {
  parts: RigParts;
  accessories: RigAccessory[];
  /** The resolved hair style (a woman's 'short' becomes 'long'). */
  hairStyle: HairStyle;
  /** The resolved beard (women go clean-shaven; an Ent's moss is not a beard in that sense). */
  beard: BeardStyle;
  /** Races that draw their own nose or snout skip the skull's bump. */
  noNose: boolean;
  face: FaceOpts;
}

/** Resolve a race look (and the hero's sex) to the hooks that draw it. `pal` is the merged hero palette. */
export function raceRig(look: RaceLook, sex: 'male' | 'female', pal: Palette): RaceRig {
  const has = (f: string) => !!look.features && look.features.includes(f as never);
  const female = sex === 'female';
  const hairStyle: HairStyle = female && look.hairStyle === 'short' ? 'long' : look.hairStyle;
  const beard: BeardStyle = !look.beard || (female && look.beard !== 'moss') ? 'none' : look.beard;
  const ears = look.ears || 'round';
  const snout = has('snout'), bigNose = has('bigNose');
  const hidesMouth = snout || (beard !== 'none' && beard !== 'goatee');
  const hair = look.hair, skin = look.skin;
  const parts: RigParts = {};
  const accessories: RigAccessory[] = [];

  // The skull, with whatever sits behind it: ears that break the contour, and the mass of long hair.
  parts.head = (ctx, rig, _pose, info) => {
    const r = info.r;
    if (ears === 'pointed' || ears === 'long') {
      const L = ears === 'long' ? 1.85 : 1.4, up = ears === 'long' ? 0.95 : 0.55;
      celPoly(ctx, rig, [-r * 0.55, -r * 0.05, -r * L, -r * up, -r * 0.65, r * 0.4], skin, 0.3, 0);
    } else if (ears === 'kobold') {
      celPoly(ctx, rig, [-r * 0.1, -r * 0.55, r * 0.3, -r * 1.9, r * 0.6, -r * 0.7], skin, 0.3, 0);
      celPoly(ctx, rig, [-r * 0.8, -r * 0.35, -r * 1.05, -r * 1.85, -r * 0.15, -r * 0.85], skin, 0.3, 0);
    }
    if (hairStyle === 'long') celPoly(ctx, rig, [-r * 0.3, -r * 0.9, -r * 1.1, -r * 0.5, -r * 1.25, r * 0.6, -r * 1.15, r * 1.5, -r * 0.7, r * 1.6, -r * 0.35, r * 1.0, -r * 0.2, r * 0.3], hair, 0.4, 0);
    else if (hairStyle === 'mane') celPoly(ctx, rig, [-r * 0.2, -r * 0.9, -r * 1.15, -r * 0.6, -r * 1.45, r * 0.2, -r * 1.2, r * 0.5, -r * 1.5, r * 1.2, -r * 1.0, r * 1.3, -r * 1.1, r * 1.8, -r * 0.5, r * 1.5, -r * 0.2, r * 1.0, r * 0.1, r * 0.6], hair, 0.4, 0);
    drawSkull(ctx, rig, r, skin, null, rig.build);
    if (rig.override || !rig.shading) return;
    const t = tones(rig, skin);
    if (has('brow')) { ctx.fillStyle = t.sh; ctx.fillRect(R(-r * 0.4), R(-r * 0.62), R(r * 1.3), R(r * 0.22)); }
    if (has('bark')) { ctx.fillStyle = t.deep; ctx.fillRect(R(-r * 0.5), R(-r * 0.75), 2, R(r * 0.55)); ctx.fillRect(R(r * 0.25), R(-r * 0.95), 2, R(r * 0.45)); ctx.fillRect(R(-r * 0.15), R(r * 0.25), 2, R(r * 0.5)); }
    if (has('warts')) { ctx.fillStyle = t.deep; ctx.fillRect(R(r * 0.75), R(-r * 0.45), 2, 2); ctx.fillRect(R(-r * 0.35), R(r * 0.55), 2, 2); }
  };

  // Hair on top of the skull, before the face: caps, crests, curls, a topknot, leaves.
  parts.hair = (ctx, rig, _pose, info) => {
    const r = info.r;
    switch (hairStyle) {
      case 'short': case 'long': drawHairCap(ctx, rig, r, hair, 'short'); break;
      case 'mane':
        drawHairCap(ctx, rig, r, hair, 'short');
        celPoly(ctx, rig, [r * 0.6, -r * 0.6, r * 0.35, -r * 1.25, r * 0.1, -r * 0.95, -r * 0.2, -r * 1.4, -r * 0.45, -r * 1.0, -r * 0.8, -r * 1.25, -r * 0.95, -r * 0.6], hair, 0.4, 0);
        break;
      case 'curls':
        drawHairCap(ctx, rig, r, hair, 'short');
        for (const [x, y] of [[0.55, -0.7], [0.2, -1.0], [-0.3, -1.05], [-0.75, -0.8], [-1.0, -0.3], [-0.95, 0.2]]) celBall(ctx, rig, r * x, r * y, r * 0.28, hair, false);
        break;
      case 'topknot':
        celTaper(ctx, rig, -r * 0.3, -r * 1.0, -r * 1.3, -r * 0.1, r * 0.2, r * 0.1, hair, 0);
        celBall(ctx, rig, -r * 0.1, -r * 1.05, r * 0.32, hair, false);
        break;
      case 'crest':
        celPoly(ctx, rig, [r * 0.5, -r * 0.75, r * 0.3, -r * 1.5, 0, -r * 1.2, -r * 0.3, -r * 1.6, -r * 0.6, -r * 1.1, -r * 0.85, -r * 1.3, -r * 1.0, -r * 0.5, -r * 0.7, -r * 0.75, -r * 0.3, -r * 0.9, r * 0.2, -r * 0.9], hair, 0.4, 0);
        break;
      case 'wisps':
        celPoly(ctx, rig, [-r * 0.9, -r * 0.4, -r * 1.35, -r * 0.65, -r * 1.0, r * 0.05], hair, 0, 0);
        celPoly(ctx, rig, [-r * 0.7, -r * 0.75, -r * 1.0, -r * 1.25, -r * 0.35, -r * 0.95], hair, 0, 0);
        celPoly(ctx, rig, [r * 0.1, -r * 0.95, r * 0.25, -r * 1.35, r * 0.45, -r * 0.85], hair, 0, 0);
        break;
      case 'leaves':
        if (!rig.override) { ctx.fillStyle = tones(rig, skin).deep; ctx.fillRect(R(-r * 0.1), R(-r * 1.7), 2, R(r * 0.8)); ctx.fillRect(R(r * 0.4), R(-r * 1.45), 2, R(r * 0.6)); }
        for (const [x, y, s] of [[0.35, -1.05, 0.42], [-0.35, -1.15, 0.5], [-0.9, -0.6, 0.38], [0.05, -1.55, 0.3]]) celBall(ctx, rig, r * x, r * y, r * s, hair, false);
        break;
      case 'bald': break;
    }
    if (ears === 'bear') {
      celBall(ctx, rig, -r * 0.6, -r * 0.8, r * 0.34, hair, false); celBall(ctx, rig, r * 0.35, -r * 0.92, r * 0.34, hair, false);
      if (!rig.override) { ctx.fillStyle = tones(rig, skin).sh; ctx.fillRect(R(-r * 0.68), R(-r * 0.88), 2, 2); ctx.fillRect(R(r * 0.27), R(-r * 1.0), 2, 2); }
    }
  };

  // After the face: the nose a race draws itself, the beard, tusks, and paint.
  parts.beard = (ctx, rig, _pose, info) => {
    const r = info.r;
    if (snout) {
      celPoly(ctx, rig, [r * 0.45, -r * 0.1, r * 1.35, r * 0.05, r * 1.5, r * 0.35, r * 1.3, r * 0.7, r * 0.45, r * 0.8], skin, 0.3, 0);
      celBall(ctx, rig, r * 1.35, r * 0.2, r * 0.14, NOSE, false);
      if (!rig.override) { ctx.fillStyle = rig.outline; ctx.fillRect(R(r * 0.6), R(r * 0.55), R(r * 0.7), 1); }
      celPoly(ctx, rig, [r * 0.95, r * 0.55, r * 1.02, r * 0.85, r * 1.12, r * 0.55], IVORY, 0, 0);
    }
    if (bigNose) celBall(ctx, rig, r * 0.95, r * 0.3, r * 0.34, skin, false);
    const beardCol = beard === 'moss' ? hair : hair;
    switch (beard) {
      case 'full': celPoly(ctx, rig, [r * 0.9, r * 0.35, r * 0.95, r * 0.9, r * 0.6, r * 1.5, r * 0.15, r * 2.2, -r * 0.4, r * 1.6, -r * 0.75, r * 0.9, -r * 0.7, r * 0.35], beardCol, 0.4, 0); break;
      case 'braided':
        celPoly(ctx, rig, [r * 0.9, r * 0.35, r * 0.95, r * 0.9, r * 0.7, r * 1.9, r * 0.35, r * 1.9, r * 0.2, r * 1.2, r * 0.05, r * 1.9, -r * 0.35, r * 1.9, -r * 0.7, r * 0.9, -r * 0.7, r * 0.35], beardCol, 0.4, 0);
        if (!rig.override) { ctx.fillStyle = rig.col(pal.accent); ctx.fillRect(R(r * 0.42), R(r * 1.45), R(r * 0.3), 2); ctx.fillRect(R(-r * 0.28), R(r * 1.45), R(r * 0.3), 2); }
        break;
      case 'shaggy': celPoly(ctx, rig, [r * 0.95, r * 0.3, r * 1.1, r * 0.9, r * 0.8, r * 1.3, r * 0.5, r * 1.7, r * 0.1, r * 1.4, -r * 0.3, r * 1.8, -r * 0.7, r * 1.3, -r * 1.0, r * 0.9, -r * 0.8, r * 0.3], beardCol, 0.4, 0); break;
      case 'moss': celPoly(ctx, rig, [r * 0.95, r * 0.4, r * 1.0, r * 0.9, r * 0.7, r * 1.6, r * 0.35, r * 1.2, r * 0.05, r * 1.75, -r * 0.35, r * 1.3, -r * 0.7, r * 1.5, -r * 0.85, r * 0.9, -r * 0.75, r * 0.4], beardCol, 0.4, 0); break;
      case 'short': celPoly(ctx, rig, [r * 0.9, r * 0.4, r * 0.9, r * 0.95, r * 0.5, r * 1.3, -r * 0.5, r * 1.3, -r * 0.85, r * 0.95, -r * 0.75, r * 0.4], beardCol, 0.4, 0); break;
      case 'goatee': celPoly(ctx, rig, [r * 0.15, r * 0.9, r * 0.7, r * 0.85, r * 0.45, r * 1.35], beardCol, 0, 0); break;
      case 'none': break;
    }
    if (has('tusks')) {
      celPoly(ctx, rig, [r * 0.5, r * 0.95, r * 0.62, r * 0.4, r * 0.75, r * 0.95], IVORY, 0, 0);
      celPoly(ctx, rig, [r * 0.05, r * 0.95, r * 0.18, r * 0.5, r * 0.3, r * 0.95], IVORY, 0, 0);
    }
    if (rig.override) return;
    if (has('woad')) { ctx.fillStyle = WOAD; brow(ctx, r * 0.2, r * 0.05, r * 0.95, r * 0.3, 2); brow(ctx, -r * 0.4, r * 0.1, -r * 0.05, r * 0.3, 2); }
    if (has('clay')) { ctx.fillStyle = CLAY; for (const [x, y] of [[0.25, 0.15], [0.7, 0.2], [-0.05, -0.75], [0.45, -0.8], [-0.4, 0.2]]) ctx.fillRect(R(r * x), R(r * y), 2, 2); }
  };

  if (has('bareFeet')) {
    // Foot space: origin at the ankle, y down, toe toward +x. A skin-coloured foot with a tuft of hair on top.
    const foot: PartHook<Rig> = (ctx, rig, _pose, info) => {
      const L = info.w || 10, H = info.h || 5, heel = R(L * 0.4), toe = R(L * 0.65), top = -R(H);
      celRect(ctx, rig, -heel, top, heel + toe, R(H * 1.5), 3, info.pal.skin, 0.34, 0.3);
      if (rig.override) return;
      ctx.fillStyle = rig.col(info.pal.hair); ctx.fillRect(R(-heel * 0.3), top - 1, 4, 2); ctx.fillRect(R(heel * 0.3) + 2, top - 2, 3, 2);
      ctx.fillStyle = tones(rig, info.pal.skin).deep; ctx.fillRect(toe - 3, top + 2, 1, R(H * 0.8)); ctx.fillRect(toe - 6, top + 3, 1, R(H * 0.7));
    };
    parts.foot = foot;
  }
  if (has('tail')) {
    // Hip space, behind everything: a tail that trails back and curls up.
    accessories.push({ attach: 'hip', layer: 'back', draw: (ctx, rig) => {
      celTaper(ctx, rig, -4, 2, -14, 8, 3, 2, skin, 0);
      celTaper(ctx, rig, -14, 8, -22, 2, 2, 1.2, skin, 0);
    } });
  }

  return { parts, accessories, hairStyle, beard, noNose: snout || bigNose, face: { pupil: look.eyes, noMouth: hidesMouth } };
}
