/**
 * The backend, in the page. scripts/build.mjs bundles this file as `backend.js` next to the game, and the game
 * starts it on first use (client/game/course/backend.ts):
 *
 *   const backend = await (await import('./backend.js')).start();
 *   const api = createApiClient({ fetch: backend.fetch });
 *
 * Everything runs in this browser tab: preparing dungeons from uploads, Pip's AI turns, grading and search.
 * Dungeons, notebooks, expeditions and embeddings are saved in IndexedDB; the player's AI settings and keys in
 * localStorage (or sessionStorage). The only network requests are to the static files next to the page (the
 * sample lessons) and, with a key, to the AI provider the player chose.
 */
import { buildApp } from '../app';
import { createContainer } from '../container';
import { createIndexedDbRepository, createIndexedDbVectorStore, openBrowserDatabase } from '../repo';
import type { DatabaseOptions } from '../repo/indexeddb';
import { createFetchSampleSource } from '../samples';
import type { SettingsPlace, SettingsStore } from '../settings';
import { openMemoryStorage, type OpenStorage, type StorageInfo } from '../storage';

const SETTINGS_KEY = 'pips-notebook.ai-settings';
const LOCK_PREFIX = 'pips-notebook:preparing:';

export interface Backend {
  /** The browser's `fetch` signature, answered in the page. Hand it to createApiClient(). */
  fetch: typeof fetch;
  /** How many uploads are being prepared right now. Closing the page stops them. */
  preparing(): number;
  /** 'browser' when dungeons are saved in IndexedDB; 'memory' when the browser blocked it. */
  storage: 'browser' | 'memory';
}

export interface StartOptions {
  /** Where the sample lessons are, relative to the page. Default: "samples/". */
  samplesUrl?: string;
  /** The IndexedDB database name. Default: "pips-notebook". */
  databaseName?: string;
}

function storageArea(place: SettingsPlace): Storage | null {
  try {
    return place === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null; // storage disabled (some privacy settings throw on access)
  }
}

/** AI settings in localStorage, or sessionStorage when the player chose "only this tab". */
export const browserSettingsStore: SettingsStore = {
  async load() {
    for (const place of ['session', 'local'] as const) {
      const text = storageArea(place)?.getItem(SETTINGS_KEY);
      if (text) return { text, place };
    }
    return null;
  },
  async save(text, place) {
    const area = storageArea(place);
    if (!area) throw new Error('Browser storage is unavailable');
    area.setItem(SETTINGS_KEY, text);
    storageArea(place === 'local' ? 'session' : 'local')?.removeItem(SETTINGS_KEY);
  },
};

async function storageInfo(): Promise<StorageInfo> {
  const manager = globalThis.navigator?.storage;
  const [persisted, estimate] = await Promise.all([
    manager?.persisted?.().catch(() => null) ?? null,
    manager?.estimate?.().catch(() => null) ?? null,
  ]);
  return {
    persisted: typeof persisted === 'boolean' ? persisted : null,
    usageBytes: typeof estimate?.usage === 'number' ? estimate.usage : null,
    quotaBytes: typeof estimate?.quota === 'number' ? estimate.quota : null,
  };
}

/** This browser's IndexedDB storage; memory (with the reason in `error`) when the browser blocks it. */
export async function openBrowserStorage(options: DatabaseOptions = {}): Promise<OpenStorage> {
  try {
    const db = await openBrowserDatabase(options);
    return {
      kind: 'browser',
      repo: createIndexedDbRepository(db),
      store: createIndexedDbVectorStore(db),
      close: async () => db.close(),
      info: storageInfo,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[backend] ${reason}. Dungeons will last only until this page closes.`);
    return openMemoryStorage(`${reason}. Dungeons last only until this page closes.`);
  }
}

/** Web Locks tell other tabs of the game which uploads this tab is still preparing. */
const locks = (): LockManager | undefined => globalThis.navigator?.locks;

export async function start(options: StartOptions = {}): Promise<Backend> {
  const storage = await openBrowserStorage({ name: options.databaseName });
  const container = await createContainer({
    storage,
    settingsStore: browserSettingsStore,
    samples: createFetchSampleSource(options.samplesUrl ?? 'samples/'),
    whilePreparing: async (courseId, job) => {
      const manager = locks();
      if (manager) await manager.request(LOCK_PREFIX + courseId, job);
      else await job();
    },
    preparingElsewhere: async () => {
      const held = (await locks()?.query())?.held ?? [];
      return new Set(held.map((lock) => lock.name ?? '').filter((name) => name.startsWith(LOCK_PREFIX)).map((name) => name.slice(LOCK_PREFIX.length)));
    },
  });
  const app = buildApp(container);
  return { fetch: app.fetch, preparing: () => container.services.preparing(), storage: storage.kind };
}
