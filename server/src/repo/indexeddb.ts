/**
 * Browser storage: one IndexedDB database holds the repository (courses, questions, question statistics,
 * expeditions) and the search chunks with their embeddings. The page opens it again after a reload, so
 * dungeons and expeditions survive.
 *
 *   const db = await openBrowserDatabase();
 *   const repo = createIndexedDbRepository(db);
 *   const store = createIndexedDbVectorStore(db);
 *
 * IndexedDB copies values in and out (structured clone), so every read is already a copy, as the
 * Repository contract asks. Tests pass `fake-indexeddb` as the factory.
 */
import type { Chunk, QuestionStats } from '@pips-notebook/shared';
import { AppError } from '../errors';
import type { ScoredChunk, VectorStore } from '../rag/types';
import { compareChunks, cosine } from '../rag/util';
import { applyStatsEvent } from './memory';
import type { Repository } from './types';

export const DATABASE_NAME = 'pips-notebook';
const VERSION = 1;
const COURSES = 'courses';
const QUESTIONS = 'questions';
const STATS = 'questionStats';
const RUNS = 'runs';
const CHUNKS = 'chunks';
const BY_COURSE = 'courseId';

export interface DatabaseOptions {
  /** Default: "pips-notebook". */
  name?: string;
  /** Default: the browser's `indexedDB`. */
  factory?: IDBFactory;
}

const failure = (message: string, error?: unknown) =>
  new AppError('storage_error', error instanceof Error && error.message ? `${message}: ${error.message}` : message);

/** Opens (and on first use creates) the database. Rejects when the browser blocks storage. */
export function openBrowserDatabase(options: DatabaseOptions = {}): Promise<IDBDatabase> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) return Promise.reject(failure('This browser cannot save dungeons (IndexedDB is unavailable)'));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(options.name ?? DATABASE_NAME, VERSION);
    } catch (error) {
      reject(failure('This browser blocked saving dungeons', error));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(COURSES, { keyPath: 'id' });
      db.createObjectStore(QUESTIONS, { keyPath: 'id' }).createIndex(BY_COURSE, BY_COURSE);
      db.createObjectStore(STATS, { keyPath: 'questionId' });
      db.createObjectStore(RUNS, { keyPath: 'id' }).createIndex(BY_COURSE, BY_COURSE);
      db.createObjectStore(CHUNKS, { keyPath: 'id' }).createIndex(BY_COURSE, BY_COURSE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer version of the game opened in another tab: let it upgrade instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(failure('This browser blocked saving dungeons', request.error));
    request.onblocked = () => reject(failure('Close the other tabs of this game, then reload this one'));
  });
}

/** Resolves with the request's result. */
function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves when the transaction has committed, so the write is durable. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure('Could not save to this browser', tx.error));
    tx.onabort = () => reject(failure('Could not save to this browser (the browser may be out of space)', tx.error));
  });
}

/**
 * Runs `work` in one transaction and waits for it to commit. `work` may await IndexedDB requests of this
 * transaction, but nothing else: awaiting other promises would let the transaction close.
 */
async function transact<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = db.transaction(stores, mode);
  const done = committed(tx);
  done.catch(() => undefined); // observed below; this only keeps an early abort from counting as unhandled
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* already finished */ }
    await done.catch(() => undefined);
    throw error instanceof AppError ? error : failure('Could not use this browser\'s storage', error);
  }
}

const read = <T>(db: IDBDatabase, store: string, query: (s: IDBObjectStore) => IDBRequest<T>) =>
  transact(db, [store], 'readonly', (tx) => settle(query(tx.objectStore(store))));

export function createIndexedDbRepository(db: IDBDatabase): Repository {
  return {
    async init() {},
    async close() {},

    async saveCoursePack(pack) {
      await transact(db, [COURSES], 'readwrite', async (tx) => { tx.objectStore(COURSES).put(pack); });
    },
    async getCoursePack(courseId) {
      return (await read(db, COURSES, (s) => s.get(courseId))) ?? null;
    },
    async listCoursePacks() {
      return read(db, COURSES, (s) => s.getAll());
    },
    async deleteCourse(courseId) {
      return transact(db, [COURSES, QUESTIONS, STATS, RUNS], 'readwrite', async (tx) => {
        const courses = tx.objectStore(COURSES);
        if ((await settle(courses.getKey(courseId))) === undefined) return false;
        const questions = tx.objectStore(QUESTIONS);
        const stats = tx.objectStore(STATS);
        for (const id of await settle(questions.index(BY_COURSE).getAllKeys(courseId))) {
          questions.delete(id);
          stats.delete(id);
        }
        const runs = tx.objectStore(RUNS);
        for (const id of await settle(runs.index(BY_COURSE).getAllKeys(courseId))) runs.delete(id);
        courses.delete(courseId);
        return true;
      });
    },

    async upsertQuestions(list) {
      if (list.length === 0) return;
      await transact(db, [QUESTIONS], 'readwrite', async (tx) => {
        const store = tx.objectStore(QUESTIONS);
        for (const q of list) store.put(q);
      });
    },
    async listQuestions(courseId, opts) {
      const all = await read(db, QUESTIONS, (s) => s.index(BY_COURSE).getAll(courseId));
      return opts?.verifiedOnly ? all.filter((q) => q.verified) : all;
    },
    async deleteQuestions(courseId) {
      await transact(db, [QUESTIONS], 'readwrite', async (tx) => {
        const store = tx.objectStore(QUESTIONS);
        for (const id of await settle(store.index(BY_COURSE).getAllKeys(courseId))) store.delete(id);
      });
    },

    async getQuestionStats(ids) {
      if (ids.length === 0) return [];
      return transact(db, [STATS], 'readonly', async (tx) => {
        const store = tx.objectStore(STATS);
        const found = await Promise.all(ids.map((id) => settle<QuestionStats | undefined>(store.get(id))));
        return found.filter((s): s is QuestionStats => s !== undefined);
      });
    },
    async recordStats(events) {
      if (events.length === 0) return;
      await transact(db, [STATS], 'readwrite', async (tx) => {
        const store = tx.objectStore(STATS);
        // Events for the same question apply in order, so read each question once and write it once.
        const current = new Map<string, QuestionStats>();
        for (const e of events) {
          let stats = current.get(e.questionId);
          if (!stats) {
            stats = (await settle<QuestionStats | undefined>(store.get(e.questionId))) ?? {
              questionId: e.questionId, helpMeSolveTimesSec: [], studentCorrect: 0, studentWrong: 0,
            };
            current.set(e.questionId, stats);
          }
          applyStatsEvent(stats, e);
        }
        for (const stats of current.values()) store.put(stats);
      });
    },

    async saveRun(run) {
      await transact(db, [RUNS], 'readwrite', async (tx) => { tx.objectStore(RUNS).put(run); });
    },
    async getRun(runId) {
      return (await read(db, RUNS, (s) => s.get(runId))) ?? null;
    },
    async listRuns() {
      return (await read(db, RUNS, (s) => s.getAll())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async deleteRun(runId) {
      return transact(db, [RUNS], 'readwrite', async (tx) => {
        const store = tx.objectStore(RUNS);
        if ((await settle(store.getKey(runId))) === undefined) return false;
        store.delete(runId);
        return true;
      });
    },
  };
}

/**
 * The search chunks of every course, kept in IndexedDB. A search scores one course's chunks by cosine
 * similarity, as the in-memory store does; each course's chunks are read once and kept in memory until
 * the course changes.
 */
export function createIndexedDbVectorStore(db: IDBDatabase): VectorStore {
  const cache = new Map<string, Promise<Chunk[]>>();
  const ofCourse = (courseId: string): Promise<Chunk[]> => {
    let chunks = cache.get(courseId);
    if (!chunks) {
      chunks = read(db, CHUNKS, (s) => s.index(BY_COURSE).getAll(courseId)).then((list) => list.sort(compareChunks));
      chunks.catch(() => cache.delete(courseId));
      cache.set(courseId, chunks);
    }
    return chunks;
  };

  return {
    async init() {},
    async upsert(list) {
      if (list.length === 0) return;
      for (const courseId of new Set(list.map((c) => c.courseId))) cache.delete(courseId);
      await transact(db, [CHUNKS], 'readwrite', async (tx) => {
        const store = tx.objectStore(CHUNKS);
        for (const c of list) store.put(c);
      });
    },
    async search({ courseId, embedding, topK }) {
      const scored: ScoredChunk[] = (await ofCourse(courseId)).map((chunk) => ({ chunk, score: cosine(embedding, chunk.embedding) }));
      return scored.sort((a, b) => b.score - a.score).slice(0, topK).map((s) => ({ ...s, chunk: structuredClone(s.chunk) }));
    },
    async listByCourse(courseId) {
      return structuredClone(await ofCourse(courseId));
    },
    async getByIds(ids) {
      if (ids.length === 0) return [];
      return transact(db, [CHUNKS], 'readonly', async (tx) => {
        const store = tx.objectStore(CHUNKS);
        const found = await Promise.all(ids.map((id) => settle<Chunk | undefined>(store.get(id))));
        return found.filter((c): c is Chunk => c !== undefined);
      });
    },
    async deleteCourse(courseId) {
      cache.delete(courseId);
      await transact(db, [CHUNKS], 'readwrite', async (tx) => {
        const store = tx.objectStore(CHUNKS);
        for (const id of await settle(store.index(BY_COURSE).getAllKeys(courseId))) store.delete(id);
      });
    },
  };
}
