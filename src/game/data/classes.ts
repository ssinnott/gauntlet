import type { ClassDef } from '../types.ts';

const WARRIOR_TITLES = ['Rookie', 'Soldier', 'Mercenary', 'Veteran', 'Swordsman', 'Champion', 'Hero', 'Baron', 'Duke', 'Lord'];
const MAGE_TITLES = ['Novice', 'Apprentice', 'Trickster', 'Illusionist', 'Spellbinder', 'Evoker', 'Conjurer', 'Warlock', 'Sorcerer', 'Mage Lord'];
const PRIEST_TITLES = ['Believer', 'Acolyte', 'Adept', 'Curate', 'Canon', 'Lama', 'Patriarch', 'Priest', 'High Priest', 'Priest Lord'];
const ROGUE_TITLES = ['Vagabond', 'Cutpurse', 'Robber', 'Burglar', 'Filcher', 'Sharper', 'Low Thief', 'High Thief', 'Master Thief', 'Assassin'];
const RANGER_TITLES = ['Runner', 'Strider', 'Scout', 'Courser', 'Tracker', 'Guide', 'Pathfinder', 'Low Ranger', 'High Ranger', 'Ranger Lord'];
const PALADIN_TITLES = ['Gallant', 'Keeper', 'Protector', 'Defender', 'Warder', 'Knight', 'Guardian', 'Chevalier', 'Paladin', 'Paladin Lord'];

export const CLASSES: ClassDef[] = [
  { id: 'warrior', name: 'Warrior', hero: 'Warrior', stats: { STR: 5, INT: -2, WIS: -2, DEX: 2, CON: 2, CHR: -1 },
    skills: { disarm: 25, device: 18, save: 18, stealth: 1, search: 14, perception: 2, melee: 70, bows: 55, throw: 55, digging: 0 },
    skillsGrowth: { disarm: 12, device: 7, save: 10, stealth: 0, search: 0, perception: 0, melee: 45, bows: 45, throw: 45, digging: 0 },
    hitDie: 9, expPct: 0, maxAttacks: 6, minWeight: 30, attackMultiplier: 5, realm: null, spellStat: 'INT', firstSpellLevel: 99,
    startItems: [['broad_sword', 1], ['chain_mail', 1], ['potion_berserk', 1], ['ration', 3], ['torch', 3], ['potion_clw', 2], ['flask_oil', 5]],
    titles: WARRIOR_TITLES,
    palette: { skin: '#e8b890', hair: '#6a3a1a', primary: '#2f6fd0', secondary: '#8a6a3a', accent: '#f0c040', metal: '#c8cdd8', dark: '#1f2430', glow: '#7ae0ff' },
    desc: 'The Gauntlet Warrior: the most hit points, the most blows, no magic at all. Thor would be proud.' },
  { id: 'mage', name: 'Mage', hero: 'Wizard', stats: { STR: -5, INT: 3, WIS: 0, DEX: 1, CON: -2, CHR: 1 },
    skills: { disarm: 30, device: 36, save: 30, stealth: 2, search: 10, perception: 5, melee: 34, bows: 20, throw: 20, digging: 0 },
    skillsGrowth: { disarm: 7, device: 13, save: 9, stealth: 0, search: 0, perception: 0, melee: 15, bows: 15, throw: 15, digging: 0 },
    hitDie: 0, expPct: 30, maxAttacks: 4, minWeight: 40, attackMultiplier: 2, realm: 'magic', spellStat: 'INT', firstSpellLevel: 1,
    startItems: [['magic_book_1', 1], ['dagger', 1], ['soft_leather_armor', 1], ['ration', 3], ['torch', 3], ['potion_clw', 2], ['scroll_word_of_recall', 1], ['flask_oil', 5]],
    titles: MAGE_TITLES,
    palette: { skin: '#e8c8a8', hair: '#d8d8e0', primary: '#f0d040', secondary: '#3a2a6a', accent: '#ff5030', metal: '#c8cdd8', dark: '#2a1c3a', glow: '#ffd070' },
    desc: 'The Gauntlet Wizard: fragile, but with the widest range of destructive and utility spells.' },
  { id: 'priest', name: 'Priest', hero: 'Cleric', stats: { STR: -1, INT: -3, WIS: 3, DEX: -1, CON: 0, CHR: 2 },
    skills: { disarm: 25, device: 30, save: 32, stealth: 2, search: 16, perception: 8, melee: 48, bows: 35, throw: 35, digging: 0 },
    skillsGrowth: { disarm: 7, device: 10, save: 12, stealth: 0, search: 0, perception: 0, melee: 20, bows: 20, throw: 20, digging: 0 },
    hitDie: 2, expPct: 20, maxAttacks: 4, minWeight: 35, attackMultiplier: 3, realm: 'prayer', spellStat: 'WIS', firstSpellLevel: 1,
    startItems: [['prayer_book_1', 1], ['mace', 1], ['soft_leather_armor', 1], ['ration', 3], ['torch', 3], ['potion_clw', 2], ['scroll_word_of_recall', 1], ['flask_oil', 5]],
    titles: PRIEST_TITLES,
    palette: { skin: '#e0b898', hair: '#4a3020', primary: '#e8e8f0', secondary: '#8a2a2a', accent: '#f0c040', metal: '#c8cdd8', dark: '#2a2030', glow: '#fff0a0' },
    desc: 'A healer and exorcist. Prayers cure, protect and dispel the undead; blunt weapons only.' },
  { id: 'rogue', name: 'Rogue', hero: 'Thief', stats: { STR: 2, INT: 1, WIS: -2, DEX: 3, CON: 1, CHR: -1 },
    skills: { disarm: 45, device: 32, save: 28, stealth: 5, search: 32, perception: 24, melee: 60, bows: 66, throw: 66, digging: 0 },
    skillsGrowth: { disarm: 15, device: 10, save: 10, stealth: 0, search: 0, perception: 0, melee: 40, bows: 30, throw: 30, digging: 0 },
    hitDie: 6, expPct: 25, maxAttacks: 5, minWeight: 30, attackMultiplier: 3, realm: 'magic', spellStat: 'INT', firstSpellLevel: 5,
    startItems: [['magic_book_1', 1], ['short_sword', 1], ['soft_leather_armor', 1], ['sling', 1], ['iron_shot', 30], ['ration', 3], ['torch', 3], ['potion_clw', 2], ['flask_oil', 5]],
    titles: ROGUE_TITLES,
    palette: { skin: '#d8b090', hair: '#201810', primary: '#3a3a48', secondary: '#5a4a30', accent: '#c02020', metal: '#b0b8c8', dark: '#181820', glow: '#a0ff70' },
    desc: 'Stealthy, sharp-eyed, a fine shot with a sling and able to disarm anything. Learns a few tricks.' },
  { id: 'ranger', name: 'Ranger', hero: 'Elf', stats: { STR: 2, INT: 2, WIS: 0, DEX: 1, CON: 1, CHR: 1 },
    skills: { disarm: 30, device: 32, save: 28, stealth: 3, search: 24, perception: 16, melee: 56, bows: 72, throw: 72, digging: 0 },
    skillsGrowth: { disarm: 8, device: 10, save: 10, stealth: 0, search: 0, perception: 0, melee: 30, bows: 45, throw: 45, digging: 0 },
    hitDie: 4, expPct: 30, maxAttacks: 5, minWeight: 35, attackMultiplier: 4, realm: 'magic', spellStat: 'INT', firstSpellLevel: 3,
    startItems: [['magic_book_1', 1], ['long_bow', 1], ['arrow', 40], ['short_sword', 1], ['soft_leather_armor', 1], ['ration', 3], ['torch', 3], ['potion_clw', 2], ['flask_oil', 5]],
    titles: RANGER_TITLES,
    palette: { skin: '#f0d0b0', hair: '#f0e080', primary: '#2a8a3a', secondary: '#6a4a2a', accent: '#f0f0f0', metal: '#c8cdd8', dark: '#1c2a1c', glow: '#a0ffa0' },
    desc: 'The Gauntlet Elf: extra shots with a bow, quick, and a dabbler in magic.' },
  { id: 'paladin', name: 'Paladin', hero: 'Valkyrie', stats: { STR: 3, INT: -3, WIS: 1, DEX: 0, CON: 2, CHR: 2 },
    skills: { disarm: 20, device: 24, save: 25, stealth: 1, search: 12, perception: 2, melee: 68, bows: 40, throw: 40, digging: 0 },
    skillsGrowth: { disarm: 7, device: 10, save: 11, stealth: 0, search: 0, perception: 0, melee: 35, bows: 30, throw: 30, digging: 0 },
    hitDie: 6, expPct: 35, maxAttacks: 5, minWeight: 30, attackMultiplier: 5, realm: 'prayer', spellStat: 'WIS', firstSpellLevel: 1,
    startItems: [['prayer_book_1', 1], ['broad_sword', 1], ['small_leather_shield', 1], ['soft_leather_armor', 1], ['ration', 3], ['torch', 3], ['potion_clw', 2], ['flask_oil', 5]],
    titles: PALADIN_TITLES,
    palette: { skin: '#f0c8a8', hair: '#f8e890', primary: '#e83a3a', secondary: '#2a3a6a', accent: '#f0c040', metal: '#d8dde8', dark: '#28202a', glow: '#ffe0a0' },
    desc: 'The Gauntlet Valkyrie: a holy warrior with a shield, good armour and a few prayers.' },
];
export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map(c => [c.id, c]));
