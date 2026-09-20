// Object instances: creation, magic, flavours, naming, stacking and value. Angband's object1.c and
// object2.c in spirit.
import { rng } from '../lib/engine/rng.ts';
import { type Item, type ObjectKind, type ObjectFlag, type TVal, type SlotName, type EgoKind, type ArtifactKind, type Sense, BOOK_TVALS } from './types.ts';
import { OBJECTS, OBJECT_BY_ID, EGOS, EGO_BY_ID } from './data/objects.ts';
import { artifactList, artifactById } from './artifacts.ts';
import { randint0, randint1, oneIn, mBonus, damroll, plural, capitalize, shuffle, weightedPick } from './util.ts';

let nextItemId = 1;
export function setNextItemId(n: number): void { nextItemId = n; }
export function getNextItemId(): number { return nextItemId; }

export function kindOf(item: Item): ObjectKind { return OBJECT_BY_ID[item.kind]; }
export function egoOf(item: Item): EgoKind | undefined { return item.ego ? EGO_BY_ID[item.ego] : undefined; }
export function artifactOf(item: Item): ArtifactKind | undefined { return item.artifact ? artifactById(item.artifact) : undefined; }

// ---------------------------------------------------------------------------------------------
// Flavours

const POTION_COLORS = ['Clear', 'Light Brown', 'Icky Green', 'Azure', 'Blue', 'Blue Speckled', 'Black', 'Brown', 'Brown Speckled', 'Bubbling', 'Chartreuse', 'Cloudy', 'Copper Speckled', 'Crimson', 'Cyan', 'Dark Blue', 'Dark Green', 'Dark Red', 'Gold Speckled', 'Green', 'Green Speckled', 'Grey', 'Grey Speckled', 'Hazy', 'Indigo', 'Light Blue', 'Light Green', 'Magenta', 'Metallic Blue', 'Metallic Red', 'Metallic Green', 'Metallic Purple', 'Misty', 'Orange', 'Orange Speckled', 'Pink', 'Pink Speckled', 'Puce', 'Purple', 'Purple Speckled', 'Red', 'Red Speckled', 'Silver Speckled', 'Smoky', 'Tangerine', 'Violet', 'Vermilion', 'White', 'Yellow', 'Violet Speckled', 'Pungent', 'Clotted Red', 'Viscous Pink', 'Oily Yellow', 'Gloopy Green', 'Shimmering', 'Coagulated Crimson', 'Yellow Speckled', 'Gold'];
const WAND_METALS = ['Aluminium', 'Cast Iron', 'Chromium', 'Copper', 'Gold', 'Iron', 'Magnesium', 'Molybdenum', 'Nickel', 'Rusty', 'Silver', 'Steel', 'Tin', 'Titanium', 'Tungsten', 'Zirconium', 'Zinc', 'Aluminium-Plated', 'Copper-Plated', 'Gold-Plated', 'Nickel-Plated', 'Silver-Plated', 'Steel-Plated', 'Tin-Plated', 'Zinc-Plated', 'Mithril-Plated', 'Mithril', 'Runed', 'Bronze', 'Brass', 'Platinum', 'Lead', 'Lead-Plated', 'Ivory', 'Adamantite', 'Uridium', 'Long', 'Short', 'Hexagonal'];
const STAFF_WOODS = ['Aspen', 'Balsa', 'Banyan', 'Birch', 'Cedar', 'Cottonwood', 'Cypress', 'Dogwood', 'Elm', 'Eucalyptus', 'Hemlock', 'Hickory', 'Ironwood', 'Locust', 'Mahogany', 'Maple', 'Mulberry', 'Oak', 'Pine', 'Redwood', 'Rosewood', 'Spruce', 'Sycamore', 'Teak', 'Walnut', 'Mistletoe', 'Hawthorn', 'Bamboo', 'Silver', 'Runed', 'Golden', 'Ashen', 'Gnarled', 'Ivory', 'Willow'];
const RING_GEMS = ['Alexandrite', 'Amethyst', 'Aquamarine', 'Azurite', 'Beryl', 'Bloodstone', 'Calcite', 'Carnelian', 'Corundum', 'Diamond', 'Emerald', 'Fluorite', 'Garnet', 'Granite', 'Jade', 'Jasper', 'Lapis Lazuli', 'Malachite', 'Marble', 'Moonstone', 'Onyx', 'Opal', 'Pearl', 'Quartz', 'Quartzite', 'Rhodonite', 'Ruby', 'Sapphire', 'Tiger Eye', 'Topaz', 'Turquoise', 'Zircon', 'Platinum', 'Bronze', 'Gold', 'Obsidian', 'Silver', 'Tortoise Shell', 'Mithril', 'Jet', 'Engagement', 'Adamantite'];
const AMULET_MATERIALS = ['Amber', 'Driftwood', 'Coral', 'Agate', 'Ivory', 'Obsidian', 'Bone', 'Brass', 'Bronze', 'Pewter', 'Tortoise Shell', 'Golden', 'Azure', 'Crystal', 'Silver', 'Copper', 'Jade', 'Runed', 'Dragon Tooth', 'Sea Shell', 'Flint Stone', 'Iron', 'Steel', 'Mithril'];
const SYLLABLES = ['a', 'ab', 'ag', 'aks', 'ala', 'an', 'ankh', 'app', 'arg', 'arze', 'ash', 'aus', 'ban', 'bar', 'bat', 'bek', 'bie', 'bin', 'bit', 'bjor', 'blu', 'bot', 'bu', 'byt', 'comp', 'con', 'cos', 'cre', 'dalf', 'dan', 'den', 'der', 'doe', 'dok', 'eep', 'el', 'eng', 'er', 'ere', 'erk', 'esh', 'evs', 'fa', 'fid', 'flit', 'for', 'fri', 'fu', 'gan', 'gar', 'glen', 'gop', 'gre', 'ha', 'he', 'hyd', 'i', 'ing', 'ion', 'ip', 'ish', 'it', 'ite', 'iv', 'jo', 'kho', 'kli', 'klis', 'la', 'lech', 'man', 'mar', 'me', 'mi', 'mic', 'mik', 'mon', 'mung', 'mur', 'nag', 'nej', 'nelg', 'nep', 'ner', 'nes', 'nis', 'nih', 'nin', 'o', 'od', 'ood', 'org', 'orn', 'ox', 'oxy', 'pay', 'pet', 'ple', 'plu', 'po', 'pot', 'prok', 're', 'rea', 'rhov', 'ri', 'ro', 'rog', 'rok', 'rol', 'sa', 'san', 'sat', 'see', 'sef', 'seh', 'shu', 'ski', 'sna', 'sne', 'snik', 'sno', 'so', 'sol', 'sri', 'sta', 'sun', 'ta', 'tab', 'tem', 'ther', 'ti', 'tox', 'trol', 'tue', 'turs', 'u', 'ulk', 'um', 'un', 'uni', 'ur', 'val', 'viv', 'vly', 'vom', 'wah', 'wed', 'werg', 'wex', 'whon', 'wun', 'x', 'yerg', 'yp', 'zun', 'tri', 'blaa'];
const MUSHROOM_LOOKS = ['Blue', 'Black', 'Black Spotted', 'Brown', 'Dark Blue', 'Dark Green', 'Dark Red', 'Yellow', 'Furry', 'Green', 'Grey', 'Light Blue', 'Light Green', 'Violet', 'Red', 'Slimy', 'Tan', 'White', 'White Spotted', 'Wrinkled'];

export interface Flavors {
  /** kind id -> flavour word(s). */
  names: Record<string, string>;
  aware: string[];
  tried: string[];
}

function scrollTitle(): string {
  let t = '';
  while (t.length < 8 + randint0(6)) {
    let w = '';
    const n = 1 + randint0(2);
    for (let i = 0; i < n; i++) w += SYLLABLES[randint0(SYLLABLES.length)];
    t += (t ? ' ' : '') + w;
  }
  return t;
}

export function assignFlavors(): Flavors {
  const names: Record<string, string> = {};
  const pools: Partial<Record<TVal, string[]>> = {
    potion: shuffle(POTION_COLORS.slice()), wand: shuffle(WAND_METALS.slice()), rod: shuffle(WAND_METALS.slice()),
    staff: shuffle(STAFF_WOODS.slice()), ring: shuffle(RING_GEMS.slice()), amulet: shuffle(AMULET_MATERIALS.slice()),
    food: shuffle(MUSHROOM_LOOKS.slice()),
  };
  for (const k of OBJECTS) {
    if (!k.flavored) continue;
    if (k.tval === 'scroll') { names[k.id] = scrollTitle(); continue; }
    const pool = pools[k.tval];
    if (!pool) continue;
    names[k.id] = pool.length ? pool.pop()! : 'Plain';
  }
  return { names, aware: [], tried: [] };
}
export function isAware(fl: Flavors, kindId: string): boolean { const k = OBJECT_BY_ID[kindId]; return !k.flavored || fl.aware.includes(kindId); }
export function makeAware(fl: Flavors, kindId: string): void { if (!fl.aware.includes(kindId)) fl.aware.push(kindId); }
export function markTried(fl: Flavors, kindId: string): void { if (!fl.tried.includes(kindId)) fl.tried.push(kindId); }

// ---------------------------------------------------------------------------------------------
// Creation

export function makeItem(kindId: string, number = 1): Item {
  const k = OBJECT_BY_ID[kindId];
  if (!k) throw new Error('unknown object kind: ' + kindId);
  const it: Item = {
    id: nextItemId++, kind: kindId, number, toHit: k.toHit || 0, toDam: k.toDam || 0, toAc: k.toAc || 0, pval: k.pval || 0,
    known: false, charges: 0, timeout: 0, cursed: false, flags: [],
  };
  if (k.charges) it.charges = k.charges[0] + damroll(1, k.charges[1]);
  if (k.tval === 'light' && !(k.flags || []).includes('NO_FUEL')) it.timeout = k.recharge || 0;
  if ((k.flags || []).includes('CURSED')) it.cursed = true;
  if (k.tval === 'chest') it.pval = Math.max(1, k.pval || 1);
  // Simple kinds are known on sight.
  if (!k.flavored && ['food', 'flask', 'spike', 'key', 'gold', 'junk', ...BOOK_TVALS, 'shot', 'arrow', 'bolt', 'light', 'digger'].includes(k.tval) && !k.charges) it.known = !['shot', 'arrow', 'bolt', 'digger'].includes(k.tval);
  return it;
}

export function isWeapon(k: ObjectKind): boolean { return k.tval === 'sword' || k.tval === 'hafted' || k.tval === 'polearm' || k.tval === 'digger'; }
export function isArmor(k: ObjectKind): boolean { return ['soft_armor', 'hard_armor', 'dragon_armor', 'shield', 'helm', 'crown', 'cloak', 'gloves', 'boots'].includes(k.tval); }
export function isAmmo(k: ObjectKind): boolean { return k.tval === 'shot' || k.tval === 'arrow' || k.tval === 'bolt'; }
export function isWearable(k: ObjectKind): boolean { return isWeapon(k) || isArmor(k) || isAmmo(k) || k.tval === 'bow' || k.tval === 'ring' || k.tval === 'amulet' || k.tval === 'light'; }

export function wieldSlot(k: ObjectKind): SlotName | null {
  switch (k.tval) {
    case 'sword': case 'hafted': case 'polearm': case 'digger': return 'weapon';
    case 'bow': return 'bow';
    case 'ring': return 'ring1';
    case 'amulet': return 'amulet';
    case 'light': return 'light';
    case 'soft_armor': case 'hard_armor': case 'dragon_armor': return 'body';
    case 'cloak': return 'cloak';
    case 'shield': return 'shield';
    case 'helm': case 'crown': return 'helm';
    case 'gloves': return 'gloves';
    case 'boots': return 'boots';
    default: return null;
  }
}

/** Angband's apply_magic: add bonuses, an ego or a curse according to depth and luck. */
export function applyMagic(it: Item, level: number, good: boolean, great: boolean, allowArtifacts = true): void {
  const k = kindOf(it);
  let f1 = Math.min(75, level + 10), f2 = Math.min(20, Math.floor(f1 / 2));
  let power = 0;
  if (good || randint0(100) < f1) { power = 1; if (great || randint0(100) < f2) power = 2; }
  else if (randint0(100) < f1) { power = -1; if (randint0(100) < f2) power = -2; }
  // Artifact rolls as in Angband: one for an excellent object, four for a forced-great one, none otherwise.
  const rolls = great ? 4 : power >= 2 ? 1 : 0;
  if (allowArtifacts && (isWeapon(k) || isArmor(k) || k.tval === 'bow' || k.tval === 'light' || k.tval === 'ring' || k.tval === 'amulet') && it.number === 1) {
    for (let i = 0; i < rolls; i++) if (tryArtifact(it, level, great)) return;
  }
  if (isWeapon(k) || k.tval === 'bow' || isAmmo(k)) {
    const tohit1 = randint1(5) + mBonus(5, level), todam1 = randint1(5) + mBonus(5, level);
    const tohit2 = mBonus(10, level), todam2 = mBonus(10, level);
    if (power > 0) { it.toHit += tohit1; it.toDam += todam1; if (power > 1) { it.toHit += tohit2; it.toDam += todam2; } }
    else if (power < 0) { it.toHit -= tohit1; it.toDam -= todam1; if (power < -1) { it.toHit -= tohit2; it.toDam -= todam2; } if (it.toHit + it.toDam < 0) it.cursed = true; }
    if (power > 1 || (power > 0 && oneIn(8))) addEgo(it, level, false);
    else if (power < -1 || (power < 0 && oneIn(8))) addEgo(it, level, true);
    // Weapons deeper down can grow extra dice.
    if (power > 1 && isWeapon(k) && oneIn(10)) { const d = kindOf(it).dice; if (d && it.artifact == null) it.pval = it.pval; }
  } else if (isArmor(k)) {
    const toac1 = randint1(5) + mBonus(5, level), toac2 = mBonus(10, level);
    if (power > 0) { it.toAc += toac1; if (power > 1) it.toAc += toac2; }
    else if (power < 0) { it.toAc -= toac1; if (power < -1) it.toAc -= toac2; if (it.toAc < 0) it.cursed = true; }
    if (power > 1 || (power > 0 && oneIn(8))) addEgo(it, level, false);
    else if (power < -1 || (power < 0 && oneIn(8))) addEgo(it, level, true);
  } else if (k.tval === 'ring' || k.tval === 'amulet') {
    const fl = k.flags || [];
    const statLike = fl.some(f => ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR', 'STEALTH', 'SEARCH', 'INFRA'].includes(f));
    if (fl.includes('SPEED')) { it.pval = randint1(5) + mBonus(5, level); while (randint0(100) < 50) it.pval++; }
    else if (statLike) it.pval = 1 + mBonus(5, level);
    if (fl.some(f => f === 'RES_ACID' || f === 'RES_ELEC' || f === 'RES_FIRE' || f === 'RES_COLD')) { /* plain */ }
    if (k.id === 'ring_protection' || k.id === 'amulet_protection') it.toAc = 5 + randint1(5) + mBonus(10, level);
    if (k.id === 'ring_damage') it.toDam = 5 + randint1(3) + mBonus(7, level);
    if (k.id === 'ring_accuracy') it.toHit = 5 + randint1(3) + mBonus(7, level);
    if (k.id === 'ring_slaying') { it.toHit = randint1(5) + mBonus(5, level); it.toDam = randint1(5) + mBonus(5, level); }
    if (k.id === 'ring_searching' || k.id === 'amulet_searching') it.pval = 1 + mBonus(5, level);
    if (it.cursed || (fl.includes('CURSED'))) { it.cursed = true; it.pval = -Math.abs(it.pval || 1 + mBonus(5, level)); it.toAc = -Math.abs(it.toAc); it.toHit = -Math.abs(it.toHit); it.toDam = -Math.abs(it.toDam); }
    else if (power < 0 && statLike) { it.cursed = true; it.pval = -it.pval; }
  } else if (k.tval === 'light') {
    if (k.id === 'torch') it.timeout = Math.max(500, (k.recharge || 5000) - randint0(2000));
    if (k.id === 'lantern') it.timeout = Math.max(1000, (k.recharge || 15000) - randint0(7500));
  } else if (k.tval === 'chest') {
    // Chest level sets the lock and the trap (Angband's chest_traps table by level).
    it.pval = Math.max(1, Math.min(55, Math.floor(level / 2) + randint1(4)));
    it.toHit = oneIn(4) ? 0 : 1;
    const lv = it.pval;
    const r = randint0(100);
    it.toDam = lv < 5 ? (r < 60 ? 0 : 1) : lv < 15 ? (r < 40 ? 0 : r < 60 ? 1 : r < 80 ? 2 : 3) : lv < 30 ? (r < 30 ? 0 : r < 45 ? 4 : r < 60 ? 5 : r < 75 ? 2 : r < 90 ? 3 : 6) : (r < 20 ? 0 : r < 35 ? 7 : r < 50 ? 8 : r < 65 ? 6 : r < 80 ? 4 : 5);
  }
  if (it.cursed) it.flags.push('CURSED');
}

function addEgo(it: Item, level: number, cursed: boolean): void {
  const k = kindOf(it);
  const cands = EGOS.filter(e => e.tvals.includes(k.tval) && !!e.cursed === cursed && e.level <= level + 5);
  const e = weightedPick(cands, c => 100 / c.rarity);
  if (!e) return;
  it.ego = e.id;
  const roll = (r?: [number, number]) => r ? (r[0] + randint0(Math.max(0, r[1] - r[0] + 1))) : 0;
  it.toHit += roll(e.toHit); it.toDam += roll(e.toDam); it.toAc += roll(e.toAc);
  if (e.pval) it.pval = roll(e.pval);
  it.flags.push(...(e.flags || []));
  if (e.randomFlags && e.randomFlags.length) it.flags.push(e.randomFlags[randint0(e.randomFlags.length)]);
  if (e.cursed) { it.cursed = true; if (!it.flags.includes('CURSED')) it.flags.push('CURSED'); }
}

const artifactsMade = new Set<string>();
export function setArtifactsMade(list: string[]): void { artifactsMade.clear(); for (const a of list) artifactsMade.add(a); }
export function artifactsMadeList(): string[] { return [...artifactsMade]; }

function tryArtifact(it: Item, level: number, great: boolean): boolean {
  const k = kindOf(it);
  const cands = artifactList().filter(a => a.kind === k.id && !artifactsMade.has(a.id));
  for (const a of cands) {
    if (a.level > level && !great) { if (randint0((a.level - level) * 2) !== 0) continue; }
    if (!oneIn(a.rarity)) continue;
    makeArtifact(it, a);
    return true;
  }
  return false;
}
export function makeArtifact(it: Item, a: ArtifactKind): void {
  it.artifact = a.id; it.ego = undefined; it.number = 1;
  it.toHit = a.toHit || 0; it.toDam = a.toDam || 0; it.toAc = a.toAc || 0; it.pval = a.pval || 0;
  it.flags = [...(a.flags || [])];
  it.cursed = it.flags.includes('CURSED');
  artifactsMade.add(a.id);
}

/** Make a random object suited to `level` (Angband's make_object with its 1-in-10 depth boost). */
export function makeObject(level: number, good: boolean, great: boolean): Item | null {
  let lev = level;
  if (oneIn(10)) lev = Math.min(100, lev + Math.floor(lev / 4) + randint1(10));
  const cands = OBJECTS.filter(k => k.tval !== 'gold' && k.tval !== 'junk' && k.level <= lev && (!good || isWeapon(k) || isArmor(k) || k.tval === 'bow' || k.tval === 'ring' || k.tval === 'amulet' || k.tval === 'light' || BOOK_TVALS.includes(k.tval) || (k.tval === 'potion' && k.level >= 20) || (k.tval === 'scroll' && k.level >= 20)));
  const k = weightedPick(cands, c => 100 / c.rarity * (c.level >= lev - 10 ? 1.5 : 1));
  if (!k) return null;
  const it = makeItem(k.id, 1);
  if (k.stackable) {
    if (isAmmo(k)) it.number = damroll(6, 7);
    else if (k.tval === 'spike' || k.tval === 'flask') it.number = damroll(5, 5);
    else if (k.tval === 'food' || k.tval === 'potion' || k.tval === 'scroll') it.number = oneIn(4) ? damroll(2, 3) : 1;
    else if (k.tval === 'key') it.number = 1;
  }
  applyMagic(it, lev, good, great);
  return it;
}

export function makeGold(level: number, noSelling = false): Item {
  const golds = OBJECTS.filter(k => k.tval === 'gold').sort((a, b) => a.cost - b.cost);
  let i = Math.min(golds.length - 1, Math.floor((randint1(Math.max(1, level + 2)) + 2) / 2));
  if (oneIn(20)) i = Math.min(golds.length - 1, i + 1);
  const k = golds[Math.max(0, i)];
  const it = makeItem(k.id, 1);
  it.pval = Math.floor(k.cost * (randint1(8) + 3 + level / 3) / 4) + randint1(8);
  if (noSelling) it.pval = Math.floor(it.pval * 5 * (1 + Math.min(1, level / 50)));
  it.known = true;
  return it;
}

// ---------------------------------------------------------------------------------------------
// Knowledge and naming

export function itemFlags(it: Item): Set<ObjectFlag> {
  const s = new Set<ObjectFlag>(kindOf(it).flags || []);
  for (const f of it.flags) s.add(f);
  return s;
}
export function isKnown(it: Item, fl: Flavors): boolean { return it.known && isAware(fl, it.kind); }
export function identify(it: Item, fl: Flavors): void { it.known = true; makeAware(fl, it.kind); if (it.cursed) it.sense = undefined; }

/** The dice of a weapon or ammo, with an artifact's override. */
export function itemDice(it: Item): [number, number] {
  const a = artifactOf(it);
  return a?.dice || kindOf(it).dice || [0, 0];
}
export function itemAc(it: Item): number { const a = artifactOf(it); return a?.ac ?? kindOf(it).ac ?? 0; }

export function itemName(it: Item, fl: Flavors, opts: { article?: boolean; count?: boolean; full?: boolean; plainKind?: boolean; egosKnown?: string[] } = {}): string {
  const k = kindOf(it);
  const aware = isAware(fl, it.kind);
  const known = it.known && aware;
  const n = it.number;
  const flav = fl.names[it.kind];
  let base = '';
  const many = n !== 1;
  const mk = (s: string) => (many ? pluralName(n, s) : s);
  const kn = baseName(k);
  switch (k.tval) {
    case 'potion': base = aware ? `${mk('Potion')} of ${kn}` : `${flav} ${mk('Potion')}`; break;
    case 'scroll': base = aware ? `${mk('Scroll')} of ${kn}` : `${mk('Scroll')} titled "${flav}"`; break;
    case 'wand': base = aware ? `${mk('Wand')} of ${kn}` : `${flav} ${mk('Wand')}`; break;
    case 'staff': base = aware ? `${mk('Staff')} of ${kn}` : `${flav} ${mk('Staff')}`; break;
    case 'rod': base = aware ? `${mk('Rod')} of ${kn}` : `${flav} ${mk('Rod')}`; break;
    case 'ring': base = !k.flavored ? mk(k.name) : aware ? `${mk('Ring')} of ${kn}` : `${flav} ${mk('Ring')}`; break;
    case 'amulet': base = !k.flavored ? mk(k.name) : aware ? `${mk('Amulet')} of ${kn}` : `${flav} ${mk('Amulet')}`; break;
    case 'food': base = k.flavored ? (aware ? `${mk('Mushroom')} of ${kn}` : `${flav} ${mk('Mushroom')}`) : mk(k.name); break;
    case 'magic_book': base = `${mk('Magic Book')} ${k.name}`; break;
    case 'prayer_book': base = `${mk('Holy Book')} ${k.name}`; break;
    case 'nature_book': base = `${mk('Nature Book')} ${k.name}`; break;
    case 'necro_book': base = `${mk('Necromantic Tome')} ${k.name}`; break;
    case 'song_book': base = `${mk('Song Book')} ${k.name}`; break;
    case 'gold': base = `${it.pval} gold pieces worth of ${k.name}`; break;
    case 'chest': base = mk(k.name); if (it.known) base += it.toHit > 0 ? ' (locked)' : it.toDam > 0 ? ' (trapped)' : ' (unlocked)'; break;
    default: base = mk(k.name);
  }
  const art = artifactOf(it);
  if (art) base = `${base} ${art.name}`;
  else if (it.ego && (known || (opts.egosKnown && opts.egosKnown.includes(it.ego)))) base = `${base} ${egoOf(it)!.name}`;
  if (opts.plainKind) return base;
  let s = base;
  const dice = itemDice(it);
  if (isWeapon(k) || isAmmo(k)) s += ` (${dice[0]}d${dice[1]})`;
  if (k.tval === 'bow') s += ` (x${k.multiplier || 2})`;
  if (known || opts.full) {
    if (isWeapon(k) || isAmmo(k) || k.tval === 'bow' || (it.toHit || it.toDam) && (k.tval === 'ring' || k.tval === 'gloves')) s += ` (${fmt(it.toHit)},${fmt(it.toDam)})`;
    const ac = itemAc(it);
    if (isArmor(k)) s += ` [${ac},${fmt(it.toAc)}]`;
    else if (it.toAc && k.tval !== 'gold') s += ` [${fmt(it.toAc)}]`;
    const flags = itemFlags(it);
    const pvalFlag = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR', 'STEALTH', 'SEARCH', 'INFRA', 'TUNNEL', 'SPEED', 'BLOWS', 'SHOTS', 'MIGHT'].some(f => flags.has(f as ObjectFlag));
    if (pvalFlag && k.tval !== 'light' && k.tval !== 'food') s += ` (${fmt(it.pval)})`;
    if (k.tval === 'wand' || k.tval === 'staff') s += ` (${it.charges} charge${it.charges === 1 ? '' : 's'})`;
    if (k.tval === 'rod' && it.timeout > 0) s += ' (charging)';
    if (k.tval === 'light' && !flags.has('NO_FUEL')) s += ` (${it.timeout} turns)`;
    if (it.cursed) s += ' {cursed}';
  } else {
    if (isArmor(k)) s += ` [${itemAc(it)}]`;
    if (k.tval === 'light' && !(k.flags || []).includes('NO_FUEL')) s += ` (${it.timeout} turns)`;
    if (it.sense) s += ` {${it.sense}}`;
    else if (k.flavored && fl.tried.includes(it.kind)) s += ' {tried}';
    if (k.tval === 'rod' && it.timeout > 0) s += ' (charging)';
  }
  if (it.inscription) s += ` {${it.inscription}}`;
  if (k.tval === 'gold') return s;
  if (opts.count !== false) {
    if (n !== 1) s = `${n} ${s}`;
    else if (opts.article !== false && !/^the /i.test(s)) s = (art ? 'the ' : /^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;
  }
  return capitalize(s);
}
function fmt(v: number): string { return (v >= 0 ? '+' : '') + v; }
/** The kind's name without the "Potion of" / "Ring of" style prefix the data table carries. */
export function baseName(k: ObjectKind): string {
  return k.name.replace(/^(Potion|Scroll|Wand|Staff|Rod|Ring|Amulet|Mushroom) of /, '');
}
/** Pluralise the head noun: "Flask of Oil" -> "Flasks of Oil", "Wooden Torch" -> "Wooden Torches". */
export function pluralName(n: number, s: string): string {
  if (n === 1) return s;
  const i = s.indexOf(' of ');
  if (i > 0) return plural(n, s.slice(0, i)) + s.slice(i);
  const parts = s.split(' ');
  parts[parts.length - 1] = plural(n, parts[parts.length - 1]);
  return parts.join(' ');
}

/** Can two stacks merge? Angband's object_similar. */
export function canStack(a: Item, b: Item, fl: Flavors): boolean {
  if (a.kind !== b.kind || a.artifact || b.artifact) return false;
  const k = kindOf(a);
  if (!k.stackable && !(k.tval === 'wand' || k.tval === 'staff' || k.tval === 'rod' || BOOK_TVALS.includes(k.tval))) {
    if (!(isAmmo(k) || k.tval === 'potion' || k.tval === 'scroll' || k.tval === 'food' || k.tval === 'flask' || k.tval === 'spike' || k.tval === 'key' || k.tval === 'light')) return false;
  }
  if (a.toHit !== b.toHit || a.toDam !== b.toDam || a.toAc !== b.toAc || a.pval !== b.pval || a.ego !== b.ego || a.cursed !== b.cursed) return false;
  if (isKnown(a, fl) !== isKnown(b, fl)) return false;
  if (a.sense !== b.sense) return false;
  if (k.tval === 'light' && a.timeout !== b.timeout) return false;
  if (k.tval === 'rod' && (a.timeout > 0 || b.timeout > 0)) return false;
  if (a.inscription !== b.inscription) return false;
  return a.number + b.number <= 99;
}
/** Merge b into a (b is consumed). */
export function absorb(a: Item, b: Item): void {
  a.number += b.number;
  const k = kindOf(a);
  if (k.tval === 'wand' || k.tval === 'staff') a.charges += b.charges;
}
export function splitStack(a: Item, n: number): Item {
  const b: Item = { ...a, id: nextItemId++, number: n, flags: [...a.flags] };
  a.number -= n;
  const k = kindOf(a);
  if (k.tval === 'wand' || k.tval === 'staff') { const c = Math.floor(a.charges * n / (a.number + n)); b.charges = c; a.charges -= c; }
  return b;
}

/** Real value of one item (Angband's object_value_real, simplified). */
export function itemValue(it: Item, fl: Flavors, known = true): number {
  const k = kindOf(it);
  if (k.tval === 'gold') return it.pval;
  if (!known && !isKnown(it, fl)) {
    if (isWearable(k) && !it.known) return k.flavored ? 20 : k.cost;
    if (k.flavored && !isAware(fl, it.kind)) return k.tval === 'ring' || k.tval === 'amulet' ? 45 : k.tval === 'wand' ? 50 : k.tval === 'staff' ? 70 : k.tval === 'rod' ? 90 : 20;
  }
  const art = artifactOf(it);
  if (art) return art.cost;
  let v = k.cost;
  if (it.cursed && (it.toHit < 0 || it.toDam < 0 || it.toAc < 0 || it.pval < 0)) return 0;
  const e = egoOf(it);
  if (e) v += e.cost;
  const flags = itemFlags(it);
  const pvalFlags: ObjectFlag[] = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR', 'STEALTH', 'SEARCH', 'INFRA', 'TUNNEL'];
  if (pvalFlags.some(f => flags.has(f)) && it.pval) v += it.pval * 200;
  if (flags.has('SPEED')) v += it.pval * 3000;
  if (flags.has('BLOWS')) v += it.pval * 5000;
  if (flags.has('SHOTS') || flags.has('MIGHT')) v += it.pval * 2000;
  if (isWeapon(k) || isAmmo(k) || k.tval === 'bow') { v += (it.toHit + it.toDam) * 100; if (isAmmo(k)) v = Math.floor(v / 4); }
  if (isArmor(k)) v += it.toAc * 100 + (it.toHit + it.toDam) * 100;
  if (k.tval === 'ring' || k.tval === 'amulet') v += (it.toHit + it.toDam + it.toAc) * 100;
  if (k.tval === 'wand' || k.tval === 'staff') v += it.charges * Math.max(1, Math.floor(k.cost / 20));
  return Math.max(0, v);
}

export function tvalLabel(t: TVal): string {
  const m: Record<TVal, string> = { sword: 'Swords', hafted: 'Hafted weapons', polearm: 'Polearms', digger: 'Diggers', bow: 'Launchers', shot: 'Shots', arrow: 'Arrows', bolt: 'Bolts', soft_armor: 'Soft armour', hard_armor: 'Hard armour', dragon_armor: 'Dragon armour', shield: 'Shields', helm: 'Helms', crown: 'Crowns', cloak: 'Cloaks', gloves: 'Gloves', boots: 'Boots', ring: 'Rings', amulet: 'Amulets', light: 'Lights', potion: 'Potions', scroll: 'Scrolls', wand: 'Wands', staff: 'Staffs', rod: 'Rods', food: 'Food', flask: 'Flasks', magic_book: 'Magic books', prayer_book: 'Prayer books', nature_book: 'Nature books', necro_book: 'Necromantic tomes', song_book: 'Song books', spike: 'Spikes', chest: 'Chests', gold: 'Gold', key: 'Keys', junk: 'Junk' };
  return m[t];
}
/** Which icon sprites.ts draws for a kind. */
export function itemIcon(k: ObjectKind): string {
  switch (k.tval) {
    case 'sword': case 'hafted': case 'polearm': return 'weapon';
    case 'digger': return 'digger';
    case 'bow': return 'bow';
    case 'shot': case 'arrow': case 'bolt': return 'ammo';
    case 'soft_armor': case 'hard_armor': case 'dragon_armor': return 'armor';
    case 'helm': case 'crown': return 'helm';
    case 'magic_book': case 'prayer_book': case 'nature_book': case 'necro_book': case 'song_book': return 'book';
    default: return k.tval;
  }
}
/** Pseudo-id feeling for a wearable, by its bonuses (heavy pseudo-id for warriors, light otherwise). */
export function senseItem(it: Item, heavy: boolean): Sense | undefined {
  const k = kindOf(it);
  if (!(isWeapon(k) || isArmor(k) || k.tval === 'bow' || isAmmo(k))) return undefined;
  if (it.artifact) return heavy ? 'special' : 'excellent';
  if (it.cursed) return heavy ? (it.ego ? 'terrible' : 'cursed') : 'cursed';
  if (it.ego) return heavy ? 'excellent' : 'good';
  if (it.toHit > 0 || it.toDam > 0 || it.toAc > 0) return 'good';
  return heavy ? 'average' : undefined;
}

// ---------------------------------------------------------------------------------------------
// Command inscriptions (Angband's `@q1` and `!*` conventions)

/** The digits inscribed for a command letter: `@q1@q2` on a potion answers 1 or 2 at the quaff prompt. */
export function inscriptionTags(it: Item, cmd: string): string[] {
  const out: string[] = [];
  if (!it.inscription) return out;
  const re = /@(.)(\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(it.inscription))) if (m[1] === cmd) out.push(m[2]);
  return out;
}
/** Does the inscription ask for confirmation before this command: `!q` before quaffing, `!*` before anything. */
export function inscriptionConfirms(it: Item, cmd: string): boolean {
  if (!it.inscription) return false;
  const re = /!(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(it.inscription))) if (m[1] === cmd || m[1] === '*') return true;
  return false;
}
