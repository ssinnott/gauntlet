// Ambient globals: the debug surface index.html installs before the module graph loads, which the
// headless smoke test (tools/smoke.ts) drives.
interface Window {
  __game?: {
    ready: boolean;
    errors: string[];
    /** Installed by src/main.ts once the game is up: the live game for tests to poke. */
    api?: import('../src/game/game.ts').GameApi;
  };
}
