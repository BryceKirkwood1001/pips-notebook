/**
 * Composition root: builds every dependency and hands back the services. It runs in the browser
 * (browser/main.ts) and in Node tests alike.
 *
 *   const container = await createContainer({ storage, settingsStore, samples });     // the browser
 *   const container = await createContainer({ env: { LLM_PROVIDER: 'mock', DEBUG: 'true' }, seed: 42 });  // tests
 *
 * The dependency graph itself is built in `wiring.ts`.
 */
import { loadConfig, type Config, type Env } from './config';
import { systemClock, type Clock } from './engine/types';
import { noSamples, type SampleSource } from './samples';
import type { Services } from './services/types';
import { wire, type WiringOptions } from './wiring';
import { createApiSettingsManager, type ApiSettingsManager, type LlmFactory, type SettingsStore } from './settings';
import { createStorageController, openMemoryStorage, type OpenStorage, type StorageController } from './storage';

export interface ContainerOptions {
  /** Configuration values (the old environment variables). Default: all defaults, which means Offline. */
  env?: Env;
  /** Fake time for tests (deadlines, timestamps). Default: the system clock. */
  clock?: Clock;
  /** Fixed RNG seed for every run created through this container. Default: random per run. */
  seed?: number;
  /** The bundled sample lessons. Default: none. */
  samples?: SampleSource;
  /** Where the player's AI settings and keys are saved. Default: memory (this container only). */
  settingsStore?: SettingsStore;
  llmFactory?: LlmFactory;
  /** The opened storage. Default: memory. */
  storage?: OpenStorage;
  whilePreparing?: WiringOptions['whilePreparing'];
  preparingElsewhere?: WiringOptions['preparingElsewhere'];
}

export interface Container {
  config: Config;
  clock: Clock;
  services: Services;
  settings: ApiSettingsManager;
  storage: StorageController;
  /** Waits for background work, then closes the storage. */
  close(): Promise<void>;
}

export async function createContainer(options: ContainerOptions = {}): Promise<Container> {
  const config = loadConfig(options.env ?? {});
  const clock = options.clock ?? systemClock;
  const settings = await createApiSettingsManager(config, { store: options.settingsStore, llmFactory: options.llmFactory });
  const storage = await createStorageController({
    storage: options.storage ?? openMemoryStorage(),
    now: () => clock.now(),
    build: (opened) => wire({
      config, clock, settings, storage: opened, llmFactory: options.llmFactory, seed: options.seed,
      samples: options.samples ?? noSamples, whilePreparing: options.whilePreparing, preparingElsewhere: options.preparingElsewhere,
    }),
  });
  return { config, clock, services: storage.services(), settings, storage, close: () => storage.close() };
}
