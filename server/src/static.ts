/**
 * Serves the game next to the API, so one process on one port runs everything (`npm start`).
 *
 * The game is the committed Phaser AE build in `client/dist/` (index.html, game.js, text-shaper.wasm).
 * Its pictures, music and styles are served straight from `client/game/media/`, which the build only
 * copies, so the committed bundle stays small. Without a build, the server runs as an API only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const clientDir = fileURLToPath(new URL('../../client/', import.meta.url));
export const GAME_DIR = path.join(clientDir, 'dist');
export const MEDIA_DIR = path.join(clientDir, 'game', 'media');

/** True when the game build is present and was registered. */
export async function registerGame(app: FastifyInstance): Promise<boolean> {
  if (!fs.existsSync(path.join(GAME_DIR, 'index.html'))) return false;
  await app.register(fastifyStatic, { root: MEDIA_DIR, prefix: '/media/' });
  await app.register(fastifyStatic, { root: GAME_DIR, prefix: '/', decorateReply: false });
  // The tab icon (Pip's smiling face). The page links it too; this covers browsers that ask before the game loads.
  app.get('/favicon.ico', (_req, reply) => reply.sendFile('pip-icon.png', MEDIA_DIR));
  return true;
}
