import { describe, expect, it } from 'vitest';
import { engine, notebookLines } from '../src/engine';
import { belief, correction, conceptTitle } from './helpers/fixtures';
import { EXPLAIN, makeEnv, newRun, skipAll, teach } from './helpers/play';

const state = (run: { hidden: { misconceptions: unknown[] } }, id: string) =>
  (run.hidden.misconceptions as { id: string; status: string; origin: string }[]).find((m) => m.id === id);

describe('learning phase', () => {
  it('a new run starts in learning with an empty notebook', () => {
    const run = newRun(makeEnv());
    expect(run).toMatchObject({ phase: 'learning', roomIndex: 0, notebookMd: '# Notebook\n' });
    expect(run.scope.roomIds).toEqual(['r1', 'r2', 'r3']);
  });

  it('teach writes notes under the concept heading and returns open questions', async () => {
    const env = makeEnv();
    const { run, questions } = await teach(env, newRun(env));
    expect(run.notebookMd).toContain(`## ${conceptTitle(1)}`);
    expect(notebookLines(run.notebookMd).length).toBeGreaterThan(0);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((q) => q.status === 'open')).toBe(true);
    expect(JSON.stringify(questions)).not.toContain('misconceptionId');
  });

  it('a skip makes the misconception active and writes the belief as a plain bullet', async () => {
    const env = makeEnv();
    let run = (await teach(env, newRun(env))).run;
    const q = run.learning.pendingQuestions[0];
    run = engine.skipQuestion(env.deps, env.ctx, run, q.id).run;
    expect(state(run, q.misconceptionId)).toMatchObject({ status: 'active', origin: 'skipped' });
    expect(notebookLines(run.notebookMd)).toContain(belief(q.misconceptionId));
    expect(run.notebookMd).toContain(`- ${belief(q.misconceptionId)}\n`.trimEnd());
    expect(run.notebookMd.toLowerCase()).not.toContain('misconception');
    expect(run.learning.pendingQuestions.find((x) => x.id === q.id)!.status).toBe('skipped');
  });

  it('an answer that resolves adds the corrective note and no belief line', async () => {
    const env = makeEnv();
    let run = (await teach(env, newRun(env))).run;
    const q = run.learning.pendingQuestions[0];
    const out = await engine.answerQuestion(env.deps, env.ctx, run, q.id, 'it is actually different');
    run = out.run;
    expect(out.resolved).toBe(true);
    expect(state(run, q.misconceptionId)).toMatchObject({ status: 'resolved' });
    expect(notebookLines(run.notebookMd)).toContain(correction(q.misconceptionId));
    expect(notebookLines(run.notebookMd)).not.toContain(belief(q.misconceptionId));
    expect(run.learning.pendingQuestions.find((x) => x.id === q.id)!.status).toBe('answered');
  });

  it('a failed answer behaves like a skip', async () => {
    const env = makeEnv({ script: { resolves: false } });
    let run = (await teach(env, newRun(env))).run;
    const q = run.learning.pendingQuestions[0];
    const out = await engine.answerQuestion(env.deps, env.ctx, run, q.id, 'no idea');
    expect(out.resolved).toBe(false);
    expect(state(out.run, q.misconceptionId)).toMatchObject({ status: 'active', origin: 'skipped' });
    expect(notebookLines(out.run.notebookMd)).toContain(belief(q.misconceptionId));
  });

  it('a stated misconception becomes active with origin stated', async () => {
    const env = makeEnv({ script: { review: () => ({ statedMisconceptionIds: ['m1b'], questions: [] }) } });
    const { run } = await teach(env, newRun(env), `${belief('m1b')}. Also this.`);
    expect(state(run, 'm1b')).toMatchObject({ status: 'active', origin: 'stated' });
    expect(notebookLines(run.notebookMd)).toContain(belief('m1b'));
  });

  it('re-teaching resolves an active misconception and replaces the belief line', async () => {
    const env = makeEnv();
    let run = (await teach(env, newRun(env))).run;
    run = skipAll(env, run);
    const id = 'm1a';
    expect(notebookLines(run.notebookMd)).toContain(belief(id));
    env.tasks.review = () => ({ resolvedMisconceptionIds: [id], questions: [] });
    run = (await teach(env, run, 'Now the correct idea is explained well here.')).run;
    expect(state(run, id)).toMatchObject({ status: 'resolved' });
    expect(notebookLines(run.notebookMd)).toContain(correction(id));
    expect(notebookLines(run.notebookMd)).not.toContain(belief(id));
  });

  it('an inactive id in resolvedMisconceptionIds is ignored; invented question ids are dropped', async () => {
    const env = makeEnv({ script: { review: () => ({ resolvedMisconceptionIds: ['m1a'], questions: [{ misconceptionId: 'nope', text: 'Why?' }, { misconceptionId: 'm3a', text: 'Other room?' }] }) } });
    const { run, questions } = await teach(env, newRun(env));
    expect(state(run, 'm1a')).toBeUndefined();
    expect(questions).toHaveLength(0);
  });

  it('ignores notes for concepts outside the current room', async () => {
    const env = makeEnv({ script: { review: () => ({ notesToAdd: [{ conceptId: 'c3', text: 'A note for another room' }], questions: [] }) } });
    const { run } = await teach(env, newRun(env));
    expect(run.notebookMd).not.toContain('another room');
  });

  it('open questions are auto-skipped at ready', async () => {
    const env = makeEnv();
    let run = (await teach(env, newRun(env))).run;
    const open = run.learning.pendingQuestions.filter((q) => q.status === 'open');
    expect(open.length).toBeGreaterThan(0);
    run = engine.startRoom(env.deps, env.ctx, run).run;
    expect(run.phase).toBe('room');
    for (const q of open) expect(state(run, q.misconceptionId)).toMatchObject({ status: 'active', origin: 'skipped' });
  });

  it('asks at most MAX_STUDENT_QUESTIONS questions, counting the ones still open', async () => {
    const env = makeEnv({ config: { maxStudentQuestions: 1 } });
    let { run, questions } = await teach(env, newRun(env));
    expect(questions.filter((q) => q.status === 'open')).toHaveLength(1);
    expect(env.tasks.calls.review[0].maxQuestions).toBe(1);
    ({ run, questions } = await teach(env, run, EXPLAIN + ' More words follow here too.'));
    expect(env.tasks.calls.review[1].maxQuestions).toBe(0);
    expect(questions.filter((q) => q.status === 'open')).toHaveLength(1);
  });

  it('a misconception is probed at most once per run', async () => {
    const env = makeEnv();
    let run = (await teach(env, newRun(env))).run;
    const asked = run.learning.pendingQuestions.map((q) => q.misconceptionId);
    run = skipAll(env, run);
    await teach(env, run, 'A second explanation with enough words.');
    const second = env.tasks.calls.review[1].probeableMisconceptionIds;
    for (const id of asked) expect(second).not.toContain(id);
  });

  it('actions in the wrong phase and unknown question ids are rejected', async () => {
    const env = makeEnv();
    const run = (await teach(env, newRun(env))).run;
    expect(() => engine.skipQuestion(env.deps, env.ctx, run, 'nope')).toThrowError(expect.objectContaining({ code: 'not_found' }));
    const q = run.learning.pendingQuestions[0];
    const done = engine.skipQuestion(env.deps, env.ctx, run, q.id).run;
    expect(() => engine.skipQuestion(env.deps, env.ctx, done, q.id)).toThrowError(expect.objectContaining({ code: 'question_not_open' }));
    const inRoom = engine.startRoom(env.deps, env.ctx, done).run;
    await expect(teach(env, inRoom)).rejects.toMatchObject({ code: 'wrong_phase' });
    expect(() => engine.startRoom(env.deps, env.ctx, inRoom)).toThrowError(expect.objectContaining({ code: 'wrong_phase' }));
  });
});
