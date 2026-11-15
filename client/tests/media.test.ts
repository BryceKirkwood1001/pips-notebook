/**
 * Every image and audio file in client/game/media must really be the format its extension says. Chrome sniffs a
 * file's contents and plays a mislabeled one anyway; Safari trusts the type the server sends from the extension and
 * refuses it (the soundtrack was QuickTime movies named .mp3 and was silent in Safari).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const media = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'game', 'media');
const files = fs.readdirSync(media, { recursive: true, encoding: 'utf8' })
  .filter((file) => fs.statSync(path.join(media, file)).isFile());

/** What the first bytes of each kind of file must look like. */
const signatures: Record<string, (head: Buffer) => boolean> = {
  '.png': (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.m4a': (h) => h.toString('latin1', 4, 8) === 'ftyp' && ['M4A ', 'M4B ', 'mp41', 'mp42', 'isom'].includes(h.toString('latin1', 8, 12)),
  '.mp3': (h) => h.toString('latin1', 0, 3) === 'ID3' || (h[0] === 0xff && (h[1]! & 0xe0) === 0xe0),
  '.ogg': (h) => h.toString('latin1', 0, 4) === 'OggS',
  '.wav': (h) => h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WAVE',
};

describe('game media', () => {
  const checked = files.filter((file) => path.extname(file).toLowerCase() in signatures);

  it('has images and music to check', () => {
    expect(checked.some((f) => f.endsWith('.png'))).toBe(true);
    expect(checked.some((f) => f.startsWith('music'))).toBe(true);
  });

  it.each(checked)('%s is really the format its extension says', (file) => {
    const head = Buffer.alloc(16);
    const fd = fs.openSync(path.join(media, file), 'r');
    try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
    expect(signatures[path.extname(file).toLowerCase()]!(head), `${file} starts with ${head.toString('hex')}`).toBe(true);
  });
});
