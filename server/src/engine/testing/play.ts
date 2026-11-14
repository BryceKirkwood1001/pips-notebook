/** Small drivers for engine tests: get a run into a given phase. */
import type { Run, TurnResult } from '@top/shared';
import { engine } from '../index';
import type { EngineContext } from '../types';
import { buildCtx, createDeps, type TestDeps } from './fixtures';

export const defaultCtx = buildCtx();

export function newRun(deps: TestDeps, ctx: EngineContext = defaultCtx): Run {
  return engine.createRun(deps, ctx, { courseId: 'course1', targetGrade: 'B', rngSeed: 1, id: 'run1' });
}

/** Teaches once (notes for every concept of the room, optional stated misconceptions), then presses ready. */
export async function teachAndReady(
  deps: TestDeps,
  ctx: EngineContext,
  run: Run,
  stated: string[] = [],
): Promise<Run> {
  const room = ctx.pack.rooms.find((r) => r.id === run.scope.roomIds[run.roomIndex])!;
  deps.tasks.handlers.review = () => ({
    notesToAdd: room.conceptIds.map((c) => ({ conceptId: c, text: `Note about ${c} that the student wrote down` })),
    statedMisconceptionIds: stated,
    questions: [],
    resolvedMisconceptionIds: [],
  });
  const taught = await engine.teach(deps, ctx, run, 'my explanation');
  return engine.startRoom(deps, ctx, taught.run).run;
}

/** Plays turns until the phase changes away from room/boss. Help events are answered with `helpAnswer`. */
export async function playFight(
  deps: TestDeps,
  ctx: EngineContext,
  start: Run,
  opts: { maxTurns?: number } = {},
): Promise<{ run: Run; results: TurnResult[] }> {
  let run = start;
  const results: TurnResult[] = [];
  const phase = run.phase;
  for (let i = 0; i < (opts.maxTurns ?? 50) && run.phase === phase; i++) {
    const out = await engine.takeTurn(deps, ctx, run);
    results.push(out.result);
    run = out.run;
    const r = out.result;
    if (r.kind === 'help_me') {
      const q = ctx.questions.find((x) => x.id === r.question.id)!;
      const { correctAnswerOf } = await import('../../core/grading');
      const o = await engine.submitHelp(deps, ctx, run, r.eventId, correctAnswerOf(q).answer);
      results.push(o.result);
      run = o.run;
    }
  }
  return { run, results };
}

/** Plays the whole gauntlet with the current handlers. Returns a snapshot of the run in each phase reached. */
export async function playGauntlet(
  deps: TestDeps,
  ctx: EngineContext,
  opts: { stated?: string[] } = {},
): Promise<{ run: Run; snapshots: Run[] }> {
  const snapshots: Run[] = [];
  let run = newRun(deps, ctx);
  snapshots.push(run);
  for (let i = 0; i < run.scope.roomIds.length; i++) {
    run = await teachAndReady(deps, ctx, run, i === 0 ? (opts.stated ?? []) : []);
    snapshots.push(run); // room
    run = (await playFight(deps, ctx, run)).run;
    snapshots.push(run); // room_result
    if (run.room?.passed) run = engine.continueRun(deps, ctx, run).run;
    else break;
  }
  if (run.phase === 'boss') {
    snapshots.push(run);
    run = (await playFight(deps, ctx, run)).run;
    snapshots.push(run); // results
  }
  return { run, snapshots };
}

export { createDeps };
