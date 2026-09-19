# Gauntlet of Angband

An Angband-style roguelike drawn like the 1985 arcade *Gauntlet*: a procedurally generated dungeon
seen from a 3/4 top-down view, a town with the eight stores and a day/night cycle, seventeen races
and ten classes across four magic realms, flavoured potions, egos and artifacts, hand-drawn vaults
and monster pits, caverns and labyrinths, monster memory, generators that spawn monsters until you
smash them, Sauron and Morgoth at the bottom, and a hero who **needs food badly**.

Every sound is synthesised in the browser and the arcade narrator announces your misfortunes, so
there are no asset files. It plays with a keyboard, a mouse or a thumb.

Strict TypeScript on the vanilla canvas, no runtime dependencies, nothing compiled during
development. The engine (`src/lib/`) is [ssinnott/game-engine](https://github.com/ssinnott/game-engine),
vendored with `git subtree` exactly as that repo's `docs/VENDORING.md` prescribes.

```
npm install
npm run dev        # http://localhost:8080  (esbuild transforms each .ts on request; just reload)
npm run check      # typecheck + headless simulator + browser smoke test
npm run build      # dist/index.html, one self-contained file
```

## Playing

Arrows, the numpad or `hjklyubn` move; hold a key to keep walking, `Shift` runs. Walking into
things does the obvious: monsters are attacked, doors opened (a key from your pouch unlocks a
locked one, otherwise you pick it), rubble and mineral veins are dug, a shop door enters the shop.
Gold, keys and items are picked up as you step on them. `?` lists the rest; the essentials are
`i` inventory, `e` equipment, `w` wield, `q` quaff, `r` read, `E` eat, `a` aim a wand, `u` use a
staff, `z` zap a rod, `f` fire, `v` throw, `m`/`p` cast, `G` study, `R` rest, `<` `>` stairs,
`C` character sheet, `M` map, `x` look, `Ctrl+S` save. Clicking the map travels there.

Ten classes, drawn as the Gauntlet heroes: Warrior, Mage (Wizard), Priest (Cleric), Rogue (Thief),
Ranger (Elf), Paladin (Valkyrie), Druid (Falconess, nature magic), Necromancer (Sorceress, the
necromantic realm), Blackguard (Knight, a brawler with a few dark rituals) and Archer. Seventeen
races: the eleven Angband ones plus Dark-Elf, Half-Giant, Barbarian, Ent, Beorning and Druadan.

The rest of the keyset: `~` the knowledge browser (monster memory, known objects, artifacts, egos,
uniques, kills), `/` recall the nearest monster, `=` options, `O` the ignore settings, `ctrl+O`
shows what you are ignoring, `D` disarm (traps and chests), `c` close, `T` tunnel, `ctrl+B` or
walking into a stuck door bashes it, `ctrl+J` jams a door with a spike, `ctrl+L` scrolls the map,
`Enter` repeats the last command, `V` the Hall of Heroes, `C` then `F` writes a character dump,
`ctrl+E` exports the save (the title screen imports one).

Auto-pickup is on by default, so the ignore settings (`O`) are worth a look: set a quality
threshold per kind of gear and the hero stops hoovering up rusty daggers. Nothing unidentified is
ever ignored and artifacts never are, an item inscribed `=g` is always picked up, and `ctrl+O`
reveals what is being left behind.

On a phone, touch anywhere: a thumb pad and three pages of command buttons appear, and the menus
get a navigation bar. The `touchControls` option forces them on with a mouse.

Birth offers rolled or point-bought stats, a short history, and the birth options: connected
stairs, ironman, no selling, smart monsters, persistent levels and random artifacts. Persistent
levels do not sit still while you are away -- things wander, things arrive, and the generators keep
generating. Random artifacts roll a fresh set of 121 from the game seed instead of the famous ones.
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
  gen/vaults.ts          hand-drawn lesser and greater vaults in Angband's vault.txt glyphs
  data/                  monsters (510), objects (430 kinds, 112 egos, 121 artifacts), spells (176 in four realms), races, classes
src/ui/                  everything that draws, and everything that touches the browser
  render.ts              the 3/4 map: floors, raised walls, doors, items, monsters, effects
  audio.ts               synthesised sound effects and the arcade narrator
  touch.ts               the on-screen thumb pad and command buttons
  storage.ts             saved heroes in IndexedDB, with a localStorage fallback
  sprites.ts             procedural cel-shaded monster sprites (43 families) and item icons
  hero.ts                the player as the engine's paper-doll rig, per class
  hud.ts                 side panel, message bar, shouted banners
  screens.ts             menus, prompts, inventory, stores, spells, character sheet, map, help
  screens2.ts            knowledge browser, recall, options, high scores, locate, the birth screen
src/lib/                 the vendored engine (do not edit here; fix upstream and subtree pull)
tools/                   dev server, bundler, headless simulator, browser smoke test
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
  character, walks into the dungeon, opens the inventory, saves to IndexedDB and loads it back,
  exercises the touch controls, and asserts the canvas has real content and the page raised no
  errors. It leaves screenshots in `dist/`.

The determinism check is the strict one: the simulator plays a fixed script from a fixed seed
twice and requires the two saves to be identical byte for byte, then does it again across a save
and a restore to prove the round trip does not perturb what follows. That is what makes the claim
about the seeded rng a fact rather than an intention, and it is the groundwork for the lockstep
netcode sitting unused in `src/lib/net/`.

## Engine

`src/lib/` is `git subtree add --prefix=src/lib <game-engine> split --squash`, where `split` is
`git subtree split --prefix=src` of game-engine. To update: `git subtree pull --prefix=src/lib
<game-engine> split --squash`. The game uses the engine's canvas and fixed-timestep loop, the
seeded rng (every roll in the game goes through it, so a seed reproduces a run), the pixel font,
the shape and palette helpers, and the rig/animation stack for the player sprite.
