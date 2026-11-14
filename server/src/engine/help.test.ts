import { describe, expect, it } from 'vitest';
import { RunSchema, type HelpMeTurn, type HelpResultTurn, type Question } from '@top/shared';
import { correctAnswerOf } from '../core/grading';
import { engine, notebookLines } from './index';
import { buildCtx, createDeps } from './testing/fixtures';
import { defaultCtx as ctx, newRun, teachAndReady } from './testing/play';

const qOf = (id: string): Question => ctx.questions.find((q) => q.id === id)!;

async function helpEvent(configOverrides = {}) {
  const deps = createDeps({ helpMeProb: 1, ...configOverrides });
  const run = await teachAndReady(deps, ctx, newRun(deps));
  const out = await engine.takeTurn(deps, ctx, run);
  return { deps, run, out, event: out.result as HelpMeTurn };
}

describe('"Help me!" events', () => {
  it('probability 1 always offers (under the cap), probability 0 never', async () => {
    const { out, event, run } = await helpEvent();
    expect(event.kind).toBe('help_me');
    expect(out.run.pendingHelpMe?.eventId).toBe(event.eventId);
    expect(out.run.room?.helpMeUsed).toBe(1);
    expect(out.run.room?.log).toHaveLength(1);
    expect(out.run.helpMeTally.offered).toBe(1);
    expect(out.run.room?.turn).toBe(0); // the question is not consumed until answered
    expect(run.pendingHelpMe).toBeUndefined(); // input untouched

    const deps = createDeps({ helpMeProb: 0 });
    const r = await teachAndReady(deps, ctx, newRun(deps));
    for (let i = 0; i < 3; i++) {
      const o = await engine.takeTurn(deps, ctx, r);
      expect(o.result.kind).toBe('student_answer');
    }
  });

  it('the event holds the multiplied time budget and a deadline', async () => {
    const { event, run } = await helpEvent({ helpMeTimeMultiplier: 0.75 });
    const q = qOf(event.question.id);
    expect(event.timeBudgetSec).toBe(Math.round(q.timeBudgetSec * 0.75));
    expect(event.deadline).toBe(new Date(new Date('2026-06-01T12:00:00.000Z').getTime() + event.timeBudgetSec * 1000).toISOString());
    expect(run.room!.questionIds).toContain(q.id);
  });

  it('untimed mode has no deadline and never goes late', async () => {
    const { deps, out, event } = await helpEvent({ helpMeTimed: false });
    expect(event.deadline).toBeNull();
    deps.clock.advance(10 * 3600 * 1000);
    const q = qOf(event.question.id);
    const res = await engine.submitHelp(deps, ctx, out.run, event.eventId, correctAnswerOf(q).answer);
    expect(res.result).toMatchObject({ kind: 'help_result', correct: true, late: false });
  });

  it('per-room cap: after one event the next turns are the student', async () => {
    const { deps, out, event } = await helpEvent();
    const q = qOf(event.question.id);
    const done = await engine.submitHelp(deps, ctx, out.run, event.eventId, correctAnswerOf(q).answer);
    expect(done.run.pendingHelpMe).toBeUndefined();
    const next = await engine.takeTurn(deps, ctx, done.run);
    expect(next.result.kind).toBe('student_answer');
  });

  it('per-boss cap is HELP_ME_MAX_PER_BOSS (2)', async () => {
    const deps = createDeps({ helpMeProb: 1, helpMeMaxPerRoom: 0 });
    const { playGauntlet } = await import('./testing/play');
    const { run } = await playGauntlet(deps, ctx);
    expect(run.phase).toBe('results');
    expect(run.boss!.helpMeUsed).toBe(2);
    expect(run.room).toBeUndefined();
    expect(run.helpMeTally.offered).toBe(2);
  });

  it('never for free_response questions', async () => {
    const free = buildCtx({ questions: ctx.questions.filter((q) => q.id === 'q_c1_free1') });
    const deps = createDeps({ helpMeProb: 1 });
    const run = await teachAndReady(deps, free, newRun(deps, free));
    const out = await engine.takeTurn(deps, free, run);
    expect(out.result.kind).toBe('student_answer');
  });

  it('/turn while pending returns the same event without changing state', async () => {
    const { deps, out, event } = await helpEvent();
    const again = await engine.takeTurn(deps, ctx, out.run);
    expect(again.result).toEqual(event);
    expect(again.run).toEqual(out.run);
    expect(again.stats).toEqual([]);
  });

  it('correct: no damage, a "Teacher showed me" note, a help_solve stat, solve time', async () => {
    const { deps, out, event } = await helpEvent();
    deps.clock.advance(12_340);
    const q = qOf(event.question.id);
    const res = await engine.submitHelp(deps, ctx, out.run, event.eventId, correctAnswerOf(q).answer);
    const r = res.result as HelpResultTurn;
    expect(r).toMatchObject({ kind: 'help_result', correct: true, late: false, damage: 0, hearts: 3, phaseAfter: 'room', solveTimeSec: 12.34 });
    expect(r.noteAdded).toBe(`Teacher showed me: ${correctAnswerOf(q).text}`);
    expect(notebookLines(res.run.notebookMd)).toContain(r.noteAdded);
    expect(res.stats).toEqual([{ questionId: q.id, kind: 'help_solve', solveTimeSec: 12.34 }]);
    expect(res.run.room).toMatchObject({ turn: 1, hearts: 3 });
    expect(res.run.room!.log.map((t) => t.kind)).toEqual(['help_me', 'help_result']);
    expect(res.run.helpMeTally).toMatchObject({ offered: 1, correct: 1, wrong: 0, late: 0, solveTimesSec: [12.34] });
    expect(() => RunSchema.parse(res.run)).not.toThrow();
  });

  it('wrong: same damage as a wrong student answer, no note, no stats', async () => {
    const { deps, out, event } = await helpEvent();
    const q = qOf(event.question.id);
    const wrong = q.type === 'true_false' ? { value: false } : q.type === 'numeric' ? { value: 999 } : q.type === 'short_text' ? { text: 'zzz' } : q.type === 'ordering' ? { order: [0, 1, 2] } : q.type === 'multi_select' ? { choiceIndexes: [2] } : { choiceIndex: 3 };
    deps.tasks.handlers.gradeOpen = () => ({ correct: false, misconceptionIds: [], feedback: '' });
    const res = await engine.submitHelp(deps, ctx, out.run, event.eventId, wrong);
    expect(res.result).toMatchObject({ correct: false, late: false, damage: 1, hearts: 2 });
    expect((res.result as HelpResultTurn).noteAdded).toBeUndefined();
    expect(res.stats).toEqual([]);
    expect(res.run.helpMeTally).toMatchObject({ wrong: 1, correct: 0 });
  });

  it('late (after the deadline) is wrong even with the right answer', async () => {
    const { deps, out, event } = await helpEvent();
    deps.clock.advance(event.timeBudgetSec * 1000 + 1);
    const q = qOf(event.question.id);
    const res = await engine.submitHelp(deps, ctx, out.run, event.eventId, correctAnswerOf(q).answer);
    expect(res.result).toMatchObject({ correct: false, late: true, damage: 1 });
    expect(res.stats).toEqual([]);
    expect(res.run.helpMeTally).toMatchObject({ late: 1, wrong: 0 });
  });

  it('an expired event is resolved as late by the next /turn', async () => {
    const { deps, out, event } = await helpEvent();
    deps.clock.advance(event.timeBudgetSec * 1000 + 5);
    const res = await engine.takeTurn(deps, ctx, out.run);
    expect(res.result).toMatchObject({ kind: 'help_result', correct: false, late: true, damage: 1, eventId: event.eventId });
    expect(res.run.pendingHelpMe).toBeUndefined();
  });

  it('a stale or unknown event id, and an answer that does not fit, are rejected', async () => {
    const { deps, out, event, run } = await helpEvent();
    await expect(engine.submitHelp(deps, ctx, out.run, 'nope', { choiceIndex: 0 })).rejects.toMatchObject({ code: 'help_event_not_pending' });
    await expect(engine.submitHelp(deps, ctx, run, event.eventId, { choiceIndex: 0 })).rejects.toMatchObject({ code: 'help_event_not_pending' });
    const q = qOf(event.question.id);
    const bad = q.type === 'mcq' ? { text: 'x' } : { choiceIndex: 0 };
    await expect(engine.submitHelp(deps, ctx, out.run, event.eventId, bad)).rejects.toMatchObject({ code: 'invalid_answer' });
    // the event is still pending after an invalid answer
    expect(out.run.pendingHelpMe).toBeDefined();
  });

  it('a wrong help answer can fail the room', async () => {
    const deps = createDeps({ helpMeProb: 1, roomHearts: 1 });
    const run = await teachAndReady(deps, ctx, newRun(deps));
    const o = await engine.takeTurn(deps, ctx, run);
    const ev = o.result as HelpMeTurn;
    deps.clock.advance(ev.timeBudgetSec * 1000 + 1);
    const res = await engine.submitHelp(deps, ctx, o.run, ev.eventId, { dontKnow: true });
    expect(res.result).toMatchObject({ late: true, hearts: 0, phaseAfter: 'room_result' });
    expect(res.run.room?.passed).toBe(false);
  });

  it('learning actions while an event is pending are blocked', async () => {
    const { deps, out } = await helpEvent();
    // in phase room the phase check fires first; craft a learning-phase run with a pending event for help_pending
    const run = { ...out.run, phase: 'learning' as const };
    await expect(engine.teach(deps, ctx, run, 'x')).rejects.toMatchObject({ code: 'help_pending' });
    expect(() => engine.startRoom(deps, ctx, run)).toThrowError(expect.objectContaining({ code: 'help_pending' }));
    await expect(engine.teach(deps, ctx, out.run, 'x')).rejects.toMatchObject({ code: 'wrong_phase' });
  });
});
