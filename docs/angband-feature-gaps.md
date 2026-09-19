# Feature gaps compared to Angband: status

This started as a survey of what Gauntlet of Angband did not do that Angband 3.0.x does. Most of
it has since been built; this page records what is in, how it maps to Angband, and what is still
out. Gauntlet-specific additions (generators, keys, the Gauntlet HUD, auto-pickup) are deliberate
departures and are not listed as gaps.

## Headline numbers

| Area | Gauntlet now | Angband 3.0.x |
| --- | --- | --- |
| Monster races | MONSTER_COUNT (GENERATOR_COUNT of them generators) | ~550 |
| Uniques | UNIQUE_COUNT | ~100 |
| Deepest monster | 100 (Morgoth), 99 (Sauron) | 100 (Morgoth), 99 (Sauron) |
| Object kinds | OBJECT_COUNT | ~500 |
| Ego types | EGO_COUNT | ~130 |
| Artifacts | ARTIFACT_COUNT | 128 |
| Spell realms / books | 4 realms, BOOK_COUNT books, SPELL_COUNT spells | 2 realms, 18 books |
| Classes / races | 10 / 17 | 6 / 11 |
| Trap kinds | 17 | 16 |
| Vault templates | VAULT_COUNT (lesser + greater) | ~50 |

## Done

### Mechanics that were stubbed and now work
- Infravision from race, gear and potions shows warm-blooded monsters in the dark.
- Glyph of Warding and Rune of Protection stop monsters (they may break it, level against 550).
- Vorpal blades roll extra dice; Impact weapons cause earthquakes on big hits.
- Spikes jam doors (`ctrl+J`); doors can be bashed (`ctrl+B`, or walk into a stuck door).
- Resist Shards and Resist Nexus matter: monsters now breathe shards, nexus, time, inertia,
  gravity, plasma, force, disenchantment, disintegration and mana, and cast water, plasma and ice
  bolts and mana, chaos and water balls.
- Chests have locks (picked with the disarm skill) and eight Angband trap kinds; `D` disarms them.
- The quiver holds its intended number of stacks.
- Inscriptions can be added and removed (`{`, `}`).

### Player systems
- Knowledge browser (`~`): monster memory with Angband-style recall text built from what the hero
  has seen (blows, spells, resistances, drops, kills, deaths), known flavours, artifacts, egos,
  uniques alive and dead, kill counts. Memory persists in the browser across heroes.
- Options menu (`=`) and birth options: connected stairs, ironman, no selling, smart monsters,
  persistent levels; game options for auto-pickup, damage numbers, disturb, confirmations.
- Birth: point-buy (20 points, unspent points become gold) or rolled stats, a short history, race
  and class previews.
- Hall of Heroes (high scores), character dumps (`C` then `F`), save export and import.
- Commands: `Enter` repeats, `ctrl+L` locates, `/` recalls the nearest monster, `,` holds.
- Stun has light, heavy and knocked-out tiers; cuts run from grazes to mortal wounds that do not
  close by themselves.
- Angband's energy table replaces the linear one.
- Rogues, rangers, paladins and blackguards have their own spell tables; Banishment asks for a race;
  Word of Recall asks whether to reset the recall depth.
- The town has a day/night cycle with more townsfolk after dark.

### Content
- Bestiary to depth 100 with the missing uniques including the nine Ringwraiths, Sauron (level 99)
  and Morgoth (level 100), who is now the win condition; Sauron must die before level 100 opens.
- ARTIFACT_COUNT artifacts and EGO_COUNT egos following Angband 3.0's lists, including the rings of
  Power, the One Ring, Morgoth's crown and the cursed egos.
- Mage books 8 and 9 (Tenser's, Kelek's), priest books 8 and 9 (Godly Insights, Holy Infusions),
  five nature books for druids and five necromantic tomes for necromancers and blackguards.
- Four new classes (Druid, Necromancer, Blackguard, Archer) drawn as Gauntlet Legends heroes, and
  six new races (Dark-Elf, Half-Giant, Barbarian, Ent, Beorning, Druadan).
- Hand-drawn lesser and greater vaults in Angband's `vault.txt` glyph language, monster pits with
  sorted themes, and the five inner-room variants of the large room.
- Three deep Gauntlet generators.

## Still out

- Randarts (random artifact sets).
- Monster memory does not learn the player's resistances the way `smart_learn` does; SMART monsters
  simply know them.
- Persistent levels keep monsters and items but do not age them beyond a little healing.
- Angband 4.2 features that were never in scope for 3.0 parity: rune-based identification and rune
  curses, cavern and labyrinth level types, shapechanges, throwing weapons as a class, level
  feelings that need exploration, and the 4.2 class books.
- The 3.0 hybrid spell tables use levels from Angband with mana, fail and exp derived from the level
  rather than copied from the original tables.
