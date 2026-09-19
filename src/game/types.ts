// The shared vocabulary of the game: tiles, monsters, objects, the player and the level. Pure data
// declarations -- nothing here touches the DOM, so the same types drive the browser game and the
// headless simulator in tools/sim.ts.

export interface Pos { x: number; y: number; }

/** The eight directions in Angband's keypad order: index = keypad digit, 5 unused. */
export const DIR_DX = [0, -1, 0, 1, -1, 0, 1, -1, 0, 1];
export const DIR_DY = [0, 1, 1, 1, 0, 0, 0, -1, -1, -1];
/** Keypad digit for a delta, or 5 for none. */
export function dirOf(dx: number, dy: number): number {
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  for (let d = 1; d <= 9; d++) if (DIR_DX[d] === sx && DIR_DY[d] === sy) return d;
  return 5;
}

// ---------------------------------------------------------------------------------------------
// Terrain

/** Tile ids stored in Level.tiles. */
export const T = {
  FLOOR: 0,
  GRANITE: 1,
  PERM: 2,
  MAGMA: 3,
  QUARTZ: 4,
  MAGMA_K: 5,   // magma vein with treasure
  QUARTZ_K: 6,  // quartz vein with treasure
  DOOR_CLOSED: 7,
  DOOR_OPEN: 8,
  DOOR_BROKEN: 9,
  SECRET_DOOR: 10, // looks like granite until found
  RUBBLE: 11,
  STAIRS_UP: 12,
  STAIRS_DOWN: 13,
  TRAP: 14,        // visible trap; kind in Level.aux
  TRAP_HIDDEN: 15, // invisible trap; found by searching or by walking on it
  GRASS: 16,
  ROAD: 17,
  TREE: 18,
  WATER: 19,
  SHOP_0: 20, // store entrances: SHOP_0 + store index (0..7)
} as const;
export const SHOP_COUNT = 8;
export function isShop(t: number): boolean { return t >= T.SHOP_0 && t < T.SHOP_0 + SHOP_COUNT; }
export function isWall(t: number): boolean { return t >= T.GRANITE && t <= T.QUARTZ_K || t === T.SECRET_DOOR; }
export function isVein(t: number): boolean { return t >= T.MAGMA && t <= T.QUARTZ_K; }
export function isDoorClosed(t: number): boolean { return t === T.DOOR_CLOSED; }
/** Can a walker (or a projectile) pass this tile? Doors must be opened first. */
export function isPassable(t: number): boolean {
  return t === T.FLOOR || t === T.DOOR_OPEN || t === T.DOOR_BROKEN || t === T.STAIRS_UP || t === T.STAIRS_DOWN ||
    t === T.TRAP || t === T.TRAP_HIDDEN || t === T.GRASS || t === T.ROAD || isShop(t);
}
/** Does this tile block line of sight? */
export function blocksLos(t: number): boolean { return isWall(t) || t === T.DOOR_CLOSED || t === T.RUBBLE || t === T.TREE; }
/** Can an object rest here? */
export function canHoldObject(t: number): boolean { return t === T.FLOOR || t === T.DOOR_OPEN || t === T.DOOR_BROKEN || t === T.GRASS || t === T.ROAD || t === T.TRAP || t === T.TRAP_HIDDEN; }

/** Per-grid flag bits stored in Level.flags. */
export const F = {
  MARK: 1,   // remembered by the player (drawn from memory)
  GLOW: 2,   // permanently lit
  ROOM: 4,   // part of a room (lit rooms light up when entered)
  VIEW: 8,   // currently in the player's line of sight
  SEEN: 16,  // VIEW and lit: the player can actually see it right now
  TEMP: 32,  // scratch
  VAULT: 64, // inside a vault: no teleport-to, no stairs
  GLYPH: 128, // a glyph of warding: monsters cannot enter (they may break it)
} as const;

/** Trap kinds stored in Level.aux on a TRAP / TRAP_HIDDEN tile. */
export const TRAP_KINDS = ['trap door', 'pit', 'spiked pit', 'dart trap (strength)', 'dart trap (dexterity)', 'dart trap (constitution)', 'teleport rune', 'fire trap', 'acid trap', 'poison gas', 'sleep gas', 'summoning rune', 'alarm', 'strange rune (confusion)', 'poison pit', 'dart trap (slowness)', 'blinding gas'] as const;

// ---------------------------------------------------------------------------------------------
// Monsters

/** How a monster is drawn: a procedural sprite family (see ui/sprites.ts). 'rig' uses the engine's paper-doll. */
export type SpriteKind = 'rig' | 'blob' | 'bat' | 'bird' | 'snake' | 'spider' | 'insect' | 'worm' | 'mold' | 'jelly' | 'eye' | 'ghost' | 'skeleton' |
  'zombie' | 'dog' | 'cat' | 'rodent' | 'dragon' | 'hydra' | 'golem' | 'quadruped' | 'demon' | 'vortex' | 'elemental' | 'tree' | 'mimic' | 'generator' | 'mushroom' | 'centipede' | 'giant' | 'troll' | 'orc' | 'kobold' | 'humanoid' | 'yeek' | 'ant' | 'louse' | 'nether' | 'angel' | 'ogre' | 'harpy' | 'naga' | 'wight';

export type BlowMethod = 'HIT' | 'TOUCH' | 'PUNCH' | 'KICK' | 'CLAW' | 'BITE' | 'STING' | 'BUTT' | 'CRUSH' | 'ENGULF' | 'CRAWL' | 'DROOL' | 'SPIT' | 'GAZE' | 'WAIL' | 'SPORE' | 'BEG' | 'INSULT' | 'MOAN' | 'KISS';
export type BlowEffect = 'HURT' | 'POISON' | 'UN_BONUS' | 'UN_POWER' | 'EAT_GOLD' | 'EAT_ITEM' | 'EAT_FOOD' | 'EAT_LITE' | 'ACID' | 'ELEC' | 'FIRE' | 'COLD' | 'BLIND' | 'CONFUSE' | 'TERRIFY' | 'PARALYZE' |
  'LOSE_STR' | 'LOSE_INT' | 'LOSE_WIS' | 'LOSE_DEX' | 'LOSE_CON' | 'LOSE_CHR' | 'LOSE_ALL' | 'SHATTER' | 'EXP_10' | 'EXP_20' | 'EXP_40' | 'EXP_80' | 'HALLU' | 'DISENCHANT';

export interface Blow { method: BlowMethod; effect: BlowEffect; dice?: [number, number]; }

export type MonsterFlag =
  | 'UNIQUE' | 'MALE' | 'FEMALE' | 'NEVER_MOVE' | 'NEVER_BLOW' | 'INVISIBLE' | 'COLD_BLOOD' | 'EMPTY_MIND' | 'WEIRD_MIND'
  | 'MULTIPLY' | 'REGENERATE' | 'POWERFUL' | 'FRIENDS' | 'ESCORT' | 'OPEN_DOOR' | 'BASH_DOOR' | 'PASS_WALL' | 'KILL_WALL'
  | 'KILL_BODY' | 'TAKE_ITEM' | 'KILL_ITEM' | 'RAND_25' | 'RAND_50' | 'STUPID' | 'SMART'
  | 'ANIMAL' | 'EVIL' | 'UNDEAD' | 'DEMON' | 'ORC' | 'TROLL' | 'GIANT' | 'DRAGON'
  | 'IM_ACID' | 'IM_ELEC' | 'IM_FIRE' | 'IM_COLD' | 'IM_POIS' | 'HURT_LITE' | 'HURT_ROCK' | 'HURT_FIRE' | 'HURT_COLD'
  | 'NO_FEAR' | 'NO_CONF' | 'NO_SLEEP' | 'NO_STUN'
  | 'DROP_60' | 'DROP_90' | 'DROP_1D2' | 'DROP_2D2' | 'DROP_4D2' | 'ONLY_GOLD' | 'ONLY_ITEM' | 'DROP_GOOD' | 'DROP_GREAT'
  | 'FORCE_SLEEP' | 'FORCE_DEPTH' | 'GENERATOR' | 'GROUP'
  // families used by summons and pits, and the two quest monsters
  | 'HOUND' | 'SPIDER' | 'HYDRA' | 'ANGEL' | 'WRAITH' | 'QUESTOR'
  | 'IM_NETHER' | 'RES_NEXUS' | 'RES_DISEN' | 'RES_PLASMA' | 'RES_TELE' | 'NO_FEAR_NEVER';

export type MonsterSpell =
  | 'SHRIEK' | 'ARROW' | 'BOLT_ACID' | 'BOLT_ELEC' | 'BOLT_FIRE' | 'BOLT_COLD' | 'BOLT_POIS' | 'BOLT_NETHER' | 'BOLT_MANA' | 'MISSILE'
  | 'BALL_ACID' | 'BALL_ELEC' | 'BALL_FIRE' | 'BALL_COLD' | 'BALL_POIS' | 'BALL_NETHER' | 'BALL_DARK'
  | 'BOLT_WATER' | 'BOLT_PLASMA' | 'BOLT_ICE' | 'BALL_MANA' | 'BALL_CHAOS' | 'BALL_WATER'
  | 'BR_ACID' | 'BR_ELEC' | 'BR_FIRE' | 'BR_COLD' | 'BR_POIS' | 'BR_NETHER' | 'BR_DARK' | 'BR_LITE' | 'BR_SOUND' | 'BR_CHAOS' | 'BR_CONF'
  | 'BR_NEXUS' | 'BR_TIME' | 'BR_INERTIA' | 'BR_GRAVITY' | 'BR_SHARDS' | 'BR_PLASMA' | 'BR_FORCE' | 'BR_DISEN' | 'BR_DISINT' | 'BR_MANA'
  | 'CAUSE_1' | 'CAUSE_2' | 'CAUSE_3' | 'CAUSE_4' | 'MIND_BLAST' | 'BRAIN_SMASH' | 'DRAIN_MANA'
  | 'SCARE' | 'CONF' | 'BLIND' | 'SLOW' | 'HOLD' | 'HASTE' | 'HEAL' | 'BLINK' | 'TPORT' | 'TELE_TO' | 'TELE_AWAY' | 'TELE_LEVEL' | 'DARKNESS' | 'TRAPS' | 'FORGET'
  | 'S_MONSTER' | 'S_MONSTERS' | 'S_KIN' | 'S_UNDEAD' | 'S_DRAGON' | 'S_DEMON' | 'S_ANIMAL'
  | 'S_HYDRA' | 'S_ANGEL' | 'S_SPIDER' | 'S_HOUND' | 'S_HI_UNDEAD' | 'S_HI_DRAGON' | 'S_HI_DEMON' | 'S_WRAITH' | 'S_UNIQUE';

export interface MonsterRace {
  id: string;
  name: string;
  sprite: SpriteKind;
  /** Main body colour (hex) and an accent. */
  color: string;
  color2?: string;
  /** Draw scale relative to a human (1). */
  size?: number;
  /** Native depth, and rarity 1 (common) .. 6 (very rare). Depth 0 monsters live in the town. */
  depth: number;
  rarity: number;
  /** Speed delta from normal: 0 = normal, +10 = twice as fast, -10 = half. */
  speed: number;
  /** Average hit points. */
  hp: number;
  ac: number;
  /** Initial sleepiness (0 = always awake) and detection range in tiles. */
  sleep: number;
  vision: number;
  /** Experience value: exp gained = exp * depth / player level. */
  exp: number;
  blows: Blow[];
  flags: MonsterFlag[];
  /** Casts one of `spells` with probability 1 / spellFreq each turn it can see the player. */
  spellFreq?: number;
  spells?: MonsterSpell[];
  /** GENERATOR only: the race id it spawns, and how many turns between spawns. */
  spawns?: string;
  spawnEvery?: number;
  /**
   * GENERATOR only: the family it draws from (a themedFilter theme). An intact generator reaches
   * deeper into that family than a broken one; `spawns` is the floor it falls back to.
   */
  spawnTheme?: string;
  /** ESCORT: races that appear with it. */
  escorts?: string[];
  /** A word or two of flavour for the look command. */
  desc?: string;
}

export interface Monster extends Pos {
  id: number;
  race: string;
  hp: number;
  maxhp: number;
  energy: number;
  /** Speed delta including haste / slow. */
  speed: number;
  sleep: number;
  stunned: number;
  confused: number;
  afraid: number;
  hasted: number;
  slowed: number;
  /** Items it has stolen or picked up; dropped on death. */
  held: Item[];
  /** Facing for the sprite: 1 right, -1 left. */
  facing: 1 | -1;
  /** Can the player currently see it? */
  visible: boolean;
  /** Shown by detection magic until it acts. */
  detected: boolean;
  /** GENERATOR: turns until the next spawn. */
  spawnTimer: number;
  /**
   * GENERATOR: how intact it is, 3 down to 1. It spawns faster and reaches deeper at 3, and the
   * sprite comes apart as it falls. Derived from hit points, so old saves recover it.
   */
  tier?: number;
  /** Visual interpolation state (render only; not saved). */
  vx?: number;
  vy?: number;
  hitFlash?: number;
  attackAnim?: number;
}

// ---------------------------------------------------------------------------------------------
// Objects

export type TVal = 'sword' | 'hafted' | 'polearm' | 'digger' | 'bow' | 'shot' | 'arrow' | 'bolt' |
  'soft_armor' | 'hard_armor' | 'dragon_armor' | 'shield' | 'helm' | 'crown' | 'cloak' | 'gloves' | 'boots' |
  'ring' | 'amulet' | 'light' | 'potion' | 'scroll' | 'wand' | 'staff' | 'rod' | 'food' | 'flask' | 'magic_book' | 'prayer_book' | 'nature_book' | 'necro_book' |
  'spike' | 'chest' | 'gold' | 'key' | 'junk';

export type Stat = 'STR' | 'INT' | 'WIS' | 'DEX' | 'CON' | 'CHR';
export const STATS: Stat[] = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR'];

export type Element = 'acid' | 'elec' | 'fire' | 'cold' | 'pois' | 'lite' | 'dark' | 'nether' | 'sound' | 'chaos' | 'conf' | 'mana' | 'missile' | 'holy' | 'water' | 'nexus' | 'disen' |
  'shards' | 'time' | 'inertia' | 'gravity' | 'plasma' | 'force' | 'ice' | 'disint';

export type ObjectFlag =
  // pval-driven bonuses
  | 'STR' | 'INT' | 'WIS' | 'DEX' | 'CON' | 'CHR' | 'STEALTH' | 'SEARCH' | 'INFRA' | 'TUNNEL' | 'SPEED' | 'BLOWS' | 'SHOTS' | 'MIGHT'
  // slays and brands (weapons)
  | 'SLAY_ANIMAL' | 'SLAY_EVIL' | 'SLAY_UNDEAD' | 'SLAY_DEMON' | 'SLAY_ORC' | 'SLAY_TROLL' | 'SLAY_GIANT' | 'SLAY_DRAGON' | 'KILL_DRAGON'
  | 'BRAND_ACID' | 'BRAND_ELEC' | 'BRAND_FIRE' | 'BRAND_COLD' | 'BRAND_POIS' | 'IMPACT' | 'VORPAL'
  // sustains / immunities / resists
  | 'SUST_STR' | 'SUST_INT' | 'SUST_WIS' | 'SUST_DEX' | 'SUST_CON' | 'SUST_CHR'
  | 'IM_ACID' | 'IM_ELEC' | 'IM_FIRE' | 'IM_COLD'
  | 'RES_ACID' | 'RES_ELEC' | 'RES_FIRE' | 'RES_COLD' | 'RES_POIS' | 'RES_FEAR' | 'RES_LITE' | 'RES_DARK' | 'RES_BLIND' | 'RES_CONF' | 'RES_SOUND' | 'RES_SHARDS' | 'RES_NETHER' | 'RES_NEXUS' | 'RES_CHAOS' | 'RES_DISEN'
  // abilities
  | 'FREE_ACT' | 'HOLD_LIFE' | 'SEE_INVIS' | 'TELEPATHY' | 'SLOW_DIGEST' | 'REGEN' | 'FEATHER' | 'LITE' | 'BLESSED'
  // curses / quirks
  | 'CURSED' | 'HEAVY_CURSE' | 'PERMA_CURSE' | 'AGGRAVATE' | 'TELEPORT' | 'DRAIN_EXP' | 'DRAIN_HP' | 'DRAIN_MANA' | 'NO_TELEPORT'
  | 'IGNORE_ACID' | 'IGNORE_ELEC' | 'IGNORE_FIRE' | 'IGNORE_COLD' | 'NO_FUEL' | 'EASY_KNOW' | 'SHOW_MODS' | 'ACTIVATE' | 'THROWING';

/** Timed player effects (Angband's TMD_*). */
export type Timed = 'fast' | 'slow' | 'blind' | 'paralyzed' | 'confused' | 'afraid' | 'image' | 'poisoned' | 'cut' | 'stun' |
  'protevil' | 'invuln' | 'hero' | 'shero' | 'shield' | 'blessed' | 'sinvis' | 'sinfra' | 'oppose_acid' | 'oppose_elec' | 'oppose_fire' | 'oppose_cold' | 'oppose_pois' |
  'telepathy' | 'recall' | 'deep_descent' | 'stoneskin' | 'regen' | 'bold' | 'terror' | 'bloodlust' | 'oppose_conf';

export type DetectWhat = 'monsters' | 'invisible' | 'evil' | 'objects' | 'gold' | 'traps' | 'doors' | 'stairs' | 'all' | 'enchanted' | 'living';

/** What a consumable, a device, a spell or an activation does. Executed by effects.ts. */
export type Effect =
  | { kind: 'seq'; effects: Effect[] }
  | { kind: 'heal'; amount: number; percent?: number; cure?: Timed[] }
  | { kind: 'cure'; cure: Timed[] }
  | { kind: 'timed'; effect: Timed; base: number; dice?: [number, number]; clear?: boolean }
  | { kind: 'restore_stat'; stat: Stat | 'all' }
  | { kind: 'gain_stat'; stat: Stat | 'random' }
  | { kind: 'lose_stat'; stat: Stat }
  | { kind: 'restore_exp' }
  | { kind: 'gain_exp'; amount: number }
  | { kind: 'lose_exp'; amount: number }
  | { kind: 'nourish'; amount: number }
  | { kind: 'mana'; amount: number }
  | { kind: 'teleport'; range: number }
  | { kind: 'teleport_level' }
  | { kind: 'recall' }
  | { kind: 'deep_descent' }
  | { kind: 'detect'; what: DetectWhat[] }
  | { kind: 'map' }
  | { kind: 'light_room' }
  | { kind: 'darkness' }
  | { kind: 'light_line'; dice: [number, number] }
  | { kind: 'enchant'; what: 'tohit' | 'todam' | 'toac'; amount: number }
  | { kind: 'identify' }
  | { kind: 'remove_curse'; heavy?: boolean }
  | { kind: 'recharge'; power: number }
  | { kind: 'bolt'; element: Element; dice: [number, number]; base?: number; beam?: number }
  | { kind: 'ball'; element: Element; dam: number; radius: number; dice?: [number, number] }
  | { kind: 'breath'; element: Element; dam: number }
  | { kind: 'burst'; element: Element; dam: number; radius: number }  // centred on the player, hits every monster in radius
  | { kind: 'stone_to_mud' }
  | { kind: 'door_destruction' }
  | { kind: 'trap_destruction' }
  | { kind: 'sleep_monsters' } | { kind: 'slow_monsters' } | { kind: 'scare_monsters' } | { kind: 'confuse_monsters' }
  | { kind: 'sleep_monster' } | { kind: 'slow_monster' } | { kind: 'confuse_monster' } | { kind: 'scare_monster' }
  | { kind: 'haste_monster' } | { kind: 'heal_monster' } | { kind: 'clone_monster' } | { kind: 'polymorph' } | { kind: 'teleport_other' }
  | { kind: 'drain_life'; dam: number }
  | { kind: 'vampiric'; dam: number }      // drain life from one monster and heal the caster
  | { kind: 'crush'; mult: number }        // kill a monster whose hp is below player level * mult
  | { kind: 'dispel_curse' }
  | { kind: 'unbar' }                      // destroy doors in a beam
  | { kind: 'dispel'; what: 'evil' | 'undead' | 'all'; dam: number }
  | { kind: 'turn_undead' }
  | { kind: 'banish' }         // genocide one race
  | { kind: 'mass_banish' }
  | { kind: 'destruction' }
  | { kind: 'summon'; count: number; what?: 'any' | 'undead' | 'animal' }
  | { kind: 'aggravate' }
  | { kind: 'curse' }
  | { kind: 'create_food' } | { kind: 'create_traps' } | { kind: 'create_doors' } | { kind: 'create_stairs' }
  | { kind: 'satisfy_hunger' }
  | { kind: 'acquirement'; count: number }
  | { kind: 'glyph' }
  | { kind: 'brand_weapon'; brand: 'BRAND_FIRE' | 'BRAND_COLD' | 'BRAND_POIS' | 'BRAND_ELEC' | 'BRAND_ACID' }
  | { kind: 'brand_ammo'; brand: 'BRAND_FIRE' | 'BRAND_COLD' | 'BRAND_POIS' | 'BRAND_ELEC' }
  | { kind: 'wonder' }
  | { kind: 'poison_self'; dice: [number, number] }
  | { kind: 'damage_self'; dice: [number, number]; text: string }
  | { kind: 'sense_surroundings' }
  | { kind: 'probe' }
  | { kind: 'earthquake' }
  | { kind: 'nothing' };

export interface ObjectKind {
  id: string;
  name: string;
  tval: TVal;
  /** Hex colour used by the floor icon and inventory listing. */
  color: string;
  /** Native depth and rarity 1 (common) .. 8. Level 0 with rarity <= 2 shows in stores. */
  level: number;
  rarity: number;
  /** Base cost in gold; weight in tenth-pounds. */
  cost: number;
  weight: number;
  /** Damage dice for weapons and ammo; also thrown flasks. */
  dice?: [number, number];
  toHit?: number;
  toDam?: number;
  /** Base armour and a bonus for armour pieces. */
  ac?: number;
  toAc?: number;
  /** The kind's fixed pval: light radius, nutrition, stat bonus, bow multiplier ... */
  pval?: number;
  flags?: ObjectFlag[];
  /** Consumables and devices. */
  effect?: Effect;
  /** Wands and staffs: charges = base + dice. */
  charges?: [number, number];
  /** Rods: turns to recharge. */
  recharge?: number;
  /** Rings, amulets, potions, scrolls, wands, staffs and rods have an unknown flavour until identified. */
  flavored?: boolean;
  /** Books: the spells they hold. */
  spells?: string[];
  /** Bow multiplier for launchers (2 = sling, 3 = long bow, 4 = heavy crossbow). */
  multiplier?: number;
  /** Which ammo a launcher fires. */
  ammo?: 'shot' | 'arrow' | 'bolt';
  /** Stores usually stock several of these at once. */
  stackable?: boolean;
  desc?: string;
}

export interface EgoKind {
  id: string;
  /** The name to add: "of Slay Orc" (suffix) or "Holy Avenger" (still written as a suffix "(Holy Avenger)"). */
  name: string;
  tvals: TVal[];
  level: number;
  rarity: number;
  cost: number;
  /** Bonus ranges rolled on creation. */
  toHit?: [number, number];
  toDam?: [number, number];
  toAc?: [number, number];
  pval?: [number, number];
  flags?: ObjectFlag[];
  /** Chance to gain one extra random resist/ability. */
  randomFlags?: ObjectFlag[];
  cursed?: boolean;
}

export interface ArtifactKind {
  id: string;
  name: string;     // e.g. "'Sting'" or "of Galadriel"
  kind: string;     // base ObjectKind id
  level: number;
  rarity: number;
  cost: number;
  toHit?: number;
  toDam?: number;
  toAc?: number;
  pval?: number;
  dice?: [number, number];
  ac?: number;
  flags?: ObjectFlag[];
  activation?: Effect;
  activationTimeout?: number;
  desc?: string;
}

/** A pseudo-identification feeling on an unidentified wearable. */
export type Sense = 'average' | 'good' | 'excellent' | 'cursed' | 'terrible' | 'special';

export interface Item {
  id: number;
  kind: string;
  number: number;
  toHit: number;
  toDam: number;
  toAc: number;
  pval: number;
  ego?: string;
  artifact?: string;
  /** Fully identified: bonuses, ego and flags known. */
  known: boolean;
  sense?: Sense;
  /** Wands and staffs. */
  charges: number;
  /** Rods: turns until usable again; artifacts: activation cooldown. */
  timeout: number;
  cursed: boolean;
  /** Extra flags from an ego or artifact (kind flags come from the kind). */
  flags: ObjectFlag[];
  inscription?: string;
}

export interface FloorItem extends Pos { item: Item; }

// ---------------------------------------------------------------------------------------------
// Player

export type SlotName = 'weapon' | 'bow' | 'ring1' | 'ring2' | 'amulet' | 'light' | 'body' | 'cloak' | 'shield' | 'helm' | 'gloves' | 'boots';
export const SLOTS: SlotName[] = ['weapon', 'bow', 'ring1', 'ring2', 'amulet', 'light', 'body', 'cloak', 'shield', 'helm', 'gloves', 'boots'];
export const SLOT_LABEL: Record<SlotName, string> = {
  weapon: 'Wielding', bow: 'Shooting', ring1: 'On left hand', ring2: 'On right hand', amulet: 'Around neck', light: 'Light source',
  body: 'On body', cloak: 'About body', shield: 'On arm', helm: 'On head', gloves: 'On hands', boots: 'On feet',
};

export interface SkillSet {
  disarm: number;
  device: number;
  save: number;
  stealth: number;
  search: number;
  perception: number;
  melee: number;
  bows: number;
  throw: number;
  digging: number;
}

export interface RaceDef {
  id: string;
  name: string;
  stats: Record<Stat, number>;
  skills: SkillSet;
  hitDie: number;
  expPct: number;
  /** Infravision radius. */
  infra: number;
  flags: ObjectFlag[];
  desc: string;
  /** Rig scale for the hero sprite (1 = human). */
  size?: number;
  /** Short history fragments used to write the birth history. */
  history?: string[];
}

export type Realm = 'magic' | 'prayer' | 'nature' | 'necro';
export const REALM_BOOK: Record<Realm, TVal> = { magic: 'magic_book', prayer: 'prayer_book', nature: 'nature_book', necro: 'necro_book' };
export const REALM_WORD: Record<Realm, [spell: string, cast: string, book: string]> = { magic: ['spell', 'cast', 'magic book'], prayer: ['prayer', 'recite', 'prayer book'], nature: ['spell', 'call', 'nature book'], necro: ['ritual', 'perform', 'necromantic tome'] };

export interface ClassDef {
  id: string;
  name: string;
  /** The Gauntlet hero it is drawn as. */
  hero: string;
  stats: Record<Stat, number>;
  skills: SkillSet;
  /** Skill growth per 10 levels. */
  skillsGrowth: SkillSet;
  hitDie: number;
  expPct: number;
  maxAttacks: number;
  minWeight: number;
  attackMultiplier: number;
  realm: Realm | null;
  spellStat: 'INT' | 'WIS';
  /** Blackguards and rogues get their spells late and few. */
  maxSpellLevel?: number;
  firstSpellLevel: number;
  /** [kind id, count] granted at birth. */
  startItems: [string, number][];
  titles: string[];
  /** Rig palette for the hero. */
  palette: { skin: string; hair: string; primary: string; secondary: string; accent: string; metal: string; dark: string; glow: string };
  desc: string;
}

export interface SpellDef {
  id: string;
  name: string;
  realm: Realm;
  /** Book kind id. */
  book: string;
  level: number;
  mana: number;
  fail: number;
  /** First-cast experience. */
  exp: number;
  /** Per-class overrides of [level, mana, fail, exp] (Angband's magic_info tables); a level > 50 means the class never learns it. */
  classes?: Record<string, [number, number, number, number]>;
  effect: Effect;
  /** Needs a direction. */
  aimed?: boolean;
  desc: string;
}

export interface Player extends Pos {
  name: string;
  race: string;
  cls: string;
  sex: 'male' | 'female';
  /** Stats: base rolls, current (drained), and max (including equipment) on the 3..40 internal scale. */
  statBase: Record<Stat, number>;
  statCur: Record<Stat, number>;
  lev: number;
  exp: number;
  maxExp: number;
  mhp: number;
  chp: number;
  msp: number;
  csp: number;
  food: number;
  gold: number;
  depth: number;
  maxDepth: number;
  energy: number;
  timed: Record<Timed, number>;
  equip: Record<SlotName, Item | null>;
  inven: Item[];
  quiver: Item[];
  learned: string[];
  /** Spells cast at least once (worth exp the first time). */
  cast: string[];
  keys: number;
  searching: boolean;
  dead: boolean;
  deathCause: string;
  turns: number;
  kills: number;
  /** Word of recall target depth. */
  recallDepth: number;
  /** Birth history text. */
  history?: string;
  /** Render-only interpolation. */
  vx?: number;
  vy?: number;
  facing: 1 | -1;
}

/** Everything derived from the player's equipment and stats, recomputed by player.ts after any change. */
export interface PlayerBonuses {
  stat: Record<Stat, number>;
  ac: number;
  toAc: number;
  toHit: number;
  toDam: number;
  blows: number;
  shots: number;
  might: number;
  speed: number;
  skills: SkillSet;
  lightRadius: number;
  flags: Set<ObjectFlag>;
  weight: number;
  weightLimit: number;
  /** Encumbrance from the weapon being too heavy. */
  heavyWeapon: boolean;
  heavyBow: boolean;
  /** Infravision from gear and potions (the race's own is added by the caller). */
  infra: number;
}

// ---------------------------------------------------------------------------------------------
// Level and stores

export interface Room { x1: number; y1: number; x2: number; y2: number; lit: boolean; }

export interface Level {
  depth: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  flags: Uint8Array;
  /** Lock power for doors, trap kind for traps. */
  aux: Uint8Array;
  monsters: Monster[];
  items: FloorItem[];
  rooms: Room[];
  feeling: number;
  /** Danger and treasure rating accumulated during generation (vaults), for the level feeling. */
  rating: number;
  /** A vault or artifact made this level "special" (Angband's good_item_flag). */
  special: boolean;
  /** Persistent levels: the game turn the player last left this level. */
  leftAt?: number;
  /** The town only: was it generated in daylight? */
  daytime?: boolean;
  /** Which generator built it. Absent means the rooms-and-corridors one (saves made before caverns). */
  kind?: 'classic' | 'cavern' | 'labyrinth';
}

export type StoreType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const STORE_NAMES = ['General Store', 'Armoury', 'Weaponsmith', 'Temple', 'Alchemy Shop', 'Magic Shop', 'Black Market', 'Home'];

export interface Store {
  type: StoreType;
  owner: string;
  purse: number;
  greed: number;
  stock: Item[];
  lastVisit: number;
}

export interface Message { text: string; color: string; turn: number; count: number; }
