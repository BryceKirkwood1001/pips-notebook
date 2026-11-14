/**
 * A small hand-built course: 3 concepts (one room each), 2 misconceptions per concept, and enough
 * questions for room draws (10 single-concept per room) and a 10-question boss (6 multi-concept).
 * Ids: course `crs`, concepts c1..c3, rooms r1..r3, misconceptions m1a m1b m2a ...
 */
import { CoursePackSchema, QuestionSchema, emptyStyleProfile, type CoursePack, type Question } from '@pips-notebook/shared';

export const COURSE_ID = 'crs';
export const NOW_ISO = '2025-01-01T00:00:00.000Z';

const evidence = (what: string) => ({
  chunkId: `${COURSE_ID}_f1_p1_0`,
  fileId: 'f1',
  page: 1,
  quote: `evidence for ${what}`,
  sectionPath: ['Fixture'],
});

export const conceptTitle = (i: number): string => `Concept ${['One', 'Two', 'Three'][i - 1]}`;
export const belief = (id: string): string => `I believe thing ${id}`;
export const correction = (id: string): string => `Actually the truth about ${id} is different`;

function conceptDef(i: number) {
  const c = `c${i}`;
  return {
    id: c,
    unitId: 'u1',
    title: conceptTitle(i),
    summary: `Summary of ${conceptTitle(i)}`,
    order: i,
    prerequisites: i > 1 ? [`c${i - 1}`] : [],
    keyPoints: [1, 2].map((k) => ({
      id: `${c}_k${k}`,
      statement: `Key point ${k} of ${conceptTitle(i)} states a clear fact`,
      evidence: evidence(`${c}_k${k}`),
    })),
    misconceptions: ['a', 'b'].map((s, n) => {
      const id = `m${i}${s}`;
      return {
        id,
        conceptId: c,
        description: `Misconception ${id}`,
        beliefStatement: belief(id),
        correction: correction(id),
        evidence: evidence(id),
        origin: n === 0 ? ('material' as const) : ('inferred' as const),
        likelihood: n === 0 ? 3 : 2,
      };
    }),
  };
}

export function fixtureCoursePack(): CoursePack {
  return CoursePackSchema.parse({
    id: COURSE_ID,
    title: 'Fixture course',
    language: 'en',
    files: [{ id: 'f1', name: 'fixture.md', type: 'md', pages: 1 }],
    status: { stage: 'ready', conceptsReady: ['c1', 'c2', 'c3'] },
    styleProfile: emptyStyleProfile(),
    units: [{ id: 'u1', title: 'Unit 1', order: 1, conceptIds: ['c1', 'c2', 'c3'] }],
    concepts: [1, 2, 3].map(conceptDef),
    rooms: [1, 2, 3].map((i) => ({ id: `r${i}`, title: `Room ${i}`, order: i, conceptIds: [`c${i}`] })),
    materialItems: [],
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  });
}

type Kind = 'mcq' | 'true_false' | 'numeric' | 'short_text' | 'ordering' | 'multi_select' | 'free_response';

/** Every kind except free_response has a deterministic wrong path for misconception `mid`. */
export function buildQuestion(
  kind: Kind,
  id: string,
  conceptIds: string[],
  keyPointIds: string[],
  mid: string,
  n = 0,
): Question {
  const payloads: Record<Kind, unknown> = {
    mcq: {
      options: [
        { text: `plain wrong ${id}`, misconceptionId: null },
        { text: `right ${id}`, misconceptionId: null },
        { text: `belief ${id}`, misconceptionId: mid },
        { text: `other wrong ${id}`, misconceptionId: null },
      ],
      correctIndex: 1,
    },
    true_false: { statement: `Claim ${id} holds`, correctValue: true, wrongMisconceptionId: mid },
    multi_select: {
      options: [
        { text: 'ok one', misconceptionId: null },
        { text: 'belief pick', misconceptionId: mid },
        { text: 'ok two', misconceptionId: null },
        { text: 'bad pick', misconceptionId: null },
      ],
      correctIndexes: [0, 2],
    },
    numeric: {
      answer: 10 + n,
      tolerance: { kind: 'abs', value: 0.5 },
      unit: 'm',
      wrongAnswers: [{ value: 100 + n, tolerance: 0.5, misconceptionId: mid }],
    },
    short_text: {
      acceptedAnswers: [`word${n}`],
      rubric: `answer is word${n}`,
      wrongAnswers: [{ pattern: `bad${n}`, misconceptionId: mid }],
    },
    ordering: {
      items: ['b step', 'c step', 'a step'],
      correctOrder: [2, 0, 1],
      wrongOrders: [{ order: [1, 0, 2], misconceptionId: mid }],
    },
    free_response: { rubric: 'mentions the key idea', modelAnswer: 'the key idea' },
  };
  return QuestionSchema.parse({
    id,
    courseId: COURSE_ID,
    conceptIds,
    keyPointIds,
    misconceptionIds: [mid],
    type: kind,
    prompt: `Question ${id}?`,
    payload: payloads[kind],
    solution: {
      finalAnswer: 'answer',
      workedSteps: [
        { text: 'recall it', kind: 'recall' },
        { text: 'reason it', kind: 'reason' },
      ],
    },
    explanation: `Because of ${id}`,
    difficulty: ((n % 5) + 1) as 1,
    timeBudgetSec: 40 + 5 * (n % 4),
    provenance: { origin: 'verbatim', materialItemId: undefined, evidence: evidence(id) },
    verified: true,
  });
}

const KINDS: Kind[] = ['mcq', 'true_false', 'numeric', 'short_text', 'ordering', 'multi_select', 'mcq', 'true_false', 'numeric', 'mcq'];

export const qid = (c: number, n: number): string => `${COURSE_ID}_q_c${c}_${n}`;

/** 10 single-concept questions per concept + 1 free_response (c1) + 6 multi-concept (boss pool). */
export function fixtureQuestions(): Question[] {
  const out: Question[] = [];
  for (const c of [1, 2, 3]) {
    for (let n = 0; n < 10; n++) {
      out.push(buildQuestion(KINDS[n], qid(c, n), [`c${c}`], [`c${c}_k${(n % 2) + 1}`], `m${c}${n % 2 === 0 ? 'a' : 'b'}`, n));
    }
  }
  out.push(buildQuestion('free_response', `${COURSE_ID}_q_fr`, ['c1'], ['c1_k1'], 'm1a'));
  [[1, 2], [2, 3], [1, 3]].forEach(([a, b], i) => {
    for (let n = 0; n < 2; n++) {
      out.push(buildQuestion('mcq', `${COURSE_ID}_q_multi_${a}${b}_${n}`, [`c${a}`, `c${b}`], [], `m${a}${n === 0 ? 'a' : 'b'}`, i + n));
    }
  });
  return out;
}

export const fixtureMisconceptions = () => fixtureCoursePack().concepts.flatMap((c) => c.misconceptions);
