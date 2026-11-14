/** Builds the real app (mock LLM, in-memory storage) and wraps app.inject. */
import { buildApp } from '../../src/app';
import { createContainer } from '../../src/container';
import type { Env } from '../../src/config';
import { createTestClock, type TestClock } from './fakes';

export interface Reply {
  status: number;
  body: any;
}

export interface TestApp {
  app: Awaited<ReturnType<typeof buildApp>>;
  container: Awaited<ReturnType<typeof createContainer>>;
  clock: TestClock;
  get(path: string): Promise<Reply>;
  post(path: string, body?: unknown): Promise<Reply>;
  close(): Promise<void>;
}

export async function startTestApp(env: Env = {}, options: { seed?: number; clock?: TestClock } = {}): Promise<TestApp> {
  const clock = options.clock ?? createTestClock();
  const container = await createContainer({
    env: { LLM_PROVIDER: 'mock', DEBUG: 'true', ...env },
    seed: options.seed ?? 42,
    clock,
  });
  const app = await buildApp(container);
  const send = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply> => {
    const res = await app.inject({ method, url: path, ...(body !== undefined ? { payload: body as object } : {}) });
    let parsed: unknown = null;
    try {
      parsed = res.body ? JSON.parse(res.body) : null;
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed };
  };
  return {
    app, container, clock,
    get: (p) => send('GET', p),
    post: (p, b) => send('POST', p, b),
    close: () => app.close(),
  };
}
