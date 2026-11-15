#!/usr/bin/env node
/**
 * Builds the deployable static site: `npm run build` writes `site/`, a folder any static host can serve
 * (GitHub Pages, Netlify, Cloudflare Pages, a shared hosting plan's public_html). There is no server program:
 *
 *   site/index.html        the page (the game's committed build, client/dist)
 *   site/game.js           the Phaser AE game, and text-shaper.wasm beside it
 *   site/backend.js        the game logic, ingest, RAG and AI calls (server/src/browser/main.ts), plus lazy chunks
 *   site/media/            pictures, music and styles (client/game/media)
 *   site/samples/          the Offline sample lessons (samples/cache) and their index.json
 *
 *   node scripts/build.mjs [--out <folder>]
 *
 * Every URL inside is relative, so the site works at a domain's root or under a path (user.github.io/repo/).
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFlag = process.argv.indexOf('--out');
const out = path.resolve(root, outFlag > 0 ? process.argv[outFlag + 1] : 'site');
const game = path.join(root, 'client', 'dist');
const say = (msg) => console.log(`[build] ${msg}`);
const fail = (msg) => { console.error(`\n[build] ${msg}\n`); process.exit(1); };

if (!fs.existsSync(path.join(game, 'index.html'))) fail('The game build (client/dist) is missing. Rebuild it with `npm run build:game`.');
if (out === root || root.startsWith(out + path.sep)) fail('The output folder must not contain the repository.');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. The backend, for the browser. pdf.js and the Gemini SDK become chunks loaded only when needed.
const result = await build({
  entryPoints: { backend: path.join(root, 'server/src/browser/main.ts') },
  outdir: out,
  chunkNames: 'backend/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'linked',
  metafile: true,
  logLevel: 'warning',
});
const nodeBuiltins = Object.keys(result.metafile.inputs).filter((file) => file.startsWith('node:') || /\(disabled\)/.test(file));
if (nodeBuiltins.length) fail(`The backend bundle pulls in Node-only modules: ${nodeBuiltins.join(', ')}`);

// 2. The game. Its index.html gets a description and starts fetching backend.js while game.js loads.
for (const file of ['game.js', 'text-shaper.wasm']) fs.copyFileSync(path.join(game, file), path.join(out, file));
const page = fs.readFileSync(path.join(game, 'index.html'), 'utf8').replace(
  '</title>',
  '</title><meta name="description" content="Teach Pip from your own notes, then watch Pip take the exam. A learn-by-teaching game that runs in your browser.">'
    + '<link rel="icon" type="image/png" href="./media/pip-icon.png"><link rel="modulepreload" href="./backend.js">',
);
fs.writeFileSync(path.join(out, 'index.html'), page);

// 3. Media: everything the game loads by relative URL (media/...).
fs.cpSync(path.join(root, 'client', 'game', 'media'), path.join(out, 'media'), { recursive: true, filter: (src) => !path.basename(src).startsWith('.') });

// 4. Offline sample lessons and their index. `short` marks packs with their own pace, which the Library lists first.
const samplesOut = path.join(out, 'samples');
fs.mkdirSync(samplesOut);
const cache = path.join(root, 'samples', 'cache');
const samples = [];
for (const file of fs.readdirSync(cache).filter((f) => f.endsWith('.json')).sort()) {
  const id = file.replace(/\.json$/, '');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) continue;
  const fixture = JSON.parse(fs.readFileSync(path.join(cache, file), 'utf8'));
  // Re-serialized without indentation: the same data, about a third smaller.
  fs.writeFileSync(path.join(samplesOut, file), JSON.stringify(fixture));
  samples.push({ id, title: fixture.pack?.title || id, short: !!fixture.pack?.pace });
}
fs.writeFileSync(path.join(samplesOut, 'index.json'), JSON.stringify({ samples }, null, 2) + '\n');

// 5. GitHub Pages: serve files as they are (no Jekyll processing).
fs.writeFileSync(path.join(out, '.nojekyll'), '');

let bytes = 0;
const count = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) count(f); else bytes += fs.statSync(f).size; } };
count(out);
say(`Wrote ${path.relative(root, out) || '.'}/ (${(bytes / 1024 / 1024).toFixed(1)} MB, ${samples.length} sample lessons). Upload that folder to any static host.`);
