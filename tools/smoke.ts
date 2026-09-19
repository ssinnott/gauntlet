// Headless proof the game runs in a browser: serves the repo through tools/server.ts, loads the
// page, creates a character through the debug API, walks into the dungeon, opens the inventory,
// and asserts the canvas has real content and the page raised no errors. Also writes screenshots
// to dist/smoke-*.png so the look can be reviewed.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from './server.ts';

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

const colours = async () => page.evaluate(() => {
  const c = document.getElementById('stage') as HTMLCanvasElement;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set<number>();
  for (let i = 0; i < d.length; i += 16) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return seen.size;
});
const titleColours = await colours();

// New game through the API, then walk around the town and down the stairs.
await page.evaluate(() => (window as any).__game.api.newGame('Smoke', 'dwarf', 'warrior', 'male'));
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'smoke-town.png') });
const townColours = await colours();
const state1 = await page.evaluate(() => { const g = (window as any).__game.api.game; return { depth: g.level.depth, hp: g.player.chp, x: g.player.x, y: g.player.y, monsters: g.level.monsters.length }; });

// Walk onto the stairs (the town start is two tiles south of them) and descend.
await page.evaluate(() => { const api = (window as any).__game.api; api.key('ArrowUp'); api.key('ArrowUp'); api.key('>'); });
await page.waitForTimeout(600);
await page.evaluate(() => { const api = (window as any).__game.api; for (let i = 0; i < 6; i++) api.key(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'][i % 4]); });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, 'smoke-dungeon.png') });
const dungeonColours = await colours();
const state2 = await page.evaluate(() => { const g = (window as any).__game.api.game; return { depth: g.level.depth, hp: g.player.chp, monsters: g.level.monsters.length, items: g.level.items.length, turn: g.turn }; });

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

// Save round trip through localStorage.
await page.evaluate(() => (window as any).__game.api.key('s', false, true));
const hasSave = await page.evaluate(() => !!localStorage.getItem('gauntlet-of-angband.save.v1'));
const hasLore = await page.evaluate(() => !!localStorage.getItem('gauntlet-of-angband.lore.v1'));

// A second hero made through the full birth API with point-bought stats and birth options.
await page.evaluate(() => (window as any).__game.api.newGame2('Smoke2', 'ent', 'necromancer', 'female', { stats: { STR: 12, INT: 17, WIS: 10, DEX: 10, CON: 12, CHR: 10 }, options: { ironman: true, smartMonsters: true }, history: 'Grown in a test.' }));
await page.waitForTimeout(300);
const state3 = await page.evaluate(() => { const g = (window as any).__game.api.game; return { cls: g.player.cls, ironman: g.options.ironman, int: g.player.statBase.INT, hp: g.player.chp }; });

await browser.close();
server.close();

let bad = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? '  ok:   ' : '  FAIL: ') + msg); if (!cond) bad++; };
ok(errors.length === 0, `no page errors${errors.length ? ' -> ' + errors.join(' | ') : ''}`);
ok(titleColours > 12, `title screen drew (${titleColours} colours)`);
ok(townColours > 30, `town drew (${townColours} colours)`);
ok(state1.depth === 0 && state1.hp > 0, `character created in town at ${state1.x},${state1.y} with ${state1.monsters} townsfolk`);
ok(state2.depth === 1, `descended to dungeon level ${state2.depth} (${state2.monsters} monsters, ${state2.items} objects, turn ${state2.turn})`);
ok(dungeonColours > 30, `dungeon drew (${dungeonColours} colours)`);
ok(hasSave, 'ctrl+S wrote a save to localStorage');
ok(hasLore, 'monster memory persisted to localStorage');
ok(knowledgeColours > 12, `knowledge browser drew (${knowledgeColours} colours)`);
ok(dumpLen > 200, `character dump has ${dumpLen} characters`);
ok(state3.cls === 'necromancer' && state3.ironman === true && state3.int >= 17 && state3.hp > 0, `birth with point-buy and birth options works (${JSON.stringify(state3)})`);
console.log(bad ? '\nSMOKE FAILED' : '\nSMOKE OK: the game runs in a browser with no build step. Screenshots in dist/.');
process.exit(bad ? 1 : 0);
