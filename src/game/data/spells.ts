// Mage and priest spell lists, modelled on Angband 3.0. `book` names the ObjectKind id holding the spell.
import type { SpellDef, Effect } from '../types.ts';

type S = [id: string, name: string, level: number, mana: number, fail: number, exp: number, effect: Effect, desc: string, aimed?: boolean];

function magic(book: string, list: S[]): SpellDef[] {
  return list.map(([id, name, level, mana, fail, exp, effect, desc, aimed]) => ({ id, name, realm: 'magic', book, level, mana, fail, exp, effect, desc, aimed: !!aimed }));
}
function prayer(book: string, list: S[]): SpellDef[] {
  return list.map(([id, name, level, mana, fail, exp, effect, desc, aimed]) => ({ id, name, realm: 'prayer', book, level, mana, fail, exp, effect, desc, aimed: !!aimed }));
}

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
  ]),
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
  ]),
  ...magic('magic_book_3', [
    ['satisfy_hunger', 'Satisfy Hunger', 25, 13, 50, 25, { kind: 'satisfy_hunger' }, 'Fills your stomach.'],
    ['recharge_i', 'Recharge Item I', 25, 14, 50, 25, { kind: 'recharge', power: 5 }, 'Recharges a wand or staff.'],
    ['sleep_ii', 'Sleep II', 27, 14, 52, 28, { kind: 'sleep_monsters' }, 'Sleeps adjacent monsters.'],
    ['polymorph_other', 'Polymorph Other', 29, 15, 54, 30, { kind: 'polymorph' }, 'Changes a monster into another.', true],
    ['identify', 'Identify', 31, 16, 56, 32, { kind: 'identify' }, 'Identifies an object.'],
    ['sleep_iii', 'Sleep III', 33, 17, 58, 34, { kind: 'sleep_monsters' }, 'Sleeps all monsters in sight.'],
    ['fire_bolt', 'Fire Bolt', 35, 18, 60, 36, { kind: 'bolt', element: 'fire', dice: [9, 8] }, 'A bolt of fire.', true],
    ['slow_monster', 'Slow Monster', 37, 19, 62, 38, { kind: 'slow_monster' }, 'Slows one monster.', true],
  ]),
  ...magic('magic_book_4', [
    ['frost_ball', 'Frost Ball', 39, 20, 64, 40, { kind: 'ball', element: 'cold', dam: 70, radius: 2 }, 'A ball of frost.', true],
    ['recharge_ii', 'Recharge Item II', 41, 21, 66, 42, { kind: 'recharge', power: 40 }, 'A stronger recharge.'],
    ['teleport_other', 'Teleport Other', 43, 22, 68, 44, { kind: 'teleport_other' }, 'Teleports a monster away.', true],
    ['haste_self', 'Haste Self', 45, 23, 70, 46, { kind: 'timed', effect: 'fast', base: 20, dice: [1, 20] }, 'Temporarily speeds you up.'],
    ['fire_ball', 'Fire Ball', 47, 24, 72, 48, { kind: 'ball', element: 'fire', dam: 100, radius: 2 }, 'A ball of fire.', true],
    ['word_of_destruction', 'Word of Destruction', 49, 25, 74, 50, { kind: 'destruction' }, 'Destroys the area around you.'],
    ['banishment', 'Banishment', 50, 50, 80, 60, { kind: 'banish' }, 'Removes every monster of one kind from the level.'],
  ]),
  ...magic('magic_book_5', [
    ['resist_fire', 'Resist Fire', 15, 5, 50, 20, { kind: 'timed', effect: 'oppose_fire', base: 20, dice: [1, 20] }, 'Temporary fire resistance.'],
    ['resist_cold', 'Resist Cold', 15, 5, 50, 20, { kind: 'timed', effect: 'oppose_cold', base: 20, dice: [1, 20] }, 'Temporary cold resistance.'],
    ['resist_acid', 'Resist Acid', 15, 5, 50, 20, { kind: 'timed', effect: 'oppose_acid', base: 20, dice: [1, 20] }, 'Temporary acid resistance.'],
    ['resist_poison', 'Resist Poison', 20, 5, 50, 20, { kind: 'timed', effect: 'oppose_pois', base: 20, dice: [1, 20] }, 'Temporary poison resistance.'],
    ['resistance', 'Resistance', 25, 20, 60, 30, { kind: 'seq', effects: [{ kind: 'timed', effect: 'oppose_fire', base: 20, dice: [1, 20] }, { kind: 'timed', effect: 'oppose_cold', base: 20, dice: [1, 20] }, { kind: 'timed', effect: 'oppose_acid', base: 20, dice: [1, 20] }, { kind: 'timed', effect: 'oppose_elec', base: 20, dice: [1, 20] }, { kind: 'timed', effect: 'oppose_pois', base: 20, dice: [1, 20] }] }, 'Resistance to all five elements.'],
  ]),
  ...magic('magic_book_6', [
    ['door_creation', 'Door Creation', 10, 7, 50, 20, { kind: 'create_doors' }, 'Surrounds you with doors.'],
    ['stair_creation', 'Stair Creation', 25, 12, 60, 30, { kind: 'create_stairs' }, 'Creates a staircase under you.'],
    ['teleport_level', 'Teleport Level', 25, 15, 60, 30, { kind: 'teleport_level' }, 'Moves you up or down a level.'],
    ['earthquake', 'Earthquake', 30, 25, 70, 40, { kind: 'earthquake' }, 'Shakes the dungeon around you.'],
    ['word_of_recall', 'Word of Recall', 30, 35, 70, 40, { kind: 'recall' }, 'Returns you to town, or to your deepest level.'],
  ]),
  ...magic('magic_book_7', [
    ['acid_bolt', 'Acid Bolt', 20, 15, 60, 40, { kind: 'bolt', element: 'acid', dice: [8, 8] }, 'A bolt of acid.', true],
    ['cloud_kill', 'Cloud Kill', 30, 20, 70, 50, { kind: 'ball', element: 'pois', dam: 50, radius: 3 }, 'A big cloud of poison.', true],
    ['acid_ball', 'Acid Ball', 35, 25, 75, 60, { kind: 'ball', element: 'acid', dam: 100, radius: 2 }, 'A ball of acid.', true],
    ['ice_storm', 'Ice Storm', 40, 30, 80, 70, { kind: 'ball', element: 'cold', dam: 150, radius: 3 }, 'A storm of ice.', true],
    ['meteor_swarm', 'Meteor Swarm', 45, 40, 85, 80, { kind: 'ball', element: 'missile', dam: 200, radius: 3 }, 'A rain of meteors.', true],
    ['mana_storm', 'Mana Storm', 50, 50, 90, 100, { kind: 'ball', element: 'mana', dam: 300, radius: 3 }, 'Pure destruction.', true],
  ]),
  ...prayer('prayer_book_1', [
    ['detect_evil', 'Detect Evil', 1, 1, 10, 4, { kind: 'detect', what: ['evil'] }, 'Reveals evil monsters.'],
    ['cure_light_wounds_p', 'Cure Light Wounds', 1, 2, 15, 4, { kind: 'heal', amount: 20, cure: ['cut'] }, 'Heals 20 hit points and cuts.'],
    ['bless', 'Bless', 1, 2, 20, 4, { kind: 'timed', effect: 'blessed', base: 12, dice: [1, 12] }, 'A short blessing: +AC, +to-hit.'],
    ['remove_fear', 'Remove Fear', 1, 2, 25, 4, { kind: 'cure', cure: ['afraid'] }, 'Cures fear.'],
    ['call_light', 'Call Light', 3, 2, 25, 4, { kind: 'light_room' }, 'Lights the room.'],
    ['find_traps', 'Find Traps', 5, 3, 27, 5, { kind: 'detect', what: ['traps'] }, 'Detects traps.'],
    ['detect_doors_stairs', 'Detect Doors/Stairs', 5, 3, 27, 5, { kind: 'detect', what: ['doors', 'stairs'] }, 'Detects doors and stairs.'],
    ['slow_poison', 'Slow Poison', 7, 3, 28, 5, { kind: 'cure', cure: ['poisoned'] }, 'Cures poison.'],
  ]),
  ...prayer('prayer_book_2', [
    ['scare_monster', 'Scare Monster', 9, 4, 29, 6, { kind: 'scare_monster' }, 'Frightens one monster.', true],
    ['portal', 'Portal', 9, 5, 30, 6, { kind: 'teleport', range: 30 }, 'A medium-range teleport.'],
    ['cure_serious_wounds_p', 'Cure Serious Wounds', 11, 5, 32, 7, { kind: 'heal', amount: 40, cure: ['cut', 'blind', 'confused'] }, 'Heals 40 hit points, cuts, blindness and confusion.'],
    ['chant', 'Chant', 11, 5, 32, 7, { kind: 'timed', effect: 'blessed', base: 24, dice: [1, 24] }, 'A longer blessing.'],
    ['sanctuary', 'Sanctuary', 13, 5, 33, 8, { kind: 'sleep_monsters' }, 'Sleeps adjacent monsters.'],
    ['satisfy_hunger_p', 'Satisfy Hunger', 13, 6, 34, 8, { kind: 'satisfy_hunger' }, 'Fills your stomach.'],
    ['remove_curse', 'Remove Curse', 15, 6, 35, 8, { kind: 'remove_curse' }, 'Removes light curses from your equipment.'],
    ['resist_heat_cold', 'Resist Heat and Cold', 15, 7, 36, 9, { kind: 'seq', effects: [{ kind: 'timed', effect: 'oppose_fire', base: 10, dice: [1, 10] }, { kind: 'timed', effect: 'oppose_cold', base: 10, dice: [1, 10] }] }, 'Resist fire and cold.'],
  ]),
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
  ]),
  ...prayer('prayer_book_4', [
    ['prayer', 'Prayer', 35, 14, 50, 30, { kind: 'timed', effect: 'blessed', base: 48, dice: [1, 48] }, 'A long blessing.'],
    ['dispel_undead', 'Dispel Undead', 37, 15, 52, 34, { kind: 'dispel', what: 'undead', dam: 60 }, 'Damages all undead in sight.'],
    ['heal', 'Heal', 39, 16, 55, 38, { kind: 'heal', amount: 300, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun'] }, 'Heals 300 hit points.'],
    ['dispel_evil', 'Dispel Evil', 41, 20, 58, 42, { kind: 'dispel', what: 'evil', dam: 90 }, 'Damages all evil monsters in sight.'],
    ['glyph_of_warding', 'Glyph of Warding', 43, 24, 60, 46, { kind: 'glyph' }, 'Wards the ground beneath you.'],
    ['holy_word', 'Holy Word', 45, 30, 65, 50, { kind: 'seq', effects: [{ kind: 'dispel', what: 'evil', dam: 150 }, { kind: 'heal', amount: 1000, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun', 'afraid'] }] }, 'Dispels evil and heals you completely.'],
  ]),
  ...prayer('prayer_book_5', [
    ['blink', 'Blink', 3, 3, 30, 10, { kind: 'teleport', range: 10 }, 'A short teleport.'],
    ['teleport_self_p', 'Teleport Self', 10, 10, 40, 20, { kind: 'teleport', range: 100 }, 'A long teleport.'],
    ['teleport_other_p', 'Teleport Other', 20, 20, 50, 30, { kind: 'teleport_other' }, 'Teleports a monster away.', true],
    ['teleport_level_p', 'Teleport Level', 30, 40, 60, 40, { kind: 'teleport_level' }, 'Moves you up or down a level.'],
    ['word_of_recall_p', 'Word of Recall', 35, 50, 70, 50, { kind: 'recall' }, 'Returns you to town, or to your deepest level.'],
  ]),
  ...prayer('prayer_book_6', [
    ['cure_serious_wounds_2', 'Cure Serious Wounds', 15, 5, 50, 20, { kind: 'heal', amount: 40, cure: ['cut', 'blind', 'confused'] }, 'Heals 40 hit points.'],
    ['cure_mortal_wounds_2', 'Cure Mortal Wounds', 25, 15, 60, 30, { kind: 'heal', amount: 120, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun'] }, 'Heals 120 hit points.'],
    ['healing', 'Healing', 35, 60, 70, 40, { kind: 'heal', amount: 2000, cure: ['cut', 'blind', 'confused', 'poisoned', 'stun'] }, 'Heals you completely.'],
    ['restoration', 'Restoration', 45, 80, 80, 50, { kind: 'restore_stat', stat: 'all' }, 'Restores all drained stats.'],
    ['remembrance', 'Remembrance', 49, 100, 80, 60, { kind: 'restore_exp' }, 'Restores drained experience.'],
  ]),
  ...prayer('prayer_book_7', [
    ['dispel_undead_2', 'Dispel Undead', 25, 20, 60, 40, { kind: 'dispel', what: 'undead', dam: 120 }, 'Damages all undead in sight.'],
    ['dispel_evil_2', 'Dispel Evil', 30, 30, 65, 50, { kind: 'dispel', what: 'evil', dam: 150 }, 'Damages all evil in sight.'],
    ['banishment_p', 'Banishment', 35, 40, 70, 60, { kind: 'banish' }, 'Removes every monster of one kind from the level.'],
    ['word_of_destruction_p', 'Word of Destruction', 40, 50, 75, 70, { kind: 'destruction' }, 'Destroys the area around you.'],
    ['annihilation', 'Annihilation', 45, 60, 80, 80, { kind: 'drain_life', dam: 200 }, 'Drains the life from one monster.', true],
  ]),
];
export const SPELL_BY_ID: Record<string, SpellDef> = Object.fromEntries(SPELLS.map(s => [s.id, s]));
export function spellsInBook(book: string): SpellDef[] { return SPELLS.filter(s => s.book === book); }
