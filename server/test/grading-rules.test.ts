/** Written answers are graded on the core idea the question asks for; rubrics only require what the question asks. */
import { expect, test } from 'vitest';
import { GRADE_OPEN_SYSTEM } from '../src/prompts/gameplay/gradeOpen';
import { QUESTION_QUALITY_RULES } from '../src/prompts/ingest/questionSpec';

test('the grader credits a correct core idea even without a secondary rubric detail, but not a false claim', () => {
  expect(GRADE_OPEN_SYSTEM).toMatch(/core idea the question asks for/);
  expect(GRADE_OPEN_SYSTEM).toMatch(/leaves out a secondary detail/);
  expect(GRADE_OPEN_SYSTEM).toMatch(/only when the question itself explicitly asks for it/);
  expect(GRADE_OPEN_SYSTEM).toMatch(/contradicts the reference or the course material/);
  expect(GRADE_OPEN_SYSTEM).not.toMatch(/strictly/);
});

test('generated rubrics require only what the question asks; details are extras unless asked for', () => {
  expect(QUESTION_QUALITY_RULES).toMatch(/A rubric requires only the idea the question actually asks for/);
  expect(QUESTION_QUALITY_RULES).toMatch(/acceptable extras, not requirements/);
});
