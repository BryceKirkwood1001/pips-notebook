import { describe, expect, it } from 'vitest';
import { RunSchema, TurnResultSchema, type StudentAnswerTurn } from '@top/shared';
import { citationMatches } from './notebook';
import { correctAnswerOf, wrongAnswerFor } from '../core/grading';
import { engine } from './index';
import { answerCorrectly, buildCtx, createDeps } from './testing/fixtures';
import { defaultCtx as ctx, newRun, playFight, teachAndReady } from './testing/play';

const wrongDontKnow = () => ({ answer: { dontKnow: true }, reasoning: 'no idea', citedNotes: [] as string[] });

describe('citationMatches', () => {
  const nb = '# Notebook\n\n## C\n- The moon causes the tides\n- Short\n';
  it('matches equal, containing and mostly-overlapping notes', () => {
    expect(citationMatches('The moon causes the tides', nb)).toBe(true);
    expect(citationMatches('- the MOON causes the tides.', nb)).toBe(true);
    expect(citationMatches('moon causes the tides', nb)).toBe(true); // contained, >= 12 chars
    expect(citationMatches('the tides are caused by the moon', nb)).toBe(false); // 3/7 words in the bullet
    expect(citationMatches('causes the moon tides the', nb)).toBe(true); // 5/5 words
  });
  it('rejects unrelated, empty and too-short containment', () => {
    expect(citationMatches('Gravity pulls things down', nb)).toBe(false);
    expect(citationMatches('', nb)).toBe(false);
    expect(citationMatches('Sh', nb)).toBe(false);
    expect(citationMatches('the', nb)).toBe(false);
    expect(citationMatches('moon moon moon', nb)).toBe(false);
    expect(citationMatches('Short', nb)).toBe(true);
  });
});

describe('room fight', () => {
  it('draws 5 questions with no repeats from the room pool only', async () => {
    const deps = createDeps();
    const run = await teachAndReady(deps, ctx, newRun(deps));
    const ids = run.room!.questionIds;
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    const byId = new Map(ctx.questions.map((q) => [q.id, q]));
    for (const id of ids) {
      expect(byId.get(id)!.verified).toBe(true);
      expect(byId.get(id)!.conceptIds.every((c) => ['c1', 'c2'].includes(c))).toBe(true);
    }
    expect(run.room).toMatchObject({ attempt: 1, hearts: 3, turn: 0 });
  });

  it('all correct passes; the last turn ends the fight', async () => {
    const deps = createDeps();
    const run = await teachAndReady(deps, ctx, newRun(deps));
    const { run: after, results } = await playFight(deps, ctx, run);
    expect(results).toHaveLength(5);
    results.forEach((r) => TurnResultSchema.parse(r));
    expect(after.phase).toBe('room_result');
    expect(after.room?.passed).toBe(true);
    expect((results[4] as StudentAnswerTurn).phaseAfter).toBe('room_result');
    expect((results[0] as StudentAnswerTurn).phaseAfter).toBe('room');
    expect(() => RunSchema.parse(after)).not.toThrow();
  });

  it('a wrong answer costs one heart; one wrong still passes; three wrong fails immediately', async () => {
    const deps = createDeps();
    const run = await teachAndReady(deps, ctx, newRun(deps));
    let n = 0;
    deps.tasks.handlers.answer = (i, o) => (n++ === 0 ? wrongDontKnow() : answerCorrectly(i, o));
    const { run: passed, results } = await playFight(deps, ctx, run);
    expect((results[0] as StudentAnswerTurn)).toMatchObject({ correct: false, damage: 1, hearts: 2 });
    expect(passed.room).toMatchObject({ passed: true, hearts: 2 });

    deps.tasks.handlers.answer = wrongDontKnow;
    const { run: failed, results: r2 } = await playFight(deps, ctx, run);
    expect(r2).toHaveLength(3);
    expect(failed.room).toMatchObject({ passed: false, hearts: 0, turn: 3 });
    expect(failed.phase).toBe('room_result');
  });

  it('room_end carries the reasoning trace and is idempotent', async () => {
    const deps = createDeps();
    deps.tasks.handlers.answer = () => ({ answer: { dontKnow: true }, reasoning: 'my reasoning', citedNotes: ['some note'] });
    const run = await teachAndReady(deps, ctx, newRun(deps));
    const { run: failed } = await playFight(deps, ctx, run);
    const a = await engine.takeTurn(deps, ctx, failed);
    const b = await engine.takeTurn(deps, ctx, a.run);
    expect(a.result).toMatchObject({ kind: 'room_end', passed: false, hearts: 0 });
    if (a.result.kind !== 'room_end') throw new Error('x');
    expect(a.result.failedTurns).toHaveLength(3);
    expect(a.result.failedTurns[0]).toMatchObject({ reasoning: 'my reasoning', citedNotes: ['some note'] });
    expect(b.result).toEqual(a.result);
    expect(b.run).toEqual(failed);
    expect(a.stats).toEqual([]);
  });

  it('retry: hearts reset, notebook kept, prefers unseen questions, learning resumes', async () => {
    const deps = createDeps();
    deps.tasks.handlers.answer = wrongDontKnow;
    const run = await teachAndReady(deps, ctx, newRun(deps));
    const { run: failed } = await playFight(deps, ctx, run);
    const { run: back } = engine.retryRoom(deps, ctx, failed);
    expect(back.phase).toBe('learning');
    expect(back.roomIndex).toBe(0);
    expect(back.notebookMd).toBe(failed.notebookMd);
    const again = engine.startRoom(deps, ctx, back).run;
    expect(again.room).toMatchObject({ attempt: 2, hearts: 3, turn: 0, log: [] });
    const first = run.room!.questionIds;
    expect(again.room!.questionIds.some((id) => first.includes(id))).toBe(false); // pool of 16 has plenty of unseen
    expect(again.room!.seenQuestionIds).toHaveLength(10);
  });

  it('retry is only for failed rooms, continue only for passed ones', async () => {
    const deps = createDeps();
    const run = await teachAndReady(deps, ctx, newRun(deps));
    const { run: passed } = await playFight(deps, ctx, run);
    expect(() => engine.retryRoom(deps, ctx, passed)).toThrowError(expect.objectContaining({ code: 'wrong_phase' }));
    deps.tasks.handlers.answer = wrongDontKnow;
    const { run: failed } = await playFight(deps, ctx, run);
    expect(() => engine.continueRun(deps, ctx, failed)).toThrowError(expect.objectContaining({ code: 'wrong_phase' }));
  });

  it('continue moves to the next room, clears the room state and learning questions', async () => {
    const deps = createDeps();
    const { run: passed } = await playFight(deps, ctx, await teachAndReady(deps, ctx, newRun(deps)));
    const { run: next } = engine.continueRun(deps, ctx, passed);
    expect(next).toMatchObject({ phase: 'learning', roomIndex: 1 });
    expect(next.room).toBeUndefined();
    expect(next.learning).toEqual({ pendingQuestions: [], teachCount: 0 });
  });

  it('ready throws room_not_ready when the room is not ready or has no questions', async () => {
    const deps = createDeps();
    const run = newRun(deps);
    const notReady = buildCtx({ pack: { ...ctx.pack, status: { stage: 'concepts', conceptsReady: [] } } });
    expect(() => engine.startRoom(deps, notReady, run)).toThrowError(expect.objectContaining({ code: 'room_not_ready' }));
    const noQs = buildCtx({ questions: [] });
    expect(() => engine.startRoom(deps, noQs, run)).toThrowError(expect.objectContaining({ code: 'room_not_ready' }));
  });
});

describe('grounding and reasons', () => {
  it('a right answer with no valid citation is wrong with "not in my notes"', async () => {
    const deps = createDeps();
    const run = await teachAndReady(deps, ctx, newRun(deps));
    deps.tasks.handlers.answer = (i, o) => ({ ...answerCorrectly(i, o), citedNotes: ['A note that is nowhere in the notebook'] });
    const { results } = await playFight(deps, ctx, run, { maxTurns: 1 });
    expect(results[0]).toMatchObject({ kind: 'student_answer', correct: false, reason: 'not in my notes', damage: 1 });
  });

  it('a right answer citing a fuzzy-matching note is correct', async () => {
    const deps = createDeps();
    const run = await teachAndReady(deps, ctx, newRun(deps));
    deps.tasks.handlers.answer = (i, o) => ({ ...answerCorrectly(i, o), citedNotes: ['note about c1 that the student wrote'] });
    const { results } = await playFight(deps, ctx, run, { maxTurns: 1 });
    expect(results[0]).toMatchObject({ correct: true, damage: 0 });
    expect((results[0] as StudentAnswerTurn).reason).toBeUndefined();
  });

  it('reason is "not in my notes" for I-don\'t-know and for an answer that does not fit the question', async () => {
    const deps = createDeps({ roomHearts: 99 });
    const run = await teachAndReady(deps, ctx, newRun(deps));
    deps.tasks.handlers.answer = wrongDontKnow;
    const a = await playFight(deps, ctx, run);
    expect(a.results.every((r) => r.kind === 'student_answer' && r.reason === 'not in my notes')).toBe(true);
    deps.tasks.handlers.answer = () => ({ answer: { choiceIndex: 99, text: 'x' }, reasoning: 'r', citedNotes: [] });
    const b = await playFight(deps, ctx, run);
    expect(b.results.every((r) => r.kind === 'student_answer' && r.reason === 'not in my notes')).toBe(true);
    expect((b.results[0] as StudentAnswerTurn).answerText).toBe("I don't know");
  });

  it('reason is "wrong belief" on a misconception path and "unknown" on any other wrong answer', async () => {
    const deps = createDeps({ roomHearts: 99 });
    const run = await teachAndReady(deps, ctx, newRun(deps));
    deps.tasks.handlers.gradeOpen = () => ({ correct: false, misconceptionIds: ['m1a'], feedback: '' });
    deps.tasks.handlers.answer = (i, o) => {
      const q = o!.question;
      const path = wrongAnswerFor(q, q.misconceptionIds[0]);
      return { answer: path ?? { text: 'some wrong text' }, reasoning: 'r', citedNotes: ['note about c1 that the student wrote'] };
    };
    const a = await playFight(deps, ctx, run);
    expect(a.results.every((r) => r.kind === 'student_answer' && !r.correct && r.reason === 'wrong belief')).toBe(true);

    // unmapped wrong option (mcq option 3), and open grading with no misconception
    const mcqOnly = buildCtx({ questions: ctx.questions.filter((q) => q.type === 'mcq' && q.conceptIds.every((c) => c !== 'c3')) });
    const run2 = await teachAndReady(deps, mcqOnly, newRun(deps, mcqOnly));
    deps.tasks.handlers.answer = () => ({ answer: { choiceIndex: 3 }, reasoning: 'r', citedNotes: ['note about c1 that the student wrote'] });
    const b = await playFight(deps, mcqOnly, run2);
    expect(b.results.every((r) => r.kind === 'student_answer' && r.reason === 'unknown')).toBe(true);
  });

  it('records stats events and gives the student only its notebook plus the public question', async () => {
    const deps = createDeps();
    const run = await teachAndReady(deps, ctx, newRun(deps));
    const out = await engine.takeTurn(deps, ctx, run);
    expect(out.stats).toEqual([{ questionId: run.room!.questionIds[0], kind: 'student_correct' }]);
    const call = deps.tasks.calls.answer[0];
    expect(Object.keys(call.input).sort()).toEqual(['notebookMd', 'question']);
    expect(call.input.notebookMd).toBe(run.notebookMd);
    expect(JSON.stringify(call.input.question)).not.toMatch(/correctIndex|misconceptionId|solution/);
    expect(call.oracle?.question.id).toBe(run.room!.questionIds[0]);
    deps.tasks.handlers.answer = wrongDontKnow;
    const wrong = await engine.takeTurn(deps, ctx, run);
    expect(wrong.stats[0].kind).toBe('student_wrong');
  });

  it('free_response and unmatched short_text go through gradeOpen with retrieved evidence', async () => {
    const free = buildCtx({ questions: ctx.questions.filter((q) => q.type === 'free_response' && q.id === 'q_c1_free1') });
    const deps = createDeps();
    const run = await teachAndReady(deps, free, newRun(deps, free));
    deps.tasks.handlers.answer = () => ({ answer: { text: 'my essay' }, reasoning: 'r', citedNotes: ['note about c1 that the student wrote'] });
    const { results } = await playFight(deps, free, run);
    expect(results[0]).toMatchObject({ correct: true });
    expect(deps.tasks.calls.gradeOpen[0].answerText).toBe('my essay');
    expect(deps.tasks.calls.gradeOpen[0].evidence).toHaveLength(1);
    deps.retriever.fail = true; // retrieval failure is not fatal
    const again = await playFight(deps, free, run);
    expect(again.results[0]).toMatchObject({ correct: true });
    expect(deps.tasks.calls.gradeOpen[1].evidence).toEqual([]);
  });
});

describe('determinism', () => {
  it('the same seed and inputs give the same run', async () => {
    const play = async () => {
      const deps = createDeps({ helpMeProb: 0.5, helpMeMaxPerRoom: 3 }, 7);
      const run = await teachAndReady(deps, ctx, newRun(deps));
      const { run: end, results } = await playFight(deps, ctx, run);
      return { end, results, rng: deps.rng.state() };
    };
    expect(await play()).toEqual(await play());
  });
});

// keep a reference so unused-import lint stays quiet if tests are trimmed
void correctAnswerOf;
