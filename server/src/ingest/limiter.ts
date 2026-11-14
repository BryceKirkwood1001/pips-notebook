/** A tiny concurrency limiter: at most `max` of the wrapped functions run at once, in call order. */
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const waiting: (() => void)[] = [];

  const release = () => {
    active--;
    const next = waiting.shift();
    if (next) next();
  };

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
