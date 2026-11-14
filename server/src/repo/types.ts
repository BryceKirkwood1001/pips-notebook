/**
 * Storage contract (SPEC 3.1). Owner: game-engine (server/src/repo/**).
 *
 * FACTORIES other modules import from `server/src/repo/index.ts` (exact names):
 *   createMemoryRepository(): Repository
 *   createMongoRepository(db: Db): Repository        // `Db` from the official `mongodb` driver
 *
 * Collections (Mongo): `courses`, `questions`, `questionStats`, `runs`. Chunks live in the `chunks`
 * collection, which the VectorStore (server/src/rag) owns.
 *
 * Every method returns copies: callers may mutate what they get without touching stored state.
 */
import type { CoursePack, Question, QuestionStats, Run } from '@pips-notebook/shared';

/** What happened to a question in play. The service records these after each engine call. */
export interface StatsEvent {
  questionId: string;
  kind: 'student_correct' | 'student_wrong' | 'help_solve';
  /** Required for 'help_solve': the player's solve time of a CORRECT "Help me!" answer. */
  solveTimeSec?: number;
}

export interface Repository {
  /** Creates indexes. A no-op for the memory repo. Safe to call twice. */
  init(): Promise<void>;
  close(): Promise<void>;

  // Courses
  /** Insert or replace by `pack.id`. */
  saveCoursePack(pack: CoursePack): Promise<void>;
  getCoursePack(courseId: string): Promise<CoursePack | null>;
  listCoursePacks(): Promise<CoursePack[]>;
  /** Removes the course, its questions/stats and every associated run. Chunks are owned by VectorStore. */
  deleteCourse(courseId: string): Promise<boolean>;

  // Questions
  /** Insert or replace by question id. */
  upsertQuestions(questions: Question[]): Promise<void>;
  /** All questions of a course. With `verifiedOnly`, only those that may be served. */
  listQuestions(courseId: string, opts?: { verifiedOnly?: boolean }): Promise<Question[]>;
  deleteQuestions(courseId: string): Promise<void>;

  // Question stats
  /** Stats for the given question ids. Questions never played are simply absent. */
  getQuestionStats(questionIds: string[]): Promise<QuestionStats[]>;
  /** Applies events atomically per question (increments, or appends a solve time). */
  recordStats(events: StatsEvent[]): Promise<void>;

  // Runs
  /** Insert or replace by `run.id`. */
  saveRun(run: Run): Promise<void>;
  getRun(runId: string): Promise<Run | null>;
  listRuns(): Promise<Run[]>;
  /** Permanently removes the run. Returns false when there was no such run. */
  deleteRun(runId: string): Promise<boolean>;
}
