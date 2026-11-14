/**
 * Pip's Notebook: every shared schema, as Zod. This file is the source of truth for data shapes.
 *
 * Layout:
 *   1. Primitives            (question types, grades, evidence)
 *   2. Course pack           (SPEC 4.1)
 *   3. Questions and answers (SPEC 2.9, 4.1)
 *   4. Run and results       (SPEC 4.2, 2.8)
 *   5. Public projections    (SPEC 4.3) and TurnResult (SPEC 6)
 *   6. API request/response bodies (SPEC 6)
 *   7. Fixtures              (samples/cache/*.json)
 *
 * HIDDEN vs PUBLIC: anything in sections 2-4 may contain answer keys or misconception data and must
 * never be sent to a client. Only the types in sections 5-6 cross the wire (plus /debug when DEBUG=true).
 */
import { z } from 'zod';

export const LlmProviderSchema = z.enum(['mock', 'gemini', 'openai']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;
const ApiModelNameSchema = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9._:/-]+$/);
const ProviderSettingsUpdateSchema = z.object({
  model: ApiModelNameSchema.optional(),
  embeddingModel: ApiModelNameSchema.optional(),
  /** Omitted = keep, null = remove. Keys are write-only. */
  apiKey: z.string().trim().min(1).max(8192).nullable().optional(),
}).strict();
export const UpdateApiSettingsBodySchema = z.object({
  provider: LlmProviderSchema,
  openai: ProviderSettingsUpdateSchema.optional(),
  gemini: ProviderSettingsUpdateSchema.optional(),
  timeoutMs: z.number().int().min(1000).max(180000).optional(),
  ingestTimeoutMs: z.number().int().min(1000).max(600000).optional(),
}).strict();
export type UpdateApiSettingsBody = z.infer<typeof UpdateApiSettingsBodySchema>;
const PublicProviderSettingsSchema = z.object({
  model: z.string(), embeddingModel: z.string(), hasApiKey: z.boolean(),
});
export const ApiSettingsSchema = z.object({
  provider: LlmProviderSchema,
  providers: z.object({ openai: PublicProviderSettingsSchema, gemini: PublicProviderSettingsSchema }),
  timeoutMs: z.number(), ingestTimeoutMs: z.number(), embeddingDims: z.number(), persistence: z.enum(['local', 'session']),
});
export type ApiSettings = z.infer<typeof ApiSettingsSchema>;
export const TestApiSettingsResponseSchema = z.object({ ok: z.boolean(), provider: LlmProviderSchema, message: z.string() });
export type TestApiSettingsResponse = z.infer<typeof TestApiSettingsResponseSchema>;
export const CourseEmbeddingSchema = z.object({ provider: LlmProviderSchema, model: z.string(), dims: z.number().int().positive() });
export type CourseEmbedding = z.infer<typeof CourseEmbeddingSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Primitives
// ─────────────────────────────────────────────────────────────────────────────

export const QUESTION_TYPES = [
  'mcq',
  'true_false',
  'multi_select',
  'numeric',
  'short_text',
  'ordering',
  'free_response',
] as const;
export const QuestionTypeSchema = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

/** Target grades a player can pick (SPEC 2.7). */
export const TARGET_GRADES = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'] as const;
export const TargetGradeSchema = z.enum(TARGET_GRADES);
export type TargetGrade = z.infer<typeof TargetGradeSchema>;

/** Letter a result can earn: any target grade, or F when below the D threshold. */
export const LETTER_GRADES = [...TARGET_GRADES, 'F'] as const;
export const LetterGradeSchema = z.enum(LETTER_GRADES);
export type LetterGrade = z.infer<typeof LetterGradeSchema>;

/** The student is never a human or face emoji (SPEC 8). */
export const STUDENT_EMOJIS = ['🤖', '🐙', '🦉', '🐸', '👾'] as const;
export const StudentEmojiSchema = z.enum(STUDENT_EMOJIS);
export const DEFAULT_STUDENT_EMOJI = '🤖';

/** 1 (easy) to 5 (hard). */
export const DifficultySchema = z.number().int().min(1).max(5);

/**
 * A pointer into the material. `quote` must exist verbatim (whitespace-normalized) in chunk `chunkId`.
 * `page` is 1-based; .txt/.md files are a single page 1 unless they contain form feeds.
 * `sectionPath` is copied from the chunk so results can link to "page/section" without loading chunks.
 */
export const EvidenceSchema = z.object({
  chunkId: z.string().min(1),
  fileId: z.string().min(1),
  page: z.number().int().min(1),
  quote: z.string().min(1),
  sectionPath: z.array(z.string()).optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Course pack (SPEC 4.1)
// ─────────────────────────────────────────────────────────────────────────────

export const FileTypeSchema = z.enum(['pdf', 'txt', 'md']);
export type FileType = z.infer<typeof FileTypeSchema>;

export const CourseFileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: FileTypeSchema,
  pages: z.number().int().min(0),
});
export type CourseFile = z.infer<typeof CourseFileSchema>;

export const INGEST_STAGES = ['parsing', 'outline', 'style', 'concepts', 'ready', 'error'] as const;
export const IngestStageSchema = z.enum(INGEST_STAGES);
export type IngestStage = z.infer<typeof IngestStageSchema>;

export const CourseActivitySchema = z.object({
  message: z.string().max(240),
  /** Latest public provider summary of document analysis; never raw reasoning or generated answer keys. */
  summary: z.string().max(1200).optional(),
  completed: z.number().int().nonnegative().optional(),
  total: z.number().int().positive().optional(),
});
export type CourseActivity = z.infer<typeof CourseActivitySchema>;

export const CourseStatusSchema = z.object({
  stage: IngestStageSchema,
  /** Concept ids whose misconceptions and verified questions are stored. A room is ready when all its concepts are. */
  conceptsReady: z.array(z.string()),
  error: z.string().optional(),
  activity: CourseActivitySchema.optional(),
});
export type CourseStatus = z.infer<typeof CourseStatusSchema>;

/** Observed share (0..1) of each question format in the material. All seven keys are always present. */
export const FormatMixSchema = z.object({
  mcq: z.number().min(0).default(0),
  true_false: z.number().min(0).default(0),
  multi_select: z.number().min(0).default(0),
  numeric: z.number().min(0).default(0),
  short_text: z.number().min(0).default(0),
  ordering: z.number().min(0).default(0),
  free_response: z.number().min(0).default(0),
});
export type FormatMix = z.infer<typeof FormatMixSchema>;

/** A time or point budget stated in the material, e.g. "50 minutes, 25 questions" (SPEC 2.10 step 3). */
export const ExamTimeHintSchema = z.object({
  totalMinutes: z.number().positive(),
  questionCount: z.number().int().positive().optional(),
  totalPoints: z.number().positive().optional(),
});
export type ExamTimeHint = z.infer<typeof ExamTimeHintSchema>;

export const StyleProfileSchema = z.object({
  voice: z.string(),
  notation: z.string(),
  codeLanguage: z.string().optional(),
  units: z.string().optional(),
  formatMix: FormatMixSchema,
  typicalScenarios: z.array(z.string()),
  avgSolutionSteps: z.number().min(0),
  difficultyBand: z.object({ min: DifficultySchema, max: DifficultySchema }),
  /** Material items used as few-shot exemplars when adapting or generating questions. */
  exemplarItemIds: z.array(z.string()),
  examTimeHint: ExamTimeHintSchema.optional(),
});
export type StyleProfile = z.infer<typeof StyleProfileSchema>;

export const UnitSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  order: z.number().int(),
  conceptIds: z.array(z.string()),
});
export type Unit = z.infer<typeof UnitSchema>;

export const KeyPointSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  evidence: EvidenceSchema,
});
export type KeyPoint = z.infer<typeof KeyPointSchema>;

export const MisconceptionSchema = z.object({
  /** snake_case slug, unique within the course, e.g. "distance_causes_seasons". */
  id: z.string().min(1),
  conceptId: z.string().min(1),
  /** What the misconception is, for the results screen. */
  description: z.string().min(1),
  /** A novice's note in the student's voice, e.g. "We're closer to the Sun in summer." */
  beliefStatement: z.string().min(1),
  /** The corrective note, also in the student's voice. */
  correction: z.string().min(1),
  /** A quote that supports the CORRECTION (misconceptions themselves usually aren't in the material). */
  evidence: EvidenceSchema,
  /** 'material' = the course itself warns about it (preferred). */
  origin: z.enum(['material', 'inferred']),
  /** 1 (rare) to 3 (very common). */
  likelihood: z.number().int().min(1).max(3),
});
export type Misconception = z.infer<typeof MisconceptionSchema>;

export const ConceptSchema = z.object({
  id: z.string().min(1),
  unitId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  order: z.number().int(),
  /** Concept ids that should be taught first. */
  prerequisites: z.array(z.string()),
  keyPoints: z.array(KeyPointSchema),
  misconceptions: z.array(MisconceptionSchema),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const RoomSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  order: z.number().int(),
  /** Usually one concept; tiny neighbours are merged, huge ones split. */
  conceptIds: z.array(z.string()).min(1),
  description: z.string().optional(),
  learningObjectives: z.array(z.string()).optional(),
});
export type Room = z.infer<typeof RoomSchema>;

export const MATERIAL_ITEM_KINDS = [
  'practice_problem',
  'worked_example',
  'review_question',
  'quiz_item',
  'definition',
  'common_mistake',
] as const;
export const MaterialItemKindSchema = z.enum(MATERIAL_ITEM_KINDS);
export type MaterialItemKind = z.infer<typeof MaterialItemKindSchema>;

export const MaterialItemSchema = z.object({
  id: z.string().min(1),
  kind: MaterialItemKindSchema,
  text: z.string().min(1),
  solution: z.string().optional(),
  conceptIds: z.array(z.string()),
  /** Points the material assigns to this item, e.g. "(10 pts)". Feeds the time budget hint. */
  points: z.number().positive().optional(),
  evidence: EvidenceSchema,
});
export type MaterialItem = z.infer<typeof MaterialItemSchema>;

/**
 * The course pack. Chunks (with embeddings) and questions are stored separately.
 * During progressive ingest the pack is saved early with empty arrays and filled in stage by stage.
 */
export const CoursePackSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  language: z.string(),
  files: z.array(CourseFileSchema),
  status: CourseStatusSchema,
  styleProfile: StyleProfileSchema,
  units: z.array(UnitSchema),
  concepts: z.array(ConceptSchema),
  rooms: z.array(RoomSchema),
  materialItems: z.array(MaterialItemSchema),
  /** Server-only retrieval profile; provider changes must not mix vector spaces. */
  embeddingProfile: CourseEmbeddingSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CoursePack = z.infer<typeof CoursePackSchema>;

export const ChunkSchema = z.object({
  /** Globally unique (two courses never share a chunk id): `${courseId}_${fileId}_p${page}_${n}` */
  id: z.string().min(1),
  courseId: z.string().min(1),
  fileId: z.string().min(1),
  page: z.number().int().min(1),
  /** Heading trail, outermost first, e.g. ["Unit 1", "Axial tilt"]. Empty when unknown. */
  sectionPath: z.array(z.string()),
  conceptIds: z.array(z.string()),
  text: z.string(),
  embedding: z.array(z.number()),
});
export type Chunk = z.infer<typeof ChunkSchema>;

export function emptyStyleProfile(): StyleProfile {
  return {
    voice: '',
    notation: '',
    formatMix: { mcq: 0, true_false: 0, multi_select: 0, numeric: 0, short_text: 0, ordering: 0, free_response: 0 },
    typicalScenarios: [],
    avgSolutionSteps: 0,
    difficultyBand: { min: 1, max: 5 },
    exemplarItemIds: [],
  };
}

/** The pack saved by `POST /courses` before ingest has produced anything. */
export function emptyCoursePack(id: string, title: string, nowIso: string): CoursePack {
  return {
    id,
    title,
    language: 'en',
    files: [],
    status: { stage: 'parsing', conceptsReady: [] },
    styleProfile: emptyStyleProfile(),
    units: [],
    concepts: [],
    rooms: [],
    materialItems: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Questions and answers (SPEC 2.9, 4.1)
// ─────────────────────────────────────────────────────────────────────────────

const isPermutation = (order: number[], n: number): boolean =>
  order.length === n && new Set(order).size === n && order.every((i) => Number.isInteger(i) && i >= 0 && i < n);

/** `misconceptionId` is the misconception a student holding it would pick this option for; null on the correct option. */
export const ChoiceOptionSchema = z.object({
  text: z.string().min(1),
  misconceptionId: z.string().nullable(),
});
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;

export const McqPayloadSchema = z
  .object({
    /** Option count follows the material (usually 4). Stored in display order. */
    options: z.array(ChoiceOptionSchema).min(2),
    correctIndex: z.number().int().min(0),
  })
  .superRefine((p, ctx) => {
    if (p.correctIndex >= p.options.length) {
      ctx.addIssue({ code: 'custom', message: 'mcq: correctIndex out of range' });
    } else if (p.options[p.correctIndex].misconceptionId !== null) {
      ctx.addIssue({ code: 'custom', message: 'mcq: the correct option cannot map to a misconception' });
    }
  });
export type McqPayload = z.infer<typeof McqPayloadSchema>;

export const TrueFalsePayloadSchema = z.object({
  /** The claim being judged. `prompt` is the lead-in (e.g. "True or false?"); clients show both. */
  statement: z.string().min(1),
  correctValue: z.boolean(),
  /** The misconception that makes a student give the wrong value, if any. */
  wrongMisconceptionId: z.string().nullable(),
});
export type TrueFalsePayload = z.infer<typeof TrueFalsePayloadSchema>;

export const MultiSelectPayloadSchema = z
  .object({
    options: z.array(ChoiceOptionSchema).min(2),
    correctIndexes: z.array(z.number().int().min(0)).min(1),
  })
  .superRefine((p, ctx) => {
    if (new Set(p.correctIndexes).size !== p.correctIndexes.length) {
      ctx.addIssue({ code: 'custom', message: 'multi_select: duplicate correctIndexes' });
    }
    if (p.correctIndexes.some((i) => i >= p.options.length)) {
      ctx.addIssue({ code: 'custom', message: 'multi_select: correctIndexes out of range' });
    } else if (p.correctIndexes.some((i) => p.options[i].misconceptionId !== null)) {
      ctx.addIssue({ code: 'custom', message: 'multi_select: a correct option cannot map to a misconception' });
    }
  });
export type MultiSelectPayload = z.infer<typeof MultiSelectPayloadSchema>;

export const NumericPayloadSchema = z.object({
  answer: z.number().finite(),
  /** abs: |x - answer| <= value.  rel: |x - answer| <= value * |answer|. */
  tolerance: z.object({ kind: z.enum(['abs', 'rel']), value: z.number().min(0) }),
  unit: z.string().nullable(),
  /** Known wrong results. `tolerance` is absolute. */
  wrongAnswers: z.array(
    z.object({ value: z.number().finite(), tolerance: z.number().min(0), misconceptionId: z.string().min(1) }),
  ),
});
export type NumericPayload = z.infer<typeof NumericPayloadSchema>;

export const ShortTextPayloadSchema = z.object({
  /** Compared after normalization (case, whitespace, wrapping quotes). */
  acceptedAnswers: z.array(z.string().min(1)).min(1),
  /** Used by the LLM fallback when no accepted answer or wrong pattern matches. */
  rubric: z.string(),
  /** `pattern` is a plain substring (NOT a regex), matched after normalization. */
  wrongAnswers: z.array(z.object({ pattern: z.string().min(1), misconceptionId: z.string().min(1) })),
});
export type ShortTextPayload = z.infer<typeof ShortTextPayloadSchema>;

export const OrderingPayloadSchema = z
  .object({
    /** Items in DISPLAY order. Ingest must store them shuffled so the display order isn't the answer. */
    items: z.array(z.string().min(1)).min(2),
    /** Indexes into `items`, listed in the correct sequence. */
    correctOrder: z.array(z.number().int().min(0)),
    wrongOrders: z.array(z.object({ order: z.array(z.number().int().min(0)), misconceptionId: z.string().min(1) })),
  })
  .superRefine((p, ctx) => {
    if (!isPermutation(p.correctOrder, p.items.length)) {
      ctx.addIssue({ code: 'custom', message: 'ordering: correctOrder must be a permutation of the item indexes' });
    }
    if (p.wrongOrders.some((w) => !isPermutation(w.order, p.items.length))) {
      ctx.addIssue({ code: 'custom', message: 'ordering: every wrongOrders.order must be a permutation' });
    }
  });
export type OrderingPayload = z.infer<typeof OrderingPayloadSchema>;

export const FreeResponsePayloadSchema = z.object({
  rubric: z.string().min(1),
  modelAnswer: z.string().optional(),
});
export type FreeResponsePayload = z.infer<typeof FreeResponsePayloadSchema>;

export const WORKED_STEP_KINDS = ['recall', 'reason', 'compute', 'write'] as const;
export const WorkedStepSchema = z.object({
  text: z.string(),
  kind: z.enum(WORKED_STEP_KINDS),
});
export type WorkedStep = z.infer<typeof WorkedStepSchema>;

export const SolutionSchema = z.object({
  /** Human-readable final answer, e.g. "B) 23.5 degrees". */
  finalAnswer: z.string(),
  /** From verification. HIDDEN: feeds the time budget only. */
  workedSteps: z.array(WorkedStepSchema),
});
export type Solution = z.infer<typeof SolutionSchema>;

export const PROVENANCE_ORIGINS = ['verbatim', 'adapted', 'generated'] as const;
export const ProvenanceSchema = z.object({
  origin: z.enum(PROVENANCE_ORIGINS),
  materialItemId: z.string().optional(),
  evidence: EvidenceSchema,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ProvenanceOrigin = Provenance['origin'];

const questionBase = {
  id: z.string().min(1),
  courseId: z.string().min(1),
  /** Two or more ids make this a multi-concept question (preferred by the boss). */
  conceptIds: z.array(z.string()).min(1),
  keyPointIds: z.array(z.string()),
  /** Every misconception id that some wrong-answer path of this question maps to. */
  misconceptionIds: z.array(z.string()),
  prompt: z.string().min(1),
  solution: SolutionSchema,
  /** Shown to the player only after the question has been answered. */
  explanation: z.string(),
  difficulty: DifficultySchema,
  timeBudgetSec: z.number().int().positive(),
  provenance: ProvenanceSchema,
  /** Only verified questions are ever served. */
  verified: z.boolean(),
};

export const QuestionSchema = z.discriminatedUnion('type', [
  z.object({ ...questionBase, type: z.literal('mcq'), payload: McqPayloadSchema }),
  z.object({ ...questionBase, type: z.literal('true_false'), payload: TrueFalsePayloadSchema }),
  z.object({ ...questionBase, type: z.literal('multi_select'), payload: MultiSelectPayloadSchema }),
  z.object({ ...questionBase, type: z.literal('numeric'), payload: NumericPayloadSchema }),
  z.object({ ...questionBase, type: z.literal('short_text'), payload: ShortTextPayloadSchema }),
  z.object({ ...questionBase, type: z.literal('ordering'), payload: OrderingPayloadSchema }),
  z.object({ ...questionBase, type: z.literal('free_response'), payload: FreeResponsePayloadSchema }),
]);
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionOfType<T extends QuestionType> = Extract<Question, { type: T }>;

export const QuestionStatsSchema = z.object({
  questionId: z.string().min(1),
  /** Solve times of CORRECT "Help me!" answers. 5 or more recalibrate the time budget (SPEC 2.10 step 4). */
  helpMeSolveTimesSec: z.array(z.number().min(0)),
  studentCorrect: z.number().int().min(0),
  studentWrong: z.number().int().min(0),
});
export type QuestionStats = z.infer<typeof QuestionStatsSchema>;

/**
 * An answer, from the student (LLM) or from the player ("Help me!"). Flat on purpose: set the one
 * field that fits the question type and leave the rest out.
 *
 *   mcq           -> { choiceIndex }
 *   true_false    -> { value: boolean }
 *   multi_select  -> { choiceIndexes }
 *   numeric       -> { value: number }
 *   short_text    -> { text }
 *   free_response -> { text }
 *   ordering      -> { order }       item indexes in the chosen sequence
 *   (student only) -> { dontKnow: true }   "I don't know"
 */
export const AnswerSchema = z.object({
  choiceIndex: z.number().int().min(0).optional(),
  choiceIndexes: z.array(z.number().int().min(0)).optional(),
  value: z.union([z.number().finite(), z.boolean()]).optional(),
  text: z.string().max(4000).optional(),
  order: z.array(z.number().int().min(0)).optional(),
  dontKnow: z.boolean().optional(),
});
export type Answer = z.infer<typeof AnswerSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 5a. Public question projection (defined here because TurnResult and Run logs use it)
// ─────────────────────────────────────────────────────────────────────────────

const publicQuestionBase = {
  id: z.string(),
  prompt: z.string(),
  difficulty: DifficultySchema,
  timeBudgetSec: z.number().int().positive(),
};

/** What a client may see of a question BEFORE it is answered: no keys, no mappings, no solution. */
export const PublicQuestionSchema = z.discriminatedUnion('type', [
  z.object({ ...publicQuestionBase, type: z.literal('mcq'), payload: z.object({ options: z.array(z.string()) }) }),
  z.object({ ...publicQuestionBase, type: z.literal('true_false'), payload: z.object({ statement: z.string() }) }),
  z.object({ ...publicQuestionBase, type: z.literal('multi_select'), payload: z.object({ options: z.array(z.string()) }) }),
  z.object({ ...publicQuestionBase, type: z.literal('numeric'), payload: z.object({ unit: z.string().nullable() }) }),
  z.object({ ...publicQuestionBase, type: z.literal('short_text'), payload: z.object({}) }),
  z.object({ ...publicQuestionBase, type: z.literal('ordering'), payload: z.object({ items: z.array(z.string()) }) }),
  z.object({ ...publicQuestionBase, type: z.literal('free_response'), payload: z.object({}) }),
]);
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;

/** The correct answer, revealed only after a question has been answered. */
export const RevealedAnswerSchema = z.object({
  answer: AnswerSchema,
  /** Display form, e.g. the option text or "23.5 degrees". */
  text: z.string(),
});
export type RevealedAnswer = z.infer<typeof RevealedAnswerSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 4. Run and results (SPEC 4.2, 2.8)
// ─────────────────────────────────────────────────────────────────────────────

export const RUN_PHASES = ['learning', 'room', 'room_result', 'boss', 'results'] as const;
export const RunPhaseSchema = z.enum(RUN_PHASES);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

/** HIDDEN. Never sent to the client except through /debug. */
export const MisconceptionStateSchema = z.object({
  id: z.string().min(1),
  conceptId: z.string().min(1),
  status: z.enum(['active', 'resolved']),
  /** 'stated' = the player's explanation said it. 'skipped' = the player skipped or failed the student's question. */
  origin: z.enum(['stated', 'skipped']),
});
export type MisconceptionState = z.infer<typeof MisconceptionStateSchema>;

export const StudentQuestionStatusSchema = z.enum(['open', 'answered', 'skipped']);

/** A learning-phase question from the student. `misconceptionId` is HIDDEN. */
export const StudentQuestionSchema = z.object({
  id: z.string().min(1),
  misconceptionId: z.string().min(1),
  text: z.string().min(1),
  status: StudentQuestionStatusSchema,
});
export type StudentQuestion = z.infer<typeof StudentQuestionSchema>;

export const MaterialRefSchema = z.object({
  fileId: z.string(),
  fileName: z.string(),
  page: z.number().int().min(1),
  sectionPath: z.array(z.string()),
  quote: z.string(),
});
export type MaterialRef = z.infer<typeof MaterialRefSchema>;

/** An active misconception whose targeted boss question was answered wrong. The player's study guide. */
export const CostlyMisconceptionSchema = z.object({
  id: z.string(),
  conceptId: z.string(),
  conceptTitle: z.string(),
  description: z.string(),
  beliefStatement: z.string(),
  correction: z.string(),
  /** How it got into the notebook. */
  origin: z.enum(['stated', 'skipped']),
  /** The boss question it cost. */
  questionId: z.string(),
  questionPrompt: z.string(),
  /** Where the material covers the correction. */
  materialRef: MaterialRefSchema,
});
export type CostlyMisconception = z.infer<typeof CostlyMisconceptionSchema>;

export const HelpMeStatsSchema = z.object({
  offered: z.number().int().min(0),
  correct: z.number().int().min(0),
  wrong: z.number().int().min(0),
  /** Answers that arrived after the deadline (also counted as damage, not in `wrong`). */
  late: z.number().int().min(0),
  avgSolveTimeSec: z.number().nullable(),
});
export type HelpMeStats = z.infer<typeof HelpMeStatsSchema>;

export const ResultsSchema = z.object({
  /** Final boss health, rounded to an integer 0..100. */
  predictedGradePct: z.number().int().min(0).max(100),
  letter: LetterGradeSchema,
  target: TargetGradeSchema,
  metTarget: z.boolean(),
  /** From the boss fight. */
  conceptAccuracy: z.array(
    z.object({
      conceptId: z.string(),
      title: z.string(),
      correct: z.number().int().min(0),
      total: z.number().int().min(0),
      /** correct / total, 0 when total is 0. */
      accuracy: z.number().min(0).max(1),
    }),
  ),
  /** Across the whole run (rooms and boss). */
  helpMe: HelpMeStatsSchema,
  costlyMisconceptions: z.array(CostlyMisconceptionSchema),
});
export type Results = z.infer<typeof ResultsSchema>;

// ── TurnResult (SPEC 6). Everything in here is public. ──────────────────────

export const TURN_REASONS = ['not in my notes', 'wrong belief', 'unknown'] as const;

const damageFields = {
  /** Hearts lost (room: 0 or 1) or health lost (boss: 0 or 100 / questionCount). */
  damage: z.number().min(0),
  /** Room fights only: hearts left after this turn. */
  hearts: z.number().int().min(0).optional(),
  /** Boss only: health left after this turn (not rounded). */
  health: z.number().min(0).max(100).optional(),
  /** The run phase after this turn. 'room_result' or 'results' means the fight just ended. */
  phaseAfter: RunPhaseSchema,
};

export const StudentAnswerTurnSchema = z.object({
  kind: z.literal('student_answer'),
  question: PublicQuestionSchema,
  answer: AnswerSchema,
  /** Display form of the student's answer, e.g. the option text or "I don't know". */
  answerText: z.string(),
  correct: z.boolean(),
  correctAnswer: RevealedAnswerSchema,
  explanation: z.string(),
  reasoning: z.string(),
  citedNotes: z.array(z.string()),
  /**
   * Why a wrong answer was wrong (absent when correct):
   *   'not in my notes' = "I don't know", or right answer without a valid notebook citation
   *   'wrong belief'    = the answer followed a wrong-answer path mapped to a misconception
   *   'unknown'         = any other wrong answer
   */
  reason: z.enum(TURN_REASONS).optional(),
  ...damageFields,
});

export const HelpMeTurnSchema = z.object({
  kind: z.literal('help_me'),
  eventId: z.string(),
  question: PublicQuestionSchema,
  /** Seconds the player gets (already multiplied by HELP_ME_TIME_MULTIPLIER). Show it before they start. */
  timeBudgetSec: z.number().int().positive(),
  /** ISO timestamp, or null in untimed mode (HELP_ME_TIMED=false): show no countdown. */
  deadline: z.string().nullable(),
});

export const HelpResultTurnSchema = z.object({
  kind: z.literal('help_result'),
  eventId: z.string(),
  question: PublicQuestionSchema,
  correct: z.boolean(),
  /** True when the answer arrived after the deadline (counts as wrong). */
  late: z.boolean(),
  correctAnswer: RevealedAnswerSchema,
  explanation: z.string(),
  solveTimeSec: z.number().min(0),
  /** The "Teacher showed me: ..." note written to the notebook on a correct answer. */
  noteAdded: z.string().optional(),
  ...damageFields,
});

export const FailedTurnSchema = z.object({
  question: PublicQuestionSchema,
  reasoning: z.string(),
  citedNotes: z.array(z.string()),
});

export const RoomEndTurnSchema = z.object({
  kind: z.literal('room_end'),
  passed: z.boolean(),
  hearts: z.number().int().min(0),
  /** The reasoning trace: every wrong student answer of this attempt. */
  failedTurns: z.array(FailedTurnSchema),
});

export const BossEndTurnSchema = z.object({
  kind: z.literal('boss_end'),
  results: ResultsSchema,
});

export const TurnResultSchema = z.discriminatedUnion('kind', [
  StudentAnswerTurnSchema,
  HelpMeTurnSchema,
  HelpResultTurnSchema,
  RoomEndTurnSchema,
  BossEndTurnSchema,
]);
export type TurnResult = z.infer<typeof TurnResultSchema>;
export type StudentAnswerTurn = z.infer<typeof StudentAnswerTurnSchema>;
export type HelpMeTurn = z.infer<typeof HelpMeTurnSchema>;
export type HelpResultTurn = z.infer<typeof HelpResultTurnSchema>;
export type RoomEndTurn = z.infer<typeof RoomEndTurnSchema>;
export type BossEndTurn = z.infer<typeof BossEndTurnSchema>;
export type FailedTurn = z.infer<typeof FailedTurnSchema>;

// ── Run (HIDDEN: server-side state) ─────────────────────────────────────────

export const RoomStateSchema = z.object({
  /** 1 on the first attempt of the current room. */
  attempt: z.number().int().min(1),
  /** This attempt's draw, in order. */
  questionIds: z.array(z.string()),
  /** Every question drawn in ANY attempt of this room, so retries prefer fresh ones. */
  seenQuestionIds: z.array(z.string()),
  /** Index of the next question to play. */
  turn: z.number().int().min(0),
  hearts: z.number().int().min(0),
  helpMeUsed: z.number().int().min(0),
  /** student_answer / help_me / help_result entries of this attempt. */
  log: z.array(TurnResultSchema),
  /** Set when the fight ends. */
  passed: z.boolean().optional(),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

export const BossStateSchema = z.object({
  questionIds: z.array(z.string()),
  /** questionId -> the active misconception it was picked to target. */
  targetedMap: z.record(z.string(), z.string()),
  turn: z.number().int().min(0),
  /** 100 at the start; each wrong answer costs 100 / questionIds.length. Not rounded until results. */
  health: z.number().min(0).max(100),
  helpMeUsed: z.number().int().min(0),
  log: z.array(TurnResultSchema),
});
export type BossState = z.infer<typeof BossStateSchema>;

export const PendingHelpMeSchema = z.object({
  eventId: z.string(),
  questionId: z.string(),
  /** ISO timestamp. */
  startedAt: z.string(),
  timeBudgetSec: z.number().int().positive(),
  /** ISO timestamp, or null in untimed mode. */
  deadline: z.string().nullable(),
});
export type PendingHelpMe = z.infer<typeof PendingHelpMeSchema>;

export const RunHelpMeTallySchema = z.object({
  offered: z.number().int().min(0),
  correct: z.number().int().min(0),
  wrong: z.number().int().min(0),
  late: z.number().int().min(0),
  /** Solve times of every answered event, for the average. */
  solveTimesSec: z.array(z.number().min(0)),
});

/** One finished room attempt, kept for the between-room report. Every field restates turns the player already saw. */
export const RoomAttemptRecordSchema = z.object({
  roomId: z.string(),
  roomIndex: z.number().int().min(0),
  attempt: z.number().int().min(1),
  passed: z.boolean(),
  hearts: z.number().int().min(0),
  maxHearts: z.number().int().min(1),
  turns: z.array(
    z.object({
      questionId: z.string(),
      prompt: z.string(),
      conceptIds: z.array(z.string()),
      correct: z.boolean(),
      /** 'help' = the player answered a "Help me!" event. */
      by: z.enum(['student', 'help']),
    }),
  ),
  teachCount: z.number().int().min(0),
  questionsAsked: z.number().int().min(0),
  questionsAnswered: z.number().int().min(0),
  questionsSkipped: z.number().int().min(0),
});
export type RoomAttemptRecord = z.infer<typeof RoomAttemptRecordSchema>;

export const RunSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().min(1),
  targetGrade: TargetGradeSchema,
  studentEmoji: z.string(),
  /** Room ids in play order. */
  scope: z.object({ roomIds: z.array(z.string()).min(1) }),
  phase: RunPhaseSchema,
  /** Index into scope.roomIds of the current room. Equals scope.roomIds.length during boss and results. */
  roomIndex: z.number().int().min(0),
  /** The student's notebook: "# Notebook" then one "## <Concept title>" section per concept with "- " bullets. */
  notebookMd: z.string(),
  hidden: z.object({ misconceptions: z.array(MisconceptionStateSchema) }),
  learning: z.object({
    pendingQuestions: z.array(StudentQuestionSchema),
    /** How many times the player has taught in the current learning phase. */
    teachCount: z.number().int().min(0),
  }),
  room: RoomStateSchema.optional(),
  boss: BossStateSchema.optional(),
  pendingHelpMe: PendingHelpMeSchema.optional(),
  helpMeTally: RunHelpMeTallySchema,
  /** Finished room attempts in play order. Optional so runs saved before it existed still load. */
  history: z.array(RoomAttemptRecordSchema).optional(),
  results: ResultsSchema.optional(),
  rngSeed: z.number().int(),
  /** Current state of the seedable RNG; advanced by the service after every engine call. */
  rngState: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  pausedAt: z.string().optional(),
  /** Set when the player ends the expedition early: kept as a record, never resumed or played again. */
  endedAt: z.string().optional(),
});
export type Run = z.infer<typeof RunSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 5b. Public projections (SPEC 4.3)
// ─────────────────────────────────────────────────────────────────────────────

/** A learning-phase question as the client sees it: no misconception id. */
export const PublicStudentQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: StudentQuestionStatusSchema,
  /** The concept Pip is asking about, so a per-concept lesson can show it in the right place. */
  conceptId: z.string().optional(),
});
export type PublicStudentQuestion = z.infer<typeof PublicStudentQuestionSchema>;

export const ConceptRefSchema = z.object({ id: z.string(), title: z.string(), summary: z.string().optional() });

export const PublicRunRoomSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  learningObjectives: z.array(z.string()).optional(),
  concepts: z.array(ConceptRefSchema),
  /** False while the room's concepts are still being ingested. */
  ready: z.boolean(),
  state: z.enum(['upcoming', 'current', 'passed']),
});
export type PublicRunRoom = z.infer<typeof PublicRunRoomSchema>;

/** A finished room attempt as the player may see it: only turns and learning counts they already saw. */
export const PublicRoomReportSchema = z.object({
  roomId: z.string(),
  title: z.string(),
  attempt: z.number().int().min(1),
  passed: z.boolean(),
  hearts: z.number().int().min(0),
  maxHearts: z.number().int().min(1),
  correct: z.number().int().min(0),
  total: z.number().int().min(0),
  /** Turns the player answered through "Help me!". */
  helped: z.number().int().min(0),
  teachCount: z.number().int().min(0),
  questionsAsked: z.number().int().min(0),
  questionsAnswered: z.number().int().min(0),
  questionsSkipped: z.number().int().min(0),
  missed: z.array(
    z.object({
      prompt: z.string(),
      by: z.enum(['student', 'help']),
      concepts: z.array(z.object({ id: z.string(), title: z.string() })),
    }),
  ),
});
export type PublicRoomReport = z.infer<typeof PublicRoomReportSchema>;

export const PublicRunSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  courseTitle: z.string(),
  targetGrade: TargetGradeSchema,
  studentEmoji: z.string(),
  phase: RunPhaseSchema,
  roomIndex: z.number().int().min(0),
  /** The rooms in scope, in play order. */
  rooms: z.array(PublicRunRoomSchema),
  /** Convenience copy of rooms[roomIndex]; null during boss and results. */
  currentRoom: PublicRunRoomSchema.nullable(),
  notebookMd: z.string(),
  learning: z.object({
    pendingQuestions: z.array(PublicStudentQuestionSchema),
    teachCount: z.number().int().min(0),
  }),
  /** Present from the first /ready of a room until the run leaves that room. */
  room: z
    .object({
      attempt: z.number().int().min(1),
      turn: z.number().int().min(0),
      totalTurns: z.number().int().min(0),
      hearts: z.number().int().min(0),
      maxHearts: z.number().int().min(1),
      helpMeUsed: z.number().int().min(0),
      log: z.array(TurnResultSchema),
      passed: z.boolean().optional(),
      /** The question the next /turn asks (public form only), so the client can present it before Pip answers. */
      nextQuestion: PublicQuestionSchema.optional(),
    })
    .optional(),
  boss: z
    .object({
      turn: z.number().int().min(0),
      totalTurns: z.number().int().min(0),
      health: z.number().min(0).max(100),
      helpMeUsed: z.number().int().min(0),
      log: z.array(TurnResultSchema),
      /** The question the next /turn asks (public form only). */
      nextQuestion: PublicQuestionSchema.optional(),
    })
    .optional(),
  /** A "Help me!" event waiting for POST /help/:eventId. Same shape as the help_me TurnResult. */
  pendingHelpMe: HelpMeTurnSchema.optional(),
  results: ResultsSchema.optional(),
  /** Finished room attempts, oldest first. Absent until the first room fight ends. */
  history: z.array(PublicRoomReportSchema).optional(),
  /** The gameplay settings a client needs to draw the UI. */
  rules: z.object({
    roomQuestions: z.number().int(),
    roomHearts: z.number().int(),
    bossQuestions: z.number().int(),
    maxStudentQuestions: z.number().int(),
    helpMeTimed: z.boolean(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  pausedAt: z.string().optional(),
  /** The player ended this expedition early; it is a read-only record. */
  endedAt: z.string().optional(),
});
export type PublicRun = z.infer<typeof PublicRunSchema>;

/** GET /courses/:id. Public fields only: no key points, misconceptions, material items or questions. */
export const PublicCourseSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: CourseStatusSchema,
  files: z.array(CourseFileSchema),
  units: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      concepts: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string().optional(), ready: z.boolean() })),
    }),
  ),
  rooms: z.array(
    z.object({ id: z.string(), title: z.string(), description: z.string().optional(), learningObjectives: z.array(z.string()).optional(), conceptIds: z.array(z.string()), ready: z.boolean() }),
  ),
  styleSummary: z.object({
    voice: z.string(),
    notation: z.string(),
    codeLanguage: z.string().optional(),
    units: z.string().optional(),
    /** Question formats the material uses most, most common first. */
    topFormats: z.array(QuestionTypeSchema),
  }),
});
export type PublicCourse = z.infer<typeof PublicCourseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 6. API request / response bodies (SPEC 6)
// ─────────────────────────────────────────────────────────────────────────────

export const CreateCourseTextBodySchema = z.object({
  text: z.string().min(1),
  title: z.string().max(200).optional(),
});
export type CreateCourseTextBody = z.infer<typeof CreateCourseTextBodySchema>;

export const CreateCourseResponseSchema = z.object({ courseId: z.string() });
export type CreateCourseResponse = z.infer<typeof CreateCourseResponseSchema>;

export const SamplesResponseSchema = z.object({
  samples: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type SamplesResponse = z.infer<typeof SamplesResponseSchema>;

export const CreateRunBodySchema = z.object({
  courseId: z.string().min(1),
  targetGrade: TargetGradeSchema,
  studentEmoji: StudentEmojiSchema.optional(),
  scope: z.object({ roomIds: z.array(z.string().min(1)).min(1) }).optional(),
});
export type CreateRunBody = z.infer<typeof CreateRunBodySchema>;

export const TeachBodySchema = z.object({
  explanation: z.string().trim().min(1).max(8000),
  /** Teach one concept of the current room; Pip then only takes notes and asks questions about it. */
  conceptId: z.string().min(1).max(200).optional(),
});
export type TeachBody = z.infer<typeof TeachBodySchema>;

export const TeachResponseSchema = z.object({
  feedback: z.string().max(600).optional(),
  notebookMd: z.string(),
  /** Every question of the current learning phase (open, answered and skipped). */
  questions: z.array(PublicStudentQuestionSchema),
});
export type TeachResponse = z.infer<typeof TeachResponseSchema>;

export const AnswerQuestionBodySchema = z.object({ answer: z.string().trim().min(1).max(4000) });
export type AnswerQuestionBody = z.infer<typeof AnswerQuestionBodySchema>;

export const AnswerQuestionResponseSchema = z.object({ resolved: z.boolean(), notebookMd: z.string() });
export type AnswerQuestionResponse = z.infer<typeof AnswerQuestionResponseSchema>;

export const SkipQuestionResponseSchema = z.object({ notebookMd: z.string() });
export type SkipQuestionResponse = z.infer<typeof SkipQuestionResponseSchema>;

export const HelpBodySchema = z.object({ answer: AnswerSchema });
export type HelpBody = z.infer<typeof HelpBodySchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Per-question time budget breakdown, shown in the debug overlay (SPEC 2.10). */
export const TimeBudgetBreakdownSchema = z.object({
  source: z.enum(['formula', 'material_hint', 'calibrated']),
  base: z.number(),
  words: z.number(),
  wordSec: z.number(),
  stepSec: z.number(),
  raw: z.number(),
  difficultyFactor: z.number(),
  timeBudgetSec: z.number(),
});
export type TimeBudgetBreakdown = z.infer<typeof TimeBudgetBreakdownSchema>;

/** GET /runs/:id/debug. Everything, hidden fields included. Only when DEBUG=true. */
export const DebugResponseSchema = z.object({
  run: RunSchema,
  pack: CoursePackSchema,
  questions: z.array(QuestionSchema),
  stats: z.array(QuestionStatsSchema),
  timeBudgets: z.record(z.string(), TimeBudgetBreakdownSchema),
});
export type DebugResponse = z.infer<typeof DebugResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 7. Fixtures (samples/cache/<sample>.json, loaded by POST /courses/seed/:sample)
// ─────────────────────────────────────────────────────────────────────────────

export const CourseFixtureSchema = z.object({
  version: z.literal(1),
  /** The sample id, e.g. "seasons". */
  sample: z.string(),
  /** Which embedder produced `chunks[].embedding`. Seeding re-embeds when it differs from the running one. */
  embedderId: z.string(),
  pack: CoursePackSchema,
  questions: z.array(QuestionSchema),
  chunks: z.array(ChunkSchema),
});
export type CourseFixture = z.infer<typeof CourseFixtureSchema>;
