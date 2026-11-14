import type { CoursePack, Question, QuestionStats, Run } from '@top/shared';
import type { Repository, StatsEvent } from './types';

/** Applies one event to a stats record (shared by the memory and Mongo implementations' tests). */
export function applyStatsEvent(stats: QuestionStats, e: StatsEvent): QuestionStats {
  if (e.kind === 'student_correct') stats.studentCorrect += 1;
  else if (e.kind === 'student_wrong') stats.studentWrong += 1;
  else if (e.kind === 'help_solve' && typeof e.solveTimeSec === 'number') stats.helpMeSolveTimesSec.push(e.solveTimeSec);
  return stats;
}

/** In-memory repository: Maps, deep copies on every read and write. */
export function createMemoryRepository(): Repository {
  const courses = new Map<string, CoursePack>();
  const questions = new Map<string, Question>();
  const stats = new Map<string, QuestionStats>();
  const runs = new Map<string, Run>();

  return {
    async init() {},
    async close() {},
    async listCoursePacks() { return [...courses.values()].map(p => structuredClone(p)); },
    async listRuns() { return [...runs.values()].map(r => structuredClone(r)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); },

    async saveCoursePack(pack) {
      courses.set(pack.id, structuredClone(pack));
    },
    async getCoursePack(courseId) {
      const p = courses.get(courseId);
      return p ? structuredClone(p) : null;
    },

    async upsertQuestions(list) {
      for (const q of list) questions.set(q.id, structuredClone(q));
    },
    async listQuestions(courseId, opts) {
      return [...questions.values()]
        .filter((q) => q.courseId === courseId && (!opts?.verifiedOnly || q.verified))
        .map((q) => structuredClone(q));
    },
    async deleteQuestions(courseId) {
      for (const [id, q] of questions) if (q.courseId === courseId) questions.delete(id);
    },

    async getQuestionStats(ids) {
      return ids.filter((id) => stats.has(id)).map((id) => structuredClone(stats.get(id) as QuestionStats));
    },
    async recordStats(events) {
      for (const e of events) {
        const cur = stats.get(e.questionId) ?? {
          questionId: e.questionId,
          helpMeSolveTimesSec: [],
          studentCorrect: 0,
          studentWrong: 0,
        };
        stats.set(e.questionId, applyStatsEvent(cur, e));
      }
    },

    async saveRun(run) {
      runs.set(run.id, structuredClone(run));
    },
    async getRun(runId) {
      const r = runs.get(runId);
      return r ? structuredClone(r) : null;
    },
    async deleteRun(runId) {
      return runs.delete(runId);
    },
  };
}
