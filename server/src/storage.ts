/**
 * Where dungeons are saved, and switching it while the server runs (Settings → MongoDB).
 *
 * The choice lives in `.local/storage-settings.json` (owner-only, like the API settings). Without that file the
 * environment decides: `MONGODB_URI` set means MongoDB, otherwise this computer's `.local/archive`. The connection
 * string is write-only over HTTP and is never logged or returned.
 *
 * A switch opens the new storage first (nothing changes if that fails), waits for background preparation to finish,
 * optionally copies the current archive across, then rebuilds the services on the new storage and closes the old one.
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MongoClient, type Db } from 'mongodb';
import { z } from 'zod';
import type {
  QuestionStats,
  SaveStorageSettingsResponse,
  StorageSettings,
  TestStorageSettingsResponse,
  UpdateStorageSettingsBody,
} from '@pips-notebook/shared';
import type { Config } from './config';
import { AppError, isAppError } from './errors';
import { createAtlasVectorStore, createMemoryVectorStore } from './rag';
import type { VectorStore } from './rag/types';
import { createMemoryRepository, createMongoRepository } from './repo';
import { createFileRepository, createFileVectorStore } from './repo/file';
import type { Repository, StatsEvent } from './repo/types';
import type { Services } from './services/types';

const ChoiceSchema = z.object({
  version: z.literal(1),
  backend: z.enum(['local', 'mongodb']),
  mongodb: z.object({ uri: z.string(), database: z.string(), vectorIndex: z.string() }).strict(),
}).strict();
export type StorageChoice = z.infer<typeof ChoiceSchema>;

/** An opened repository and vector store, and how to close them. */
export interface OpenStorage {
  kind: 'local' | 'mongodb' | 'memory';
  repo: Repository;
  store: VectorStore;
  close(): Promise<void>;
}

/** Connects to MongoDB and pings it. Rejects with a `storage_error` whose message never contains the password. */
export type MongoConnector = (uri: string, database: string) => Promise<{ db: Db; close(): Promise<void> }>;

/** The services built on one opened storage. `close` waits for background work, then closes the storage. */
export interface Wired {
  services: Services;
  close(): Promise<void>;
}

export interface StorageController {
  read(): Promise<StorageSettings>;
  test(body: UpdateStorageSettingsBody): Promise<TestStorageSettingsResponse>;
  save(body: UpdateStorageSettingsBody): Promise<SaveStorageSettingsResponse>;
  /** The services of the storage in use now. */
  services(): Services;
  close(): Promise<void>;
}

/** Removes credentials from anything that might quote a connection string. */
export function redact(text: string): string {
  return text.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1***@');
}

/** The host part of a connection string, for display. */
export function mongoHost(uri: string): string | null {
  return uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i)?.[1] ?? null;
}

export const connectMongo: MongoConnector = async (uri, database) => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db(database);
    await db.command({ ping: 1 });
    return { db, close: () => client.close() };
  } catch (err) {
    await client.close().catch(() => undefined);
    throw new AppError('storage_error', `Could not connect to MongoDB: ${redact(err instanceof Error ? err.message : String(err))}`);
  }
};

/** Opens the chosen storage. For MongoDB this connects and creates indexes; it throws if that fails. */
export async function openStorage(
  choice: StorageChoice,
  options: { config: Config; dataDir?: string; connect: MongoConnector },
): Promise<OpenStorage> {
  if (choice.backend === 'mongodb') {
    if (!choice.mongodb.uri) throw new AppError('validation_error', 'Enter a MongoDB connection string first.');
    const connection = await options.connect(choice.mongodb.uri, choice.mongodb.database);
    try {
      const repo = createMongoRepository(connection.db);
      const store = createAtlasVectorStore(connection.db, {
        ...options.config, mongodbDb: choice.mongodb.database, atlasVectorIndex: choice.mongodb.vectorIndex,
      });
      await repo.init();
      await store.init();
      return { kind: 'mongodb', repo, store, close: async () => { await repo.close(); await connection.close(); } };
    } catch (err) {
      await connection.close().catch(() => undefined);
      if (isAppError(err)) throw err;
      throw new AppError('storage_error', `Connected to MongoDB but could not set it up: ${redact((err as Error).message)}`);
    }
  }
  const repo = options.dataDir ? createFileRepository(options.dataDir) : createMemoryRepository();
  const store = options.dataDir ? createFileVectorStore(options.dataDir) : createMemoryVectorStore();
  await repo.init();
  await store.init();
  return { kind: options.dataDir ? 'local' : 'memory', repo, store, close: () => repo.close() };
}

/** Replays saved statistics as events, so any repository can store them. */
function statsEvents(stats: QuestionStats): StatsEvent[] {
  const events: StatsEvent[] = [];
  for (let i = 0; i < stats.studentCorrect; i++) events.push({ questionId: stats.questionId, kind: 'student_correct' });
  for (let i = 0; i < stats.studentWrong; i++) events.push({ questionId: stats.questionId, kind: 'student_wrong' });
  for (const solveTimeSec of stats.helpMeSolveTimesSec) events.push({ questionId: stats.questionId, kind: 'help_solve', solveTimeSec });
  return events;
}

/**
 * Copies every dungeon (course, questions, statistics, search chunks) and its expeditions into another storage.
 * Dungeons whose id already exists there are skipped. Each course is saved last, so a copy that fails part way
 * never leaves a dungeon without its questions.
 */
export async function copyArchive(from: OpenStorage, to: OpenStorage): Promise<{ courses: number; runs: number; skipped: number }> {
  const existing = new Set((await to.repo.listCoursePacks()).map((p) => p.id));
  const copied = new Set<string>();
  let skipped = 0;
  for (const pack of await from.repo.listCoursePacks()) {
    if (existing.has(pack.id)) { skipped += 1; continue; }
    const questions = await from.repo.listQuestions(pack.id);
    await to.repo.upsertQuestions(questions);
    const stats = await from.repo.getQuestionStats(questions.map((q) => q.id));
    await to.repo.recordStats(stats.flatMap(statsEvents));
    await to.store.upsert(await from.store.listByCourse(pack.id));
    await to.repo.saveCoursePack(pack);
    copied.add(pack.id);
  }
  let runs = 0;
  for (const run of await from.repo.listRuns()) {
    if (!copied.has(run.courseId) || (await to.repo.getRun(run.id))) continue;
    await to.repo.saveRun(run);
    runs += 1;
  }
  return { courses: copied.size, runs, skipped };
}

/** Identifies a storage, so saving the same choice again does not reopen it. */
function identity(choice: StorageChoice): string {
  return choice.backend === 'local' ? 'local' : `mongodb ${choice.mongodb.uri} ${choice.mongodb.database} ${choice.mongodb.vectorIndex}`;
}

async function loadChoice(config: Config, file?: string): Promise<StorageChoice> {
  const fromEnv: StorageChoice = {
    version: 1,
    backend: config.mongodbUri ? 'mongodb' : 'local',
    mongodb: { uri: config.mongodbUri, database: config.mongodbDb, vectorIndex: config.atlasVectorIndex },
  };
  if (!file) return fromEnv;
  try {
    const saved = ChoiceSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    await chmod(file, 0o600);
    return saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fromEnv;
    throw new Error('Could not load local storage settings. Check .local/storage-settings.json.');
  }
}

async function persist(file: string, choice: StorageChoice): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify(choice, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } catch {
    await unlink(temporary).catch(() => undefined);
    throw new AppError('internal_error', 'Could not save the storage settings. The storage in use did not change.');
  }
}

/**
 * Opens the saved (or environment) storage and builds the services on it. If MongoDB cannot be reached at startup,
 * the server falls back to this computer's storage and reports why in `read().error`.
 */
export async function createStorageController(options: {
  config: Config;
  /** `.local/archive` for the real server; undefined keeps tests in memory. */
  dataDir?: string;
  /** `.local/storage-settings.json` for the real server; undefined keeps choices for this session only. */
  file?: string;
  connect?: MongoConnector;
  /** Builds the services on an opened storage (wiring.ts). */
  build: (storage: OpenStorage) => Promise<Wired>;
}): Promise<StorageController> {
  const { config, dataDir, file } = options;
  const connect = options.connect ?? connectMongo;
  const open = (choice: StorageChoice) => openStorage(choice, { config, dataDir, connect });

  let choice = await loadChoice(config, file);
  let startupError: string | null = null;
  let active: OpenStorage;
  let activeIdentity = identity(choice);
  try {
    active = await open(choice);
  } catch (err) {
    if (choice.backend !== 'mongodb') throw err;
    startupError = isAppError(err) ? err.message : redact(String(err));
    console.error(`[server] ${startupError} Using this computer's storage instead.`);
    active = await open({ ...choice, backend: 'local' });
    activeIdentity = 'local';
  }
  let wired = await options.build(active);

  function candidate(body: UpdateStorageSettingsBody): StorageChoice {
    const next = structuredClone(choice);
    next.backend = body.backend;
    const m = body.mongodb;
    if (m?.uri !== undefined) next.mongodb.uri = m.uri ?? '';
    if (m?.database !== undefined) next.mongodb.database = m.database;
    if (m?.vectorIndex !== undefined) next.mongodb.vectorIndex = m.vectorIndex;
    if (next.backend === 'mongodb' && !next.mongodb.uri) throw new AppError('validation_error', 'Enter a MongoDB connection string first.');
    return next;
  }

  async function read(): Promise<StorageSettings> {
    return {
      backend: choice.backend,
      active: active.kind,
      mongodb: {
        hasUri: !!choice.mongodb.uri,
        host: choice.mongodb.uri ? mongoHost(choice.mongodb.uri) : null,
        database: choice.mongodb.database,
        vectorIndex: choice.mongodb.vectorIndex,
      },
      courses: (await active.repo.listCoursePacks()).length,
      error: startupError,
      persistence: file ? 'local' : 'session',
    };
  }

  let saves: Promise<unknown> = Promise.resolve();
  return {
    read,
    services: () => wired.services,
    close: () => wired.close(),

    async test(body) {
      const next = candidate(body);
      if (next.backend === 'local') {
        return { ok: true, message: dataDir ? 'Dungeons are saved on this computer, in .local/archive.' : 'This server keeps dungeons in memory.' };
      }
      const connection = await connect(next.mongodb.uri, next.mongodb.database);
      try {
        const count = await connection.db.collection('courses').countDocuments();
        const host = mongoHost(next.mongodb.uri) ?? 'MongoDB';
        return { ok: true, message: `Connected to ${host}. Database "${next.mongodb.database}" has ${count} ${count === 1 ? 'dungeon' : 'dungeons'}.` };
      } catch (err) {
        throw new AppError('storage_error', `Connected to MongoDB but could not read it: ${redact((err as Error).message)}`);
      } finally {
        await connection.close().catch(() => undefined);
      }
    },

    save(body) {
      const run = saves.catch(() => undefined).then(async (): Promise<SaveStorageSettingsResponse> => {
        const next = candidate(body);
        const nextIdentity = identity(next);
        if (nextIdentity === activeIdentity) {
          // Same storage: only the saved details change (for example a removed connection string while local).
          if (file) await persist(file, next);
          choice = next;
          return { ...(await read()), copied: null };
        }
        const opened = await open(next);
        const previous = { choice, wired };
        let rebuilt: Wired;
        let copied: SaveStorageSettingsResponse['copied'] = null;
        try {
          await wired.services.idle();
          if (body.copyExisting) copied = await copyArchive(active, opened);
          if (file) await persist(file, next);
          rebuilt = await options.build(opened).catch(async (err) => {
            if (file) await persist(file, previous.choice).catch(() => undefined);
            throw err;
          });
        } catch (err) {
          await opened.close().catch(() => undefined);
          if (isAppError(err)) throw err;
          throw new AppError('storage_error', `Could not switch storage: ${redact((err as Error).message)}`);
        }
        choice = next;
        wired = rebuilt;
        active = opened;
        activeIdentity = nextIdentity;
        startupError = null;
        // The switch has happened; a problem closing the old storage must not undo or hide it.
        await previous.wired.close().catch((err) => console.error('[server] Could not close the previous storage:', redact(String(err))));
        return { ...(await read()), copied };
      });
      saves = run;
      return run;
    },
  };
}
