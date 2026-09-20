// Spell lists for the four realms. Mage and priest books follow Angband 3.0; the druid's nature books and
// the necromancer's tomes adapt Angband 4.2's lists to this game's effect vocabulary. `book` names the
// ObjectKind id holding the spell.
import type { SpellDef, Effect, Realm, Timed } from '../types.ts';

type S = [id: string, name: string, level: number, mana: number, fail: number, exp: number, effect: Effect, desc: string, aimed?: boolean];
type Row = [level: number, mana: number, fail: number, exp: number];
/** Per-class tables: [level, mana, fail, exp] for the classes that share the realm (Angband's magic_info). */
type ClassTable = Record<string, Row>;
/**
 * `tables` maps a spell id to its class rows; the special key '*' gives the default row for every spell in the
 * book that has no row of its own for that class, so a hybrid caster can be shut out of a whole book with one entry.
 */
function book(realm: Realm, bookId: string, list: S[], tables: Record<string, ClassTable> = {}): SpellDef[] {
  const star = tables['*'];
  return list.map(([id, name, level, mana, fail, exp, effect, desc, aimed]) => {
    const classes = star || tables[id] ? { ...star, ...tables[id] } : undefined;
    return { id, name, realm, book: bookId, level, mana, fail, exp, effect, desc, aimed: !!aimed, classes };
  });
}

const magic = (bookId: string, list: S[], tables?: Record<string, ClassTable>) => book('magic', bookId, list, tables);
const prayer = (bookId: string, list: S[], tables?: Record<string, ClassTable>) => book('prayer', bookId, list, tables);
const nature = (bookId: string, list: S[], tables?: Record<string, ClassTable>) => book('nature', bookId, list, tables);
const necro = (bookId: string, list: S[], tables?: Record<string, ClassTable>) => book('necro', bookId, list, tables);
const song = (bookId: string, list: S[], tables?: Record<string, ClassTable>) => book('song', bookId, list, tables);
/**
 * A song carries no effect of its own. Casting one is intercepted in commands.ts, which hands it
 * to startSong instead of the effect interpreter; what it then does for as long as it is held is
 * in data/songs.ts. This row exists to give the song a name, a book, a level and a price.
 */
const NOTHING: Effect = { kind: 'nothing' };

/** The class never learns this spell. */
const NONE: Row = [99, 0, 0, 0];
/** A hybrid caster's row: mana, fail and first-cast exp are derived from the level it learns the spell at, roughly as in 3.0's tables. */
const at = (level: number, costMult = 0.5): Row => [level, Math.max(1, Math.ceil(level * costMult)), Math.min(90, 40 + level), level];
/** Paladins pay more for their prayers. */
const pal = (level: number): Row => at(level, 0.6);
const timed = (effect: Timed, base: number, die = base): Effect => ({ kind: 'timed', effect, base, dice: [1, die] });

// Hybrid caster tables: rogues and rangers share the mage books, paladins the prayer books, blackguards the necromantic tomes.
const ROGUE_RANGER_NONE: ClassTable = { rogue: NONE, ranger: NONE };
const PALADIN_NONE: ClassTable = { paladin: NONE };
const BLACKGUARD_NONE: ClassTable = { blackguard: NONE };

export const SPELLS: SpellDef[] = [
  ...magic('magic_book_1', [
    ['magic_missile', 'Magic Missile', 1, 1, 22, 4, { kind: 'bolt', element: 'missile', dice: [3, 4], beam: 10 }, 'Fires a bolt of magic for 3d4 damage (more at higher levels).', true],
    ['detect_monsters', 'Detect Monsters', 1, 1, 23, 4, { kind: 'detect', what: ['monsters'] }, 'Reveals nearby monsters.'],
    ['phase_door', 'Phase Door', 1, 2, 24, 4, { kind: 'teleport', range: 10 }, 'A short random teleport.'],
    ['light_room', 'Light Room', 1, 2, 26, 4, { kind: 'light_room' }, 'Lights up the room you are in.'],
    ['treasure_location', 'Treasure Location', 3, 3, 27, 5, { kind: 'detect', what: ['gold'] }, 'Detects buried treasure and gold.'],
    ['cure_light_wounds', 'Cure Light Wounds', 3, 3, 28, 5, { kind: 'heal', amount: 20, cure: ['cut'] }, 'Heals 20 hit points and cuts.'],
    ['object_detection', 'Object Detection', 5, 4, 30, 6, { kind: 'detect', what: ['objects'] }, 'Detects nearby objects.'],
    ['find_traps_doors', 'Find Hidden Traps/Doors', 5, 5, 30, 6, { kind: 'detect', what: ['traps', 'doors', 'stairs'] }, 'Detects traps, doors and stairs.'],
    ['stinking_cloud', 'Stinking Cloud', 7, 6, 32, 8, { kind: 'ball', element: 'pois', dam: 12, radius: 2 }, 'A ball of poison gas.', true],
  ], {
    '*': ROGUE_RANGER_NONE,
    magic_missile: { ranger: at(3) },
    detect_monsters: { rogue: at(5), ranger: at(5) },
    phase_door: { rogue: at(7), ranger: at(7) },
    light_room: { rogue: at(9), ranger: at(9) },
    treasure_location: { rogue: at(10), ranger: at(10) },
    cure_light_wounds: { rogue: at(11), ranger: at(11) },
    object_detection: { rogue: at(8), ranger: at(13) },
    find_traps_doors: { rogue: at(12), ranger: at(15) },
    stinking_cloud: { rogue: at(13), ranger: at(17) },
  }),
  ...magic('magic_book_2', [
    ['confuse_monster', 'Confuse Monster', 9, 7, 34, 8, { kind: 'confuse_monster' }, 'Confuses one monster.', true],
    ['lightning_bolt', 'Lightning Bolt', 11, 7, 36, 10, { kind: 'bolt', element: 'elec', dice: [4, 8], beam: 40 }, 'A beam of lightning.', true],
    ['trap_door_destruction', 'Trap/Door Destruction', 13, 7, 38, 12, { kind: 'trap_destruction' }, 'Destroys adjacent traps and doors.'],
    ['sleep_i', 'Sleep I', 15, 8, 40, 14, { kind: 'sleep_monster' }, 'Puts one monster to sleep.', true],
    ['cure_poison', 'Cure Poison', 15, 8, 40, 14, { kind: 'cure', cure: ['poisoned'] }, 'Cures poison.'],
    ['teleport_self', 'Teleport Self', 17, 10, 42, 16, { kind: 'teleport', range: 100 }, 'A long random teleport.'],
    ['spear_of_light', 'Spear of Light', 19, 11, 44, 18, { kind: 'light_line', dice: [6, 8] }, 'A beam of light that hurts light-sensitive monsters.', true],
    ['frost_bolt', 'Frost Bolt', 21, 12, 46, 20, { kind: 'bolt', element: 'cold', dice: [6, 8] }, 'A bolt of frost.', true],
    ['stone_to_mud', 'Turn Stone to Mud', 23, 12, 48, 22, { kind: 'stone_to_mud' }, 'Melts a wall.', true],
  ], {
    '*': ROGUE_RANGER_NONE,
    confuse_monster: { rogue: at(15), ranger: at(19) },
    lightning_bolt: { ranger: at(21) },
    trap_door_destruction: { rogue: at(17), ranger: at(23) },
    sleep_i: { rogue: at(19), ranger: at(25) },
    cure_poison: { rogue: at(21), ranger: at(27) },
    teleport_self: { rogue: at(23), ranger: at(29) },
    spear_of_light: { ranger: at(31) },
    frost_bolt: { ranger: at(33) },
    stone_to_mud: { rogue: at(25), ranger: at(35) },
  }),
  ...magic('magic_book_3', [
    ['satisfy_hunger', 'Satisfy Hunger', 25, 13, 50, 25, { kind: 'satisfy_hunger' }, 'Fills your stomach.'],
    ['recharge_i', 'Recharge Item I', 25, 14, 50, 25, { kind: 'recharge', power: 5 }, 'Recharges a wand or staff.'],
    ['sleep_ii', 'Sleep II', 27, 14, 52, 28, { kind: 'sleep_monsters' }, 'Sleeps adjacent monsters.'],
    ['polymorph_other', 'Polymorph Other', 29, 15, 54, 30, { kind: 'polymorph' }, 'Changes a monster into another.', true],
    ['identify', 'Identify', 31, 16, 56, 32, { kind: 'identify' }, 'Identifies an object.'],
    ['sleep_iii', 'Sleep III', 33, 17, 58, 34, { kind: 'sleep_monsters' }, 'Sleeps all monsters in sight.'],
    ['fire_bolt', 'Fire Bolt', 35, 18, 60, 36, { kind: 'bolt', element: 'fire', dice: [9, 8] }, 'A bolt of fire.', true],
    ['slow_monster', 'Slow Monster', 37, 19, 62, 38, { kind: 'slow_monster' }, 'Slows one monster.', true],
  ], {
    '*': ROGUE_RANGER_NONE,
    satisfy_hunger: { rogue: at(27), ranger: at(37) },
    recharge_i: { rogue: at(29), ranger: at(39) },
    sleep_ii: { rogue: at(31), ranger: at(41) },
    polymorph_other: { ranger: at(43) },
    identify: { rogue: at(33), ranger: at(45) },
    sleep_iii: { ranger: at(47) },
    fire_bolt: { ranger: at(49) },
    slow_monster: { ranger: at(50) },
  }),
  ...magic('magic_book_4', [
    ['frost_ball', 'Frost Ball', 39, 20, 64, 40, { kind: 'ball', element: 'cold', dam: 70, radius: 2 }, 'A ball of frost.', true],
    ['recharge_ii', 'Recharge Item II', 41, 21, 66, 42, { kind: 'recharge', power: 40 }, 'A stronger recharge.'],
    ['teleport_other', 'Teleport Other', 43, 22, 68, 44, { kind: 'teleport_other' }, 'Teleports a monster away.', true],
    ['haste_self', 'Haste Self', 45, 23, 70, 46, { kind: 'timed', effect: 'fast', base: 20, dice: [1, 20] }, 'Temporarily speeds you up.'],
    ['fire_ball', 'Fire Ball', 47, 24, 72, 48, { kind: 'ball', element: 'fire', dam: 100, radius: 2 }, 'A ball of fire.', true],
    ['word_of_destruction', 'Word of Destruction', 49, 25, 74, 50, { kind: 'destruction' }, 'Destroys the area around you.'],
    ['banishment', 'Banishment', 50, 50, 80, 60, { kind: 'banish' }, 'Removes every monster of one kind from the level.'],
  ], {
    '*': ROGUE_RANGER_NONE,
    teleport_other: { rogue: at(43) },
  }),
  ...magic('magic_book_5', [
    ['resist_fire', 'Resist Fire', 15, 5, 50, 20, { kind: 'timed', effect: 'oppose_fire', base: 20, dice: [1, 20] }, 'Temporary fire resistance.'],
    ['resist_cold', 'Resist Cold', 15, 5, 50, 20, { kind: 'timed', effect: 'oppose_cold', base: 20, dice: [1, 20] }, 'Temporary cold resistance.'],
    ['resist_acid', 'Resist Acid', 15, 5, 50, 20, { kind: 'timed', effect: 'oppose_acid', base: 20, dice: [1, 20] }, 'Temporary acid resistance.'],
    ['resist_poison', 'Resist Poison', 20, 5, 50, 20, { kind: 'timed', effect: 'oppose_pois', base: 20, dice: [1, 20] }, 'Temporary poison resistance.'],
    ['resistance', 'Resistance', 25, 20, 60, 30, { kind: 'seq', effects: [{ kind: 'timed', effect: 'oppose_fire', base: 20, dice: [1, 20] }, { kind: 'timed', effect: 'oppose_cold', base: 20, dice: [1, 20] }, { kind: 'timed', effect: 'oppose_acid', base: 20, dice: [1, 20] }, { kind: 'timed', effect: 'oppose_elec', base: 20, dice: [1, 20] }, { kind: 'timed', effect: 'oppose_pois', base: 20, dice: [1, 20] }] }, 'Resistance to all five elements.'],
  ], {
    '*': ROGUE_RANGER_NONE,
    resist_fire: { ranger: at(20) },
    resist_cold: { ranger: at(22) },
    resist_acid: { ranger: at(24) },
    resist_poison: { ranger: at(26) },
    resistance: { ranger: at(35) },
  }),
  ...magic('magic_book_6', [
    ['door_creation', 'Door Creation', 10, 7, 50, 20, { kind: 'create_doors' }, 'Surrounds you with doors.'],
    ['stair_creation', 'Stair Creation', 25, 12, 60, 30, { kind: 'create_stairs' }, 'Creates a staircase under you.'],
    ['teleport_level', 'Teleport Level', 25, 15, 60, 30, { kind: 'teleport_level' }, 'Moves you up or down a level.'],
    ['earthquake', 'Earthquake', 30, 25, 70, 40, { kind: 'earthquake' }, 'Shakes the dungeon around you.'],
    ['word_of_recall', 'Word of Recall', 30, 35, 70, 40, { kind: 'recall' }, 'Returns you to town, or to your deepest level.'],
  ], {
    '*': ROGUE_RANGER_NONE,
    teleport_level: { rogue: at(39) },
  }),
  ...magic('magic_book_7', [
    ['acid_bolt', 'Acid Bolt', 20, 15, 60, 40, { kind: 'bolt', element: 'acid', dice: [8, 8] }, 'A bolt of acid.', true],
    ['cloud_kill', 'Cloud Kill', 30, 20, 70, 50, { kind: 'ball', element: 'pois', dam: 50, radius: 3 }, 'A big cloud of poison.', true],
    ['acid_ball', 'Acid Ball', 35, 25, 75, 60, { kind: 'ball', element: 'acid', dam: 100, radius: 2 }, 'A ball of acid.', true],
    ['ice_storm', 'Ice Storm', 40, 30, 80, 70, { kind: 'ball', element: 'cold', dam: 150, radius: 3 }, 'A storm of ice.', true],
    ['meteor_swarm', 'Meteor Swarm', 45, 40, 85, 80, { kind: 'ball', element: 'missile', dam: 200, radius: 3 }, 'A rain of meteors.', true],
    ['mana_storm', 'Mana Storm', 50, 50, 90, 100, { kind: 'ball', element: 'mana', dam: 300, radius: 3 }, 'Pure destruction.', true],
  ], { '*': ROGUE_RANGER_NONE }),
  ...magic('magic_book_8', [
    ['heroism', 'Heroism', 15, 12, 50, 20, timed('hero', 25), 'Makes you heroic: fearless, with a better to-hit and a few extra hit points.'],
    ['berserker', 'Berserker', 20, 16, 55, 25, timed('shero', 25), 'A berserk rage: fearless, a much better to-hit, but weaker armour.'],
    ['enchant_armour', 'Enchant Armour', 25, 50, 60, 40, { kind: 'enchant', what: 'toac', amount: 1 }, 'Raises the armour bonus of one piece of armour.'],
    ['enchant_weapon', 'Enchant Weapon', 30, 50, 60, 50, { kind: 'seq', effects: [{ kind: 'enchant', what: 'tohit', amount: 1 }, { kind: 'enchant', what: 'todam', amount: 1 }] }, 'Raises the to-hit and to-dam bonuses of one weapon.'],
    ['elemental_brand', 'Elemental Brand', 40, 70, 70, 60, { kind: 'brand_weapon', brand: 'BRAND_FIRE' }, 'Brands your wielded weapon with fire (fails on egos and artifacts).'],
    ['globe_of_invulnerability', 'Globe of Invulnerability', 45, 100, 80, 100, timed('invuln', 8), 'A short spell of complete invulnerability.'],
  ], { '*': ROGUE_RANGER_NONE }),
  ...magic('magic_book_9', [
    ['detect_evil_m', 'Detect Evil', 20, 12, 55, 30, { kind: 'detect', what: ['evil'] }, 'Reveals evil monsters.'],
    ['detect_enchantment', 'Detect Enchantment', 25, 15, 60, 40, { kind: 'detect', what: ['enchanted'] }, 'Detects nearby enchanted objects.'],
    ['recharge_iii', 'Recharge Item III', 35, 30, 70, 60, { kind: 'recharge', power: 100 }, 'The strongest recharge.'],
    ['mass_banishment', 'Mass Banishment', 45, 60, 85, 100, { kind: 'mass_banish' }, 'Removes every non-unique monster near you; the strain costs a few hit points each.'],
  ], {
    '*': ROGUE_RANGER_NONE,
    detect_evil_m: { rogue: at(35) },
    detect_enchantment: { rogue: at(37) },
  }),
  ...prayer('prayer_book_1', [
    ['detect_evil', 'Detect Evil', 1, 1, 10, 4, { kind: 'detect', what: ['evil'] }, 'Reveals evil monsters.'],
    ['cure_light_wounds_p', 'Cure Light Wounds', 1, 2, 15, 4, { kind: 'heal', amount: 20, cure: ['cut'] }, 'Heals 20 hit points and cuts.'],
    ['bless', 'Bless', 1, 2, 20, 4, { kind: 'timed', effect: 'blessed', base: 12, dice: [1, 12] }, 'A short blessing: +AC, +to-hit.'],
    ['remove_fear', 'Remove Fear', 1, 2, 25, 4, { kind: 'cure', cure: ['afraid'] }, 'Cures fear.'],
    ['call_light', 'Call Light', 3, 2, 25, 4, { kind: 'light_room' }, 'Lights the room.'],
    ['find_traps', 'Find Traps', 5, 3, 27, 5, { kind: 'detect', what: ['traps'] }, 'Detects traps.'],
    ['detect_doors_stairs', 'Detect Doors/Stairs', 5, 3, 27, 5, { kind: 'detect', what: ['doors', 'stairs'] }, 'Detects doors and stairs.'],
    ['slow_poison', 'Slow Poison', 7, 3, 28, 5, { kind: 'cure', cure: ['poisoned'] }, 'Cures poison.'],
  ], {
    '*': PALADIN_NONE,
    detect_evil: { paladin: pal(1) },
    cure_light_wounds_p: { paladin: pal(3) },
    bless: { paladin: pal(5) },
    remove_fear: { paladin: pal(7) },
    call_light: { paladin: pal(9) },
    find_traps: { paladin: pal(11) },
    detect_doors_stairs: { paladin: pal(13) },
    slow_poison: { paladin: pal(15) },
  }),
  ...prayer('prayer_book_2', [
    ['scare_monster', 'Scare Monster', 9, 4, 29, 6, { kind: 'scare_monster' }, 'Frightens one monster.', true],
    ['portal', 'Portal', 9, 5, 30, 6, { kind: 'teleport', range: 30 }, 'A medium-range teleport.'],
    ['cure_serious_wounds_p', 'Cure Serious Wounds', 11, 5, 32, 7, { kind: 'heal', amount: 40, cure: ['cut', 'blind', 'confused'] }, 'Heals 40 hit points, cuts, blindness and confusion.'],
    ['chant', 'Chant', 11, 5, 32, 7, { kind: 'timed', effect: 'blessed', base: 24, dice: [1, 24] }, 'A longer blessing.'],
    ['sanctuary', 'Sanctuary', 13, 5, 33, 8, { kind: 'sleep_monsters' }, 'Sleeps adjacent monsters.'],
    ['satisfy_hunger_p', 'Satisfy Hunger', 13, 6, 34, 8, { kind: 'satisfy_hunger' }, 'Fills your stomach.'],
    ['remove_curse', 'Remove Curse', 15, 6, 35, 8, { kind: 'remove_curse' }, 'Removes light curses from your equipment.'],
    ['resist_heat_cold', 'Resist Heat and Cold', 15, 7, 36, 9, { kind: 'seq', effects: [{ kind: 'timed', effect: 'oppose_fire', base: 10, dice: [1, 10] }, { kind: 'timed', effect: 'oppose_cold', base: 10, dice: [1, 10] }] }, 'Resist fire and cold.'],
  ], {
    '*': PALADIN_NONE,
    scare_monster: { paladin: pal(17) },
    portal: { paladin: pal(19) },
    cure_serious_wounds_p: { paladin: pal(21) },
    chant: { paladin: pal(23) },
    sanctuary: { paladin: pal(25) },
    satisfy_hunger_p: { paladin: pal(27) },
    remove_curse: { paladin: pal(29) },
    resist_heat_cold: { paladin: pal(31) },
  }),
  ...prayer('prayer_book_3', [
    ['neutralize_poison', 'Neutralize Poison', 17, 7, 37, 10, { kind: 'cure', cure: ['poisoned'] }, 'Cures poison.'],
    ['orb_of_draining', 'Orb of Draining', 19, 7, 38, 10, { kind: 'ball', element: 'holy', dam: 30, radius: 2 }, 'A holy orb that scorches evil.', true],
    ['cure_critical_wounds_p', 'Cure Critical Wounds', 21, 8, 40, 12, { kind: 'heal', amount: 60, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun'] }, 'Heals 60 hit points and most ailments.'],
    ['sense_invisible', 'Sense Invisible', 23, 8, 40, 14, { kind: 'timed', effect: 'sinvis', base: 24, dice: [1, 24] }, 'See invisible for a while.'],
    ['protection_from_evil', 'Protection from Evil', 25, 9, 42, 16, { kind: 'timed', effect: 'protevil', base: 25, dice: [1, 25] }, 'Evil monsters may be repelled from you.'],
    ['earthquake_p', 'Earthquake', 27, 10, 45, 20, { kind: 'earthquake' }, 'Shakes the dungeon around you.'],
    ['sense_surroundings', 'Sense Surroundings', 29, 10, 46, 22, { kind: 'sense_surroundings' }, 'Maps the local area.'],
    ['cure_mortal_wounds', 'Cure Mortal Wounds', 31, 12, 48, 24, { kind: 'heal', amount: 120, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun'] }, 'Heals 120 hit points.'],
    ['turn_undead', 'Turn Undead', 33, 12, 48, 26, { kind: 'turn_undead' }, 'Frightens the undead.'],
  ], {
    '*': PALADIN_NONE,
    neutralize_poison: { paladin: pal(33) },
    orb_of_draining: { paladin: pal(35) },
    cure_critical_wounds_p: { paladin: pal(37) },
    sense_invisible: { paladin: pal(39) },
    protection_from_evil: { paladin: pal(41) },
    earthquake_p: { paladin: pal(43) },
    sense_surroundings: { paladin: pal(45) },
    cure_mortal_wounds: { paladin: pal(47) },
    turn_undead: { paladin: pal(49) },
  }),
  ...prayer('prayer_book_4', [
    ['prayer', 'Prayer', 35, 14, 50, 30, { kind: 'timed', effect: 'blessed', base: 48, dice: [1, 48] }, 'A long blessing.'],
    ['dispel_undead', 'Dispel Undead', 37, 15, 52, 34, { kind: 'dispel', what: 'undead', dam: 60 }, 'Damages all undead in sight.'],
    ['heal', 'Heal', 39, 16, 55, 38, { kind: 'heal', amount: 300, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun'] }, 'Heals 300 hit points.'],
    ['dispel_evil', 'Dispel Evil', 41, 20, 58, 42, { kind: 'dispel', what: 'evil', dam: 90 }, 'Damages all evil monsters in sight.'],
    ['glyph_of_warding', 'Glyph of Warding', 43, 24, 60, 46, { kind: 'glyph' }, 'Wards the ground beneath you.'],
    ['holy_word', 'Holy Word', 45, 30, 65, 50, { kind: 'seq', effects: [{ kind: 'dispel', what: 'evil', dam: 150 }, { kind: 'heal', amount: 1000, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun', 'afraid'] }] }, 'Dispels evil and heals you completely.'],
  ], {
    '*': PALADIN_NONE,
    prayer: { paladin: pal(50) },
  }),
  ...prayer('prayer_book_5', [
    ['blink', 'Blink', 3, 3, 30, 10, { kind: 'teleport', range: 10 }, 'A short teleport.'],
    ['teleport_self_p', 'Teleport Self', 10, 10, 40, 20, { kind: 'teleport', range: 100 }, 'A long teleport.'],
    ['teleport_other_p', 'Teleport Other', 20, 20, 50, 30, { kind: 'teleport_other' }, 'Teleports a monster away.', true],
    ['teleport_level_p', 'Teleport Level', 30, 40, 60, 40, { kind: 'teleport_level' }, 'Moves you up or down a level.'],
    ['word_of_recall_p', 'Word of Recall', 35, 50, 70, 50, { kind: 'recall' }, 'Returns you to town, or to your deepest level.'],
  ], {
    '*': PALADIN_NONE,
    blink: { paladin: pal(30) },
    teleport_self_p: { paladin: pal(40) },
  }),
  ...prayer('prayer_book_6', [
    ['cure_serious_wounds_2', 'Cure Serious Wounds', 15, 5, 50, 20, { kind: 'heal', amount: 40, cure: ['cut', 'blind', 'confused'] }, 'Heals 40 hit points.'],
    ['cure_mortal_wounds_2', 'Cure Mortal Wounds', 25, 15, 60, 30, { kind: 'heal', amount: 120, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun'] }, 'Heals 120 hit points.'],
    ['healing', 'Healing', 35, 60, 70, 40, { kind: 'heal', amount: 2000, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun'] }, 'Heals you completely.'],
    ['restoration', 'Restoration', 45, 80, 80, 50, { kind: 'restore_stat', stat: 'all' }, 'Restores all drained stats.'],
    ['remembrance', 'Remembrance', 49, 100, 80, 60, { kind: 'restore_exp' }, 'Restores drained experience.'],
  ], { '*': PALADIN_NONE }),
  ...prayer('prayer_book_7', [
    ['dispel_undead_2', 'Dispel Undead', 25, 20, 60, 40, { kind: 'dispel', what: 'undead', dam: 120 }, 'Damages all undead in sight.'],
    ['dispel_evil_2', 'Dispel Evil', 30, 30, 65, 50, { kind: 'dispel', what: 'evil', dam: 150 }, 'Damages all evil in sight.'],
    ['banishment_p', 'Banishment', 35, 40, 70, 60, { kind: 'banish' }, 'Removes every monster of one kind from the level.'],
    ['word_of_destruction_p', 'Word of Destruction', 40, 50, 75, 70, { kind: 'destruction' }, 'Destroys the area around you.'],
    ['annihilation', 'Annihilation', 45, 60, 80, 80, { kind: 'drain_life', dam: 200 }, 'Drains the life from one monster.', true],
  ], { '*': PALADIN_NONE }),
  ...prayer('prayer_book_8', [
    ['detect_monsters_p', 'Detect Monsters', 5, 5, 50, 20, { kind: 'detect', what: ['monsters'] }, 'Reveals nearby monsters.'],
    ['detection', 'Detection', 15, 15, 60, 40, { kind: 'detect', what: ['all'] }, 'Detects everything nearby: monsters, objects, gold, traps, doors and stairs.'],
    ['perception', 'Perception', 25, 25, 70, 60, { kind: 'identify' }, 'Identifies an object.'],
    ['probing', 'Probing', 35, 35, 80, 80, { kind: 'probe' }, 'Reveals the hit points, armour, speed and immunities of every monster in sight.'],
    ['clairvoyance', 'Clairvoyance', 45, 50, 85, 100, { kind: 'map' }, 'Maps the entire level.'],
  ], { '*': PALADIN_NONE }),
  ...prayer('prayer_book_9', [
    ['unbarring_ways', 'Unbarring Ways', 5, 5, 50, 20, { kind: 'unbar' }, 'A beam that destroys every door in its path.', true],
    ['recharging', 'Recharging', 15, 15, 60, 40, { kind: 'recharge', power: 15 }, 'Recharges a wand or staff.'],
    ['dispel_curse', 'Dispel Curse', 25, 25, 70, 60, { kind: 'dispel_curse' }, 'Removes even heavy curses from your equipment.'],
    ['enchant_weapon_p', 'Enchant Weapon', 35, 35, 80, 80, { kind: 'seq', effects: [{ kind: 'enchant', what: 'tohit', amount: 1 }, { kind: 'enchant', what: 'todam', amount: 1 }] }, 'Raises the to-hit and to-dam bonuses of one weapon.'],
    ['enchant_armour_p', 'Enchant Armour', 37, 37, 80, 80, { kind: 'enchant', what: 'toac', amount: 1 }, 'Raises the armour bonus of one piece of armour.'],
    ['elemental_brand_p', 'Elemental Brand', 45, 45, 85, 100, { kind: 'brand_weapon', brand: 'BRAND_ELEC' }, 'Brands your wielded weapon with lightning (fails on egos and artifacts).'],
  ], { '*': PALADIN_NONE }),

  // -------------------------------------------------------------------------------------------
  // Nature magic (druids), after Angband 4.2.
  ...nature('nature_book_1', [
    ['remove_hunger', 'Remove Hunger', 1, 1, 22, 4, { kind: 'satisfy_hunger' }, 'Fills your stomach.'],
    ['stinging_swarm', 'Stinging Swarm', 1, 1, 23, 4, { kind: 'bolt', element: 'pois', dice: [3, 4] }, 'A swarm of stinging insects: a bolt of poison for 3d4 damage.', true],
    ['lightning_strike', 'Lightning Strike', 3, 2, 25, 5, { kind: 'ball', element: 'elec', dam: 4, radius: 1, dice: [3, 6] }, 'A small burst of lightning for 3d6+4 damage.', true],
    ['detect_life', 'Detect Life', 3, 2, 24, 5, { kind: 'detect', what: ['living'] }, 'Reveals nearby living creatures (not the undead or constructs).'],
    ['earth_to_dust', 'Earth to Dust', 5, 3, 27, 6, { kind: 'stone_to_mud' }, 'Crumbles a wall to dust and hurts creatures made of rock.', true],
    ['frost_breath', 'Frost Breath', 7, 5, 30, 8, { kind: 'breath', element: 'cold', dam: 20 }, 'You breathe a cone of frost for 20 damage.', true],
  ]),
  ...nature('nature_book_2', [
    ['cure_poison_n', 'Cure Poison', 9, 4, 30, 8, { kind: 'cure', cure: ['poisoned'] }, 'Cures poison.'],
    ['stormwalk', 'Stormwalk', 9, 4, 32, 8, { kind: 'seq', effects: [{ kind: 'burst', element: 'elec', dam: 12, radius: 1 }, { kind: 'teleport', range: 10 }] }, 'Shocks everything next to you, then carries you a short way on the wind.'],
    ['rapid_regeneration', 'Rapid Regeneration', 11, 6, 34, 10, timed('regen', 20), 'Your wounds heal much faster for a while.'],
    ['herbal_curing', 'Herbal Curing', 13, 7, 36, 12, { kind: 'heal', amount: 30, cure: ['poisoned', 'cut', 'stun'] }, 'Heals 30 hit points and cures poison, cuts and stunning.'],
    ['rising_flame', 'Rising Flame', 15, 8, 38, 14, { kind: 'bolt', element: 'fire', dice: [5, 8] }, 'A bolt of fire for 5d8 damage.', true],
    ['sense_surroundings_n', 'Sense Surroundings', 17, 9, 40, 16, { kind: 'sense_surroundings' }, 'Maps the local area.'],
    ['thunderclap', 'Thunderclap', 19, 10, 42, 18, { kind: 'burst', element: 'sound', dam: 30, radius: 2 }, 'A deafening clap of thunder that hurts and stuns everything around you.'],
  ]),
  ...nature('nature_book_3', [
    ['trance', 'Trance', 23, 10, 45, 20, timed('shield', 20), 'A calm trance that hardens your skin like a shield (+50 AC).'],
    ['stone_skin', 'Stone Skin', 25, 12, 48, 24, timed('stoneskin', 20), 'Turns your skin to stone: +40 AC, but -5 speed.'],
    ['meteor_swarm_n', 'Meteor Swarm', 27, 16, 50, 30, { kind: 'ball', element: 'missile', dam: 50, radius: 2, dice: [6, 10] }, 'Calls down a swarm of meteors for 6d10+50 damage.', true],
    ['elemental_ward', 'Elemental Ward', 29, 15, 52, 32, { kind: 'seq', effects: [timed('oppose_fire', 15), timed('oppose_cold', 15), timed('oppose_elec', 15), timed('oppose_acid', 15)] }, 'Resistance to fire, cold, lightning and acid.'],
    ['cure_ailments', 'Cure Ailments', 31, 14, 54, 34, { kind: 'heal', amount: 60, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun', 'image', 'afraid'] }, 'Heals 60 hit points and cures every common ailment.'],
    ['wild_sight', 'Wild Sight', 31, 16, 56, 36, timed('telepathy', 20), 'Lets you feel the minds of nearby creatures for a while.'],
  ]),
  ...nature('nature_book_4', [
    ['river_of_lightning', 'River of Lightning', 33, 20, 55, 40, { kind: 'bolt', element: 'elec', dice: [12, 8], beam: 100 }, 'A beam of lightning for 12d8 damage that hits everything in its path.', true],
    ['tremor', 'Tremor', 33, 15, 55, 40, { kind: 'earthquake' }, 'Shakes the dungeon around you.'],
    ['ice_storm_n', 'Ice Storm', 35, 22, 58, 44, { kind: 'ball', element: 'cold', dam: 100, radius: 3 }, 'A wide storm of ice for 100 damage.', true],
    ['revitalize', 'Revitalize', 37, 25, 60, 50, { kind: 'heal', amount: 150, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun', 'image'] }, 'Heals 150 hit points and most ailments.'],
    ['ride_the_wind', 'Ride the Wind', 39, 20, 60, 50, { kind: 'teleport', range: 100 }, 'The wind carries you far across the level.'],
    ['volcanic_eruption', 'Volcanic Eruption', 41, 35, 65, 60, { kind: 'seq', effects: [{ kind: 'burst', element: 'fire', dam: 100, radius: 3 }, { kind: 'earthquake' }] }, 'Fire bursts from the ground around you and the dungeon shakes.'],
  ]),
  ...nature('nature_book_5', [
    ['entangle', 'Entangle', 45, 30, 70, 70, { kind: 'slow_monsters' }, 'Roots and vines slow every monster in sight.'],
    ['natures_wrath', "Nature's Wrath", 45, 40, 70, 80, { kind: 'seq', effects: [{ kind: 'dispel', what: 'all', dam: 150 }, { kind: 'earthquake' }] }, 'Every monster in sight takes up to 150 damage and the dungeon shakes.'],
    ['tempest', 'Tempest', 47, 40, 75, 80, { kind: 'burst', element: 'elec', dam: 120, radius: 3 }, 'A storm of lightning strikes everything around you for 120 damage.'],
    ['wildfire', 'Wildfire', 47, 45, 75, 90, { kind: 'ball', element: 'fire', dam: 200, radius: 3 }, 'A raging ball of fire for 200 damage.', true],
    ['blizzard', 'Blizzard', 49, 50, 80, 100, { kind: 'breath', element: 'cold', dam: 250 }, 'You breathe a blizzard for 250 damage.', true],
  ]),

  // -------------------------------------------------------------------------------------------
  // Necromantic rituals (necromancers, and a few for blackguards), after Angband 4.2.
  ...necro('necro_book_1', [
    ['nether_bolt', 'Nether Bolt', 1, 1, 22, 4, { kind: 'bolt', element: 'nether', dice: [3, 4] }, 'A bolt of nether for 3d4 damage (more at higher levels); the undead are immune and evil resists.', true],
    ['sense_invisible_n', 'Sense Invisible', 1, 1, 23, 4, timed('sinvis', 24), 'See invisible for a while.'],
    ['shadow_shift', 'Shadow Shift', 3, 2, 25, 5, { kind: 'teleport', range: 10 }, 'A short step through the shadows.'],
    ['create_darkness', 'Create Darkness', 3, 2, 25, 5, { kind: 'darkness' }, 'Darkens the room; the sudden dark blinds you briefly unless you resist blindness or darkness.'],
    ['read_minds', 'Read Minds', 5, 3, 27, 6, { kind: 'detect', what: ['monsters'] }, 'Reveals nearby monsters.'],
    ['seek_battle', 'Seek Battle', 5, 4, 28, 6, { kind: 'seq', effects: [{ kind: 'detect', what: ['monsters'] }, timed('bloodlust', 10)] }, 'Reveals nearby monsters and fills you with a short bloodlust (+to-hit, +to-dam).'],
    ['horrify', 'Horrify', 7, 4, 30, 8, { kind: 'scare_monster' }, 'Frightens one monster.', true],
    ['berserk_strength', 'Berserk Strength', 7, 5, 30, 8, { kind: 'seq', effects: [{ kind: 'heal', amount: 30 }, timed('shero', 25)] }, 'Heals 30 hit points and sends you into a berserk rage.'],
  ], {
    '*': BLACKGUARD_NONE,
    seek_battle: { blackguard: at(5) },
    berserk_strength: { blackguard: at(7) },
  }),
  ...necro('necro_book_2', [
    ['vampire_strike', 'Vampire Strike', 11, 7, 36, 10, { kind: 'vampiric', dam: 50 }, 'Drains up to 50 hit points from a living monster and heals you by as much.', true],
    ['bloodlust', 'Bloodlust', 12, 6, 36, 12, timed('bloodlust', 20), 'A lust for blood: better to-hit and to-dam for a while.'],
    ['crush', 'Crush', 13, 8, 38, 12, { kind: 'crush', mult: 3 }, 'Crushes the life from a monster whose hit points are below three times your level.', true],
    ['frighten', 'Frighten', 15, 8, 40, 14, { kind: 'scare_monsters' }, 'Frightens every monster in sight.'],
    ['grim_purpose', 'Grim Purpose', 15, 8, 40, 14, { kind: 'seq', effects: [timed('bold', 25), timed('oppose_conf', 25)] }, 'Steels your mind against fear and confusion for a while.'],
    ['dark_spear', 'Dark Spear', 17, 10, 42, 16, { kind: 'bolt', element: 'dark', dice: [6, 8], beam: 100 }, 'A beam of darkness for 6d8 damage; the undead and demons resist.', true],
  ], {
    '*': BLACKGUARD_NONE,
    bloodlust: { blackguard: at(12) },
    grim_purpose: { blackguard: at(15) },
  }),
  ...necro('necro_book_3', [
    ['maim_foe', 'Maim Foe', 19, 10, 44, 18, { kind: 'bolt', element: 'missile', dice: [8, 8] }, 'A crippling bolt of raw force for 8d8 damage.', true],
    ['shadow_walk', 'Shadow Walk', 21, 12, 46, 20, { kind: 'teleport', range: 100 }, 'A long walk through the shadows.'],
    ['shatter_stone', 'Shatter Stone', 23, 12, 48, 22, { kind: 'stone_to_mud' }, 'Shatters a wall.', true],
    ['unleash_chaos', 'Unleash Chaos', 25, 15, 50, 25, { kind: 'ball', element: 'chaos', dam: 60, radius: 2 }, 'A ball of chaos for 60 damage that confuses what it hits.', true],
    ['venom', 'Venom', 27, 14, 52, 28, { kind: 'brand_weapon', brand: 'BRAND_POIS' }, 'Brands your wielded weapon with venom (fails on egos and artifacts).'],
    ['unholy_reprieve', 'Unholy Reprieve', 29, 16, 54, 30, { kind: 'heal', amount: 100, cure: ['cut', 'stun', 'poisoned'] }, 'Heals 100 hit points and cures cuts, stunning and poison.'],
  ], {
    '*': BLACKGUARD_NONE,
    maim_foe: { blackguard: at(20) },
    shatter_stone: { blackguard: at(25) },
    venom: { blackguard: at(30) },
    unholy_reprieve: { blackguard: at(35) },
  }),
  ...necro('necro_book_4', [
    ['path_of_shadows', 'Path of Shadows', 33, 30, 60, 40, { kind: 'recall' }, 'Returns you to town, or to your deepest level.'],
    ['descent_into_darkness', 'Descent into Darkness', 35, 20, 60, 40, { kind: 'deep_descent' }, 'Drops you several levels deeper after a short delay.'],
    ['soul_rend', 'Soul Rend', 35, 20, 60, 44, { kind: 'vampiric', dam: 150 }, 'Drains up to 150 hit points from a living monster and heals you by as much.', true],
    ['darkness_storm', 'Darkness Storm', 37, 25, 62, 50, { kind: 'ball', element: 'dark', dam: 120, radius: 3 }, 'A storm of darkness for 120 damage.', true],
    ['wither', 'Wither', 39, 22, 64, 50, { kind: 'slow_monsters' }, 'Withers every monster in sight, slowing it.'],
    ['nether_storm', 'Nether Storm', 41, 30, 66, 60, { kind: 'ball', element: 'nether', dam: 150, radius: 3 }, 'A storm of nether for 150 damage; useless against the undead.', true],
  ], { '*': BLACKGUARD_NONE }),
  ...necro('necro_book_5', [
    ['death_grip', 'Death Grip', 45, 30, 70, 70, { kind: 'crush', mult: 8 }, 'Crushes the life from a monster whose hit points are below eight times your level.', true],
    ['chaos_storm', 'Chaos Storm', 47, 40, 75, 80, { kind: 'ball', element: 'chaos', dam: 250, radius: 3 }, 'A storm of chaos for 250 damage.', true],
    ['the_unmaking', 'The Unmaking', 49, 50, 80, 90, { kind: 'banish' }, 'Removes every monster of one kind from the level.'],
    ['dark_ascension', 'Dark Ascension', 50, 60, 85, 100, { kind: 'seq', effects: [{ kind: 'heal', amount: 200, cure: ['cut', 'stun', 'poisoned', 'afraid'] }, timed('fast', 15), timed('sinvis', 30), timed('telepathy', 30)] }, 'Heals 200 hit points and grants speed, see invisible and telepathy for a while.'],
  ], { '*': BLACKGUARD_NONE }),

  // ---------------------------------------------------------------------------------------------
  // Songs. The bard's realm: each of these is struck up rather than cast, and keeps going.
  ...song('song_book_1', [
    ['song_kindler', 'Song of the Kindler', 1, 1, 22, 4, NOTHING, 'You name the Kindler of the Stars, and the dark draws back a pace. Your light reaches one square further for as long as you sing.'],
    ['song_silence', 'Song of Silence', 3, 2, 25, 5, NOTHING, 'A song so low it is felt rather than heard, and it swallows the noise you make. +3 stealth while it lasts.'],
    ['song_staunching', 'Song of Staunching', 5, 3, 28, 6, NOTHING, 'The old lay for wounds, sung over and over. Your flesh knits while you sing it.'],
    ['song_delvings', 'Song of Delvings', 7, 4, 30, 7, NOTHING, 'You sing to the rock and listen to how it answers. +35 searching, so hidden doors and traps give themselves away as you walk.'],
    ['song_elbereth', 'Song of Elbereth', 9, 5, 34, 9, NOTHING, 'The name that the servants of the Enemy cannot bear to hear. Those near you flinch and flee while you keep singing it.'],
    ['song_freedom', 'Song of Freedom', 11, 6, 36, 10, NOTHING, 'No chain and no spell holds a singer in the middle of a verse. Grants free action for as long as you sing.'],
  ]),
  ...song('song_book_2', [
    ['song_lorien', 'Song of Lorien', 13, 7, 38, 12, NOTHING, 'The drowsy air of the Gardens of Lorien, carried down into the dark. What hears it keeps nodding off beside you.'],
    ['song_valour', 'Song of Valour', 15, 8, 40, 14, NOTHING, 'A marching lay for a hero long dead, which does the living some good too. You are heroic while you sing it.'],
    ['song_trees', 'Song of the Two Trees', 17, 9, 42, 16, NOTHING, 'Silver and gold, remembered rather than seen. Your light reaches two squares further; it replaces the Kindler rather than adding to it.'],
    ['song_slaying', 'Song of Slaying', 19, 10, 44, 18, NOTHING, 'You set your blows to the beat and they land like hammer strokes. +10 damage while it lasts.'],
    ['song_beguiling', 'Song of Beguiling', 21, 11, 46, 20, NOTHING, 'The verses double back on themselves until the listener forgets which way it was facing.'],
    ['song_sharpsight', 'Song of Sharpened Sight', 23, 12, 48, 22, NOTHING, 'You sing what is there rather than what can be seen, and your eyes catch up. You see invisible creatures while it lasts.'],
  ]),
  ...song('song_book_3', [
    ['song_mastery', 'Song of Mastery', 25, 13, 50, 25, NOTHING, 'You take up the room\'s rhythm and set it slower than it wants to go. Everything near you drags.'],
    ['song_stone', 'Song of Stone', 27, 14, 52, 28, NOTHING, 'A dwarvish delving-chant, sung at yourself. Your skin answers the rock and hardens while you keep it up.'],
    ['song_challenge', 'Song of Challenge', 29, 15, 54, 30, NOTHING, 'You name your lineage aloud and dare the dark to answer it. Nothing steadies an arm like having said it out loud: +15 to hit.'],
    ['song_nirnaeth', 'Song of the Nirnaeth', 31, 16, 56, 32, NOTHING, 'The lay of Unnumbered Tears, and the Enemy\'s own hosts remember that day badly. A wider, heavier Elbereth.'],
    ['song_wrath', 'Song of Wrath', 33, 17, 58, 34, NOTHING, 'The verse stops being words somewhere in the third line. You fight berserk for as long as your breath holds.'],
    ['song_warding', 'Song of Warding', 35, 18, 60, 36, NOTHING, 'A ward sung rather than carved, and it holds only while the sound does. +25 armour.'],
  ]),
  ...song('song_book_4', [
    ['song_lament', 'Song of Lamentation', 37, 19, 62, 38, NOTHING, 'Grief so old it has become a shield. Evil things cannot come at you cleanly while you mourn aloud.'],
    ['song_farlistening', 'Song of Far-listening', 39, 21, 64, 40, NOTHING, 'You sing one note and wait for the level to sing it back. You sense every mind that hears you.'],
    ['song_binding', 'Song of Binding', 41, 23, 66, 42, NOTHING, 'The song Luthien sang over the Enemy himself, as much of it as anyone now remembers. The deep form of Lorien.'],
    ['song_swiftfeet', 'Song of Swift Feet', 43, 25, 68, 44, NOTHING, 'A dancing measure, and your feet keep it whether you meant them to or not. +2 speed while it lasts.'],
    ['song_oath', 'Song of the Oath', 45, 27, 70, 46, NOTHING, 'The oath that ruined a house, sung by someone who should know better. One more blow every round, for as long as you are fool enough to hold the note.'],
  ]),
  ...song('song_book_5', [
    ['song_dooming', 'The Doom of Mandos', 47, 30, 72, 48, NOTHING, 'A sentence pronounced, not a tune. Everything that hears it moves as though through deep water.'],
    ['song_elderking', 'Song of the Elder King', 48, 33, 74, 50, NOTHING, 'You sing the winds of Manwe about yourself and nothing gets through them cleanly. +45 armour.'],
    ['song_everwhite', 'Song of the Everwhite', 49, 36, 76, 52, NOTHING, 'The high thin air of the Everwhite Mountain, and your feet barely touch the stone. +3 speed; it replaces Swift Feet rather than adding to it.'],
    ['song_theme', 'The Theme of Iluvatar', 50, 40, 80, 60, NOTHING, 'The Music the world was made out of. Everything that hears it is caught up and forgets what it was doing, for eight squares in every direction, until your voice gives out.'],
  ]),
];
export const SPELL_BY_ID: Record<string, SpellDef> = Object.fromEntries(SPELLS.map(s => [s.id, s]));
export function spellsInBook(book: string): SpellDef[] { return SPELLS.filter(s => s.book === book); }
