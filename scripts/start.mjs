#!/usr/bin/env node
/**
 * One command to play: installs what is missing, starts the server (which also serves the game) and
 * opens the browser. `npm start`, `start.command` (macOS) and `start.bat` (Windows) all run this file.
 *
 *   node scripts/start.mjs              start on PORT from the environment or .env, else 8787
 *   node scripts/start.mjs --port 9000  start on another port
 *   node scripts/start.mjs --no-open    do not open a browser tab
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

// 3. Port: --port, then PORT from the environment, then from .env, then 8787. A busy port moves to the next free one.
const envFilePort = () => {
  try {
    return fs.readFileSync(path.join(root, '.env'), 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m)?.[1];
  } catch {
    return undefined;
  }
};
const portFlag = process.argv.indexOf('--port');
const rawPort = String((portFlag > 0 && process.argv[portFlag + 1]) || process.env.PORT || envFilePort() || 8787);
const wanted = Number(rawPort);
if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) fail(`"${rawPort}" is not a valid port.`);
// Probe exactly the address the server binds (server/src/index.ts listens on 0.0.0.0).
const isFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer().once('error', () => resolve(false));
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
  });
const isOurs = async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok && typeof (await res.json()).llmProvider === 'string';
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
    say(`Pip's Notebook is already running at http://localhost:${port}`);
    openBrowser(`http://localhost:${port}`);
    process.exit(0);
  }
  if (await isFree(port)) break;
  if (port >= wanted + 20) fail(`Ports ${wanted}-${port} are all busy. Set PORT to a free port and run this again.`);
  port += 1;
}
if (port !== wanted) say(`Port ${wanted} is busy, using ${port} instead.`);

if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
  say('The game build (client/dist) is missing, so only the API will run. Rebuild it with `npm run build:game`.');
}

// 4. Server, which also serves the game. tsx runs the TypeScript directly.
say('Starting Pip\'s Notebook...');
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port) },
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    server.kill(signal);
  });
}
server.on('exit', (code) => {
  if (!stopping && code) console.error('\n[start] The server stopped with an error (see above).');
  process.exit(code ?? 0);
});

// 5. Open the browser once the API answers.
const url = `http://localhost:${port}`;
for (let i = 0; i < 120 && server.exitCode === null; i++) {
  if ((await isOurs(port)) && server.exitCode === null) {
    say(`Ready: ${url}  (press Ctrl+C to stop)`);
    openBrowser(url);
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
