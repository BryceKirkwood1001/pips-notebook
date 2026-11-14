/**
 * Builds the real dependency graph from the config: LLM client, storage, RAG, tasks, engine and
 * services. `container.ts` calls this; nothing else should.
 *
 *   LLM_PROVIDER=mock (or no key)  -> fake LLM client + deterministic mock tasks
 *   LLM_PROVIDER=gemini            -> Gemini client + Gemini-backed tasks
 *   MONGODB_URI set                -> MongoDB repository + Atlas Vector Search
 *   MONGODB_URI empty              -> in-memory repository + in-memory cosine search
 */
import { fileURLToPath } from 'node:url';
import { MongoClient, type Db } from 'mongodb';
import type { Config } from './config';
import { randomSeed } from './core/rng';
import { engine } from './engine';
import type { Clock } from './engine/types';
import { runIngest } from './ingest';
import type { IngestDeps } from './ingest/types';
import { createFakeLlmClient, createGameplayTasks, createGeminiClient, createMockGameplayTasks } from './llm';
import { createIngestTasks, createMockIngestTasks } from './llm/ingest';
import type { IngestTasks } from './llm/types';
import {
  createAtlasVectorStore,
  createChunker,
  createEmbedder,
  createMaterialParser,
  createMemoryVectorStore,
  createRetriever,
} from './rag';
import { createMemoryRepository, createMongoRepository } from './repo';
import { createServices } from './services/create';
import type { Services } from './services/types';

export interface WiringOptions {
  config: Config;
  clock: Clock;
  /** Fixed RNG seed for every run (tests). Default: a random seed per run. */
  seed?: number;
  /** Default: the repo's `samples/` folder. */
  samplesDir?: string;
}

export interface Wired {
  services: Services;
  close(): Promise<void>;
}

const DEFAULT_SAMPLES_DIR = fileURLToPath(new URL('../../samples', import.meta.url));

/** Connects to MongoDB, or returns null (with a loud warning) so the server can still run in memory. */
async function connectMongo(config: Config): Promise<{ client: MongoClient; db: Db } | null> {
  if (!config.mongodbUri) return null;
  const client = new MongoClient(config.mongodbUri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db(config.mongodbDb);
    await db.command({ ping: 1 });
    return { client, db };
  } catch (err) {
    console.error(
      '[server] Could not connect to MongoDB. Falling back to IN-MEMORY storage: nothing will be saved.',
      err instanceof Error ? err.message : err,
    );
    await client.close().catch(() => undefined);
    return null;
  }
}

export async function wire(options: WiringOptions): Promise<Wired> {
  const { config, clock } = options;
  const useGemini = config.llmProvider === 'gemini';

  const llm = useGemini ? createGeminiClient(config) : createFakeLlmClient({ embeddingDims: config.embeddingDims });
  const mongo = await connectMongo(config);

  const repo = mongo ? createMongoRepository(mongo.db) : createMemoryRepository();
  const store = mongo ? createAtlasVectorStore(mongo.db, config) : createMemoryVectorStore();
  await repo.init();
  await store.init();

  const embedder = createEmbedder(llm, config);
  const retriever = createRetriever({ store, embedder, config });
  const gameplayTasks = useGemini ? createGameplayTasks(llm, config) : createMockGameplayTasks();
  const geminiIngestTasks: IngestTasks | null = useGemini ? createIngestTasks(llm, config) : null;
  // Only Gemini can read a PDF natively, so the upload is skipped in mock mode.
  const parser = createMaterialParser({ llm: useGemini ? llm : undefined, config });
  const chunker = createChunker(config);

  /** Fresh per ingest: the mock ingest tasks hand each canned question out once per instance. */
  const makeIngestDeps = (): IngestDeps => ({
    config,
    tasks: geminiIngestTasks ?? createMockIngestTasks(),
    parser,
    chunker,
    embedder,
    store,
    retriever,
    repo,
    clock,
    log: config.debug ? (message, data) => console.log(`[ingest] ${message}`, data ?? '') : undefined,
  });

  const services = createServices({
    config,
    clock,
    repo,
    engine,
    gameplayTasks,
    retriever,
    store,
    embedder,
    makeIngestDeps,
    runIngest,
    samplesDir: options.samplesDir ?? DEFAULT_SAMPLES_DIR,
    newSeed: options.seed === undefined ? randomSeed : () => options.seed as number,
    storage: mongo ? 'mongodb' : 'memory',
  });

  return {
    services,
    close: async () => {
      // Let background ingests finish writing before the connection goes away.
      await services.idle();
      await repo.close();
      if (mongo) await mongo.client.close();
    },
  };
}
