import type { Chunk } from '@pips-notebook/shared';

/** Position of a chunk inside its page: the trailing `_n` of `${course}_${file}_p${page}_${n}`. */
const posOf = (id: string) => Number(id.slice(id.lastIndexOf('_') + 1)) || 0;

/** Orders chunks by file, page and position (natural order, so f2 < f10 and p2 < p10). */
export function compareChunks(a: Chunk, b: Chunk): number {
  return (
    a.fileId.localeCompare(b.fileId, 'en', { numeric: true }) || a.page - b.page || posOf(a.id) - posOf(b.id)
  );
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
