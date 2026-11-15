/** Node only (tests, scripts, the build): the samples in a folder of `<id>.json` fixtures. Never bundled for the browser. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SampleSource } from '../samples';

/** The repo's `samples/cache/` folder. */
export const SAMPLES_CACHE_DIR = fileURLToPath(new URL('../../../samples/cache', import.meta.url));

/** `dir` is the folder holding `<id>.json` (default: samples/cache). */
export function createDirectorySampleSource(dir: string = SAMPLES_CACHE_DIR): SampleSource {
  return {
    async list() {
      let files: string[];
      try { files = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'index.json'); } catch { return []; }
      const out: { id: string; title: string }[] = [];
      for (const file of files) {
        const id = file.replace(/\.json$/, '');
        try {
          const json = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as { pack?: { title?: string } };
          out.push({ id, title: json.pack?.title || id });
        } catch {
          // An unreadable fixture is simply not offered.
        }
      }
      return out;
    },
    async read(id) {
      try { return JSON.parse(await readFile(path.join(dir, `${id}.json`), 'utf8')); } catch { return null; }
    },
  };
}
