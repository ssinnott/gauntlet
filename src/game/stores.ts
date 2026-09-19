// The eight stores: owners, stock, prices and the Home. Angband's store.c, with fixed prices
// (no haggling) scaled by the owner's greed and the player's charisma.
import { type Store, type StoreType, type Item, STORE_NAMES } from './types.ts';
import { OBJECTS, OBJECT_BY_ID } from './data/objects.ts';
import { makeItem, applyMagic, makeObject, kindOf, canStack, absorb, itemValue, isWeapon, isArmor, isAmmo, identify, makeAware, isKnown } from './items.ts';
import { adj } from './player.ts';
import { randint0, randint1, oneIn, weightedPick, damroll } from './util.ts';
import { type Game, playSound } from './state.ts';
import { noteItemKnown } from './effects.ts';

const OWNERS: string[][] = [
  ['Bilbo the Friendly', 'Rincewind the Chicken', 'Sultan the Midget', 'Lyar-el the Comely'],
  ['Kon-Dar the Ugly', 'Darg-Low the Grim', 'Decado the Handsome', 'Mauglin the Grumpy'],
  ['Ithyl-Mak the Beastly', 'Arndal Beast-Slayer', 'Tarl Beast-Master', 'Oglign Dragon-Slayer'],
  ['Ludwig the Humble', 'Gunnar the Paladin', 'Delilah the Pure', 'Bosk the Wise'],
  ['Mauser the Chemist', 'Wizzle the Chaste', 'Ga-nat the Greedy', 'Vella the Slender'],
  ['Ariel the Sorceress', 'Buggerby the Great', 'Inglorian the Mage', 'Luthien Starshine'],
  ['Lo-Hak the Awful', 'Histor the Goblin', 'Durwin the Shifty', 'Drago the Fair'],
  ['Your home', 'Your home', 'Your home', 'Your home'],
];
/** What each store always keeps in stock (Angband's store.txt "always" lines). */
const ALWAYS: Record<number, string[]> = {
  0: ['ration', 'torch', 'flask_oil', 'spike', 'potion_clw', 'scroll_word_of_recall', 'iron_shot', 'arrow', 'bolt', 'cloak', 'key', 'hard_biscuit', 'strip_of_venison', 'lantern'],
  1: ['soft_leather_armor', 'hard_leather_cap', 'leather_gloves', 'soft_leather_boots', 'small_leather_shield'],
  2: ['dagger', 'short_sword', 'sling', 'short_bow', 'iron_shot', 'arrow', 'bolt', 'main_gauche'],
  3: ['prayer_book_1', 'nature_book_1', 'potion_clw', 'scroll_blessing', 'scroll_remove_curse'],
  4: ['potion_clw', 'potion_csw', 'scroll_phase_door', 'scroll_word_of_recall', 'scroll_identify'],
  5: ['magic_book_1', 'necro_book_1', 'wand_magic_missile', 'wand_stinking_cloud', 'staff_light', 'rod_detect_trap'],
  6: [], 7: [],
};
/** The wider list a store draws from when restocking. */
const NORMAL: Record<number, string[]> = {
  0: ['ration', 'hard_biscuit', 'strip_of_venison', 'slime_mold', 'torch', 'lantern', 'flask_oil', 'spike', 'shovel', 'pick', 'cloak', 'soft_leather_boots', 'potion_apple_juice', 'potion_water', 'key', 'scroll_word_of_recall'],
  1: ['soft_leather_armor', 'soft_studded_leather', 'hard_leather_armor', 'hard_studded_leather', 'leather_scale_mail', 'metal_scale_mail', 'chain_mail', 'augmented_chain_mail', 'bar_chain_mail', 'metal_brigandine', 'small_leather_shield', 'small_metal_shield', 'large_leather_shield', 'large_metal_shield', 'hard_leather_cap', 'metal_cap', 'iron_helm', 'steel_helm', 'leather_gloves', 'gauntlets', 'soft_leather_boots', 'hard_leather_boots', 'metal_shod_boots', 'cloak', 'fur_cloak'],
  2: ['dagger', 'main_gauche', 'rapier', 'short_sword', 'sabre', 'cutlass', 'tulwar', 'broad_sword', 'long_sword', 'scimitar', 'bastard_sword', 'mace', 'war_hammer', 'morning_star', 'flail', 'lead_filled_mace', 'quarterstaff', 'spear', 'awl_pike', 'trident', 'pike', 'beaked_axe', 'broad_axe', 'battle_axe', 'lance', 'sling', 'short_bow', 'long_bow', 'light_crossbow', 'heavy_crossbow', 'iron_shot', 'rounded_pebble', 'arrow', 'bolt'],
  3: ['prayer_book_1', 'prayer_book_2', 'prayer_book_3', 'prayer_book_4', 'nature_book_1', 'nature_book_2', 'potion_clw', 'potion_csw', 'potion_ccw', 'potion_boldness', 'potion_heroism', 'potion_slow_poison', 'potion_neutralize_poison', 'scroll_blessing', 'scroll_holy_chant', 'scroll_remove_curse', 'scroll_word_of_recall', 'scroll_protection_from_evil', 'mace', 'war_hammer', 'morning_star', 'flail'],
  4: ['potion_clw', 'potion_csw', 'potion_ccw', 'potion_resist_heat', 'potion_resist_cold', 'potion_infravision', 'potion_slow_poison', 'potion_neutralize_poison', 'potion_boldness', 'potion_heroism', 'potion_berserk', 'potion_speed', 'scroll_phase_door', 'scroll_word_of_recall', 'scroll_identify', 'scroll_light', 'scroll_monster_confusion', 'scroll_magic_mapping', 'scroll_treasure_detection', 'scroll_trap_detection', 'scroll_door_stair_location', 'scroll_detect_invisible', 'scroll_recharging', 'scroll_enchant_weapon_to_hit', 'scroll_enchant_weapon_to_dam', 'scroll_enchant_armour', 'scroll_satisfy_hunger', 'scroll_remove_curse', 'scroll_deep_descent', 'scroll_teleport'],
  5: ['magic_book_1', 'magic_book_2', 'magic_book_3', 'magic_book_4', 'necro_book_1', 'necro_book_2', 'ring_protection', 'ring_resist_fire', 'ring_resist_cold', 'ring_feather_falling', 'ring_see_invisible', 'ring_free_action', 'amulet_slow_digestion', 'amulet_resist_acid', 'amulet_resist_lightning', 'wand_magic_missile', 'wand_stinking_cloud', 'staff_light', 'staff_detect_evil', 'staff_mapping', 'staff_teleportation', 'staff_cure_light_wounds', 'rod_treasure_location', 'rod_detect_trap', 'rod_detect_door', 'rod_illumination'],
  6: [], 7: [],
};
const STORE_TURNS = 1000;
const STORE_MAX = 24;

export function createStores(): Store[] {
  const stores: Store[] = [];
  for (let i = 0; i < 8; i++) {
    const s: Store = { type: i as StoreType, owner: OWNERS[i][randint0(4)], purse: [5000, 10000, 10000, 15000, 15000, 20000, 30000, 0][i], greed: [105, 110, 110, 105, 108, 112, 150, 100][i] + randint0(10), stock: [], lastVisit: 0 };
    stores.push(s);
  }
  return stores;
}

/** Bring a store up to date: turnover since the last visit, then top up. */
export function maintainStore(g: Game, s: Store): void {
  const n = Math.min(10, Math.floor((g.turn - s.lastVisit) / STORE_TURNS));
  s.lastVisit = g.turn;
  if (s.type === 7) return;
  for (let i = 0; i < n; i++) {
    // Sell off a few things, then buy a few things.
    const sell = randint1(3);
    for (let j = 0; j < sell && s.stock.length; j++) { const idx = randint0(s.stock.length); const it = s.stock[idx]; if (isAlways(s, it.kind) && it.number <= 1) continue; it.number -= randint1(Math.max(1, Math.floor(it.number / 2))); if (it.number <= 0) s.stock.splice(idx, 1); }
    const buy = randint1(3);
    for (let j = 0; j < buy; j++) stockOne(g, s);
  }
  // Always-stocked staples and a minimum size.
  for (const id of ALWAYS[s.type]) if (!s.stock.some(it => it.kind === id)) stockKind(g, s, id, true);
  let guard = 0;
  while (s.stock.length < (s.type === 6 ? 10 : 14) && guard++ < 40) stockOne(g, s);
}
function isAlways(s: Store, kind: string): boolean { return ALWAYS[s.type].includes(kind); }

function stockOne(g: Game, s: Store): void {
  if (s.stock.length >= STORE_MAX) return;
  if (s.type === 6) {
    // Black market: anything, from deeper down, at a premium; never staples.
    const lev = 25 + randint0(25);
    const it = makeObject(lev, oneIn(2), false);
    if (!it) return;
    const k = kindOf(it);
    if (k.cost < 10 || k.tval === 'gold' || k.tval === 'junk' || k.tval === 'chest' || it.cursed || (isWeapon(k) || isArmor(k)) && it.toHit + it.toDam + it.toAc < 0) return;
    it.number = k.stackable ? randint1(3) : 1;
    identify(it, g.flavors);
    it.known = true;
    addToStock(g, s, it);
    return;
  }
  const list = NORMAL[s.type];
  const id = list[randint0(list.length)];
  stockKind(g, s, id, false);
}
function stockKind(g: Game, s: Store, id: string, staple: boolean): void {
  const k = OBJECT_BY_ID[id];
  if (!k) return;
  const it = makeItem(id, 1);
  // Stores sell good stuff sometimes but never cursed stuff.
  applyMagic(it, staple ? 0 : 5 + randint0(10), false, false, false);
  if (it.cursed || it.toHit < 0 || it.toDam < 0 || it.toAc < 0 || it.pval < 0) return;
  if (it.ego && !oneIn(3)) { it.ego = undefined; it.toHit = Math.min(it.toHit, 3); it.toDam = Math.min(it.toDam, 3); it.toAc = Math.min(it.toAc, 3); it.flags = []; }
  it.known = true;
  makeAware(g.flavors, id);
  if (k.stackable) it.number = staple ? (isAmmo(k) ? damroll(6, 7) + 20 : k.tval === 'potion' || k.tval === 'scroll' ? 4 + randint1(6) : k.tval === 'flask' || k.tval === 'spike' ? 10 + randint1(15) : k.tval === 'food' ? 4 + randint1(8) : k.tval === 'light' ? 5 + randint1(10) : 1 + randint1(4)) : (isAmmo(k) ? damroll(6, 7) : 1 + randint1(3));
  if (k.tval === 'light' && !staple) it.timeout = k.recharge || 0;
  addToStock(g, s, it);
}
function addToStock(g: Game, s: Store, it: Item): void {
  for (const o of s.stock) if (canStack(o, it, g.flavors)) { absorb(o, it); return; }
  s.stock.push(it);
  s.stock.sort((a, b) => tvalOrder(a) - tvalOrder(b) || kindOf(a).cost - kindOf(b).cost);
}
function tvalOrder(it: Item): number { return OBJECTS.indexOf(kindOf(it)); }

/** Price the store asks for one of `it`. */
export function buyPrice(g: Game, s: Store, it: Item): number {
  const base = itemValue(it, g.flavors, true);
  const factor = s.greed * adj.chrGold(g.bonuses.stat.CHR) / 100;
  let price = Math.floor(base * factor / 100);
  if (s.type === 6) price = Math.floor(price * 1.5);
  return Math.max(1, price);
}
/** What the store pays for one of `it` (never more than the owner's purse). */
export function sellPrice(g: Game, s: Store, it: Item): number {
  if (g.options.noSelling && s.type !== 7) return 0;
  const base = itemValue(it, g.flavors, isKnown(it, g.flavors));
  const factor = 100 * 100 / (s.greed * adj.chrGold(g.bonuses.stat.CHR) / 100);
  let price = Math.floor(base * factor / 100 / 1.4);
  if (s.type === 6) price = Math.floor(price / 3);
  return Math.max(0, Math.min(s.purse, price));
}
/** Will this store buy the item at all? */
export function storeWants(s: Store, it: Item): boolean {
  const k = kindOf(it);
  if (s.type === 7) return true;
  if (k.tval === 'gold' || k.tval === 'junk' || k.tval === 'chest') return false;
  switch (s.type) {
    case 0: return ['food', 'light', 'flask', 'spike', 'shot', 'arrow', 'bolt', 'digger', 'cloak', 'key'].includes(k.tval);
    case 1: return isArmor(k);
    case 2: return isWeapon(k) || k.tval === 'bow' || isAmmo(k);
    case 3: return k.tval === 'prayer_book' || k.tval === 'nature_book' || k.tval === 'hafted' || k.tval === 'potion' || k.tval === 'scroll';
    case 4: return k.tval === 'potion' || k.tval === 'scroll';
    case 5: return ['magic_book', 'necro_book', 'ring', 'amulet', 'wand', 'staff', 'rod'].includes(k.tval);
    case 6: return true;
  }
  return false;
}
export function storeName(t: StoreType): string { return STORE_NAMES[t]; }

/** Player buys `n` of stock item; returns the purchased item or null if unaffordable. */
export function storeBuy(g: Game, s: Store, it: Item, n: number): Item | null {
  const price = buyPrice(g, s, it) * n;
  if (s.type !== 7 && g.player.gold < price) return null;
  n = Math.min(n, it.number);
  playSound(g, 'shop');
  const bought: Item = { ...it, id: 0, number: n, flags: [...it.flags] };
  const k = kindOf(it);
  if (k.tval === 'wand' || k.tval === 'staff') { const c = Math.floor(it.charges * n / it.number); bought.charges = c; it.charges -= c; }
  it.number -= n;
  if (it.number <= 0) s.stock.splice(s.stock.indexOf(it), 1);
  if (s.type !== 7) { g.player.gold -= price; s.purse += Math.floor(price / 2); }
  return bought;
}
/** Player sells `n` of an item; the store identifies it fully. Returns gold paid. */
export function storeSell(g: Game, s: Store, it: Item, n: number): number {
  const price = s.type === 7 ? 0 : sellPrice(g, s, it) * n;
  playSound(g, 'shop');
  const sold: Item = { ...it, number: n, flags: [...it.flags] };
  const k = kindOf(it);
  if (k.tval === 'wand' || k.tval === 'staff') { const c = Math.floor(it.charges * n / it.number); sold.charges = c; it.charges -= c; }
  identify(sold, g.flavors);
  if (s.type !== 7) { identify(it, g.flavors); noteItemKnown(g, it); g.player.gold += price; s.purse = Math.max(0, s.purse - price); }
  if (s.type === 7 || (kindOf(sold).cost > 0 && !sold.cursed)) addToStock(g, s, sold);
  return price;
}
