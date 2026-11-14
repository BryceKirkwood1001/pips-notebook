/**
 * Seedable RNG (mulberry32). Deterministic for a given seed, and its whole state is one 32-bit
 * integer, so a run can store it (`run.rngState`) and continue the same sequence on the next request.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** A random element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** A shuffled copy (Fisher-Yates). The input is not modified. */
  shuffle<T>(items: readonly T[]): T[];
  /** The current state. `createRng(rng.state())` continues the sequence. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[int(items.length)];
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    state: () => a,
  };
}

/** A fresh 32-bit seed for a new run. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** Stable 32-bit hash of a string (FNV-1a). Handy for deriving seeds from ids. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
