# Gauntlet of Angband

An Angband-style roguelike drawn like the 1985 arcade *Gauntlet*: a procedurally generated dungeon
seen from a 3/4 top-down view, a town with the eight stores and a day/night cycle, seventeen races
and eleven classes across five magic realms, three bloodlines for every race and three paths for
every class, flavoured potions, egos and artifacts, hand-drawn vaults and monster pits, caverns and
labyrinths, monster memory, generators that spawn monsters until you smash them, Sauron and Morgoth
at the bottom, and a hero who **needs food badly**.

Every sound is synthesised in the browser and the arcade narrator announces your misfortunes, so
there are no asset files. The hero plays itself: a keyboard, a mouse or a thumb is only for looking.

**[Play it here](https://ssinnott.github.io/gauntlet/)** -- `.github/workflows/pages.yml` typechecks,
runs the simulator and publishes `dist/index.html` to GitHub Pages on every push to `main`.

**Install it on a phone** from that page: on an iPhone, Safari's Share button, then *Add to Home
Screen*; on Android, Chrome's menu, then *Install app* (or *Add to Home screen*). It gets an icon,
opens full screen (held in landscape on Android), and plays offline once it has been opened online.

Strict TypeScript on the vanilla canvas, no runtime dependencies, nothing compiled during
development. The engine (`src/lib/`) is [ssinnott/game-engine](https://github.com/ssinnott/game-engine),
vendored with `git subtree` exactly as that repo's `docs/VENDORING.md` prescribes.

```
npm install
npm run dev        # http://localhost:8080  (esbuild transforms each .ts on request; just reload)
npm run check      # typecheck + headless simulator + browser smoke test
npm run build      # dist/index.html, one self-contained file, plus what a phone installs it with
```

## Playing

**The hero plays itself**, always. NEW GAME on the title screen lets chance build a hero -- race,
bloodline, class, path, stats, name and history -- and the bot (below) starts playing it at once.
CONTINUE heads the title screen whenever a hero is saved, with a summary of it underneath (level,
where it is, how deep it has been, gold, kills and deaths), and the bot picks it back up where it
left off. There is nothing to switch on and nothing to take over: no key or tap stops the bot.
BUILD A HERO is the full birth screen, for choosing everything yourself; SAVED HEROES lists every
hero kept in the browser.

**Death is a setback, not the end.** A hero who dies wakes in the town -- at dawn, if it fell in the
night -- naked and with an empty pack: equipment, quiver, potions, scrolls and books are gone. Its
level, experience, stats (drained ones restored), spells, gold, the deepest level it reached and
everything it has learnt about flavours and monsters are kept, and the bot goes on playing. A hero
who dies with less than 100 gold (the least a new hero starts with) is given the difference by the
temple, enough for a torch and a blade. Only retiring (`Q`) ends a hero's story, and that is what
puts it in the Hall of Heroes.

The keys only look, and the bot plays on behind every screen they open: `i` inventory, `e`
equipment, `C` the character sheet (`F` there writes a character dump), `M` the map, `x` or `l`
look (`r` recalls the monster under the cursor), `/` recall the nearest monster, `b` browse spells,
`~` the knowledge browser (monster memory, known objects, artifacts, egos, uniques, kills), `ctrl+P`
the messages, `ctrl+L` scrolls the map, `ctrl+F` the level feeling, `V` the Hall of Heroes, `?`
help. `=` holds the options, `O` the ignore settings and `ctrl+O` shows what is being ignored;
`ctrl+S` saves, `ctrl+X` saves and goes back to the title screen, `ctrl+E` exports the save (the
title screen imports one) and `Q` retires the hero. Right-click the map to look there, or click the
side panel for the inventory. A key that would play -- a step, a potion, a spell, the stairs --
does nothing.

Eleven classes, drawn as the Gauntlet heroes: Warrior, Mage (Wizard), Priest (Cleric), Rogue
(Thief), Ranger (Elf), Paladin (Valkyrie), Druid (Falconess, nature magic), Necromancer (Sorceress,
the necromantic realm), Blackguard (Knight, a brawler with a few dark rituals), Archer and Bard
(Jester, who fights to music). Seventeen races: the eleven Angband ones plus Dark-Elf, Half-Giant,
Barbarian, Ent, Beorning and Druadan.
Every race and class combination has its own sprite: the race is the body (skin, hair, ears, beard,
build -- a hobbit's bare feet, a kobold's snout and tail, an Ent's bark and leaves) and the class is
the kit worn over it (the Gauntlet hero's colours, hat, robe, cloak, shield or pauldrons); women get
long hair and no beard. `npm run sheet` draws them all on one contact sheet in `dist/heroes.png`.

Auto-pickup is on by default, so the ignore settings (`O`) are worth a look: set a quality
threshold per kind of gear and the hero stops hoovering up rusty daggers. Nothing unidentified is
ever ignored and artifacts never are, and `ctrl+O` reveals what is being left behind.

On a phone, touch anywhere: buttons for the screens appear (the inventory, look, the map, the
hero, knowledge, options, the ignore settings and help), and the menus get a navigation bar. The
`touchControls` option forces them on with a mouse. The game saves the moment it leaves the
screen, because a phone closes a game in the background without warning. On an iPhone the
installed game keeps its own saves, apart from Safari's.

The bot shops, walks into the dungeon, and explores it the way a player does --
it picks a direction and keeps to it, following a corridor to its end and crossing a room to its far
door before it turns back for what it passed. It digs through rubble in its way and veins that show
treasure, throws oil and fires arrows at what comes, rests when it is safe, drinks when it is not,
and takes the stairs once it has found the kind it wants. It weighs up a fight before it picks one
-- what the thing hits for, what it hits back for, and so what killing it would cost -- and walks
round, shoots at or leaves behind anything dearer than its hit points can spare: a corridor to meet
a pack in, the stairs when something faster than it is hunting. It only backs away from what it can
outwalk, since anything as quick simply follows; a mold across its way is fought in rounds with a
rest between, a floating eye is shot from a distance and never stood beside, and a floor with a
mouse on it is still worth exploring until the mice have overrun it. Out of cures too far down for
the stairs home to be worth the walk, it reads a Word of Recall, shops, and reads the second one to
be dropped back where it left off. It plays with the same commands a player would and knows only
what the hero knows -- no revealed map, no free healing, no peeking at what an unknown flavour
really is -- so it dies like anyone else, then wakes in the town, re-equips and goes back down.

The bot uses its pack the way a player does. It tries unknown potions, scrolls, staffs and rods
when it is quiet and healthy enough to take the worst the flavour could turn out to be (never one
that could be a Potion of Death at that depth), and points unknown wands at something weak. A
staff, wand or rod too deep for its device skill fails in its hands without teaching it anything,
so it gives an unknown one up after a few failures (a shopkeeper will name it) and never relies on
a known one that fails it half the time or more. It
drinks the Potions of Strength it finds and reads the Scrolls of Enchant Weapon, reads Identify on
rings, amulets and gear that feels good, Magic Mapping and Door/Stair Location on a new level, and
Remove Curse when something cursed is stuck on it; it drinks Heroism, Berserk Strength or Speed and
reads Blessing before a fight that matters, chooses the cure that fits the wound, and throws out
and ignores what it has learnt is rubbish. It wears whatever makes it stronger by its whole measure
-- blows, armour, speed, hit points, mana, resistances, worked out as the game works them out --
judging unidentified gear by its kind and its feel, and never putting on anything that feels
cursed. In town it sells everything it does not need at whichever shop buys it, then buys what it
is short of, most urgent first: a light, a meal, a weapon, cures, armour, escapes, its books, the
rest of the kit, and upgrades from the armoury and the weaponsmith when there is gold to spare --
keeping back enough to buy the essentials again after a death.

Birth also asks for a **bloodline** and a **path**. A bloodline is one of three sub-races, and is
small: a point of one stat for a point of another, plus one perk. A path is one of three
subclasses, and is not small: it overrides the class's own numbers and unlocks a feature at levels
1, 10 and 25, so a Hammerhand and an Axe-Thrower stop resembling each other somewhere around level
ten. Both are shown on the character sheet and in the dump.

The **Bard** sings rather than casts. A song is struck up once and keeps running while you fight,
spending mana every turn, and it ends when the mana does, so a bard's mana bar is a clock rather
than a purse. Singing the same song again stops it. It is also the only class that lives on
charisma.

Birth offers rolled or point-bought stats (`X` on the point-buy screen lets chance spend the
points), a short history, and the birth options: connected
stairs, ironman, no selling, smart monsters, persistent levels and random artifacts. Persistent
levels do not sit still while you are away -- things wander, things arrive, and the generators keep
generating. Random artifacts roll a fresh set of 121 from the game seed instead of the famous ones.
NEW GAME on the title screen (or `*` anywhere on the birth screen) skips the questions: chance
picks the race, class, sex, stats, name and history and the game begins, with the bot playing.
Smart monsters no longer read your equipment: they learn what you resist by watching their attacks
fail, and forget it when you die. Monster memory (what each race does, what it resists, how many
you have killed) carries over between heroes; several heroes can be saved at once and are listed on
the title screen.

## Layout

```
src/main.ts              loop, input, keymap, overlay stack, saves
src/constants.ts         render size, tile size, dungeon size, food thresholds
src/game/                pure game logic: no DOM anywhere below here
  types.ts               the shared vocabulary (tiles, monsters, objects, player, level)
  state.ts               the Game object, the effect queue and the sound queue the UI drains
  game.ts                creation, level changes, the world turn loop, hunger, regen, timed effects
  commands.ts            every player action
  level.ts               tile grid, line of sight, field of view, flow, noise and scent, pathfinding
  gen/level.ts           which generator builds a level
  gen/dungeon.ts         rooms (8 shapes), tunnels, streamers, doors, stairs, traps, vaults, nests
  gen/cavern.ts          cellular-automaton caves, reduced to their largest connected cave
  gen/labyrinth.ts       depth-first mazes with loops, doors and (shallow ones) light
  gen/town.ts            the town: stores, roads, trees, the dungeon entrance
  player.ts              stat tables, derived bonuses, experience, hit points and mana
  items.ts               object instances, apply_magic, flavours, naming, stacking, value
  monster.ts             monster creation, allocation by depth, AI, senses, packs, generators, drops
  monsterSpells.ts       bolts, balls, breath, curses, summons, teleports
  smart.ts               what each monster race has learnt about this hero's defences
  combat.ts              player blows, monster blows with side effects, elemental damage, death
  projection.ts          bolt / beam / ball / breath geometry and resistances
  effects.ts             the effect interpreter behind every consumable, device and spell
  effectsCore.ts         timed effects, bonus refresh, teleports, saving throws
  stores.ts              stock, prices, buying, selling, the Home
  ignore.ts              which finds the hero cannot be bothered to pick up
  artifacts.ts           the artifact set in play; randart.ts rolls a fresh one from the seed
  save.ts                JSON save/restore
  lore.ts                monster memory; recall.ts writes it up; dump.ts the character dump
  options.ts             birth and game options; scores.ts the Hall of Heroes
  autoplay.ts            the bot that plays every hero (shared with the headless simulator)
  autoplayKit.ts         the bot's kit: what it tries, drinks, reads, wears, sells and buys
  gen/vaults.ts          hand-drawn lesser and greater vaults in Angband's vault.txt glyphs
  data/                  monsters (510), objects (435 kinds, 112 egos, 121 artifacts), spells (203 in five realms), races, classes
  data/subraces.ts       51 bloodlines, three per race: a stat tweak and one small perk
  data/subclasses.ts     33 paths, three per class: they override the class numbers and unlock features at 1, 10 and 25
  data/songs.ts          what the bard's 27 songs do while they are being sung
  quirks.ts              the hand-written half of a path: the rules the feature vocabulary cannot say
src/ui/                  everything that draws, and everything that touches the browser
  render.ts              the 3/4 map: floors, raised walls, doors, items, monsters, effects
  audio.ts               synthesised sound effects and the arcade narrator
  touch.ts               the on-screen buttons
  storage.ts             saved heroes in IndexedDB, with a localStorage fallback
  sprites.ts             procedural cel-shaded monster sprites (43 families) and item icons
  hero.ts                the player as the engine's paper-doll rig: the race's body wearing the class's kit
  heroRaces.ts           the race half of that: ears, hair, beards, tusks, snouts, war paint, tails, bare feet
  hud.ts                 side panel, message bar, shouted banners
  screens.ts             menus, prompts, inventory, stores, spells, character sheet, map, help
  screens2.ts            knowledge browser, recall, options, high scores, locate, the birth screen
src/lib/                 the vendored engine (do not edit here; fix upstream and subtree pull)
tools/                   dev server, bundler, headless simulator (fuzz + autoplay), browser smoke test, hero contact sheet
  pwa.ts                 what a phone installs from: the manifest, the icons (drawn, not stored) and the offline worker
```

## Checks

`npm run check` runs three things:

- `typecheck` — `tsc --noEmit`, strict.
- `sim` — `tools/sim.ts` generates levels of all three kinds at a dozen depths and asserts they are
  connected, proves a seed reproduces a run (see below), then plays every class with a simple bot
  for thousands of turns (fighting, using items, casting, shopping, saving and reloading mid-run)
  and checks invariants. It runs in Node with no DOM, which is the reason `src/game/` never touches
  one.
- `smoke` — `tools/smoke.ts` loads the page in headless Chromium through the dev server, creates a
  character and checks that the bot plays it whatever is pressed (and that no key plays it
  instead), takes it into the dungeon, opens the inventory, saves to IndexedDB and loads it back,
  exercises the touch controls, draws the hero contact sheet and asserts that no two race/class
  combinations render identically, and asserts the canvas has real content and the page raised no
  errors. It also checks that Chromium would install the page and that, once the service worker has
  seen the game, the game starts with the server stopped. It leaves screenshots in `dist/`.

The determinism check is the strict one: the simulator plays a fixed script from a fixed seed
twice and requires the two saves to be identical byte for byte, then does it again across a save
and a restore to prove the round trip does not perturb what follows. That is what makes the claim
about the seeded rng a fact rather than an intention, and it is the groundwork for the lockstep
netcode sitting unused in `src/lib/net/`.

## Notes

`docs/angband-feature-gaps.md` records how this game maps onto Angband 3.0.x, what has been built
and what is still missing. `docs/angband-variants.md` surveys the thirty-odd years of Angband
variants and what each one changes. `docs/expansion-candidates.md` picks from that survey: candidate
races and classes, the personality and specialty systems that multiply them, and what a wilderness
map with a home town per race would cost.

## Engine

`src/lib/` is `git subtree add --prefix=src/lib <game-engine> split --squash`, where `split` is
`git subtree split --prefix=src` of game-engine. To update: `git subtree pull --prefix=src/lib
<game-engine> split --squash`. The game uses the engine's canvas and fixed-timestep loop, the
seeded rng (every roll in the game goes through it, so a seed reproduces a run), the pixel font,
the shape and palette helpers, and the rig/animation stack for the player sprite.
