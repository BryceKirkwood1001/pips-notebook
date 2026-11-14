import { describe, expect, it } from 'vitest';
import { engine, notebookLines } from '../src/engine';
import { findHiddenKeys } from './helpers/leaks';
import { makeEnv, newRun, passRoom, playFight, teach } from './helpers/play';

async function inRoom(env: ReturnType<typeof makeEnv>) {
  let run = newRun(env);
  run = (await teach(env, run)).run;
  return engine.startRoom(env.deps, env.ctx, run).run;
}

describe('mini room', () => {
  it('draws ROOM_QUESTIONS distinct verified questions from inside the room', async () => {
    const env = makeEnv();
    const run = await inRoom(env);
    const ids = run.room!.questionIds;
    expect(run.room).toMatchObject({ attempt: 1, hearts: 3, turn: 0 });
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) {
      const q = env.ctx.questions.find((x) => x.id === id)!;
      expect(q.verified).toBe(true);
      expect(q.conceptIds.every((c) => c === 'c1')).toBe(true);
    }
  });

  it('passes with all answers right: no damage, hearts stay full', async () => {
    const env = makeEnv({ script: { mode: 'correct' } });
    const { run, turns } = await playFight(env, await inRoom(env));
    expect(run.phase).toBe('room_result');
    expect(run.room).toMatchObject({ passed: true, hearts: 3 });
    expect(turns.filter((t) => t.kind === 'student_answer')).toHaveLength(5);
    const end = await engine.takeTurn(env.deps, env.ctx, run);
    expect(end.result).toMatchObject({ kind: 'room_end', passed: true, hearts: 3 });
  });

  it('passes with 2 wrong answers (1 heart left)', async () => {
    const env = makeEnv();
    let run = await inRoom(env);
    for (let i = 0; i < 5; i++) {
      env.tasks.mode = i < 2 ? 'wrong' : 'correct';
      const out = await engine.takeTurn(env.deps, env.ctx, run);
      run = out.run;
    }
    expect(run.room).toMatchObject({ passed: true, hearts: 1 });
  });

  it('fails at 0 hearts, before the questions run out, with a reasoning trace', async () => {
    const env = makeEnv({ script: { mode: 'wrong' } });
    const { run, turns } = await playFight(env, await inRoom(env));
    expect(turns).toHaveLength(3);
    expect(turns[2]).toMatchObject({ kind: 'student_answer', correct: false, hearts: 0, phaseAfter: 'room_result' });
    expect(run.room).toMatchObject({ passed: false, hearts: 0 });
    const end = await engine.takeTurn(env.deps, env.ctx, run);
    expect(end.result.kind).toBe('room_end');
    if (end.result.kind !== 'room_end') throw new Error();
    expect(end.result.passed).toBe(false);
    expect(end.result.failedTurns).toHaveLength(3);
    for (const f of end.result.failedTurns) {
      expect(f.reasoning.length).toBeGreaterThan(0);
      expect(f.citedNotes.length).toBeGreaterThan(0);
    }
    expect(findHiddenKeys(end.result)).toEqual([]);
  });

  it('retry: hearts reset, fresh questions first, no repeats, notebook kept, still room 1', async () => {
    const env = makeEnv({ script: { mode: 'wrong' } });
    let run = (await playFight(env, await inRoom(env))).run;
    const first = [...run.room!.questionIds];
    const notesBefore = notebookLines(run.notebookMd);
    run = engine.retryRoom(env.deps, env.ctx, run).run;
    expect(run.phase).toBe('learning');
    expect(run.roomIndex).toBe(0);
    expect(notebookLines(run.notebookMd)).toEqual(notesBefore);
    run = engine.startRoom(env.deps, env.ctx, run).run;
    expect(run.room).toMatchObject({ attempt: 2, hearts: 3 });
    const second = run.room!.questionIds;
    expect(new Set(second).size).toBe(second.length);
    expect(second.filter((id) => first.includes(id))).toEqual([]); // 11 in the pool, 5 seen
    for (const id of first) expect(run.room!.seenQuestionIds).toContain(id);
  });

  it('rooms never change the grade: failing then passing room 1 still leaves a perfect boss at 100', async () => {
    const env = makeEnv({ script: { mode: 'wrong' } });
    let run = (await playFight(env, await inRoom(env))).run;
    env.tasks.mode = 'correct';
    run = engine.retryRoom(env.deps, env.ctx, run).run;
    run = await passRoom(env, run);
    run = await passRoom(env, run);
    run = await passRoom(env, run);
    expect(run.phase).toBe('boss');
    expect(run.boss!.health).toBe(100);
  });

  it('retry only after a failed room, continue only after a passed one', async () => {
    const env = makeEnv({ script: { mode: 'correct' } });
    const passed = (await playFight(env, await inRoom(env))).run;
    expect(() => engine.retryRoom(env.deps, env.ctx, passed)).toThrowError(expect.objectContaining({ code: 'wrong_phase' }));
    const failedEnv = makeEnv({ script: { mode: 'wrong' } });
    const failed = (await playFight(failedEnv, await inRoom(failedEnv))).run;
    expect(() => engine.continueRun(failedEnv.deps, failedEnv.ctx, failed)).toThrowError(expect.objectContaining({ code: 'wrong_phase' }));
  });

  it('room_end is idempotent', async () => {
    const env = makeEnv({ script: { mode: 'correct' } });
    const run = (await playFight(env, await inRoom(env))).run;
    const a = await engine.takeTurn(env.deps, env.ctx, run);
    const b = await engine.takeTurn(env.deps, env.ctx, a.run);
    expect(b.result).toEqual(a.result);
    expect(b.run.room).toEqual(run.room);
  });

  it('rejects a room that is not ready (425) and an unknown room id (404)', () => {
    const env = makeEnv();
    env.ctx.pack.status.conceptsReady = ['c2', 'c3'];
    expect(() => newRun(env)).toThrowError(expect.objectContaining({ code: 'room_not_ready' }));
    const env2 = makeEnv();
    expect(() => newRun(env2, { scope: { roomIds: ['r9'] } })).toThrowError(expect.objectContaining({ code: 'not_found' }));
  });
});
