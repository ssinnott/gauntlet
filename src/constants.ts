// Fixed sizes for the whole game. The internal render size is what the engine's createCanvas
// scales up to the window; everything else here is in those internal pixels or in map tiles.

/** Internal render size, 16:9. */
export const VIEW_W = 960;
export const VIEW_H = 540;

/** One map tile in internal pixels. */
export const TILE = 24;
/** Height of a wall's front face in the 3/4 view. */
export const WALL_H = 10;

/** Layout: the map viewport, the right-hand Gauntlet-style panel and the top message bar. */
export const PANEL_W = 216;
export const BAR_H = 36;
export const MAP_X = 0;
export const MAP_Y = BAR_H;
export const MAP_W = VIEW_W - PANEL_W;   // 744 -> 31 tiles
export const MAP_H = VIEW_H - BAR_H;     // 504 -> 21 tiles
export const MAP_COLS = Math.floor(MAP_W / TILE);
export const MAP_ROWS = Math.floor(MAP_H / TILE);

/** Dungeon dimensions (Moria-sized rather than Angband's 198x66, so a level fits a few screens). */
export const DUN_W = 132;
export const DUN_H = 66;
/** Town dimensions. */
export const TOWN_W = 66;
export const TOWN_H = 33;

/** Max dungeon depth (levels); 50 ft per level as in Angband. */
export const MAX_DEPTH = 100;
/** Game turns of daylight (and then of night) in the town. */
export const TOWN_DAWN = 10000;

/** Inventory capacity and equipment slots. */
export const INVEN_MAX = 23;
/** Stacks the quiver can hold. */
export const QUIVER_SLOTS = 8;

/** Turns of the game clock per player turn at normal speed (Angband: 10 game turns = 1 player turn at +0). */
export const TURNS_PER_NORMAL_MOVE = 10;

/** Food thresholds (Angband's). */
export const FOOD_MAX = 15000;
export const FOOD_FULL = 10000;
export const FOOD_HUNGRY = 2000;
export const FOOD_WEAK = 1000;
export const FOOD_FAINT = 500;
export const FOOD_STARVE = 100;

/** Save key in localStorage. */
export const SAVE_KEY = 'gauntlet-of-angband.save.v1';
