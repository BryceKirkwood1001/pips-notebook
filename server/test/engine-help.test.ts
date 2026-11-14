import { describe, expect, it } from 'vitest';
import { engine, notebookLines } from '../src/engine';
import { wrongAnswerFor } from '../src/core/grading';
import { constRng } from './helpers/fakes';
import { keyFor, makeEnv, newRun, passRoom, teach, type Env } from './helpers/play';

const helpConfig = { helpMeProb: 1, helpMeMaxPerRoom: 1, helpMeMaxPerBoss: 2 };

async function helpTurn(o: Parameters<typeof makeEnv>[0] = {}) {
  const env = makeEnv({ rng: constRng(0), ...o, config: { ...helpConfig, ...o.config }, script: { mode: 'correct', ...o.script } });
  let run = (await teach(env, newRun(env))).run;
  run = engine.startRoom(env.deps, env.ctx, run).run;
  const out = await engine.takeTurn(env.deps, env.ctx, run);
  if (out.result.kind !== 'help_me') throw new Error('expected help_me, got ' + out.result.kind);
  return { env, run: out.run, ev: out.result };
}
const question = (env: Env, id: string) => env.ctx.questions.find((q) => q.id === id)!;

describe('"Help me!"', () => {
  it('offers the question with its budget and a deadline = now + budget', async () => {
    const { env, run, ev } = await helpTurn();
    expect(ev.timeBudgetSec).toBe(question(env, ev.question.id).timeBudgetSec);
    expect(new Date(ev.deadline!).getTime()).toBe(env.clock.now().getTime() + ev.timeBudgetSec * 1000);
    expect(run.pendingHelpMe).toMatchObject({ eventId: ev.eventId, questionId: ev.question.id });
    expect(JSON.stringify(ev)).not.toContain('correctIndex');
  });

  it('applies HELP_ME_TIME_MULTIPLIER', async () => {
    const { env, ev } = await helpTurn({ config: { helpMeTimeMultiplier: 0.5 } });
    const full = question(env, ev.question.id).timeBudgetSec;
    expect(Math.abs(ev.timeBudgetSec - full * 0.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(new Date(ev.deadline!).getTime() - env.clock.now().getTime() - full * 500)).toBeLessThanOrEqual(1000);
  });

  it('correct: no damage, the "Teacher showed me:" note, solve time recorded', async () => {
    const { env, run, ev } = await helpTurn();
    env.clock.advance(12);
    const out = await engine.submitHelp(env.deps, env.ctx, run, ev.eventId, keyFor(env, ev.question.id));
    expect(out.result).toMatchObject({ kind: 'help_result', correct: true, late: false, damage: 0, hearts: 3, solveTimeSec: 12 });
    if (out.result.kind !== 'help_result') throw new Error();
    expect(out.result.noteAdded).toMatch(/^Teacher showed me: /);
    expect(notebookLines(out.run.notebookMd)).toContain(out.result.noteAdded!.replace(/^- /, ''));
    expect(out.run.pendingHelpMe).toBeUndefined();
    expect(out.stats).toEqual([{ questionId: ev.question.id, kind: 'help_solve', solveTimeSec: 12 }]);
  });

  it('wrong: damage like a wrong student answer, no note', async () => {
    const { env, run, ev } = await helpTurn();
    const q = question(env, ev.question.id);
    const wrong = wrongAnswerFor(q, q.misconceptionIds[0])!;
    const out = await engine.submitHelp(env.deps, env.ctx, run, ev.eventId, wrong);
    expect(out.result).toMatchObject({ kind: 'help_result', correct: false, late: false, damage: 1, hearts: 2 });
    expect((out.result as { noteAdded?: string }).noteAdded).toBeUndefined();
    expect(out.stats.every((s) => s.kind !== 'help_solve')).toBe(true);
  });

  it('late: damage even with the right answer', async () => {
    const { env, run, ev } = await helpTurn();
    env.clock.advance(ev.timeBudgetSec + 1);
    const out = await engine.submitHelp(env.deps, env.ctx, run, ev.eventId, keyFor(env, ev.question.id));
    expect(out.result).toMatchObject({ kind: 'help_result', correct: false, late: true, damage: 1, hearts: 2 });
    expect(out.stats.every((s) => s.kind !== 'help_solve')).toBe(true);
  });

  it('untimed mode: no deadline and a late answer is impossible', async () => {
    const { env, run, ev } = await helpTurn({ config: { helpMeTimed: false } });
    expect(ev.deadline).toBeNull();
    expect(ev.timeBudgetSec).toBeGreaterThan(0);
    env.clock.advance(100000);
    const out = await engine.submitHelp(env.deps, env.ctx, run, ev.eventId, keyFor(env, ev.question.id));
    expect(out.result).toMatchObject({ correct: true, late: false, damage: 0 });
  });

  it('an unanswered, unexpired event is returned again by /turn; an expired one resolves late', async () => {
    const { env, run, ev } = await helpTurn();
    env.clock.advance(1);
    const again = await engine.takeTurn(env.deps, env.ctx, run);
    expect(again.result).toMatchObject({ kind: 'help_me', eventId: ev.eventId });
    env.clock.advance(ev.timeBudgetSec + 5);
    const late = await engine.takeTurn(env.deps, env.ctx, again.run);
    expect(late.result).toMatchObject({ kind: 'help_result', correct: false, late: true, damage: 1 });
    expect(late.run.pendingHelpMe).toBeUndefined();
  });

  it('a second submit for the same event, or an unknown event id, is rejected', async () => {
    const { env, run, ev } = await helpTurn();
    const first = await engine.submitHelp(env.deps, env.ctx, run, ev.eventId, keyFor(env, ev.question.id));
    await expect(engine.submitHelp(env.deps, env.ctx, first.run, ev.eventId, keyFor(env, ev.question.id))).rejects.toMatchObject({ code: 'help_event_not_pending' });
    const b = await helpTurn();
    await expect(engine.submitHelp(b.env.deps, b.env.ctx, b.run, 'nope', {})).rejects.toMatchObject({ code: 'help_event_not_pending' });
  });

  it('a malformed answer is invalid_answer', async () => {
    const { env, run, ev } = await helpTurn();
    await expect(engine.submitHelp(env.deps, env.ctx, run, ev.eventId, { text: 'wrong field for this type' })).rejects.toMatchObject({ code: 'invalid_answer' });
  });

  it('other actions are blocked while an event is pending', async () => {
    const { env, run } = await helpTurn();
    expect(() => engine.startRoom(env.deps, env.ctx, run)).toThrow();
    expect(() => engine.retryRoom(env.deps, env.ctx, run)).toThrow();
  });

  it('caps: at most 1 per room', async () => {
    const { env, run, ev } = await helpTurn();
    let r = (await engine.submitHelp(env.deps, env.ctx, run, ev.eventId, keyFor(env, ev.question.id))).run;
    const kinds: string[] = [];
    for (let i = 0; i < 4 && r.phase === 'room'; i++) {
      const o = await engine.takeTurn(env.deps, env.ctx, r);
      r = o.run;
      kinds.push(o.result.kind);
    }
    expect(kinds.every((k) => k === 'student_answer')).toBe(true);
    expect(r.room!.helpMeUsed).toBe(1);
  });

  it('caps: at most 2 in the boss', async () => {
    const env = makeEnv({ rng: constRng(0), config: { ...helpConfig, helpMeProb: 0 }, script: { mode: 'correct' } });
    let run = newRun(env);
    for (let i = 0; i < 3; i++) run = await passRoom(env, run);
    env.config.helpMeProb = 1;
    let helps = 0;
    for (let i = 0; i < 40 && run.phase === 'boss'; i++) {
      const o = await engine.takeTurn(env.deps, env.ctx, run);
      run = o.run;
      if (o.result.kind === 'help_me') {
        helps++;
        run = (await engine.submitHelp(env.deps, env.ctx, run, o.result.eventId, keyFor(env, o.result.question.id))).run;
      }
    }
    expect(helps).toBe(2);
    expect(run.results!.helpMe).toMatchObject({ offered: 2, correct: 2, wrong: 0, late: 0 });
  });

  it('never picks a free_response question', async () => {
    const env = makeEnv({ rng: constRng(0), config: helpConfig, script: { mode: 'correct' } });
    env.ctx.questions = env.ctx.questions.filter((q) => q.type === 'free_response');
    let run = (await teach(env, newRun(env))).run;
    run = engine.startRoom(env.deps, env.ctx, run).run;
    const out = await engine.takeTurn(env.deps, env.ctx, run);
    expect(out.result.kind).toBe('student_answer');
  });

  it('does not roll when the probability is 0', async () => {
    const env = makeEnv({ rng: constRng(0), config: { helpMeProb: 0 }, script: { mode: 'correct' } });
    let run = (await teach(env, newRun(env))).run;
    run = engine.startRoom(env.deps, env.ctx, run).run;
    expect((await engine.takeTurn(env.deps, env.ctx, run)).result.kind).toBe('student_answer');
  });
});
