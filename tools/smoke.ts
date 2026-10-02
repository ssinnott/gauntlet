// Headless proof the game runs in a browser: serves the repo through tools/server.ts, loads the
// page, creates a character through the debug API and watches the bot play it -- which no key or
// click may stop -- takes it into the dungeon, opens the screens, and asserts the canvas has real
// content and the page raised no errors. Also writes screenshots to dist/smoke-*.png so the look
// can be reviewed.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from './server.ts';
import { drawHeroSheet, duplicateHeroes } from './heroSheet.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(import.meta.url);
function loadPlaywright(): any {
  for (const c of ['/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright', 'playwright', 'playwright-core']) { try { return require(c); } catch { /* next */ } }
  throw new Error('Playwright not found');
}
async function launch(chromium: any): Promise<any> {
  try { return await chromium.launch(); }
  catch (e) { const exe = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium'; if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe }); throw e; }
}

const server = createServer();
await new Promise<void>(r => server.listen(0, () => r()));
const port = (server.address() as { port: number }).port;
const { chromium } = loadPlaywright();
const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push('pageerror: ' + e.message));
page.on('console', (m: any) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
await page.waitForFunction(() => (window as any).__game?.ready === true, null, { timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'smoke-title.png') });

const colours = async (on: any = page): Promise<number> => on.evaluate(() => {
  const c = document.getElementById('stage') as HTMLCanvasElement;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set<number>();
  for (let i = 0; i < d.length; i += 16) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return seen.size;
});
const titleColours = await colours();

// New game through the API. The bot has the hero from the first frame: there is nothing to switch on.
const start = await page.evaluate(() => {
  const api = (window as any).__game.api;
  api.newGame('Smoke', 'dwarf', 'warrior', 'male');
  const g = api.game;
  return { turn: g.turn, x: g.player.x, y: g.player.y };
});
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'smoke-town.png') });
const townColours = await colours();
const state1 = await page.evaluate(() => { const g = (window as any).__game.api.game; return { depth: g.level.depth, hp: g.player.chp, x: g.player.x, y: g.player.y, monsters: g.level.monsters.length }; });
const botPlays = await page.evaluate(() => {
  const api = (window as any).__game.api, g = api.game;
  for (let i = 0; i < 300; i++) api.step();
  return { turn: g.turn, x: g.player.x, y: g.player.y, depth: g.level.depth };
});

// Into the dungeon for a look at it. The bot shops first and could take a while to get there, so the
// stairs are taken for it.
await page.evaluate(() => { const api = (window as any).__game.api; api.game.levelChange = { depth: 1, by: 'down' }; api.app.afterAction(); });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, 'smoke-dungeon.png') });
const dungeonColours = await colours();
const state2 = await page.evaluate(() => { const g = (window as any).__game.api.game; return { depth: g.level.depth, hp: g.player.chp, monsters: g.level.monsters.length, items: g.level.items.length, turn: g.turn }; });

// Nothing the player does takes the hero back. Real key presses -- space, an arrow, a command
// letter, the ctrl+A that used to toggle the bot -- and a click on the map go in through Input like
// any other, the bot plays straight on, and not one of them opens a prompt.
const uninterrupted = await page.evaluate(() => {
  const api = (window as any).__game.api, app = api.app, g = api.game;
  const stage = document.getElementById('stage')!;
  const turn = g.turn;
  for (const [key, ctrlKey] of [[' ', false], ['ArrowUp', false], ['q', false], ['a', true]] as const) stage.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true }));
  const r = stage.getBoundingClientRect();
  stage.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width * 0.3, clientY: r.top + r.height * 0.5, button: 0, pointerType: 'mouse', bubbles: true }));
  for (let i = 0; i < 240; i++) api.step();
  return { turns: g.turn - turn, overlays: app.overlays.length };
});
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, 'smoke-autoplay.png') });

// A key that would have played does nothing at all: no step, no prompt, no turn. The arrows, the
// numpad and the vi keys move nobody, and the command letters, pressed or tapped, command nothing.
const inert = await page.evaluate(() => {
  const app = (window as any).__game.api.app, g = app.g, p = g.player;
  const snap = () => JSON.stringify({ x: p.x, y: p.y, depth: g.level.depth, turn: g.turn, searching: !!p.searching, pack: p.inven.length, overlays: app.overlays.length });
  const presses: { key: string; shift: boolean; ctrl: boolean; code: string }[] = [];
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'PageDown', 'h', 'j', 'k', 'y', 'u', 'n', '1', '5', '9', '.', ',', 'g', 's', 'S', '<', '>', 'R', 'q', 'r', 'E', 'w', 't', 'd', 'a', 'z', 'A', 'F', 'v', 'f', 'm', 'p', 'G', 'o', 'c', 'D', 'T', 'P', 'Enter', '{', '}', '*'])
    presses.push({ key, shift: false, ctrl: false, code: '' });
  presses.push({ key: 'ArrowUp', shift: true, ctrl: false, code: '' });
  for (const key of ['a', 'b', 'j']) presses.push({ key, shift: false, ctrl: true, code: '' });
  for (const key of ['u', 'q', 'g', '>', 'R', 'ArrowUp']) presses.push({ key, shift: false, ctrl: false, code: 'touch' });
  const acted: string[] = [];
  for (const e of presses) {
    const before = snap();
    app.handleKeyPublic({ ...e, alt: false });
    if (snap() !== before) acted.push(`${e.ctrl ? 'ctrl+' : ''}${e.shift ? 'shift+' : ''}${e.key}${e.code ? ' (button)' : ''}`);
    for (let n = 0; app.overlays.length && n < 5; n++) app.handleKeyPublic({ key: 'Escape', shift: false, ctrl: false, alt: false, code: '' });
  }
  return { tried: presses.length, acted };
});

// The keys that only look still open their screens, and the bot plays on behind them.
const behind = await page.evaluate(() => {
  const api = (window as any).__game.api, app = api.app, g = api.game;
  const close = () => { for (let n = 0; app.overlays.length && n < 5; n++) app.handleKeyPublic({ key: 'Escape', shift: false, ctrl: false, alt: false, code: '' }); };
  const screens: Record<string, string | null> = {};
  for (const key of ['i', 'e', 'C', 'M', 'x', '~', '=', 'O', 'V', '?']) {
    app.handleKeyPublic({ key, shift: false, ctrl: false, alt: false, code: '' });
    const top = app.overlays[app.overlays.length - 1];
    screens[key] = top ? top.constructor.name : null;
    close();
  }
  app.handleKeyPublic({ key: 'C', shift: false, ctrl: false, alt: false, code: '' });
  const turn = g.turn;
  for (let i = 0; i < 240; i++) api.step();
  const open = app.overlays[app.overlays.length - 1]?.constructor.name ?? null;
  close();
  return { screens, turns: g.turn - turn, open };
});

// Inventory screen renders.
await page.evaluate(() => (window as any).__game.api.key('i'));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'smoke-inventory.png') });
await page.evaluate(() => (window as any).__game.api.key('Escape'));

// Knowledge browser, options and the character sheet render; the birth screen shows its stat step.
await page.evaluate(() => (window as any).__game.api.key('~'));
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, 'smoke-knowledge.png') });
const knowledgeColours = await colours();
await page.evaluate(() => { const api = (window as any).__game.api; api.key('Escape'); api.key('='); });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, 'smoke-options.png') });
await page.evaluate(() => { const api = (window as any).__game.api; api.key('Escape'); api.key('C'); });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, 'smoke-charsheet.png') });
await page.evaluate(() => (window as any).__game.api.key('Escape'));
const dumpLen = await page.evaluate(() => (window as any).__game.api.dump().length);

// Touch controls, with real touches so the routing in main.ts is what is tested. The hero plays
// itself, so the map has nothing to press: a tap where the command buttons and the thumb pad used
// to be opens nothing, and the touch bar stays away. The side panel still opens the pack, the bar
// comes up under it, and the bar's ESC closes it again.
const touchMap = await page.evaluate(() => {
  const api = (window as any).__game.api, app = api.app;
  const stage = document.getElementById('stage')!, r = stage.getBoundingClientRect();
  const tap = (x: number, y: number): string | null => {
    const at = { clientX: r.left + x * r.width / 960, clientY: r.top + y * r.height / 540, button: 0, pointerType: 'touch', bubbles: true };
    stage.dispatchEvent(new PointerEvent('pointerdown', at));
    stage.dispatchEvent(new PointerEvent('pointerup', at));
    api.step();
    return app.overlays[app.overlays.length - 1]?.constructor.name ?? null;
  };
  const onMap = [tap(281, 481), tap(74, 462), tap(400, 200)];
  return { detected: app.touch.detected, shownOnMap: app.touchVisible(), onMap, panel: tap(900, 300), shownOnScreen: app.touchVisible() };
});
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(OUT, 'smoke-touch.png') });
const touchColours = await colours();
const touchBar = await page.evaluate(() => {
  const api = (window as any).__game.api, app = api.app;
  const stage = document.getElementById('stage')!, r = stage.getBoundingClientRect();
  const esc = app.touch.buttons()[0];
  const at = { clientX: r.left + (esc.x + 3) * r.width / 960, clientY: r.top + (esc.y + 3) * r.height / 540, button: 0, pointerType: 'touch', bubbles: true };
  stage.dispatchEvent(new PointerEvent('pointerdown', at));
  stage.dispatchEvent(new PointerEvent('pointerup', at));
  api.step();
  const closed = app.overlays.length === 0;
  // The option forces the bar on with a mouse, and still only under a screen.
  app.touch.detected = false;
  api.game.options.touchControls = true;
  const forcedOnMap = app.touchVisible();
  api.key('i');
  const forcedOnScreen = app.touchVisible();
  api.key('Escape');
  api.game.options.touchControls = false;
  return { esc: esc.key, closed, forcedOnMap, forcedOnScreen };
});

// Every sound recipe runs at least once. The debug API bypasses Input, so audio is never unlocked
// by the scripted keys above and none of this code would otherwise execute in a browser.
const soundsPlayed = await page.evaluate(() => (window as any).__game.api.testAudio());
await page.waitForTimeout(200);

// Save round trip: ctrl+S writes a slot to IndexedDB, it lists on the title screen, and reading it
// back reconstructs the same hero. Nothing is left in the old single localStorage key. The game goes
// to the title screen straight after the save, so the bot cannot write a newer one meanwhile.
await page.evaluate(() => { const api = (window as any).__game.api; api.key('s', false, true); api.app.quitToTitle(); });
await page.waitForTimeout(700);
const saveInfo = await page.evaluate(async () => {
  const app = (window as any).__game.api.app;
  const rows: any[] = await new Promise(resolve => {
    const req = indexedDB.open('gauntlet-of-angband', 1);
    req.onsuccess = () => {
      try {
        const t = req.result.transaction('saves', 'readonly');
        const all = t.objectStore('saves').getAll();
        all.onsuccess = () => resolve(all.result as any[]);
        all.onerror = () => resolve([]);
      } catch { resolve([]); }
    };
    req.onerror = () => resolve([]);
  });
  const mine = rows.find(r => r.id === app.currentSlot);
  return {
    rows: rows.length,
    name: mine?.name,
    depth: mine?.depth,
    hasData: typeof mine?.data === 'string' && mine.data.length > 500,
    slots: app.slots.length,
    hasSaveFlag: app.hasSave(),
    legacy: !!localStorage.getItem('gauntlet-of-angband.save.v1'),
  };
});
// Loading the slot back gives the same hero. The bot picks it up the moment it lands, so it is read
// then, before the bot has had time to take any stairs.
const reloaded = await page.evaluate(async () => {
  const app = (window as any).__game.api.app;
  const id = app.currentSlot, old = app.g;
  app.loadSlot(id);
  for (let i = 0; i < 200 && app.g === old; i++) await new Promise(r => setTimeout(r, 5));
  return { name: app.g?.player?.name, depth: app.g?.player?.depth, started: app.started };
});
// A hero saved while IndexedDB was unavailable lands in the localStorage fallback. Both stores must
// be read together: reading only IndexedDB when it happens to work would leave those heroes intact
// on disk and permanently invisible, which is exactly how a save is silently lost.
const fallback = await page.evaluate(async () => {
  const app = (window as any).__game.api.app;
  const KEY = 'gauntlet-of-angband.slot.fallbacktest';
  localStorage.setItem(KEY, JSON.stringify({
    id: 'fallbacktest', name: 'Fallback', race: 'elf', cls: 'ranger', lev: 7,
    depth: 12, maxDepth: 12, turn: 500, savedAt: Date.now(), data: '{"v":3}',
  }));
  app.refreshSlots();
  await new Promise(r => setTimeout(r, 500));
  const listed = app.slots.some((s: any) => s.id === 'fallbacktest');
  const alongside = app.slots.length >= 2;
  app.deleteSlot('fallbacktest');
  await new Promise(r => setTimeout(r, 500));
  return { listed, alongside, leftBehind: !!localStorage.getItem(KEY), stillListed: app.slots.some((s: any) => s.id === 'fallbacktest') };
});

// A stale IndexedDB row must not win over a newer fallback copy. One failed IndexedDB write puts a
// snapshot in localStorage and leaves an older row behind; preferring IndexedDB would then show and
// load hours-old progress without a word.
const staleness = await page.evaluate(async () => {
  const app = (window as any).__game.api.app;
  const id = app.slots[0]?.id;
  if (!id) return { ok: false, reason: 'no slot to test with' };
  const older = app.slots[0].savedAt;
  localStorage.setItem('gauntlet-of-angband.slot.' + id, JSON.stringify({
    ...app.slots[0], name: 'Newer', savedAt: older + 60000, data: '{"v":3,"newer":true}',
  }));
  app.refreshSlots();
  await new Promise(r => setTimeout(r, 500));
  const shown = app.slots.find((s: any) => s.id === id);
  localStorage.removeItem('gauntlet-of-angband.slot.' + id);
  app.refreshSlots();
  await new Promise(r => setTimeout(r, 500));
  return { ok: true, name: shown?.name, savedAt: shown?.savedAt === older + 60000, restored: app.slots[0]?.name };
});

// Leaving the screen saves at once: a phone closes a game it has sent to the background without a
// word, and waiting for the minute's autosave would lose whatever happened since the last one.
const hidden = await page.evaluate(async () => {
  const api = (window as any).__game.api, app = api.app;
  const row = (): Promise<any> => new Promise(resolve => {
    const req = indexedDB.open('gauntlet-of-angband', 1);
    req.onsuccess = () => {
      const get = req.result.transaction('saves', 'readonly').objectStore('saves').get(app.currentSlot);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
  const before = await row();
  // The bot plays turns that no save has seen. It never stops, so the turn is read in the same tick
  // as the save, and the row as soon as the write lands.
  for (let i = 0; i < 60 && app.g.turn === before?.turn; i++) api.step();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  const turn = app.g.turn;
  delete (document as any).hidden;
  let after = before;
  for (let i = 0; i < 100 && after?.turn !== turn; i++) { await new Promise(r => setTimeout(r, 10)); after = await row(); }
  return { turn, before: before?.turn, after: after?.turn };
});

// The touch bar offers YES and NO only where the screen asks a question: on the title screen 'n'
// means NEW GAME.
const yesNo = await page.evaluate(() => {
  const app = (window as any).__game.api.app;
  const plain = app.touch.buttons(false).map((b: any) => b.key);
  const asking = app.touch.buttons(true).map((b: any) => b.key);
  return { plainHasYesNo: plain.includes('y') || plain.includes('n'), askingHasYesNo: asking.includes('y') && asking.includes('n') };
});

// The title screen offers CONTINUE with a summary of the latest hero, and continuing hands that
// hero straight to the bot.
await page.evaluate(() => (window as any).__game.api.app.quitToTitle());
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'smoke-title-continue.png') });
const continued = await page.evaluate(async () => {
  const api = (window as any).__game.api, app = api.app;
  const title = app.overlays[app.overlays.length - 1];
  const rows = title.rows(app).map((r: any) => r.id);
  const old = app.g;
  app.handleKeyPublic({ key: 'c', shift: false, ctrl: false, alt: false, code: '' });
  for (let i = 0; i < 200 && app.g === old; i++) await new Promise(r => setTimeout(r, 5));
  const turn = app.g.turn;
  for (let i = 0; i < 240; i++) api.step();
  return { rows, started: app.started, name: app.g?.player?.name, played: app.g.turn > turn };
});

// The saved-heroes screen itself renders.
await page.evaluate(() => {
  const app = (window as any).__game.api.app;
  app.quitToTitle();
  app.handleKeyPublic({ key: 's', shift: false, ctrl: false, alt: false, code: '' });
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'smoke-saves.png') });
const savesScreen = await page.evaluate(() => {
  const app = (window as any).__game.api.app;
  const top = app.overlays[app.overlays.length - 1];
  return { overlay: top && top.constructor && top.constructor.name, listed: app.slots.length, first: app.slots[0] && app.slots[0].name };
});
const savesColours = await colours();
await page.evaluate(() => (window as any).__game.api.app.handleKeyPublic({ key: 'Enter', shift: false, ctrl: false, alt: false, code: '' }));
await page.waitForTimeout(500);
const hasLore = await page.evaluate(() => !!localStorage.getItem('gauntlet-of-angband.lore.v1'));

// Every race and class combination has its own sprite: the contact sheet draws all of them (both
// sexes) and no two may be pixel-identical. The sheet is left in dist/ for the eye to check too.
const sheets = { male: await drawHeroSheet(page, { scale: 2, sex: 'male' }), female: await drawHeroSheet(page, { scale: 2, sex: 'female' }) };
fs.writeFileSync(path.join(OUT, 'smoke-heroes.png'), Buffer.from(sheets.male.png.split(',')[1], 'base64'));
const heroDupes = [...duplicateHeroes(sheets.male.hashes).map(d => 'male ' + d), ...duplicateHeroes(sheets.female.hashes).map(d => 'female ' + d)];
const heroCombos = sheets.male.races * sheets.male.classes;

// Death is not the end: the hero falls, and a moment later wakes in the town naked, keeping its
// level, with the bot still playing it.
const respawn = await page.evaluate(() => {
  const api = (window as any).__game.api, app = api.app, g = api.game;
  const lev = g.player.lev, gold = g.player.gold, deaths = g.player.deaths || 0;
  g.player.dead = true; g.player.deathCause = 'a smoke test';
  // The fall stays on screen for a moment; the state is read the frame the hero wakes, before the
  // bot has had a turn to go shopping.
  for (let i = 0; i < 200 && g.player.dead; i++) api.step();
  const p = g.player;
  const woke = { dead: p.dead, depth: p.depth, died: (p.deaths || 0) - deaths, naked: !p.equip.weapon && !p.equip.body && p.inven.length === 0, lev: p.lev === lev, gold: p.gold >= gold - 50, full: p.chp === p.mhp, deathScreen: app.overlays.length > 0 };
  const turn = g.turn;
  for (let i = 0; i < 240; i++) api.step();
  return { ...woke, playsOn: g.turn > turn };
});

// NEW GAME lets chance build the hero and hands it to the bot at once.
const fresh = await page.evaluate(async () => {
  const api = (window as any).__game.api, app = api.app;
  app.quitToTitle();
  app.handleKeyPublic({ key: 'n', shift: false, ctrl: false, alt: false, code: '' });
  await new Promise(r => setTimeout(r, 200));
  const g = app.g, depth = g.player.depth, turn = g.turn;
  for (let i = 0; i < 240; i++) api.step();
  return { started: app.started, overlays: app.overlays.length, depth, name: g.player.name, played: g.turn > turn };
});

// A second hero made through the full birth API with point-bought stats and birth options.
await page.evaluate(() => (window as any).__game.api.newGame2('Smoke2', 'ent', 'necromancer', 'female', { stats: { STR: 12, INT: 17, WIS: 10, DEX: 10, CON: 12, CHR: 10 }, options: { ironman: true, smartMonsters: true }, history: 'Grown in a test.' }));
await page.waitForTimeout(300);
const state3 = await page.evaluate(() => { const g = (window as any).__game.api.game; return { cls: g.player.cls, ironman: g.options.ironman, int: g.player.statBase.INT, hp: g.player.chp }; });

// Installing to a phone: the manifest the page links parses, its icons are the sizes it says, and
// Chromium objects to nothing but the private window the test runs in.
const install = await page.evaluate(async () => {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!link || !touch) return null;
  const size = async (href: string): Promise<string> => { const img = new Image(); img.src = href; await img.decode(); return `${img.naturalWidth}x${img.naturalHeight}`; };
  const m = await (await fetch(link.href)).json();
  const sized = await Promise.all(m.icons.map(async (i: { src: string; sizes: string }) => await size(new URL(i.src, link.href).href) === i.sizes));
  return { display: m.display, icons: sized.length, sized: sized.every(Boolean), touchIcon: await size(touch.href) };
});
const cdp = await page.context().newCDPSession(page);
const installErrors = ((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors as { errorId: string }[])
  .map(e => e.errorId).filter(id => id !== 'in-incognito');
await page.close();

// Offline: once the service worker has seen the game, it starts with the server gone. Only the
// published build registers the worker, so the test does it here, and a second visit under it keeps
// every module the dev page loads. Last, because it stops the server.
const offlinePage = await browser.newPage({ viewport: { width: 960, height: 540 } });
offlinePage.on('pageerror', (e: Error) => errors.push('offline pageerror: ' + e.message));
offlinePage.on('console', (m: any) => { if (m.type() === 'error') errors.push('offline console: ' + m.text()); });
const booted = () => offlinePage.waitForFunction(() => (window as any).__game?.ready === true, null, { timeout: 20000 });
await offlinePage.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
await booted();
await offlinePage.evaluate(() => navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready));
await offlinePage.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
await offlinePage.reload({ waitUntil: 'load' });
await booted();
server.close();
server.closeAllConnections();
await offlinePage.reload({ waitUntil: 'load' }).catch(() => { /* judged by whether the game boots */ });
const offline = await booted().then(async () => {
  await offlinePage.waitForTimeout(400);
  return { colours: await colours(offlinePage), controlled: await offlinePage.evaluate(() => !!navigator.serviceWorker.controller) };
}, () => null);

await browser.close();

let bad = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? '  ok:   ' : '  FAIL: ') + msg); if (!cond) bad++; };
ok(errors.length === 0, `no page errors${errors.length ? ' -> ' + errors.join(' | ') : ''}`);
ok(titleColours > 12, `title screen drew (${titleColours} colours)`);
ok(townColours > 30, `town drew (${townColours} colours)`);
ok(state1.depth === 0 && state1.hp > 0, `character created in town at ${state1.x},${state1.y} with ${state1.monsters} townsfolk`);
ok(state2.depth >= 1, `taken down to dungeon level ${state2.depth} (${state2.monsters} monsters, ${state2.items} objects, turn ${state2.turn})`);
ok(dungeonColours > 30, `dungeon drew (${dungeonColours} colours)`);
ok(saveInfo.rows >= 1 && saveInfo.hasData && saveInfo.name === 'Smoke', `ctrl+S wrote a slot to IndexedDB (${JSON.stringify(saveInfo)})`);
ok(saveInfo.slots >= 1 && saveInfo.hasSaveFlag, 'the saved hero shows in the slot list');
ok(!saveInfo.legacy, 'nothing is left behind in the old single-key save');
ok(reloaded.started && reloaded.name === 'Smoke' && reloaded.depth === saveInfo.depth, `the slot loads back into the same hero (${JSON.stringify(reloaded)})`);
ok(savesScreen.overlay === 'SaveSlotsOverlay' && savesScreen.listed >= 1 && savesScreen.first === 'Smoke' && savesColours > 4,
  `the saved-heroes screen lists the hero (${JSON.stringify(savesScreen)}, ${savesColours} colours)`);
ok(fallback.listed && fallback.alongside, `a hero in the localStorage fallback is listed beside the IndexedDB ones (${JSON.stringify(fallback)})`);
ok(!fallback.leftBehind && !fallback.stillListed, 'deleting a fallback hero clears it from both stores');
ok(staleness.ok && staleness.name === 'Newer' && staleness.savedAt && staleness.restored === 'Smoke', `the newer of two copies of a slot wins (${JSON.stringify(staleness)})`);
ok(hidden.after === hidden.turn && hidden.before !== hidden.turn, `leaving the screen saves the hero at once (${JSON.stringify(hidden)})`);
ok(!yesNo.plainHasYesNo && yesNo.askingHasYesNo, `the touch bar offers YES/NO only where the screen asks (${JSON.stringify(yesNo)})`);
ok(soundsPlayed >= 30, `every sound recipe synthesised without throwing (${soundsPlayed} played)`);
ok(hasLore, 'monster memory persisted to localStorage');
ok(knowledgeColours > 12, `knowledge browser drew (${knowledgeColours} colours)`);
ok(touchMap.detected && !touchMap.shownOnMap && touchMap.onMap.every((o: string | null) => o === null) && touchMap.panel === 'InventoryScreen' && touchMap.shownOnScreen,
  `a tap on the map presses nothing and the touch bar stays off it; the side panel opens the pack, with the bar under it (${JSON.stringify(touchMap)})`);
ok(touchColours > 30, `the touch bar drew (${touchColours} colours)`);
ok(touchBar.esc === 'Escape' && touchBar.closed && !touchBar.forcedOnMap && touchBar.forcedOnScreen, `the bar's ESC closes the screen, and the option forces the bar on only under a screen (${JSON.stringify(touchBar)})`);
ok(dumpLen > 200, `character dump has ${dumpLen} characters`);
ok(botPlays.turn > start.turn && (botPlays.x !== start.x || botPlays.y !== start.y || botPlays.depth !== 0), `the bot plays a new hero from the start, with nothing switched on (${botPlays.turn - start.turn} game turns)`);
ok(uninterrupted.turns > 0 && uninterrupted.overlays === 0, `no key press or click stops the bot or opens a prompt (${JSON.stringify(uninterrupted)})`);
ok(inert.acted.length === 0, `no key plays the hero (${inert.tried} tried${inert.acted.length ? '; these acted: ' + inert.acted.join(', ') : ''})`);
const LOOKS: Record<string, string> = { i: 'InventoryScreen', e: 'InventoryScreen', C: 'CharSheet', M: 'MapOverlay', x: 'LookMode', '~': 'KnowledgeOverlay', '=': 'OptionsOverlay', O: 'IgnoreOverlay', V: 'HighScoresOverlay', '?': 'HelpOverlay' };
ok(Object.entries(LOOKS).every(([k, v]) => behind.screens[k] === v), `the keys that look still open their screens (${JSON.stringify(behind.screens)})`);
ok(behind.turns > 0 && behind.open === 'CharSheet', `the bot plays on behind an open screen (${behind.turns} game turns behind ${behind.open})`);
ok(heroCombos === 187 && heroDupes.length === 0, `every race and class combination has distinct art (${heroCombos} combinations x 2 sexes${heroDupes.length ? '; same: ' + heroDupes.slice(0, 5).join(', ') + (heroDupes.length > 5 ? ` and ${heroDupes.length - 5} more` : '') : ''})`);
ok(state3.cls === 'necromancer' && state3.ironman === true && state3.int >= 17 && state3.hp > 0, `birth with point-buy and birth options works (${JSON.stringify(state3)})`);
ok(continued.rows[0] === 'continue' && continued.started && continued.name === 'Smoke' && continued.played, `CONTINUE heads the title screen and resumes the latest hero with the bot playing (${JSON.stringify(continued)})`);
ok(!respawn.dead && respawn.depth === 0 && respawn.died === 1 && respawn.naked && respawn.lev && respawn.gold && respawn.full && respawn.playsOn && !respawn.deathScreen,
  `a hero that dies wakes in the town naked, keeping its level and gold, and the bot plays on (${JSON.stringify(respawn)})`);
ok(fresh.started && fresh.overlays === 0 && fresh.played && fresh.depth === 0 && !!fresh.name, `NEW GAME starts a random hero with the bot playing (${JSON.stringify(fresh)})`);
ok(!!install && install.display === 'fullscreen' && install.icons >= 2 && install.sized && install.touchIcon === '180x180', `the manifest and icons a phone installs from are right (${JSON.stringify(install)})`);
ok(installErrors.length === 0, `Chromium would install the page${installErrors.length ? ' -> ' + installErrors.join(', ') : ''}`);
ok(!!offline && offline.controlled && offline.colours > 12, `the service worker starts the game with the server gone (${JSON.stringify(offline)})`);
console.log(bad ? '\nSMOKE FAILED' : '\nSMOKE OK: the game runs in a browser with no build step. Screenshots in dist/.');
process.exit(bad ? 1 : 0);
