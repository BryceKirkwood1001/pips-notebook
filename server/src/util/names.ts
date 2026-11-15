/**
 * Small helpers that replace `node:crypto` and `node:path` so the same code runs in a browser and in Node.
 */

/** A random hex id of `length` characters. Uses the Web Crypto API, which works on plain http pages too. */
export function randomHex(length = 32): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

/** The last segment of a file name or path ("notes/week 1.md" -> "week 1.md"). */
export function basename(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

/** The extension with its dot, as written (".md"); "" when there is none. A leading dot is not one. */
export function extname(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

/** The file name without its extension ("week 1.md" -> "week 1"). */
export function stem(name: string): string {
  const base = basename(name);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/** A random version-4 UUID. `crypto.randomUUID()` exists only on https pages, so this one works on plain http too. */
export function randomUuid(): string {
  const h = randomHex(32).split('');
  h[12] = '4';
  h[16] = '89ab'[parseInt(h[16], 16) & 3];
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
