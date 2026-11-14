/**
 * Composition root: builds every dependency from the config and hands back the services.
 *
 *   const container = await createContainer();                       // from .env / process.env
 *   const container = await createContainer({ env: { LLM_PROVIDER: 'mock', DEBUG: 'true' }, seed: 42 });
 *
 * PHASE 1: only the config is wired. Every service method answers 501 `not_implemented` until the
 * engine, ingest, RAG and LLM modules are integrated (Phase 3). The signatures below are stable.
 */
import { loadConfig, loadConfigFromProcess, type Config, type Env } from './config';
import { systemClock, type Clock } from './engine/types';
import { AppError } from './errors';
import type { Services } from './services/types';

export interface ContainerOptions {
  /** Read config from this object instead of `.env` + `process.env`. Tests always pass this. */
  env?: Env;
  /** Fake time for tests (deadlines, timestamps). Default: the system clock. */
  clock?: Clock;
  /** Fixed RNG seed for every run created through this container. Default: random per run. */
  seed?: number;
  /** Where `<sample>.md` and `cache/<sample>.json` live. Default: the repo's `samples/` folder. */
  samplesDir?: string;
}

export interface Container {
  config: Config;
  clock: Clock;
  services: Services;
  /** Closes the database connection, if any. */
  close(): Promise<void>;
}

const stubServices = (config: Config): Services =>
  new Proxy({} as Services, {
    get: (_target, prop) => {
      if (prop === 'health') {
        return () => ({
          ok: true,
          llmProvider: config.llmProvider,
          storage: config.mongodbUri ? 'mongodb' : 'memory',
          debug: config.debug,
        });
      }
      return () => {
        throw new AppError('not_implemented', `${String(prop)} is not wired yet`);
      };
    },
  });

export async function createContainer(options: ContainerOptions = {}): Promise<Container> {
  const config = options.env ? loadConfig(options.env) : loadConfigFromProcess();
  const clock = options.clock ?? systemClock;
  return {
    config,
    clock,
    services: stubServices(config),
    close: async () => {},
  };
}
