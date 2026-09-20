// Bolts, beams, balls and breaths: the geometry of a projection and what it does to whoever it
// reaches. Both the player's spells/devices and the monsters' attacks come through here.
import { type Element, type Monster, type Pos, T, DIR_DX, DIR_DY } from './types.ts';
import { projectPath, tileAt, setTile, monsterAt, los, inBounds, playerCanSee, hasFlag, addFlag } from './level.ts';
import { isWall } from './types.ts';
import { F } from './types.ts';
import { raceOf, hasMFlag, monsterName, monsterNameVisible } from './monster.ts';
import { monsterTakeHit, elementDamage } from './combat.ts';
import { teleportMonster } from './effectsCore.ts';
import { randint0, randint1, oneIn, distance } from './util.ts';
import type { Game } from './state.ts';

export const ELEMENT_COLOR: Record<Element, string> = {
  acid: '#8fd85a', elec: '#7ac8ff', fire: '#ff7a30', cold: '#c8f0ff', pois: '#70d060', lite: '#fff8c0', dark: '#5a3a8a', nether: '#8060c0',
  sound: '#f0e060', chaos: '#ff60d0', conf: '#e0a0ff', mana: '#ff80ff', missile: '#e8e8f0', holy: '#fff0a0', water: '#4090ff', nexus: '#ff9040', disen: '#c0a0e0',
  shards: '#d0c0a0', time: '#a0f0e0', inertia: '#808090', gravity: '#604080', plasma: '#ff4080', force: '#e0e0a0', ice: '#e0f8ff', disint: '#a08060',
};

export interface ProjectOpts {
  /** Damage on a direct hit; balls fall off with distance. */
  dam: number;
  radius?: number;
  /** A bolt stops at the first monster; a beam passes through everything in its path. */
  beam?: boolean;
  /** Who fired: 'player' hits monsters, a monster hits the player. */
  source: 'player' | Monster;
  /** Range in grids (default 20). */
  range?: number;
  /** For messages: "a bolt of fire" etc. */
  name?: string;
  /** Wall-affecting (stone to mud) and special kinds. */
  kind?: 'damage' | 'stone_to_mud' | 'light' | 'sleep' | 'slow' | 'confuse' | 'scare' | 'teleport_other' | 'polymorph' | 'clone' | 'haste' | 'heal' | 'drain' | 'kill_wall' | 'kill_door' | 'disarm';
}

/** Resolve a target from a direction: 5 means the nearest visible monster (or the given target grid). */
export function targetFromDir(g: Game, dir: number, target?: Pos | null): Pos {
  const p = g.player;
  if (dir === 5 && target) return target;
  if (dir === 5) { const m = nearestVisibleMonster(g); if (m) return { x: m.x, y: m.y }; return { x: p.x + 1, y: p.y }; }
  return { x: p.x + DIR_DX[dir] * 40, y: p.y + DIR_DY[dir] * 40 };
}
export function nearestVisibleMonster(g: Game): Monster | null {
  const p = g.player;
  let best: Monster | null = null, bd = 999;
  for (const m of g.level.monsters) {
    if (!m.visible || !playerCanSee(g.level, m.x, m.y)) continue;
    if (!los(g.level, p.x, p.y, m.x, m.y)) continue;
    const d = distance(p.x, p.y, m.x, m.y);
    if (d < bd && d <= 20) { bd = d; best = m; }
  }
  return best;
}

/** Fire a projection from (x0,y0) toward (x1,y1). Returns true if anything was affected. */
export function project(g: Game, x0: number, y0: number, x1: number, y1: number, elem: Element, o: ProjectOpts): boolean {
  const lv = g.level;
  const range = o.range ?? 20;
  const stopAtMonster = !o.beam && (o.radius || 0) === 0 ? true : !o.beam;
  const path = projectPath(lv, x0, y0, x1, y1, range, stopAtMonster && !o.beam);
  // A bolt aimed from a monster stops at the player too.
  let end: Pos = { x: x0, y: y0 };
  const cut: Pos[] = [];
  for (const p of path) {
    cut.push(p);
    end = p;
    const t = tileAt(lv, p.x, p.y);
    if (t !== T.FLOOR && !(t >= T.DOOR_OPEN && t <= T.DOOR_BROKEN) && t !== T.STAIRS_UP && t !== T.STAIRS_DOWN && t !== T.TRAP && t !== T.TRAP_HIDDEN && t !== T.GRASS && t !== T.ROAD && !(t >= T.SHOP_0)) {
      break; // hit a wall: the wall is the end grid
    }
    if (!o.beam && (o.radius || 0) === 0) {
      if (o.source === 'player' && monsterAt(lv, p.x, p.y)) break;
      if (o.source !== 'player' && p.x === g.player.x && p.y === g.player.y) break;
    }
    if (o.beam && o.source !== 'player' && p.x === g.player.x && p.y === g.player.y) { /* beams continue */ }
  }
  if (!cut.length) return false;
  const anySeen = cut.some(p => playerCanSee(lv, p.x, p.y));
  if (anySeen) g.fx.push({ type: 'bolt', path: cut.slice(), element: elem, beam: o.beam });
  let affected = false;
  const radius = o.radius || 0;
  if (radius > 0) {
    // Ball: every grid within radius and in LOS of the centre; damage falls off.
    const cells: Pos[] = [];
    for (let y = end.y - radius; y <= end.y + radius; y++) for (let x = end.x - radius; x <= end.x + radius; x++) {
      if (!inBounds(lv, x, y)) continue;
      const d = distance(end.x, end.y, x, y);
      if (d > radius) continue;
      if (!los(lv, end.x, end.y, x, y)) continue;
      cells.push({ x, y });
      const dam = Math.floor(o.dam * (radius + 1 - d) / (radius + 1));
      if (affectGrid(g, x, y, elem, dam, o)) affected = true;
    }
    if (anySeen || playerCanSee(lv, end.x, end.y)) g.fx.push({ type: 'ball', x: end.x, y: end.y, radius, element: elem, cells });
  } else {
    for (const p of cut) {
      if (affectGrid(g, p.x, p.y, elem, o.dam, o)) affected = true;
      if (!o.beam && (monsterAt(lv, p.x, p.y) || (p.x === g.player.x && p.y === g.player.y))) break;
    }
  }
  return affected;
}

/** A breath is a cone-ish ball: bigger radius, damage falls off from the centre. */
export function breathe(g: Game, m: Monster, elem: Element, dam: number): void {
  const p = g.player;
  const radius = hasMFlag(raceOf(m), 'POWERFUL') ? 3 : 2;
  project(g, m.x, m.y, p.x, p.y, elem, { dam, radius, source: m, name: 'breath' });
}

function affectGrid(g: Game, x: number, y: number, elem: Element, dam: number, o: ProjectOpts): boolean {
  const lv = g.level;
  let hit = false;
  const t = tileAt(lv, x, y);
  // Terrain.
  if (o.kind === 'stone_to_mud' || o.kind === 'kill_wall' || (elem === 'disint' && t !== T.PERM && isWall(t))) {
    if (t === T.GRANITE || t === T.MAGMA || t === T.QUARTZ || t === T.MAGMA_K || t === T.QUARTZ_K || t === T.RUBBLE || t === T.SECRET_DOOR) {
      const treasure = t === T.MAGMA_K || t === T.QUARTZ_K;
      setTile(lv, x, y, T.FLOOR);
      if (playerCanSee(lv, x, y) || hasFlag(lv, x, y, F.MARK)) { g.msg.add(t === T.RUBBLE ? 'The rubble turns into mud!' : 'The wall turns into mud!'); addFlag(lv, x, y, F.MARK); }
      if (treasure) { g.msg.add('You have found something!'); g.hooks.placeGoldAt(x, y); }
      hit = true;
    }
  }
  if (o.kind === 'kill_door' || elem === 'fire' && dam > 20 && oneIn(3)) {
    if (t === T.DOOR_CLOSED || t === T.DOOR_OPEN || t === T.DOOR_BROKEN || t === T.SECRET_DOOR) { if (o.kind === 'kill_door' || elem === 'fire') { setTile(lv, x, y, T.FLOOR); if (playerCanSee(lv, x, y)) { g.msg.add('The door is destroyed!'); hit = true; } } }
  }
  if (o.kind === 'disarm' && (t === T.TRAP || t === T.TRAP_HIDDEN)) { setTile(lv, x, y, T.FLOOR); if (playerCanSee(lv, x, y)) g.msg.add('The trap is destroyed.'); hit = true; }
  if (o.kind === 'light' || elem === 'lite') { addFlag(lv, x, y, F.GLOW | F.MARK); }
  if (elem === 'dark' && o.source !== 'player') { /* darkness handled by the caller for rooms */ }
  // Monsters (only from the player or from other monsters' balls? Angband: monsters do not hurt each other).
  const m = monsterAt(lv, x, y);
  if (m && o.source === 'player') { if (affectMonster(g, m, elem, dam, o)) hit = true; }
  // The player (only from monsters).
  if (o.source !== 'player' && x === g.player.x && y === g.player.y) {
    const src = o.source;
    const name = monsterName(src, false).replace(/^the /, '');
    elementDamage(g, elem, dam, name);
    hit = true;
  }
  return hit;
}

function affectMonster(g: Game, m: Monster, elem: Element, dam: number, o: ProjectOpts): boolean {
  const r = raceOf(m);
  const name = monsterNameVisible(g, m);
  const kind = o.kind || 'damage';
  const seen = m.visible;
  let note = '';
  switch (kind) {
    case 'sleep': if (hasMFlag(r, 'NO_SLEEP') || hasMFlag(r, 'UNIQUE') && r.depth > dam / 2 || r.depth > randint1(Math.max(1, dam))) { if (seen) g.msg.add(`${name} is unaffected!`); return true; } m.sleep = 500; if (seen) g.msg.add(`${name} falls asleep!`); return true;
    case 'slow': if (hasMFlag(r, 'UNIQUE') || r.depth > randint1(Math.max(1, dam))) { if (seen) g.msg.add(`${name} is unaffected!`); return true; } m.slowed = 20 + randint1(20); if (seen) g.msg.add(`${name} starts moving slower.`); return true;
    case 'confuse': if (hasMFlag(r, 'NO_CONF') || r.depth > randint1(Math.max(1, dam))) { if (seen) g.msg.add(`${name} is unaffected!`); return true; } m.confused = 10 + randint1(10); if (seen) g.msg.add(`${name} looks confused.`); return true;
    case 'scare': if (hasMFlag(r, 'NO_FEAR') || r.depth > randint1(Math.max(1, dam))) { if (seen) g.msg.add(`${name} is unaffected!`); return true; } m.afraid = 10 + randint1(20); if (seen) g.msg.add(`${name} flees in terror!`); return true;
    case 'teleport_other': teleportMonster(g, m, dam); if (seen) g.msg.add(`${name} disappears!`); return true;
    case 'haste': m.hasted = 20 + randint1(20); if (seen) g.msg.add(`${name} starts moving faster.`); return true;
    case 'heal': m.hp = Math.min(m.maxhp, m.hp + dam); m.afraid = 0; if (seen) g.msg.add(`${name} looks healthier.`); return true;
    case 'clone': { if (hasMFlag(r, 'UNIQUE')) { if (seen) g.msg.add(`${name} is unaffected!`); return true; } g.hooks.cloneMonster(m); if (seen) g.msg.add(`${name} spawns!`); return true; }
    case 'polymorph': { if (hasMFlag(r, 'UNIQUE') || r.depth > randint1(Math.max(1, dam))) { if (seen) g.msg.add(`${name} is unaffected!`); return true; } g.hooks.polymorphMonster(m); if (seen) g.msg.add(`${name} changes!`); return true; }
    case 'drain': if (hasMFlag(r, 'UNDEAD') || hasMFlag(r, 'DEMON') || r.sprite === 'golem' || r.sprite === 'vortex' || r.sprite === 'elemental' || hasMFlag(r, 'GENERATOR')) { if (seen) g.msg.add(`${name} is unaffected!`); return true; } break;
    case 'light': if (!hasMFlag(r, 'HURT_LITE')) return false; note = ' cringes from the light'; break;
    case 'stone_to_mud': case 'kill_wall': if (!hasMFlag(r, 'HURT_ROCK')) return false; dam = Math.max(dam, 20 + randint1(30)); note = ' loses some skin'; break;
    case 'kill_door': case 'disarm': return false;
  }
  // Elemental resistances.
  switch (elem) {
    case 'acid': if (hasMFlag(r, 'IM_ACID')) { dam = Math.floor(dam / 9); note = ' resists a lot'; } break;
    case 'elec': if (hasMFlag(r, 'IM_ELEC')) { dam = Math.floor(dam / 9); note = ' resists a lot'; } break;
    case 'fire': if (hasMFlag(r, 'IM_FIRE')) { dam = Math.floor(dam / 9); note = ' resists a lot'; } else if (hasMFlag(r, 'HURT_FIRE')) { dam *= 2; note = ' is hit hard'; } break;
    case 'cold': if (hasMFlag(r, 'IM_COLD')) { dam = Math.floor(dam / 9); note = ' resists a lot'; } else if (hasMFlag(r, 'HURT_COLD')) { dam *= 2; note = ' is hit hard'; } break;
    case 'pois': if (hasMFlag(r, 'IM_POIS')) { dam = Math.floor(dam / 9); note = ' resists a lot'; } break;
    case 'lite': if (hasMFlag(r, 'HURT_LITE')) { dam *= 2; note = ' cringes from the light'; } else dam = Math.floor(dam / 2); break;
    case 'dark': if (hasMFlag(r, 'UNDEAD') || hasMFlag(r, 'DEMON')) { dam = Math.floor(dam / 3); note = ' resists'; } break;
    case 'nether': if (hasMFlag(r, 'UNDEAD')) { dam = 0; note = ' is immune'; } else if (hasMFlag(r, 'EVIL')) { dam = Math.floor(dam / 2); note = ' resists somewhat'; } break;
    case 'holy': if (hasMFlag(r, 'EVIL')) { dam *= 2; note = ' is hit hard'; } else dam = Math.floor(dam / 4); break;
    case 'sound': if (!hasMFlag(r, 'NO_STUN')) m.stunned = 5 + randint1(10); break;
    case 'conf': if (!hasMFlag(r, 'NO_CONF')) m.confused = 5 + randint1(10); break;
    case 'chaos': if (!hasMFlag(r, 'NO_CONF')) m.confused = 5 + randint1(5); if (hasMFlag(r, 'DEMON')) { dam = Math.floor(dam / 2); note = ' resists'; } break;
    case 'nexus': if (hasMFlag(r, 'RES_NEXUS')) { dam = Math.floor(dam / 3); note = ' resists'; } else if (oneIn(3)) { teleportMonster(g, m, 10); } break;
    case 'disen': if (hasMFlag(r, 'RES_DISEN')) { dam = Math.floor(dam / 3); note = ' resists'; } break;
    case 'plasma': if (hasMFlag(r, 'RES_PLASMA')) { dam = Math.floor(dam / 3); note = ' resists'; } else if (!hasMFlag(r, 'NO_STUN')) m.stunned = 3 + randint1(6); break;
    case 'force': if (!hasMFlag(r, 'NO_STUN')) m.stunned = 3 + randint1(6); break;
    case 'inertia': if (!hasMFlag(r, 'UNIQUE') || oneIn(2)) m.slowed = 10 + randint1(10); break;
    case 'gravity': if (!hasMFlag(r, 'UNIQUE')) { teleportMonster(g, m, 5); m.slowed = 5 + randint1(5); } break;
    case 'ice': if (hasMFlag(r, 'IM_COLD')) { dam = Math.floor(dam / 9); note = ' resists a lot'; } else if (hasMFlag(r, 'HURT_COLD')) { dam *= 2; note = ' is hit hard'; } break;
    case 'disint': if (hasMFlag(r, 'HURT_ROCK')) { dam *= 2; note = ' loses some skin'; } break;
    case 'time': if (!hasMFlag(r, 'UNIQUE') && oneIn(3)) { m.maxhp = Math.max(1, m.maxhp - Math.floor(m.maxhp / 10)); } break;
    case 'water': if (r.sprite === 'elemental' && /water/i.test(r.name)) { dam = 0; note = ' is immune'; } else if (!hasMFlag(r, 'NO_STUN')) m.stunned = 2 + randint1(4); break;
    default: break;
  }
  if (dam <= 0) { if (seen && note) g.msg.add(`${name}${note}.`); return true; }
  if (seen && note) g.msg.add(`${name}${note}.`);
  // A kill here came from a spell, a wand or a breath, which is what a gravecaller feeds on.
  monsterTakeHit(g, m, dam, '', true, o.source === 'player' ? 'spell' : 'other');
  return true;
}
