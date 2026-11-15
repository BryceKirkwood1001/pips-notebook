/** Builds the real app (mock LLM, in-memory storage, the repo's sample lessons) and wraps app.inject. */
import { join } from 'node:path';
import { buildApp } from '../../src/app';
import { createContainer, type ContainerOptions } from '../../src/container';
import type { Env } from '../../src/config';
import { createDirectorySampleSource } from '../../src/node/samples';
import { createTestClock, type TestClock } from './fakes';

export interface Reply {
  status: number;
  body: any;
}

export interface TestApp {
  app: ReturnType<typeof buildApp>;
  container: Awaited<ReturnType<typeof createContainer>>;
  clock: TestClock;
  get(path: string): Promise<Reply>;
  post(path: string, body?: unknown): Promise<Reply>;
  /** Any method, e.g. DELETE. */
  send(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<Reply>;
  close(): Promise<void>;
}

/** createContainer with the repo's sample lessons (samples/cache) unless the test gives its own. */
export function createTestContainer(options: ContainerOptions = {}) {
  return createContainer({ samples: createDirectorySampleSource(), ...options });
}

export async function startTestApp(
  env: Env = {},
  options: { seed?: number; clock?: TestClock; samplesDir?: string } = {},
): Promise<TestApp> {
  const clock = options.clock ?? createTestClock();
  const container = await createTestContainer({
    env: { LLM_PROVIDER: 'mock', DEBUG: 'true', ...env },
    seed: options.seed ?? 42,
    clock,
    ...(options.samplesDir ? { samples: createDirectorySampleSource(join(options.samplesDir, 'cache')) } : {}),
  });
  const app = buildApp(container);
  const send = async (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<Reply> => {
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
    send,
    close: () => app.close(),
  };
}
