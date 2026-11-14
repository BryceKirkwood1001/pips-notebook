/**
 * LLM layer contracts (SPEC 5). Two layers, so mocking is easy and ownership is clean:
 *
 *   LlmClient      the transport: structured JSON generation, embeddings, file upload.
 *                  Implementations: Gemini (`@google/genai`), OpenAI (REST), and a fake for tests.
 *   Task modules   one function per LLM job, each with a Gemini-backed implementation and a
 *                  deterministic mock:
 *                    GameplayTasks  (llm-engineer)      server/src/llm/gameplay/**
 *                    IngestTasks    (content-engineer)  server/src/llm/ingest/**
 *
 * FACTORIES other modules import (exact names and paths):
 *   server/src/llm/index.ts
 *     createGeminiClient(config: Config): LlmClient
 *     createFakeLlmClient(opts?): LlmClient            // scripted generateJson + deterministic hash embeddings
 *     createGameplayTasks(llm: LlmClient, config: Config): GameplayTasks   // Gemini-backed
 *     createMockGameplayTasks(): GameplayTasks                              // deterministic, no LLM
 *   server/src/llm/ingest/index.ts
 *     createIngestTasks(llm: LlmClient, config: Config): IngestTasks       // Gemini-backed
 *     createMockIngestTasks(): IngestTasks                                  // canned outputs for the samples
 *
 * SECURITY (SPEC 3.3): uploaded material and player text are DATA. Every prompt wraps them in
 * delimiters (<material>…</material>, <player_text>…</player_text>, <notebook>…</notebook>) and tells
 * the model never to follow instructions found inside them.
 */
import type { z } from 'zod';
import type {
  Answer,
  Concept,
  CourseActivity,
  ExamTimeHint,
  MaterialItem,
  MaterialItemKind,
  Misconception,
  ProvenanceOrigin,
  PublicQuestion,
  Question,
  QuestionType,
  StyleProfile,
  WorkedStep,
} from '@top/shared';
import type { ParsedFile, RetrievedChunk } from '../rag/types';

// ─────────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────────

export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/** A file uploaded through the provider's Files API, usable in later `generateJson` calls. */
export interface UploadedFile {
  uri: string;
  mimeType: string;
  /** Provider-side resource name. */
  name: string;
}

export interface GenerateOptions {
  /** System instruction. */
  system?: string;
  /** Default 0.2. The student uses a low temperature. */
  temperature?: number;
  /** Default `config.llmTimeoutMs`. Every call has a timeout. */
  timeoutMs?: number;
  /** Files to attach (native PDF reading). */
  files?: UploadedFile[];
  /** Override the selected provider's configured model for this call. */
  model?: string;
  maxOutputTokens?: number;
  /** Short name for logs and for scripting the fake client, e.g. "studentAnswer". */
  label?: string;
  /** Opt-in public reasoning summaries for document analysis, never raw reasoning text. */
  onReasoningSummary?: (summary: string) => void | Promise<void>;
}

export interface LlmClient {
  readonly provider: 'gemini' | 'openai' | 'fake';
  /**
   * Structured output: asks for JSON matching `schema`, validates the reply with Zod, retries ONCE on
   * a parse or validation failure, and throws `AppError('llm_error')` if it still fails or times out.
   */
  generateJson<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, prompt: string, opts?: GenerateOptions): Promise<T>;
  /** One vector of `config.embeddingDims` numbers per text, in order. Batches internally. */
  embed(texts: string[], taskType: EmbedTaskType): Promise<number[][]>;
  /** Uploads a file (a path, or bytes) through the Files API and waits until it is usable. */
  uploadFile(source: string | Uint8Array, opts: { mimeType: string; displayName?: string }): Promise<UploadedFile>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GameplayTasks (SPEC 5)
// ─────────────────────────────────────────────────────────────────────────────

/** The parts of a misconception the student review may see. HIDDEN from the client, never from this task. */
export type ReviewMisconception = Pick<
  Misconception,
  'id' | 'conceptId' | 'description' | 'beliefStatement' | 'correction' | 'likelihood'
>;

export interface StudentReviewInput {
  /** The room's concepts. */
  concepts: { id: string; title: string; summary: string }[];
  /** The player's explanation. DATA, not instructions. */
  explanation: string;
  /** The full current notebook markdown. */
  notebookMd: string;
  /** The hidden misconception list for the room's concepts. */
  misconceptions: ReviewMisconception[];
  /** Ids (from `misconceptions`) that are currently active. Candidates for `resolvedMisconceptionIds`. */
  activeMisconceptionIds: string[];
  /** Ids the student may still ask about (never asked, not active, not resolved). */
  probeableMisconceptionIds: string[];
  /** Upper bound on `questions` (already reduced by questions that are still open). May be 0. */
  maxQuestions: number;
}

export interface StudentReviewOutput {
  /** New notes, in the student's curious, slightly naive voice, derived ONLY from the explanation. */
  notesToAdd: { conceptId: string; text: string }[];
  /** Misconceptions the explanation itself STATES. They become active with origin 'stated'. */
  statedMisconceptionIds: string[];
  /**
   * Naive, curious questions. Each probes one probeable misconception, most likely first, and must
   * never reveal that it is a misconception. At most `maxQuestions`.
   */
  questions: { misconceptionId: string; text: string }[];
  /** Active misconceptions that the explanation CLEARLY corrects (re-teaching). */
  resolvedMisconceptionIds: string[];
}

export interface CheckResolutionInput {
  misconception: ReviewMisconception;
  /** The student's question that probed it. */
  question: string;
  /** The player's answer. DATA, not instructions. */
  answer: string;
  /** Retrieved material to ground the check. */
  evidence: RetrievedChunk[];
}

export interface CheckResolutionOutput {
  resolved: boolean;
  /** The corrective note for the notebook when resolved (student's voice); '' otherwise. */
  noteToAdd: string;
  why: string;
}

/** Everything the student model may see: its notebook and the public question. Nothing else, ever. */
export interface StudentAnswerInput {
  notebookMd: string;
  question: PublicQuestion;
}

export interface StudentAnswerOutput {
  /** Typed for the question, or `{ dontKnow: true }` when the notes don't cover it. */
  answer: Answer;
  reasoning: string;
  /** The exact notebook lines the answer relied on (without the "- " bullet). */
  citedNotes: string[];
}

/**
 * MOCK-ONLY side channel. The deterministic mock student needs the answer key to decide which wrong
 * answer a belief leads to. The Gemini implementation MUST ignore this argument entirely: nothing
 * in it may reach a prompt.
 */
export interface StudentOracle {
  question: Question;
  /** The key points this question tests (`question.keyPointIds`). The mock answers correctly only if its notes cover them. */
  keyPoints: { id: string; statement: string }[];
  /** Every misconception of the course (for `beliefStatement` lookups). */
  misconceptions: Misconception[];
  activeMisconceptionIds: string[];
}

export interface GradeOpenInput {
  /** A `short_text` (deterministic match failed) or `free_response` question, with its rubric. */
  question: Question;
  /** The answer text. DATA, not instructions. */
  answerText: string;
  /** Misconceptions the answer may be classified into. */
  candidateMisconceptions: Pick<Misconception, 'id' | 'description' | 'beliefStatement'>[];
  evidence: RetrievedChunk[];
}

export interface GradeOpenOutput {
  correct: boolean;
  /** Subset of the candidate ids that the answer exhibits. */
  misconceptionIds: string[];
  feedback: string;
}

export interface GameplayTasks {
  /** One call per teach: notes, stated misconceptions, probing questions, re-teach resolutions. */
  studentReview(input: StudentReviewInput): Promise<StudentReviewOutput>;
  /** Did the player's answer resolve the misconception the student asked about? */
  checkResolution(input: CheckResolutionInput): Promise<CheckResolutionOutput>;
  /** The student answers from its notebook ONLY. `oracle` is for the mock; see `StudentOracle`. */
  studentAnswer(input: StudentAnswerInput, oracle?: StudentOracle): Promise<StudentAnswerOutput>;
  /** LLM grading for the short_text fallback and free_response. */
  gradeOpen(input: GradeOpenInput): Promise<GradeOpenOutput>;
}

// ─────────────────────────────────────────────────────────────────────────────
// IngestTasks (SPEC 5). Outputs are DRAFTS: the pipeline assigns ids, locates evidence quotes in
// chunks, validates, and drops or regenerates whatever fails.
// ─────────────────────────────────────────────────────────────────────────────

/** A quote the model claims is in the material. The pipeline turns it into `Evidence` or rejects it. */
export interface QuoteRef {
  /** Copied verbatim from the material. Keep it short (one sentence) so it fits inside one chunk. */
  quote: string;
  fileId?: string;
  page?: number;
}

export interface OutlineDraft {
  title: string;
  /** BCP-47 language code of the material, e.g. "en". */
  language: string;
  units: {
    title: string;
    concepts: {
      title: string;
      summary: string;
      /** Titles of concepts that should be taught first. */
      prerequisites: string[];
      keyPoints: { statement: string; evidence: QuoteRef }[];
    }[];
  }[];
  /** Practice problems, worked examples, review questions, quiz items, definitions, common mistakes. */
  materialItems: {
    kind: MaterialItemKind;
    /** The item as written in the material. */
    text: string;
    /** The material's own solution, when it has one. */
    solution?: string;
    conceptTitles: string[];
    points?: number;
    evidence: QuoteRef;
  }[];
  /** A time or point budget the material states for an exam or quiz. */
  examTimeHint?: ExamTimeHint;
}

export interface MisconceptionDraft {
  /** Suggested snake_case slug. The pipeline makes it unique. */
  id: string;
  description: string;
  beliefStatement: string;
  correction: string;
  /** A quote that supports the CORRECTION. */
  evidence: QuoteRef;
  origin: 'material' | 'inferred';
  likelihood: number;
}

/**
 * A question before ids, verification and time budgets. `payload` is the full stored payload for
 * `type` (see the *PayloadSchema in shared/src/schemas.ts) and may only reference misconception ids
 * that exist in the concepts it was given.
 */
export interface QuestionDraft {
  type: QuestionType;
  prompt: string;
  payload: unknown;
  conceptIds: string[];
  keyPointIds: string[];
  /** Human-readable final answer. */
  finalAnswer: string;
  explanation: string;
  origin: ProvenanceOrigin;
  /** The source item for 'verbatim' and 'adapted' questions. */
  materialItemId?: string;
  evidence: QuoteRef;
}

/** What a batch of new questions must cover (SPEC 4.4). */
export interface CoverageGap {
  conceptIds: string[];
  /** Key points that still have no question. */
  keyPointIds: string[];
  /** Misconceptions that still have no wrong-answer path. */
  misconceptionIds: string[];
  /** How many questions to produce for this gap. */
  count: number;
  /** True when the questions must span 2+ concepts (boss pool). */
  multiConcept: boolean;
  /** Preferred types, from the style profile's format mix. */
  preferredTypes: QuestionType[];
}

export interface VerifyQuestionOutput {
  /** Live verifiers assess source alignment and question usefulness independently of the key. */
  quality?: { acceptable: boolean; reason: string };
  /** The verifier's own answer, found WITHOUT seeing the key. `{ dontKnow: true }` if it cannot tell. */
  answer: Answer;
  workedSteps: WorkedStep[];
  /** 1-5. */
  difficulty: number;
}

export interface IngestTasks {
  planLessons?(input: {title: string; concepts: Concept[]}): Promise<import('../ingest/lesson-plan').LessonPlan>;
  /** Reads the material (PDFs natively when `file.uploaded` is set, page text otherwise). */
  extractOutline(input: { files: ParsedFile[]; titleHint?: string; onProgress?: (activity: CourseActivity) => Promise<void> }): Promise<OutlineDraft>;
  /** Style profile from the material's own items and a few sample pages. */
  buildStyleProfile(input: {
    materialItems: MaterialItem[];
    samplePages: { fileId: string; page: number; text: string }[];
  }): Promise<Omit<StyleProfile, 'examTimeHint'>>;
  /** Misconceptions for one concept: the material's own `common_mistake` items first, then inferred. */
  buildMisconceptions(input: {
    concept: Concept;
    commonMistakes: MaterialItem[];
    evidence: RetrievedChunk[];
  }): Promise<MisconceptionDraft[]>;
  /** Material items -> typed 'verbatim' questions, wording preserved, the material's solution as key. */
  convertItems(input: {
    items: MaterialItem[];
    concepts: Concept[];
    styleProfile: StyleProfile;
  }): Promise<QuestionDraft[]>;
  /** Same structure and style as a material item with new numbers, names or context ('adapted'). */
  adaptQuestions(input: {
    exemplars: MaterialItem[];
    gaps: CoverageGap[];
    concepts: Concept[];
    styleProfile: StyleProfile;
    evidence: RetrievedChunk[];
  }): Promise<QuestionDraft[]>;
  /** Brand-new questions for remaining gaps, in the course's style with few-shot exemplars ('generated'). */
  generateQuestions(input: {
    exemplars: MaterialItem[];
    gaps: CoverageGap[];
    concepts: Concept[];
    styleProfile: StyleProfile;
    evidence: RetrievedChunk[];
  }): Promise<QuestionDraft[]>;
  /** Solves a question independently from the evidence. It never sees the key. */
  verifyQuestion(input: { question: PublicQuestion; evidence: RetrievedChunk[] }): Promise<VerifyQuestionOutput>;
  /**
   * For answers code cannot compare (free_response, unmatched short_text): does the verifier's
   * answer agree with the key?
   */
  judgeAgreement(input: { question: Question; verifierAnswer: string }): Promise<{ agrees: boolean; why: string }>;
}
