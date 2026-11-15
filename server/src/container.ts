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
import { createStorageController, type MongoConnector, type StorageController } from './storage';

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
  /** Where the storage choice is saved. The server uses .local/storage-settings.json; tests keep it per session. */
  storageFile?: string | false;
  /** Replaces the MongoDB driver connection (tests). */
  connectMongo?: MongoConnector;
}

export interface Container {
  config: Config;
  clock: Clock;
  /** Always the services of the storage in use now, also after Settings switches storage. */
  services: Services;
  settings: ApiSettingsManager;
  storage: StorageController;
  /** Waits for background work, then closes the storage in use. */
  close(): Promise<void>;
}

export async function createContainer(options: ContainerOptions = {}): Promise<Container> {
  const config = options.env ? loadConfig(options.env) : loadConfigFromProcess();
  const clock = options.clock ?? systemClock;
  const file = options.settingsFile === false ? undefined : options.settingsFile ?? (options.env ? undefined : fileURLToPath(new URL('../../.local/api-settings.json', import.meta.url)));
  const settings = await createApiSettingsManager(config, { file, llmFactory: options.llmFactory });
  const dataDir = options.dataDir === false ? undefined : options.dataDir ?? (options.env ? undefined : fileURLToPath(new URL('../../.local/archive', import.meta.url)));
  const storageFile = options.storageFile === false ? undefined : options.storageFile ?? (options.env ? undefined : fileURLToPath(new URL('../../.local/storage-settings.json', import.meta.url)));
  const storage = await createStorageController({
    config, dataDir, file: storageFile, connect: options.connectMongo,
    build: (opened) => wire({ config, clock, settings, storage: opened, llmFactory: options.llmFactory, seed: options.seed, samplesDir: options.samplesDir }),
  });
  // Routes hold this object; every call goes to the services of the storage in use at that moment.
  // Property definitions (test spies) also land on those services.
  const current = () => storage.services() as unknown as Record<PropertyKey, unknown>;
  const services = new Proxy({} as Services, {
    get(_target, key) {
      const target = current();
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set: (_target, key, value) => Reflect.set(current(), key, value),
    has: (_target, key) => Reflect.has(current(), key),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor(_target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    defineProperty: (_target, key, descriptor) => Reflect.defineProperty(current(), key, descriptor),
  });
  return { config, clock, services, settings, storage, close: () => storage.close() };
}
