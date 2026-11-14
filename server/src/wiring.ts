/**
 * Builds the real dependency graph from the config: LLM client, storage, RAG, tasks, engine and
 * services. `container.ts` calls this; nothing else should.
 *
 *   LLM_PROVIDER=mock (or no key)  -> fake LLM client + deterministic mock tasks
 *   LLM_PROVIDER=gemini            -> Gemini client + Gemini-backed tasks
 *   LLM_PROVIDER=openai            -> OpenAI client + the same provider-independent tasks
 *
 * Storage (MongoDB, this computer's .local/archive, or memory in tests) is opened by storage.ts and passed in,
 * so Settings can switch it while the server runs.
 */
import { fileURLToPath } from 'node:url';
import type { Config } from './config';
import { randomSeed } from './core/rng';
import { engine } from './engine';
import type { Clock } from './engine/types';
import { runIngest } from './ingest';
import type { IngestDeps } from './ingest/types';
import { createGameplayTasks, createLlmClient, createMockGameplayTasks } from './llm';
import { createIngestTasks, createMockIngestTasks } from './llm/ingest';
import type { Retriever } from './rag/types';
import type { ApiSettingsManager, LlmFactory } from './settings';
import { createChunker, createEmbedder, createMaterialParser, createRetriever } from './rag';
import { createServices } from './services/create';
import type { OpenStorage, Wired } from './storage';

export interface WiringOptions {
  config: Config;
  clock: Clock;
  settings: ApiSettingsManager;
  llmFactory?: LlmFactory;
  /** Fixed RNG seed for every run (tests). Default: a random seed per run. */
  seed?: number;
  /** Default: the repo's `samples/` folder. */
  samplesDir?: string;
  /** The opened storage. Closing the wiring closes it. */
  storage: OpenStorage;
}

const DEFAULT_SAMPLES_DIR = fileURLToPath(new URL('../../samples', import.meta.url));

export async function wire(options: WiringOptions): Promise<Wired> {
  const { config, clock, settings } = options;
  const factory = options.llmFactory ?? createLlmClient;
  const legacyEmbedding = { provider: config.llmProvider, model: config.embeddingModel, dims: config.embeddingDims };
  const { repo, store } = options.storage;
  // Interrupted preparation cannot continue without the original upload. Never leave it waiting forever.
  for (const pack of await repo.listCoursePacks()) {
    if (!['ready', 'error'].includes(pack.status.stage)) {
      pack.status = { ...pack.status, stage: 'error', error: 'Preparation was interrupted by a server restart. Upload this material again to finish preparing it.' };
      await repo.saveCoursePack(pack);
    }
  }

  const chunker = createChunker(config);

  function resources(ingest = false) {
    const snapshot = settings.config();
    if (ingest) snapshot.llmTimeoutMs = snapshot.ingestLlmTimeoutMs;
    const llm = factory(snapshot);
    const mock = snapshot.llmProvider === 'mock';
    const embedder = createEmbedder(llm, snapshot);
    return { config: snapshot, llm, embedder,
      gameplayTasks: mock ? createMockGameplayTasks() : createGameplayTasks(llm, snapshot),
      ingestTasks: mock ? createMockIngestTasks() : createIngestTasks(llm, snapshot),
      parser: createMaterialParser({ llm: mock ? undefined : llm, config: snapshot }),
    };
  }
  const initial = resources();
  // Existing courses keep their original embedding space when the selected generation provider changes.
  const retriever: Retriever = { async retrieve(query) {
    const pack = await repo.getCoursePack(query.courseId);
    const snapshot = settings.embeddingConfig(pack?.embeddingProfile ?? legacyEmbedding);
    const embedder = createEmbedder(factory(snapshot), snapshot);
    return createRetriever({ store, embedder, config: snapshot }).retrieve(query);
  } };

  /** Fresh per ingest: the mock ingest tasks hand each canned question out once per instance. */
  const makeIngestDeps = (): IngestDeps => {
    const selected = resources(true);
    return { config: selected.config, tasks: selected.ingestTasks, parser: selected.parser, chunker,
      embedder: selected.embedder, store, retriever: createRetriever({ store, embedder: selected.embedder, config: selected.config }), repo, clock,
      log: config.debug ? (message, data) => console.log(`[ingest] ${message}`, data ?? '') : undefined };
  };

  const services = createServices({
    config,
    clock,
    repo,
    engine,
    gameplayTasks: initial.gameplayTasks,
    getGameplay: () => {
      const selected = resources();
      return { config: selected.config, tasks: selected.gameplayTasks, retriever };
    },
    retriever,
    store,
    embedder: initial.embedder,
    makeIngestDeps,
    runIngest,
    samplesDir: options.samplesDir ?? DEFAULT_SAMPLES_DIR,
    newSeed: options.seed === undefined ? randomSeed : () => options.seed as number,
    storage: options.storage.kind,
  });

  return {
    services,
    close: async () => {
      // Let background ingests finish writing before the storage goes away.
      await services.idle();
      await options.storage.close();
    },
  };
}
