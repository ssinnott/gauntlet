# Feature gaps compared to Angband

A survey of what Gauntlet of Angband does not yet do that Angband does, taken from reading
`src/game/` and the data tables. The baseline is Angband 3.0.x, which the data files say they are
modelled on; a short section at the end covers what 4.2 adds on top of that. Gauntlet-specific
additions (generators, keys, the Gauntlet HUD, auto-pickup) are deliberate departures and are not
listed as gaps.

## Headline numbers

| Area | Gauntlet | Angband 3.0.x |
| --- | --- | --- |
| Monster races | 328 (8 of them generators) | ~550 |
| Uniques | 33 | ~100 |
| Deepest monster | 60 (Ancalagon, the win condition) | 100 (Morgoth), 99 (Sauron) |
| Max dungeon depth | 100 | 127 |
| Object kinds | 409 | ~500 |
| Ego types | 70 | ~130 |
| Artifacts | 18 | 128 |
| Mage books / priest books | 7 / 7 | 9 / 9 |
| Trap kinds | 14 | 16 |
| Dungeon size | 132 x 66 | 198 x 66 |
| Vault templates | none (one procedural inner room) | ~50 lesser and greater vaults |

## 1. Mechanics that exist in the data but do nothing

These are the cheapest wins: the flags, items or spells are already in the tables, so the player
sees them, but the code behind them is a stub.

- **Infravision.** Every race has an `infra` value and there is a Potion of Infravision, a Helm of
  Infravision and a `sinfra` timed effect, but `updateMonsterVisibility` hard-codes the radius to 0
  (`src/game/monster.ts:154`). Warm-blooded monsters in the dark are never shown.
- **Glyph of Warding / Rune of Protection.** The prayer and the scroll set `F.TEMP` on the grid
  (`effects.ts`, case `glyph`) but `tryMove` never checks it, so monsters walk straight over it.
  `F.TEMP` is also the generator's scratch flag, so the mark is not even stable.
- **VORPAL and IMPACT weapon flags.** `playerAttack` has a comment where vorpal chatter and
  earthquake hits would go; IMPACT only shakes the screen.
- **Spikes.** Iron Spikes are sold in the General Store and drop in the dungeon, but there is no
  jam-door command, so they are only good for throwing.
- **RES_SHARDS, RES_NEXUS.** Egos and artifacts carry them, but no monster spell produces shards
  or nexus (`monsterSpells.ts` has no `BR_SHAR`/`BR_NEXU`), so they never matter.
- **Chest locks.** Chests carry a level in `pval` but `openChest` never checks a lock or asks for
  a disarm; every chest opens on the first try, with a one-in-three trap roll on four trap kinds
  (Angband has eight chest trap flags and lock picking).
- **QUIVER_MAX.** Defined as 40 in `constants.ts` but the quiver is hard-coded to eight stacks in
  `addToInventory`.
- **Inscriptions.** Items can be inscribed and the text is shown, but `@` command inscriptions
  (`@q1`, `@f1`, `!*` confirmations) are not parsed.

## 2. Missing player systems

- **Knowledge menus and monster memory.** There is no `~` screen: no per-race kill counts, no
  monster recall on look (`describeGrid` gives a one-line flavour string), no list of known
  objects, artifacts seen, or uniques killed. Angband's monster memory (attacks seen, spells seen,
  resistances learned) is entirely absent.
- **Options and birth options.** No options menu at all. Nothing to toggle for disturb behaviour,
  auto-more, pickup, or the birth options (connected stairs are always on; no ironman, no
  no-selling, no randarts, no persistent levels, no smart monsters).
- **Character creation.** Stats are a fixed `8 + 2d5 + d3` roll with no reroll, autoroller or
  point-buy, and no history/social class text. Race and class pick lists show only the stat mods.
- **Character dump and high scores.** `score()` exists but there is no score board, no character
  dump file, and the death screen has no export.
- **Commands.** Missing from Angband's keyset: `B` bash door (locked doors can only be picked or
  keyed), `j` jam door, `n` repeat, `L` locate/scroll the map, `W` walk without pickup, count
  prefixes (`0` + number), `K`/`k` ignore (squelch) settings, `=` options, `@` macros, keymap
  editing, `V` version. `D` cannot disarm a chest.
- **Stun and cut tiers.** Stun is capped at 35 with two tiers; Angband has heavy stun and
  knock-out (>100). Cuts have three damage tiers but no "mortal wound" that healing potions
  cannot fix.
- **Energy table.** `energyGain` is linear (10 + speed) and caps at +40; Angband's
  `extract_energy` flattens above +20 and behaves differently below 0.
- **Spell lists for the hybrid classes.** Rogue, ranger and paladin reuse the mage/priest tables
  with a flat level x1.4/x1.6 and mana x1.3 multiplier (`spellLevel`, `spellMana`). Angband gives
  each class its own level/mana/fail/exp per spell and its own book access.
- **Banishment.** Picks the race of the nearest visible monster instead of prompting for a symbol.
- **Word of Recall depth.** No prompt to reset the recall depth when recalling from shallower than
  the max depth.
- **Day and night.** The town is always lit; Angband has a day/night cycle that changes what the
  player can see and which townsfolk are about.
- **Save games.** One localStorage slot; no import/export, no savefile of the character on death.

## 3. Content gaps in the data tables

### Monsters

- The bestiary stops at depth 60 while the dungeon goes to 100. Levels 61 to 100 are filled with
  out-of-depth rolls of the existing list. Angband's depth 60 to 100 roster is missing: greater
  wyrms of most colours, greater balrogs, the Nazgul (all nine), Ungoliant, the Mouth of Sauron,
  the Tarrasque, Vecna, Feagwath, Gothmog, Sauron, Morgoth, and so on.
- 33 uniques versus roughly 100. Present: Grip, Fang, Smeagol, Bullroarer, Wormtongue,
  Grishnakh, Lagduf, Boldor, Orfax, Ulfast, Nar, Shagrat, Gorbag, Bolg, Ugluk, Lugdush, Azog,
  Ibun, Khim, Mim, Old Man Willow, Beorn, Ulwarth, Lokkak, Shelob, Bert, Bill, Tom, Kavlax,
  Itangast, Smaug, the Balrog of Moria and Ancalagon. Missing: Farmer Maggot, Golfimbul, Ufthak,
  Angamaite and Sangahyando, Castamir, Vargo, Waldern, Draebor, Medusa, Kharis, Eol, Maeglin,
  Fundin, all nine Ringwraiths (Uvatha through the Witch-King), the Cat Lord, Omarax, Glaurung,
  Huan, Carcharoth, Draugluin, Thuringwethil, Saruman, Lungorthin, Gothmog, Ungoliant, the Mouth
  of Sauron, the Tarrasque, Vecna, Feagwath, Sauron and Morgoth.
- Monster spell list lacks: `BA_MANA`, `BA_CHAO`, `BA_WATE`, `BO_WATE`, `BO_PLAS`, `BO_ICEE`,
  `BR_NEXU`, `BR_TIME`, `BR_INER`, `BR_GRAV`, `BR_SHAR`, `BR_PLAS`, `BR_WALL`, `BR_DISE`, `BR_DISI`,
  `BR_MANA`, `CAUSE_4`, `DRAIN_MANA` is present but stat-draining touch spells are not, and the
  summons `S_HYDRA`, `S_ANGEL`, `S_SPIDER`, `S_HOUND`, `S_HI_UNDEAD`, `S_HI_DRAGON`, `S_HI_DEMON`,
  `S_WRAITH`, `S_UNIQUE`. The `Element` type correspondingly has no shards, time, inertia,
  gravity, plasma, force, ice or disintegration.
- Monster AI: spell choice is random except for a heal/blink preference; `SMART` only widens the
  chase radius. Angband's smart-monster logic (avoiding resisted elements, choosing escapes when
  hurt, `FORCE_SLEEP` cast on the first turn) is not modelled. Monsters never learn the player's
  resistances.
- Only nests are generated; monster pits (the orderly, sorted-by-depth kind) are not, and the nest
  themes are picked by flag rather than Angband's jelly/animal/kobold/orc/troll/giant/dragon/
  demon pit tables with a uniform race per pit.

### Objects

- Artifacts: 18 of 128. Present are the two lights, Sting, Ringil, Anduril, Glamdring, Orcrist,
  Grond, Aeglos, the three Thancs, Thalkettoth, Colluin, Thengel, Barahir, the Dwarves, and
  Bard. Missing are every other weapon (Narthanc's peers aside), all the shields, boots, gloves,
  cloaks other than Colluin, helms other than Thengel, crowns, the rings of Power (Narya, Nenya,
  Vilya, the One Ring), the Elessar, Evenstar, Ingwe, Carlammas and Tulkas amulets, Cubragol and
  the other launchers, Bladeturner, Soulkeeper, Deathwreaker, Doomcaller, Feanor, Dor-Lomin, and
  so on. There is no randart generation either.
- Egos: 70 of about 130. Most positive egos exist. Missing: the `*Slay*` weapon variants that add a
  stat, of Gondolin, of Chaos, cloaks of Irritation, helms of Regeneration and Teleportation and
  the cursed Dullness/Ugliness pair, crowns of Serenity and Night and Day, gloves of Weakness and
  Clumsiness, boots of Slowness/Noise/Annoyance, shields of Preservation, and the ammo `*Slay*`
  set.
- Trap kinds: poison pit, slow dart and blinding gas are absent.
- Object kinds are close to complete for the depths that exist: 47 potions, 42 scrolls, 29
  wands, 25 staffs, 27 rods, 34 rings, 20 amulets, 13 dragon scale mails and the full weapon and
  armour lists are present. The gap is depth rather than breadth: nothing in the table needs a
  monster deeper than 60 to drop it.

### Spells

- Mage: seven books instead of nine. Tenser's Transformations and Kelek's Grimoire of Power are
  absent, so mages have no Detect Evil, Detect Enchantment, Recharge Item III, Mass Banishment,
  Heroism/Berserker/Shield buffs or Globe of Invulnerability.
- Priest: seven books instead of nine. Godly Insights (Detect Monsters, Detection, Perception,
  Probing, Clairvoyance) and Holy Infusions (Unbarring Ways, Recharging, Dispel Curse, Enchant
  Weapon, Enchant Armour, Elemental Brand) are absent.

## 4. Dungeon generation

- No vault templates. The `vault` room kind is a generic inner room with permanent walls, random
  good loot and out-of-depth monsters. Angband's `vault.txt` has around 50 hand-drawn lesser and
  greater vaults with their own layouts, monster placement and treasure grades.
- No greater vaults or "special" level feeling driven by them.
- Room types: simple, overlap, cross, inner, circle, pillars, moat, nest, vault. Angband 3.0's
  large room has five inner-room variants (plain, inner room with a single door, pillars, a maze
  and four small rooms) and there is no `moat` in 3.0; the circle and pillars rooms here stand in
  for them.
- Tunnels: Angband keeps a separate list of tunnel grids and wall-pierce points and adds doors at
  junctions; here doors are placed post hoc by scanning corridors, and secret doors in tunnel
  walls are rare.
- The level is Moria-sized (132x66) rather than 198x66, which halves the room count and makes
  streamers and vaults crowd each other.
- Dungeon depth 100 with a depth-60 bestiary (see above).

## 5. If the target is Angband 4.2 rather than 3.0

Everything above still applies, plus:

- Classes: Necromancer and Blackguard, and 4.2's rewritten class books (each class has its own).
- Rune-based identification (learning a flag once identifies it everywhere) and rune curses with
  their own effects, replacing the flat CURSED/HEAVY_CURSE pair.
- Level types: caverns, labyrinths, Moria-style, lair levels, and the level-profile picker.
- Monster groups with a leader, monster shapechanges, the `hold` and `player innate` mechanics.
- Level feelings that require exploring a share of the level before the object feeling is shown.
- Throwing weapons as a class of item, quiver inscriptions with slots, and item ignoring.
- Persistent levels as a birth option.
- Traps that are visible by default, with `W` to walk into them.

## 6. Suggested order

1. Fix the no-ops in section 1 (infravision, glyph, vorpal/impact, chest locks, jam door, quiver
   size). Each is a small localised change in one file.
2. Extend the bestiary and artifact list to depth 100 so the existing MAX_DEPTH has content, and
   add the missing monster spells and elements it needs.
3. Add a knowledge screen with monster memory; it also gives the look command something to say.
4. Add the four missing spell books and per-class spell tables.
5. Vault templates and pits in the generator.
6. Birth options and an options menu.
