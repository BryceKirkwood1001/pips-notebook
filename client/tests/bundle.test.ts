/**
 * The committed build in client/dist must match the game sources, because `npm start` serves it as is.
 * The bake records a SHA-256 of every source it bundled in dist/build.json; this compares them with the
 * files on disk. When it fails, rebuild with `npm run build:game` (needs client/phaser) and commit client/dist.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = JSON.parse(fs.readFileSync(path.join(clientDir, 'dist', 'build.json'), 'utf8')) as {
  sources: Record<string, string>;
};
// The game's own code and the shared API client; engine and pack sources live in the ignored toolkit.
const ours = Object.entries(build.sources).filter(
  ([file]) => (file.startsWith('game/') && !file.includes('node_modules')) || file.startsWith('../shared/'),
);
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('committed game build', () => {
  it('lists the game sources it was built from', () => {
    expect(ours.map(([file]) => file)).toContain('game/main.ts');
    expect(ours.map(([file]) => file)).toContain('../shared/src/api-client.ts');
  });

  it.each(ours)('is current with %s', (file, hash) => {
    const onDisk = path.join(clientDir, file);
    expect(fs.existsSync(onDisk), `${file} is gone; run npm run build:game`).toBe(true);
    expect(sha256(onDisk), `client/dist is older than ${file}; run npm run build:game and commit client/dist`).toBe(hash);
  });
});
