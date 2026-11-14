import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ChunkSchema, CoursePackSchema, QuestionSchema, QuestionStatsSchema, RunSchema } from '@top/shared';
import type { Repository } from './types';
import type { VectorStore } from '../rag/types';
import { applyStatsEvent } from './memory';
import { compareChunks, cosine } from '../rag/util';

/** Serialized, atomic snapshots. Failed writes never replace the in-memory committed state. */
function snapshot<T>(file: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, initial: T) {
  let state = initial;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async init() {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      try { state = schema.parse(JSON.parse(await readFile(file, 'utf8'))); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    },
    read: () => structuredClone(state),
    update(change: (next: T) => void) {
      const job = queue.catch(() => undefined).then(async () => {
        const next = structuredClone(state); change(next);
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, file);
        state = next;
      });
      queue = job; return job;
    },
    idle: () => queue,
  };
}

export function createFileRepository(directory: string): Repository {
  const schema = z.object({ version: z.literal(1), courses: z.array(CoursePackSchema), questions: z.array(QuestionSchema),
    stats: z.array(QuestionStatsSchema), runs: z.array(RunSchema) });
  const data = snapshot(`${directory}/repository.json`, schema, { version: 1, courses: [], questions: [], stats: [], runs: [] });
  function put<T>(list: T[], item: T, key: (value: T) => string) {
    const index = list.findIndex(value => key(value) === key(item));
    if (index < 0) list.push(structuredClone(item)); else list[index] = structuredClone(item);
  }
  return {
    init: data.init, close: async () => { await data.idle(); },
    saveCoursePack: pack => data.update(s => put(s.courses, pack, p => p.id)),
    getCoursePack: async id => data.read().courses.find(p => p.id === id) ?? null,
    listCoursePacks: async () => data.read().courses,
    upsertQuestions: list => data.update(s => { for (const q of list) put(s.questions, q, q => q.id); }),
    listQuestions: async (id, options) => data.read().questions.filter(q => q.courseId === id && (!options?.verifiedOnly || q.verified)),
    deleteQuestions: id => data.update(s => { s.questions = s.questions.filter(q => q.courseId !== id); }),
    getQuestionStats: async ids => data.read().stats.filter(s => ids.includes(s.questionId)),
    recordStats: events => data.update(s => {
      for (const e of events) {
        const current = s.stats.find(q => q.questionId === e.questionId) ?? { questionId: e.questionId, studentCorrect: 0, studentWrong: 0, helpMeSolveTimesSec: [] };
        put(s.stats, applyStatsEvent(current, e), q => q.questionId);
      }
    }),
    saveRun: run => data.update(s => put(s.runs, run, r => r.id)),
    getRun: async id => data.read().runs.find(r => r.id === id) ?? null,
    listRuns: async () => data.read().runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

export function createFileVectorStore(directory: string): VectorStore {
  const data = snapshot(`${directory}/chunks.json`, z.array(ChunkSchema), []);
  return {
    init: data.init,
    upsert: list => data.update(chunks => {
      for (const c of list) { const i = chunks.findIndex(old => old.id === c.id); if (i < 0) chunks.push(structuredClone(c)); else chunks[i] = structuredClone(c); }
    }),
    listByCourse: async id => data.read().filter(c => c.courseId === id).sort(compareChunks),
    getByIds: async ids => { const chunks = data.read(); return ids.flatMap(id => chunks.filter(c => c.id === id)); },
    deleteCourse: id => data.update(chunks => { for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i].courseId === id) chunks.splice(i, 1); }),
    search: async ({ courseId, embedding, topK }) => data.read().filter(c => c.courseId === courseId)
      .map(chunk => ({ chunk, score: cosine(embedding, chunk.embedding) })).sort((a, b) => b.score - a.score).slice(0, topK),
  };
}
