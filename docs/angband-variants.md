# Angband variants: what each one changes

Angband has been forked more often than almost any other game, and the forks are called *variants*,
or "\*bands". This page is a survey of them and a record of what each one actually changes.

The useful question here is not which variant is best. It is which problem each one decided Angband
had, and what it built instead -- because `docs/angband-feature-gaps.md` measures this game against
Angband 3.0.x, and the variants are thirty years of other people answering the same question.

**On the numbers.** Where a count appears below it was read out of that variant's own source and data
files (`defines.h`, `d_info.txt`, `lib/edit/*.txt`, `lib/help/*`, `docs/*.rst`) rather than out of a
wiki. The shipped help files in this family are systematically stale: Hengband's says twenty-seven
classes while listing twenty-eight, and Frogcomposband's says "about thirty" fixed dungeons while its
data file defines forty-three. Counts that no source states are marked *not confirmed* rather than
guessed. Most entity counts are taken at each repository's current HEAD, so they may differ by a few
entries from a specific tagged release.

## Why there are so many

Three things made Angband unusually forkable. It was distributed as source from the start. Its
content lives in editable text data files rather than in code, so a total conversion needs no
compiler. And its core loop is strong enough to survive almost any amount of tampering. Ben
Harrison's work on versions 2.7.0 to 2.8.5 is the specific cause: he added the `z-term` display
abstraction and the `*_info.txt` data-file architecture, and the variant explosion followed
immediately.

The result is a family tree about thirty-five years deep whose branches disagree about nearly
everything except the shape of a turn.

## The family tree

```
Moria (Koeneke, 1983) -> Umoria (Wilson, 1988) -> Angband 1.0 (Warwick, 1990)
  |
  +- 2.7.9 -> MAngband -> PernMAngband -> TomeNET
  |              +-> PWMAngband -> Tangaria
  +- 2.8.1 -> ZAngband -+-> PernAngband -> ToME 2       (ToME 4 is a clean break)
  |              |      +-> Cthangband -> Hellband
  |              +-> ZAngband 2.2.8J -> Hengband -+-> Chengband -> PosChengband
  |                                               |      -> Composband -> Frogcomposband -> Oposband
  |                                               +-> Entroband
  +- 2.8.3 -> Oangband -> FAangband (v1)
  +- 2.9.x -> Sangband
  +- 2.9.1 -> EyAngband -> FayAngband -> Halls of Mist
  |              +----------- quest system -----------+
  +- 2.9.3 -> Steamband -> Starband                   |
  +- 2.9.3 -> Animeband                               |
  +- 2.9/3.0 -> UnAngband                             |
  +- 3.0.3 -> NPPAngband <----------------------------+
  |              +- NPPMoria mode (UMoria 5.5.2)
  |              +- Ironband, Quickband
  |              +- 0.4.1 -> Sil -> Sil-Q -> Sil-More
  |                            +-> NarSil (Sil rebuilt on Angband 4.2) -> Beleriand
  +- mainline 3.1.1 -> 3.3.0 -> 4.1.0 -> 4.2.x  [active]
                                           +-> FAangband v2 (rebuilt on 4.2)  [active]
```

## What Angband added to Moria

Worth stating once, because several variants are attempts to walk it back.

Moria gave the family the template: a town with shops above a single dungeon, random levels
regenerated on each visit, food and light clocks, unidentified potions and scrolls, six classes and
eight races. Umoria 5.7.15 has 279 creature types and 420 object types, no unique monsters and no
artifacts, and the Balrog appears below 2450 feet as the win condition.

In 1990 Alex Cutler and Andy Astrand, with other students at Warwick, built Angband 1.0 on Umoria
5.2.1. Angband's own `docs/version.rst` says the goal was to expand the game while strengthening the
grounding in Tolkien, and the specific additions were **unique monsters, artifacts, activation,
pseudo-sensing, level feelings and special dungeon rooms**. Later maintainers deepened the dungeon to
a hundred levels with Morgoth at the bottom and added ego items and random artifacts.

Almost everything that makes this game recognisably Angband rather than Moria is on that list.

## The four arguments

Nearly every variant is an argument about one of four things.

**The character model.** Vanilla gives you a class and an experience level. Sangband deletes both and
sells skills for raw experience. Oangband keeps classes and adds specialty abilities. Sil replaces
the whole thing with eight skills and an ability tree. Frogcomposband multiplies the axes instead, so
race, class, subclass, personality and magic realm are five independent choices. Ironband removes
classes entirely and lets the build emerge from what you find.

**The shape of the world.** Vanilla is one town on one dungeon. ZAngband invented the alternative in
the nineties, a random wilderness overworld holding several towns and several dungeons, and every
variant in its line inherited it. FAangband gives each playable race its own home town. UnAngband
replaces the dungeon with a journey through seventy-three named places from the War of the Ring.
Quickband compresses the arc to twelve levels; Ironband deletes the town and starts you underground.

**The scale of the content.** This is where the family splits hardest, and the spread is two orders of
magnitude. UnAngband has 1351 monsters and 1001 terrain types. Frogcomposband has around 1300
monsters across 43 dungeons with 18 magic realms. Sil has 142 monsters and no magic at all, and is
widely held to be the best-designed game in the family.

**The resource economy.** Vanilla assumes shops, stair-scumming and a deep supply of consumables. Sil
removes shopping entirely, makes light a graded resource and makes every point of experience a
purchase decision. Halls of Mist makes diving compulsory with a rising minimum depth. Ironband bans
the up staircase.

## At a glance

Counts are from each project's data files. Dashes mean the concept does not apply.

| Variant | Monsters | Object kinds | Artifacts | Races | Classes | Depth | Status 2026 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Umoria 5.7.15 | 279 | 420 | 0 | 8 | 6 | 2450 ft | Preserved |
| Angband 4.2.6 | 624 | 375 | 138 | 11 | 9 | 100 levels | **Active** |
| Gauntlet of Angband | 510 | 430 | 121 | 17 | 10 | 100 levels | this repo |
| Sil 1.1 | 142 | 193 | 106 | 4 (11 houses) | none | 1000 ft | Dead (2016) |
| Sil-Q 1.5 | 153 | 196 | 122 | 4 (11 houses) | none | 1000 ft | **Active** |
| Halls of Mist 1.3.2 | 552 | 481 | 138 | 11 | 13 | 48 levels | Dead (2013) |
| UnAngband 0.7.0-pre1 | 1351 | 971 | 136 | 37 | 13 | 128 | Low activity |
| ToME 2.3.5 | 1077 | 675 | 201 | 22 + 10 mods | 6 base, 33 sub | 28 dungeons | Fork alive |
| Frogcomposband 7.1 | ~1300 | not confirmed | not confirmed | 74 slots | 53 | 43 dungeons | Dormant |
| TomeNET 4.9.4 | 1150 | 820 | 255 | not confirmed | ~17 | 5000 ft | **Active** |
| MAngband 1.5.3 | 617 | 472 | 136 | 11 | 6 | 128 | Dormant |

## The mainline, and what it did after 3.0

Angband 4.2.6 is the current stable release, from December 2025, and master publishes an automatic
pre-release roughly weekly. Nick McConnell maintains it.

A common error, worth correcting because it affects what "parity" means here: **several features
usually attributed to 4.2 landed years earlier.** Identification by use arrived in 3.1.1. Caverns and
labyrinths, the dungeon generation overhaul, and the split of level feelings into danger and reward
all arrived in **3.3.0 in 2011**. Rune-based identification, the rewrite of curses as runes with
multiple curses per item, the removal of active searching, and Moria levels all arrived in **4.1.0**.

What 4.2.0 itself changed:

- **Two new magic realms**, nature and shadow, joining arcane and divine, with nature opposed to
  arcane and divine opposed to shadow.
- **Three new classes.** Druid casts from nature. Necromancer casts from shadow, sees in the dark,
  casts worse in light, and can take control of a monster. Blackguard is a fighter with a bloodlust
  state that improves combat at a price.
- **Books cut from nine to five** for pure casters, and **all classes now gain experience at the same
  rate**.
- **The monster list re-themed on Tolkien.** Ainur aligned to the Valar, dragons strengthened and
  pushed deeper, dark elves replaced by dwarves, gnomes by Druedain, Trees and Ents added, Wights
  made shallower than wraiths and Ringwraiths much deeper.
- **Monster AI.** Separate frequencies for innate and cast spells, variable monster spell levels,
  group monsters get leaders and bodyguards, monsters can teleport to the player, spiders weave
  webs, monsters emit innate darkness, Ringwraiths carry the Black Breath, and shallow monsters stop
  appearing deep.
- **Shapechange** for the player and for monsters. While shifted you cannot reach the pack or quiver,
  or activate equipment.
- **Graded light and darkness** with a player light meter.
- Mages drain mana from devices, rogues steal from monsters, rangers deploy decoys, warriors and
  paladins and blackguards get shield bashes, food matters more, and the Temple is replaced by a
  Bookseller.

Throwing came later still: improvements in 4.2.1 and throwing weapons in the quiver in 4.2.2.

4.2.6 itself is mostly polish worth noting because it is quality-of-life we could copy directly:
device activation retries automatically the way digging does, pathfinding opens doors and clears
rubble on its way and keeps going through known ground, object descriptions show curse effects in
the displayed stats, and detection messages distinguish gold from other floor objects.

## The tactical refiners

These keep vanilla's shape and rebuild its combat or its character model.

**Oangband** (Leon Marrick, then Bahman Rabii; from Angband 2.8.3; last release 2006; dead) is the
combat variant. Its damage pipeline is genuinely different from vanilla's: critical hits add between
two and five **extra damage dice**; brands and slays multiply the **average of each die** rather than
the total, so a fire brand is 1.7 per die plus a flat 7; and a **Deadliness** percentage then scales
the per-die average, reaching about +200% at high level. Blows come from weapon weight, dexterity and
strength alone, one to six of them, and an over-heavy weapon drops you to one. It had shield bashes
about fifteen years before vanilla did, gives throwing a multiplier from double to sextuple (up to
twelvefold for perfectly balanced weapons), and adds **specialty abilities** chosen at levels one,
twenty and forty. Its elemental resistance is incremental rather than binary. Its levels carry
rubble, water that blocks the heavily burdened, lava that damages and blocks non-fiery monsters,
and trees that block sight and slow anyone who is not a druid.

**Sangband** (Leon Marrick; final release 2007; dead upstream) is the skills variant, and the most
radical character model in the Tolkien half of the family. **There are no classes and no character
levels.** You spend raw experience at a skills screen on about twenty skills, from Swordsmanship and
Karate to Alchemy and Shapechange. Skills you have not used cost more; related skills discount each
other, so raising Swordsmanship halves the cost of Jousting. Classes are replaced by **oaths**,
permanent commitments such as the Oath of Iron, which grants weapon mastery and hit points and
forbids magic forever. Spells are not memorised: each of four realms has seven books, three sold and
four found only in the dungeon, and a spell is simply available once your skill and mana suffice.
Characters can **forge their own weapons, armour and potions**. There is a weather system with wind,
temperature and humidity that helps or hinders particular druid spells. Its 4GAI monster AI was good
enough that NPPAngband imported it wholesale.

**NPPAngband** ("No Pet Peeves"; Jeff Greene and Diego Gonzalez; from Angband 3.0.3; dead, contact
with its author lost) is the quest variant, and the most directly relevant to this repo because it
shares our 3.0.3 baseline. It took **EyAngband's Adventurer's Guild quests** and built a game around
them, with quest types for unique monsters, themed levels, pits and nests, vaults, wilderness, arenas
and labyrinths, gated by a persistent **Fame** stat that decides which quests you are offered and how
good the rewards are. It has dynamic terrain and "effects", dungeon events that persist for more than
one turn, borrowed from UnAngband. And it ships **NPPMoria**, a faithful reimplementation of Moria
5.5.2 inside the same binary, selected before the data files load.

**FAangband** (Nick McConnell, who also maintains vanilla) is the world variant, and one of the two
healthiest projects in the family. It forked from Oangband 0.7.0, reached 1.4.4 in 2014, and was
**rewritten from scratch in 2020 on the Angband 4.2 codebase**, with version 2 released in 2021 and
active development through 2026. It is set in the **late First Age**, with anachronisms deliberately
removed, so there are no Rings of Power, no Saruman and no Witch-King. Its world is the point: a
wilderness overworld with five terrain types, **a town for each of the thirteen playable races**,
several dungeons each with a guardian at the bottom, and a Word of Recall that offers a choice of up
to four recall points. It inherits Oangband's specialty abilities, thirty-three of them, and in the
classic design the second and third unlock **by killing dungeon guardians rather than by gaining
levels**. It offers four map modes, including a plain Angband-style one for players who want the
overworld gone.

**EyAngband** (Eytan Zweig; final release around 2003; dead) matters mostly as an ancestor. It
invented the **Adventurer's Guild and random quests**, which NPPAngband's changelog still calls
"EYAngband-style quests", and a batch of quality-of-life ideas including rod stacking, ego lanterns
and monsters that carry their own light sources.

**Ironband and Quickband** (both by Antoine, both built on NPPAngband, both dead) are the two
austerity experiments. Ironband is enforced ironman: **you can never go up stairs, you start in the
dungeon, and there is no town and no shopping ever.** It has no classes; every character can fight,
shoot, sneak and cast, and the build emerges from what you find. Fifty levels, and the Witch-King of
Angmar at the bottom. Quickband goes the other way and compresses Angband to something winnable in an
afternoon: **twelve levels, with Saruman of Many Colours at the end.**

## The kitchen sink

The other half of the family went maximal.

**ZAngband** (Topi Ylinen, from Angband 2.8.1, 1994; dead since 2005) is the ancestor of more
variants than anything else in this tree. It set Angband inside Roger Zelazny's *Amber*, replacing
Sauron with Oberon and Morgoth with the **Serpent of Chaos**, and, crucially, **invented the random
wilderness overworld** holding multiple towns and multiple dungeons. Its 2.2.8 source defines thirty
races, eleven classes and seven magic realms, a realm system its authors credit to *Master of Magic*.

**Hengband** forked the Japanese 2.2.8 line and is, remarkably, **the single most actively developed
variant in the entire family**, with commits dated the same week this page was written and nearly
22,000 in total. It layers Japanese fiction references over the Amber substrate, and it invented the
**personality system** that every descendant inherits. It has weapon proficiencies, two-weapon
fighting, monster riding, mutations, pets, an arena, gambling houses, random quests on ten fixed
dungeon levels that you choose between at birth, nine-tier level feelings, and **saved floors**, which
is persistent levels. Thirty-seven races, twelve personalities, and Oberon at 99 before the Serpent of
Chaos at 100.

**PosChengband** (Chris, 2012) merged the Hengband line with Posband, and that is where **playing as a
monster** enters: possessors, mimics, dragons, liches, rings and animated swords. It also introduced
**subclasses**, so a Warlock chooses a pact and a Weaponmaster chooses a weapon group. Its source
defines sixty-two races, forty-five classes and seventeen realms.

**Frogcomposband** (sulkasormi, via Gwarl's Composband) is the end of that road and the largest
character builder in roguelikes. From its source: **74 race slots** (47 ordinary races plus 27 monster
races), with sub-races on top of that including fourteen dragons and thirteen demigods; **53 classes**
with subclasses beneath them, eight Warlock pacts and eleven Weaponmaster groups; **21 personalities**;
and **18 magic realms**, twelve "magic" and six "technic", each with exactly four books of eight
spells. Its dungeon file defines **43 dungeons**, about 39 of them fixed and named, running from
Camelot and Mount Olympus to R'lyeh, Asgard and the Plains of Oz, and **nearly every one has a
guardian whose death grants a free stat increase**. Around 1300 monsters. Pets gain experience and
**evolve into stronger monsters**, cost mana upkeep, and can be caught with Capture Balls; riding
needs a free hand for the reins. It offers a coffee-break mode that removes up-staircases entirely.
It is also deliberately funny, with a Ninja-Lawyer class and releases named after sweets. Its last
release was mid-2024 and it is now dormant, but it is still one of the most-played variants.

## Total conversions

The data-file architecture makes a complete reskin possible without touching the engine, and people
took the invitation.

**Steamband** (Courtney Campbell; from Angband 2.9.3; dead since 2007) is the most thorough. Victorian
steampunk, a journey to the centre of the Earth, **none of Angband's original content**, a skill
system instead of pure classes, guns as a central weapon class, and equipment slots for tonics,
mechanisms, headwear and trousers. Its races are nationalities alongside Automata, Steam-Mecha,
Djinn and Old Ones. Its sci-fi descendant is Starband.

Others worth a line each: **Gumband** puts you in Michael Moorcock's Eternal Champion multiverse and
wins by killing three Sword Rulers. **Cthangband** grafts the Cthulhu Mythos onto ZAngband, and
**Hellband** takes that line down into Dante's Inferno. **Xygos** converts Angband to
post-apocalyptic science fiction with guns and tech. **Animeband** replaces every race and class with
anime and videogame references, and adds vehicles that kill you if they are destroyed while you are
inside. **Portralis** reworks progression so heavily it is barely a \*band. **Utumno** was an attempt
at a real-time isometric Angband, playable but never finished. **DrAngband** lets you play dragons,
who wear extra rings but no weapons or armour beyond cloaks and crowns. **Angband/64** had persistent
levels, multi-level vaults, an ammo slot and true two-handed weapons in the nineties.

## The austere branch

The most respected redesign in the family went the opposite way from the kitchen sink.

**Sil** (Toby Ord and Owen Cotton-Barratt, forked from NPPAngband 0.4.1, 2012 to 2016) is small, and
that is the design. You infiltrate Angband to cut a Silmaril from Morgoth's crown.

- **No classes and no experience levels.** Eight skills -- Melee, Archery, Evasion, Stealth,
  Perception, Will, Smithing, Song -- and an ability tree under each. You begin with 5000 experience
  and spend it: the *n*-th point of a skill costs 100*n*, the *n*-th ability in a tree costs 500*n*.
  You earn experience for **first encountering** a monster as well as for killing it, and for
  reaching a new depth.
- **One opposed roll per attack.** Melee skill plus 1d20 against evasion plus 1d20. Damage is a
  second opposed roll, your damage dice against the sum of the defender's **protection dice**, and
  only the difference lands. Strength adds sides to your dice, slays add dice. **Criticals** need you
  to beat evasion by seven plus one per pound of weapon weight, and grant an extra die per multiple
  of that margin, so light weapons crit far more often.
- **Stealth is a per-turn contest**, your stealth plus 1d10 against each monster's perception plus
  1d10, with modifiers for distance, closed doors, armour weight and whether you attacked. Monsters
  are asleep, unwary or alert on a numeric alertness scale.
- **Light is a separate graded system**, not a stealth modifier. Resistance to darkness simply means
  having enough light on your square.
- **Song** is a skill with twelve songs, powered by a Voice pool that drains while you sing, and an
  ability to weave two songs at once.
- **Smithing.** Forges in the dungeon have finite uses and let you make weapons, armour, jewellery
  and lights, including **your own artefacts**. It costs game time, makes noise, and the strongest
  enchantments cost permanent experience.
- **No town, no shops, no word of recall, no teleport and no attack magic.** A rising minimum depth
  cuts you off from shallower levels as you descend.
- **A thousand feet deep, and the win condition is a heist**: take a Silmaril and **escape alive**.
  You never have to kill Morgoth. A winning game is meant to take about ten hours.

**Sil-Q** is the maintained continuation, forked after Sil stopped in 2016, and it is under active
development in 2026. It is explicitly a rebalance, aiming to make every item and skill useful
somewhere, and among other things it makes blunt damage partly ignore armour, boosts early stealth
and decays it with depth, turns every staircase into a shaft during the escape, and makes Morgoth
angrier as you wound him.

**NarSil** is Nick McConnell's rewrite of Sil on the modern Angband 4.2 codebase, also active. It
keeps the design and changes two things: identification becomes Angband's rune system, and knowledge
of the map and objects follows Angband's model. Its `docs/` tree is the clearest written statement of
Sil's rules anywhere. **Sil-More** is a further fork adding First Age heroes, Valar-given quests,
oaths that curse your other heroes if broken, and **metaruns that link consecutive games**.

**Halls of Mist** (Mikko Lehtinen, 2012 to 2013; dead) is not a Sil fork -- it descends from
EyAngband by way of FayAngband -- but it belongs here for its austerity. It drops Tolkien for an
original world, Thornwild, with the Thin White Duke at the bottom of 48 levels. Its ten skills split
into five that every class raises and five that exactly one class does, and **almost every check is a
literal 1d100 rolled under a displayed percentage**, which makes the whole game legible. Its signature
is the staircase rule: up-stairs always return you to town, down-stairs drop you near your maximum
depth, and a **minimum depth counter rises every time you descend, so if it passes 48 you lose**.
Diving fast multiplies your score. Its dungeon furniture -- altars, tables, magic circles,
bookshelves, warding runes, trees and fountains -- all does something.

## The simulationist

**UnAngband** (Andrew Doull, from the 2.9/3.0 line, now maintained at low activity by others) went
further into simulation than anyone. It replaces the single dungeon with a **narrative journey
through 73 named regions** following the War of the Ring, from Hobbiton through the Barrow-downs,
Weathertop, Moria and Isengard to Orodruin, with places changing state as the story advances so that
Hobbiton appears intact, ruined and rebuilt. Levels are generated from **ecologies**, and terrain is
simulated: fire spreads, water flows, plants burn. Its data files hold **1351 monsters, 971 object
kinds, 1001 terrain types and 640 spells**. Bards sing from song books that keep singing while you act.
The 0.7.0 quest system includes carrying the One Ring into Orodruin.

## Leaving Angband behind

**ToME 2**, which began as PernAngband in 1998 on ZAngband 2.2.0 and was renamed after legal pressure
from Anne McCaffrey's estate, was the most played variant of the 2000s. It has a **skill tree of 58
skills** spent on top of Angband levels and classes, **six base classes with 33 subclasses**, **five
gods** with piety and grace, Lua-scripted content, corruptions, a fate system and a long scripted
quest chain across 28 dungeons. Killing Morgoth wins; destroying the One Ring in Mount Doom is the
better ending.

**ToME 4, Tales of Maj'Eyal**, is the clean break. DarkGod rewrote it from scratch in 2009, and it
**shares no Angband code at all**: it is Lua modules on the purpose-built T-Engine 4. It abandons
Middle-earth for its own world, replaces spell memorisation with **talent trees, cooldowns and
several resource pools**, and replaces the hundred-level dungeon with a world map of authored zones
and quests. It is the family's commercial breakout, sold on Steam, and most of its players have no
idea it is an Angband variant.

## Multiplayer

**MAngband** (Keldon Jones, 1997) split Angband 2.7.9 into a client and a server and is the root of
the multiplayer branch. It supports up to a thousand simultaneous players in a shared persistent
world with a wilderness overworld, parties, player-owned houses, and declared hostility for PvP. Its
core is still recognisably 2.7.9. It is dormant, last released in 2020.

**PWMAngband** is its actively maintained successor and tracks modern Angband 4.2.x. **Tangaria**
builds on PWMAngband into a persistent MMO-roguelike with houses, shops, PvP and 56 races.

**TomeNET** began in 2001 as PernMAngband, MAngband with ToME's design grafted on, and is the
longest-running persistent online world in the family -- **still actively developed in 2026**, with
servers in Europe, Asia-Pacific and North America. Its data files hold 1150 monsters, 820 object
kinds, 255 artifacts and 29 dungeons. The level cap is 50, and **killing Morgoth raises it to 99** and
lets you wear his crown and wield his hammer.

## Where the scene is in 2026

The centre of gravity has moved. **angband.live** now hosts the Angband Forums and the character
ladder that used to live at oook.cz, alongside a browser-playable server. Tangar's table at
tangaria.com tracks roughly 150 variants and is probably the best current list. RogueBasin holds the
prose descriptions and is largely historical now. **AngbandPlus** on GitHub is a single repository
with about 143 branches, one per variant, and is an archive rather than a live host.

Actively developed, verified by commit dates in September 2026: **Angband mainline, Hengband, Sil-Q,
Sil-More, NarSil, FAangband, PWMAngband, Tangaria, TomeNET, ToME-SX, AngbandOS** and the TypeScript
port discussed below.

Dormant but still played: **Frogcomposband** (last release mid-2024), Composband, Oposband, MAngband,
Xygos.

Dead but still distributed: PosChengband, Sil 1.3, NPPAngband, Oangband, Sangband, Steamband, ToME 2
upstream, Zangband, Entroband, Chengband, Halls of Mist, Quickband, Ironband, EyAngband, Hellband,
TinyAngband. The community's own summary is that no Z-derived variant is actively maintained, though
their last versions are perfectly playable -- with the striking exception of Hengband itself.

## Browser ports, which is the part that concerns us

Four architectures exist for putting Angband in a browser, and they are worth knowing because this
project is a fifth.

**neo-angband** is the closest prior art to what this repository does: a **full TypeScript rewrite**
of Angband, pinned to 4.2.6 as its parity baseline, with roughly 13,500 commits and near-daily
releases through September 2026. Its architecture is a headless core engine with web, PWA, terminal
and Electron front ends. Two of its practices are directly worth copying. It keeps the **original C
source in the repository for reference** and maintains a **provenance ledger mapping each ported
module to its upstream C file**, and it uses **automated statistical testing to verify feature
parity** rather than eyeballing it. It also has a mod system and an AI autoplayer.

**shelob** compiles Angband 3.4.1 to WebAssembly with Emscripten and runs at ang.band. Its structure
is clean even though it has been unmaintained since 2021: **WASM in a web worker** exchanging messages
with the render thread, the **save file backed by IndexedDB**, the map drawn as an HTML table with CSS
sprite maps, and the whole thing deployed to GitHub Pages as static assets with **no server at all**.

**angband-webclient** is what angband.live runs, and it is the opposite approach: Node.js attaching
real compiled `main-gcu` processes to a browser terminal emulator. Saves live on the server and are
deliberately not downloadable, to prevent save-scumming. Its notes are a useful warning for any
browser roguelike: **some keys are simply unusable because the browser intercepts them**, Ctrl+T among
them.

**AngbandOS** is a C# and .NET rewrite played over HTTP with Angular and SignalR, descended from a
refactored Cthangband. **Webband** boots several roguelikes inside a v86 virtual machine rendered with
xterm.js. **mangclient-js** is a React and WebSocket client for the multiplayer wire protocol, useful
only as protocol reference.

## Where this game sits

Gauntlet of Angband is a total conversion in presentation and a tactical-refinement variant in
substance. Its baseline is Angband 3.0.x, which puts it beside NPPAngband in lineage terms, and it
has already imported several things this survey shows were variant inventions rather than vanilla
features: caverns and labyrinths (mainline 3.3.0), smart_learn, persistent levels that advance while
you are away, and randarts.

Against the family it is mid-sized: 510 monsters and 430 object kinds put it close to vanilla and far
from both Sil at one end and UnAngband at the other. Its seventeen races and ten classes are more
than vanilla 4.2's eleven and nine, and its four realms and 176 spells go beyond 3.0's two realms. Its
dungeon is 132 by 66 against vanilla's 198 by 66, which is the deliberate departure noted in the gaps
document.

Two things make it unusual in the family rather than merely another variant. It is one of a handful
of browser-native implementations, and the only one drawn as a 3/4 view arcade game with synthesised
audio. And the autoplay bot is rarer still: only neo-angband ships anything comparable, and Angband's
own borg is a development tool rather than a player-facing feature.

## Ideas worth borrowing

Ordered by how well they fit what already exists here. None of these are commitments; this is a menu.

**Cheap, and a clear improvement.**

- **Angband 4.2.6's pathfinding and device quality-of-life.** Travel that opens doors and clears
  rubble on the way, and device activation that retries automatically the way digging does. Both land
  in `src/game/commands.ts`, and the first would also simplify `src/game/autoplay.ts`.
- **Object descriptions that show curse effects in the displayed stats**, and detection messages that
  distinguish gold from other objects. `src/game/items.ts` and `src/ui/screens.ts`.
- **EyAngband's rod stacking and monsters carrying their own light sources.** The second is a real
  tactical difference in a game that already models light and infravision.
- **Oangband's incremental elemental resistance.** Binary resistance is the single most-criticised
  piece of vanilla's design, and `src/game/projection.ts` already centralises the arithmetic.

**Moderate, and a real design change.**

- **Oangband's specialty abilities**, or FAangband's version where they unlock by killing dungeon
  guardians rather than by gaining levels. This is the cheapest way to make ten classes feel like
  thirty, and it fits `src/game/data/classes.ts` and `src/game/player.ts` without disturbing anything
  else.
- **NPPAngband's Fame and quest system**, descended from EyAngband. We have the generators, the pits,
  the vaults and the themed levels a quest system needs, and nothing that gives the player a reason to
  choose one level over another.
- **Sil's light model**, where darkness resistance is simply whether your square is lit well enough,
  rather than a binary flag. We already draw graded light.
- **Frogcomposband's dungeon guardians**, the rule that clearing a named dungeon grants a permanent
  reward. The Gauntlet generators are already a per-level objective; a guardian is the same idea
  scaled up.

**Large, and closer to a different game.**

- **Sangband's skills-and-oaths model**, or Sil's skills-and-abilities model. Both delete classes.
- **Halls of Mist's rising minimum depth**, which makes diving compulsory and scores speed. It would
  suit an arcade game better than it suits Angband, and it is a birth option rather than a rewrite.
- **A wilderness overworld with several dungeons**, the ZAngband line's defining move, or FAangband's
  version with a home town per race.

**From the other browser ports, regardless of game design.**

- **neo-angband's provenance ledger and statistical parity testing.** We have a determinism test but
  nothing that checks our numbers still match Angband's. A table mapping each of our data files to the
  Angband file it came from would make the next parity pass much cheaper.
- **shelob's key-handling lesson**, that the browser eats some key combinations. Worth auditing our
  keymap against, since we bind several Ctrl chords.

## What is not confirmed

The research behind this page could not reach roguebasin.com, angband.oook.cz, angband.live,
rephial.org, tangaria.com or Wikipedia, all of which were blocked at the network layer. Everything
above is either read directly from a project's own repository or flagged here.

- **Monster, object and artifact totals for Hengband, PosChengband and Frogcomposband** beyond
  Frogcomposband's own "about 1300" monsters.
- **Steamband's win condition**, and exact race and class totals.
- **Chengband's version numbers and dates**, and Entroband's authorship.
- **EyAngband's base Angband version** and its race list; the reported races may be contaminated by
  another variant's description.
- **Ironband's release history**, and whether Quickband also drops shops.
- **The live game roster at angband.live**, inferred from the server's build script rather than the
  site.
- **ToME 4's release history after 1.7.6** in June 2023, and its exact class and race counts.
- Whether an Angband **4.3** is planned. No public roadmap was found, which is not the same as none
  existing.
- Several names that turn up in variant discussions could not be confirmed to exist at all:
  **Narniaband, Elleryband, ManaAngband and Improv-Angband**. "Dr Angband" is DrAngband, which is
  Dragon Angband.

## Sources

Primary, read directly:

- Angband: `github.com/angband/angband` -- `changes.txt`, `docs/version.rst`, `docs/birth.rst`,
  `docs/attack.rst`, `docs/playing.rst`, `docs/command.rst`, releases.
- Moria: `github.com/dungeons-of-moria/umoria` -- `src/game.h`, `historical/manual.md`.
- Sil: `github.com/halfsickofshadows/Sil`. Sil-Q: `github.com/sil-quirk/sil-q` -- `CHANGELOG.md`,
  `early-changes.txt`. NarSil: `github.com/NickMcConnell/NarSil` -- `docs/combat.rst`,
  `docs/stealth.rst`, `docs/smithing.rst`, `docs/experience.rst`. Sil-More:
  `github.com/k0rtesss/Sil-More`.
- Oangband: `github.com/oangband/Oangband` -- `lib/help/combat.txt`, `specialt.txt`, `magic.txt`.
- Sangband: `github.com/dennis-roof/Sangband` -- `lib/help/skills.txt`, `magic.txt`.
- NPPAngband: `github.com/nppangband/NPPAngband` -- `NPPchanges.txt`.
- FAangband: `github.com/NickMcConnell/FAangband` -- `docs/world.rst`, `docs/birth.rst`,
  `docs/version.rst`.
- Hengband: `github.com/hengband/hengband` -- `lib/help/raceclas.txt`, `magic.txt`, `general.txt`.
- ZAngband: `github.com/OwenGHB/Zangband-2.2.8L` -- `src/defines.h`, `lib/help/birth.txt`.
- PosChengband: `github.com/NickMcConnell/poschengband` -- `src/defines.h`.
- Frogcomposband: `github.com/sulkasormi/frogcomposband` -- `src/defines.h`, `lib/edit/d_info.txt`,
  `lib/help/Races.txt`, `Classes.txt`, `MonsterRaces.txt`, `Personalities.txt`, `magic.txt`,
  `general.txt`, `monster.txt`.
- UnAngband: `github.com/NickMcConnell/AngbandPlus` branch `UnAngband`, and
  `github.com/DGoldDragon28/Unangband`.
- Halls of Mist: `github.com/NickMcConnell/AngbandPlus` branch `HallsOfMist` -- `lib/help/skills.txt`,
  `stairs.txt`.
- ToME 2: `github.com/tome2/tome2` -- `lib/help/version.txt`, `src/tables.cc`.
- MAngband: `github.com/mangband/mangband` -- `lib/help/version.txt`, `src/common/defines.h`.
- TomeNET: `github.com/TomenetGame/tomenet` -- `TomeNET-Guide.txt`.
- Steamband: `github.com/myshkin/steamband` -- `lib/help/birth.txt`, `readme.txt`.
- Variant roster: `github.com/NickMcConnell/AngbandPlus` branch list, and `github.com/topics/angband`.
- Browser ports: `github.com/neostryder/neo-angband`, `github.com/ridiculousfish/shelob`,
  `github.com/OwenGHB/angband-webclient`, `github.com/marcjohnston/AngbandOS`,
  `github.com/mangband/mangclient-js`.

Secondary, reached only through search summaries and flagged as such above: angband.live,
angband.oook.cz, roguebasin.com, tangaria.com, te4.org, rephial.org.
