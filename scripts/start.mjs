#!/usr/bin/env node
/**
 * One command to play on this computer: installs what is missing, builds the static site (scripts/build.mjs) and
 * serves it on http://localhost, then opens the browser. `npm start`, `start.command` (macOS) and `start.bat`
 * (Windows) all run this file.
 *
 * The game itself needs no server: this is only a static file server, like the web host the site is deployed to.
 *
 *   node scripts/start.mjs              serve on PORT from the environment, else 8787
 *   node scripts/start.mjs --port 9000  serve on another port
 *   node scripts/start.mjs --no-open    do not open a browser tab
 *   node scripts/start.mjs --no-build   serve the existing site/ folder as it is
 *
 * Plain Node with no dependencies, because it runs before `npm install` has.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_NODE = 22;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (msg) => console.log(`[start] ${msg}`);
const fail = (msg) => {
  console.error(`\n[start] ${msg}\n`);
  process.exit(1);
};

// 1. Node version.
const major = Number(process.versions.node.split('.')[0]);
if (major < MIN_NODE) {
  fail(`Pip's Notebook needs Node.js ${MIN_NODE} or newer; this is ${process.version}. Install the LTS from https://nodejs.org and run this again.`);
}

// 2. Dependencies, reinstalled only when package-lock.json changed since the last install.
const lock = path.join(root, 'package-lock.json');
const stamp = path.join(root, 'node_modules', '.pips-notebook-install');
const lockHash = createHash('sha256').update(fs.readFileSync(lock)).digest('hex');
const installed = fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === lockHash;
if (!installed) {
  say('Installing dependencies (first run only, about a minute)...');
  // Inside `npm start`, npm_execpath is npm's own CLI; otherwise use the npm on PATH (npm.cmd on Windows needs a shell).
  const viaNpm = process.env.npm_execpath?.endsWith('.js');
  const npm = (args) =>
    viaNpm
      ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: root, stdio: 'inherit' })
      : spawnSync('npm', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  const flags = ['--no-audit', '--no-fund', '--loglevel=error'];
  let result = npm(['ci', ...flags]);
  if (result.status !== 0) {
    say('npm ci failed; trying npm install instead...');
    result = npm(['install', ...flags]);
  }
  if (result.error?.code === 'ENOENT') fail('npm was not found. Install Node.js (it includes npm) from https://nodejs.org.');
  if (result.status !== 0) fail('Installing dependencies failed. Check your internet connection, then run this again.');
  fs.writeFileSync(stamp, lockHash);
}

// 3. The site: built fresh each start (about a second), so it always matches the code.
const site = path.join(root, 'site');
if (!process.argv.includes('--no-build') || !fs.existsSync(path.join(site, 'index.html'))) {
  const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) fail('Building the site failed (see above).');
}

// 4. Port: --port, then PORT from the environment, then 8787. A busy port moves to the next free one.
const portFlag = process.argv.indexOf('--port');
const rawPort = String((portFlag > 0 && process.argv[portFlag + 1]) || process.env.PORT || 8787);
const wanted = Number(rawPort);
if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) fail(`"${rawPort}" is not a valid port.`);
const HOST = '127.0.0.1';
// Free means free on every address: another server on 0.0.0.0 or :: would otherwise answer "localhost" instead.
const isFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer().once('error', () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
const isOurs = async (port) => {
  try {
    const res = await fetch(`http://${HOST}:${port}/samples/index.json`, { signal: AbortSignal.timeout(1500) });
    return res.ok && res.headers.get('x-pips-notebook') === 'site' && Array.isArray((await res.json()).samples);
  } catch {
    return false;
  }
};
const openBrowser = (url) => {
  if (process.argv.includes('--no-open') || process.env.CI) return;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]];
  // windowsVerbatimArguments keeps cmd's empty "" window title from being re-quoted.
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).on('error', () => {}).unref();
};

let port = wanted;
for (;;) {
  if (await isOurs(port)) {
    say(`Pip's Notebook is already being served at http://localhost:${port} (it now shows the new build)`);
    openBrowser(`http://localhost:${port}`);
    process.exit(0);
  }
  if (await isFree(port)) break;
  if (port >= wanted + 20) fail(`Ports ${wanted}-${port} are all busy. Set PORT to a free port and run this again.`);
  port += 1;
}
if (port !== wanted) say(`Port ${wanted} is busy, using ${port} instead.`);

// 5. A static file server for site/, with the byte ranges Safari needs to play the music.
const { createStaticServer } = await import('./serve.mjs');
const server = createStaticServer(site);
server.listen(port, HOST, () => {
  const url = `http://localhost:${port}`;
  say(`Ready: ${url}  (press Ctrl+C to stop)`);
  say('Everything runs in your browser; this only serves the files in site/.');
  openBrowser(url);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
