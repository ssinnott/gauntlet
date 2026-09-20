// Contact sheet of the hero sprite: every race down the side, every class across the top, each
// drawn with its starting weapon, so an art pass can be reviewed at a glance. Writes dist/heroes.png
// and prints how many of the race/class combinations render identically to another (they should
// all differ). Usage: node tools/sheet.ts [scale] [male|female] [race,race,...] [class,class,...]
// (the lists narrow the sheet to those ids; the default is everything).
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

const SCALE = Number(process.argv[2] || 3);
const SEX = process.argv[3] === 'female' ? 'female' : 'male';
const ONLY_RACES = process.argv[4] ? process.argv[4].split(',') : null;
const ONLY_CLASSES = process.argv[5] ? process.argv[5].split(',') : null;

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


const result = await drawHeroSheet(page, { scale: SCALE, sex: SEX, onlyRaces: ONLY_RACES, onlyClasses: ONLY_CLASSES });
await browser.close();
server.close();

const file = path.join(OUT, 'heroes.png');
fs.writeFileSync(file, Buffer.from(result.png.split(',')[1], 'base64'));
const dupes = duplicateHeroes(result.hashes);
for (const d of dupes) console.log('  same: ' + d);
console.log(`${result.races} races x ${result.classes} classes -> ${file} (${dupes.length} duplicate${dupes.length === 1 ? '' : 's'})`);
if (errors.length) { console.log('page errors:\n  ' + errors.join('\n  ')); process.exit(1); }
