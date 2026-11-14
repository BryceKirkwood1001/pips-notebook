import { describe, expect, it } from 'vitest';
import { engine } from '../src/engine';
import type { StudentMode } from './helpers/fakes';
import { makeEnv, newRun, teach } from './helpers/play';

async function firstTurn(mode: StudentMode, teachFirst = true) {
  const env = makeEnv({ script: { mode } });
  let run = newRun(env);
  if (teachFirst) run = (await teach(env, run)).run;
  run = engine.startRoom(env.deps, env.ctx, run).run;
  const out = await engine.takeTurn(env.deps, env.ctx, run);
  if (out.result.kind !== 'student_answer') throw new Error('expected a student answer');
  return { env, out, result: out.result };
}

describe('grounding rule and turn reasons', () => {
  it('a correct, cited answer is correct and costs nothing', async () => {
    const { result } = await firstTurn('correct');
    expect(result).toMatchObject({ correct: true, damage: 0, hearts: 3 });
    expect(result.reason).toBeUndefined();
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('a correct answer with no valid citation counts as wrong: "not in my notes"', async () => {
    const { result } = await firstTurn('ungrounded');
    expect(result).toMatchObject({ correct: false, reason: 'not in my notes', damage: 1, hearts: 2 });
  });

  it('a correct answer with an empty notebook (nothing to cite) is wrong too', async () => {
    const { result } = await firstTurn('correct', false);
    expect(result).toMatchObject({ correct: false, reason: 'not in my notes' });
  });

  it('"I don\'t know" is "not in my notes"', async () => {
    const { result } = await firstTurn('dontKnow');
    expect(result).toMatchObject({ correct: false, reason: 'not in my notes', damage: 1 });
  });

  it('a plain wrong answer is "unknown"; one that follows a misconception path is "wrong belief"', async () => {
    // First room draw is seeded; find a turn whose question is an mcq so 'wrong' (option 0) maps to no belief.
    const env = makeEnv({ script: { mode: 'wrong' } });
    let run = (await teach(env, newRun(env))).run;
    run = engine.startRoom(env.deps, env.ctx, run).run;
    const reasons = new Set<string>();
    const out = await engine.takeTurn(env.deps, env.ctx, run);
    if (out.result.kind === 'student_answer' && out.result.reason) reasons.add(out.result.reason);
    expect([...reasons].every((r) => ['unknown', 'wrong belief', 'not in my notes'].includes(r))).toBe(true);

    // Belief path: skip every probe so the belief lines are in the notebook, then answer in auto mode.
    const env2 = makeEnv({ script: { mode: 'auto' } });
    let r2 = (await teach(env2, newRun(env2))).run;
    for (const q of r2.learning.pendingQuestions) r2 = engine.skipQuestion(env2.deps, env2.ctx, r2, q.id).run;
    r2 = engine.startRoom(env2.deps, env2.ctx, r2).run;
    const seen: string[] = [];
    for (let i = 0; i < 5 && r2.phase === 'room'; i++) {
      const o = await engine.takeTurn(env2.deps, env2.ctx, r2);
      r2 = o.run;
      if (o.result.kind === 'student_answer' && !o.result.correct) seen.push(o.result.reason!);
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r === 'wrong belief')).toBe(true);
  });

  it('free_response and short_text fallbacks go through gradeOpen', async () => {
    const env = makeEnv({ script: { mode: 'correct', openCorrect: true } });
    env.ctx.questions = env.ctx.questions.filter((q) => q.type === 'free_response');
    let run = (await teach(env, newRun(env))).run;
    run = engine.startRoom(env.deps, env.ctx, run).run;
    const ok = await engine.takeTurn(env.deps, env.ctx, run);
    expect(env.tasks.calls.gradeOpen).toHaveLength(1);
    expect(ok.result).toMatchObject({ kind: 'student_answer', correct: true });

    const env2 = makeEnv({ script: { mode: 'correct', openCorrect: false } });
    env2.ctx.questions = env2.ctx.questions.filter((q) => q.type === 'free_response');
    let run2 = (await teach(env2, newRun(env2))).run;
    run2 = engine.startRoom(env2.deps, env2.ctx, run2).run;
    const bad = await engine.takeTurn(env2.deps, env2.ctx, run2);
    expect(bad.result).toMatchObject({ kind: 'student_answer', correct: false });
  });

  it('records stats for each student answer', async () => {
    const { out } = await firstTurn('wrong');
    expect(out.stats).toEqual([expect.objectContaining({ kind: 'student_wrong' })]);
    const ok = await firstTurn('correct');
    expect(ok.out.stats).toEqual([expect.objectContaining({ kind: 'student_correct' })]);
  });
});
