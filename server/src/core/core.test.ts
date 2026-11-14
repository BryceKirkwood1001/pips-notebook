import { describe, expect, it } from 'vitest';
import { QuestionSchema, type Question } from '@top/shared';
import { loadConfig } from '../config';
import {
  correctAnswerOf,
  formatAnswer,
  gradeDeterministic,
  mappedMisconceptionIds,
  targetsMisconception,
  wrongAnswerFor,
} from './grading';
import { createRng } from './rng';
import { calibratedTimeBudget, computeTimeBudget, effectiveTimeBudget, materialTimeHintFor } from './timeBudget';

const base = {
  courseId: 'crs',
  conceptIds: ['c1'],
  keyPointIds: [],
  misconceptionIds: ['m_far'],
  solution: { finalAnswer: '', workedSteps: [] },
  explanation: '',
  difficulty: 3,
  timeBudgetSec: 30,
  provenance: { origin: 'verbatim', evidence: { chunkId: 'f1_p1_0', fileId: 'f1', page: 1, quote: 'q' } },
  verified: true,
};

const q = (extra: Record<string, unknown>): Question => QuestionSchema.parse({ ...base, ...extra });

const mcq = q({
  id: 'q1',
  type: 'mcq',
  prompt: 'What causes seasons?',
  payload: {
    options: [
      { text: 'Distance', misconceptionId: 'm_far' },
      { text: 'Tilt', misconceptionId: null },
      { text: 'Sun output', misconceptionId: null },
    ],
    correctIndex: 1,
  },
});
const tf = q({
  id: 'q2',
  type: 'true_false',
  prompt: 'True or false?',
  payload: { statement: 'Earth is closest in July.', correctValue: false, wrongMisconceptionId: 'm_far' },
});
const multi = q({
  id: 'q3',
  type: 'multi_select',
  prompt: 'Select all',
  payload: {
    options: [
      { text: 'a', misconceptionId: null },
      { text: 'b', misconceptionId: 'm_far' },
      { text: 'c', misconceptionId: null },
    ],
    correctIndexes: [0, 2],
  },
});
const numeric = q({
  id: 'q4',
  type: 'numeric',
  prompt: 'Noon altitude?',
  payload: {
    answer: 71.5,
    tolerance: { kind: 'abs', value: 0.5 },
    unit: 'degrees',
    wrongAnswers: [{ value: 24.5, tolerance: 0.5, misconceptionId: 'm_far' }],
  },
});
const shortText = q({
  id: 'q5',
  type: 'short_text',
  prompt: 'Running time?',
  payload: {
    acceptedAnswers: ['O(log n)'],
    rubric: 'logarithmic',
    wrongAnswers: [{ pattern: 'O(n)', misconceptionId: 'm_far' }],
  },
});
const ordering = q({
  id: 'q6',
  type: 'ordering',
  prompt: 'Order',
  payload: { items: ['b', 'c', 'a'], correctOrder: [2, 0, 1], wrongOrders: [{ order: [1, 0, 2], misconceptionId: 'm_far' }] },
});
const free = q({ id: 'q7', type: 'free_response', prompt: 'Explain', payload: { rubric: 'mentions tilt' } });

describe('gradeDeterministic', () => {
  it('grades mcq and maps the wrong option', () => {
    expect(gradeDeterministic(mcq, { choiceIndex: 1 }).status).toBe('correct');
    expect(gradeDeterministic(mcq, { choiceIndex: 0 })).toMatchObject({ status: 'incorrect', misconceptionIds: ['m_far'] });
    expect(gradeDeterministic(mcq, { choiceIndex: 2 })).toMatchObject({ status: 'incorrect', misconceptionIds: [] });
    expect(gradeDeterministic(mcq, { choiceIndex: 9 }).status).toBe('invalid');
    expect(gradeDeterministic(mcq, { text: 'Tilt' }).status).toBe('invalid');
  });

  it('grades true_false', () => {
    expect(gradeDeterministic(tf, { value: false }).status).toBe('correct');
    expect(gradeDeterministic(tf, { value: true }).misconceptionIds).toEqual(['m_far']);
    expect(gradeDeterministic(tf, { value: 1 }).status).toBe('invalid');
  });

  it('grades multi_select as an exact set', () => {
    expect(gradeDeterministic(multi, { choiceIndexes: [2, 0] }).status).toBe('correct');
    expect(gradeDeterministic(multi, { choiceIndexes: [0] })).toMatchObject({ status: 'incorrect', misconceptionIds: [] });
    expect(gradeDeterministic(multi, { choiceIndexes: [0, 1, 2] }).misconceptionIds).toEqual(['m_far']);
  });

  it('grades numeric with tolerance and wrong-answer mapping', () => {
    expect(gradeDeterministic(numeric, { value: 71.9 }).status).toBe('correct');
    expect(gradeDeterministic(numeric, { value: 72.1 }).status).toBe('incorrect');
    expect(gradeDeterministic(numeric, { value: 24.5 }).misconceptionIds).toEqual(['m_far']);
    const rel = q({ ...numeric, id: 'q4b', payload: { ...numeric.payload, answer: 200, tolerance: { kind: 'rel', value: 0.05 } } });
    expect(gradeDeterministic(rel, { value: 209 }).status).toBe('correct');
    expect(gradeDeterministic(rel, { value: 211 }).status).toBe('incorrect');
  });

  it('grades short_text by normalized match, then pattern, then defers to the LLM', () => {
    expect(gradeDeterministic(shortText, { text: ' "o(logn)". ' }).status).toBe('correct');
    expect(gradeDeterministic(shortText, { text: 'It is O(n) time' })).toMatchObject({ status: 'incorrect', misconceptionIds: ['m_far'] });
    expect(gradeDeterministic(shortText, { text: 'logarithmic' }).status).toBe('needs_llm');
  });

  it('grades ordering exactly', () => {
    expect(gradeDeterministic(ordering, { order: [2, 0, 1] }).status).toBe('correct');
    expect(gradeDeterministic(ordering, { order: [1, 0, 2] }).misconceptionIds).toEqual(['m_far']);
    expect(gradeDeterministic(ordering, { order: [0, 0, 1] }).status).toBe('invalid');
  });

  it('defers free_response and treats "I don\'t know" as wrong', () => {
    expect(gradeDeterministic(free, { text: 'tilt' }).status).toBe('needs_llm');
    expect(gradeDeterministic(mcq, { dontKnow: true })).toMatchObject({ status: 'incorrect', dontKnow: true });
  });
});

describe('answer keys and misconception paths', () => {
  it('reveals the correct answer in Answer form', () => {
    for (const question of [mcq, tf, multi, numeric, shortText, ordering]) {
      expect(gradeDeterministic(question, correctAnswerOf(question).answer).status).toBe('correct');
    }
    expect(correctAnswerOf(mcq).text).toBe('Tilt');
    expect(correctAnswerOf(numeric).text).toBe('71.5 degrees');
    expect(correctAnswerOf(ordering).text).toBe('a → b → c');
    expect(formatAnswer(mcq, { dontKnow: true })).toBe("I don't know");
  });

  it('builds a wrong answer that follows the misconception path', () => {
    for (const question of [mcq, tf, multi, numeric, shortText, ordering]) {
      const wrong = wrongAnswerFor(question, 'm_far');
      expect(wrong).not.toBeNull();
      expect(gradeDeterministic(question, wrong!)).toMatchObject({ status: 'incorrect', misconceptionIds: ['m_far'] });
      expect(mappedMisconceptionIds(question)).toEqual(['m_far']);
    }
    expect(wrongAnswerFor(mcq, 'nope')).toBeNull();
    expect(wrongAnswerFor(free, 'm_far')).toBeNull();
    expect(targetsMisconception(free, 'm_far')).toBe(true);
  });

  it('rejects invalid payloads', () => {
    const options = (mcq.payload as { options: unknown[] }).options;
    expect(() => q({ ...mcq, payload: { options, correctIndex: 5 } })).toThrow();
    expect(() => q({ ...mcq, payload: { options, correctIndex: 0 } })).toThrow();
    expect(() => q({ ...ordering, payload: { ...ordering.payload, correctOrder: [0, 0, 1] } })).toThrow();
  });
});

describe('time budget', () => {
  const limits = { helpMeMinSec: 20, helpMeMaxSec: 240 };
  const steps = (kinds: string[]) => ({ workedSteps: kinds.map((kind) => ({ text: 's', kind })) });

  it('follows the SPEC 2.10 formula', () => {
    // base 15 + 9 words / 3 + (6 + 20) = 44; × (0.8 + 0.3) = 48.4 -> 50
    const question = { type: 'numeric', prompt: 'one two three four five six seven eight nine', payload: numeric.payload, difficulty: 3, solution: steps(['recall', 'compute']) } as const;
    const b = computeTimeBudget(question as never, limits);
    expect(b).toMatchObject({ source: 'formula', base: 15, words: 9, wordSec: 3, stepSec: 26, raw: 44, timeBudgetSec: 50 });
  });

  it('counts option words and clamps', () => {
    const b = computeTimeBudget({ ...mcq, solution: steps([]) } as never, limits);
    // "What causes seasons?" 3 + options 1 + 1 + 2 = 7 words; base 10 + 7/3 = 12.33; × 1.1 = 13.6 -> 15 -> clamped to 20
    expect(b.words).toBe(7);
    expect(b.timeBudgetSec).toBe(20);
    const long = computeTimeBudget({ ...free, difficulty: 5, solution: steps(Array(12).fill('write')) } as never, limits);
    expect(long.timeBudgetSec).toBe(240);
  });

  it('uses a material hint when there is one', () => {
    const pack = { styleProfile: { examTimeHint: { totalMinutes: 10, questionCount: 5 } }, materialItems: [] } as never;
    const hint = materialTimeHintFor(mcq, pack);
    expect(hint).toEqual({ secondsPerQuestion: 120 });
    expect(computeTimeBudget({ ...mcq, difficulty: 3, solution: steps([]) } as never, limits, hint)).toMatchObject({ source: 'material_hint', timeBudgetSec: 120 });
    expect(computeTimeBudget({ ...mcq, difficulty: 5, solution: steps([]) } as never, limits, hint).timeBudgetSec).toBe(200);
    expect(materialTimeHintFor(mcq, { styleProfile: {}, materialItems: [] } as never)).toBeNull();
  });

  it('calibrates after 5 solves', () => {
    expect(calibratedTimeBudget([10, 20, 30, 40], limits)).toBeNull();
    expect(calibratedTimeBudget([10, 20, 30, 40, 50], limits)).toBe(45);
    expect(calibratedTimeBudget([1, 1, 1, 1, 1], limits)).toBe(20);
    expect(effectiveTimeBudget({ timeBudgetSec: 90 }, undefined, limits)).toBe(90);
    expect(effectiveTimeBudget({ timeBudgetSec: 90 }, { helpMeSolveTimesSec: [40, 40, 40, 40, 40] }, limits)).toBe(60);
  });
});

describe('rng and config', () => {
  it('is deterministic and resumable', () => {
    const a = createRng(42);
    const first = [a.next(), a.next(), a.next()];
    const b = createRng(42);
    expect([b.next(), b.next(), b.next()]).toEqual(first);
    const resumed = createRng(a.state());
    expect(resumed.next()).toBe(a.next());
    expect(createRng(1).shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('loads defaults, demo mode and grade thresholds', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ llmProvider: 'mock', port: 8787, roomQuestions: 5, bossQuestions: 10, helpMeProb: 0.25 });
    expect(c.gradeThresholds['B+']).toBe(87);
    const demo = loadConfig({ DEMO_MODE: 'true' });
    expect(demo).toMatchObject({ bossQuestions: 6, roomQuestions: 3, helpMeTimeMultiplier: 0.75 });
    expect(loadConfig({ GRADE_THRESHOLDS: 'A:95,D:55' }).gradeThresholds).toMatchObject({ A: 95, 'A-': 90, D: 55 });
    expect(() => loadConfig({ LLM_PROVIDER: 'gemini' })).toThrow();
    expect(() => loadConfig({ ROOM_HEARTS: 'many' })).toThrow();
  });
});
