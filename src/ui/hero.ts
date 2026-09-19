// The player's sprite: the engine's paper-doll rig, built once per class with that class's palette,
// a weapon drawn to match what is wielded, and three little animations (idle, walk, attack).
import { buildRig, drawRig, type Rig, type RigBuild, type RigWeapon } from '../lib/art/rig.ts';
import { P, makePose } from '../lib/art/poses.ts';
import { AnimPlayer, type AnimSet } from '../lib/art/animation.ts';
import type { Palette } from '../lib/art/palettes.ts';
import { shade } from '../lib/art/palettes.ts';
import { CLASS_BY_ID } from '../game/data/classes.ts';
import type { Player } from '../game/types.ts';
import { kindOf } from '../game/items.ts';

const INK = '#120c14';
/** Rig scale: a 72 px reference rig drawn at this scale stands ~26 px, a little over a 24 px tile. */
export const HERO_SCALE = 0.4;

const ANIMS: AnimSet = {
  idle: { loop: true, frames: [
    { dur: 40, pose: P({ armR: [12, 10], armL: [-14, 8], torso: 1, head: -1, root: [0, 0] }) },
    { dur: 40, pose: P({ armR: [15, 12], armL: [-11, 10], torso: 3, head: 1, root: [0, 1] }) },
  ] },
  walk: { loop: true, frames: [
    { dur: 7, pose: P({ legR: [30, -10], legL: [-25, 20], armR: [-20, 10], armL: [25, 15], torso: 4, root: [0, 0] }) },
    { dur: 7, pose: P({ legR: [0, -5], legL: [0, 10], armR: [0, 10], armL: [0, 15], torso: 3, root: [0, -1] }) },
    { dur: 7, pose: P({ legR: [-25, 20], legL: [30, -10], armR: [25, 15], armL: [-20, 10], torso: 4, root: [0, 0] }) },
    { dur: 7, pose: P({ legR: [0, 10], legL: [0, -5], armR: [0, 15], armL: [0, 10], torso: 3, root: [0, -1] }) },
  ] },
  attack: { loop: false, frames: [
    { dur: 4, pose: P({ armR: [-60, -40], armL: [20, 30], torso: -8, head: -4, weapon: -30, root: [-2, 0] }) },
    { dur: 5, pose: P({ armR: [120, 20], armL: [-10, 20], torso: 12, head: 6, weapon: 20, root: [3, 0], smear: [-60, 120, 0.5, 26] }) },
    { dur: 8, pose: P({ armR: [60, 30], armL: [-10, 15], torso: 5, head: 2, root: [1, 0] }) },
  ] },
  hurt: { loop: false, frames: [
    { dur: 6, pose: P({ armR: [40, 60], armL: [-40, 50], torso: -10, head: -8, face: 'hurt', root: [-3, 0] }) },
    { dur: 8, pose: P({ armR: [12, 10], armL: [-14, 8], torso: 0, head: 0, root: [-1, 0] }) },
  ] },
  dead: { loop: true, frames: [
    { dur: 60, pose: P({ root: [0, -4, 90], legR: [10, 10], legL: [-10, 10], armR: [80, 20], armL: [-60, 20], face: 'closed' }) },
  ] },
};

function weaponFor(p: Player): RigWeapon {
  const w = p.equip.weapon;
  const k = w ? kindOf(w) : null;
  const tval = k ? k.tval : 'none';
  const col = k ? k.color : '#c8cdd8';
  return {
    length: tval === 'polearm' ? 44 : tval === 'hafted' ? 26 : tval === 'digger' ? 30 : tval === 'sword' ? 30 : 0,
    twoHanded: tval === 'polearm',
    draw: (ctx, rig) => {
      if (!k) return;
      const o = rig.outline, ow = rig.ow;
      ctx.lineWidth = ow * 2; ctx.strokeStyle = o; ctx.lineJoin = 'round';
      if (tval === 'sword') {
        // Blade with a crossguard and pommel.
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(4, -2.2); ctx.lineTo(30, -1); ctx.lineTo(33, 0); ctx.lineTo(30, 1); ctx.lineTo(4, 2.2); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.fillStyle = shade(col, 1.3); ctx.fillRect(6, -1.4, 22, 1.2);
        ctx.fillStyle = '#c8a040'; ctx.beginPath(); ctx.rect(2.5, -4.5, 2.5, 9); ctx.stroke(); ctx.fill();
        ctx.fillStyle = '#6a4a2a'; ctx.beginPath(); ctx.rect(-6, -1.8, 8.5, 3.6); ctx.stroke(); ctx.fill();
        ctx.fillStyle = '#c8a040'; ctx.beginPath(); ctx.arc(-7, 0, 2.2, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
      } else if (tval === 'hafted') {
        ctx.fillStyle = '#6a4a2a'; ctx.beginPath(); ctx.rect(-8, -1.6, 28, 3.2); ctx.stroke(); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(18, -6); ctx.lineTo(28, -4); ctx.lineTo(28, 4); ctx.lineTo(18, 6); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.fillStyle = shade(col, 1.3); ctx.fillRect(19, -4.5, 8, 2);
      } else if (tval === 'polearm') {
        ctx.fillStyle = '#6a4a2a'; ctx.beginPath(); ctx.rect(-14, -1.4, 50, 2.8); ctx.stroke(); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(34, -5); ctx.lineTo(46, 0); ctx.lineTo(34, 5); ctx.lineTo(32, 0); ctx.closePath(); ctx.stroke(); ctx.fill();
      } else if (tval === 'digger') {
        ctx.fillStyle = '#6a4a2a'; ctx.beginPath(); ctx.rect(-8, -1.4, 30, 2.8); ctx.stroke(); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(20, -6); ctx.lineTo(32, -6); ctx.lineTo(32, 6); ctx.lineTo(20, 6); ctx.closePath(); ctx.stroke(); ctx.fill();
      }
    },
  };
}

export interface HeroSprite {
  rig: Rig;
  player: AnimPlayer;
  weaponKey: string;
  cls: string;
}

export function buildHero(p: Player): HeroSprite {
  const c = CLASS_BY_ID[p.cls];
  const pal: Palette = { ...c.palette };
  const build: RigBuild = {
    basePalette: pal, outline: INK, scale: HERO_SCALE, proportions: { headR: 10, torsoW: 24, torsoH: 24, upperLeg: 13, lowerLeg: 13, upperArm: 12, lowerArm: 11 },
    thinR: 4, hiMin: 6, flatR: 2.5, tones: 2, weapon: weaponFor(p), hairStyle: p.cls === 'mage' ? 'bald' : 'short',
    accessories: accessoriesFor(p.cls, pal),
  };
  const rig = buildRig(build);
  const player = new AnimPlayer(ANIMS);
  player.play('idle');
  return { rig, player, weaponKey: p.equip.weapon ? p.equip.weapon.kind : '', cls: p.cls };
}

function accessoriesFor(cls: string, pal: Palette) {
  const acc: NonNullable<RigBuild['accessories']> = [];
  if (cls === 'mage') acc.push({ attach: 'head', draw: (ctx, rig) => {
    // Pointed hat with a brim.
    ctx.lineWidth = rig.ow * 2; ctx.strokeStyle = rig.outline; ctx.lineJoin = 'round';
    ctx.fillStyle = pal.secondary; ctx.beginPath(); ctx.moveTo(-13, -6); ctx.lineTo(13, -6); ctx.lineTo(4, -9); ctx.lineTo(2, -30); ctx.lineTo(-5, -9); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = pal.accent; ctx.fillRect(-5, -9, 9, 2);
  } });
  if (cls === 'warrior') acc.push({ attach: 'head', draw: (ctx, rig) => {
    ctx.lineWidth = rig.ow * 2; ctx.strokeStyle = rig.outline;
    ctx.fillStyle = pal.metal; ctx.beginPath(); ctx.arc(0, -3, 11, Math.PI, 0); ctx.lineTo(11, 0); ctx.lineTo(-11, 0); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.moveTo(-2, -14); ctx.lineTo(2, -14); ctx.lineTo(1, -22); ctx.lineTo(-1, -22); ctx.closePath(); ctx.stroke(); ctx.fill();
  } });
  if (cls === 'paladin') acc.push({ attach: 'head', draw: (ctx, rig) => {
    ctx.lineWidth = rig.ow * 2; ctx.strokeStyle = rig.outline;
    ctx.fillStyle = pal.metal; ctx.beginPath(); ctx.arc(0, -3, 11, Math.PI, 0); ctx.lineTo(11, -1); ctx.lineTo(-11, -1); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#f0f0f0'; ctx.beginPath(); ctx.moveTo(-9, -8); ctx.lineTo(-16, -22); ctx.lineTo(-6, -12); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(9, -8); ctx.lineTo(16, -22); ctx.lineTo(6, -12); ctx.closePath(); ctx.stroke(); ctx.fill();
  } });
  if (cls === 'ranger') acc.push({ attach: 'head', draw: (ctx, rig) => {
    ctx.lineWidth = rig.ow * 2; ctx.strokeStyle = rig.outline;
    ctx.fillStyle = pal.primary; ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(12, -4); ctx.lineTo(6, -12); ctx.lineTo(-8, -12); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#e04040'; ctx.beginPath(); ctx.moveTo(6, -12); ctx.lineTo(14, -20); ctx.lineTo(9, -10); ctx.closePath(); ctx.stroke(); ctx.fill();
  } });
  if (cls === 'priest') acc.push({ attach: 'torso', draw: (ctx, rig) => {
    ctx.lineWidth = rig.ow * 2; ctx.strokeStyle = rig.outline;
    ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.rect(-1.5, -18, 3, 10); ctx.rect(-4.5, -15, 9, 3); ctx.stroke(); ctx.fill();
  } });
  if (cls === 'rogue') acc.push({ attach: 'head', draw: (ctx, rig) => {
    ctx.lineWidth = rig.ow * 2; ctx.strokeStyle = rig.outline;
    ctx.fillStyle = pal.secondary; ctx.beginPath(); ctx.rect(-11, -6, 22, 4); ctx.stroke(); ctx.fill();
  } });
  return acc;
}

/** Rebuild the rig when the wielded weapon changes. */
export function syncHero(h: HeroSprite, p: Player): HeroSprite {
  const key = p.equip.weapon ? p.equip.weapon.kind : '';
  if (key === h.weaponKey && h.cls === p.cls) return h;
  const n = buildHero(p);
  n.player.play(h.player.name || 'idle');
  return n;
}

export function drawHero(ctx: CanvasRenderingContext2D, h: HeroSprite, x: number, y: number, facing: 1 | -1, opts: { flash?: boolean; alpha?: number; tint?: string | null } = {}): void {
  h.player.tick();
  drawRig(ctx, h.rig, h.player.pose, { x, y, facing, flash: opts.flash, alpha: opts.alpha, tint: opts.tint || null, tintAlpha: 0.45 });
}
export function heroPlay(h: HeroSprite, anim: string): void {
  if (h.player.name !== anim || (!ANIMS[anim].loop && h.player.done)) h.player.play(anim, { restart: true });
}
export const _keep = [makePose];
