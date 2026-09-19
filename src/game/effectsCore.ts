// The small set of player-state operations every other system needs: timed effects, bonus
// refresh, teleports and saving throws. Kept apart from effects.ts so combat.ts and monster.ts can
// import it without a cycle.
import { type Timed, type Monster, F, T } from './types.ts';
import { computeBonuses, recomputeHp, recomputeMana } from './player.ts';
import { tileAt, isEmptyFloor, hasFlag, updateView, monsterAt } from './level.ts';
import { randint0, randint1, distance } from './util.ts';
import { disturb } from './world.ts';
import type { Game } from './state.ts';

export function refreshBonuses(g: Game): void {
  g.bonuses = computeBonuses(g.player);
  recomputeHp(g.player, g.bonuses);
  recomputeMana(g.player, g.bonuses);
}

const TIMED_ON: Partial<Record<Timed, [string, string]>> = {
  fast: ['You feel yourself moving faster!', '#a0ffa0'], slow: ['You feel yourself moving slower!', '#ff8080'], blind: ['You are blind!', '#ff8080'],
  paralyzed: ['You are paralysed!', '#ff8080'], confused: ['You are confused!', '#ff8080'], afraid: ['You are terrified!', '#ff8080'], image: ['You feel drugged!', '#ff80ff'],
  poisoned: ['You are poisoned!', '#a0ffa0'], cut: ['You have been cut!', '#ff8080'], stun: ['You have been stunned.', '#ff8080'], protevil: ['You feel safe from evil!', '#a0ffa0'],
  invuln: ['You feel invulnerable!', '#a0ffa0'], hero: ['You feel like a hero!', '#a0ffa0'], shero: ['You feel like a killing machine!', '#a0ffa0'], shield: ['A mystic shield forms around your body!', '#a0ffa0'],
  blessed: ['You feel righteous!', '#a0ffa0'], sinvis: ['Your eyes feel very sensitive!', '#a0ffa0'], sinfra: ['Your eyes begin to tingle!', '#a0ffa0'], oppose_acid: ['You feel resistant to acid!', '#a0ffa0'],
  oppose_elec: ['You feel resistant to electricity!', '#a0ffa0'], oppose_fire: ['You feel resistant to fire!', '#a0ffa0'], oppose_cold: ['You feel resistant to cold!', '#a0ffa0'], oppose_pois: ['You feel resistant to poison!', '#a0ffa0'],
  telepathy: ['Your mind expands!', '#a0ffa0'], recall: ['The air about you becomes charged...', '#ffd040'], deep_descent: ['The floor opens beneath you!', '#ffd040'],
};
const TIMED_OFF: Partial<Record<Timed, string>> = {
  fast: 'You feel yourself slow down.', slow: 'You feel yourself speed up.', blind: 'You can see again.', paralyzed: 'You can move again.', confused: 'You feel less confused now.',
  afraid: 'You feel bolder now.', image: 'You can see clearly again.', poisoned: 'You are no longer poisoned.', cut: 'You are no longer bleeding.', stun: 'You are no longer stunned.',
  protevil: 'You no longer feel safe from evil.', invuln: 'You feel vulnerable once more.', hero: 'The heroism wears off.', shero: 'You feel less berserk.', shield: 'Your mystic shield crumbles away.',
  blessed: 'The prayer has expired.', sinvis: 'Your eyes feel less sensitive.', sinfra: 'Your eyes stop tingling.', oppose_acid: 'You feel less resistant to acid.', oppose_elec: 'You feel less resistant to electricity.',
  oppose_fire: 'You feel less resistant to fire.', oppose_cold: 'You feel less resistant to cold.', oppose_pois: 'You feel less resistant to poison.', telepathy: 'Your mind retracts.', recall: 'A tension leaves the air around you...',
};

/** Set a timed effect to `v` turns, with the on/off messages. Returns true if something changed. */
export function setTimed(g: Game, t: Timed, v: number): boolean {
  const p = g.player;
  v = Math.max(0, Math.min(10000, Math.floor(v)));
  const was = p.timed[t];
  if (was === v) return false;
  if (t === 'paralyzed' && g.bonuses.flags.has('FREE_ACT') && v > 0) return false;
  if (t === 'afraid' && (g.bonuses.flags.has('RES_FEAR') || p.timed.hero || p.timed.shero) && v > 0) return false;
  if (t === 'blind' && g.bonuses.flags.has('RES_BLIND') && v > 0) return false;
  if (t === 'confused' && g.bonuses.flags.has('RES_CONF') && v > 0) return false;
  if (was === 0 && v > 0) { const m = TIMED_ON[t]; if (m) g.msg.add(m[0], m[1]); }
  if (was > 0 && v === 0) { const m = TIMED_OFF[t]; if (m) g.msg.add(m); }
  p.timed[t] = v;
  if (was === 0 || v === 0) { refreshBonuses(g); if (t === 'blind') updateView(g.level, p.x, p.y, g.bonuses.lightRadius, v > 0); }
  if (v > 0) disturb(g);
  return true;
}

export function playerSavingThrow(g: Game): boolean { return randint0(100) < g.bonuses.skills.save; }

/** Teleport the player up to `dist` grids away (Angband's teleport_player: tries far first). */
export function teleportPlayer(g: Game, dist: number): void {
  const p = g.player, lv = g.level;
  let min = Math.floor(dist / 2);
  for (let tries = 0; tries < 1000; tries++) {
    if (tries % 100 === 99) { dist *= 2; min = Math.floor(min / 2); }
    const x = p.x + randint0(dist * 2 + 1) - dist, y = p.y + randint0(dist * 2 + 1) - dist;
    const d = distance(p.x, p.y, x, y);
    if (d > dist || d < min) continue;
    if (!isEmptyFloor(lv, x, y) && !(lv.depth === 0 && (tileAt(lv, x, y) === T.GRASS || tileAt(lv, x, y) === T.ROAD) && !monsterAt(lv, x, y))) continue;
    if (hasFlag(lv, x, y, F.VAULT)) continue;
    movePlayerTo(g, x, y);
    return;
  }
}
export function movePlayerTo(g: Game, x: number, y: number): void {
  const p = g.player;
  p.vx = undefined; p.vy = undefined;
  p.x = x; p.y = y;
  g.flowDirty = true;
  disturb(g);
  updateView(g.level, p.x, p.y, g.bonuses.lightRadius, p.timed.blind > 0);
}
export function teleportMonster(g: Game, m: Monster, dist: number): void {
  const lv = g.level;
  let min = Math.floor(dist / 2);
  for (let tries = 0; tries < 500; tries++) {
    if (tries % 100 === 99) { dist *= 2; min = Math.floor(min / 2); }
    const x = m.x + randint0(dist * 2 + 1) - dist, y = m.y + randint0(dist * 2 + 1) - dist;
    const d = distance(m.x, m.y, x, y);
    if (d > dist || d < min) continue;
    if (!isEmptyFloor(lv, x, y) && !(lv.depth === 0 && (tileAt(lv, x, y) === T.GRASS || tileAt(lv, x, y) === T.ROAD) && !monsterAt(lv, x, y))) continue;
    if (x === g.player.x && y === g.player.y) continue;
    m.x = x; m.y = y; m.vx = undefined; m.vy = undefined;
    return;
  }
}
/** Teleport the monster next to the player (TELE_TO), or the player next to the monster. */
export function teleportPlayerTo(g: Game, tx: number, ty: number): void {
  const lv = g.level;
  for (let d = 1; d < 10; d++) for (let tries = 0; tries < 30; tries++) {
    const x = tx + randint0(d * 2 + 1) - d, y = ty + randint0(d * 2 + 1) - d;
    if (isEmptyFloor(lv, x, y) && !hasFlag(lv, x, y, F.VAULT)) { movePlayerTo(g, x, y); return; }
  }
}
export function randomDir(): number { let d = randint1(9); while (d === 5) d = randint1(9); return d; }
