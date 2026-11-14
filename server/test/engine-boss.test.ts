import { describe, expect, it } from 'vitest';
import { ResultsSchema, type Run } from '@top/shared';
import { targetsMisconception } from '../src/core/grading';
import { engine } from '../src/engine';
import { makeEnv, newRun, passRoom, playFight, teach, toBoss, skipAll, type Env } from './helpers/play';
import { findHiddenKeys } from './helpers/leaks';

/** Plays the boss with the first `wrong` questions answered wrong. */
async function playBoss(env: Env, run: Run, wrong: number) {
  for (let i = 0; i < 100 && run.phase === 'boss'; i++) {
    env.tasks.mode = i < wrong ? 'wrong' : 'correct';
    run = (await engine.takeTurn(env.deps, env.ctx, run)).run;
  }
  expect(run.phase).toBe('results');
  return run;
}

async function bossEnv(config: Parameters<typeof makeEnv>[0] = {}, input: Parameters<typeof newRun>[1] = {}) {
  const env = makeEnv({ ...config, script: { mode: 'correct' } });
  const run = await toBoss(env, newRun(env, input));
  return { env, run };
}

describe('boss scoring and grade thresholds', () => {
  it.each([
    [0, 100, 'A'], [1, 90, 'A-'], [2, 80, 'B-'], [3, 70, 'C-'], [4, 60, 'D'], [5, 50, 'F'], [10, 0, 'F'],
  ])('10 questions, %i wrong -> %i%% (%s)', async (wrong, pct, letter) => {
    const { env, run } = await bossEnv();
    expect(run.boss!.questionIds).toHaveLength(10);
    const end = await playBoss(env, run, wrong);
    expect(end.results).toMatchObject({ predictedGradePct: pct, letter });
    expect(Number.isInteger(end.results!.predictedGradePct)).toBe(true);
    expect(ResultsSchema.safeParse(end.results).success).toBe(true);
  });

  it('6 questions are worth 100/6 each and the grade is rounded', async () => {
    const { env, run } = await bossEnv({ config: { bossQuestions: 6 } });
    expect(run.boss!.questionIds).toHaveLength(6);
    const one = await playBoss(env, run, 1);
    expect(one.results).toMatchObject({ predictedGradePct: 83, letter: 'B' }); // 83.33
    const two = await bossEnv({ config: { bossQuestions: 6 } });
    expect((await playBoss(two.env, two.run, 2)).results).toMatchObject({ predictedGradePct: 67, letter: 'D' });
    const three = await bossEnv({ config: { bossQuestions: 6 } });
    expect((await playBoss(three.env, three.run, 3)).results).toMatchObject({ predictedGradePct: 50, letter: 'F' });
  });

  it('health drops by 100/N per wrong answer on the turn result', async () => {
    const { env, run } = await bossEnv();
    env.tasks.mode = 'wrong';
    const out = await engine.takeTurn(env.deps, env.ctx, run);
    expect(out.result).toMatchObject({ kind: 'student_answer', damage: 10, health: 90, phaseAfter: 'boss' });
  });

  it('metTarget compares against the target threshold (inclusive)', async () => {
    const a = await bossEnv({}, { targetGrade: 'A-' });
    expect((await playBoss(a.env, a.run, 1)).results).toMatchObject({ predictedGradePct: 90, target: 'A-', metTarget: true });
    const b = await bossEnv({}, { targetGrade: 'A' });
    expect((await playBoss(b.env, b.run, 1)).results).toMatchObject({ letter: 'A-', metTarget: false });
    const c = await bossEnv({}, { targetGrade: 'D' });
    expect((await playBoss(c.env, c.run, 4)).results).toMatchObject({ predictedGradePct: 60, metTarget: true });
  });

  it('honours custom GRADE_THRESHOLDS', async () => {
    const thresholds = { A: 95, 'A-': 91, 'B+': 88, B: 83, 'B-': 80, 'C+': 77, C: 73, 'C-': 70, D: 55 };
    const { env, run } = await bossEnv({ config: { gradeThresholds: thresholds } }, { targetGrade: 'B+' });
    expect((await playBoss(env, run, 1)).results).toMatchObject({ predictedGradePct: 90, letter: 'B+', metTarget: true });
    const low = await bossEnv({ config: { gradeThresholds: thresholds } });
    expect((await playBoss(low.env, low.run, 5)).results).toMatchObject({ predictedGradePct: 50, letter: 'F' });
  });

  it('boss_end and results are idempotent; getResults needs phase results', async () => {
    const { env, run } = await bossEnv();
    expect(() => engine.getResults(run)).toThrowError(expect.objectContaining({ code: 'wrong_phase' }));
    const end = await playBoss(env, run, 0);
    const a = await engine.takeTurn(env.deps, env.ctx, end);
    const b = await engine.takeTurn(env.deps, env.ctx, a.run);
    expect(a.result).toMatchObject({ kind: 'boss_end' });
    expect(b.result).toEqual(a.result);
    expect(engine.getResults(end)).toEqual(end.results);
  });
});

describe('boss composition', () => {
  it('with no active misconceptions: no targets, all concepts covered, multi-concept preferred, no duplicates', async () => {
    // No student questions, so nothing is skipped (open questions are auto-skipped at ready).
    const env = makeEnv({ script: { mode: 'correct', review: () => ({ questions: [] }) } });
    const run = await toBoss(env, newRun(env));
    const ids = run.boss!.questionIds;
    expect(run.boss!.targetedMap).toEqual({});
    expect(new Set(ids).size).toBe(ids.length);
    const qs = ids.map((id) => env.ctx.questions.find((q) => q.id === id)!);
    expect(qs.every((q) => q.verified)).toBe(true);
    for (const c of ['c1', 'c2', 'c3']) expect(qs.some((q) => q.conceptIds.includes(c))).toBe(true);
    expect(qs.filter((q) => q.conceptIds.length >= 2).length).toBeGreaterThanOrEqual(5);
  });

  it('with active misconceptions: k = min(active, floor(N * 0.5)) targeted questions, each with a wrong path', async () => {
    const env = makeEnv({ script: { mode: 'correct' } });
    let run = newRun(env);
    for (let i = 0; i < 3; i++) {
      run = (await teach(env, run)).run;
      run = skipAll(env, run); // both misconceptions of the concept become active
      run = engine.startRoom(env.deps, env.ctx, run).run;
      run = (await playFight(env, run)).run;
      run = engine.continueRun(env.deps, env.ctx, run).run;
    }
    const active = run.hidden.misconceptions.filter((m) => m.status === 'active');
    expect(active).toHaveLength(6);
    const map = run.boss!.targetedMap;
    expect(Object.keys(map)).toHaveLength(5); // min(6, floor(10 * 0.5))
    expect(new Set(Object.values(map)).size).toBe(5);
    for (const [qid, mid] of Object.entries(map)) {
      expect(run.boss!.questionIds).toContain(qid);
      expect(targetsMisconception(env.ctx.questions.find((q) => q.id === qid)!, mid)).toBe(true);
    }
    // 3 active (one probe per room, all skipped) -> k = 3
    const skipEnv = makeEnv({ script: { mode: 'correct', review: (i) => ({ questions: i.probeableMisconceptionIds.slice(0, 1).map((id) => ({ misconceptionId: id, text: 'Why?' })) }) } });
    let r = newRun(skipEnv);
    for (let i = 0; i < 3; i++) {
      r = (await teach(skipEnv, r)).run;
      r = skipAll(skipEnv, r);
      r = engine.startRoom(skipEnv.deps, skipEnv.ctx, r).run;
      r = (await playFight(skipEnv, r)).run;
      r = engine.continueRun(skipEnv.deps, skipEnv.ctx, r).run;
    }
    expect(Object.keys(r.boss!.targetedMap)).toHaveLength(3);
  });

  it('only uses verified questions inside the scope', async () => {
    const env = makeEnv({ script: { mode: 'correct' } });
    const decoys = env.ctx.questions.filter((q) => q.conceptIds.length === 1).slice(0, 4).map((q, i) => ({ ...q, id: `decoy${i}`, verified: false }));
    const outside = { ...env.ctx.questions[0], id: 'outside', conceptIds: ['c1', 'c9'] };
    env.ctx.questions = [...env.ctx.questions, ...decoys, outside];
    const run = await toBoss(env, newRun(env, { scope: { roomIds: ['r1', 'r2'] } }));
    for (const id of run.boss!.questionIds) {
      const q = env.ctx.questions.find((x) => x.id === id)!;
      expect(q.verified).toBe(true);
      expect(q.conceptIds.every((c) => c === 'c1' || c === 'c2')).toBe(true);
    }
    expect(run.boss!.questionIds).not.toContain('outside');
  });

  it('a small pool shrinks the boss: each question is worth 100/N', async () => {
    const env = makeEnv({ script: { mode: 'correct' } });
    // keep 4 questions in the whole scope (one room)
    env.ctx.questions = env.ctx.questions.filter((q) => q.conceptIds.length === 1 && q.conceptIds[0] === 'c1').slice(0, 4);
    env.config.roomQuestions = 2;
    const run = await toBoss(env, newRun(env, { scope: { roomIds: ['r1'] } }));
    expect(run.boss!.questionIds).toHaveLength(4);
    env.tasks.mode = 'wrong';
    const out = await engine.takeTurn(env.deps, env.ctx, run);
    expect(out.result).toMatchObject({ damage: 25, health: 75 });
  });
});

describe('skipping raises boss targeting', () => {
  async function bossRun(skip: boolean) {
    const env = makeEnv({
      seed: 7,
      script: { mode: 'correct', review: (i) => ({ questions: skip && i.concepts[0].id === 'c1' ? [{ misconceptionId: 'm1a', text: 'Is it so?' }] : [] }) },
    });
    let run = newRun(env, { rngSeed: 7 });
    run = (await teach(env, run)).run;
    if (skip) run = skipAll(env, run);
    run = engine.startRoom(env.deps, env.ctx, run).run;
    run = (await playFight(env, run)).run;
    run = engine.continueRun(env.deps, env.ctx, run).run;
    run = await passRoom(env, run);
    run = await passRoom(env, run);
    return { env, run };
  }

  it('the skipped misconception gets a boss question and shows up as costly', async () => {
    const skipped = await bossRun(true);
    const map = skipped.run.boss!.targetedMap;
    expect(Object.values(map)).toContain('m1a');
    const qid = Object.keys(map).find((k) => map[k] === 'm1a')!;
    expect(skipped.run.boss!.questionIds).toContain(qid);

    const clean = await bossRun(false);
    expect(Object.values(clean.run.boss!.targetedMap)).not.toContain('m1a');

    // The student now follows the belief note on that question.
    skipped.env.tasks.mode = 'auto';
    let run = skipped.run;
    for (let i = 0; i < 20 && run.phase === 'boss'; i++) run = (await engine.takeTurn(skipped.env.deps, skipped.env.ctx, run)).run;
    const costly = run.results!.costlyMisconceptions;
    expect(costly.map((c) => c.id)).toContain('m1a');
    const entry = costly.find((c) => c.id === 'm1a')!;
    expect(entry).toMatchObject({ conceptId: 'c1', origin: 'skipped', questionId: qid });
    expect(entry.correction.length).toBeGreaterThan(0);
    expect(entry.materialRef.quote.length).toBeGreaterThan(0);
    expect(findHiddenKeys(run.results)).toEqual([]);
    expect(run.results!.predictedGradePct).toBeLessThan(100);

    clean.env.tasks.mode = 'auto';
    let c = clean.run;
    for (let i = 0; i < 20 && c.phase === 'boss'; i++) c = (await engine.takeTurn(clean.env.deps, clean.env.ctx, c)).run;
    expect(c.results!.costlyMisconceptions).toEqual([]);
    expect(c.results!.predictedGradePct).toBe(100);
  });
});
