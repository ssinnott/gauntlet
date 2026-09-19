// The autoplay bot: a hero that plays itself with exactly the commands a player has. No map
// cheats, no free healing -- it only knows what the player knows (findPath walks remembered
// grids), and every action goes through commands.ts, so it takes its turn like anyone else.
// `=` toggles it as the Autoplay game option, ctrl+A does the same from the map; tools/sim.ts
// drives the same brain headless so `npm run check` plays a few characters with it.
import { FOOD_HUNGRY } from '../constants.ts';
import { T, F, DIR_DX, DIR_DY, dirOf, isPassable, isShop, type Item, type Monster, type Pos, type Effect, type SpellDef } from './types.ts';
import { tileAt, flagAt, monsterAt, itemsAt, inBounds, los } from './level.ts';
import { kindOf, isKnown, isAmmo, isWearable, wieldSlot, itemName, getNextItemId, setNextItemId } from './items.ts';
import { maintainStore, storeBuy, storeSell, storeWants, buyPrice, sellPrice } from './stores.ts';
import { refreshBonuses } from './effectsCore.ts';
import { randint1, distance } from './util.ts';
import * as C from './commands.ts';
import type { Game } from './state.ts';

/** Quaff and run below this share of maximum hit points. */
const PANIC = 0.45;
/** Rest below this share, when nothing is watching. */
const HURT = 0.7;
/** Gold kept back when shopping, so there is always something for a potion. */
const RESERVE = 20;
/** What the bot likes to leave town with. */
const SHOPPING: [string, number][] = [['ration', 5], ['potion_clw', 6], ['scroll_phase_door', 4], ['flask_oil', 15], ['torch', 3]];

// -----------------------------------------------------------------------------------------
// Looking around

function visibleMonsters(g: Game, range = 10): Monster[] {
  const p = g.player;
  return g.level.monsters.filter(m => m.visible && distance(p.x, p.y, m.x, m.y) <= range);
}
/** The closest monster the bot can see and shoot at. */
function nearestTarget(g: Game): Monster | null {
  const p = g.player;
  let best: Monster | null = null, bd = 1e9;
  for (const m of visibleMonsters(g)) {
    const d = distance(p.x, p.y, m.x, m.y);
    if (d < bd && los(g.level, p.x, p.y, m.x, m.y)) { bd = d; best = m; }
  }
  return best;
}
/** Keypad direction of an adjacent monster worth hitting, or 0. */
function adjacentDir(g: Game): number {
  const p = g.player;
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const m = monsterAt(g.level, p.x + DIR_DX[d], p.y + DIR_DY[d]);
    if (m && (m.visible || m.detected)) return d;
  }
  return 0;
}
function hasEffect(e: Effect | undefined, kind: Effect['kind']): boolean {
  if (!e) return false;
  if (e.kind === kind) return true;
  return e.kind === 'seq' && e.effects.some(s => hasEffect(s, kind));
}
/** Items the bot understands: unknown flavours are never drunk blind. */
function known(g: Game, it: Item): boolean { return isKnown(it, g.flavors); }
function findItem(g: Game, pred: (it: Item) => boolean): Item | null {
  for (const it of g.player.inven) if (pred(it)) return it;
  return null;
}
function countKind(g: Game, kindId: string): number {
  let n = 0;
  for (const it of [...g.player.inven, ...g.player.quiver]) if (it.kind === kindId) n += it.number;
  return n;
}
function healingPotion(g: Game): Item | null {
  return findItem(g, it => kindOf(it).tval === 'potion' && known(g, it) && hasEffect(kindOf(it).effect, 'heal'));
}
function escapeScroll(g: Game): Item | null {
  return findItem(g, it => kindOf(it).tval === 'scroll' && known(g, it) && hasEffect(kindOf(it).effect, 'teleport') && !g.player.timed.blind && !g.player.timed.confused);
}
function foodItem(g: Game): Item | null {
  return findItem(g, it => { const k = kindOf(it); return k.tval === 'food' && (k.pval || 0) >= 500 && !k.id.startsWith('mushroom_'); });
}

// -----------------------------------------------------------------------------------------
// Exploring: the nearest remembered grid that still has unseen ground beside it.

function unknownNeighbour(g: Game, x: number, y: number): number {
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
    if (!inBounds(g.level, nx, ny)) continue;
    if (probed.has(ny * g.level.w + nx)) continue;
    if (!(flagAt(g.level, nx, ny) & F.MARK)) return d;
  }
  return 0;
}
/** Breadth-first over remembered, walkable grids; returns the closest frontier. */
function frontier(g: Game): Pos | null {
  const lv = g.level, p = g.player, w = lv.w;
  const seen = new Uint8Array(lv.w * lv.h);
  const qx: number[] = [p.x], qy: number[] = [p.y];
  seen[p.y * w + p.x] = 1;
  for (let head = 0; head < qx.length; head++) {
    const x = qx[head], y = qy[head];
    if ((x !== p.x || y !== p.y) && unknownNeighbour(g, x, y)) return { x, y };
    for (let d = 1; d <= 9; d++) {
      if (d === 5) continue;
      const nx = x + DIR_DX[d], ny = y + DIR_DY[d];
      if (!inBounds(lv, nx, ny) || seen[ny * w + nx]) continue;
      seen[ny * w + nx] = 1;
      const t = tileAt(lv, nx, ny);
      if (!(flagAt(lv, nx, ny) & F.MARK)) continue;
      if (!isPassable(t) && t !== T.DOOR_CLOSED) continue;
      qx.push(nx); qy.push(ny);
    }
  }
  return null;
}
/** The nearest remembered tile of a kind, or null. */
function nearestTile(g: Game, match: (t: number) => boolean): Pos | null {
  const lv = g.level, p = g.player;
  let best: Pos | null = null, bd = 1e9;
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
    if (!(flagAt(lv, x, y) & F.MARK) || !match(tileAt(lv, x, y))) continue;
    const d = distance(p.x, p.y, x, y);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}
/**
 * Walk toward a spot. Without a remembered path it shoves one step that way instead -- but only
 * into ground it can actually enter, since bumping a permanent wall costs no turn and would spin.
 */
function headFor(g: Game, x: number, y: number): boolean {
  const p = g.player;
  if (x === p.x && y === p.y) return false;
  if (C.travelTo(g, x, y)) { C.travelStep(g); return true; }
  const d = dirOf(x - p.x, y - p.y);
  if (d === 5) return false;
  const nx = p.x + DIR_DX[d], ny = p.y + DIR_DY[d];
  const t = tileAt(g.level, nx, ny);
  if (monsterAt(g.level, nx, ny) || isPassable(t) || t === T.DOOR_CLOSED || isShop(t)) { C.moveDir(g, d); return true; }
  return false;
}
/** Open ground the bot has not walked on yet, or a probe into the dark beside it. */
function explore(g: Game): boolean {
  const p = g.player;
  const d = unknownNeighbour(g, p.x, p.y);
  if (d) {
    const nx = p.x + DIR_DX[d], ny = p.y + DIR_DY[d];
    const t = tileAt(g.level, nx, ny);
    // Walking into unremembered rock only maps it (no turn passes), which is progress either way --
    // but the town's permanent walls are never remembered, so note the grid and never poke it twice.
    probed.add(ny * g.level.w + nx);
    C.moveDir(g, d);
    if (isPassable(t) || t === T.DOOR_CLOSED) return true;
  }
  const f = frontier(g);
  if (f && headFor(g, f.x, f.y)) return true;
  return false;
}

// -----------------------------------------------------------------------------------------
// Shopping

/** Buy the supplies on the list, sell what the store wants and the bot will not use. */
export function autoShop(g: Game): void {
  const s = g.stores[g.inStore];
  const p = g.player;
  maintainStore(g, s);
  for (const it of [...p.inven]) {
    if (p.gold > 5000) break;
    const k = kindOf(it);
    if (!storeWants(s, it) || k.tval === 'gold') continue;
    // Keep anything wielded, the shopping list, and books; sell the rest of the loot.
    if (SHOPPING.some(w => w[0] === it.kind) || k.tval === 'food' || k.tval.endsWith('book')) continue;
    if (isWearable(k) && !p.equip[wieldSlot(k) || 'weapon']) continue;
    if (sellPrice(g, s, it) <= 0) continue;
    const sold = C.removeFromInventory(g, it, it.number);
    storeSell(g, s, sold, sold.number);
    refreshBonuses(g);
  }
  for (const [kindId, want] of SHOPPING) {
    while (countKind(g, kindId) < want) {
      const stock = s.stock.find(it => it.kind === kindId);
      if (!stock) break;
      const price = buyPrice(g, s, stock);
      if (price > p.gold - RESERVE) break;
      const bought = storeBuy(g, s, stock, 1);
      if (!bought) break;
      bought.id = getNextItemId(); setNextItemId(bought.id + 1);
      if (!C.addToInventory(g, bought)) break;
      g.msg.add(`You bought ${itemName(bought, g.flavors)} for ${price} gold.`, '#ffd040');
    }
  }
  refreshBonuses(g);
  shopped.add(s.type);
  g.inStore = -1;
}
/** Which store still sells something the bot is short of? */
function wantedStore(g: Game): number {
  const short = SHOPPING.filter(([id, n]) => countKind(g, id) < n).map(w => w[0]);
  if (!short.length || g.player.gold < 50) return -1;
  if (!shopped.has(0) && short.some(id => id === 'ration' || id === 'flask_oil' || id === 'torch')) return 0;
  if (!shopped.has(4) && (short.includes('potion_clw') || short.includes('scroll_phase_door'))) return 4;
  return -1;
}

// -----------------------------------------------------------------------------------------
// Fighting

function attackSpell(g: Game): SpellDef | null {
  const p = g.player;
  const usable = C.spellsAvailable(g).filter(s => p.learned.includes(s.id) && C.spellMana(g, s) <= p.csp && C.spellFail(g, s) < 40);
  const attack = usable.filter(s => hasEffect(s.effect, 'bolt') || hasEffect(s.effect, 'ball') || hasEffect(s.effect, 'drain_life'));
  return attack.length ? attack[0] : null;
}
function healSpell(g: Game): SpellDef | null {
  const p = g.player;
  const usable = C.spellsAvailable(g).filter(s => p.learned.includes(s.id) && C.spellMana(g, s) <= p.csp && hasEffect(s.effect, 'heal'));
  return usable.length ? usable[0] : null;
}
/** Shoot, throw or cast at a monster in view; true if the turn was spent. */
function rangedAttack(g: Game, m: Monster): boolean {
  const p = g.player;
  const dir = dirOf(m.x - p.x, m.y - p.y);
  if (dir === 5) return false;
  const target = { x: m.x, y: m.y };
  if (p.equip.bow && p.quiver.length) {
    const ammo = p.quiver.find(a => kindOf(a).tval === kindOf(p.equip.bow!).ammo);
    if (ammo) { C.fire(g, ammo, dir, target); return true; }
  }
  const spell = attackSpell(g);
  if (spell) { C.cast(g, spell, { dir, target }); return true; }
  const wand = findItem(g, it => kindOf(it).tval === 'wand' && known(g, it) && it.charges > 0 && hasEffect(kindOf(it).effect, 'bolt'));
  if (wand) { C.aim(g, wand, dir, target); return true; }
  const oil = findItem(g, it => kindOf(it).tval === 'flask');
  if (oil && distance(p.x, p.y, m.x, m.y) <= 8) { C.throwItem(g, oil, dir, target); return true; }
  return false;
}

// -----------------------------------------------------------------------------------------
// Patience

/**
 * The bot's one scrap of memory: how long it has been on this level. A breeding pit or a level
 * whose last corner it cannot reach must not hold it for ever, so after a while it dives anyway.
 */
let levelKey = '';
let stepsOnLevel = 0;
/** Stores already visited on this trip to town: a shop it cannot afford is not worth a second look. */
let shopped = new Set<number>();
/** Grids the bot has already walked into once; a wall it cannot remember is not worth a second try. */
let probed = new Set<number>();
/** Forget the current level (a new hero, or a save loaded over this one). */
export function resetAutoplay(): void { levelKey = ''; stepsOnLevel = 0; shopped = new Set(); probed = new Set(); }
/** Bot turns spent on the level the hero is standing on. */
function levelAge(g: Game): number {
  const key = `${g.player.name}|${g.level.depth}|${g.stats.levelsVisited}`;
  if (key !== levelKey) { levelKey = key; stepsOnLevel = 0; shopped = new Set(); probed = new Set(); }
  return ++stepsOnLevel;
}
/** A look round, but not a survey: a hundred-by-sixty level has corners not worth the turns. */
const LOOK_ROUND = 200;
const GIVE_UP = 500;
const SWARM_GIVE_UP = 150;

// -----------------------------------------------------------------------------------------
// One bot turn

/**
 * Play one action. `step` only paces the housekeeping (searching, studying, tidying the pack),
 * so the caller can pass a plain counter. Never throws: a bot that dies is a bot that died.
 */
export function autoplayStep(g: Game, step: number): void {
  const p = g.player, lv = g.level;
  if (p.dead || g.levelChange) return;
  if (g.inStore >= 0) { autoShop(g); return; }
  if (p.timed.paralyzed || p.timed.stun > 100) { C.passTurn(g); return; }

  const threats = visibleMonsters(g);
  const close = visibleMonsters(g, 4);
  const here = tileAt(lv, p.x, p.y);
  // Finish what is already running, unless something turned up.
  if (g.resting) { if (threats.length) g.resting = 0; else { C.restStep(g); return; } }
  if (g.travel) { if (close.length) g.travel = null; else { C.travelStep(g); return; } }
  if (g.running) { if (threats.length) g.running = null; else { C.runStep(g); return; } }

  // How much of this level is left, and is it still worth the time? The clock ticks before the
  // fighting does, or a breeding pit would hold the bot on one grid for ever.
  const town = lv.depth === 0;
  const swarm = threats.length > 4;
  const more = town ? null : frontier(g);
  const down = town ? null : nearestTile(g, t => t === T.STAIRS_DOWN);
  const age = levelAge(g);
  // Explore while there is ground left to cover -- but once the way down is known, a look round
  // is enough; the last corner of the level is not worth the turns, and a swarm even less.
  const staying = town || (!!more && age < (swarm ? SWARM_GIVE_UP : GIVE_UP) && !(down && age > LOOK_ROUND));
  const fleeing = !staying && swarm;

  // 1. Staying alive.
  if (p.chp < p.mhp * PANIC) {
    const potion = healingPotion(g);
    if (potion) { C.quaff(g, potion); return; }
    const spell = healSpell(g);
    if (spell) { C.cast(g, spell, {}); return; }
    if (close.length) {
      // Stairs are the oldest escape in the game, and the bot stands on some often enough.
      if (here === T.STAIRS_DOWN) { C.goDown(g); return; }
      if (here === T.STAIRS_UP && !g.options.ironman) { C.goUp(g); return; }
      const scroll = escapeScroll(g);
      if (scroll) { C.read(g, scroll, {}); return; }
    } else if (p.chp < p.mhp * HURT) { C.rest(g, -1); C.restStep(g); return; }
  }
  if (p.food < FOOD_HUNGRY) {
    const meal = foodItem(g);
    if (meal) { C.eat(g, meal); return; }
  }

  // 2. Whatever is in arm's reach. A hero walking out on a breeding pit takes the free hits.
  const adj = adjacentDir(g);
  if (adj && p.timed.afraid) {
    const scroll = escapeScroll(g);
    if (scroll) { C.read(g, scroll, {}); return; }
    C.moveDir(g, 10 - adj); return;
  }
  if (adj && !fleeing) { C.moveDir(g, adj); return; }

  // 3. The town: stock up, then find the way down.
  if (town) {
    const want = wantedStore(g);
    if (want >= 0) {
      const door = nearestTile(g, t => isShop(t) && t - T.SHOP_0 === want);
      if (door && headFor(g, door.x, door.y)) return;
      // The shop has not been found yet: no hero walks into the dungeon without potions.
      if (!door && explore(g)) return;
    }
    const stairs = nearestTile(g, t => t === T.STAIRS_DOWN);
    if (stairs) {
      if (stairs.x === p.x && stairs.y === p.y) { C.goDown(g); return; }
      if (headFor(g, stairs.x, stairs.y)) return;
    }
    if (explore(g)) return;
    C.passTurn(g);
    return;
  }

  // 4. Down, when the level is finished, dull or dangerous -- but not on a sliver of health,
  //    unless something is chasing the hero down the stairs anyway.
  if (here === T.STAIRS_DOWN && !staying && (p.chp > p.mhp * HURT || threats.length)) { C.goDown(g); return; }

  // 5. Shoot what is coming, while this level is still the bot's business.
  const target = nearestTarget(g);
  if (staying && target && distance(p.x, p.y, target.x, target.y) > 1 && rangedAttack(g, target)) return;

  // 6. Housekeeping, only when nothing is breathing down the hero's neck.
  if (!close.length) {
    if (C.newSpellCount(g) > 0) { C.study(g); return; }
    const gear = findItem(g, it => { const k = kindOf(it); return isWearable(k) && !isAmmo(k) && !!wieldSlot(k) && !p.equip[wieldSlot(k)!]; });
    if (gear) { C.wield(g, gear); return; }
    if (itemsAt(lv, p.x, p.y).length && C.pickupHere(g, false)) return;
    const chest = itemsAt(lv, p.x, p.y).find(fi => kindOf(fi.item).tval === 'chest');
    if (chest) { C.openChest(g, chest); return; }
    if (!threats.length && (p.chp < p.mhp * HURT || p.csp < p.msp / 2)) { C.rest(g, -1); C.restStep(g); return; }
    if (staying && step % 31 === 30) { C.searchAround(g); return; }
  }

  // 7. Move: on into the dark, or off this level.
  if (!staying && down && headFor(g, down.x, down.y)) return;
  if (explore(g)) return;
  if (down && headFor(g, down.x, down.y)) return;
  // Walled in: dig at the softest neighbour, or feel around for a secret door.
  if (step % 3 === 0) { C.searchAround(g); return; }
  for (let d = 1; d <= 9; d++) {
    const dd = ((step + d) % 9) + 1;
    if (dd === 5) continue;
    const t = tileAt(lv, p.x + DIR_DX[dd], p.y + DIR_DY[dd]);
    if (t === T.RUBBLE || t === T.MAGMA || t === T.QUARTZ || t === T.MAGMA_K || t === T.QUARTZ_K) { C.tunnelInto(g, p.x + DIR_DX[dd], p.y + DIR_DY[dd]); return; }
  }
  const up = nearestTile(g, t => t === T.STAIRS_UP);
  if (up && !g.options.ironman) {
    if (up.x === p.x && up.y === p.y) { C.goUp(g); return; }
    if (headFor(g, up.x, up.y)) return;
  }
  if (adj) { C.moveDir(g, adj); return; }
  let dir = randint1(9); if (dir === 5) dir = 1;
  C.moveDir(g, dir);
}
