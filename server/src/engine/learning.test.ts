import { describe, expect, it } from 'vitest';
import type { Run } from '@top/shared';
import { engine, notebookLines, parseNotebook } from './index';
import { buildCtx, createDeps } from './testing/fixtures';

const ctx = buildCtx();
const newRun = (deps = createDeps()): Run =>
  engine.createRun(deps, ctx, { courseId: 'course1', targetGrade: 'B', rngSeed: 1, id: 'run1' });

describe('createRun', () => {
  it('starts in learning at room 0 with an empty notebook and a schema-valid shape', () => {
    const run = newRun();
    expect(run.phase).toBe('learning');
    expect(run.roomIndex).toBe(0);
    expect(run.notebookMd).toBe('# Notebook\n');
    expect(run.scope.roomIds).toEqual(['r1', 'r2']);
    expect(run.rngState).toBe(run.rngSeed);
  });
  it('throws room_not_ready when the first room is not ready or has no questions', () => {
    const deps = createDeps();
    const notReady = buildCtx({ pack: { ...ctx.pack, status: { stage: 'concepts', conceptsReady: ['c1'] } } });
    expect(() => engine.createRun(deps, notReady, { courseId: 'course1', targetGrade: 'B' })).toThrow(/still being prepared/);
    const noQs = buildCtx({ questions: [] });
    expect(() => engine.createRun(deps, noQs, { courseId: 'course1', targetGrade: 'B' })).toThrowError(
      expect.objectContaining({ code: 'room_not_ready' }),
    );
  });
  it('throws not_found for an unknown room', () => {
    expect(() =>
      engine.createRun(createDeps(), ctx, { courseId: 'course1', targetGrade: 'B', scope: { roomIds: ['nope'] } }),
    ).toThrowError(expect.objectContaining({ code: 'not_found' }));
  });
});

describe('teach', () => {
  it('adds notes under the right section, in scope order, without duplicates', async () => {
    const deps = createDeps();
    deps.tasks.handlers.review = () => ({
      notesToAdd: [
        { conceptId: 'c2', text: 'two note' },
        { conceptId: 'c1', text: 'one note' },
        { conceptId: 'c1', text: 'one note' },
        { conceptId: 'c3', text: 'wrong room' },
      ],
      statedMisconceptionIds: [],
      questions: [],
      resolvedMisconceptionIds: [],
    });
    const run = newRun(deps);
    const { run: after } = await engine.teach(deps, ctx, run, 'explanation');
    expect(parseNotebook(after.notebookMd)).toEqual([
      { title: 'Concept 1', notes: ['one note'] },
      { title: 'Concept 2', notes: ['two note'] },
    ]);
    expect(run.notebookMd).toBe('# Notebook\n'); // input not mutated
    expect(after.learning.teachCount).toBe(1);
  });

  it('a stated misconception becomes active (origin stated) with its belief line', async () => {
    const deps = createDeps();
    deps.tasks.handlers.review = () => ({ notesToAdd: [], statedMisconceptionIds: ['m1a', 'bogus', 'm3a'], questions: [], resolvedMisconceptionIds: [] });
    const { run } = await engine.teach(deps, ctx, newRun(deps), 'x');
    expect(run.hidden.misconceptions).toEqual([{ id: 'm1a', conceptId: 'c1', status: 'active', origin: 'stated' }]);
    expect(notebookLines(run.notebookMd)).toEqual(['Belief 1a is true']);
  });

  it('adds questions, drops invented ids, never probes twice, and caps by open questions', async () => {
    const deps = createDeps({ maxStudentQuestions: 3 });
    let batch = [
      { misconceptionId: 'm1a', text: 'Q1?' },
      { misconceptionId: 'nope', text: 'invented' },
      { misconceptionId: 'm3a', text: 'wrong room' },
      { misconceptionId: 'm1a', text: 'dup' },
      { misconceptionId: 'm1b', text: 'Q2?' },
    ];
    deps.tasks.handlers.review = () => ({ notesToAdd: [], statedMisconceptionIds: [], questions: batch, resolvedMisconceptionIds: [] });
    const r1 = await engine.teach(deps, ctx, newRun(deps), 'x');
    expect(r1.questions.map((q) => q.text)).toEqual(['Q1?', 'Q2?']);
    expect(JSON.stringify(r1.questions)).not.toContain('misconceptionId');

    // second teach: open questions stay open; maxQuestions = 3 - 2 open = 1; asked ones are not probeable
    batch = [
      { misconceptionId: 'm1a', text: 'again' },
      { misconceptionId: 'm2a', text: 'Q3?' },
      { misconceptionId: 'm2b', text: 'Q4?' },
    ];
    const r2 = await engine.teach(deps, ctx, r1.run, 'y');
    expect(deps.tasks.calls.review[1].maxQuestions).toBe(1);
    expect(r2.questions.map((q) => q.text)).toEqual(['Q1?', 'Q2?', 'Q3?']);
    expect(r2.questions.every((q) => q.status === 'open')).toBe(true);
  });

  it('a misconception stated in the same call is not also probed', async () => {
    const deps = createDeps();
    deps.tasks.handlers.review = () => ({
      notesToAdd: [],
      statedMisconceptionIds: ['m1a'],
      questions: [{ misconceptionId: 'm1a', text: 'should drop' }],
      resolvedMisconceptionIds: [],
    });
    const { questions } = await engine.teach(deps, ctx, newRun(deps), 'x');
    expect(questions).toEqual([]);
  });

  it('re-teaching resolves an active misconception and replaces its belief line', async () => {
    const deps = createDeps();
    deps.tasks.handlers.review = () => ({ notesToAdd: [], statedMisconceptionIds: ['m1a'], questions: [], resolvedMisconceptionIds: [] });
    const first = await engine.teach(deps, ctx, newRun(deps), 'x');
    deps.tasks.handlers.review = () => ({ notesToAdd: [], statedMisconceptionIds: [], questions: [], resolvedMisconceptionIds: ['m1a', 'm1b'] });
    const second = await engine.teach(deps, ctx, first.run, 'y');
    expect(second.run.hidden.misconceptions[0].status).toBe('resolved');
    expect(second.run.hidden.misconceptions).toHaveLength(1); // m1b was not active: dropped
    expect(notebookLines(second.run.notebookMd)).toEqual(['Actually 1a is false']);
  });

  it('stating a previously resolved belief reactivates it, even if the review also claims resolution', async () => {
    const deps = createDeps();
    const run = newRun(deps);
    run.hidden.misconceptions.push({ id: 'm1a', conceptId: 'c1', status: 'resolved', origin: 'skipped' });
    deps.tasks.handlers.review = () => ({ notesToAdd: [], statedMisconceptionIds: ['m1a'], questions: [], resolvedMisconceptionIds: ['m1a'] });
    const { run: after } = await engine.teach(deps, ctx, run, 'Belief 1a is true');
    expect(after.hidden.misconceptions).toEqual([{ id: 'm1a', conceptId: 'c1', status: 'active', origin: 'stated' }]);
    expect(notebookLines(after.notebookMd)).toContain('Belief 1a is true');
    expect(run.hidden.misconceptions[0].status).toBe('resolved');
  });
});

describe('answer and skip', () => {
  async function withQuestions() {
    const deps = createDeps();
    deps.tasks.handlers.review = () => ({
      notesToAdd: [],
      statedMisconceptionIds: [],
      questions: [
        { misconceptionId: 'm1a', text: 'Q1?' },
        { misconceptionId: 'm1b', text: 'Q2?' },
        { misconceptionId: 'm2a', text: 'Q3?' },
      ],
      resolvedMisconceptionIds: [],
    });
    const { run } = await engine.teach(deps, ctx, newRun(deps), 'x');
    return { deps, run };
  }

  it('a good answer resolves it and adds the corrective note (retrieval is grounded)', async () => {
    const { deps, run } = await withQuestions();
    deps.tasks.handlers.resolution = () => ({ resolved: true, noteToAdd: 'Seasons come from tilt', why: '' });
    const { run: after, resolved } = await engine.answerQuestion(deps, ctx, run, run.learning.pendingQuestions[0].id, 'tilt');
    expect(resolved).toBe(true);
    expect(after.hidden.misconceptions[0]).toMatchObject({ id: 'm1a', status: 'resolved' });
    expect(notebookLines(after.notebookMd)).toEqual(['Seasons come from tilt']);
    expect(after.learning.pendingQuestions[0].status).toBe('answered');
    expect(deps.retriever.queries[0]).toMatchObject({ courseId: 'course1', conceptIds: ['c1'] });
  });

  it('a bad answer behaves like a skip, even if retrieval throws', async () => {
    const { deps, run } = await withQuestions();
    deps.retriever.fail = true;
    deps.tasks.handlers.resolution = () => ({ resolved: false, noteToAdd: '', why: '' });
    const { run: after, resolved } = await engine.answerQuestion(deps, ctx, run, run.learning.pendingQuestions[0].id, 'dunno');
    expect(resolved).toBe(false);
    expect(after.hidden.misconceptions[0]).toEqual({ id: 'm1a', conceptId: 'c1', status: 'active', origin: 'skipped' });
    expect(notebookLines(after.notebookMd)).toEqual(['Belief 1a is true']);
    expect(deps.tasks.calls.resolution[0].evidence).toEqual([]);
  });

  it('skipping makes it active with origin skipped and writes the belief line', async () => {
    const { deps, run } = await withQuestions();
    const { run: after } = engine.skipQuestion(deps, ctx, run, run.learning.pendingQuestions[1].id);
    expect(after.hidden.misconceptions).toEqual([{ id: 'm1b', conceptId: 'c1', status: 'active', origin: 'skipped' }]);
    expect(notebookLines(after.notebookMd)).toEqual(['Belief 1b is true']);
    expect(after.learning.pendingQuestions[1].status).toBe('skipped');
  });

  it('rejects answering twice and unknown ids', async () => {
    const { deps, run } = await withQuestions();
    const id = run.learning.pendingQuestions[0].id;
    const { run: after } = engine.skipQuestion(deps, ctx, run, id);
    expect(() => engine.skipQuestion(deps, ctx, after, id)).toThrowError(expect.objectContaining({ code: 'question_not_open' }));
    await expect(engine.answerQuestion(deps, ctx, after, id, 'a')).rejects.toMatchObject({ code: 'question_not_open' });
    expect(() => engine.skipQuestion(deps, ctx, after, 'zzz')).toThrowError(expect.objectContaining({ code: 'not_found' }));
  });

  it('ready auto-skips open questions (open questions only) and draws the room', async () => {
    const { deps, run } = await withQuestions();
    const { run: after } = engine.startRoom(deps, ctx, run);
    expect(after.phase).toBe('room');
    expect(after.learning.pendingQuestions.every((q) => q.status === 'skipped')).toBe(true);
    // Q3 probed m2a (concept 2 is in room 1)
    expect(after.hidden.misconceptions.map((m) => m.id).sort()).toEqual(['m1a', 'm1b', 'm2a']);
    expect(after.hidden.misconceptions.every((m) => m.origin === 'skipped' && m.status === 'active')).toBe(true);
    expect(after.room?.questionIds).toHaveLength(5);
  });
});
