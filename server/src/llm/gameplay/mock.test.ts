import { describe, expect, it } from 'vitest';
import type { Question } from '@top/shared';
import { coverage, keywords } from '../mock-text';
import { createMockGameplayTasks, MOCK_MIN_SHARED_KEYWORDS } from './mock';
import { MCQ, MISC_DIST, MISC_MOON, NOTEBOOK_TILT, NOTEBOOK_WRONG, PUBLIC_MCQ } from './fixtures';

const tasks = createMockGameplayTasks();
const oracle = (active: string[] = []) => ({ question: MCQ, misconceptions: [MISC_DIST, MISC_MOON], activeMisconceptionIds: active });

describe('mock-text', () => {
  it('keywords: lowercases, drops stopwords and short words, keeps numbers, strips one s', () => {
    expect([...keywords('The Seasons are 23.5 degrees, in a box!')].sort()).toEqual(['23.5', 'box', 'degree', 'season']);
  });
  it('coverage is the share of needle keywords in the haystack', () => {
    expect(coverage('axial tilt seasons', 'the tilt causes seasons')).toBeCloseTo(2 / 3);
    expect(coverage('the and', 'anything')).toBe(0);
  });
});

describe('mock studentAnswer', () => {
  it('says dontKnow without an oracle', async () => {
    const r = await tasks.studentAnswer({ notebookMd: NOTEBOOK_TILT, question: PUBLIC_MCQ });
    expect(r.answer).toEqual({ dontKnow: true });
  });
  it('gives the wrong answer for an active belief note and cites it', async () => {
    const r = await tasks.studentAnswer({ notebookMd: NOTEBOOK_WRONG, question: PUBLIC_MCQ }, oracle([MISC_DIST.id]));
    expect(r.answer).toEqual({ choiceIndex: 0 });
    expect(r.citedNotes).toEqual([MISC_DIST.beliefStatement]);
  });
  it('ignores a belief that is not active', async () => {
    const r = await tasks.studentAnswer({ notebookMd: NOTEBOOK_WRONG, question: PUBLIC_MCQ }, oracle([]));
    expect(r.answer).toEqual({ choiceIndex: 1 });
  });
  it('answers correctly from the best note and cites it', async () => {
    expect(MOCK_MIN_SHARED_KEYWORDS).toBe(2);
    const r = await tasks.studentAnswer({ notebookMd: NOTEBOOK_TILT, question: PUBLIC_MCQ }, oracle());
    expect(r.answer).toEqual({ choiceIndex: 1 });
    expect(r.citedNotes).toEqual(["Earth's axial tilt causes the seasons."]);
  });
  it("says dontKnow when notes don't cover it", async () => {
    const r = await tasks.studentAnswer({ notebookMd: '## X\n- Water boils at 100 degrees.', question: PUBLIC_MCQ }, oracle());
    expect(r.answer).toEqual({ dontKnow: true });
    expect(r.citedNotes).toEqual([]);
  });
});

describe('mock studentReview', () => {
  const base = {
    concepts: [
      { id: 'c1', title: 'Seasons', summary: 'axial tilt and sunlight' },
      { id: 'c2', title: 'Tides', summary: 'moon gravity' },
    ],
    notebookMd: '',
    misconceptions: [MISC_DIST, MISC_MOON],
    activeMisconceptionIds: [] as string[],
    probeableMisconceptionIds: [MISC_MOON.id, MISC_DIST.id],
    maxQuestions: 3,
  };
  it('makes notes from sentences, assigning the best concept', async () => {
    const r = await tasks.studentReview({ ...base, explanation: 'The moon gravity pulls on the sea. Ok. Axial tilt changes sunlight.' });
    expect(r.notesToAdd).toEqual([
      { conceptId: 'c2', text: 'The moon gravity pulls on the sea' },
      { conceptId: 'c1', text: 'Axial tilt changes sunlight' },
    ]);
  });
  it('flags stated beliefs, and probes the rest by likelihood', async () => {
    const r = await tasks.studentReview({ ...base, explanation: "We're closer to the sun in summer, that is why it is hot." });
    expect(r.statedMisconceptionIds).toEqual([MISC_DIST.id]);
    expect(r.questions).toEqual([
      { misconceptionId: MISC_MOON.id, text: 'Quick question: is it right that the Moon controls the seasons?' },
    ]);
  });
  it('orders by likelihood and honours maxQuestions', async () => {
    const r = await tasks.studentReview({ ...base, explanation: 'Plants need light to grow well.', maxQuestions: 1 });
    expect(r.questions.map((q) => q.misconceptionId)).toEqual([MISC_DIST.id]);
    expect((await tasks.studentReview({ ...base, explanation: 'Plants need light.', maxQuestions: 0 })).questions).toEqual([]);
  });
  it('resolves active misconceptions the explanation corrects', async () => {
    const r = await tasks.studentReview({
      ...base,
      activeMisconceptionIds: [MISC_DIST.id],
      probeableMisconceptionIds: [],
      explanation: "Seasons come from Earth's axial tilt, not distance from the Sun.",
    });
    expect(r.resolvedMisconceptionIds).toEqual([MISC_DIST.id]);
  });
});

describe('mock checkResolution and gradeOpen', () => {
  it('resolves on enough coverage without the belief', async () => {
    const good = await tasks.checkResolution({ misconception: MISC_DIST, question: 'q', answer: 'Seasons come from the axial tilt of Earth, not the distance to the Sun.', evidence: [] });
    expect(good.resolved).toBe(true);
    expect(good.noteToAdd).toBe(MISC_DIST.correction);
    const bad = await tasks.checkResolution({ misconception: MISC_DIST, question: 'q', answer: "We're closer to the Sun in summer, axial tilt too.", evidence: [] });
    expect(bad).toMatchObject({ resolved: false, noteToAdd: '' });
  });
  const shortText: Question = {
    ...MCQ,
    type: 'short_text',
    payload: { acceptedAnswers: ['axial tilt'], wrongAnswers: [] },
  } as unknown as Question;
  it('grades against the first accepted answer and classifies misconceptions only when wrong', async () => {
    const ok = await tasks.gradeOpen({ question: shortText, answerText: 'the tilt of the axis... axial tilt', candidateMisconceptions: [MISC_DIST], evidence: [] });
    expect(ok).toMatchObject({ correct: true, misconceptionIds: [] });
    const wrong = await tasks.gradeOpen({ question: shortText, answerText: "We're closer to the Sun in summer", candidateMisconceptions: [MISC_DIST], evidence: [] });
    expect(wrong).toMatchObject({ correct: false, misconceptionIds: [MISC_DIST.id] });
  });
  it('falls back to modelAnswer then finalAnswer', async () => {
    const free = { ...MCQ, type: 'free_response', payload: { rubric: 'r', modelAnswer: 'gravity pulls water' } } as unknown as Question;
    expect((await tasks.gradeOpen({ question: free, answerText: 'gravity pulls the water', candidateMisconceptions: [], evidence: [] })).correct).toBe(true);
    const free2 = { ...MCQ, type: 'free_response', payload: { rubric: 'r' } } as unknown as Question;
    expect((await tasks.gradeOpen({ question: free2, answerText: "the axial tilt", candidateMisconceptions: [], evidence: [] })).correct).toBe(true);
  });
});
