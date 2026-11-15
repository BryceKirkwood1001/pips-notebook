/**
 * Game configuration (SPEC 7): rules, limits and model defaults, named like the environment variables of the
 * original server edition.
 *
 * `loadConfig(env)` is pure. The browser passes `{}` (every default; the player's provider and keys come from
 * Settings, settings.ts), tests pass a plain object, and the Node scripts pass `process.env`.
 */
import { z } from 'zod';
import { TARGET_GRADES, type CoursePace, type TargetGrade } from '@pips-notebook/shared';

export type GradeThresholds = Record<TargetGrade, number>;

export interface Config {
  // LLM
  geminiApiKey: string;
  geminiModel: string;
  geminiEmbeddingModel: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiEmbeddingModel: string;
  llmProvider: 'gemini' | 'openai' | 'mock';
  embeddingModel: string;
  embeddingDims: number;
  llmTimeoutMs: number;
  ingestLlmTimeoutMs: number;
  // Diagnostics
  debug: boolean;
  // Ingest / RAG
  chunkTokens: number;
  chunkOverlap: number;
  retrievalTopK: number;
  maxUploadMb: number;
  maxPages: number;
  genBatchSize: number;
  ingestConcurrency: number;
  // Gameplay
  maxStudentQuestions: number;
  roomQuestions: number;
  roomHearts: number;
  roomPoolFactor: number;
  /** Bookmarked Option A. Not implemented: the engine ignores it. */
  roomDamageCarriesOver: boolean;
  bossQuestions: number;
  bossTargetedShare: number;
  // "Help me!"
  helpMeProb: number;
  /** Set only by a course's pace (demos): "Help me!" always comes on this turn of the room fight (1-based). */
  helpMeRoomTurn?: number;
  helpMeMaxPerRoom: number;
  helpMeMaxPerBoss: number;
  helpMeTimed: boolean;
  helpMeTimeMultiplier: number;
  helpMeMinSec: number;
  helpMeMaxSec: number;
  gradeThresholds: GradeThresholds;
  demoMode: boolean;
}

export const DEFAULT_GRADE_THRESHOLDS: GradeThresholds = {
  A: 93,
  'A-': 90,
  'B+': 87,
  B: 83,
  'B-': 80,
  'C+': 77,
  C: 73,
  'C-': 70,
  D: 60,
};

const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : v.trim()));

const num = (def: number, check: (n: number) => boolean = () => true) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return def;
      const n = Number(v);
      if (!Number.isFinite(n) || !check(n)) {
        ctx.addIssue({ code: 'custom', message: `invalid number "${v}"` });
        return z.NEVER;
      }
      return n;
    });

const int = (def: number, min = 0) => num(def, (n) => Number.isInteger(n) && n >= min);

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === '') return def;
      return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase());
    });

/** "A:93,A-:90,..." -> thresholds. Missing grades fall back to the defaults. */
export function parseGradeThresholds(raw: string | undefined): GradeThresholds {
  const out: GradeThresholds = { ...DEFAULT_GRADE_THRESHOLDS };
  if (!raw || raw.trim() === '') return out;
  for (const part of raw.split(',')) {
    const [grade, value] = part.split(':').map((s) => s.trim());
    const n = Number(value);
    if (!(TARGET_GRADES as readonly string[]).includes(grade) || !Number.isFinite(n) || n < 0 || n > 100) {
      throw new Error(`GRADE_THRESHOLDS: cannot parse "${part}"`);
    }
    out[grade as TargetGrade] = n;
  }
  return out;
}

const EnvSchema = z.object({
  GEMINI_API_KEY: str(''),
  GEMINI_MODEL: str('gemini-2.5-flash'),
  OPENAI_API_KEY: str(''),
  OPENAI_MODEL: str('gpt-5.6-luna'),
  OPENAI_EMBEDDING_MODEL: str('text-embedding-3-small'),
  LLM_PROVIDER: str(''),
  EMBEDDING_MODEL: str('gemini-embedding-001'),
  EMBEDDING_DIMS: int(768, 1),
  LLM_TIMEOUT_MS: int(30000, 1),
  INGEST_LLM_TIMEOUT_MS: num(180000, n => Number.isInteger(n) && n >= 1000 && n <= 600000),
  DEBUG: bool(false),
  CHUNK_TOKENS: int(400, 50),
  CHUNK_OVERLAP: num(0.15, (n) => n >= 0 && n < 1),
  RETRIEVAL_TOP_K: int(6, 1),
  MAX_UPLOAD_MB: num(25, (n) => n > 0),
  MAX_PAGES: int(300, 1),
  GEN_BATCH_SIZE: int(5, 1),
  INGEST_CONCURRENCY: int(4, 1),
  MAX_STUDENT_QUESTIONS: int(3, 0),
  ROOM_QUESTIONS: int(5, 1),
  ROOM_HEARTS: int(3, 1),
  ROOM_POOL_FACTOR: num(2, (n) => n >= 1),
  ROOM_DAMAGE_CARRIES_OVER: bool(false),
  BOSS_QUESTIONS: int(10, 1),
  BOSS_TARGETED_SHARE: num(0.5, (n) => n >= 0 && n <= 1),
  HELP_ME_PROB: num(0.25, (n) => n >= 0 && n <= 1),
  HELP_ME_MAX_PER_ROOM: int(1, 0),
  HELP_ME_MAX_PER_BOSS: int(2, 0),
  HELP_ME_TIMED: bool(true),
  HELP_ME_TIME_MULTIPLIER: num(1.0, (n) => n > 0),
  HELP_ME_MIN_SEC: int(20, 1),
  HELP_ME_MAX_SEC: int(240, 1),
  GRADE_THRESHOLDS: z.string().optional(),
  DEMO_MODE: bool(false),
});

export type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = {}): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${detail}`);
  }
  const e = parsed.data;

  const provider = e.LLM_PROVIDER.toLowerCase();
  if (provider !== '' && provider !== 'gemini' && provider !== 'openai' && provider !== 'mock') {
    throw new Error('Invalid configuration: LLM_PROVIDER must be "gemini", "openai" or "mock"');
  }
  // No explicit provider: prefer an available Gemini key, then OpenAI, then offline mocks.
  const llmProvider: Config['llmProvider'] =
    provider === '' ? (e.GEMINI_API_KEY ? 'gemini' : e.OPENAI_API_KEY ? 'openai' : 'mock') : (provider as Config['llmProvider']);
  if (llmProvider === 'gemini' && !e.GEMINI_API_KEY) {
    throw new Error('Invalid configuration: LLM_PROVIDER=gemini needs GEMINI_API_KEY');
  }
  if (llmProvider === 'openai' && !e.OPENAI_API_KEY) {
    throw new Error('Invalid configuration: LLM_PROVIDER=openai needs OPENAI_API_KEY');
  }

  const config: Config = {
    geminiApiKey: e.GEMINI_API_KEY,
    geminiModel: e.GEMINI_MODEL,
    geminiEmbeddingModel: e.EMBEDDING_MODEL,
    openaiApiKey: e.OPENAI_API_KEY,
    openaiModel: e.OPENAI_MODEL,
    openaiEmbeddingModel: e.OPENAI_EMBEDDING_MODEL,
    llmProvider,
    embeddingModel: llmProvider === 'openai' ? e.OPENAI_EMBEDDING_MODEL : e.EMBEDDING_MODEL,
    embeddingDims: e.EMBEDDING_DIMS,
    llmTimeoutMs: e.LLM_TIMEOUT_MS,
    ingestLlmTimeoutMs: e.INGEST_LLM_TIMEOUT_MS,
    debug: e.DEBUG,
    chunkTokens: e.CHUNK_TOKENS,
    chunkOverlap: e.CHUNK_OVERLAP,
    retrievalTopK: e.RETRIEVAL_TOP_K,
    maxUploadMb: e.MAX_UPLOAD_MB,
    maxPages: e.MAX_PAGES,
    genBatchSize: e.GEN_BATCH_SIZE,
    ingestConcurrency: e.INGEST_CONCURRENCY,
    maxStudentQuestions: e.MAX_STUDENT_QUESTIONS,
    roomQuestions: e.ROOM_QUESTIONS,
    roomHearts: e.ROOM_HEARTS,
    roomPoolFactor: e.ROOM_POOL_FACTOR,
    roomDamageCarriesOver: e.ROOM_DAMAGE_CARRIES_OVER,
    bossQuestions: e.BOSS_QUESTIONS,
    bossTargetedShare: e.BOSS_TARGETED_SHARE,
    helpMeProb: e.HELP_ME_PROB,
    helpMeMaxPerRoom: e.HELP_ME_MAX_PER_ROOM,
    helpMeMaxPerBoss: e.HELP_ME_MAX_PER_BOSS,
    helpMeTimed: e.HELP_ME_TIMED,
    helpMeTimeMultiplier: e.HELP_ME_TIME_MULTIPLIER,
    helpMeMinSec: e.HELP_ME_MIN_SEC,
    helpMeMaxSec: e.HELP_ME_MAX_SEC,
    gradeThresholds: parseGradeThresholds(e.GRADE_THRESHOLDS),
    demoMode: e.DEMO_MODE,
  };

  if (config.helpMeMinSec > config.helpMeMaxSec) {
    throw new Error('Invalid configuration: HELP_ME_MIN_SEC is larger than HELP_ME_MAX_SEC');
  }

  // Demo mode: a shorter gauntlet for the live demo (SPEC 7).
  if (config.demoMode) {
    config.bossQuestions = 6;
    config.roomQuestions = 3;
    config.helpMeTimeMultiplier = 0.75;
  }
  return config;
}

/** A config for tests: all defaults, mock LLM, in-memory storage, plus overrides. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ LLM_PROVIDER: 'mock' }), ...overrides };
}

/** The settings for a run of a course with its own pace (short demos); other courses get `config` unchanged. */
export function withPace(config: Config, pace: CoursePace | undefined): Config {
  if (!pace) return config;
  const paced = { ...config };
  for (const key of ['roomQuestions', 'roomHearts', 'bossQuestions', 'maxStudentQuestions', 'helpMeProb', 'helpMeRoomTurn'] as const) {
    if (pace[key] !== undefined) paced[key] = pace[key];
  }
  return paced;
}
