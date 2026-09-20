# Expansion candidates: more races, more classes, and an overland map

`docs/angband-variants.md` surveys what thirty years of Angband forks built. This page picks from
it. It is a menu with costs attached, not a plan of record, and it is opinionated about ordering
because the cheapest ideas here multiply the expensive ones.

## What has since been built

Three items from this page are done, and one of them was done differently from the way it is
argued for below. The argument is left standing because the reasoning still holds; this section
says where it ended up.

- **The Bard**, as proposed: a fifth realm called song, five books from the Lays of Beleriand to
  the Music of the Ainur, and 27 songs that keep running while you act and spend mana every turn.
  It is the one class that lives on charisma. `src/game/data/songs.ts` holds what each song does.
- **Sub-races and subclasses, in place of new races and new classes.** This page argues that
  personalities and specialty abilities are the cheap way to multiply builds, and that a fourth
  kind of elf is not worth the art. Both points survived; what was built instead of personalities
  is three sub-races per race, which is the same orthogonal-axis idea wearing Tolkien's clothes,
  and instead of specialty abilities it is three subclasses per class that override the class's own
  numbers and unlock features at levels 1, 10 and 25. 51 bloodlines and 33 paths.
- **Quirks**, which were not foreseen here at all. The declarative feature vocabulary covers most
  of what a path wants, but not a blow that stuns or a mage who pays in blood, so `src/game/quirks.ts`
  holds 26 hand-written rules with one named hook each.

Still open below: personalities as a separate axis, specialty abilities as such, the five race
candidates, the Monk, the undead race batch, and the overland map.

Two facts about this codebase shape everything below.

**Every race needs a visual hook.** The hero rig draws the race as the body and the class as the kit
worn over it, and `tools/smoke.ts` asserts that every race-and-class combination renders
differently, pixel for pixel (187 of them, since the Bard landed). A new race is therefore never
just a row in `src/game/data/races.ts`. It needs a silhouette, a feature or a palette that
`src/ui/heroRaces.ts` can draw, and the assertion's expected count moves with it. This is a feature,
not an obstacle: it rules out the "three elves that differ by two points of dexterity" pattern that
bloats the variant family.

**Levels are keyed by depth alone.** `g.savedLevels` is indexed by a number, and `depth === 0` means
"the town" in several places across `src/game/game.ts` and `src/game/commands.ts`. Anything with more
than one dungeon needs a composite key. That single fact is most of the cost of the overland map, and
it is discussed in its own section.

## The cheapest way to get many more options

If the goal is combinatorial variety, more races and classes is the expensive way to buy it. Two
systems from the variants multiply what already exists, and both are essentially one new data file.

### Personalities

Hengband invented these and Frogcomposband ships **21** of them. A personality is a third axis
alongside race and class: a small stat and skill modifier plus one quirk. Frogcomposband's list
includes Mighty, Shrewd, Pious, Nimble, Fearless, Sexy, Lucky, Patient, Craven, Hasty, Lazy,
Unlucky, Chaotic, Mundane, Munchkin, Fragile, Sneaky and Noble.

This is the single highest-value item on this page for someone who wants more options. The
combinatorics are multiplicative: seventeen races and ten classes is 170 starting points, and a dozen
personalities makes it 2040. The cost is one data table, one birth-screen row and a modifier applied
where race modifiers already are in `src/game/player.ts`.

It also fits this game specifically. Hengband gives the Lucky personality its own level-feeling
messages; we have an arcade narrator that shouts at the player, and a personality is a licence for it
to shout differently. **WIZARD IS FEELING LUCKY.**

The art cost is zero, because the personality is not drawn.

### Specialty abilities

Oangband's, as refined by FAangband, which lists **33**. You pick one at level one and more later.
Oangband gates the later picks on character level twenty and forty; FAangband's classic design gates
them on **killing dungeon guardians instead**, which is the better rule because it makes an ability a
reward for going somewhere rather than for grinding.

Examples from FAangband's list that would work here unchanged: Armour Mastery, Armsman, Athletics,
Evasion, Fast Attacking, Fury, Martial Arts, Mighty Throw, Piercing Shot, Rapid Fire, Regeneration,
Shield Mastery, Trap Setting, Unlight, Phasewalking, Mana Burn, Heighten Magic, Clarity.

This makes ten classes feel like thirty with no new sprites. It lands in
`src/game/data/classes.ts` as a per-class pool, a pick stored on the player, and a hook in the
level-up path. It also pairs with the overland map: if guardians unlock the picks, the two features
justify each other.

## Race candidates

Ordered by how much each one adds beyond a stat spread. Stat and skill sketches below are starting
points, not proposals to copy into the data file verbatim.

### Strong candidates

**Maia.** From Oangband, and canonical: the Istari and the Balrogs are Maiar, so a lesser spirit
clothed in flesh belongs in a Morgoth game. Mechanically it is the prestige race. Superb at
everything and punishingly slow to level, well past Ent's 210 per cent; Oangband went further and cut
the score by half as the price. Innate `SEE_INVIS` and `RES_LITE`, and arguably a free activation.
Art: luminous pale skin, bright eyes, a faint glow the renderer can already do.

**Draconian.** From the ZAngband line. The hook is that no race here has an innate attack, and a
Draconian's **breath weapon scales with level and varies by the individual**. That is a genuinely new
verb for the player, and `src/game/projection.ts` already has all the breath geometry. Art: scales,
wings and a tail. The tail already exists for kobolds; wings would be new code in
`src/ui/heroRaces.ts` and are the most distinctive silhouette any race here could have.

**Petty-Dwarf.** From FAangband, and canonical through Mîm. A dwarf that traded toughness for
stealth: small, resentful, a digger who is not loud about it. It fills a real gap, because every
stealthy race we have is also physically weak. Art: dwarf build scaled down, wild unbraided hair.

**Shadow Fairy.** From Oangband, where the design is excellent and worth copying exactly: they
**never aggravate monsters**, and **bright light hurts them**. That is a two-sided mechanic rather
than a stat line, and it interacts with the light and stealth systems we already have. Not Tolkien,
but neither is a Sorceress drawn as a Gauntlet hero. Art: tiny, dark, winged.

**Yeek.** From ZAngband, where it is the joke race: feeble, cowardly, and so worthless it levels
almost instantly. In a game with an arcade narrator this is a gift, and the fastest levelling in the
game is a real play pattern, not only a joke. Art: small, round, blue. The cheapest sprite on this
page and the most recognisable.

### A themed batch, if you want one

The undead races from the Hengband and Frogcomposband line, most usefully **Skeleton, Zombie and
Vampire**. They share one mechanic that makes them worth doing together: they **break the food
clock**. Skeletons barely eat, zombies eat anything including corpses, vampires drink blood. Given
that the game's own tagline is a hero who needs food badly, inverting that clock is a strong design
statement.

The cost is honest and larger than it looks. They interact with the priest realm, with holy damage,
with every undead-slaying ego and with monster recall. Do them as a set or not at all.

### Weak candidates, and why

**Green-Elf, Grey-Elf, Longbeard, Nibelung, Easterling.** All canonical, all cheap to write, and all
close enough to a race we already have that the smoke test's uniqueness assertion becomes a chore
rather than a guide. FAangband can carry four kinds of elf because its races are tied to home towns
and starting regions. Ours are not, yet. If the overland map lands, revisit these: a Green-Elf who
starts in a different forest is a different race in play even if the stat line is close.

## Class candidates

We have ten classes across four realms, which is already more than vanilla 4.2's nine across four.
The gaps worth filling are mechanical, not thematic.

**Bard.** The strongest candidate on this page, and the one no other Angband implementation can do as
well as this one can.

The mechanic comes from two places. Sil makes **Song** one of its eight skills, with twelve songs
powered by a Voice pool that drains while you sing, and an ability to weave two at once. UnAngband
gives bards **song books whose spells keep singing while you act**. Either way the shape is new to
this codebase: a sustained effect that ticks during your other turns, rather than a spell you cast
and forget. Nothing in `src/game/effects.ts` works that way today.

And this game synthesises every sound in the browser. A Bard's songs can actually be audible, and
change as they are woven. That is a feature that exists here and nowhere else in the family.

It probably wants a fifth realm. Hengband's answer is to make Music a realm of its own, alongside the
spell realms, which is exactly the shape `Realm` in `src/game/types.ts` already supports.

**Monk.** From ZAngband by way of most of the family. The gap it fills is clean: unarmed combat that
improves with level, and a penalty for wearing armour. Every class here fights with a weapon. The
martial-arts damage progression is a table, and `src/game/combat.ts` already resolves blows
generically.

**Chaos-Warrior or Mindcrafter,** if a fifth realm is wanted for its own sake. The Chaos-Warrior
serves a patron who grants random boons and mutations, which suits an arcade game. The Mindcrafter is
more interesting structurally: its powers arrive **by level with no spellbooks at all**, which would
be the only caster here immune to losing its books.

**Weaponmaster,** from PosChengband, where you choose a weapon group and gain abilities specific to
it. Worth naming because it is the cheap version of specialty abilities. If specialties land, this is
already built.

**Assassin and Warrior-Mage** are the two most common variant classes and the two least worth adding
here. Both are splits of classes we have rather than new verbs.

## The overland map

This is the largest item on the page and the one most worth doing carefully, because it changes the
shape of the game rather than its contents.

### What to take

**From FAangband**, which is the best version of this idea in the family and is actively maintained:

- A **wilderness overworld** with five terrain types: open plains, dense forest, rocky mountain,
  harsh desert and pathless swamp.
- **A home town per race**, which is the part you are partial to and the part that makes the race
  choice matter before the first turn. FAangband has thirteen races across seven towns, four major
  with full shopping and three minor. Seventeen races across **five or six towns** would follow the
  same pattern: a town of men, a dwarf-hold, an elven haven, a northern camp for the Barbarian,
  Beorning, Half-Giant and Half-Troll, and a wild settlement for the Druadan, Ent, Kobold and
  Half-Orc. Major towns get all eight stores; minor towns get three or four, so where you start is a
  real advantage or handicap.
- **Several dungeons, each with a guardian at the bottom.** FAangband's line is that any guardian not
  yet dead is available for Morgoth to call on, which is a good reason for the player to care.
- **Word of Recall that offers a choice of up to four destinations** rather than one.
- **A birth option that turns the whole thing off.** FAangband ships four map modes including a plain
  Angband-style one. We would ship two, Overland and Classic. This matters more here than there,
  because it protects the existing game, the determinism test and the simulator.

**From Frogcomposband:** killing a dungeon's guardian grants a **permanent reward**. Frogcomposband
gives a free stat increase. The better version for us is that a guardian unlocks a **specialty ability
pick**, which ties this section to the specialty abilities above and gives each dungeon a reason to
exist beyond flavour.

**From ZAngband,** which invented all of this: the overworld is generated from the seed like
everything else, so it costs no authoring and reproduces exactly.

### What it costs

In rough order of difficulty:

1. **Levels keyed by place, not depth.** `g.savedLevels[depth]` becomes something like
   `g.savedLevels['angband:23']`, `p.depth` becomes a place and a depth, `g.levelChange` and
   `p.recallDepth` follow, and the five or so `depth === 0` tests for the town become a check on the
   level's kind. This is the real work, and it touches `src/game/state.ts`, `src/game/game.ts`,
   `src/game/commands.ts` and `src/game/save.ts`.
2. **A save format bump.** There is precedent and the machinery exists: `src/game/save.ts` already
   accepts versions 1 through 3, and the `kind` field on a level documents its own absence in older
   saves.
3. **A wilderness generator,** joining the three in `src/game/gen/`. The cellular automaton in
   `cavern.ts` is most of the code for organic terrain already, and the dispatcher in `gen/level.ts`
   is where it plugs in.
4. **Several towns,** which generalises `gen/town.ts` from one layout to a parameterised one with a
   store list per town.
5. **The simulator.** `tools/sim.ts` generates levels of every kind at a dozen depths and asserts they
   are connected, and the determinism check requires two runs from one seed to produce byte-identical
   saves. Both need to cover the new level kind and the new save shape.
6. **The bot.** `src/game/autoplay.ts` walks into the dungeon because the dungeon is directly below.
   With an overworld it has to travel to a dungeon entrance first, which is a pathfinding problem on
   a map it has to explore.
7. **The HUD,** which shows depth in feet and would want a place name.

### How to sequence it

Step one is a pure refactor with no gameplay change: key levels by place and depth, with exactly one
place. Nothing the player can see moves, and the determinism test proves it. That is a safe, isolated
commit, and everything else builds on it.

Then the wilderness generator, then multiple towns and race homes, then multiple dungeons and
guardians, then the recall choice, then the bot. Each of those is playable on its own.

## Suggested order

Ranked by options gained per unit of work.

1. ~~**Personalities.**~~ Superseded: sub-races fill the same orthogonal axis. Personalities could
   still be added as a third one, and would cost about as little.
2. ~~**Specialty abilities.**~~ Superseded: subclass features unlock at levels 1, 10 and 25 and do
   the same job. FAangband's rule, where the later picks come from killing dungeon guardians rather
   than from levelling, is still worth taking if the overland map ever lands.
3. ~~**Bard,** with Music as a fifth realm.~~ Built.
4. **The five strong races:** Maia, Draconian, Petty-Dwarf, Shadow Fairy, Yeek. Each has a hook and a
   silhouette. Each needs art in `src/ui/heroRaces.ts`, and wings are the only genuinely new drawing
   problem.
5. **Monk.** Fills the unarmed gap cleanly.
6. **The overland map,** staged as above, starting with the place-keyed levels refactor.
7. **The undead race batch,** as a set, once the food clock and the holy-damage interactions have been
   thought through.

Items one through five are additive and low risk. Item six is the one that changes what the game is,
and it is worth doing precisely for that reason. The home town per race is the part that pays off
first, because it makes seventeen races into seventeen openings rather than seventeen stat lines.
