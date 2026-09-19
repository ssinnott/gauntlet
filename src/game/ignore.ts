// Ignore settings: which finds the hero cannot be bothered with. Angband calls this squelching.
// It matters more here than in Angband because auto-pickup is on by default, so without it the
// hero hoovers up every rusty dagger in the dungeon.
//
// A setting is a quality threshold per equipment group ("ignore anything average or worse among
// shields"), plus a list of known consumable kinds to leave on the floor. Nothing unidentified is
// ever ignored -- you cannot judge what you have not seen -- and artifacts never are.
import type { Item, ObjectFlag, ObjectKind, TVal } from './types.ts';
import type { Game } from './state.ts';
import { kindOf, isAware, itemFlags } from './items.ts';

/** How much of a group to leave behind. Each level includes the ones before it. */
export type IgnoreQuality = 'none' | 'worthless' | 'average' | 'good' | 'all';
export const IGNORE_QUALITIES: IgnoreQuality[] = ['none', 'worthless', 'average', 'good', 'all'];
export const IGNORE_QUALITY_TEXT: Record<IgnoreQuality, string> = {
  none: 'keep everything',
  worthless: 'leave cursed and damaged',
  average: 'leave plain ones too',
  good: 'leave all but the excellent',
  all: 'leave everything but artifacts',
};

/** The equipment groups a threshold can be set for. */
export type IgnoreGroup = 'weapon' | 'launcher' | 'ammo' | 'body' | 'shield' | 'helm' | 'cloak' | 'gloves' | 'boots' | 'ring' | 'amulet' | 'light';
export const IGNORE_GROUPS: IgnoreGroup[] = ['weapon', 'launcher', 'ammo', 'body', 'shield', 'helm', 'cloak', 'gloves', 'boots', 'ring', 'amulet', 'light'];
export const IGNORE_GROUP_LABEL: Record<IgnoreGroup, string> = {
  weapon: 'Weapons', launcher: 'Launchers', ammo: 'Ammunition', body: 'Body armour', shield: 'Shields', helm: 'Helms and crowns',
  cloak: 'Cloaks', gloves: 'Gloves', boots: 'Boots', ring: 'Rings', amulet: 'Amulets', light: 'Lights',
};

export interface IgnoreSettings {
  /** Quality threshold per equipment group. */
  quality: Record<IgnoreGroup, IgnoreQuality>;
  /** Object kind ids the hero has judged not worth carrying (potions, scrolls, wands, food...). */
  kinds: string[];
}

export function defaultIgnore(): IgnoreSettings {
  const quality = {} as Record<IgnoreGroup, IgnoreQuality>;
  for (const gp of IGNORE_GROUPS) quality[gp] = 'none';
  return { quality, kinds: [] };
}

/** Fill in anything a save from an older version is missing. */
export function normalizeIgnore(x: Partial<IgnoreSettings> | undefined): IgnoreSettings {
  const out = defaultIgnore();
  if (!x) return out;
  if (x.quality) for (const gp of IGNORE_GROUPS) { const v = x.quality[gp]; if (v && IGNORE_QUALITIES.includes(v)) out.quality[gp] = v; }
  if (Array.isArray(x.kinds)) out.kinds = x.kinds.filter(k => typeof k === 'string');
  return out;
}

const GROUP_OF: Partial<Record<TVal, IgnoreGroup>> = {
  sword: 'weapon', hafted: 'weapon', polearm: 'weapon', digger: 'weapon',
  bow: 'launcher', shot: 'ammo', arrow: 'ammo', bolt: 'ammo',
  soft_armor: 'body', hard_armor: 'body', dragon_armor: 'body',
  shield: 'shield', helm: 'helm', crown: 'helm', cloak: 'cloak', gloves: 'gloves', boots: 'boots',
  ring: 'ring', amulet: 'amulet', light: 'light',
};
export function groupOf(k: ObjectKind): IgnoreGroup | null { return GROUP_OF[k.tval] ?? null; }

/** What the hero currently believes an item is worth. 'unknown' means no judgement is possible yet. */
export type ItemQuality = 'unknown' | 'worthless' | 'average' | 'good' | 'excellent' | 'special';

/** Flags that say nothing about whether a find is worth carrying. */
const DULL_FLAGS: ObjectFlag[] = ['IGNORE_ACID', 'IGNORE_ELEC', 'IGNORE_FIRE', 'IGNORE_COLD', 'EASY_KNOW', 'SHOW_MODS'];
/** Flags whose worth is carried by the shared pval. */
const PVAL_FLAGS: ObjectFlag[] = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR', 'STEALTH', 'SEARCH', 'INFRA', 'TUNNEL', 'SPEED', 'BLOWS', 'SHOTS', 'MIGHT'];
/** The handful that change how the game is played. These rank with an ego, not with a plus one. */
const MAJOR_FLAGS: ObjectFlag[] = ['SPEED', 'BLOWS', 'SHOTS', 'MIGHT', 'TELEPATHY', 'FREE_ACT', 'HOLD_LIFE'];

export function itemQuality(it: Item): ItemQuality {
  if (it.artifact) return 'special';
  // A pseudo-id feeling counts, and so does full knowledge.
  if (!it.known) {
    switch (it.sense) {
      case 'special': return 'special';
      case 'excellent': return 'excellent';
      case 'good': return 'good';
      case 'average': return 'average';
      case 'cursed': case 'terrible': return 'worthless';
      default: return 'unknown';
    }
  }
  if (it.cursed) return 'worthless';
  if (it.ego) return 'excellent';
  // Judge the MAGIC, not the raw number. Plenty of base kinds carry a built-in penalty -- heavy
  // armour has a to-hit malus -- and grading those against zero condemned Red Dragon Scale Mail as
  // worthless, so the mildest ignore setting threw it away.
  const k = kindOf(it);
  const dHit = it.toHit - (k.toHit || 0);
  const dDam = it.toDam - (k.toDam || 0);
  const dAc = it.toAc - (k.toAc || 0);
  const flags = itemFlags(it);
  const pvalDriven = PVAL_FLAGS.some(f => flags.has(f));
  if (dHit < 0 || dDam < 0 || dAc < 0 || (pvalDriven && it.pval < 0)) return 'worthless';
  // Speed, extra blows, telepathy and the like rank with an ego rather than with a plain bonus: a
  // hero who set a group to "leave all but the excellent" did not mean to leave a Ring of Speed.
  for (const f of MAJOR_FLAGS) if (flags.has(f) && (!PVAL_FLAGS.includes(f) || it.pval > 0)) return 'excellent';
  if (dHit > 0 || dDam > 0 || dAc > 0 || (pvalDriven && it.pval > 0)) return 'good';
  // Anything that grants an actual ability is worth keeping even with no bonuses on it: a Ring of
  // Speed has no plusses at all, and grading it 'average' meant a tidy hero would walk past one.
  for (const f of flags) if (!DULL_FLAGS.includes(f)) return 'good';
  return 'average';
}

const RANK: Record<ItemQuality, number> = { unknown: -1, worthless: 0, average: 1, good: 2, excellent: 3, special: 4 };
const THRESHOLD: Record<IgnoreQuality, number> = { none: -1, worthless: 0, average: 1, good: 2, all: 3 };

/** An inscription of `=g` means "always pick this up", whatever the settings say. */
export function alwaysPickUp(it: Item): boolean { return !!it.inscription && /=g/.test(it.inscription); }

/** Would the hero walk past this? */
export function isIgnored(g: Game, it: Item): boolean {
  if (!g.options.ignoreItems || g.showIgnored) return false;
  if (it.artifact || alwaysPickUp(it)) return false;
  const k = kindOf(it);
  if (k.tval === 'gold' || k.tval === 'key' || k.tval === 'chest') return false;
  const gp = groupOf(k);
  // Ignored kind by kind, and only once the hero knows what they are. For a consumable or a device
  // the kind IS the whole story. A piece of gear is still judged on its merits, though: telling the
  // game you are done with long swords must not hide a Long Sword of Westernesse.
  if (g.ignore.kinds.includes(it.kind) && isAware(g.flavors, it.kind)) {
    if (!gp) return true;
    const kq = itemQuality(it);
    if (kq !== 'unknown' && RANK[kq] <= RANK.average) return true;
  }
  if (!gp) return false;
  const want = THRESHOLD[g.ignore.quality[gp] ?? 'none'];
  if (want < 0) return false;
  const q = itemQuality(it);
  if (q === 'unknown' || q === 'special') return false;
  return RANK[q] <= want;
}

/** Add or remove a kind from the ignore list. Returns true if it is ignored afterwards. */
export function toggleIgnoreKind(g: Game, kindId: string): boolean {
  const i = g.ignore.kinds.indexOf(kindId);
  if (i >= 0) { g.ignore.kinds.splice(i, 1); return false; }
  g.ignore.kinds.push(kindId);
  return true;
}
