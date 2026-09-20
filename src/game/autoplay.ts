// The autoplay bot: a hero that plays itself with exactly the commands a player has. No map
// cheats, no free healing -- it only knows what the player knows (findPath walks remembered
// grids), and every action goes through commands.ts, so it takes its turn like anyone else.
// `=` toggles it as the Autoplay game option, ctrl+A does the same from the map; tools/sim.ts
// drives the same brain headless so `npm run check` plays a few characters with it.
import { FOOD_HUNGRY, INVEN_MAX, QUIVER_SLOTS } from '../constants.ts';
import { T, F, DIR_DX, DIR_DY, dirOf, isPassable, isShop, type Item, type FloorItem, type Monster, type ObjectKind, type Pos, type SlotName, type Effect, type SpellDef } from './types.ts';
import { tileAt, flagAt, monsterAt, itemsAt, inBounds, projectPath } from './level.ts';
import { kindOf, isKnown, isAmmo, isWearable, wieldSlot, itemName, canStack, getNextItemId, setNextItemId } from './items.ts';
import { isIgnored, itemQuality, alwaysPickUp } from './ignore.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { isSong } from './data/songs.ts';
import { maintainStore, storeBuy, storeSell, storeWants, buyPrice, sellPrice } from './stores.ts';
import { refreshBonuses } from './effectsCore.ts';
import { randint0, distance } from './util.ts';
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
/**
 * Whether a shot, bolt or thrown flask from the hero's grid would reach the monster: the path a
 * projectile takes ends on its grid. Line of sight is not enough -- a bolt travels a different
 * line from the eye and stops at the first monster or wall in its way.
 */
function canReach(g: Game, m: Monster, range = 20): boolean {
  const p = g.player;
  const path = projectPath(g.level, p.x, p.y, m.x, m.y, range, true);
  const end = path[path.length - 1];
  return !!end && end.x === m.x && end.y === m.y;
}
/** The closest monster the bot can see and shoot at. */
function nearestTarget(g: Game): Monster | null {
  const p = g.player;
  let best: Monster | null = null, bd = 1e9;
  for (const m of visibleMonsters(g)) {
    const d = distance(p.x, p.y, m.x, m.y);
    if (d < bd && canReach(g, m)) { bd = d; best = m; }
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
/** Ground the hero can step onto this turn: no monster, and a tile a move actually enters. */
function canEnter(g: Game, x: number, y: number): boolean {
  if (!inBounds(g.level, x, y) || monsterAt(g.level, x, y)) return false;
  const t = tileAt(g.level, x, y);
  return isPassable(t) || t === T.DOOR_CLOSED || isShop(t);
}
/**
 * The open neighbour that puts the most ground between the hero and the monster in direction
 * `from`, or 0 when there is none. Straight away from it into a wall is not a step at all: it
 * costs no turn, so a frightened hero facing a wall would stand there for ever.
 */
function fleeDir(g: Game, from: number): number {
  const p = g.player;
  const mx = p.x + DIR_DX[from], my = p.y + DIR_DY[from];
  let best = 0, bd = -1;
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const nx = p.x + DIR_DX[d], ny = p.y + DIR_DY[d];
    if (!canEnter(g, nx, ny)) continue;
    let score = distance(mx, my, nx, ny) * 4;
    for (const m of visibleMonsters(g, 4)) score -= Math.max(0, 4 - distance(m.x, m.y, nx, ny));
    if (score > bd) { bd = score; best = d; }
  }
  return best;
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

// -----------------------------------------------------------------------------------------
// Digging: rubble across the way on, and veins with treasure showing.

/** Can a hero with no special tools tunnel through this? */
function diggable(t: number): boolean { return t === T.RUBBLE || t === T.MAGMA || t === T.QUARTZ || t === T.MAGMA_K || t === T.QUARTZ_K; }
/** Turns the hero can expect to spend clearing a grid of this kind (see commands.tunnelInto). */
function digTurns(g: Game, t: number): number {
  const need = t === T.RUBBLE ? 200 : t === T.MAGMA || t === T.MAGMA_K ? 400 : t === T.QUARTZ || t === T.QUARTZ_K ? 800 : 1600;
  return need / Math.max(1, g.bonuses.skills.digging);
}
/** Longest dig the bot will plan for, in expected turns; three times that and it gives the grid up. */
const DIG_PATIENCE = 60;
/** A grid worth digging, the walkable grid to dig it from, and the walk to get there. */
type DigSite = { dig: Pos; from: Pos; steps: number };
/**
 * One breadth-first walk over remembered, walkable grids, closest first: the nearest grid with
 * unseen ground beside it, the nearest rubble with unseen ground behind it (a blocked corridor), and
 * the nearest vein showing treasure. A bare streamer leads nowhere but rock, so it is not counted.
 */
function survey(g: Game): { open: Pos | null; openSteps: number; rubble: DigSite | null; treasure: DigSite | null } {
  const lv = g.level, p = g.player, w = lv.w;
  const seen = new Uint8Array(lv.w * lv.h);
  const qx: number[] = [p.x], qy: number[] = [p.y], qs: number[] = [0];
  seen[p.y * w + p.x] = 1;
  let open: Pos | null = null, openSteps = 0, rubble: DigSite | null = null, treasure: DigSite | null = null;
  for (let head = 0; head < qx.length && !(open && rubble && treasure); head++) {
    const x = qx[head], y = qy[head], steps = qs[head];
    if (!open && (x !== p.x || y !== p.y) && unknownNeighbour(g, x, y)) { open = { x, y }; openSteps = steps; }
    for (let d = 1; d <= 9; d++) {
      if (d === 5) continue;
      const nx = x + DIR_DX[d], ny = y + DIR_DY[d], i = ny * w + nx;
      if (!inBounds(lv, nx, ny) || seen[i]) continue;
      seen[i] = 1;
      if (!(flagAt(lv, nx, ny) & F.MARK)) continue;
      const t = tileAt(lv, nx, ny);
      if (diggable(t)) {
        if (hopeless.has(i) || digTurns(g, t) > DIG_PATIENCE) continue;
        const site = { dig: { x: nx, y: ny }, from: { x, y }, steps };
        if (!rubble && t === T.RUBBLE && unknownNeighbour(g, nx, ny)) rubble = site;
        else if (!treasure && (t === T.MAGMA_K || t === T.QUARTZ_K)) treasure = site;
        continue;
      }
      if (!isPassable(t) && t !== T.DOOR_CLOSED) continue;
      qx.push(nx); qy.push(ny); qs.push(steps + 1);
    }
  }
  return { open, openSteps, rubble, treasure };
}
/** Start on a grid beside the hero; the turn is spent, and the next steps keep at it. */
function startDig(g: Game, x: number, y: number, forced = false): void {
  dig = { x, y, turns: 1, forced };
  C.tunnelInto(g, x, y);
  g.repeating = null;
}
/** Dig the site if the hero stands beside it, else walk there; false when it cannot be reached. */
function goDig(g: Game, site: DigSite): boolean {
  const p = g.player;
  if (distance(p.x, p.y, site.dig.x, site.dig.y) <= 1) { startDig(g, site.dig.x, site.dig.y); return true; }
  if (headFor(g, site.from.x, site.from.y)) return true;
  hopeless.add(site.dig.y * g.level.w + site.dig.x);
  return false;
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
function explore(g: Game, open: Pos | null): boolean {
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
    // Bumping rubble or a vein tunnels into it, which is a turn: whether to keep at it is decided next step.
    if (diggable(t)) { g.repeating = null; return true; }
  }
  if (open && headFor(g, open.x, open.y)) return true;
  return false;
}

// -----------------------------------------------------------------------------------------
// Loot: the nearest remembered item worth the walk.

/** The empty slot a piece of gear would go into, minding the hero's second ring finger. */
function emptySlot(g: Game, k: ObjectKind): SlotName | null {
  const slot = wieldSlot(k), p = g.player;
  if (!slot) return null;
  if (slot === 'ring1' && p.equip.ring1) return p.equip.ring2 ? null : 'ring2';
  return p.equip[slot] ? null : slot;
}
/** Is this a book of the hero's own realm? Another realm's is so much weight. */
function ownBook(g: Game, k: ObjectKind): boolean {
  const realm = CLASS_BY_ID[g.player.cls]?.realm;
  return !!realm && k.tval === `${realm}_book`;
}
// How much the bot wants to keep a thing, worst to best. This is an order, not a price: it only
// decides what goes over the side when the pack is full and something better is underfoot.
const KEEP_JUNK = 0;     // cursed or broken gear: weight, and nothing else
const KEEP_DULL = 15;    // known and ordinary: a spare robe, a read scroll's twin
const KEEP_SPARE = 30;   // an unknown flavour -- a lottery ticket, and it sells
const KEEP_DEVICE = 45;  // wands, staves, rods: the bot fights with these
const KEEP_GEAR = 60;    // armour and weapons it could wear or swap to
const KEEP_KIT = 90;     // food, cures, escapes, oil, light, its own spellbooks
const KEEP_PRIZE = 100;  // artifacts, egos, anything the hero marked to keep
/** What the pack is worth holding on to, by the bot's lights. */
function keepValue(g: Game, it: Item): number {
  const k = kindOf(it);
  if (it.artifact || alwaysPickUp(it)) return KEEP_PRIZE;
  const q = itemQuality(it);
  if (q === 'special' || q === 'excellent') return KEEP_PRIZE;
  // A caster that throws its own spellbook away cannot cast again: that is never junk.
  if (ownBook(g, k)) return KEEP_PRIZE;
  if (k.tval === 'flask') return KEEP_KIT;
  if (k.tval === 'light' && countKind(g, it.kind) <= 4) return KEEP_KIT;
  if (k.tval === 'food' && (k.pval || 0) >= 500) return KEEP_KIT;
  if (k.tval === 'potion' && known(g, it) && hasEffect(k.effect, 'heal')) return KEEP_KIT;
  if (k.tval === 'scroll' && known(g, it) && hasEffect(k.effect, 'teleport')) return KEEP_KIT;
  if (isWearable(k)) {
    if (q === 'worthless') return KEEP_JUNK;
    if (emptySlot(g, k)) return KEEP_GEAR;
    return q === 'good' ? KEEP_GEAR : KEEP_DULL;
  }
  if (k.tval === 'wand' || k.tval === 'staff' || k.tval === 'rod') return KEEP_DEVICE;
  return known(g, it) ? KEEP_DULL : KEEP_SPARE;
}
/** The thing the bot would throw away first, or null when the pack holds nothing spare. */
function junkInPack(g: Game): Item | null {
  let worst: Item | null = null, wv = 1e9, wc = 1e9;
  for (const it of g.player.inven) {
    const v = keepValue(g, it), c = kindOf(it).cost;
    if (v >= KEEP_PRIZE) continue;
    if (v > wv || (v === wv && c >= wc)) continue;
    worst = it; wv = v; wc = c;
  }
  return worst;
}
/** Room for this find: a free slot, a stack to join, or something duller to drop for it. */
function roomFor(g: Game, it: Item): boolean {
  const k = kindOf(it), p = g.player;
  if (isAmmo(k)) return p.quiver.length < QUIVER_SLOTS || p.quiver.some(q => canStack(q, it, g.flavors));
  if (p.inven.length < INVEN_MAX || p.inven.some(o => canStack(o, it, g.flavors))) return true;
  const junk = junkInPack(g);
  return !!junk && keepValue(g, it) > keepValue(g, junk);
}
/** Would the bot take this if it stood on it? Gold, keys and chests never need room in the pack. */
function wantsItem(g: Game, it: Item): boolean {
  const k = kindOf(it);
  if (k.tval === 'gold' || k.tval === 'key' || k.tval === 'chest') return true;
  if (isIgnored(g, it) || junked.has(it.id)) return false;
  return roomFor(g, it);
}
/** The closest item on a grid the bot remembers, skipping what it has already given up on. */
function nearestLoot(g: Game): FloorItem | null {
  const lv = g.level, p = g.player;
  let best: FloorItem | null = null, bd = 1e9;
  for (const fi of lv.items) {
    if (fi.x === p.x && fi.y === p.y) continue;
    if (!(flagAt(lv, fi.x, fi.y) & F.MARK) || passed.has(fi.item.id) || !wantsItem(g, fi.item)) continue;
    const d = distance(p.x, p.y, fi.x, fi.y);
    if (d < bd) { bd = d; best = fi; }
  }
  return best;
}
/**
 * A full pack is the commonest reason a bot walks over a ring. Throw the dullest thing in it away
 * when what is underfoot beats it -- that is a turn spent, like any drop, and the pickup follows
 * next step. What the bot throws away it remembers, or it would pick the same rag straight back up.
 */
function shedForLoot(g: Game): boolean {
  const p = g.player, lv = g.level;
  if (p.inven.length < INVEN_MAX) return false;
  const junk = junkInPack(g);
  if (!junk) return false;
  const prize = itemsAt(lv, p.x, p.y).find(fi => {
    const k = kindOf(fi.item);
    if (k.tval === 'gold' || k.tval === 'key' || k.tval === 'chest' || isAmmo(k)) return false;
    if (isIgnored(g, fi.item) || junked.has(fi.item.id)) return false;
    if (p.inven.some(o => canStack(o, fi.item, g.flavors))) return false;
    return keepValue(g, fi.item) > keepValue(g, junk);
  });
  if (!prize) return false;
  junked.add(junk.id);
  C.dropItem(g, junk, junk.number);
  // Room again: loot the bot gave up on for want of space is worth another look.
  passed.clear();
  return true;
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
/**
 * A song worth striking up. The bot sings only with mana to spare, because a song spends mana for
 * as long as it runs: starting one on an empty pool buys a single turn of it and nothing more.
 */
function songToSing(g: Game): SpellDef | null {
  const p = g.player;
  if ((p.songs || []).length) return null;
  if (p.csp < p.msp * 0.5) return null;
  const usable = C.spellsAvailable(g).filter(s => p.learned.includes(s.id) && isSong(s.id) && C.spellMana(g, s) <= p.csp && C.spellFail(g, s) < 40);
  return usable.length ? usable[usable.length - 1] : null;
}
function healSpell(g: Game): SpellDef | null {
  const p = g.player;
  const usable = C.spellsAvailable(g).filter(s => p.learned.includes(s.id) && C.spellMana(g, s) <= p.csp && hasEffect(s.effect, 'heal'));
  return usable.length ? usable[0] : null;
}
/**
 * Shoot, throw or cast at a monster in view; true if the turn was spent. The shot is aimed at the
 * monster's grid (direction 5 plus a target, as the player's `t` does), never at a keypad
 * direction: a direction only lines up with a monster on the hero's row, column or diagonal, and
 * anything else was shot past, arrow after arrow, until the quiver ran dry.
 */
function rangedAttack(g: Game, m: Monster): boolean {
  const p = g.player, b = g.bonuses;
  if ((m.x === p.x && m.y === p.y) || !canReach(g, m)) return false;
  const dir = 5, target = { x: m.x, y: m.y };
  const d = distance(p.x, p.y, m.x, m.y);
  // A bow's reach, as fire() computes it; a spell or wand carries twenty grids.
  if (p.equip.bow && p.quiver.length && d <= 6 + 2 * b.might) {
    const ammo = p.quiver.find(a => kindOf(a).tval === kindOf(p.equip.bow!).ammo);
    if (ammo) { C.fire(g, ammo, dir, target); return true; }
  }
  const spell = attackSpell(g);
  if (spell) { C.cast(g, spell, { dir, target }); return true; }
  const wand = findItem(g, it => kindOf(it).tval === 'wand' && known(g, it) && it.charges > 0 && hasEffect(kindOf(it).effect, 'bolt'));
  if (wand) { C.aim(g, wand, dir, target); return true; }
  const oil = findItem(g, it => kindOf(it).tval === 'flask');
  if (oil && d <= 8) { C.throwItem(g, oil, dir, target); return true; }
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
/** Items the bot stood on and still could not take, or could not reach: not worth another walk. */
let passed = new Set<number>();
/** Items the bot threw away to make room: its own leavings, never picked back up on purpose. */
let junked = new Set<number>();
/** The grid being tunnelled and the turns sunk into it; `forced` when it is the only way off the grid. */
let dig: { x: number; y: number; turns: number; forced: boolean } | null = null;
/** Grids the bot dug at for too long, or could not get beside: not worth another try. */
let hopeless = new Set<number>();
/** Forget the current level (a new hero, or a save loaded over this one). */
export function resetAutoplay(): void { levelKey = ''; stepsOnLevel = 0; shopped = new Set(); probed = new Set(); passed = new Set(); junked = new Set(); dig = null; hopeless = new Set(); idle = 0; }
/** Bot turns spent on the level the hero is standing on. */
function levelAge(g: Game): number {
  const key = `${g.player.name}|${g.level.depth}|${g.stats.levelsVisited}`;
  if (key !== levelKey) { levelKey = key; stepsOnLevel = 0; shopped = new Set(); probed = new Set(); passed = new Set(); junked = new Set(); dig = null; hopeless = new Set(); }
  return ++stepsOnLevel;
}
/** A look round, but not a survey: a hundred-by-sixty level has corners not worth the turns. */
const LOOK_ROUND = 200;
const GIVE_UP = 500;
const SWARM_GIVE_UP = 150;

/** Free actions in a row before the bot gives the clock a nudge. */
const IDLE_LIMIT = 4;
let idle = 0;

// -----------------------------------------------------------------------------------------
// One bot turn

/**
 * Play one action. `step` only paces the housekeeping (searching, studying, tidying the pack),
 * so the caller can pass a plain counter. Never throws: a bot that dies is a bot that died.
 */
export function autoplayStep(g: Game, step: number): void {
  const p = g.player;
  const turn = g.turn, x = p.x, y = p.y, depth = g.level.depth;
  decide(g, step);
  // Some actions are free: bumping a wall, a probe into rock, an order the game refused. Free is
  // fine once or twice, but a bot that keeps choosing one is stuck, and only the clock moving
  // (fear fading, a monster stepping aside, a door giving) will change its mind.
  const free = g.turn === turn && p.x === x && p.y === y && g.level.depth === depth && !g.levelChange && g.inStore < 0 && !p.dead;
  idle = free ? idle + 1 : 0;
  if (idle >= IDLE_LIMIT) { idle = 0; C.passTurn(g); }
}
function decide(g: Game, step: number): void {
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
  // The bot paces its own tunnelling (below); a repeat left over from the player is not its business.
  g.repeating = null;

  // How much of this level is left, and is it still worth the time? The clock ticks before the
  // fighting does, or a breeding pit would hold the bot on one grid for ever.
  const town = lv.depth === 0;
  const swarm = threats.length > 4;
  const { open, openSteps, rubble, treasure } = survey(g);
  const more = open || rubble || treasure;
  const down = town ? null : nearestTile(g, t => t === T.STAIRS_DOWN);
  const age = levelAge(g);
  // Explore while there is ground left to cover -- but once the way down is known, a look round
  // is enough; the last corner of the level is not worth the turns, and a swarm even less.
  const staying = town || (!!more && age < (swarm ? SWARM_GIVE_UP : GIVE_UP) && !(down && age > LOOK_ROUND));
  const fleeing = !staying && swarm;

  // 0. Strike up a song before the fighting starts, while there is mana to hold it.
  if (close.length) { const song = songToSing(g); if (song) { C.cast(g, song, {}); return; } }

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
  // A dig in progress: keep at it while nothing is coming, and give up on a grid that will not yield.
  if (dig) {
    const t = tileAt(lv, dig.x, dig.y);
    if (!diggable(t) || distance(p.x, p.y, dig.x, dig.y) > 1 || !(staying || dig.forced)) dig = null;
    else if (dig.turns >= DIG_PATIENCE * 3) { hopeless.add(dig.y * lv.w + dig.x); dig = null; }
    else if (!close.length && p.chp >= p.mhp * HURT) { dig.turns++; C.tunnelInto(g, dig.x, dig.y); g.repeating = null; return; }
  }

  // 2. Whatever is in arm's reach. A hero walking out on a breeding pit takes the free hits.
  const adj = adjacentDir(g);
  if (adj && p.timed.afraid) {
    const scroll = escapeScroll(g);
    if (scroll) { C.read(g, scroll, {}); return; }
    const away = fleeDir(g, adj);
    if (away) { C.moveDir(g, away); return; }
    // Cornered: too afraid to swing, nowhere to run. Shoot it if it can be seen, else cower and
    // let the fear wear off -- a turn has to pass for that.
    const m = monsterAt(lv, p.x + DIR_DX[adj], p.y + DIR_DY[adj]);
    if (m && m.visible && rangedAttack(g, m)) return;
    C.passTurn(g); return;
  }
  if (adj && !fleeing) { C.moveDir(g, adj); return; }

  // 3. The town: stock up, then find the way down.
  if (town) {
    const want = wantedStore(g);
    if (want >= 0) {
      const door = nearestTile(g, t => isShop(t) && t - T.SHOP_0 === want);
      if (door && headFor(g, door.x, door.y)) return;
      // The shop has not been found yet: no hero walks into the dungeon without potions.
      if (!door && explore(g, open)) return;
    }
    const stairs = nearestTile(g, t => t === T.STAIRS_DOWN);
    if (stairs) {
      if (stairs.x === p.x && stairs.y === p.y) { C.goDown(g); return; }
      if (headFor(g, stairs.x, stairs.y)) return;
    }
    if (explore(g, open)) return;
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
    // A hero with one ring on and a bare finger should put the other one on, so ask for the slot
    // this kind would actually go into rather than the one it names.
    const gear = findItem(g, it => { const k = kindOf(it); return isWearable(k) && !isAmmo(k) && !!emptySlot(g, k); });
    if (gear) { C.wield(g, gear); return; }
    if (itemsAt(lv, p.x, p.y).length && C.pickupHere(g, false, false, it => junked.has(it.id))) return;
    if (shedForLoot(g)) return;
    const chest = itemsAt(lv, p.x, p.y).find(fi => kindOf(fi.item).tval === 'chest');
    if (chest) { C.openChest(g, chest); return; }
    // Whatever is still underfoot could not be taken and is not worth shedding for: remember that,
    // or the walk below would bring the bot straight back here.
    for (const fi of itemsAt(lv, p.x, p.y)) passed.add(fi.item.id);
    if (!threats.length && (p.chp < p.mhp * HURT || p.csp < p.msp / 2)) { C.rest(g, -1); C.restStep(g); return; }
    // Loot the bot has seen and walked past: worth a detour while the level is still its business,
    // and a few steps even when it is on its way out.
    const loot = nearestLoot(g);
    if (loot && (staying || distance(p.x, p.y, loot.x, loot.y) <= 6)) {
      if (headFor(g, loot.x, loot.y)) return;
      passed.add(loot.item.id);
    }
    // A vein showing treasure is loot too, at the price of the digging.
    if (staying && treasure && goDig(g, treasure)) return;
    if (staying && step % 31 === 30) { C.searchAround(g); return; }
  }

  // 7. Move: on into the dark, through what blocks it, or off this level.
  if (!staying && down && headFor(g, down.x, down.y)) return;
  // Rubble across the way on is cleared when that is quicker than walking round to the next unseen corner.
  if (rubble && (!open || rubble.steps + digTurns(g, T.RUBBLE) < openSteps) && goDig(g, rubble)) return;
  if (explore(g, open)) return;
  if (rubble && goDig(g, rubble)) return;
  if (down && headFor(g, down.x, down.y)) return;
  // Walled in: dig at the softest neighbour, or feel around for a secret door.
  if (step % 3 === 0) { C.searchAround(g); return; }
  let soft = 0, softTurns = 1e9;
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d];
    const t = tileAt(lv, x, y);
    if (!diggable(t) || hopeless.has(y * lv.w + x) || digTurns(g, t) >= softTurns) continue;
    soft = d; softTurns = digTurns(g, t);
  }
  if (soft) { startDig(g, p.x + DIR_DX[soft], p.y + DIR_DY[soft], true); return; }
  const up = nearestTile(g, t => t === T.STAIRS_UP);
  if (up && !g.options.ironman) {
    if (up.x === p.x && up.y === p.y) { C.goUp(g); return; }
    if (headFor(g, up.x, up.y)) return;
  }
  if (adj) { C.moveDir(g, adj); return; }
  const ways: number[] = [];
  for (let d = 1; d <= 9; d++) if (d !== 5 && canEnter(g, p.x + DIR_DX[d], p.y + DIR_DY[d])) ways.push(d);
  if (ways.length) { C.moveDir(g, ways[randint0(ways.length)]); return; }
  C.passTurn(g);
}
