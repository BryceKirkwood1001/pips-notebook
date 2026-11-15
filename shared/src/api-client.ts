/**
 * Pip's Notebook API client.
 *
 * ONE FILE, ZERO IMPORTS, on purpose: copy this file into any front end (the Phaser AE game, the test
 * client, a script) and it works. It only needs a `fetch`. The types below are plain TypeScript mirrors
 * of the public Zod schemas in `schemas.ts`; `type-sync.ts` fails the type check if they drift apart.
 *
 * This edition has no server: the "API" runs inside the page (server/src/browser/main.ts), and the game
 * hands its `fetch` to this client, so requests never leave the browser:
 *
 *   const backend = await start();                                  // from backend.js
 *   const api = createApiClient({ baseUrl: BACKEND_ORIGIN, fetch: backend.fetch });
 *   const { courseId } = await api.seedCourse('seasons');
 *   const run = await api.createRun({ courseId, targetGrade: 'B' });
 *
 * Every method rejects with an `ApiError` (status, code, message) on a non-2xx response.
 * Nothing this client returns contains answer keys or misconception data, except `getDebug` and `exportBackup`.
 */

// ── Public types ────────────────────────────────────────────────────────────

export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'multi_select'
  | 'numeric'
  | 'short_text'
  | 'ordering'
  | 'free_response';

export type TargetGrade = 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D';
export type LetterGrade = TargetGrade | 'F';
export type RunPhase = 'learning' | 'room' | 'room_result' | 'boss' | 'results';
export type IngestStage = 'parsing' | 'outline' | 'style' | 'concepts' | 'ready' | 'error';

export const TARGET_GRADES: TargetGrade[] = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];
/** The student is never a human or face emoji. */
export const STUDENT_EMOJIS = ['🤖', '🐙', '🦉', '🐸', '👾'] as const;
export type StudentEmoji = (typeof STUDENT_EMOJIS)[number];

/**
 * An answer. Set the one field that fits the question type:
 *   mcq -> choiceIndex | true_false -> value (boolean) | multi_select -> choiceIndexes
 *   numeric -> value (number) | short_text, free_response -> text | ordering -> order (item indexes)
 * `dontKnow` is only ever set by the student.
 */
export interface Answer {
  choiceIndex?: number;
  choiceIndexes?: number[];
  value?: number | boolean;
  text?: string;
  order?: number[];
  dontKnow?: boolean;
}

interface PublicQuestionBase {
  id: string;
  prompt: string;
  /** 1 (easy) to 5 (hard). */
  difficulty: number;
  /** Seconds a player should need. Show it on "Help me!" events. */
  timeBudgetSec: number;
}
/** A question as the client may see it before it is answered. */
export type PublicQuestion =
  | (PublicQuestionBase & { type: 'mcq'; payload: { options: string[] } })
  | (PublicQuestionBase & { type: 'true_false'; payload: { statement: string } })
  | (PublicQuestionBase & { type: 'multi_select'; payload: { options: string[] } })
  | (PublicQuestionBase & { type: 'numeric'; payload: { unit: string | null } })
  | (PublicQuestionBase & { type: 'short_text'; payload: {} })
  | (PublicQuestionBase & { type: 'ordering'; payload: { items: string[] } })
  | (PublicQuestionBase & { type: 'free_response'; payload: {} });

export interface RevealedAnswer {
  answer: Answer;
  /** Display form, e.g. the option text or "23.5 degrees". */
  text: string;
}

export interface MaterialRef {
  fileId: string;
  fileName: string;
  page: number;
  sectionPath: string[];
  quote: string;
}

export interface CostlyMisconception {
  id: string;
  conceptId: string;
  conceptTitle: string;
  description: string;
  beliefStatement: string;
  correction: string;
  origin: 'stated' | 'skipped';
  questionId: string;
  questionPrompt: string;
  materialRef: MaterialRef;
}

export interface Results {
  predictedGradePct: number;
  letter: LetterGrade;
  target: TargetGrade;
  metTarget: boolean;
  conceptAccuracy: { conceptId: string; title: string; correct: number; total: number; accuracy: number }[];
  helpMe: { offered: number; correct: number; wrong: number; late: number; avgSolveTimeSec: number | null };
  costlyMisconceptions: CostlyMisconception[];
}

interface DamageFields {
  /** Hearts lost (room: 0 or 1) or health lost (boss). */
  damage: number;
  /** Room fights only. */
  hearts?: number;
  /** Boss only. */
  health?: number;
  /** 'room_result' or 'results' means the fight just ended: call turn() once more for the summary. */
  phaseAfter: RunPhase;
}

export type StudentAnswerTurn = DamageFields & {
  kind: 'student_answer';
  question: PublicQuestion;
  answer: Answer;
  answerText: string;
  correct: boolean;
  correctAnswer: RevealedAnswer;
  explanation: string;
  reasoning: string;
  citedNotes: string[];
  reason?: 'not in my notes' | 'wrong belief' | 'unknown';
};

export interface HelpMeTurn {
  kind: 'help_me';
  eventId: string;
  question: PublicQuestion;
  timeBudgetSec: number;
  /** ISO timestamp, or null in untimed mode: show no countdown. */
  deadline: string | null;
}

export type HelpResultTurn = DamageFields & {
  kind: 'help_result';
  eventId: string;
  question: PublicQuestion;
  correct: boolean;
  late: boolean;
  correctAnswer: RevealedAnswer;
  explanation: string;
  solveTimeSec: number;
  noteAdded?: string;
};

export interface FailedTurn {
  question: PublicQuestion;
  reasoning: string;
  citedNotes: string[];
}

export interface RoomEndTurn {
  kind: 'room_end';
  passed: boolean;
  hearts: number;
  /** The reasoning trace: every wrong student answer of this attempt. */
  failedTurns: FailedTurn[];
}

export interface BossEndTurn {
  kind: 'boss_end';
  results: Results;
}

export type TurnResult = StudentAnswerTurn | HelpMeTurn | HelpResultTurn | RoomEndTurn | BossEndTurn;

export interface PublicStudentQuestion {
  id: string;
  text: string;
  status: 'open' | 'answered' | 'skipped';
  /** The concept Pip is asking about. */
  conceptId?: string;
}

/** A finished room attempt: only turns and learning counts the player already saw. */
export interface PublicRoomReport {
  roomId: string;
  title: string;
  attempt: number;
  passed: boolean;
  hearts: number;
  maxHearts: number;
  correct: number;
  total: number;
  /** Turns the player answered through "Help me!". */
  helped: number;
  teachCount: number;
  questionsAsked: number;
  questionsAnswered: number;
  questionsSkipped: number;
  missed: { prompt: string; by: 'student' | 'help'; concepts: { id: string; title: string }[] }[];
}

export interface PublicRunRoom {
  id: string;
  title: string;
  description?: string;
  learningObjectives?: string[];
  concepts: { id: string; title: string; summary?: string }[];
  ready: boolean;
  state: 'upcoming' | 'current' | 'passed';
}

export interface PublicRun {
  pausedAt?: string;
  /** The player ended this expedition early; it is a read-only record. */
  endedAt?: string;
  id: string;
  courseId: string;
  courseTitle: string;
  targetGrade: TargetGrade;
  studentEmoji: string;
  phase: RunPhase;
  roomIndex: number;
  rooms: PublicRunRoom[];
  /** null during boss and results. */
  currentRoom: PublicRunRoom | null;
  /** Markdown: "# Notebook", then one "## <Concept title>" section per concept with "- " bullets. */
  notebookMd: string;
  learning: { pendingQuestions: PublicStudentQuestion[]; teachCount: number };
  room?: {
    attempt: number;
    turn: number;
    totalTurns: number;
    hearts: number;
    maxHearts: number;
    helpMeUsed: number;
    log: TurnResult[];
    passed?: boolean;
    /** The question the next turn asks (public form), so it can be shown before Pip answers. */
    nextQuestion?: PublicQuestion;
  };
  boss?: { turn: number; totalTurns: number; health: number; helpMeUsed: number; log: TurnResult[]; nextQuestion?: PublicQuestion };
  pendingHelpMe?: HelpMeTurn;
  results?: Results;
  /** Finished room attempts, oldest first. Absent until the first room fight ends. */
  history?: PublicRoomReport[];
  rules: {
    roomQuestions: number;
    roomHearts: number;
    bossQuestions: number;
    maxStudentQuestions: number;
    helpMeTimed: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CourseActivity {
  message: string;
  summary?: string;
  completed?: number;
  total?: number;
}

export interface PublicCourse {
  id: string;
  title: string;
  status: { stage: IngestStage; conceptsReady: string[]; error?: string; activity?: CourseActivity };
  files: { id: string; name: string; type: 'pdf' | 'txt' | 'md'; pages: number }[];
  units: { id: string; title: string; concepts: { id: string; title: string; summary?: string; ready: boolean }[] }[];
  rooms: { id: string; title: string; description?: string; learningObjectives?: string[]; conceptIds: string[]; ready: boolean }[];
  styleSummary: {
    voice: string;
    notation: string;
    codeLanguage?: string;
    units?: string;
    topFormats: QuestionType[];
  };
}

export interface CreateRunBody {
  courseId: string;
  targetGrade: TargetGrade;
  studentEmoji?: StudentEmoji;
  /** Defaults to every room of the course. */
  scope?: { roomIds: string[] };
}

export interface ArchiveResponse {
  courses: PublicCourse[];
  /** Most recently updated first. `rooms` is how many rooms the expedition covers. */
  runs: {id: string; courseId: string; phase: RunPhase; roomIndex: number; rooms: number; updatedAt: string; pausedAt?: string; endedAt?: string}[];
}

export interface TeachResponse {
  /** Pip's reply to this explanation; may be absent on older/offline backends. */
  feedback?: string;
  notebookMd: string;
  questions: PublicStudentQuestion[];
}

// ── Client ──────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The made-up origin of the in-page backend. Its requests are answered in the page and never reach a network. */
export const BACKEND_ORIGIN = 'https://backend.pips-notebook.invalid';

export interface ApiClientOptions {
  /** Origin of the backend, without the /api suffix. Default: BACKEND_ORIGIN (with the in-page backend's `fetch`). */
  baseUrl?: string;
  /** Override for tests or non-browser runtimes. Default: globalThis.fetch */
  fetch?: typeof fetch;
}

export interface UploadFile {
  name: string;
  data: Blob;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export type LlmProvider = 'mock' | 'gemini' | 'openai';
export interface ApiProviderSettings { model: string; embeddingModel: string; hasApiKey: boolean }
export interface ApiSettings {
  provider: LlmProvider;
  providers: { openai: ApiProviderSettings; gemini: ApiProviderSettings };
  timeoutMs: number;
  ingestTimeoutMs: number;
  embeddingDims: number;
  persistence: 'local' | 'session';
}
export interface UpdateApiSettingsBody {
  provider: LlmProvider;
  openai?: { model?: string; embeddingModel?: string; apiKey?: string | null };
  gemini?: { model?: string; embeddingModel?: string; apiKey?: string | null };
  timeoutMs?: number;
  ingestTimeoutMs?: number;
  /** true: keep the settings and keys in this browser; false: only in this tab, until it closes. Omitted = unchanged. */
  rememberKey?: boolean;
}
export interface TestApiSettingsResponse { ok: boolean; provider: LlmProvider; message: string }

/** Where dungeons are saved: this browser's IndexedDB, or memory when the browser blocks storage. */
export interface StorageSettings {
  active: 'browser' | 'memory';
  courses: number;
  runs: number;
  /** True when the browser promised not to clear this site's data to free space; null when it cannot say. */
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Why the browser's storage is not in use, when it is not. */
  error: string | null;
}
/**
 * Every dungeon and expedition in this browser, as one JSON file. It holds answer keys (it is the player's own
 * copy) and never API keys. Treat it as opaque: save it, and hand it back to importBackup().
 */
export interface Backup {
  app: 'pips-notebook';
  version: 1;
  exportedAt: string;
  courses: unknown[];
  questions: unknown[];
  questionStats: unknown[];
  chunks: unknown[];
  runs: unknown[];
}
export interface ImportBackupResponse { courses: number; runs: number; skipped: number }

export function createApiClient(options: ApiClientOptions = {}) {
  const base = (options.baseUrl ?? BACKEND_ORIGIN).replace(/\/+$/, '') + '/api';
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const init: RequestInit = { method };
    if (form) {
      init.body = form;
    } else if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await doFetch(base + path, init);
    } catch (err) {
      throw new ApiError(0, 'network_error', err instanceof Error ? err.message : 'Network error');
    }
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `HTTP ${res.status}`);
    }
    return json as T;
  }

  const enc = encodeURIComponent;

  return {
    /** AI provider setup. Keys are write-only and stay in this browser; blank key inputs should be omitted. */
    getApiSettings: () => request<ApiSettings>('GET', '/settings/api'),
    updateApiSettings: (body: UpdateApiSettingsBody) => request<ApiSettings>('POST', '/settings/api', body),
    testApiSettings: (body: UpdateApiSettingsBody) => request<TestApiSettingsResponse>('POST', '/settings/api/test', body),
    /** What is saved in this browser. */
    getStorageSettings: () => request<StorageSettings>('GET', '/settings/storage'),
    /** GET /backup: every dungeon and expedition, for a JSON file the player keeps. */
    exportBackup: () => request<Backup>('GET', '/backup'),
    /** POST /backup: adds the dungeons of a backup. Ones already saved here are skipped. */
    importBackup: (backup: unknown) => request<ImportBackupResponse>('POST', '/backup', backup),
    /** GET /health */
    health: () => request<{ ok: boolean; llmProvider: string; storage: string; debug: boolean }>('GET', '/health'),

    /** GET /samples: the cached sample packs that seedCourse() accepts. */
    listSamples: () => request<{ samples: { id: string; title: string }[] }>('GET', '/samples'),
    listArchive: () => request<ArchiveResponse>('GET', '/archive'),

    /** POST /courses/seed/:sample: load a cached sample pack instantly. */
    seedCourse: (sample: string) => request<{ courseId: string }>('POST', `/courses/seed/${enc(sample)}`),

    /** POST /courses with JSON { text, title }. Ingest runs in the background: poll getCourse(). */
    createCourseFromText: (text: string, title?: string) =>
      request<{ courseId: string }>('POST', '/courses', { text, title }),

    /** Multipart sources for one course. Optional notes become a distinct Markdown file, preserving source evidence. */
    uploadCourse: (files: UploadFile[], title?: string, notes?: string) => {
      const form = new FormData();
      if (title) form.append('title', title);
      for (const f of files) form.append('files', f.data, f.name);
      if (notes?.trim()) {
        const names = new Set(files.map(file => file.name.toLowerCase()));
        let name = 'pasted-notes.md';
        for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `pasted-notes-${suffix}.md`;
        form.append('files', new Blob([notes], { type: 'text/markdown' }), name);
      }
      return request<{ courseId: string }>('POST', '/courses', undefined, form);
    },

    /** GET /courses/:id: ingest status, units, rooms. */
    getCourse: (courseId: string) => request<PublicCourse>('GET', `/courses/${enc(courseId)}`),
    /** Permanently deletes a dungeon, its lessons and all associated expeditions. */
    deleteCourse: (courseId: string) => request<{ deleted: true; id: string }>('DELETE', `/courses/${enc(courseId)}`),

    /** POST /runs. 425 if the first room in scope isn't ingested yet. */
    createRun: (body: CreateRunBody) => request<PublicRun>('POST', '/runs', body),

    /** GET /runs/:id */
    getRun: (runId: string) => request<PublicRun>('GET', `/runs/${enc(runId)}`),
    pauseRun: (runId: string) => request<PublicRun>('POST', `/runs/${enc(runId)}/pause`),
    resumeRun: (runId: string) => request<PublicRun>('POST', `/runs/${enc(runId)}/resume`),
    /** POST /runs/:id/end: end the expedition early; it stays in the archive as a read-only record. */
    endRun: (runId: string) => request<PublicRun>('POST', `/runs/${enc(runId)}/end`),
    /** DELETE /runs/:id: permanently remove the expedition (its course stays). */
    deleteRun: (runId: string) => request<{ deleted: true; id: string }>('DELETE', `/runs/${enc(runId)}`),

    /** POST /runs/:id/teach (phase: learning). The student takes notes and may ask questions. */
    teach: (runId: string, explanation: string, conceptId?: string) =>
      request<TeachResponse>('POST', `/runs/${enc(runId)}/teach`, conceptId ? { explanation, conceptId } : { explanation }),

    /** POST /runs/:id/questions/:qid/answer (phase: learning). */
    answerQuestion: (runId: string, questionId: string, answer: string) =>
      request<{ resolved: boolean; notebookMd: string }>(
        'POST',
        `/runs/${enc(runId)}/questions/${enc(questionId)}/answer`,
        { answer },
      ),

    /** POST /runs/:id/questions/:qid/skip (phase: learning). Skipping is the risk. */
    skipQuestion: (runId: string, questionId: string) =>
      request<{ notebookMd: string }>('POST', `/runs/${enc(runId)}/questions/${enc(questionId)}/skip`),

    /** POST /runs/:id/ready (phase: learning -> room). 425 if the room isn't ingested yet. */
    ready: (runId: string) => request<PublicRun>('POST', `/runs/${enc(runId)}/ready`),

    /**
     * POST /runs/:id/turn (phases: room, room_result, boss, results).
     * Keep calling until you get `room_end` or `boss_end`. A `help_me` result must be answered with help().
     */
    turn: (runId: string) => request<TurnResult>('POST', `/runs/${enc(runId)}/turn`),

    /** POST /runs/:id/help/:eventId: the player's answer to a "Help me!" event. */
    help: (runId: string, eventId: string, answer: Answer) =>
      request<TurnResult>('POST', `/runs/${enc(runId)}/help/${enc(eventId)}`, { answer }),

    /** POST /runs/:id/retry (phase: room_result, failed) -> learning for the same room. */
    retry: (runId: string) => request<PublicRun>('POST', `/runs/${enc(runId)}/retry`),

    /** POST /runs/:id/continue (phase: room_result, passed) -> next room's learning, or boss. */
    continueRun: (runId: string) => request<PublicRun>('POST', `/runs/${enc(runId)}/continue`),

    /** GET /runs/:id/results (phase: results). */
    getResults: (runId: string) => request<Results>('GET', `/runs/${enc(runId)}/results`),

    /** GET /runs/:id/debug: everything, hidden fields included. 404 unless the server has DEBUG=true. */
    getDebug: (runId: string) => request<unknown>('GET', `/runs/${enc(runId)}/debug`),
  };
}
