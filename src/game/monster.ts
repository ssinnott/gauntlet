// Monster creation, placement, and the per-turn AI: waking, fleeing, group tactics, ranged
// spells and breath, door handling, item pickup, generators. Angband's monster1/2.c and melee2.c.
import { type Level, type Monster, type MonsterRace, type MonsterFlag, type Pos, T, F, DIR_DX, DIR_DY, isPassable, isWall, isVein } from './types.ts';
import { MONSTERS, MONSTER_BY_ID } from './data/monsters.ts';
import { tileAt, setTile, monsterAt, inBounds, hasFlag, addFlag, los, computeFlow, passable, isCleanFloor, auxAt, setAux, playerCanSee, itemsAt } from './level.ts';
import { randint0, randint1, oneIn, weightedPick, distance } from './util.ts';
import type { Game } from './state.ts';
import { monsterMelee } from './combat.ts';
import { monsterCastSpell } from './monsterSpells.ts';
import { makeObject, makeGold } from './items.ts';
import { dropNear } from './world.ts';
import { disturb } from './world.ts';
import { noteSight } from './lore.ts';
import { RACE_BY_ID } from './data/races.ts';

export function raceOf(m: Monster): MonsterRace { return MONSTER_BY_ID[m.race]; }
export function hasMFlag(r: MonsterRace, f: MonsterFlag): boolean { return r.flags.includes(f); }
export function monsterName(m: Monster, capital = true): string {
  const r = raceOf(m);
  const s = hasMFlag(r, 'UNIQUE') ? r.name : 'the ' + r.name;
  return capital ? s[0].toUpperCase() + s.slice(1) : s;
}
export function monsterNameVisible(g: Game, m: Monster, capital = true): string {
  if (!m.visible) return capital ? 'It' : 'it';
  return monsterName(m, capital);
}

export function createMonster(g: Game, raceId: string, x: number, y: number, sleep: boolean, lv: Level = g.level): Monster | null {
  const r = MONSTER_BY_ID[raceId];
  if (!r) throw new Error('unknown monster race: ' + raceId);
  // Never on top of the player or another monster: slide to the nearest free grid, or give up.
  const blocked = (gx: number, gy: number) => (lv === g.level && gx === g.player.x && gy === g.player.y) || !!monsterAt(lv, gx, gy) || !(isPassable(tileAt(lv, gx, gy)) || (lv.depth === 0 && tileAt(lv, gx, gy) === T.GRASS));
  if (blocked(x, y)) {
    let found = false;
    for (let rad = 1; rad <= 5 && !found; rad++) {
      const cands: Pos[] = [];
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        if (!inBounds(lv, x + dx, y + dy) || blocked(x + dx, y + dy)) continue;
        if (isVein(tileAt(lv, x + dx, y + dy))) continue;
        cands.push({ x: x + dx, y: y + dy });
      }
      if (cands.length) { const c = cands[randint0(cands.length)]; x = c.x; y = c.y; found = true; }
    }
    if (!found) return null;
  }
  const hp = hasMFlag(r, 'UNIQUE') ? r.hp : Math.max(1, Math.round(r.hp * (0.85 + randint0(31) / 100)));
  const m: Monster = {
    id: g.nextMonsterId++, race: raceId, x, y, hp, maxhp: hp, energy: randint0(50), speed: r.speed, sleep: 0,
    stunned: 0, confused: 0, afraid: 0, hasted: 0, slowed: 0, held: [], facing: oneIn(2) ? 1 : -1, visible: false, detected: false, spawnTimer: r.spawnEvery || 0,
  };
  if (sleep && r.sleep) m.sleep = r.sleep * 2 + randint1(r.sleep * 10);
  if (hasMFlag(r, 'FORCE_SLEEP') && sleep) m.sleep = Math.max(m.sleep, 100 + randint1(200));
  lv.monsters.push(m);
  return m;
}

/** Pick a race for depth (Angband's get_mon_num, with the out-of-depth boost). */
export function pickRace(g: Game, depth: number, filter?: (r: MonsterRace) => boolean): MonsterRace | undefined {
  let lev = depth;
  if (lev > 0 && oneIn(25)) lev += Math.max(1, Math.floor(lev / 4)) + randint1(3) - 1;
  if (lev > 0 && oneIn(50)) lev += Math.max(1, Math.floor(lev / 2));
  const cands = MONSTERS.filter(r => {
    if (r.depth > lev || (depth > 0 && r.depth === 0)) return false;
    if (depth === 0 && r.depth !== 0) return false;
    if (hasMFlag(r, 'GENERATOR')) return false;
    if (hasMFlag(r, 'QUESTOR')) return false;
    if (hasMFlag(r, 'UNIQUE') && (g.uniquesDead.includes(r.id) || (g.level && g.level.monsters.some(m => m.race === r.id)))) return false;
    if (hasMFlag(r, 'FORCE_DEPTH') && r.depth > depth) return false;
    if (filter && !filter(r)) return false;
    return true;
  });
  return weightedPick(cands, r => 100 / r.rarity * (r.depth >= lev - 6 ? 2 : 1) * (hasMFlag(r, 'UNIQUE') ? 0.5 : 1));
}

export function placeMonster(g: Game, lv: Level, depth: number, x: number, y: number, sleep: boolean, group: boolean, filter?: (r: MonsterRace) => boolean): Monster | null {
  if (!isCleanFloor(lv, x, y) && !(depth === 0 && (tileAt(lv, x, y) === T.GRASS || tileAt(lv, x, y) === T.ROAD) && !monsterAt(lv, x, y))) return null;
  const r = pickRace(g, depth, filter);
  if (!r) return null;
  return placeRace(g, lv, r, x, y, sleep, group);
}
export function placeRace(g: Game, lv: Level, r: MonsterRace, x: number, y: number, sleep: boolean, group: boolean): Monster | null {
  const m = createMonster(g, r.id, x, y, sleep, lv);
  if (!m) return null;
  if (group && (hasMFlag(r, 'FRIENDS') || hasMFlag(r, 'GROUP'))) {
    const n = 2 + randint0(6);
    placeGroup(g, lv, r, x, y, n, sleep);
  }
  if (group && hasMFlag(r, 'ESCORT') && r.escorts && r.escorts.length) {
    const n = 3 + randint0(6);
    for (let i = 0; i < n; i++) {
      const er = MONSTER_BY_ID[r.escorts[randint0(r.escorts.length)]];
      if (!er) continue;
      const p = nearFloor(lv, x, y, 4);
      if (p) createMonster(g, er.id, p.x, p.y, sleep, lv);
    }
  }
  return m;
}
function placeGroup(g: Game, lv: Level, r: MonsterRace, x: number, y: number, n: number, sleep: boolean): void {
  for (let i = 0; i < n; i++) { const p = nearFloor(lv, x, y, 3); if (p) createMonster(g, r.id, p.x, p.y, sleep, lv); }
}
export function nearFloor(lv: Level, x: number, y: number, radius: number, avoid: Pos | null = null): Pos | null {
  for (let t = 0; t < 30; t++) {
    const nx = x + randint0(radius * 2 + 1) - radius, ny = y + randint0(radius * 2 + 1) - radius;
    if (avoid && nx === avoid.x && ny === avoid.y) continue;
    if (isCleanFloor(lv, nx, ny) || (lv.depth === 0 && (tileAt(lv, nx, ny) === T.GRASS || tileAt(lv, nx, ny) === T.ROAD) && !monsterAt(lv, nx, ny))) return { x: nx, y: ny };
  }
  return null;
}

/** Themed nests: pick a race by flag family. */
export function themedFilter(theme: string): (r: MonsterRace) => boolean {
  switch (theme) {
    case 'animal': return r => hasMFlag(r, 'ANIMAL') && !hasMFlag(r, 'UNIQUE');
    case 'kobold': return r => r.sprite === 'kobold' && !hasMFlag(r, 'UNIQUE');
    case 'jelly': return r => (r.sprite === 'jelly' || r.sprite === 'mold' || r.sprite === 'blob') && !hasMFlag(r, 'UNIQUE');
    case 'orc': return r => hasMFlag(r, 'ORC') && !hasMFlag(r, 'UNIQUE');
    case 'troll': return r => hasMFlag(r, 'TROLL') && !hasMFlag(r, 'UNIQUE');
    case 'undead': return r => hasMFlag(r, 'UNDEAD') && !hasMFlag(r, 'UNIQUE');
    case 'giant': return r => hasMFlag(r, 'GIANT') && !hasMFlag(r, 'UNIQUE');
    case 'demon': return r => hasMFlag(r, 'DEMON') && !hasMFlag(r, 'UNIQUE');
    case 'dragon': return r => hasMFlag(r, 'DRAGON') && !hasMFlag(r, 'UNIQUE');
    case 'hound': return r => hasMFlag(r, 'HOUND') && !hasMFlag(r, 'UNIQUE');
    case 'spider': return r => (hasMFlag(r, 'SPIDER') || r.sprite === 'spider') && !hasMFlag(r, 'UNIQUE');
    case 'hydra': return r => (hasMFlag(r, 'HYDRA') || r.sprite === 'hydra') && !hasMFlag(r, 'UNIQUE');
    case 'angel': return r => (hasMFlag(r, 'ANGEL') || r.sprite === 'angel') && !hasMFlag(r, 'UNIQUE');
    case 'wraith': return r => hasMFlag(r, 'WRAITH') && !hasMFlag(r, 'UNIQUE');
    case 'chapel': return r => (r.sprite === 'rig' && /priest|acolyte|cleric|monk|templar|paladin|bishop/i.test(r.name)) && !hasMFlag(r, 'UNIQUE');
    case 'mage': return r => (r.sprite === 'rig' && /mage|wizard|sorcerer|illusionist|enchant|necroman|warlock|shaman|conjurer/i.test(r.name)) && !hasMFlag(r, 'UNIQUE');
    case 'golem': return r => r.sprite === 'golem' && !hasMFlag(r, 'UNIQUE');
    case 'elemental': return r => (r.sprite === 'elemental' || r.sprite === 'vortex') && !hasMFlag(r, 'UNIQUE');
    default: return () => true;
  }
}

export function placeGenerator(g: Game, lv: Level, depth: number, x: number, y: number): void {
  const gens = MONSTERS.filter(r => hasMFlag(r, 'GENERATOR') && r.depth <= depth + 2);
  if (!gens.length) return;
  // Prefer the deepest generator that fits.
  gens.sort((a, b) => b.depth - a.depth);
  const r = oneIn(3) && gens.length > 1 ? gens[1] : gens[0];
  if (isCleanFloor(lv, x, y)) createMonster(g, r.id, x, y, false, lv);
}

// ---------------------------------------------------------------------------------------------
// Energy and the per-turn loop

/** Angband's extract_energy table, indexed by speed + 110 (so 110 = normal = 10 energy per game turn). */
const EXTRACT_ENERGY = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 7, 8, 9,
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 36, 37, 37, 38, 38, 39, 39, 40, 40, 40, 41, 41, 41,
  42, 42, 42, 43, 43, 43, 44, 44, 44, 44, 45, 45, 45, 45, 45, 46, 46, 46, 46, 46, 47, 47, 47, 47, 47, 48, 48, 48, 48, 48, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49,
];
export function energyGain(speed: number): number {
  const i = Math.max(0, Math.min(199, Math.floor(speed) + 110));
  return EXTRACT_ENERGY[i];
}
export function monsterSpeed(m: Monster): number { return m.speed + (m.hasted ? 10 : 0) - (m.slowed ? 10 : 0); }

/** Refresh which monsters the player can see (visible = seen normally, or by telepathy / infra). */
export function updateMonsterVisibility(g: Game): void {
  const p = g.player, lv = g.level, b = g.bonuses;
  const telepathy = b.flags.has('TELEPATHY');
  const seeInvis = b.flags.has('SEE_INVIS');
  for (const m of lv.monsters) {
    const r = raceOf(m);
    let vis = false;
    if (telepathy && !hasMFlag(r, 'EMPTY_MIND') && distance(p.x, p.y, m.x, m.y) <= 20 && !(hasMFlag(r, 'WEIRD_MIND') && !oneIn(10))) vis = true;
    if (!vis && !p.timed.blind && playerCanSee(lv, m.x, m.y)) { if (!hasMFlag(r, 'INVISIBLE') || seeInvis) vis = true; }
    if (!vis && !p.timed.blind && hasFlag(lv, m.x, m.y, F.VIEW) && !hasMFlag(r, 'COLD_BLOOD')) {
      // Infravision: warm-blooded monsters show up in the dark within the race's radius (plus gear and potions).
      const infra = RACE_BY_ID[p.race].infra + b.infra;
      if (infra > 0 && distance(p.x, p.y, m.x, m.y) <= infra && (!hasMFlag(r, 'INVISIBLE') || seeInvis)) vis = true;
    }
    if (vis) m.detected = false;
    const was = m.visible;
    m.visible = vis || m.detected;
    if (m.visible && !was) {
      noteSight(g, m);
      // A monster coming into view interrupts running, resting and travel (Angband's disturb).
      if (vis && g.options.disturbNear && (g.running || g.resting || g.travel || g.repeating)) disturb(g);
    }
  }
}

/** One monster's action when it has enough energy. */
export function monsterTurn(g: Game, m: Monster): void {
  const r = raceOf(m);
  const p = g.player, lv = g.level;
  const dist = distance(p.x, p.y, m.x, m.y);
  // Sleeping monsters may wake from noise; stealthy players keep them dozing.
  if (m.sleep > 0) {
    if (dist > 50 + r.vision) return;
    const noise = Math.max(1, 30 - g.bonuses.skills.stealth * 3 + (g.bonuses.flags.has('AGGRAVATE') ? 100 : 0));
    if (randint0(1024) < noise * 8 || g.bonuses.flags.has('AGGRAVATE')) {
      const d = randint0(dist + 1) + 1;
      m.sleep = Math.max(0, m.sleep - d * 10);
      if (m.sleep === 0 && m.visible) g.msg.add(`${monsterName(m)} wakes up.`);
    }
    return;
  }
  // Stun / confusion / fear timers.
  if (m.stunned) { if (oneIn(5)) m.stunned = 0; else if (oneIn(2)) return; }
  if (m.confused && oneIn(3)) m.confused = 0;
  if (m.afraid && oneIn(6) && m.hp > m.maxhp / 4) { m.afraid = 0; if (m.visible) g.msg.add(`${monsterName(m)} recovers its courage.`); }
  if (m.hasted && oneIn(20)) m.hasted = 0;
  if (m.slowed && oneIn(20)) m.slowed = 0;
  // Regeneration.
  if (m.hp < m.maxhp && (hasMFlag(r, 'REGENERATE') ? oneIn(5) : oneIn(20))) m.hp = Math.min(m.maxhp, m.hp + Math.max(1, Math.floor(m.maxhp / 20)));

  // Generators just spawn.
  if (hasMFlag(r, 'GENERATOR')) {
    if (dist > 25) return;
    if (m.spawnTimer > 0) { m.spawnTimer--; return; }
    if (!r.spawns) return;
    const nearby = lv.monsters.filter(o => o.race === r.spawns && distance(o.x, o.y, m.x, m.y) <= 8).length;
    if (nearby >= 6 || lv.monsters.length > 250) { m.spawnTimer = r.spawnEvery || 20; return; }
    const pos = nearFloor(lv, m.x, m.y, 2);
    if (pos) {
      const s = createMonster(g, r.spawns, pos.x, pos.y, false);
      if (s) s.energy = 0;
      if (s && m.visible) { g.msg.add(`${monsterName(m)} spawns ${monsterName(s, false)}!`); g.fx.push({ type: 'flash', x: pos.x, y: pos.y, color: r.color2 || r.color }); }
      disturb(g);
    }
    m.spawnTimer = r.spawnEvery || 20;
    return;
  }
  // Breeders.
  if (hasMFlag(r, 'MULTIPLY') && lv.monsters.length < 200) {
    let k = 0;
    for (let d = 1; d <= 9; d++) if (d !== 5 && monsterAt(lv, m.x + DIR_DX[d], m.y + DIR_DY[d])) k++;
    if (k < 4 && oneIn(8 + k * 8)) {
      const pos = nearFloor(lv, m.x, m.y, 1);
      if (pos) { const s = createMonster(g, r.id, pos.x, pos.y, false); if (s) { s.energy = 0; if (m.visible) g.msg.add(`${monsterName(m)} breeds explosively!`); } }
    }
  }
  // Fear and low hp: flee.
  if (!m.afraid && !hasMFlag(r, 'NO_FEAR') && m.hp < m.maxhp / 10 && oneIn(3)) { m.afraid = 10 + randint1(20); if (m.visible) g.msg.add(`${monsterName(m)} flees in terror!`); }

  const canSee = dist <= 20 && los(lv, m.x, m.y, p.x, p.y) && !p.timed.blind ? true : dist <= 20 && los(lv, m.x, m.y, p.x, p.y);
  // Spellcasting.
  if (r.spells && r.spells.length && r.spellFreq && canSee && !m.confused && oneIn(r.spellFreq) && dist <= 20) {
    if (monsterCastSpell(g, m)) return;
  }
  if (hasMFlag(r, 'NEVER_MOVE')) {
    if (dist <= 1 && !hasMFlag(r, 'NEVER_BLOW')) monsterMelee(g, m);
    return;
  }
  // Decide a direction.
  let dx = 0, dy = 0;
  const erratic = (hasMFlag(r, 'RAND_50') && randint0(100) < 50) || (hasMFlag(r, 'RAND_25') && randint0(100) < 25) || m.confused > 0;
  if (erratic) { const d = randint1(9); dx = DIR_DX[d]; dy = DIR_DY[d]; }
  else if (m.afraid) {
    // Move up the flow gradient (away).
    const best = bestFlowStep(g, m, true);
    if (best) { dx = best.x - m.x; dy = best.y - m.y; } else { dx = Math.sign(m.x - p.x); dy = Math.sign(m.y - p.y); }
  } else {
    if (dist > r.vision + 10 && !hasMFlag(r, 'SMART') && !g.bonuses.flags.has('AGGRAVATE')) {
      // Out of range: wander a little or stay put.
      if (!oneIn(3)) return;
      const d = randint1(9); dx = DIR_DX[d]; dy = DIR_DY[d];
    } else {
      const best = bestFlowStep(g, m, false);
      if (best) { dx = best.x - m.x; dy = best.y - m.y; } else { dx = Math.sign(p.x - m.x); dy = Math.sign(p.y - m.y); }
      // Pack animals try to surround rather than queue in corridors.
      if (hasMFlag(r, 'FRIENDS') && dist <= 5 && oneIn(3) && !(dist <= 1)) { const d = randint1(9); dx = DIR_DX[d]; dy = DIR_DY[d]; }
    }
  }
  if (dx === 0 && dy === 0) return;
  tryMove(g, m, dx, dy);
}

function bestFlowStep(g: Game, m: Monster, flee: boolean): Pos | null {
  if (!g.flow) return null;
  const lv = g.level, w = lv.w;
  const here = g.flow[m.y * w + m.x];
  let best: Pos | null = null, bestV = flee ? here : here;
  // Try each neighbour in a random order so equal-cost grids vary.
  const start = randint0(8);
  for (let i = 0; i < 8; i++) {
    const d = [1, 2, 3, 4, 6, 7, 8, 9][(start + i) % 8];
    const nx = m.x + DIR_DX[d], ny = m.y + DIR_DY[d];
    if (!inBounds(lv, nx, ny)) continue;
    const v = g.flow[ny * w + nx];
    if (v === 0xffff) continue;
    if (flee ? v > bestV : v < bestV) { bestV = v; best = { x: nx, y: ny }; }
  }
  if (here === 0xffff && !flee) return null;
  return best;
}

/** Attempt a step: attack the player, open/bash doors, push past weaker monsters, eat walls. */
function tryMove(g: Game, m: Monster, dx: number, dy: number): void {
  const r = raceOf(m), lv = g.level, p = g.player;
  const nx = m.x + dx, ny = m.y + dy;
  if (dx !== 0) m.facing = dx > 0 ? 1 : -1;
  if (nx === p.x && ny === p.y) {
    if (hasFlag(lv, nx, ny, F.GLYPH)) {
      if (r.depth > 0 && randint0(550) < r.depth) { lv.flags[ny * lv.w + nx] &= ~F.GLYPH; g.msg.add('The rune of protection is broken!', '#ff8080'); }
      else return;
    }
    if (!hasMFlag(r, 'NEVER_BLOW') && !m.afraid) monsterMelee(g, m);
    return;
  }
  if (!inBounds(lv, nx, ny)) return;
  const t = tileAt(lv, nx, ny);
  if (t === T.PERM) return;
  if (hasFlag(lv, nx, ny, F.GLYPH)) {
    // Angband's BREAK_GLYPH: level against 550.
    if (r.depth > 0 && randint0(550) < r.depth) { lv.flags[ny * lv.w + nx] &= ~F.GLYPH; if (playerCanSee(lv, nx, ny)) g.msg.add('The rune of protection is broken!', '#ff8080'); }
    else return;
  }
  if (isWall(t) && t !== T.SECRET_DOOR) {
    if (hasMFlag(r, 'PASS_WALL')) { /* passes */ }
    else if (hasMFlag(r, 'KILL_WALL')) { setTile(lv, nx, ny, T.FLOOR); if (playerCanSee(lv, nx, ny)) g.msg.add('You hear grinding.'); }
    else return;
  } else if (t === T.DOOR_CLOSED || t === T.SECRET_DOOR) {
    if (hasMFlag(r, 'PASS_WALL')) { /* passes */ }
    else if (hasMFlag(r, 'OPEN_DOOR') && auxAt(lv, nx, ny) === 0) { setTile(lv, nx, ny, T.DOOR_OPEN); if (playerCanSee(lv, nx, ny)) { g.msg.add('You hear a door open.'); disturb(g); } return; }
    else if (hasMFlag(r, 'OPEN_DOOR') && auxAt(lv, nx, ny) < 100 && randint0(auxAt(lv, nx, ny) * 2 + 2) === 0) { setAux(lv, nx, ny, 0); setTile(lv, nx, ny, T.DOOR_OPEN); return; }
    else if (hasMFlag(r, 'BASH_DOOR') && randint0(m.maxhp / 10 + 2) > 5 + doorPower(auxAt(lv, nx, ny)) * 3) { setTile(lv, nx, ny, T.DOOR_BROKEN); setAux(lv, nx, ny, 0); g.msg.add('You hear a door burst open!'); disturb(g); }
    else return;
  } else if (t === T.RUBBLE) {
    if (hasMFlag(r, 'KILL_WALL') || hasMFlag(r, 'PASS_WALL')) { if (hasMFlag(r, 'KILL_WALL')) setTile(lv, nx, ny, T.FLOOR); }
    else return;
  } else if (!isPassable(t) && t !== T.TREE) return;
  else if (t === T.TREE && !hasMFlag(r, 'PASS_WALL')) return;
  const other = monsterAt(lv, nx, ny);
  if (other) {
    const or = raceOf(other);
    if (hasMFlag(r, 'KILL_BODY') && r.exp > or.exp && !hasMFlag(or, 'UNIQUE')) { removeMonster(g, other); if (m.visible) g.msg.add(`${monsterName(m)} tramples ${monsterName(other, false)}.`); }
    else if (r.exp > or.exp && oneIn(2)) { other.x = m.x; other.y = m.y; other.vx = undefined; }
    else return;
  }
  m.vx = m.x; m.vy = m.y;
  m.x = nx; m.y = ny;
  // Item interaction.
  const here = itemsAt(lv, nx, ny);
  if (here.length && (hasMFlag(r, 'TAKE_ITEM') || hasMFlag(r, 'KILL_ITEM'))) {
    for (const fi of here) {
      lv.items.splice(lv.items.indexOf(fi), 1);
      if (hasMFlag(r, 'TAKE_ITEM')) { m.held.push(fi.item); if (m.visible) g.msg.add(`${monsterName(m)} picks something up.`); }
      else if (m.visible) g.msg.add(`${monsterName(m)} crushes something.`);
    }
  }
  if (m.visible && m.sleep === 0 && distance(p.x, p.y, m.x, m.y) <= 1 && !p.timed.paralyzed && lv.depth > 0) disturb(g);
}

/** Lock strength of a door: 1..7 for locks, 2 per spike for jammed doors (aux 100+). */
function doorPower(aux: number): number { return aux >= 100 ? (aux - 100 + 1) * 2 : aux; }

export function removeMonster(g: Game, m: Monster): void {
  const i = g.level.monsters.indexOf(m);
  if (i >= 0) g.level.monsters.splice(i, 1);
}

/** Drops on death: gold and objects per the DROP_* flags. */
export function monsterDrops(g: Game, m: Monster): void {
  const r = raceOf(m), lv = g.level;
  let n = 0;
  if (hasMFlag(r, 'DROP_60') && randint0(100) < 60) n++;
  if (hasMFlag(r, 'DROP_90') && randint0(100) < 90) n++;
  if (hasMFlag(r, 'DROP_1D2')) n += randint1(2);
  if (hasMFlag(r, 'DROP_2D2')) n += randint1(2) + randint1(2);
  if (hasMFlag(r, 'DROP_4D2')) n += randint1(2) + randint1(2) + randint1(2) + randint1(2);
  const good = hasMFlag(r, 'DROP_GOOD'), great = hasMFlag(r, 'DROP_GREAT');
  const level = Math.floor((r.depth + lv.depth) / 2);
  for (let i = 0; i < n; i++) {
    const gold = hasMFlag(r, 'ONLY_GOLD') || (!hasMFlag(r, 'ONLY_ITEM') && oneIn(2) && !good);
    const it = gold ? makeGold(level) : makeObject(level, good, great);
    if (it) dropNear(g, it, m.x, m.y);
  }
  for (const it of m.held) dropNear(g, it, m.x, m.y);
  m.held = [];
}

/** Rebuild the flow map if the player moved. */
export function ensureFlow(g: Game): void {
  if (!g.flowDirty && g.flow) return;
  g.flow = computeFlow(g.level, g.player.x, g.player.y, 40, g.flow || undefined);
  g.flowDirty = false;
}
