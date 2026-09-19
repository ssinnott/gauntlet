# Gauntlet of Angband

An Angband-style roguelike drawn like the 1985 arcade *Gauntlet*: a procedurally generated dungeon
seen from a 3/4 top-down view, a town with the eight stores and a day/night cycle, seventeen races
and ten classes across four magic realms, flavoured potions, egos and artifacts, hand-drawn vaults
and monster pits, monster memory, generators that spawn monsters until you smash them, Sauron and
Morgoth at the bottom, and a hero who **needs food badly**.

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
uniques, kills), `/` recall the nearest monster, `=` options, `D` disarm (traps and chests), `c`
close, `T` tunnel, `ctrl+B` or walking into a stuck door bashes it, `ctrl+J` jams a door with a spike,
`ctrl+L` scrolls the map, `Enter` repeats the last command, `V` the Hall of Heroes, `C` then `F`
writes a character dump, `ctrl+E` exports the save (the title screen imports one).

Birth offers rolled or point-bought stats, a short history, and the birth options: connected
stairs, ironman, no selling, smart monsters and persistent levels. Monster memory (what each race
does, what it resists, how many you have killed) carries over between heroes.

## Layout

```
src/main.ts              loop, input, keymap, overlay stack
src/constants.ts         render size, tile size, dungeon size, food thresholds
src/game/                pure game logic: no DOM anywhere below here
  types.ts               the shared vocabulary (tiles, monsters, objects, player, level)
  game.ts                creation, level changes, the world turn loop, hunger, regen, timed effects
  commands.ts            every player action
  level.ts               tile grid, line of sight, field of view, flow map, pathfinding
  gen/dungeon.ts         rooms (8 shapes), tunnels, streamers, doors, stairs, traps, vaults, nests
  gen/town.ts            the town: stores, roads, trees, the dungeon entrance
  player.ts              stat tables, derived bonuses, experience, hit points and mana
  items.ts               object instances, apply_magic, flavours, naming, stacking, value
  monster.ts             monster creation, allocation by depth, AI, generators, breeders, drops
  monsterSpells.ts       bolts, balls, breath, curses, summons, teleports
  combat.ts              player blows, monster blows with side effects, elemental damage, death
  projection.ts          bolt / beam / ball / breath geometry and resistances
  effects.ts             the effect interpreter behind every consumable, device and spell
  effectsCore.ts         timed effects, bonus refresh, teleports, saving throws
  stores.ts              stock, prices, buying, selling, the Home
  save.ts                JSON save/restore (localStorage)
  lore.ts                monster memory; recall.ts writes it up; dump.ts the character dump
  options.ts             birth and game options; scores.ts the Hall of Heroes
  gen/vaults.ts          hand-drawn lesser and greater vaults in Angband's vault.txt glyphs
  data/                  monsters (510), objects (430 kinds, 112 egos, 121 artifacts), spells (176 in four realms), races, classes
src/ui/                  everything that draws
  render.ts              the 3/4 map: floors, raised walls, doors, items, monsters, effects
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
- `sim` — `tools/sim.ts` generates dungeons at a dozen depths and asserts they are connected, then
  plays every class with a simple bot for thousands of turns (fighting, using items, casting,
  shopping, saving and reloading mid-run) and checks invariants. It runs in Node with no DOM,
  which is the reason `src/game/` never touches one.
- `smoke` — `tools/smoke.ts` loads the page in headless Chromium through the dev server, creates a
  character, walks into the dungeon, opens the inventory, saves, and asserts the canvas has real
  content and the page raised no errors. It leaves screenshots in `dist/`.

## Engine

`src/lib/` is `git subtree add --prefix=src/lib <game-engine> split --squash`, where `split` is
`git subtree split --prefix=src` of game-engine. To update: `git subtree pull --prefix=src/lib
<game-engine> split --squash`. The game uses the engine's canvas and fixed-timestep loop, the
seeded rng (every roll in the game goes through it, so a seed reproduces a run), the pixel font,
the shape and palette helpers, and the rig/animation stack for the player sprite.
