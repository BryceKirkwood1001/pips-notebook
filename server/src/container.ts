/**
 * Composition root: builds every dependency from the config and hands back the services.
 *
 *   const container = await createContainer();                       // from .env / process.env
 *   const container = await createContainer({ env: { LLM_PROVIDER: 'mock', DEBUG: 'true' }, seed: 42 });
 *
 * The dependency graph itself is built in `wiring.ts`.
 */
import { loadConfig, loadConfigFromProcess, type Config, type Env } from './config';
import { systemClock, type Clock } from './engine/types';
import type { Services } from './services/types';
import { wire } from './wiring';
import { fileURLToPath } from 'node:url';
import { createApiSettingsManager, type ApiSettingsManager, type LlmFactory } from './settings';

export interface ContainerOptions {
  /** Read config from this object instead of `.env` + `process.env`. Tests always pass this. */
  env?: Env;
  /** Fake time for tests (deadlines, timestamps). Default: the system clock. */
  clock?: Clock;
  /** Fixed RNG seed for every run created through this container. Default: random per run. */
  seed?: number;
  /** Where `<sample>.md` and `cache/<sample>.json` live. Default: the repo's `samples/` folder. */
  samplesDir?: string;
  /** Tests default to session-only settings. The server persists to the ignored .local folder. */
  settingsFile?: string | false;
  llmFactory?: LlmFactory;
  /** Real server defaults to .local/archive; tests stay in memory unless explicitly set. */
  dataDir?: string | false;
}

export interface Container {
  config: Config;
  clock: Clock;
  services: Services;
  settings: ApiSettingsManager;
  /** Closes the database connection, if any. */
  close(): Promise<void>;
}

export async function createContainer(options: ContainerOptions = {}): Promise<Container> {
  const config = options.env ? loadConfig(options.env) : loadConfigFromProcess();
  const clock = options.clock ?? systemClock;
  const file = options.settingsFile === false ? undefined : options.settingsFile ?? (options.env ? undefined : fileURLToPath(new URL('../../.local/api-settings.json', import.meta.url)));
  const settings = await createApiSettingsManager(config, { file, llmFactory: options.llmFactory });
  const dataDir = options.dataDir === false ? undefined : options.dataDir ?? (options.env ? undefined : fileURLToPath(new URL('../../.local/archive', import.meta.url)));
  const wired = await wire({ config, clock, settings, dataDir, llmFactory: options.llmFactory, seed: options.seed, samplesDir: options.samplesDir });
  return {
    config,
    clock,
    services: wired.services,
    settings,
    close: wired.close,
  };
}
