import type { Db } from 'mongodb';
import type { CoursePack, Question, QuestionStats, Run } from '@top/shared';
import type { Repository } from './types';

/** A stored document: the entity plus `_id` (the entity id). */
type Doc<T> = T & { _id: string };

/** Drops `_id` so callers get exactly the entity they saved. */
function strip<T>(doc: Doc<T> | null): T | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  void _id;
  return rest as unknown as T;
}

/** MongoDB repository. Collections: courses, questions, questionStats, runs. `_id` is the entity id. */
export function createMongoRepository(db: Db): Repository {
  const courses = db.collection<Doc<CoursePack>>('courses');
  const questions = db.collection<Doc<Question>>('questions');
  const stats = db.collection<Doc<QuestionStats>>('questionStats');
  const runs = db.collection<Doc<Run>>('runs');

  return {
    async init() {
      // createIndex is idempotent.
      await questions.createIndex({ courseId: 1 });
    },
    async close() {
      // The caller owns the MongoClient; nothing to close here.
    },

    async saveCoursePack(pack) {
      await courses.replaceOne({ _id: pack.id }, { ...pack, _id: pack.id } as Doc<CoursePack>, { upsert: true });
    },
    async getCoursePack(courseId) {
      return strip<CoursePack>(await courses.findOne({ _id: courseId }));
    },

    async upsertQuestions(list) {
      if (list.length === 0) return;
      await questions.bulkWrite(
        list.map((q) => ({
          replaceOne: { filter: { _id: q.id }, replacement: { ...q, _id: q.id } as Doc<Question>, upsert: true },
        })),
      );
    },
    async listQuestions(courseId, opts) {
      const filter = opts?.verifiedOnly ? { courseId, verified: true } : { courseId };
      const docs = await questions.find(filter).toArray();
      return docs.map((d) => strip<Question>(d) as Question);
    },
    async deleteQuestions(courseId) {
      await questions.deleteMany({ courseId });
    },

    async getQuestionStats(ids) {
      if (ids.length === 0) return [];
      const docs = await stats.find({ _id: { $in: ids } }).toArray();
      return docs.map((d) => {
        const s = strip<QuestionStats>(d) as QuestionStats;
        return { ...s, questionId: d._id };
      });
    },
    async recordStats(events) {
      for (const e of events) {
        // $setOnInsert can't touch fields that $inc/$push also touch, so every field is written by an operator.
        if (e.kind === 'help_solve') {
          if (typeof e.solveTimeSec !== 'number') continue;
          await stats.updateOne(
            { _id: e.questionId },
            {
              $push: { helpMeSolveTimesSec: e.solveTimeSec },
              $inc: { studentCorrect: 0, studentWrong: 0 },
              $setOnInsert: { questionId: e.questionId },
            },
            { upsert: true },
          );
        } else {
          const field = e.kind === 'student_correct' ? 'studentCorrect' : 'studentWrong';
          const other = field === 'studentCorrect' ? 'studentWrong' : 'studentCorrect';
          await stats.updateOne(
            { _id: e.questionId },
            {
              $inc: { [field]: 1, [other]: 0 },
              $push: { helpMeSolveTimesSec: { $each: [] } },
              $setOnInsert: { questionId: e.questionId },
            },
            { upsert: true },
          );
        }
      }
    },

    async saveRun(run) {
      await runs.replaceOne({ _id: run.id }, { ...run, _id: run.id } as Doc<Run>, { upsert: true });
    },
    async getRun(runId) {
      return strip<Run>(await runs.findOne({ _id: runId }));
    },
  };
}
