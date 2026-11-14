/**
 * The service layer: what the HTTP routes call. One method per endpoint (SPEC 6). Each method loads
 * what it needs from the repository, calls the engine or the ingest pipeline, saves, and returns a
 * PUBLIC shape. Owner: orchestrator.
 */
import type {
  Answer,
  AnswerQuestionResponse,
  CreateCourseResponse,
  CreateRunBody,
  DebugResponse,
  PublicCourse,
  PublicRun,
  Results,
  SamplesResponse,
  SkipQuestionResponse,
  TeachResponse,
  TurnResult,
} from '@pips-notebook/shared';

export interface HealthInfo {
  ok: boolean;
  llmProvider: 'gemini' | 'openai' | 'mock';
  storage: 'mongodb' | 'memory' | 'local';
  debug: boolean;
}

/** One uploaded file as the route hands it over. The type is derived from the file name. */
export interface UploadInput {
  name: string;
  data: Uint8Array;
}

export interface Services {
  health(): HealthInfo;

  // Courses
  listSamples(): Promise<SamplesResponse>;
  seedCourse(sample: string): Promise<CreateCourseResponse>;
  /** Saves an empty pack, starts progressive ingest in the background and returns at once. */
  createCourse(input: { title?: string; files: UploadInput[] }): Promise<CreateCourseResponse>;
  getCourse(courseId: string): Promise<PublicCourse>;
  deleteCourse(courseId: string): Promise<{ deleted: true; id: string }>;
  listArchive(): Promise<{ courses: PublicCourse[]; runs: { id: string; courseId: string; phase: PublicRun['phase']; roomIndex: number; rooms: number; updatedAt: string; pausedAt?: string; endedAt?: string }[] }>;

  // Runs
  createRun(body: CreateRunBody): Promise<PublicRun>;
  getRun(runId: string): Promise<PublicRun>;
  pauseRun(runId: string): Promise<PublicRun>;
  resumeRun(runId: string): Promise<PublicRun>;
  /** Ends the expedition early: kept as a read-only record (idempotent). A finished run is wrong_phase. */
  endRun(runId: string): Promise<PublicRun>;
  /** Permanently removes the run. Its course, questions and stats stay. */
  deleteRun(runId: string): Promise<{ deleted: true; id: string }>;
  /** `conceptId` focuses the lesson on one concept of the current room. */
  teach(runId: string, explanation: string, conceptId?: string): Promise<TeachResponse>;
  answerQuestion(runId: string, studentQuestionId: string, answer: string): Promise<AnswerQuestionResponse>;
  skipQuestion(runId: string, studentQuestionId: string): Promise<SkipQuestionResponse>;
  ready(runId: string): Promise<PublicRun>;
  turn(runId: string): Promise<TurnResult>;
  help(runId: string, eventId: string, answer: Answer): Promise<TurnResult>;
  retry(runId: string): Promise<PublicRun>;
  continueRun(runId: string): Promise<PublicRun>;
  getResults(runId: string): Promise<Results>;
  /** Throws not_found unless DEBUG=true. */
  getDebug(runId: string): Promise<DebugResponse>;

  /** Resolves when background ingests have finished. For tests and scripts. */
  idle(): Promise<void>;
}
