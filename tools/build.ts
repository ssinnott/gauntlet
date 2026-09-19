// Bundle src/main.ts into a self-contained dist/index.html that can be opened from disk or served
// anywhere (GitHub Pages included). Same shape as game-engine/tools/build.ts.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');
fs.mkdirSync(OUT_DIR, { recursive: true });

const result = await build({
  entryPoints: [path.join(ROOT, 'src', 'main.ts')],
  bundle: true, format: 'iife', target: ['es2022'], minify: true, legalComments: 'none', write: false, logLevel: 'error',
});
const out = result.outputFiles[0];
if (!out) throw new Error('esbuild produced no output file');
const js = out.text.replace(/<\/script/gi, '<\\/script');

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const tagRe = /<script[^>]*type=["']module["'][^>]*src=["'][^"']*main\.ts["'][^>]*>\s*<\/script>/i;
if (!tagRe.test(html)) throw new Error('index.html: could not find <script type="module" src="src/main.ts"> to inline');
html = html.replace(tagRe, () => `<script>\n${js}\n</script>`);
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
console.log(`built dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
