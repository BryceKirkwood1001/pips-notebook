import type { CoursePack, Misconception, PublicStudentQuestion, Run } from '@pips-notebook/shared';
import { AppError } from '../errors';
import type { RetrievedChunk } from '../rag/types';
import { addNote, replaceNote } from './notebook';
import { drawRoomQuestions } from './draw';
import {
  activeMisconceptionIds,
  currentRoom,
  conceptTitle,
  nowIso,
  poolFor,
  roomReady,
} from './scope';
import type { EngineContext, EngineDeps } from './types';
import { scopeTitles } from './scope';
import { toPublicStudentQuestion } from './public';

export function assertPhase(run: Run, ...phases: Run['phase'][]): void {
  if (!phases.includes(run.phase)) {
    throw new AppError('wrong_phase', `this action is not allowed in phase "${run.phase}"`);
  }
  if (run.pendingHelpMe) {
    throw new AppError('help_pending', 'answer the pending "Help me!" event first');
  }
}

const touch = (run: Run, deps: EngineDeps): void => {
  run.updatedAt = nowIso(deps.clock.now());
};

/** The misconceptions of the room's concepts. */
function roomMisconceptions(run: Run, pack: CoursePack): Misconception[] {
  return currentRoom(run, pack).conceptIds.flatMap((id) => pack.concepts.find((c) => c.id === id)?.misconceptions ?? []);
}

const publicQuestions = (run: Run, pack: CoursePack): PublicStudentQuestion[] =>
  run.learning.pendingQuestions.map((q) => toPublicStudentQuestion(q, pack));

/** Writes the belief line as an ordinary note and activates even a previously corrected misconception. */
function activate(run: Run, pack: CoursePack, m: Misconception, origin: 'stated' | 'skipped'): void {
  const state = run.hidden.misconceptions.find((s) => s.id === m.id);
  if (!state) run.hidden.misconceptions.push({ id: m.id, conceptId: m.conceptId, status: 'active', origin });
  else {
    state.status = 'active';
    state.origin = origin;
  }
  run.notebookMd = addNote(run.notebookMd, scopeTitles(run, pack), conceptTitle(pack, m.conceptId), m.beliefStatement);
}

/** Marks resolved and replaces the belief line with the correction (or appends it when the belief is not there). */
function resolve(run: Run, pack: CoursePack, m: Misconception, note: string): void {
  const state = run.hidden.misconceptions.find((s) => s.id === m.id);
  if (state) state.status = 'resolved';
  else run.hidden.misconceptions.push({ id: m.id, conceptId: m.conceptId, status: 'resolved', origin: 'skipped' });
  run.notebookMd = replaceNote(
    run.notebookMd,
    scopeTitles(run, pack),
    conceptTitle(pack, m.conceptId),
    m.beliefStatement,
    note.trim() || m.correction,
  );
}

export async function teach(
  deps: EngineDeps,
  ctx: EngineContext,
  input: Run,
  explanation: string,
  conceptId?: string,
): Promise<{ run: Run; questions: PublicStudentQuestion[]; feedback?: string }> {
  assertPhase(input, 'learning');
  const run = structuredClone(input);
  const pack = ctx.pack;
  const room = currentRoom(run, pack);
  if (conceptId !== undefined && !room.conceptIds.includes(conceptId)) {
    throw new AppError('validation_error', `concept ${conceptId} is not taught in this room`);
  }
  // A focused lesson: Pip only reviews, notes and asks about the one concept the player is teaching.
  const focus = conceptId ? [conceptId] : room.conceptIds;
  const mis = roomMisconceptions(run, pack).filter((m) => focus.includes(m.conceptId));
  const misById = new Map(mis.map((m) => [m.id, m]));
  const stateOf = (id: string) => run.hidden.misconceptions.find((s) => s.id === id);
  const asked = (id: string) => run.learning.pendingQuestions.some((q) => q.misconceptionId === id);
  const probeable = (id: string) => misById.has(id) && !stateOf(id) && !asked(id);

  const openCount = run.learning.pendingQuestions.filter((q) => q.status === 'open').length;
  const roomConcepts = focus.flatMap((id) => {
    const c = pack.concepts.find((x) => x.id === id);
    return c ? [{ id: c.id, title: c.title, summary: c.summary }] : [];
  });

  const out = await deps.tasks.studentReview({
    concepts: roomConcepts,
    explanation,
    notebookMd: run.notebookMd,
    misconceptions: mis.map((m) => ({
      id: m.id,
      conceptId: m.conceptId,
      description: m.description,
      beliefStatement: m.beliefStatement,
      correction: m.correction,
      likelihood: m.likelihood,
    })),
    activeMisconceptionIds: activeMisconceptionIds(run).filter((id) => misById.has(id)),
    probeableMisconceptionIds: mis.filter((m) => probeable(m.id)).map((m) => m.id),
    maxQuestions: Math.max(0, deps.config.maxStudentQuestions - openCount),
  });

  // Notes: only for concepts of this room.
  for (const n of out.notesToAdd) {
    if (!focus.includes(n.conceptId) || !n.text.trim()) continue;
    run.notebookMd = addNote(run.notebookMd, scopeTitles(run, pack), conceptTitle(pack, n.conceptId), n.text);
  }
  // Re-teaching: active misconceptions the explanation corrects.
  for (const id of out.resolvedMisconceptionIds) {
    const m = misById.get(id);
    if (m && stateOf(id)?.status === 'active' && !out.statedMisconceptionIds.includes(id)) resolve(run, pack, m, m.correction);
  }
  // Stated misconceptions become active right away.
  for (const id of out.statedMisconceptionIds) {
    const m = misById.get(id);
    if (m) activate(run, pack, m, 'stated');
  }
  // Questions: only probeable misconceptions (stated ones above now have a state entry, so are excluded).
  const room_ = run.roomIndex;
  const attempt = run.room?.attempt ?? 0;
  let added = 0;
  const maxQ = Math.max(0, deps.config.maxStudentQuestions - openCount);
  for (const q of out.questions) {
    if (added >= maxQ) break;
    if (!probeable(q.misconceptionId) || !q.text.trim()) continue;
    run.learning.pendingQuestions.push({
      id: `sq_${room_}_${attempt}_${run.learning.pendingQuestions.length + 1}`,
      misconceptionId: q.misconceptionId,
      text: q.text.trim(),
      status: 'open',
    });
    added += 1;
  }

  run.learning.teachCount += 1;
  touch(run, deps);
  return { run, questions: publicQuestions(run, pack), ...(out.feedback?.trim() ? {feedback:out.feedback.trim().slice(0,600)} : {}) };
}

function openQuestion(run: Run, id: string) {
  const q = run.learning.pendingQuestions.find((x) => x.id === id);
  if (!q) throw new AppError('not_found', `unknown question ${id}`);
  if (q.status !== 'open') throw new AppError('question_not_open', `question ${id} is already ${q.status}`);
  return q;
}

export async function answerQuestion(
  deps: EngineDeps,
  ctx: EngineContext,
  input: Run,
  studentQuestionId: string,
  answer: string,
): Promise<{ run: Run; resolved: boolean }> {
  assertPhase(input, 'learning');
  const run = structuredClone(input);
  const q = openQuestion(run, studentQuestionId);
  const m = roomMisconceptions(run, ctx.pack).find((x) => x.id === q.misconceptionId);
  if (!m) throw new AppError('not_found', `unknown misconception for question ${studentQuestionId}`);

  let evidence: RetrievedChunk[] = [];
  try {
    evidence = await deps.retriever.retrieve({
      courseId: run.courseId,
      query: `${m.description} ${q.text}`,
      conceptIds: [m.conceptId],
    });
  } catch {
    evidence = []; // no evidence is better than no answer
  }
  const check = await deps.tasks.checkResolution({
    misconception: {
      id: m.id,
      conceptId: m.conceptId,
      description: m.description,
      beliefStatement: m.beliefStatement,
      correction: m.correction,
      likelihood: m.likelihood,
    },
    question: q.text,
    answer,
    evidence,
  });

  q.status = 'answered';
  if (check.resolved) resolve(run, ctx.pack, m, check.noteToAdd);
  else activate(run, ctx.pack, m, 'skipped'); // not resolved: exactly like a skip
  touch(run, deps);
  return { run, resolved: check.resolved };
}

export function skipQuestion(
  deps: EngineDeps,
  ctx: EngineContext,
  input: Run,
  studentQuestionId: string,
): { run: Run } {
  assertPhase(input, 'learning');
  const run = structuredClone(input);
  const q = openQuestion(run, studentQuestionId);
  const m = roomMisconceptions(run, ctx.pack).find((x) => x.id === q.misconceptionId);
  q.status = 'skipped';
  if (m) activate(run, ctx.pack, m, 'skipped');
  touch(run, deps);
  return { run };
}

/** POST /ready: auto-skips open questions, draws the room's questions, learning -> room. */
export function startRoom(deps: EngineDeps, ctx: EngineContext, input: Run): { run: Run } {
  assertPhase(input, 'learning');
  const run = structuredClone(input);
  const room = currentRoom(run, ctx.pack);
  if (!roomReady(ctx.pack, room)) throw new AppError('room_not_ready', `room ${room.id} is still being prepared`);
  const pool = poolFor(ctx.questions, room.conceptIds);
  if (pool.length === 0) throw new AppError('room_not_ready', `room ${room.id} has no questions yet`);

  for (const q of run.learning.pendingQuestions) {
    if (q.status !== 'open') continue;
    q.status = 'skipped';
    const m = roomMisconceptions(run, ctx.pack).find((x) => x.id === q.misconceptionId);
    if (m) activate(run, ctx.pack, m, 'skipped');
  }

  const seen = run.room?.seenQuestionIds ?? [];
  const ids = drawRoomQuestions(pool, seen, deps.config.roomQuestions, deps.rng);
  // ROOM_DAMAGE_CARRIES_OVER (Option A, bookmarked, NOT implemented): hearts would start from the previous
  // attempt's remaining hearts here instead of resetting to roomHearts. The flag is ignored for now.
  run.room = {
    attempt: (run.room?.attempt ?? 0) + 1,
    questionIds: ids,
    seenQuestionIds: [...new Set([...seen, ...ids])],
    turn: 0,
    hearts: deps.config.roomHearts,
    helpMeUsed: 0,
    log: [],
  };
  run.phase = 'room';
  touch(run, deps);
  return { run };
}

/** POST /retry: failed room_result -> learning for the same room, notebook kept. */
export function retryRoom(deps: EngineDeps, _ctx: EngineContext, input: Run): { run: Run } {
  assertPhase(input, 'room_result');
  if (input.room?.passed !== false) throw new AppError('wrong_phase', 'the room was passed: use continue');
  const run = structuredClone(input);
  run.phase = 'learning';
  // Old questions are over (every misconception already has a hidden state, so none is probed twice).
  run.learning = { pendingQuestions: [], teachCount: 0 };
  touch(run, deps);
  return { run };
}
