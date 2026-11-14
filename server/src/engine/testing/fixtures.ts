/**
 * Test fixtures for the engine and the service layer: a small hand-made course pack, ~30 questions,
 * a scripted fake GameplayTasks, a fake Retriever, a fixed clock and a deps builder.
 *
 * Pack: rooms r1 = [c1, c2] and r2 = [c3]. Each concept has two misconceptions (m1a, m1b, m2a, ...).
 */
import {
  emptyStyleProfile,
  type Answer,
  type Concept,
  type CoursePack,
  type Evidence,
  type Question,
} from '@pips-notebook/shared';
import { testConfig, type Config } from '../../config';
import { correctAnswerOf } from '../../core/grading';
import { createRng } from '../../core/rng';
import type {
  CheckResolutionInput,
  CheckResolutionOutput,
  GameplayTasks,
  GradeOpenInput,
  GradeOpenOutput,
  StudentAnswerInput,
  StudentAnswerOutput,
  StudentOracle,
  StudentReviewInput,
  StudentReviewOutput,
} from '../../llm/types';
import type { RetrieveQuery, RetrievedChunk, Retriever } from '../../rag/types';
import { notebookLines } from '../notebook';
import type { Clock, EngineContext, EngineDeps } from '../types';

export const COURSE_ID = 'course1';

const evidence = (quote = 'quote'): Evidence => ({
  chunkId: `${COURSE_ID}_f1_p1_0`,
  fileId: 'f1',
  page: 3,
  quote,
  sectionPath: ['Unit 1', 'Section'],
});

function concept(n: 1 | 2 | 3): Concept {
  const mk = (suffix: 'a' | 'b') => ({
    id: `m${n}${suffix}`,
    conceptId: `c${n}`,
    description: `Misconception ${n}${suffix}`,
    beliefStatement: `Belief ${n}${suffix} is true`,
    correction: `Actually ${n}${suffix} is false`,
    evidence: evidence(`evidence for ${n}${suffix}`),
    origin: 'material' as const,
    likelihood: suffix === 'a' ? 3 : 2,
  });
  return {
    id: `c${n}`,
    unitId: 'u1',
    title: `Concept ${n}`,
    summary: `Summary of concept ${n}`,
    order: n,
    prerequisites: [],
    keyPoints: [{ id: `k${n}`, statement: `Key point ${n}`, evidence: evidence() }],
    misconceptions: [mk('a'), mk('b')],
  };
}

export function buildPack(overrides: Partial<CoursePack> = {}): CoursePack {
  return {
    id: COURSE_ID,
    title: 'Test Course',
    language: 'en',
    files: [{ id: 'f1', name: 'notes.pdf', type: 'pdf', pages: 10 }],
    status: { stage: 'ready', conceptsReady: ['c1', 'c2', 'c3'] },
    styleProfile: emptyStyleProfile(),
    units: [{ id: 'u1', title: 'Unit 1', order: 1, conceptIds: ['c1', 'c2', 'c3'] }],
    concepts: [concept(1), concept(2), concept(3)],
    rooms: [
      { id: 'r1', title: 'Room 1', order: 1, conceptIds: ['c1', 'c2'] },
      { id: 'r2', title: 'Room 2', order: 2, conceptIds: ['c3'] },
    ],
    materialItems: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Question builders ───────────────────────────────────────────────────────

type Base = { id: string; conceptIds: string[]; misconceptionIds: string[] };
const base = (id: string, conceptIds: string[], misconceptionIds: string[], timeBudgetSec = 30) => ({
  id,
  courseId: COURSE_ID,
  conceptIds,
  keyPointIds: conceptIds.map((c) => `k${c.slice(1)}`),
  misconceptionIds,
  prompt: `Prompt ${id}`,
  solution: { finalAnswer: `Final ${id}`, workedSteps: [{ text: 'step', kind: 'recall' as const }] },
  explanation: `Explanation ${id}`,
  difficulty: 2,
  timeBudgetSec,
  provenance: { origin: 'verbatim' as const, evidence: evidence() },
  verified: true,
}) satisfies Omit<Question, 'type' | 'payload'> & Base;

/** mcq: option 0 is correct, option 1 maps to `wrong1`, option 2 to `wrong2`, option 3 to nothing. */
const mcq = (id: string, cs: string[], wrong1: string | null, wrong2: string | null = null): Question => ({
  ...base(id, cs, [wrong1, wrong2].filter((m): m is string => !!m)),
  type: 'mcq',
  payload: {
    options: [
      { text: 'Right', misconceptionId: null },
      { text: 'Wrong one', misconceptionId: wrong1 },
      { text: 'Wrong two', misconceptionId: wrong2 },
      { text: 'Wrong three', misconceptionId: null },
    ],
    correctIndex: 0,
  },
});

const trueFalse = (id: string, cs: string[], wrong: string | null): Question => ({
  ...base(id, cs, wrong ? [wrong] : []),
  type: 'true_false',
  payload: { statement: `Statement ${id}`, correctValue: true, wrongMisconceptionId: wrong },
});

const multi = (id: string, cs: string[], wrong: string): Question => ({
  ...base(id, cs, [wrong]),
  type: 'multi_select',
  payload: {
    options: [
      { text: 'Yes A', misconceptionId: null },
      { text: 'Yes B', misconceptionId: null },
      { text: 'No C', misconceptionId: wrong },
    ],
    correctIndexes: [0, 1],
  },
});

const numeric = (id: string, cs: string[], wrong: string): Question => ({
  ...base(id, cs, [wrong]),
  type: 'numeric',
  payload: {
    answer: 10,
    tolerance: { kind: 'abs', value: 0.5 },
    unit: 'm',
    wrongAnswers: [{ value: 20, tolerance: 0.5, misconceptionId: wrong }],
  },
});

const shortText = (id: string, cs: string[], wrong: string): Question => ({
  ...base(id, cs, [wrong]),
  type: 'short_text',
  payload: { acceptedAnswers: ['photosynthesis'], rubric: 'Names photosynthesis', wrongAnswers: [{ pattern: 'respiration', misconceptionId: wrong }] },
});

const ordering = (id: string, cs: string[], wrong: string): Question => ({
  ...base(id, cs, [wrong]),
  type: 'ordering',
  payload: { items: ['second', 'first', 'third'], correctOrder: [1, 0, 2], wrongOrders: [{ order: [0, 1, 2], misconceptionId: wrong }] },
});

const freeResponse = (id: string, cs: string[], mis: string): Question => ({
  ...base(id, cs, [mis], 90),
  type: 'free_response',
  payload: { rubric: 'Explains the idea', modelAnswer: 'The idea explained' },
});

/** ~30 verified questions plus one unverified. Ids: q_<concepts>_<type><n>. */
export function buildQuestions(): Question[] {
  const qs: Question[] = [
    // c1
    mcq('q_c1_mcq1', ['c1'], 'm1a', 'm1b'),
    trueFalse('q_c1_tf1', ['c1'], 'm1b'),
    numeric('q_c1_num1', ['c1'], 'm1a'),
    shortText('q_c1_short1', ['c1'], 'm1a'),
    ordering('q_c1_ord1', ['c1'], 'm1b'),
    multi('q_c1_multi1', ['c1'], 'm1a'),
    freeResponse('q_c1_free1', ['c1'], 'm1a'),
    mcq('q_c1_mcq2', ['c1'], 'm1b'),
    mcq('q_c1_mcq3', ['c1'], 'm1a'),
    // c2
    mcq('q_c2_mcq1', ['c2'], 'm2a', 'm2b'),
    trueFalse('q_c2_tf1', ['c2'], 'm2b'),
    shortText('q_c2_short1', ['c2'], 'm2a'),
    numeric('q_c2_num1', ['c2'], 'm2b'),
    mcq('q_c2_mcq2', ['c2'], 'm2a'),
    mcq('q_c2_mcq3', ['c2'], 'm2b'),
    // c3
    mcq('q_c3_mcq1', ['c3'], 'm3a', 'm3b'),
    trueFalse('q_c3_tf1', ['c3'], 'm3b'),
    multi('q_c3_multi1', ['c3'], 'm3a'),
    numeric('q_c3_num1', ['c3'], 'm3a'),
    shortText('q_c3_short1', ['c3'], 'm3b'),
    ordering('q_c3_ord1', ['c3'], 'm3a'),
    freeResponse('q_c3_free1', ['c3'], 'm3b'),
    mcq('q_c3_mcq2', ['c3'], 'm3a'),
    mcq('q_c3_mcq3', ['c3'], 'm3b'),
    // multi-concept
    mcq('q_c1c2_mcq1', ['c1', 'c2'], 'm1a', 'm2a'),
    mcq('q_c2c3_mcq1', ['c2', 'c3'], 'm2b', 'm3a'),
    trueFalse('q_c1c3_tf1', ['c1', 'c3'], 'm3b'),
    mcq('q_c1c2c3_mcq1', ['c1', 'c2', 'c3'], 'm1b', 'm3b'),
    shortText('q_c1c3_short1', ['c1', 'c3'], 'm1b'),
    numeric('q_c2c3_num1', ['c2', 'c3'], 'm3a'),
  ];
  qs.push({ ...mcq('q_unverified', ['c1'], 'm1a'), verified: false });
  return qs;
}

export function buildCtx(overrides: Partial<EngineContext> = {}): EngineContext {
  return { pack: buildPack(), questions: buildQuestions(), ...overrides };
}

// ── Clock ───────────────────────────────────────────────────────────────────

export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(d: Date): void;
}

export function createFakeClock(start = '2026-06-01T12:00:00.000Z'): FakeClock {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advance(ms) {
      t += ms;
    },
    set(d) {
      t = d.getTime();
    },
  };
}

// ── Retriever ───────────────────────────────────────────────────────────────

export interface FakeRetriever extends Retriever {
  queries: RetrieveQuery[];
  fail: boolean;
}

export function createFakeRetriever(): FakeRetriever {
  const r: FakeRetriever = {
    queries: [],
    fail: false,
    async retrieve(q) {
      r.queries.push(q);
      if (r.fail) throw new Error('retrieval failed');
      const chunk: RetrievedChunk = {
        chunkId: `${COURSE_ID}_f1_p1_0`,
        fileId: 'f1',
        page: 3,
        sectionPath: ['Unit 1'],
        text: 'Some evidence text.',
        score: 1,
        source: 'concept',
      };
      return [chunk];
    },
  };
  return r;
}

// ── Scripted GameplayTasks ──────────────────────────────────────────────────

export interface FakeTasks extends GameplayTasks {
  calls: {
    review: StudentReviewInput[];
    resolution: CheckResolutionInput[];
    answer: { input: StudentAnswerInput; oracle?: StudentOracle }[];
    gradeOpen: GradeOpenInput[];
  };
  /** Replace any of these to script behavior. */
  handlers: {
    review: (input: StudentReviewInput) => StudentReviewOutput;
    resolution: (input: CheckResolutionInput) => CheckResolutionOutput;
    answer: (input: StudentAnswerInput, oracle?: StudentOracle) => StudentAnswerOutput;
    gradeOpen: (input: GradeOpenInput) => GradeOpenOutput;
  };
}

/** The student's right answer with the first notebook line cited (or nothing cited when the notebook is empty). */
export const answerCorrectly = (input: StudentAnswerInput, oracle?: StudentOracle): StudentAnswerOutput => {
  const answer: Answer = oracle ? correctAnswerOf(oracle.question).answer : { dontKnow: true };
  const first = notebookLines(input.notebookMd)[0];
  return { answer, reasoning: 'From my notes.', citedNotes: first ? [first] : [] };
};

/** The student's wrong answer following misconception `id`'s path, citing the first note. */
export const answerWrong = (input: StudentAnswerInput, oracle?: StudentOracle): StudentAnswerOutput => ({
  answer: { dontKnow: true },
  reasoning: 'I do not know.',
  citedNotes: [],
});

export function createFakeTasks(): FakeTasks {
  const t: FakeTasks = {
    calls: { review: [], resolution: [], answer: [], gradeOpen: [] },
    handlers: {
      review: () => ({ notesToAdd: [], statedMisconceptionIds: [], questions: [], resolvedMisconceptionIds: [] }),
      resolution: () => ({ resolved: true, noteToAdd: '', why: 'ok' }),
      answer: answerCorrectly,
      gradeOpen: () => ({ correct: true, misconceptionIds: [], feedback: 'ok' }),
    },
    async studentReview(input) {
      t.calls.review.push(input);
      return t.handlers.review(input);
    },
    async checkResolution(input) {
      t.calls.resolution.push(input);
      return t.handlers.resolution(input);
    },
    async studentAnswer(input, oracle) {
      t.calls.answer.push({ input, oracle });
      return t.handlers.answer(input, oracle);
    },
    async gradeOpen(input) {
      t.calls.gradeOpen.push(input);
      return t.handlers.gradeOpen(input);
    },
  };
  return t;
}

// ── Deps ────────────────────────────────────────────────────────────────────

export interface TestDeps extends EngineDeps {
  tasks: FakeTasks;
  retriever: FakeRetriever;
  clock: FakeClock;
}

/** Defaults: no "Help me!" (prob 0), 5 room questions, 3 hearts, 10 boss questions. */
export function createDeps(configOverrides: Partial<Config> = {}, seed = 42): TestDeps {
  return {
    config: testConfig({ helpMeProb: 0, ...configOverrides }),
    tasks: createFakeTasks(),
    retriever: createFakeRetriever(),
    rng: createRng(seed),
    clock: createFakeClock(),
  };
}
