// Ignore settings: which finds the hero cannot be bothered with. Angband calls this squelching.
// It matters more here than in Angband because auto-pickup is on by default, so without it the
// hero hoovers up every rusty dagger in the dungeon.
//
// A setting is a quality threshold per equipment group ("ignore anything average or worse among
// shields"), plus a list of known consumable kinds to leave on the floor. Nothing unidentified is
// ever ignored -- you cannot judge what you have not seen -- and artifacts never are.
import type { Item, ObjectKind, TVal } from './types.ts';
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
  if (it.toHit < 0 || it.toDam < 0 || it.toAc < 0 || (it.pval < 0 && itemFlags(it).size > 0)) return 'worthless';
  if (it.toHit > 0 || it.toDam > 0 || it.toAc > 0) return 'good';
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
  // Consumables and devices: ignored kind by kind, and only once the hero knows what they are.
  if (g.ignore.kinds.includes(it.kind)) return isAware(g.flavors, it.kind);
  const gp = groupOf(k);
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
