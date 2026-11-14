import { describe, expect, it } from 'vitest';
import { PublicRunSchema, RunSchema, type Run } from '@top/shared';
import { engine } from './index';
import { createDeps } from './testing/fixtures';
import { defaultCtx as ctx, newRun, playFight, playGauntlet, teachAndReady } from './testing/play';

const HIDDEN_KEYS = [
  'hidden', 'misconceptionId', 'misconceptionIds', 'correctIndex', 'correctIndexes', 'correctValue', 'acceptedAnswers',
  'wrongAnswers', 'wrongOrders', 'correctOrder', 'wrongMisconceptionId', 'solution', 'workedSteps', 'rubric',
  'modelAnswer', 'targetedMap', 'rngSeed', 'rngState',
];

function findKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [...(HIDDEN_KEYS.includes(k) ? [`${path}.${k}`] : []), ...findKeys(v, `${path}.${k}`)]);
  }
  return [];
}

/** One run in every phase (plus a failed room_result and a pending help event). */
async function phaseRuns() {
  const deps = createDeps();
  const { snapshots } = await playGauntlet(deps, ctx, { stated: ['m1a'] });
  const byPhase = (p: Run['phase']) => snapshots.find((r) => r.phase === p)!;

  const failDeps = createDeps();
  failDeps.tasks.handlers.answer = () => ({ answer: { dontKnow: true }, reasoning: '', citedNotes: [] });
  const failed = (await playFight(failDeps, ctx, await teachAndReady(failDeps, ctx, newRun(failDeps)))).run;

  const helpDeps = createDeps({ helpMeProb: 1 });
  const pending = (await engine.takeTurn(helpDeps, ctx, await teachAndReady(helpDeps, ctx, newRun(helpDeps)))).run;

  return {
    deps,
    runs: {
      learning: byPhase('learning'),
      room: byPhase('room'),
      room_passed: snapshots.find((r) => r.phase === 'room_result')!,
      room_failed: failed,
      boss: byPhase('boss'),
      results: byPhase('results'),
      pending,
    },
  };
}

describe('phase guards', () => {
  it('every action in every wrong phase throws wrong_phase', async () => {
    const { deps, runs } = await phaseRuns();
    const actions: Record<string, { allowed: (keyof typeof runs)[]; call: (r: Run) => unknown }> = {
      teach: { allowed: ['learning'], call: (r) => engine.teach(deps, ctx, r, 'x') },
      answer: { allowed: ['learning'], call: (r) => engine.answerQuestion(deps, ctx, r, 'sq', 'a') },
      skip: { allowed: ['learning'], call: (r) => Promise.resolve().then(() => engine.skipQuestion(deps, ctx, r, 'sq')) },
      ready: { allowed: ['learning'], call: (r) => Promise.resolve().then(() => engine.startRoom(deps, ctx, r)) },
      turn: { allowed: ['room', 'room_passed', 'room_failed', 'boss', 'results', 'pending'], call: (r) => engine.takeTurn(deps, ctx, r) },
      help: { allowed: ['room', 'boss', 'pending'], call: (r) => engine.submitHelp(deps, ctx, r, 'ev', { choiceIndex: 0 }) },
      retry: { allowed: ['room_failed'], call: (r) => Promise.resolve().then(() => engine.retryRoom(deps, ctx, r)) },
      continue: { allowed: ['room_passed'], call: (r) => Promise.resolve().then(() => engine.continueRun(deps, ctx, r)) },
      results: { allowed: ['results'], call: (r) => Promise.resolve().then(() => engine.getResults(r)) },
    };
    for (const [name, { allowed, call }] of Object.entries(actions)) {
      for (const [phase, run] of Object.entries(runs)) {
        if (allowed.includes(phase as keyof typeof runs)) continue;
        // a learning phase has no pending event; for the pending run (phase room) only room-compatible actions matter
        await expect(Promise.resolve().then(() => call(run)), `${name} in ${phase}`).rejects.toMatchObject({ code: 'wrong_phase' });
      }
    }
  });
});

describe('public projection', () => {
  it('never contains a hidden key, in any phase, and validates against the public schema', async () => {
    const { runs } = await phaseRuns();
    const config = createDeps().config;
    for (const [name, run] of Object.entries(runs)) {
      RunSchema.parse(run);
      const pub = engine.toPublicRun(run, ctx, config);
      PublicRunSchema.parse(pub);
      expect(findKeys(pub), name).toEqual([]);
    }
  });

  it('toPublicQuestion strips every question type', () => {
    for (const q of ctx.questions) {
      const pub = engine.toPublicQuestion(q);
      expect(findKeys(pub), q.id).toEqual([]);
      expect(Object.keys(pub).sort()).toEqual(['difficulty', 'id', 'payload', 'prompt', 'timeBudgetSec', 'type']);
      expect(JSON.stringify(pub)).not.toContain('Explanation');
    }
  });

  it('shows no upcoming question ids and no misconception ids on student questions', async () => {
    const deps = createDeps();
    let run = newRun(deps);
    deps.tasks.handlers.review = () => ({
      notesToAdd: [], statedMisconceptionIds: [], resolvedMisconceptionIds: [],
      questions: [{ misconceptionId: 'm1a', text: 'Why?' }],
    });
    run = (await engine.teach(deps, ctx, run, 'x')).run;
    const learning = JSON.stringify(engine.toPublicRun(run, ctx, deps.config));
    expect(learning).not.toContain('m1a');
    run = engine.startRoom(deps, ctx, run).run;
    const room = JSON.stringify(engine.toPublicRun(run, ctx, deps.config));
    for (const id of run.room!.questionIds) expect(room).not.toContain(id);
    expect(room).not.toContain('Belief 1a'.replace('1a', 'zz')); // sanity
  });

  it('reports rooms, readiness, rules and the pending event', async () => {
    const { runs } = await phaseRuns();
    const config = createDeps().config;
    const pub = engine.toPublicRun(runs.pending, ctx, config);
    expect(pub.pendingHelpMe).toMatchObject({ kind: 'help_me' });
    expect(pub.rules).toEqual({ roomQuestions: 5, roomHearts: 3, bossQuestions: 10, maxStudentQuestions: 3, helpMeTimed: true });
    expect(pub.rooms.map((r) => [r.id, r.ready, r.state])).toEqual([['r1', true, 'current'], ['r2', true, 'upcoming']]);
    expect(pub.currentRoom?.id).toBe('r1');
    expect(pub.courseTitle).toBe('Test Course');
    expect(pub.room).toMatchObject({ totalTurns: 5, maxHearts: 3 });
    const boss = engine.toPublicRun(runs.boss, ctx, config);
    expect(boss.currentRoom).toBeNull();
    expect(boss.rooms.map((r) => r.state)).toEqual(['passed', 'passed']);
    expect(boss.boss).toMatchObject({ health: 100, totalTurns: 10 });
    const notReady = { ...ctx, pack: { ...ctx.pack, status: { stage: 'concepts' as const, conceptsReady: ['c1'] } } };
    expect(engine.toPublicRun(runs.learning, notReady, config).rooms.map((r) => r.ready)).toEqual([false, false]);
    expect(engine.toPublicRun(runs.results, ctx, config).results?.costlyMisconceptions).toBeDefined();
  });
});

describe('determinism', () => {
  it('a whole gauntlet with the same seed is identical', async () => {
    const play = async () => {
      const deps = createDeps({ helpMeProb: 0.4, helpMeMaxPerBoss: 3 }, 99);
      return playGauntlet(deps, ctx, { stated: ['m1a'] });
    };
    expect((await play()).run).toEqual((await play()).run);
  });
});
