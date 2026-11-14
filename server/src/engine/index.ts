import { DEFAULT_STUDENT_EMOJI, type Results, type Run } from '@pips-notebook/shared';
import { randomSeed } from '../core/rng';
import { AppError } from '../errors';
import { continueRun, submitHelp, takeTurn } from './fight';
import { answerQuestion, retryRoom, skipQuestion, startRoom, teach } from './learning';
import { EMPTY_NOTEBOOK } from './notebook';
import { toPublicQuestion, toPublicRun } from './public';
import { nowIso, poolFor, roomById, roomReady } from './scope';
import type { CreateRunInput, Engine, EngineContext, EngineDeps } from './types';

function createRun(deps: EngineDeps, ctx: EngineContext, input: CreateRunInput): Run {
  const roomIds =
    input.scope?.roomIds ?? [...ctx.pack.rooms].sort((a, b) => a.order - b.order).map((r) => r.id);
  if (roomIds.length === 0) throw new AppError('room_not_ready', 'the course has no rooms yet');
  for (const id of roomIds) roomById(ctx.pack, id); // unknown -> not_found

  const first = roomById(ctx.pack, roomIds[0]);
  if (!roomReady(ctx.pack, first)) throw new AppError('room_not_ready', `room ${first.id} is still being prepared`);
  if (poolFor(ctx.questions, first.conceptIds).length === 0) {
    throw new AppError('room_not_ready', `room ${first.id} has no questions yet`);
  }

  const now = nowIso(deps.clock.now());
  const seed = input.rngSeed ?? randomSeed();
  return {
    id: input.id ?? `run_${crypto.randomUUID()}`,
    courseId: input.courseId,
    targetGrade: input.targetGrade,
    studentEmoji: input.studentEmoji ?? DEFAULT_STUDENT_EMOJI,
    scope: { roomIds },
    phase: 'learning',
    roomIndex: 0,
    notebookMd: EMPTY_NOTEBOOK,
    hidden: { misconceptions: [] },
    learning: { pendingQuestions: [], teachCount: 0 },
    helpMeTally: { offered: 0, correct: 0, wrong: 0, late: 0, solveTimesSec: [] },
    rngSeed: seed,
    // The service overwrites this with rng.state() after each engine call.
    rngState: seed,
    createdAt: now,
    updatedAt: now,
  };
}

function getResults(run: Run): Results {
  if (run.phase !== 'results' || !run.results) throw new AppError('wrong_phase', 'the run has no results yet');
  return structuredClone(run.results);
}

export const engine: Engine = {
  createRun,
  teach,
  answerQuestion,
  skipQuestion,
  startRoom,
  takeTurn,
  submitHelp,
  retryRoom,
  continueRun,
  getResults,
  toPublicRun,
  toPublicQuestion,
};

export { toPublicRun, toPublicQuestion };
export { parseNotebook, notebookLines, citationMatches } from './notebook';
export type * from './types';
export { systemClock } from './types';
