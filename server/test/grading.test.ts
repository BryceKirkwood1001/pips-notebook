/** Complements core/core.test.ts: boundaries and the shapes it does not cover. */
import { describe, expect, it } from 'vitest';
import { answerFitsQuestion, correctAnswerOf, gradeDeterministic, targetsMisconception, wrongAnswerFor } from '../src/core/grading';
import { buildQuestion } from './helpers/fixtures';

const mk = (kind: Parameters<typeof buildQuestion>[0]) => buildQuestion(kind, `x_${kind}`, ['c1'], [], 'm1a', 3);

describe('grading edges', () => {
  it('numeric: absolute tolerance boundary and a relative tolerance', () => {
    const q = mk('numeric'); // answer 13, +/-0.5
    expect(gradeDeterministic(q, { value: 13.5 }).status).toBe('correct');
    expect(gradeDeterministic(q, { value: 12.5 }).status).toBe('correct');
    expect(gradeDeterministic(q, { value: 13.51 }).status).toBe('incorrect');
    const rel = { ...q, payload: { ...q.payload, answer: 1000, tolerance: { kind: 'rel', value: 0.01 } } } as typeof q;
    expect(gradeDeterministic(rel, { value: 1010 }).status).toBe('correct');
    expect(gradeDeterministic(rel, { value: 1011 }).status).toBe('incorrect');
    expect(gradeDeterministic(rel, { text: '1000' }).status).toBe('invalid');
  });

  it('numeric: the wrong-answer value maps to its misconception, anything else maps to none', () => {
    const q = mk('numeric');
    expect(gradeDeterministic(q, { value: 103 })).toMatchObject({ status: 'incorrect', misconceptionIds: ['m1a'] });
    expect(gradeDeterministic(q, { value: 55 })).toMatchObject({ status: 'incorrect', misconceptionIds: [] });
  });

  it('mcq: plain wrong option has no misconception, belief option has one', () => {
    const q = mk('mcq');
    expect(gradeDeterministic(q, { choiceIndex: 0 }).misconceptionIds).toEqual([]);
    expect(gradeDeterministic(q, { choiceIndex: 2 }).misconceptionIds).toEqual(['m1a']);
    expect(gradeDeterministic(q, { choiceIndex: -1 }).status).toBe('invalid');
  });

  it('multi_select: partial and over-selection are wrong, duplicates are invalid', () => {
    const q = mk('multi_select'); // correct 0 and 2
    expect(gradeDeterministic(q, { choiceIndexes: [0, 2] }).status).toBe('correct');
    expect(gradeDeterministic(q, { choiceIndexes: [0] }).status).toBe('incorrect');
    expect(gradeDeterministic(q, { choiceIndexes: [0, 2, 3] }).status).toBe('incorrect');
    expect(gradeDeterministic(q, { choiceIndexes: [1, 0, 2] }).misconceptionIds).toEqual(['m1a']);
    expect(gradeDeterministic(q, { choiceIndexes: [0, 0] }).status).toBe('invalid');
  });

  it('short_text: normalization, wrong pattern, fallback to the LLM', () => {
    const q = mk('short_text'); // accepts "word3"
    expect(gradeDeterministic(q, { text: '  "WORD3"! ' }).status).toBe('correct');
    expect(gradeDeterministic(q, { text: 'i think bad3 maybe' })).toMatchObject({ status: 'incorrect', misconceptionIds: ['m1a'] });
    expect(gradeDeterministic(q, { text: 'something else' }).status).toBe('needs_llm');
    expect(gradeDeterministic(q, { text: '   ' }).status).toBe('invalid');
  });

  it('ordering and true_false', () => {
    const o = mk('ordering');
    expect(gradeDeterministic(o, { order: [2, 0, 1] }).status).toBe('correct');
    expect(gradeDeterministic(o, { order: [0, 1, 2] })).toMatchObject({ status: 'incorrect', misconceptionIds: [] });
    expect(gradeDeterministic(o, { order: [1, 0, 2] }).misconceptionIds).toEqual(['m1a']);
    const t = mk('true_false');
    expect(gradeDeterministic(t, { value: true }).status).toBe('correct');
    expect(gradeDeterministic(t, { value: false }).misconceptionIds).toEqual(['m1a']);
  });

  it('free_response always needs the LLM; dontKnow is wrong for every type', () => {
    expect(gradeDeterministic(mk('free_response'), { text: 'x' }).status).toBe('needs_llm');
    for (const k of ['mcq', 'true_false', 'multi_select', 'numeric', 'short_text', 'ordering'] as const) {
      expect(gradeDeterministic(mk(k), { dontKnow: true })).toMatchObject({ status: 'incorrect', dontKnow: true });
    }
  });

  it('answerFitsQuestion rejects the wrong field', () => {
    expect(answerFitsQuestion(mk('mcq'), { value: 1 })).toBe(false);
    expect(answerFitsQuestion(mk('ordering'), { order: [0, 1] })).toBe(false);
  });

  it('every wrong path built by wrongAnswerFor is graded wrong with that misconception; the key is correct', () => {
    for (const k of ['mcq', 'true_false', 'multi_select', 'numeric', 'short_text', 'ordering'] as const) {
      const q = mk(k);
      expect(gradeDeterministic(q, correctAnswerOf(q).answer).status, k).toBe('correct');
      expect(gradeDeterministic(q, wrongAnswerFor(q, 'm1a')!).misconceptionIds, k).toEqual(['m1a']);
      expect(targetsMisconception(q, 'm1a')).toBe(true);
      expect(targetsMisconception(q, 'm9z')).toBe(false);
    }
  });
});
