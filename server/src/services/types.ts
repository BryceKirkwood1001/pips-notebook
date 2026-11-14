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
} from '@top/shared';

export interface HealthInfo {
  ok: boolean;
  llmProvider: 'gemini' | 'openai' | 'mock';
  storage: 'mongodb' | 'memory';
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

  // Runs
  createRun(body: CreateRunBody): Promise<PublicRun>;
  getRun(runId: string): Promise<PublicRun>;
  teach(runId: string, explanation: string): Promise<TeachResponse>;
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
