import { describe, expect, it } from 'vitest';
import type { QuestionType } from '@top/shared';
import { STEP_SECONDS, TIME_BASE, calibratedTimeBudget, computeTimeBudget, effectiveTimeBudget } from '../src/core/timeBudget';

const wide = { helpMeMinSec: 1, helpMeMaxSec: 10000 };
const r5 = (x: number) => Math.round(x / 5) * 5;
const input = (type: QuestionType, kinds: string[] = [], difficulty = 3, prompt = '') =>
  ({ type, prompt, payload: {}, difficulty, solution: { workedSteps: kinds.map((kind) => ({ text: 's', kind })) } }) as never;

describe('time budget formula', () => {
  it('uses the SPEC base for every type', () => {
    const base = { true_false: 5, mcq: 10, multi_select: 15, numeric: 15, short_text: 15, ordering: 20, free_response: 60 };
    for (const [type, b] of Object.entries(base)) {
      expect(TIME_BASE[type as QuestionType]).toBe(b);
      expect(computeTimeBudget(input(type as QuestionType), wide).timeBudgetSec).toBe(r5(b * 1.1));
    }
  });

  it('uses the SPEC seconds for every step kind', () => {
    const secs = { recall: 6, reason: 12, compute: 20, write: 25 };
    for (const [kind, s] of Object.entries(secs)) {
      expect(STEP_SECONDS[kind as keyof typeof STEP_SECONDS]).toBe(s);
      const b = computeTimeBudget(input('mcq', [kind, kind]), wide);
      expect(b.stepSec).toBe(2 * s);
      expect(b.timeBudgetSec).toBe(r5((10 + 2 * s) * 1.1));
    }
  });

  it('scales with difficulty and counts words', () => {
    // 6 words / 3 = 2 s
    const lo = computeTimeBudget(input('numeric', ['compute'], 1, 'one two three four five six'), wide);
    const hi = computeTimeBudget(input('numeric', ['compute'], 5, 'one two three four five six'), wide);
    expect(lo.raw).toBe(15 + 2 + 20);
    expect(lo.timeBudgetSec).toBe(r5(37 * 0.9));
    expect(hi.timeBudgetSec).toBe(r5(37 * 1.3));
  });

  it('clamps to the configured min and max', () => {
    expect(computeTimeBudget(input('true_false'), { helpMeMinSec: 20, helpMeMaxSec: 240 }).timeBudgetSec).toBe(20);
    expect(computeTimeBudget(input('free_response', Array(20).fill('write'), 5), { helpMeMinSec: 20, helpMeMaxSec: 90 }).timeBudgetSec).toBe(90);
  });

  it('material hint overrides the formula, scaled by difficulty', () => {
    const hint = { secondsPerQuestion: 60 };
    expect(computeTimeBudget(input('mcq', [], 3), wide, hint)).toMatchObject({ source: 'material_hint', timeBudgetSec: 60 });
    expect(computeTimeBudget(input('mcq', [], 5), wide, hint).timeBudgetSec).toBe(100);
    expect(computeTimeBudget(input('mcq', [], 1), wide, hint).timeBudgetSec).toBe(20);
  });

  it('calibrates after 5 observed solves, never before', () => {
    expect(calibratedTimeBudget([30, 30, 30, 30], wide)).toBeNull();
    expect(calibratedTimeBudget([10, 20, 30, 40, 50], wide)).toBe(45);
    expect(calibratedTimeBudget([20, 20, 20, 20, 20, 100], wide)).toBe(30); // median 20 -> 30
    expect(effectiveTimeBudget({ timeBudgetSec: 90 }, { helpMeSolveTimesSec: [1, 2, 3] }, wide)).toBe(90);
    expect(effectiveTimeBudget({ timeBudgetSec: 90 }, { helpMeSolveTimesSec: [40, 40, 40, 40, 40] }, wide)).toBe(60);
  });
});
