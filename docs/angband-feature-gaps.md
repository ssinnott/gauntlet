# Feature gaps compared to Angband: status

This started as a survey of what Gauntlet of Angband did not do that Angband 3.0.x does. Most of
it has since been built; this page records what is in, how it maps to Angband, and what is still
out. Gauntlet-specific additions (generators, keys, the Gauntlet HUD, auto-pickup) and the smaller
level (132 x 66 and 100 levels deep, against Angband's 198 x 66 and 127) are deliberate departures
and are not listed as gaps.

## Headline numbers

| Area | Gauntlet now | Angband 3.0.x |
| --- | --- | --- |
| Monster races | 510 (11 of them generators) | ~550 |
| Uniques | 77 | ~100 |
| Deepest monster | 100 (Morgoth), 99 (Sauron) | 100 (Morgoth), 99 (Sauron) |
| Object kinds | 430 | ~500 |
| Ego types | 112 | ~130 |
| Artifacts | 121, fixed or rolled fresh per hero | 128 (randarts optional) |
| Spell realms / books | 4 realms, 28 books, 176 spells | 2 realms, 18 books |
| Classes / races | 10 / 17 | 6 / 11 |
| Trap kinds | 17 | 16 |
| Vault templates | 33 (lesser + greater) | ~50 |
| Level types | 3: rooms and corridors, cavern, labyrinth | 1 (3.0); caverns and labyrinths arrived in 4.2 |
| Birth options | 6 | 8 |

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
- Inscriptions can be added and removed (`{`, `}`), and Angband's command inscriptions are honoured:
  `@q1` answers `1` at the quaff prompt (likewise `@r`, `@E`, `@a`, `@u`, `@z`, `@f`, `@v`, `@w`, `@t`,
  `@d`, `@k`, `@A`, `@F` and `@s` in a store), `!q` asks before quaffing, `!s` before selling and `!*`
  before anything.
- Swinging an unidentified weapon eventually tells you something about it, as the periodic
  pseudo-identification does for everything else carried.

### Player systems
- Knowledge browser (`~`): monster memory with Angband-style recall text built from what the hero
  has seen (blows, spells, resistances, drops, kills, deaths), known flavours, artifacts, egos,
  uniques alive and dead, kill counts. Memory persists in the browser across heroes.
- Options menu (`=`) and birth options: connected stairs, ironman, no selling, smart monsters,
  persistent levels, random artifacts; game options for auto-pickup, damage numbers, disturb,
  confirmations, sound, the narrator, touch controls and ignoring junk.
- Birth: point-buy (20 points, unspent points become gold) or rolled stats, a short history, race
  and class previews.
- Hall of Heroes (high scores), character dumps (`C` then `F`), save export and import.
- Commands: `Enter` repeats, `ctrl+L` locates, `/` recalls the nearest monster, `,` holds.
- Stun has light, heavy and knocked-out tiers; cuts run from grazes to mortal wounds that do not
  close by themselves.
- Angband's energy table replaces the linear one.
- Level feelings follow Angband 3.0's: the vaults' ratings, out-of-depth monsters and good objects
  against Angband's thresholds, and a vault at shallow depth or an artifact on the floor makes the
  level "special". `ctrl+F` repeats the feeling.
- Rogues, rangers, paladins and blackguards have their own spell tables; Banishment asks for a race;
  Word of Recall asks whether to reset the recall depth.
- The town has a day/night cycle with more townsfolk after dark.
- **Ignore settings** (Angband's squelch), which matter more here than in Angband because
  auto-pickup is on by default. A quality threshold per equipment group (`O`), from "keep
  everything" to "leave everything but artifacts", judged on what the hero actually knows: nothing
  unidentified is ever ignored, and artifacts never are. Consumables are ignored kind by kind once
  their flavour is known. Ignored items are not picked up and not drawn; `ctrl+O` reveals them
  again, and an item inscribed `=g` is always picked up.
- **Randarts.** The `randarts` birth option rolls a fresh set of 121 artifacts from the game seed,
  on the same base objects and at the same depths as the famous ones, with abilities bought out of
  a power budget that grows with depth (so a shallow relic cannot arrive with four immunities and
  speed), generated names, rolled activations and the occasional cursed one. The set is derived
  from the seed alone, so a save reproduces it exactly.

### Monsters
- **Sound and scent.** Monsters that cannot see the hero hunt by hearing and by smell instead of
  beelining through walls or milling about. The noise field is a weighted search where a closed
  door muffles a shout, and the hero's stealth shrinks every monster's hearing at once, so stealth
  finally matters while things are awake and not only while they are asleep. Animals follow a
  decaying scent trail instead, so a hound comes round the corner the hero went round.
- **Pack tactics.** Monsters with FRIENDS close by the shortest route, but where two grids are
  equally close they take the one further from the rest of the pack. So a pack arrives spread
  around the hero instead of queued up in the corridor behind its leader, and it always arrives:
  an earlier version scored holding station above closing, and packs circled a resting hero
  forever without landing a blow.
- **smart_learn.** SMART monsters used to read the hero's equipment, which is omniscience rather
  than cunning. They now learn: an attack that is resisted, an effect a defence refuses and a
  saving throw that succeeds all teach the attacking race something, and it stops spending turns on
  what it has watched fail. The `smartMonsters` birth option means every monster learns rather than
  every monster knows. What a race has worked out shows in its recall entry, and it dies with the
  hero rather than joining the browser-wide monster memory.
- **Three-tier generators.** The Gauntlet generators come apart as they are smashed, through three
  stages visible in the sprite. An intact one spawns fast and reaches deeper into its family
  (themed by depth, not one fixed race); a broken one dribbles out the basic thing it is named for.

### Content and levels
- Bestiary to depth 100 with the missing uniques including the nine Ringwraiths, Sauron (level 99)
  and Morgoth (level 100), who is now the win condition; Sauron must die before level 100 opens.
- 121 artifacts and 112 egos following Angband 3.0's lists, including the rings of
  Power, the One Ring, Morgoth's crown and the cursed egos.
- Mage books 8 and 9 (Tenser's, Kelek's), priest books 8 and 9 (Godly Insights, Holy Infusions),
  five nature books for druids and five necromantic tomes for necromancers and blackguards.
- Four new classes (Druid, Necromancer, Blackguard, Archer) drawn as Gauntlet Legends heroes, and
  six new races (Dark-Elf, Half-Giant, Barbarian, Ent, Beorning, Druadan).
- Hand-drawn lesser and greater vaults in Angband's `vault.txt` glyph language, monster pits with
  sorted themes, and the five inner-room variants of the large room.
- Three deep Gauntlet generators.
- **Caverns and labyrinths.** Two whole-level generators beside the classic one, chosen by depth.
  A cavern is grown by a cellular automaton and then reduced to its largest cave, which is what
  guarantees it is connected without a tunnelling step; it is several times the open ground of a
  normal level and is stocked to match. A labyrinth is a randomised depth-first maze with some
  walls knocked through for loops, doors across passages, and light only at shallow depths.
- **Persistent levels that live while you are away.** The option used to heal the monsters you left
  and nothing more. A level now catches up for the time you were gone: monsters wander off from
  where you left them, wandering monsters arrive, breeders breed, thieves pocket what they are
  standing on, and above all the generators keep generating. The whole catch-up is capped and
  driven by the seeded rng, so a fifty-thousand-turn absence costs no more than a short one.

### Presentation and platform
- **Arcade sound and the narrator.** Every sound is synthesised on the spot from oscillators and
  filtered noise, so there are no asset files and the game still builds to one self-contained HTML
  file. The shouted banners are spoken by the browser's speech synthesis, pitched down to the
  arcade voice: WARRIOR NEEDS FOOD BADLY. Both have game options, both degrade silently where the
  browser will not play along, and the game logic only ever queues string ids so `src/game/` stays
  free of the DOM.
- **Touch controls.** A thumb pad and three pages of command buttons, appearing by themselves on
  the first touch and forceable with an option. With an overlay open the layer becomes a navigation
  bar instead, which is what makes the keyboard-driven menus, inventory and stores usable by touch
  without rewriting a screen. Every button synthesises the key press the keyboard would have sent,
  so a button can never drift out of step with the command.
- **Saves in IndexedDB, with slots.** The whole game used to live in one localStorage key, a ~5 MB
  string quota for the origin that a deep run with persistent levels can reach, failing silently.
  Saves now go to IndexedDB under several named slots, listed on the title screen with race, class,
  level, depth and when they were last played, and a save from the old single key is migrated into
  a slot on first run. A failed save is reported rather than swallowed, and falls back to
  localStorage.
- **A determinism test.** The README has always claimed that every roll goes through the seeded rng
  so a seed reproduces a run, and nothing checked it. `tools/sim.ts` now plays a fixed script from
  a fixed seed twice and requires the two saves to be identical byte for byte, then does it again
  across a save and restore to prove the round trip does not perturb what comes next. It found a
  real bug on its first run: the message log's turn counter was not saved, so duplicate-collapsing
  resumed on a different boundary after loading.

## Still out

- Count prefixes (`0` and a number), macros and keymap editing.
- Walking without pickup as a separate command (auto-pickup and the ignore settings cover it
  between them).
- Angband 4.2 features that were never in scope for 3.0 parity: rune-based identification and rune
  curses, shapechanges, throwing weapons as a class, level feelings that need exploration, and the
  4.2 class books.
- The 3.0 hybrid spell tables use levels from Angband with mana, fail and exp derived from the level
  rather than copied from the original tables.
- Co-operative play. The vendored engine ships a deterministic lockstep scheduler and a WebRTC peer
  link in `src/lib/net/`, and the game does not use either yet. The determinism test above is the
  groundwork.
