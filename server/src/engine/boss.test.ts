import { describe, expect, it } from 'vitest';
import { ResultsSchema, type Run, type StudentAnswerTurn } from '@pips-notebook/shared';
import { DEFAULT_GRADE_THRESHOLDS } from '../config';
import { targetsMisconception } from '../core/grading';
import { engine } from './index';
import { letterFor, metTarget } from './results';
import { answerCorrectly, createDeps, type TestDeps } from './testing/fixtures';
import { defaultCtx as ctx, newRun, playFight, teachAndReady } from './testing/play';

const wrongOnly = (ids: Set<string>) => (i: Parameters<typeof answerCorrectly>[0], o: Parameters<typeof answerCorrectly>[1]) =>
  ids.has(o!.question.id) ? { answer: { dontKnow: true }, reasoning: 'no', citedNotes: [] as string[] } : answerCorrectly(i, o);

/** Plays both rooms (all correct) and stops at the start of the boss. */
async function toBoss(deps: TestDeps, stated: string[] = ['m1a', 'm2a']): Promise<Run> {
  let run = await teachAndReady(deps, ctx, newRun(deps), stated);
  run = engine.continueRun(deps, ctx, (await playFight(deps, ctx, run)).run).run;
  run = await teachAndReady(deps, ctx, run, ['m3b']);
  return engine.continueRun(deps, ctx, (await playFight(deps, ctx, run)).run).run;
}

describe('boss composition', () => {
  it('has N questions, k targeted ones for active misconceptions, covers every concept, prefers multi-concept', async () => {
    const deps = createDeps();
    const run = await toBoss(deps);
    const boss = run.boss!;
    expect(run).toMatchObject({ phase: 'boss', roomIndex: 2 });
    expect(boss.questionIds).toHaveLength(10);
    expect(new Set(boss.questionIds).size).toBe(10);
    expect(boss.health).toBe(100);
    // 3 active misconceptions (m1a, m2a, m3b); k = min(3, floor(10*0.5)) = 3
    const targeted = Object.entries(boss.targetedMap);
    expect(targeted).toHaveLength(3);
    expect(new Set(targeted.map(([, m]) => m))).toEqual(new Set(['m1a', 'm2a', 'm3b']));
    for (const [qid, mid] of targeted) {
      expect(boss.questionIds).toContain(qid);
      expect(targetsMisconception(ctx.questions.find((q) => q.id === qid)!, mid)).toBe(true);
    }
    const qs = boss.questionIds.map((id) => ctx.questions.find((q) => q.id === id)!);
    expect(new Set(qs.flatMap((q) => q.conceptIds))).toEqual(new Set(['c1', 'c2', 'c3']));
    expect(qs.filter((q) => q.conceptIds.length >= 2).length).toBeGreaterThanOrEqual(5);
    expect(qs.every((q) => q.verified)).toBe(true);
  });

  it('k is capped by the targeted share and by what is active', async () => {
    const none = await toBoss(createDeps(), []);
    // m3b stated in room 2 is still active, so exactly one targeted question
    expect(Object.keys(none.boss!.targetedMap)).toEqual([none.boss!.questionIds.find((id) => id in none.boss!.targetedMap)]);
    const six = await toBoss(createDeps({ bossQuestions: 6 }));
    expect(six.boss!.questionIds).toHaveLength(6);
    expect(Object.keys(six.boss!.targetedMap)).toHaveLength(3); // floor(6*0.5) = 3
    const twoShare = await toBoss(createDeps({ bossTargetedShare: 0.2 }));
    expect(Object.keys(twoShare.boss!.targetedMap)).toHaveLength(2); // floor(10*0.2)
  });

  it('is deterministic for a seed', async () => {
    const a = await toBoss(createDeps({}, 5));
    const b = await toBoss(createDeps({}, 5));
    expect(a.boss).toEqual(b.boss);
  });
});

describe('boss fight and results', () => {
  it('health math with 10 questions: 3 wrong -> 70', async () => {
    const deps = createDeps();
    const run = await toBoss(deps);
    const wrong = new Set(run.boss!.questionIds.slice(0, 3));
    deps.tasks.handlers.answer = wrongOnly(wrong);
    const { run: end, results } = await playFight(deps, ctx, run);
    expect(results).toHaveLength(10);
    expect((results[0] as StudentAnswerTurn)).toMatchObject({ damage: 10, health: 90, phaseAfter: 'boss' });
    expect(end.phase).toBe('results');
    expect(end.boss!.health).toBeCloseTo(70, 9);
    expect(end.results).toMatchObject({ predictedGradePct: 70, letter: 'C-', target: 'B', metTarget: false });
    expect(() => ResultsSchema.parse(end.results)).not.toThrow();
    expect((results[9] as StudentAnswerTurn).phaseAfter).toBe('results');
  });

  it('health math with 6 questions: 2 wrong -> 67 (66.67 rounded)', async () => {
    const deps = createDeps({ bossQuestions: 6 });
    const run = await toBoss(deps);
    deps.tasks.handlers.answer = wrongOnly(new Set(run.boss!.questionIds.slice(0, 2)));
    const { run: end } = await playFight(deps, ctx, run);
    expect(end.boss!.health).toBeCloseTo(66.6667, 3);
    expect(end.results!.predictedGradePct).toBe(67);
  });

  it('all right is 100 and all wrong is 0', async () => {
    const deps = createDeps();
    const run = await toBoss(deps);
    const { run: perfect } = await playFight(deps, ctx, run);
    expect(perfect.results!.conceptAccuracy.every((a) => a.accuracy === 1 && a.total > 0)).toBe(true); // the last turn counts too
    expect(perfect.results).toMatchObject({ predictedGradePct: 100, letter: 'A', metTarget: true, costlyMisconceptions: [] });
    deps.tasks.handlers.answer = () => ({ answer: { dontKnow: true }, reasoning: '', citedNotes: [] });
    const { run: zero } = await playFight(deps, ctx, run);
    expect(zero.results).toMatchObject({ predictedGradePct: 0, letter: 'F' });
    expect(zero.boss!.health).toBe(0);
  });

  it('boss_end and getResults are idempotent; getResults needs the results phase', async () => {
    const deps = createDeps();
    const run = await toBoss(deps);
    expect(() => engine.getResults(run)).toThrowError(expect.objectContaining({ code: 'wrong_phase' }));
    const { run: end } = await playFight(deps, ctx, run);
    const a = await engine.takeTurn(deps, ctx, end);
    const b = await engine.takeTurn(deps, ctx, a.run);
    expect(a.result).toEqual({ kind: 'boss_end', results: end.results });
    expect(b.result).toEqual(a.result);
    expect(b.run).toEqual(end);
    expect(engine.getResults(end)).toEqual(end.results);
  });

  it('per-concept accuracy counts boss questions per concept', async () => {
    const deps = createDeps();
    const run = await toBoss(deps);
    const c1Questions = run.boss!.questionIds.filter((id) => ctx.questions.find((q) => q.id === id)!.conceptIds.includes('c1'));
    deps.tasks.handlers.answer = wrongOnly(new Set(c1Questions));
    const { run: end } = await playFight(deps, ctx, run);
    const acc = end.results!.conceptAccuracy;
    expect(acc.map((a) => a.conceptId)).toEqual(['c1', 'c2', 'c3']);
    expect(acc[0]).toMatchObject({ title: 'Concept 1', correct: 0, total: c1Questions.length, accuracy: 0 });
    expect(acc[0].total).toBeGreaterThan(0);
    expect(acc[1].correct).toBeLessThanOrEqual(acc[1].total);
    expect(acc.every((a) => a.accuracy === (a.total ? a.correct / a.total : 0))).toBe(true);
  });

  it('costlyMisconceptions: active ones whose targeted question was answered wrong, with a material ref', async () => {
    const deps = createDeps();
    const run = await toBoss(deps);
    const map = run.boss!.targetedMap;
    const [qA, qB, qC] = Object.keys(map); // targeted questions
    // wrong on qA and qB; right on qC. Resolve the misconception behind qB so it is not listed.
    const resolvedId = map[qB];
    void qC;
    const doctored = structuredClone(run);
    doctored.hidden.misconceptions.find((m) => m.id === resolvedId)!.status = 'resolved';
    deps.tasks.handlers.answer = wrongOnly(new Set([qA, qB]));
    const { run: end } = await playFight(deps, ctx, doctored);
    const costly = end.results!.costlyMisconceptions;
    expect(costly.map((c) => c.id)).toEqual([map[qA]]);
    expect(costly[0]).toMatchObject({
      questionId: qA,
      origin: map[qA] === 'm3b' ? 'stated' : 'stated',
      materialRef: { fileId: 'f1', fileName: 'notes.pdf', page: 3, sectionPath: ['Unit 1', 'Section'] },
    });
    expect(costly[0].correction).toMatch(/^Actually/);
    expect(costly.map((c) => c.id)).not.toContain(map[qC]);
    expect(costly.map((c) => c.id)).not.toContain(resolvedId);
  });

  it('a failed "Help me!" on a targeted question also costs the misconception', async () => {
    const deps = createDeps({ helpMeProb: 1, helpMeMaxPerBoss: 99, helpMeMaxPerRoom: 0 });
    const run = await toBoss(deps);
    // free_response questions never get "Help me!": the student answers those, wrongly here
    deps.tasks.handlers.answer = () => ({ answer: { dontKnow: true }, reasoning: '', citedNotes: [] });
    let state = run;
    while (state.phase === 'boss') {
      const out = await engine.takeTurn(deps, ctx, state);
      state = out.run;
      if (out.result.kind === 'help_me') {
        state = (await engine.submitHelp(deps, ctx, state, out.result.eventId, { dontKnow: true })).run;
      }
    }
    const ids = state.results!.costlyMisconceptions.map((c) => c.id).sort();
    expect(ids).toEqual(['m1a', 'm2a', 'm3b']);
    const offered = state.helpMeTally.offered;
    expect(offered).toBeGreaterThan(5);
    expect(state.results!.helpMe).toMatchObject({ offered, correct: 0, wrong: offered, late: 0 });
    expect(state.results!.predictedGradePct).toBe(0);
  });

  it('help results: offered, correct, and average solve time', async () => {
    const deps = createDeps({ helpMeProb: 1, helpMeMaxPerBoss: 99, helpMeMaxPerRoom: 0 });
    const run = await toBoss(deps);
    let state = run;
    const { correctAnswerOf } = await import('../core/grading');
    while (state.phase === 'boss') {
      const out = await engine.takeTurn(deps, ctx, state);
      state = out.run;
      const r = out.result;
      if (r.kind === 'help_me') {
        deps.clock.advance(10_000);
        const q = ctx.questions.find((x) => x.id === r.question.id)!;
        state = (await engine.submitHelp(deps, ctx, state, r.eventId, correctAnswerOf(q).answer)).run;
      }
    }
    expect(state.results!.helpMe).toMatchObject({ correct: state.helpMeTally.offered, avgSolveTimeSec: 10 });
  });
});

describe('letters and thresholds', () => {
  const t = DEFAULT_GRADE_THRESHOLDS;
  it('picks the highest grade whose threshold is met, at the boundaries', () => {
    const cases: [number, string][] = [
      [100, 'A'], [93, 'A'], [92, 'A-'], [90, 'A-'], [89, 'B+'], [87, 'B+'], [86, 'B'], [83, 'B'], [82, 'B-'],
      [80, 'B-'], [79, 'C+'], [77, 'C+'], [76, 'C'], [73, 'C'], [72, 'C-'], [70, 'C-'], [69, 'D'], [60, 'D'], [59, 'F'], [0, 'F'],
    ];
    for (const [pct, letter] of cases) expect(letterFor(pct, t), `${pct}`).toBe(letter);
  });
  it('metTarget compares to the target threshold', () => {
    expect(metTarget(83, 'B', t)).toBe(true);
    expect(metTarget(82, 'B', t)).toBe(false);
    expect(metTarget(60, 'D', t)).toBe(true);
    expect(metTarget(92, 'A', t)).toBe(false);
  });
  it('honours custom thresholds', () => {
    expect(letterFor(50, { ...t, D: 50 })).toBe('D');
  });
});
