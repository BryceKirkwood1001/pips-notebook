import { describe, expect, it } from 'vitest';
import { CoursePackSchema, QuestionSchema } from '@top/shared';
import { targetsMisconception } from '../src/core/grading';
import { fixtureCoursePack, fixtureQuestions, fixtureMisconceptions } from './helpers/fixtures';
import { findHiddenKeys } from './helpers/leaks';

describe('test fixtures', () => {
  const pack = fixtureCoursePack();
  const questions = fixtureQuestions();

  it('satisfy the Zod schemas', () => {
    expect(CoursePackSchema.safeParse(pack).success).toBe(true);
    for (const q of questions) expect(QuestionSchema.safeParse(q).success, q.id).toBe(true);
  });

  it('cover rooms, boss and misconceptions', () => {
    expect(pack.rooms).toHaveLength(3);
    expect(pack.concepts.every((c) => c.misconceptions.length === 2)).toBe(true);
    for (const r of pack.rooms) {
      const pool = questions.filter((q) => q.conceptIds.every((c) => r.conceptIds.includes(c)));
      expect(pool.length).toBeGreaterThanOrEqual(10);
    }
    expect(questions.filter((q) => q.conceptIds.length >= 2).length).toBeGreaterThanOrEqual(5);
    for (const m of fixtureMisconceptions()) {
      expect(questions.some((q) => targetsMisconception(q, m.id)), m.id).toBe(true);
    }
  });
});

describe('findHiddenKeys', () => {
  it('finds nested forbidden keys with their paths', () => {
    expect(findHiddenKeys({ a: [{ correctIndex: 1 }], b: { hidden: {} }, ok: { correctAnswer: 1 } })).toEqual(['$.a[0].correctIndex', '$.b.hidden']);
    expect(findHiddenKeys({ correctAnswer: { answer: {} }, explanation: 'x', costlyMisconceptions: [] })).toEqual([]);
  });
});
