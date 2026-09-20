// Subclasses: three specialisations for each class, chosen at birth.
//
// Unlike a sub-race, a subclass is meant to change the run. Each one overrides some of the parent
// class's numbers -- the hit die, how many blows it can reach, how heavy a weapon it swings well,
// when its spells start -- and unlocks three features at levels 1, 10 and 25, so the halves of a
// class diverge as the character grows rather than at the character sheet.
import type { SubclassDef } from '../types.ts';

export const SUBCLASSES: SubclassDef[] = [
  // ---- warrior ----
  { id: 'warrior_hammerhand', cls: 'warrior', name: 'Hammerhand', hitDie: 10, maxAttacks: 3, minWeight: 200, attackMultiplier: 6, stats: { STR: 1, DEX: -1, CON: 1 }, skills: { melee: 6, digging: 25, disarm: -5, stealth: -1 }, skillsGrowth: { melee: 10, digging: 15, disarm: -3 }, features: [
      { at: 1, kind: 'flag', flag: 'IMPACT', name: 'Earthshaker', desc: 'Every blow lands with the force of a falling rock. Heavy hits crack the floor and bring the walls down.' },
      { at: 10, kind: 'quirk', quirk: 'stun_on_big_hit', name: 'Ringing Blow', desc: 'A hit that lands square leaves the thing reeling. Big enough blows stun, and a stunned monster loses half its turns.' },
      { at: 25, kind: 'bonus', field: 'blows', amount: 1, name: 'Follow-Through', desc: 'A fourth swing, on top of the three the grip allows. Twenty-five levels of swinging three times buys one more.' },
    ], desc: 'Swings one enormous weapon and never more than three times. A light blade buys nothing here -- the damage is all in the head of the hammer, and the floor shakes when it lands.' },
  { id: 'warrior_shieldbearer', cls: 'warrior', name: 'Shieldbearer', hitDie: 11, expPct: 10, maxAttacks: 4, attackMultiplier: 4, stats: { CON: 2, DEX: -1 }, skills: { save: 10, search: 4, melee: -6, disarm: -5, stealth: -1 }, skillsGrowth: { save: 6, melee: -5 }, features: [
      { at: 1, kind: 'bonus', field: 'ac', amount: 10, name: 'Shield Wall', desc: 'Trained from the first day to fight behind a shield rather than around one. Worth ten points of armour on its own.' },
      { at: 10, kind: 'flag', flag: 'FREE_ACT', name: 'Braced', desc: 'Nothing holds a Shieldbearer still that was not already holding the shield. Paralysis does not take.' },
      { at: 25, kind: 'quirk', quirk: 'hold_the_line', name: 'Zone of Control', desc: 'Anything next to you may attack or back off, but it may not slide past to the squares behind. A doorway held by a Shieldbearer stays held.' },
    ], desc: 'Fights from behind a shield and does not give ground. The most hit points in the dungeon, the slowest kills, and a corridor that nothing walks past.' },
  { id: 'warrior_axe_thrower', cls: 'warrior', name: 'Axe-Thrower', hitDie: 7, expPct: 10, maxAttacks: 4, minWeight: 18, stats: { STR: -1, DEX: 2, CON: -1 }, skills: { throw: 25, search: 6, stealth: 1, melee: -8, bows: -10 }, skillsGrowth: { throw: 20, melee: -10, bows: -10 }, features: [
      { at: 1, kind: 'quirk', quirk: 'mighty_throw', name: 'Thrower\'s Grip', desc: 'Daggers, spears and flasks leave the hand the right way round. Anything meant for throwing hits twice as hard as it would for anyone else.' },
      { at: 10, kind: 'stat', stat: 'DEX', amount: 2, name: 'Wrist and Eye', desc: 'Years of placing a spinning weight on a moving target. Helps the throw, the armour class and the blow count alike.' },
      { at: 25, kind: 'bonus', field: 'speed', amount: 2, name: 'Skirmish', desc: 'Throw, step back, throw again. Two points of speed is what makes that pattern work instead of merely sound sensible.' },
    ], desc: 'The arcade Warrior\'s thrown axe made the main attack. Hits harder at ten paces than in the front rank, and is thin enough to need the distance.' },
  // ---- mage ----
  { id: 'mage_thaumaturge', cls: 'mage', name: 'Thaumaturge', expPct: 25, maxAttacks: 1, attackMultiplier: 1, stats: { INT: 1, CON: -1 }, skills: { melee: -14, bows: -10, device: 6 }, skillsGrowth: { melee: -10, device: 4 }, features: [
      { at: 1, kind: 'quirk', quirk: 'focused_bolts', name: 'Heighten Magic', desc: 'Every bolt and ball you cast lands a quarter harder and costs one more mana. At low level that is a real tax on a four-point pool.' },
      { at: 10, kind: 'stat', stat: 'INT', amount: 2, name: 'Deep Study', desc: '+2 INT: more mana to spend and fewer spells that fizzle.' },
      { at: 25, kind: 'bonus', field: 'speed', amount: 2, name: 'Step Back', desc: '+2 speed. You fire and move again before what you shot at reaches you, which is the only defence you have.' },
    ], desc: 'Gives up what little melee a mage had -- one blow, and a weak one -- for bolts and balls that land a quarter harder and cost a point more mana each. It studies one narrow thing, so it levels faster than a general mage and runs dry sooner.' },
  { id: 'mage_enchanter', cls: 'mage', name: 'Enchanter', hitDie: 3, expPct: 40, maxAttacks: 2, stats: { CHR: 2, CON: 1, STR: -1 }, skills: { save: 8, stealth: 1, search: 6, melee: -6 }, skillsGrowth: { save: 4, device: -2 }, features: [
      { at: 1, kind: 'quirk', quirk: 'strong_enchantment', name: 'Beguile', desc: 'Your sleep, slow, confusion, fear and polymorph spells are tested against monsters at a quarter more power, so they hold on deeper things.' },
      { at: 10, kind: 'skill', skill: 'stealth', amount: 2, name: 'Soft Tread', desc: '+2 stealth. What you have put to sleep tends to stay asleep while you cross the room and leave.' },
      { at: 25, kind: 'flag', flag: 'TELEPATHY', name: 'Open Mind', desc: 'You sense thinking monsters through walls. You pick which one to charm before it knows you are there.' },
    ], desc: 'Wins fights without starting them. Sleep, slow, confusion, fear and polymorph stick a quarter more often, and it is quiet enough to walk away from what it put down. Tougher than a mage, slower to level, and it never learned to hit anything.' },
  { id: 'mage_blood', cls: 'mage', name: 'Blood Mage', hitDie: 6, expPct: 45, maxAttacks: 2, stats: { CON: 2, CHR: -1 }, skills: { save: 6, device: -6, stealth: -1 }, skillsGrowth: { save: 3, device: -3 }, features: [
      { at: 1, kind: 'quirk', quirk: 'blood_magic', name: 'Blood Casting', desc: 'You have no mana. Spells come out of your hit points, and you cannot cast one that would kill you.' },
      { at: 10, kind: 'flag', flag: 'REGEN', name: 'Quickened Blood', desc: 'You heal at twice the usual rate, which is how you refill. You also eat noticeably more.' },
      { at: 25, kind: 'stat', stat: 'CON', amount: 3, name: 'Deep Well', desc: '+3 CON. For you, hit points and spell points are the same number, so this is both armour and ammunition.' },
    ], desc: 'Has no mana at all. Every spell is paid for in hit points, so it carries the biggest hit die of any caster and spends it all day. Cure-wounds potions are its spell points, it levels slowly, and a bad fight and a long casting session look the same on the health bar.' },
  // ---- priest ----
  { id: 'priest_exorcist', cls: 'priest', name: 'Exorcist', hitDie: 4, expPct: 30, attackMultiplier: 4, firstSpellLevel: 5, stats: { STR: 1, CON: 1, CHR: -1 }, skills: { melee: 12, device: -6, stealth: -1 }, skillsGrowth: { melee: 10, device: -3 }, features: [
      { at: 1, kind: 'quirk', quirk: 'edged_ok', name: 'Oath Set Aside', desc: 'Swords and axes carry no penalty. The order releases its exorcists from the blunt-weapon oath, because what they hunt does not care what a mace does.' },
      { at: 10, kind: 'flag', flag: 'SEE_INVIS', name: 'Unquiet Sight', desc: 'You see invisible creatures. Most of what an exorcist is sent after does not bother to be visible.' },
      { at: 25, kind: 'flag', flag: 'RES_NETHER', name: 'Proof Against the Grave', desc: 'Resistance to nether. Wights, wraiths and liches all breathe it, and by this level you meet nothing else.' },
    ], desc: 'Takes up the blade the order forbids and goes hunting the dead with it. Tougher than a priest has any right to be and quicker to reach its blows, but it learns slowly and says no prayer before level 5.' },
  { id: 'priest_hospitaller', cls: 'priest', name: 'Hospitaller', hitDie: 5, expPct: 25, maxAttacks: 2, attackMultiplier: 2, stats: { CON: 2, STR: -1 }, skills: { save: 10, device: 6, melee: -14 }, skillsGrowth: { save: 6, melee: -10 }, features: [
      { at: 1, kind: 'flag', flag: 'REGEN', name: 'Quickened Flesh', desc: 'You heal faster than flesh should, and eat more to pay for it. Wounds close between fights instead of costing potions.' },
      { at: 10, kind: 'stat', stat: 'CON', amount: 2, name: 'Long Wind', desc: '+2 constitution. The discipline that lets you work a ward for an hour also fills out the hit point pool.' },
      { at: 25, kind: 'flag', flag: 'HOLD_LIFE', name: 'Life Held Fast', desc: 'Your experience is almost impossible to drain. A hero who survives everything is otherwise ground down by the things that take levels instead of hit points.' },
    ], desc: 'Built to outlast rather than to win: the largest hit die of any prayer-caster, two blows at most, and very little behind them. It heals, endures, and keeps walking down.' },
  { id: 'priest_prophet', cls: 'priest', name: 'Prophet', hitDie: 0, expPct: 10, maxAttacks: 1, attackMultiplier: 2, stats: { WIS: 1, CON: -1 }, skills: { device: 14, save: 12, perception: 6, melee: -18 }, skillsGrowth: { device: 6, save: 5, melee: -12 }, features: [
      { at: 1, kind: 'skill', skill: 'save', amount: 15, name: 'Unshaken', desc: 'A large bonus to saving throws. With this few hit points, the spell that lands is the one that kills you.' },
      { at: 10, kind: 'stat', stat: 'WIS', amount: 2, name: 'The Voice Grows Clear', desc: '+2 wisdom. More mana, and prayers that fail less often.' },
      { at: 25, kind: 'flag', flag: 'TELEPATHY', name: 'The Sight', desc: 'You sense thinking minds through walls. A prophet who cannot fight is never allowed to be surprised.' },
    ], desc: 'Gives up the mace entirely. One blow, a wizard\'s hit die, and in exchange the fastest levelling of any prayer-caster: prayers arrive sooner and the mana pool never stops growing.' },
  // ---- rogue ----
  { id: 'rogue_cutthroat', cls: 'rogue', name: 'Cutthroat', hitDie: 5, expPct: 30, minWeight: 20, firstSpellLevel: 15, stats: { STR: 1, DEX: 1, CON: -1 }, skills: { stealth: 1, melee: 12, bows: -20, device: -8 }, skillsGrowth: { melee: 12, bows: -20 }, features: [
      { at: 1, kind: 'quirk', quirk: 'sneak_attack', name: 'Killing Blow', desc: 'The first strike on something that has not seen you is worth three. Approach asleep and the fight is over before it starts.' },
      { at: 10, kind: 'flag', flag: 'BRAND_POIS', name: 'Envenomed Blades', desc: 'The hero coats whatever is in hand before going down. Every melee weapon carries a poison brand, branded or not.' },
      { at: 25, kind: 'bonus', field: 'blows', amount: 1, name: 'Second Knife', desc: 'One extra blow each round, on top of whatever the weapon already allows.' },
    ], desc: 'Kills from the dark with a knife rather than shooting from across the room. The first blow on a monster that has not noticed you is worth three, and from level ten every weapon in hand drips poison. Thin, slow to level, and the thief\'s tricks arrive very late.' },
  { id: 'rogue_burglar', cls: 'rogue', name: 'Burglar', hitDie: 4, maxAttacks: 4, attackMultiplier: 2, firstSpellLevel: 1, stats: { STR: -1, DEX: 1, CHR: 1 }, skills: { stealth: 2, search: 12, disarm: 15, perception: 10, melee: -18, bows: -8 }, skillsGrowth: { disarm: 8, melee: -18 }, features: [
      { at: 1, kind: 'quirk', quirk: 'pickpocket', name: 'Light Fingers', desc: 'Every coin found is worth one and a half. The shops are the point of the dungeon; the monsters are in the way.' },
      { at: 10, kind: 'skill', skill: 'stealth', amount: 2, name: 'Soft Boots', desc: 'Walks past sleeping monsters that would wake for anyone else, and leaves the level without being followed.' },
      { at: 25, kind: 'bonus', field: 'speed', amount: 2, name: 'Out the Window', desc: 'Two points of speed, kept for the walk back to the stairs with the loot.' },
    ], desc: 'Here to rob the dungeon, not to clear it. Opens anything, walks past what it cannot open, takes half again as much gold, and has the thief\'s tricks from level one. In a straight fight it is the worst melee character in the game.' },
  { id: 'rogue_slinger', cls: 'rogue', name: 'Slinger', expPct: 20, maxAttacks: 3, minWeight: 40, attackMultiplier: 2, stats: { STR: -1, DEX: 2 }, skills: { bows: 8, throw: 14, melee: -16, stealth: -1 }, skillsGrowth: { bows: 12, throw: 12, melee: -20 }, features: [
      { at: 1, kind: 'skill', skill: 'throw', amount: 10, name: 'Oil and Stones', desc: 'Flasks of oil and thrown knives land where they are aimed from the first level, which is what carries the early game.' },
      { at: 10, kind: 'bonus', field: 'might', amount: 1, name: 'Whipcrack', desc: 'A point of might on the launcher: a sling that multiplied by two now multiplies by three.' },
      { at: 25, kind: 'bonus', field: 'shots', amount: 1, name: 'Second Stone', desc: 'An extra shot each round, stacking with the extra sling shots the rogue already gets.' },
    ], desc: 'Does everything from across the room: the sling, thrown knives and flasks of oil. Levels faster than the parent class, but three blows is the ceiling in melee and a light blade swings like a club, so do not end up in melee.' },
  // ---- ranger ----
  { id: 'ranger_strongbow', cls: 'ranger', name: 'Strongbow', hitDie: 3, expPct: 35, maxAttacks: 2, firstSpellLevel: 99, stats: { STR: 1, DEX: 1, INT: -2 }, skills: { bows: 8, melee: -16, device: -8 }, skillsGrowth: { bows: 10, melee: -15, device: -5 }, features: [
      { at: 1, kind: 'quirk', quirk: 'no_extra_shots', name: 'Full Draw', desc: 'You draw to the ear and loose once. The ranger\'s hurried second arrow is not in your hands, and you spend a quarter of the ammunition for it.' },
      { at: 10, kind: 'bonus', field: 'might', amount: 1, name: 'Heavy Draw', desc: 'Every bow you pick up pulls harder: one more multiple of damage on each arrow, and two more squares of range.' },
      { at: 25, kind: 'bonus', field: 'shots', amount: 1, name: 'Second Arrow', desc: 'You learn to nock and loose again without losing the draw. Two arrows a turn, both at the full weight.' },
    ], desc: 'One arrow at a time, drawn full and loosed from across the room. No magic at all, and nothing to say in melee: if something reaches you, the mistake was made several turns ago.' },
  { id: 'ranger_marchwarden', cls: 'ranger', name: 'Marchwarden', hitDie: 7, expPct: 35, attackMultiplier: 5, firstSpellLevel: 20, stats: { STR: 1, CON: 1, INT: -1 }, skills: { melee: 12, bows: -14, save: 4, stealth: -1, device: -6 }, skillsGrowth: { melee: 15, bows: -20, save: 2 }, features: [
      { at: 1, kind: 'flag', flag: 'RES_FEAR', name: 'Unshaken', desc: 'You do not rout. Nothing on the level can frighten you off a fight you have decided to have.' },
      { at: 10, kind: 'bonus', field: 'speed', amount: 2, name: 'Forced March', desc: 'A warden\'s pace, kept up all day. A permanent edge in the turn order, which is enough to close a gap or leave one.' },
      { at: 25, kind: 'bonus', field: 'blows', amount: 1, name: 'Sword-Arm', desc: 'One extra blow each round with any weapon you can hold steady, on top of what your strength and dexterity already buy.' },
    ], desc: 'Puts down the bow and takes up the sword: more hit points, more blows, and the pace to close or break off. The magic comes very late, if the run lasts that long.' },
  { id: 'ranger_ithilien_scout', cls: 'ranger', name: 'Ithilien Scout', hitDie: 3, expPct: 35, maxAttacks: 4, minWeight: 25, stats: { DEX: 2, CON: -1 }, skills: { stealth: 2, search: 12, perception: 10, melee: -6, bows: -4, device: -6 }, skillsGrowth: { bows: -12, melee: -5, disarm: 6 }, features: [
      { at: 1, kind: 'quirk', quirk: 'hunter_mark', name: 'Ambush', desc: 'A bow shot into something still asleep does three times the damage. Once it is awake it is a fair fight, which is not what you came for.' },
      { at: 10, kind: 'bonus', field: 'infra', amount: 3, name: 'Night Eyes', desc: 'You pick out a warm body three squares off with no light at all, which is how you would rather travel.' },
      { at: 25, kind: 'flag', flag: 'TELEPATHY', name: 'The Whole Wood', desc: 'You hold the level in your head: every mind on it, through walls, seen or not. You choose which fights happen.' },
    ], desc: 'Walks in unheard and opens on something that is still asleep. Light blades, sharp eyes, and not enough hit points to trade blows once the level has woken up.' },
  // ---- paladin ----
  { id: 'paladin_gate_warder', cls: 'paladin', name: 'Gate Warder', hitDie: 8, maxAttacks: 3, minWeight: 40, attackMultiplier: 3, stats: { CON: 2, DEX: -1 }, skills: { melee: -8, bows: -10, device: -4, save: 8, stealth: -1 }, skillsGrowth: { melee: -8, save: 4 }, features: [
      { at: 1, kind: 'bonus', field: 'ac', amount: 20, name: 'Shieldwall', desc: 'She is taught to fight from behind the shield rather than around it. +20 armour class, from level one.' },
      { at: 10, kind: 'flag', flag: 'RES_CONF', name: 'Steady Watch', desc: 'A warder who loses the thread of the watch has already failed it. Confusion no longer takes hold.' },
      { at: 25, kind: 'quirk', quirk: 'shield_wall', name: 'Shield of the Citadel', desc: 'With a shield on her arm, a quarter of every blow, bolt and breath is turned aside.' },
    ], desc: 'A Valkyrie trained to hold ground rather than take it. She has a warrior\'s hit die and a priest\'s swing speed, so she wins by standing in a doorway with the shield up and letting the level come to her.' },
  { id: 'paladin_oathsworn', cls: 'paladin', name: 'Oathsworn', hitDie: 7, expPct: 20, attackMultiplier: 6, firstSpellLevel: 99, stats: { STR: 1, CON: 1, WIS: -2 }, skills: { melee: 8, disarm: 4, device: -8, save: -8 }, skillsGrowth: { melee: 8, save: -4 }, features: [
      { at: 1, kind: 'skill', skill: 'melee', amount: 10, name: 'Sword-oath', desc: 'The hours a paladin spends over the prayer book she spends at the pell instead. +10 melee skill.' },
      { at: 10, kind: 'flag', flag: 'SLAY_EVIL', name: 'Foe of the Enemy', desc: 'Whatever she holds cuts evil as though it were branded. Works on a plain weapon, and stacks with nothing.' },
      { at: 25, kind: 'bonus', field: 'blows', amount: 1, name: 'The Oath Kept', desc: 'One extra blow every round, over and above the class cap. It is all she has, so it had better be enough.' },
    ], desc: 'She swears by the sword and never learns a prayer. No mana at any level, ever; in exchange she gains levels nearly as cheaply as a warrior, reaches her blows far sooner, and her weapon learns to bite evil.' },
  { id: 'paladin_lightbearer', cls: 'paladin', name: 'Lightbearer', hitDie: 4, expPct: 25, maxAttacks: 3, attackMultiplier: 3, stats: { WIS: 2, CHR: 1, STR: -2 }, skills: { melee: -16, bows: -5, device: 10, save: 8, search: 8, perception: 6 }, skillsGrowth: { melee: -12, device: 6, save: 3 }, features: [
      { at: 1, kind: 'bonus', field: 'lightRadius', amount: 1, name: 'Kindled Lamp', desc: 'Her light burns a square further than anyone else\'s, which finds monsters earlier and hides her from nothing.' },
      { at: 10, kind: 'flag', flag: 'SEE_INVIS', name: 'Nothing Hidden', desc: 'What the lamp does not reach, the prayer does. She sees invisible creatures from here on.' },
      { at: 25, kind: 'quirk', quirk: 'holy_dispel', name: 'Wrath of the Host', desc: 'Dispel evil and dispel undead do half again their usual damage in her hands.' },
    ], desc: 'She carries the lamp and the prayer book and leaves most of the fighting to them. A thin hit die and two blows fewer than the parent class, but levels come cheaply, her light reaches a square further and her dispels hit half again as hard.' },
  // ---- druid ----
  { id: 'druid_stormcaller', cls: 'druid', name: 'Stormcaller', hitDie: 0, expPct: 20, maxAttacks: 2, attackMultiplier: 1, stats: { WIS: 1, CON: -1 }, skills: { device: 10, save: 6, melee: -15, bows: -10 }, skillsGrowth: { device: 5, save: 3, melee: -10 }, features: [
      { at: 1, kind: 'quirk', quirk: 'storm_lord', name: 'Storm-fed', desc: 'Lightning Strike, Thunderclap, River of Lightning and Tempest all do a quarter more damage. Nothing else does.' },
      { at: 10, kind: 'flag', flag: 'RES_ELEC', name: 'Earthed', desc: 'Resists lightning, including the lightning she stands in the middle of.' },
      { at: 25, kind: 'bonus', field: 'speed', amount: 2, name: 'Windborne', desc: '+2 speed, permanently. The only way this build survives being cornered is by not being cornered.' },
    ], desc: 'Trades the beasts and the earth for the storm alone. Levels faster than any other caster and her lightning and thunder land harder; in exchange the hit die drops below a mage\'s and melee is one feeble blow.' },
  { id: 'druid_skinchanger', cls: 'druid', name: 'Skin-changer', hitDie: 5, expPct: 45, minWeight: 30, attackMultiplier: 4, firstSpellLevel: 9, stats: { STR: 2, CON: 1, WIS: -1 }, skills: { melee: 25, save: 5, device: -10, throw: -10 }, skillsGrowth: { melee: 25, device: -6 }, features: [
      { at: 1, kind: 'quirk', quirk: 'bear_hands', name: 'Claws', desc: 'Empty hands count as a light weapon, so she gets a full set of blows unarmed. Wielding anything turns this off.' },
      { at: 10, kind: 'stat', stat: 'STR', amount: 2, name: 'Bear\'s Strength', desc: '+2 STR. On a class that starts at -2, this is the difference between one blow and three.' },
      { at: 25, kind: 'bonus', field: 'blows', amount: 1, name: 'Rending', desc: 'One extra blow every round, added after the usual cap.' },
    ], desc: 'Fights in the bear\'s shape. Claws instead of a weapon, a real hit die and the strength to use it, but nature magic does not start until level nine and experience comes slowly.' },
  { id: 'druid_earth_warden', cls: 'druid', name: 'Earth Warden', hitDie: 3, expPct: 40, maxAttacks: 2, attackMultiplier: 1, stats: { CON: 2, DEX: -1 }, skills: { digging: 30, save: 8, stealth: -2, melee: -10 }, skillsGrowth: { save: 4, digging: 15, melee: -8 }, features: [
      { at: 1, kind: 'bonus', field: 'ac', amount: 15, name: 'Bark Skin', desc: '+15 AC from the first level, before any armour is worn.' },
      { at: 10, kind: 'stat', stat: 'CON', amount: 2, name: 'Deep Roots', desc: '+2 CON, and the hit points that come with it on a die three points better than the parent class.' },
      { at: 25, kind: 'quirk', quirk: 'rooted', name: 'Rooted', desc: '+30 AC on any turn she has not moved. Standing still and casting is the whole plan.' },
    ], desc: 'Picks a square and holds it. Bark skin, deep roots, and stone, tremor and entanglement out of the spellbook; slow to level, and one or two weak blows is all the melee there is.' },
  // ---- necromancer ----
  { id: 'necromancer_nightwalker', cls: 'necromancer', name: 'Nightwalker', hitDie: 0, expPct: 25, maxAttacks: 2, minWeight: 30, stats: { DEX: 2, CON: -1 }, skills: { stealth: 3, search: 10, perception: 8, melee: -10, device: -4 }, skillsGrowth: { melee: -10, save: 2 }, features: [
      { at: 1, kind: 'quirk', quirk: 'unlight', name: 'Unlight', desc: 'He is harder to notice in the dark than any thief, and easier to spot than a warrior the moment he lights a torch.' },
      { at: 10, kind: 'flag', flag: 'RES_DARK', name: 'Dark-Fed', desc: 'Darkness no longer hurts or blinds him, so Create Darkness becomes a tool instead of a risk.' },
      { at: 25, kind: 'bonus', field: 'speed', amount: 2, name: 'Nightstride', desc: 'Two points of speed, permanently: enough to cross a room and be gone before what sleeps in it wakes.' },
    ], desc: 'Carries no light and learns to need none. In an unlit square he is harder to notice than a rogue, and under his own torch he is worse off than anyone; two blows at most, and the fewest hit points in the class.' },
  { id: 'necromancer_deathless', cls: 'necromancer', name: 'Deathless', hitDie: 6, expPct: 45, minWeight: 30, attackMultiplier: 4, firstSpellLevel: 5, stats: { STR: 2, CON: 1, INT: -1, DEX: -1 }, skills: { melee: 20, save: 4, device: -10, stealth: -2, bows: 8 }, skillsGrowth: { melee: 15, device: -5 }, features: [
      { at: 1, kind: 'flag', flag: 'HOLD_LIFE', name: 'Half Spent', desc: 'His life is already half given away, and nothing left in him can be drained.' },
      { at: 10, kind: 'quirk', quirk: 'life_leech', name: 'Cold Feeding', desc: 'Every blow that lands on something living gives a little of it back.' },
      { at: 25, kind: 'bonus', field: 'blows', amount: 1, name: 'Grave Strength', desc: 'One more blow each turn, which with the feeding is also one more mouthful.' },
    ], desc: 'Half a wight already: real hit points, a weapon heavy enough to matter, and blows that feed on the living. He learns his first ritual at level five and pays half again as much for every level.' },
  { id: 'necromancer_gravecaller', cls: 'necromancer', name: 'Gravecaller', hitDie: 0, expPct: 20, maxAttacks: 1, attackMultiplier: 1, stats: { INT: 2, CON: -1, DEX: -1 }, skills: { device: 12, save: 4, melee: -20, bows: -10, stealth: -1 }, skillsGrowth: { device: 5, melee: -10 }, features: [
      { at: 1, kind: 'quirk', quirk: 'soul_harvest', name: 'Soul Harvest', desc: 'The dead pay for the next ritual. Stop killing and the mana stops with it.' },
      { at: 10, kind: 'stat', stat: 'INT', amount: 1, name: 'The Deep Tomes', desc: 'A point of intelligence: more mana, and fewer castings that fail.' },
      { at: 25, kind: 'flag', flag: 'TELEPATHY', name: 'Reading the Dead', desc: 'He senses minds through stone, which is how a man with one blow and no hit points chooses which fights happen.' },
    ], desc: 'Gives up the body altogether: one feeble blow and no hit points worth counting. His rituals draw mana back out of whatever they kill, so the only safe pace is to keep killing.' },
  // ---- blackguard ----
  { id: 'blackguard_berserker', cls: 'blackguard', name: 'Berserker', hitDie: 11, expPct: 45, maxAttacks: 6, firstSpellLevel: 99, stats: { STR: 1, CON: 1, INT: -2 }, skills: { melee: 5, device: -12, save: -8, disarm: -8 }, skillsGrowth: { melee: 8, device: -4, save: -3 }, features: [
      { at: 1, kind: 'flag', flag: 'RES_FEAR', name: 'Deaf to Fear', desc: 'He cannot be made afraid, by a spell or by a wound. It also means he never gets the warning that running was the right answer.' },
      { at: 10, kind: 'quirk', quirk: 'blood_rage', name: 'Blood in the Eyes', desc: 'At half hit points or less he hits harder and truer -- +10 to hit, +15 damage on every blow -- for as long as he stays hurt.' },
      { at: 25, kind: 'bonus', field: 'blows', amount: 1, name: 'One More Blow', desc: 'One extra blow on every attack, over and above the six his arms already allow.' },
    ], desc: 'Burns the tome on the first day and never learns a ritual. He carries more hit points than a Warrior and gets one more blow than the class allows, and pays for it in slow levelling and hands that fumble every wand.' },
  { id: 'blackguard_blood_knight', cls: 'blackguard', name: 'Blood Knight', hitDie: 5, expPct: 40, maxAttacks: 6, minWeight: 20, stats: { DEX: 2, CON: -1 }, skills: { stealth: 2, search: 6, melee: -5, save: -6 }, skillsGrowth: { melee: -5, bows: -10 }, features: [
      { at: 1, kind: 'quirk', quirk: 'slay_heal', name: 'Red Thirst', desc: 'A monster killed in melee gives back hit points equal to his level. With a hit die this thin, the answer to being hurt is to kill the next thing.' },
      { at: 10, kind: 'flag', flag: 'HOLD_LIFE', name: 'Grip on Life', desc: 'His own life is held too tightly to be taken: experience-draining attacks slide off.' },
      { at: 25, kind: 'bonus', field: 'speed', amount: 2, name: 'Running Red', desc: '+2 speed, permanently. Kills arrive faster, so the healing does too.' },
    ], desc: 'Heals by killing, and by little else. Fewer hit points than a Rogue, and built for light fast blades rather than the tulwar: the run works for as long as the next thing dies quickly.' },
  { id: 'blackguard_black_captain', cls: 'blackguard', name: 'Black Captain', hitDie: 6, maxAttacks: 4, minWeight: 35, firstSpellLevel: 1, stats: { INT: 2, STR: -1, CON: -1 }, skills: { device: 14, save: 10, perception: 6, melee: -10 }, skillsGrowth: { device: 6, save: 5, melee: -10 }, features: [
      { at: 1, kind: 'flag', flag: 'SEE_INVIS', name: 'Wraith-sight', desc: 'He sees what is invisible, from the first level down. Ghosts are a fight he can pick rather than one that picks him.' },
      { at: 10, kind: 'quirk', quirk: 'dread_blow', name: 'Black Breath', desc: 'One melee blow in four sends what it damages fleeing, unless the thing cannot feel fear at all. He breaks a pack rather than killing it.' },
      { at: 25, kind: 'stat', stat: 'INT', amount: 2, name: 'Sorcerer-King', desc: '+2 INT: more mana, and fewer rituals that fail at the worst moment.' },
    ], desc: 'The necromantic half arrives first. Rituals from level one, good saves and a steady hand with a device, bought with hit points, a blow he never gets back, and a poor swing with anything light.' },
  // ---- archer ----
  { id: 'archer_sniper', cls: 'archer', name: 'Sniper', hitDie: 4, expPct: 35, maxAttacks: 2, minWeight: 25, stats: { STR: 1, DEX: 1, CON: -1 }, skills: { bows: 5, perception: 10, search: 8, stealth: 2, melee: -15 }, skillsGrowth: { bows: 10, melee: -15 }, features: [
      { at: 1, kind: 'quirk', quirk: 'steady_aim', name: 'Aimed Shot', desc: 'Spend an action holding still and the next arrow hits twice as hard. Keep moving and you shoot like anyone else.' },
      { at: 10, kind: 'bonus', field: 'toHit', amount: 12, name: 'Windage', desc: 'Every square between you and the target takes something off the shot. You have learned to put it back.' },
      { at: 25, kind: 'bonus', field: 'might', amount: 1, name: 'Heartseeker', desc: 'The bow draws further than it was built to: two more squares of range, and every arrow multiplies harder.' },
    ], desc: 'One arrow at a time, taken slowly. Hold still for an action and the next shot hits twice as hard; move, and it is an ordinary shot. Thin-skinned, slow to level, and next to useless with a blade.' },
  { id: 'archer_skirmisher', cls: 'archer', name: 'Skirmisher', hitDie: 5, expPct: 30, maxAttacks: 5, attackMultiplier: 5, stats: { DEX: 2, CON: -1 }, skills: { melee: 15, stealth: 2, throw: 8, bows: -12 }, skillsGrowth: { melee: 20, bows: -20 }, features: [
      { at: 1, kind: 'quirk', quirk: 'point_blank', name: 'Point Blank', desc: 'You shoot from arm\'s length, where the arrow has no time to drift and the target has none to move.' },
      { at: 10, kind: 'bonus', field: 'speed', amount: 1, name: 'Light Foot', desc: 'Step in, shoot, step back. You act a little sooner than the thing you are shooting at.' },
      { at: 25, kind: 'bonus', field: 'blows', amount: 1, name: 'Bow and Knife', desc: 'One more cut each turn when something closes with you, which at this range it will.' },
    ], desc: 'Fights at knife range with the bow still drawn, and is dangerous there. Quick on its feet, wears nothing heavy, and is a poor shot across a long room.' },
  { id: 'archer_bowyer', cls: 'archer', name: 'Bowyer', hitDie: 8, expPct: 25, maxAttacks: 3, attackMultiplier: 2, stats: { STR: 2, DEX: -1, CON: 1 }, skills: { melee: -20, throw: 10, disarm: 5, stealth: -2 }, skillsGrowth: { melee: -20, bows: 5 }, features: [
      { at: 1, kind: 'quirk', quirk: 'fletcher', name: 'Own Fletching', desc: 'You made these arrows and you can mend them. Nothing you loose is ever lost, so shoot as much as you like.' },
      { at: 10, kind: 'skill', skill: 'bows', amount: 12, name: 'Knows Every Shaft', desc: 'You cut each of these yourself, so you know how each one flies.' },
      { at: 25, kind: 'bonus', field: 'shots', amount: 1, name: 'Deadly Hail', desc: 'One more arrow in the air every turn, on top of everything the class already gives you.' },
    ], desc: 'Cuts and fletches its own shafts, and gets every one of them back. Tough enough to stand and shoot, hopeless with a weapon in hand, and at high level it puts a hail in the air.' },
  // ---- bard ----
  { id: 'bard_harper', cls: 'bard', name: 'Harper', hitDie: 2, expPct: 32, maxAttacks: 4, minWeight: 40, attackMultiplier: 2, stats: { STR: -1, CON: -1, CHR: 1 }, skills: { device: 8, save: 8, perception: 6, melee: -10 }, skillsGrowth: { device: 3, save: 2, melee: -10 }, features: [
      { at: 1, kind: 'skill', skill: 'device', amount: 10, name: 'Lore of Makings', desc: 'Long study of things made. Wands, staves and rods answer you more readily than they answer anyone who did not read the book first.' },
      { at: 10, kind: 'stat', stat: 'CHR', amount: 2, name: 'The Trained Voice', desc: 'Years of practice on the breath. +2 CHR: more mana to spend, and a lower chance of losing a song halfway through the first line.' },
      { at: 25, kind: 'quirk', quirk: 'song_weaving', name: 'Weaving of Themes', desc: 'You can hold two themes at once and pay for both. This is the late trick every bard has heard of and only a Harper ever manages.' },
    ], desc: 'The keeper of the long themes. Frail, slow to swing and expensive to level, but its voice carries further than anyone\'s, it handles a wand better than most mages, and at twenty-fifth level it can hold two songs at once.' },
  { id: 'bard_warchanter', cls: 'bard', name: 'Warchanter', hitDie: 6, expPct: 36, maxAttacks: 5, minWeight: 30, attackMultiplier: 4, firstSpellLevel: 3, stats: { STR: 2, DEX: -1, CON: 1, CHR: -1 }, skills: { melee: 6, bows: -4, device: -6, save: -4, stealth: -2 }, skillsGrowth: { melee: 10, device: -4 }, features: [
      { at: 1, kind: 'skill', skill: 'melee', amount: 10, name: 'Marching Metre', desc: 'You fight in time. +10 fighting skill, and you have never once been caught on the off-beat.' },
      { at: 10, kind: 'bonus', field: 'toDam', amount: 6, name: 'Hewing Rhythm', desc: 'The stroke lands on the stressed syllable and lands harder for it. +6 damage.' },
      { at: 25, kind: 'bonus', field: 'blows', amount: 1, name: 'The Last Charge', desc: 'The verse that is sung at a run, and is not always finished. One extra blow every round.' },
    ], desc: 'The bard who sings from the front rank. Tougher, heavier-handed and much dearer to level, slower to pick up its songs, and no good at all with a wand -- but it keeps the beat with a blade, and by twenty-fifth level it swings an extra time each round.' },
  { id: 'bard_nightingale', cls: 'bard', name: 'Nightingale', hitDie: 2, expPct: 34, maxAttacks: 4, minWeight: 40, attackMultiplier: 2, stats: { STR: -2, DEX: 2, CHR: 1 }, skills: { stealth: 1, perception: 8, search: 6, disarm: 6, melee: -12 }, skillsGrowth: { disarm: 2, melee: -12 }, features: [
      { at: 1, kind: 'skill', skill: 'stealth', amount: 2, name: 'Soft Tread', desc: '+2 stealth. You were taught to cross a hall without breaking the line you were singing.' },
      { at: 10, kind: 'bonus', field: 'speed', amount: 1, name: 'Feet of the Dancer', desc: '+1 speed. The measure you keep is a dancing one, and your feet keep it whether there is anything to dance away from or not.' },
      { at: 25, kind: 'quirk', quirk: 'song_weaving', name: 'Woven Themes', desc: 'You hold two songs at once, paying the upkeep of both. Luthien sang two themes against Sauron and took his tower apart with them.' },
    ], desc: 'The beguiler. Nearly useless with a weapon and made of paper, but quicker than any other bard, unheard in the dark, and the only one whose whole game is what the songs do to the listeners rather than to the singer. It never sings the light songs.' },
];

export const SUBCLASS_BY_ID: Record<string, SubclassDef> = Object.fromEntries(SUBCLASSES.map(s => [s.id, s]));
/** The three subclasses of a class, in birth-screen order. */
export function subclassesOf(cls: string): SubclassDef[] { return SUBCLASSES.filter(s => s.cls === cls); }
