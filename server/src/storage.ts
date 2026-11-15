/**
 * Where dungeons are saved: this browser's IndexedDB (or memory when the browser blocks it, and in tests),
 * plus the JSON backup that Settings → "Saved in this browser" exports and imports.
 *
 * Nothing here leaves the browser. A backup holds every dungeon (course, questions, statistics, search chunks)
 * and its expeditions; it never holds API keys, which live in settings.ts.
 */
import { BackupSchema, type Backup, type ImportBackupResponse, type QuestionStats, type StorageSettings } from '@pips-notebook/shared';
import { AppError } from './errors';
import { createMemoryVectorStore } from './rag';
import type { VectorStore } from './rag/types';
import { createMemoryRepository } from './repo';
import type { Repository, StatsEvent } from './repo/types';
import type { Services } from './services/types';

/** What the browser reports about this site's storage. Every field is null when it cannot say. */
export interface StorageInfo {
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
}

/** An opened repository and vector store, and how to close them. */
export interface OpenStorage {
  kind: 'browser' | 'memory';
  repo: Repository;
  store: VectorStore;
  close(): Promise<void>;
  /** The browser's storage estimate. Absent outside a browser. */
  info?(): Promise<StorageInfo>;
  /** Why the browser's storage is not in use (it fell back to memory), when it is not. */
  error?: string;
}

/** The services built on the opened storage. `close` waits for background work, then closes the storage. */
export interface Wired {
  services: Services;
  close(): Promise<void>;
}

export interface StorageController {
  read(): Promise<StorageSettings>;
  /** Every dungeon and expedition, as one JSON file. */
  exportBackup(): Promise<Backup>;
  /** Adds the dungeons of a backup. Dungeons already saved here are skipped, never replaced. */
  importBackup(body: unknown): Promise<ImportBackupResponse>;
  services(): Services;
  close(): Promise<void>;
}

/** A storage that lasts as long as the page (tests, and browsers that block IndexedDB). */
export function openMemoryStorage(error?: string): OpenStorage {
  return { kind: 'memory', repo: createMemoryRepository(), store: createMemoryVectorStore(), close: async () => {}, ...(error ? { error } : {}) };
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
export async function copyArchive(from: Pick<OpenStorage, 'repo' | 'store'>, to: Pick<OpenStorage, 'repo' | 'store'>): Promise<ImportBackupResponse> {
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

/** Reads every dungeon and expedition of a storage into a backup. */
export async function toBackup(from: Pick<OpenStorage, 'repo' | 'store'>, now: Date): Promise<Backup> {
  const courses = (await from.repo.listCoursePacks()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const backup: Backup = { app: 'pips-notebook', version: 1, exportedAt: now.toISOString(), courses, questions: [], questionStats: [], chunks: [], runs: [] };
  for (const pack of courses) {
    const questions = await from.repo.listQuestions(pack.id);
    backup.questions.push(...questions);
    backup.questionStats.push(...(await from.repo.getQuestionStats(questions.map((q) => q.id))));
    backup.chunks.push(...(await from.store.listByCourse(pack.id)));
  }
  const known = new Set(courses.map((c) => c.id));
  backup.runs = (await from.repo.listRuns()).filter((r) => known.has(r.courseId));
  return backup;
}

/** Validates a backup file and loads it into a memory storage, ready to copy. */
async function fromBackup(body: unknown): Promise<OpenStorage> {
  const parsed = BackupSchema.safeParse(body);
  if (!parsed.success) {
    const app = (body as { app?: unknown } | null)?.app;
    const issue = parsed.error.issues[0];
    throw new AppError('validation_error', app === 'pips-notebook'
      ? `This backup could not be read (${issue.path.join('.') || 'file'}: ${issue.message}).`
      : "This file is not a Pip's Notebook backup.");
  }
  const backup = parsed.data;
  const staging = openMemoryStorage();
  await staging.repo.upsertQuestions(backup.questions);
  await staging.repo.recordStats(backup.questionStats.flatMap(statsEvents));
  await staging.store.upsert(backup.chunks);
  for (const pack of backup.courses) await staging.repo.saveCoursePack(pack);
  for (const run of backup.runs) await staging.repo.saveRun(run);
  return staging;
}

/** Builds the services on the opened storage and answers Settings → "Saved in this browser". */
export async function createStorageController(options: {
  storage: OpenStorage;
  /** Builds the services on an opened storage (wiring.ts). */
  build: (storage: OpenStorage) => Promise<Wired>;
  now?: () => Date;
}): Promise<StorageController> {
  const { storage } = options;
  const now = options.now ?? (() => new Date());
  const wired = await options.build(storage);
  // One import at a time, so two clicks cannot copy the same dungeon twice.
  let imports: Promise<unknown> = Promise.resolve();

  return {
    services: () => wired.services,
    close: () => wired.close(),

    async read() {
      const info = (await storage.info?.().catch(() => null)) ?? { persisted: null, usageBytes: null, quotaBytes: null };
      return {
        active: storage.kind,
        courses: (await storage.repo.listCoursePacks()).length,
        runs: (await storage.repo.listRuns()).length,
        ...info,
        error: storage.error ?? null,
      };
    },

    async exportBackup() {
      // Dungeons still being prepared are included as they are now; their preparation finishes in this browser only.
      return toBackup(storage, now());
    },

    importBackup(body) {
      const job = imports.catch(() => undefined).then(async () => copyArchive(await fromBackup(body), storage));
      imports = job;
      return job;
    },
  };
}
