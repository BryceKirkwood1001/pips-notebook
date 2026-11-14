/**
 * The service layer implementation. Each method: load from the repository, call the engine or the
 * ingest pipeline, save, return a PUBLIC shape. It depends only on interfaces; `container.ts`
 * supplies the implementations.
 */
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  CourseFixtureSchema,
  QUESTION_TYPES,
  emptyCoursePack,
  type CoursePack,
  type DebugResponse,
  type FileType,
  type PublicCourse,
  type PublicRun,
  type PublicStudentQuestion,
  type Question,
  type Run,
  type TimeBudgetBreakdown,
} from '@top/shared';
import type { Config } from '../config';
import { createRng } from '../core/rng';
import { calibratedTimeBudget, computeTimeBudget, effectiveTimeBudget, materialTimeHintFor } from '../core/timeBudget';
import type { Clock, Engine, EngineContext, EngineDeps } from '../engine/types';
import { AppError } from '../errors';
import type { IngestDeps, IngestInput, IngestReport } from '../ingest/types';
import type { GameplayTasks } from '../llm/types';
import type { Embedder, Retriever, SourceFile, VectorStore } from '../rag/types';
import type { Repository, StatsEvent } from '../repo/types';
import type { Services, UploadInput } from './types';

export interface ServiceDeps {
  config: Config;
  clock: Clock;
  repo: Repository;
  engine: Engine;
  gameplayTasks: GameplayTasks;
  getGameplay?: () => Pick<EngineDeps, 'config' | 'tasks' | 'retriever'>;
  retriever: Retriever;
  store: VectorStore;
  embedder: Embedder;
  /** Called once per ingest: the mock ingest tasks keep state, so every ingest gets fresh deps. */
  makeIngestDeps: () => IngestDeps;
  runIngest: (deps: IngestDeps, input: IngestInput) => Promise<IngestReport>;
  /** Folder holding `cache/<sample>.json`. */
  samplesDir: string;
  /** Seed for a new run. */
  newSeed: () => number;
  storage: 'mongodb' | 'memory' | 'local';
}

const SAMPLE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The file type from the file name, or a 415 for anything we can't read. */
export function fileTypeOf(name: string): FileType {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.txt') return 'txt';
  if (ext === '.md' || ext === '.markdown') return 'md';
  throw new AppError('unsupported_file', `"${name}" is not supported. Upload .pdf, .txt or .md files.`);
}

/** GET /courses/:id. Public fields only. */
export function toPublicCourse(pack: CoursePack): PublicCourse {
  const ready = new Set(pack.status.conceptsReady);
  const conceptById = new Map(pack.concepts.map((c) => [c.id, c]));
  const byOrder = <T extends { order: number }>(items: T[]): T[] => [...items].sort((a, b) => a.order - b.order);
  const style = pack.styleProfile;
  const topFormats = QUESTION_TYPES.filter((t) => style.formatMix[t] > 0).sort(
    (a, b) => style.formatMix[b] - style.formatMix[a],
  );
  return {
    id: pack.id,
    title: pack.title,
    status: { ...pack.status, conceptsReady: [...pack.status.conceptsReady] },
    files: pack.files.map((f) => ({ id: f.id, name: f.name, type: f.type, pages: f.pages })),
    units: byOrder(pack.units).map((u) => ({
      id: u.id,
      title: u.title,
      concepts: u.conceptIds
        .map((id) => conceptById.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ id: c.id, title: c.title, summary: c.summary, ready: ready.has(c.id) })),
    })),
    rooms: byOrder(pack.rooms).map((r) => ({
      id: r.id,
      title: r.title,
      ...(r.description ? { description: r.description } : {}),
      ...(r.learningObjectives ? { learningObjectives: [...r.learningObjectives] } : {}),
      conceptIds: [...r.conceptIds],
      ready: r.conceptIds.every((id) => ready.has(id)),
    })),
    styleSummary: {
      voice: style.voice,
      notation: style.notation,
      ...(style.codeLanguage ? { codeLanguage: style.codeLanguage } : {}),
      ...(style.units ? { units: style.units } : {}),
      topFormats,
    },
  };
}

export function createServices(deps: ServiceDeps): Services {
  const { config, clock, repo, engine } = deps;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Background ingests still running, so tests and scripts can wait for them. */
  const ingests = new Set<Promise<unknown>>();
  const ingestingCourses = new Set<string>();
  /** Deletion shares a queue with course/run writes, so completed requests cannot resurrect deleted data. */
  const courseLocks = new Map<string, Promise<unknown>>();
  function withCourseLock<T>(courseId: string, fn: () => Promise<T>): Promise<T> {
    const next = (courseLocks.get(courseId) ?? Promise.resolve()).catch(() => undefined).then(fn);
    courseLocks.set(courseId, next);
    void next.catch(() => undefined).finally(() => { if (courseLocks.get(courseId) === next) courseLocks.delete(courseId); });
    return next;
  }

  /** One queue per run: two requests for the same run never interleave (double submits). */
  const locks = new Map<string, Promise<unknown>>();
  function withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(runId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const run = await repo.getRun(runId);
      return run ? withCourseLock(run.courseId, fn) : fn();
    });
    locks.set(runId, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (locks.get(runId) === next) locks.delete(runId);
      });
    return next;
  }

  /** The pack plus its servable questions, with time budgets calibrated from play (SPEC 2.10 step 4). */
  async function loadContext(courseId: string): Promise<EngineContext> {
    const pack = await repo.getCoursePack(courseId);
    if (!pack) throw new AppError('not_found', `Course "${courseId}" not found`);
    const questions = await repo.listQuestions(courseId, { verifiedOnly: true });
    const stats = await repo.getQuestionStats(questions.map((q) => q.id));
    const statsById = new Map(stats.map((s) => [s.questionId, s]));
    const calibrated = questions.map(
      (q): Question => ({ ...q, timeBudgetSec: effectiveTimeBudget(q, statsById.get(q.id), config) }),
    );
    return { pack, questions: calibrated };
  }

  async function loadRun(runId: string): Promise<Run> {
    const run = await repo.getRun(runId);
    if (!run) throw new AppError('not_found', `Run "${runId}" not found`);
    return run;
  }

  const engineDeps = (rng: EngineDeps['rng']): EngineDeps => ({
    config,
    tasks: deps.gameplayTasks,
    retriever: deps.retriever,
    ...deps.getGameplay?.(),
    rng,
    clock,
  });

  /**
   * Load the run, call one engine function with the run's RNG, store the RNG state and the new run.
   * Everything happens under the run's lock.
   */
  function mutate<T extends { run: Run; stats?: StatsEvent[] }>(
    runId: string,
    fn: (d: EngineDeps, ctx: EngineContext, run: Run) => T | Promise<T>,
  ): Promise<{ out: T; ctx: EngineContext }> {
    return withRunLock(runId, async () => {
      const run = await loadRun(runId);
      if (run.endedAt) throw new AppError('run_ended', 'This expedition was ended. Start a new one from My archive.');
      if (run.pausedAt) throw new AppError('run_paused', 'This run is paused. Resume it from the menu first.');
      const ctx = await loadContext(run.courseId);
      const rng = createRng(run.rngState);
      const out = await fn(engineDeps(rng), ctx, run);
      out.run.rngState = rng.state();
      await repo.saveRun(out.run);
      if (out.stats?.length) await repo.recordStats(out.stats);
      return { out, ctx };
    });
  }

  const publicRun = (run: Run, ctx: EngineContext): PublicRun => engine.toPublicRun(run, ctx, config);

  // ── Samples ───────────────────────────────────────────────────────────────

  const cacheDir = path.join(deps.samplesDir, 'cache');

  async function readFixture(sample: string) {
    if (!SAMPLE_NAME.test(sample)) throw new AppError('not_found', `Sample "${sample}" not found`);
    let raw: string;
    try {
      raw = await readFile(path.join(cacheDir, `${sample}.json`), 'utf8');
    } catch {
      throw new AppError('not_found', `Sample "${sample}" not found`);
    }
    const parsed = CourseFixtureSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`Sample "${sample}" is not a valid fixture: ${issue.path.join('.')}: ${issue.message}`);
    }
    return parsed.data;
  }

  // ── The services ──────────────────────────────────────────────────────────

  return {
    health: () => ({ ok: true, llmProvider: config.llmProvider, storage: deps.storage, debug: config.debug }),

    async listArchive() {
      const courses = (await repo.listCoursePacks()).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(toPublicCourse);
      const runs = (await repo.listRuns()).map(r => ({ id:r.id, courseId:r.courseId, phase:r.phase, roomIndex:r.roomIndex, rooms:r.scope.roomIds.length, updatedAt:r.updatedAt,
        ...(r.pausedAt ? {pausedAt:r.pausedAt}: {}), ...(r.endedAt ? {endedAt:r.endedAt}: {}) }));
      return { courses, runs };
    },

    deleteCourse: courseId => withCourseLock(courseId, async () => {
      if (!(await repo.getCoursePack(courseId))) throw new AppError('not_found', `Course "${courseId}" not found`);
      if (ingestingCourses.has(courseId)) throw new AppError('course_busy', 'This dungeon is still being prepared. Wait for preparation to finish before deleting it.');
      await deps.store.deleteCourse(courseId);
      if (!(await repo.deleteCourse(courseId))) throw new AppError('not_found', `Course "${courseId}" not found`);
      return { deleted: true as const, id: courseId };
    }),

    pauseRun: runId => withRunLock(runId, async () => {
      const run = await loadRun(runId);
      if (!run.pausedAt && !run.endedAt && run.phase !== 'results') { run.pausedAt = clock.now().toISOString(); run.updatedAt = run.pausedAt; await repo.saveRun(run); }
      return publicRun(run, await loadContext(run.courseId));
    }),

    resumeRun: runId => withRunLock(runId, async () => {
      const run = await loadRun(runId);
      if (run.endedAt) throw new AppError('run_ended', 'This expedition was ended. Start a new one from My archive.');
      if (run.pausedAt) {
        const elapsed = Math.max(0, clock.now().getTime() - Date.parse(run.pausedAt));
        if (run.pendingHelpMe) {
          const pending = run.pendingHelpMe;
          pending.startedAt = new Date(Date.parse(pending.startedAt) + elapsed).toISOString();
          if (pending.deadline) pending.deadline = new Date(Date.parse(pending.deadline) + elapsed).toISOString();
          for (const event of [...(run.room?.log ?? []), ...(run.boss?.log ?? [])]) {
            if (event.kind === 'help_me' && event.eventId === pending.eventId) event.deadline = pending.deadline;
          }
        }
        delete run.pausedAt; run.updatedAt = clock.now().toISOString(); await repo.saveRun(run);
      }
      return publicRun(run, await loadContext(run.courseId));
    }),

    endRun: runId => withRunLock(runId, async () => {
      const run = await loadRun(runId);
      if (!run.endedAt) {
        if (run.phase === 'results') throw new AppError('wrong_phase', 'This expedition is already finished.');
        const now = clock.now().toISOString();
        run.endedAt = now; run.updatedAt = now;
        delete run.pausedAt;
        delete run.pendingHelpMe; // an unanswered "Help me!" closes with the expedition; its log entry stays
        await repo.saveRun(run);
      }
      return publicRun(run, await loadContext(run.courseId));
    }),

    deleteRun: runId => withRunLock(runId, async () => {
      if (!(await repo.deleteRun(runId))) throw new AppError('not_found', `Run "${runId}" not found`);
      return { deleted: true as const, id: runId };
    }),

    async listSamples() {
      let names: string[];
      try {
        names = (await readdir(cacheDir)).filter((f) => f.endsWith('.json')).sort();
      } catch {
        return { samples: [] };
      }
      const samples: { id: string; title: string }[] = [];
      for (const file of names) {
        const id = file.replace(/\.json$/, '');
        if (!SAMPLE_NAME.test(id)) continue;
        try {
          const json = JSON.parse(await readFile(path.join(cacheDir, file), 'utf8')) as { pack?: { title?: string } };
          samples.push({ id, title: json.pack?.title || id });
        } catch {
          // An unreadable fixture is simply not offered.
        }
      }
      return { samples };
    },

    async seedCourse(sample) {
      const fixture = await readFixture(sample);
      return withCourseLock(fixture.pack.id, async () => {
        const ingest = deps.makeIngestDeps();
        const embedder = ingest.embedder;
        let chunks = fixture.chunks;
        // Vectors from another embedder live in a different space: embed the chunk texts again.
        if (chunks.length > 0 && fixture.embedderId !== embedder.id) {
          const vectors = await embedder.embedDocuments(chunks.map((c) => c.text));
          chunks = chunks.map((c, i) => ({ ...c, embedding: vectors[i] }));
        }
        await deps.store.deleteCourse(fixture.pack.id);
        await deps.store.upsert(chunks);
        await repo.deleteQuestions(fixture.pack.id);
        await repo.upsertQuestions(fixture.questions);
        fixture.pack.embeddingProfile = { provider: ingest.config.llmProvider, model: ingest.config.embeddingModel, dims: ingest.config.embeddingDims };
        await repo.saveCoursePack(fixture.pack);
        return { courseId: fixture.pack.id };
      });
    },

    async createCourse(input) {
      const maxBytes = config.maxUploadMb * 1024 * 1024;
      const total = input.files.reduce((n, f) => n + f.data.byteLength, 0);
      if (total > maxBytes) {
        throw new AppError('payload_too_large', `Upload is larger than ${config.maxUploadMb} MB`);
      }
      const files: SourceFile[] = input.files.map((f: UploadInput, i) => ({
        id: `f${i + 1}`,
        name: f.name,
        type: fileTypeOf(f.name),
        data: f.data,
      }));

      const courseId = `crs_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const title = input.title ?? path.basename(files[0].name, path.extname(files[0].name));
      await repo.saveCoursePack(emptyCoursePack(courseId, title, clock.now().toISOString()));

      // Progressive ingest runs in the background; the client polls GET /courses/:id.
      ingestingCourses.add(courseId);
      const job: Promise<void> = Promise.resolve()
        .then(() => deps.runIngest(deps.makeIngestDeps(), { courseId, title: input.title, files }))
        .then((report) => {
          if (report.error) console.error(`[ingest] ${courseId} failed: ${report.error}`);
          else if (!report.ok) console.warn(`[ingest] ${courseId} is ready, but some coverage targets were not met`);
        })
        .catch(async (err: unknown) => {
          // runIngest should never reject; if it does, don't leave the pack stuck in 'parsing'.
          console.error(`[ingest] ${courseId} crashed:`, err);
          const pack = await repo.getCoursePack(courseId);
          if (pack && pack.status.stage !== 'ready') {
            pack.status = { ...pack.status, stage: 'error', error: err instanceof Error ? err.message : String(err) };
            await repo.saveCoursePack(pack);
          }
        })
        .catch((err: unknown) => console.error(`[ingest] ${courseId} could not record its failure:`, err))
        .finally(() => { ingests.delete(job); ingestingCourses.delete(courseId); });
      ingests.add(job);

      return { courseId };
    },

    async getCourse(courseId) {
      const pack = await repo.getCoursePack(courseId);
      if (!pack) throw new AppError('not_found', `Course "${courseId}" not found`);
      return toPublicCourse(pack);
    },

    createRun: body => withCourseLock(body.courseId, async () => {
      const ctx = await loadContext(body.courseId);
      const seed = deps.newSeed();
      const rng = createRng(seed);
      const run = engine.createRun(engineDeps(rng), ctx, { ...body, rngSeed: seed });
      run.rngState = rng.state();
      await repo.saveRun(run);
      return publicRun(run, ctx);
    }),

    async getRun(runId) {
      const run = await loadRun(runId);
      return publicRun(run, await loadContext(run.courseId));
    },

    async teach(runId, explanation, conceptId) {
      const { out } = await mutate(runId, (d, ctx, run) => engine.teach(d, ctx, run, explanation, conceptId));
      return { notebookMd: out.run.notebookMd, questions: out.questions, ...(out.feedback ? {feedback:out.feedback} : {}) };
    },

    async answerQuestion(runId, studentQuestionId, answer) {
      const { out } = await mutate(runId, (d, ctx, run) =>
        engine.answerQuestion(d, ctx, run, studentQuestionId, answer),
      );
      return { resolved: out.resolved, notebookMd: out.run.notebookMd };
    },

    async skipQuestion(runId, studentQuestionId) {
      const { out } = await mutate(runId, (d, ctx, run) => engine.skipQuestion(d, ctx, run, studentQuestionId));
      return { notebookMd: out.run.notebookMd };
    },

    async ready(runId) {
      const { out, ctx } = await mutate(runId, (d, c, run) => engine.startRoom(d, c, run));
      return publicRun(out.run, ctx);
    },

    async turn(runId) {
      const { out } = await mutate(runId, (d, ctx, run) => engine.takeTurn(d, ctx, run));
      return out.result;
    },

    async help(runId, eventId, answer) {
      const { out } = await mutate(runId, (d, ctx, run) => engine.submitHelp(d, ctx, run, eventId, answer));
      return out.result;
    },

    async retry(runId) {
      const { out, ctx } = await mutate(runId, (d, c, run) => engine.retryRoom(d, c, run));
      return publicRun(out.run, ctx);
    },

    async continueRun(runId) {
      const { out, ctx } = await mutate(runId, (d, c, run) => engine.continueRun(d, c, run));
      return publicRun(out.run, ctx);
    },

    async getResults(runId) {
      return engine.getResults(await loadRun(runId));
    },

    async getDebug(runId): Promise<DebugResponse> {
      // Hidden state is only ever served when the server was started with DEBUG=true.
      if (!config.debug) throw new AppError('not_found', 'Debug is off (start the server with DEBUG=true)');
      const run = await loadRun(runId);
      const pack = await repo.getCoursePack(run.courseId);
      if (!pack) throw new AppError('not_found', `Course "${run.courseId}" not found`);
      const questions = await repo.listQuestions(run.courseId);
      const stats = await repo.getQuestionStats(questions.map((q) => q.id));
      const statsById = new Map(stats.map((s) => [s.questionId, s]));
      const timeBudgets: Record<string, TimeBudgetBreakdown> = {};
      for (const q of questions) {
        const breakdown = computeTimeBudget(q, config, materialTimeHintFor(q, pack));
        const calibrated = calibratedTimeBudget(statsById.get(q.id)?.helpMeSolveTimesSec ?? [], config);
        timeBudgets[q.id] =
          calibrated === null ? breakdown : { ...breakdown, source: 'calibrated', timeBudgetSec: calibrated };
      }
      return { run, pack, questions, stats, timeBudgets };
    },

    async idle() {
      while (ingests.size > 0) await Promise.allSettled([...ingests]);
    },
  };
}
