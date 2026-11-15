/**
 * The deployable static site (`npm run build` -> site/) and the local file server `npm start` uses.
 * The site must work with no server behind it: relative URLs only, no Node modules, no keys.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without types
import { createStaticServer } from '../../scripts/serve.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let out: string;
let server: import('node:http').Server;
let base: string;

beforeAll(async () => {
  out = join(mkdtempSync(join(tmpdir(), 'pips-site-')), 'site');
  execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--out', out], { cwd: root, stdio: 'pipe' });
  server = createStaticServer(out);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);
afterAll(async () => {
  server?.closeAllConnections(); // fetch keeps connections alive
  await new Promise((resolve) => server?.close(resolve));
  rmSync(join(out, '..'), { recursive: true, force: true });
});

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

describe('the static site', () => {
  it('holds the page, the game, the in-page backend, media and the sample lessons', () => {
    for (const file of ['index.html', 'game.js', 'text-shaper.wasm', 'backend.js', 'media/game.css', 'media/music/menu.m4a', 'samples/index.json', '.nojekyll']) {
      expect(existsSync(join(out, file)), file).toBe(true);
    }
    const index = JSON.parse(readFileSync(join(out, 'samples/index.json'), 'utf8'));
    expect(index.samples.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(['seasons', 'binary-search']));
    for (const { id } of index.samples) expect(existsSync(join(out, `samples/${id}.json`))).toBe(true);
  });

  it('uses only relative URLs, so it works at a domain root or under a path', () => {
    const page = readFileSync(join(out, 'index.html'), 'utf8');
    expect(page).toContain('src="./game.js"');
    expect(page).toContain('href="./backend.js"');
    expect(page).not.toMatch(/(src|href)="\/(?!\/)/);
    expect(readFileSync(join(out, 'game.js'), 'utf8')).toContain('new URL("./backend.js", import.meta.url)');
  });

  it('contains no API keys, no Node built-ins and no local paths', () => {
    const scanned = files(out).filter((f) => /\.(js|html|json|css|txt)$/.test(f));
    expect(scanned.length).toBeGreaterThan(5);
    for (const file of scanned) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/AIza[0-9A-Za-z_-]{35}|sk-(proj-)?[A-Za-z0-9_-]{20,}|mongodb(\+srv)?:\/\/[^\s"']*@/);
      expect(text, file).not.toMatch(/\/Users\/[A-Za-z]|[A-Z]:\\\\Users\\\\/);
      if (file.endsWith('.js')) expect(text, file).not.toMatch(/from\s*["']node:|require\(["']node:/);
    }
  });

  it('keeps the first download small: pdf.js and the Gemini SDK load only when needed', () => {
    expect(statSync(join(out, 'backend.js')).size).toBeLessThan(600 * 1024);
  });
});

describe('the local file server (npm start)', () => {
  it('serves the page and the bundles with browser-usable types', async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<div id="game">');
    expect((await fetch(`${base}/backend.js`)).headers.get('content-type')).toContain('javascript');
    expect((await fetch(`${base}/text-shaper.wasm`)).headers.get('content-type')).toBe('application/wasm');
  });

  it('serves media with byte ranges, which Safari needs for audio', async () => {
    const music = await fetch(`${base}/media/music/menu.m4a`, { headers: { range: 'bytes=0-99' } });
    expect(music.status).toBe(206);
    expect(music.headers.get('content-type')).toBe('audio/mp4');
    expect((await music.arrayBuffer()).byteLength).toBe(100);
  });

  it('never serves a file outside the site', async () => {
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json']) {
      expect([403, 404]).toContain((await fetch(base + path)).status);
    }
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });
});
