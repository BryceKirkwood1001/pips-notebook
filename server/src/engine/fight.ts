import type { Answer, HelpMeTurn, HelpResultTurn, Question, Run, StudentAnswerTurn, TurnResult } from '@top/shared';
import { answerFitsQuestion, correctAnswerOf, formatAnswer, gradeDeterministic } from '../core/grading';
import { AppError } from '../errors';
import type { RetrievedChunk } from '../rag/types';
import type { StatsEvent } from '../repo/types';
import { composeBoss } from './draw';
import { assertPhase } from './learning';
import { addNote, citationMatches } from './notebook';
import { toPublicQuestion } from './public';
import { computeResults } from './results';
import {
  activeMisconceptionIds,
  allMisconceptions,
  conceptTitle,
  misconceptionById,
  nowIso,
  poolFor,
  questionById,
  roomById,
  roomReady,
  scopeConceptIds,
  scopeTitles,
} from './scope';
import type { EngineContext, EngineDeps, TurnOutcome } from './types';

/** The fight in progress (room or boss), with the numbers the turn logic needs. */
function fightOf(run: Run) {
  if (run.phase === 'room' && run.room) return { kind: 'room' as const, f: run.room };
  if (run.phase === 'boss' && run.boss) return { kind: 'boss' as const, f: run.boss };
  throw new AppError('wrong_phase', `no fight in phase "${run.phase}"`);
}

function fightKey(run: Run): string {
  return run.phase === 'boss' ? 'boss' : `r${run.roomIndex}_a${run.room?.attempt ?? 1}`;
}

async function retrieveSafe(deps: EngineDeps, courseId: string, q: Question): Promise<RetrievedChunk[]> {
  try {
    return await deps.retriever.retrieve({ courseId, query: q.prompt, conceptIds: q.conceptIds });
  } catch {
    return []; // continue with no evidence
  }
}

/** Correct / misconception ids for an answer, using gradeOpen when code can't decide. */
async function grade(
  deps: EngineDeps,
  ctx: EngineContext,
  run: Run,
  q: Question,
  answer: Answer,
): Promise<{ correct: boolean; misconceptionIds: string[]; dontKnow: boolean }> {
  const g = gradeDeterministic(q, answer);
  if (g.status === 'correct') return { correct: true, misconceptionIds: [], dontKnow: false };
  if (g.status === 'needs_llm') {
    const candidates = q.misconceptionIds
      .map((id) => misconceptionById(ctx.pack, id))
      .filter((m) => !!m)
      .map((m) => ({ id: m.id, description: m.description, beliefStatement: m.beliefStatement }));
    const open = await deps.tasks.gradeOpen({
      question: q,
      answerText: answer.text ?? '',
      candidateMisconceptions: candidates,
      evidence: await retrieveSafe(deps, run.courseId, q),
    });
    const ids = open.misconceptionIds.filter((id) => candidates.some((c) => c.id === id));
    return { correct: open.correct, misconceptionIds: open.correct ? [] : ids, dontKnow: false };
  }
  return { correct: false, misconceptionIds: g.misconceptionIds, dontKnow: g.dontKnow };
}

/** Applies a wrong or right result to the fight: damage, turn, end of fight. Returns damage and phaseAfter. */
function advance(run: Run, ctx: EngineContext, deps: EngineDeps, correct: boolean) {
  const { kind, f } = fightOf(run);
  f.turn += 1;
  if (kind === 'room') {
    const room = run.room!;
    const damage = correct ? 0 : 1;
    room.hearts = Math.max(0, room.hearts - damage);
    if (room.hearts === 0) {
      room.passed = false;
      run.phase = 'room_result';
    } else if (room.turn >= room.questionIds.length) {
      room.passed = true;
      run.phase = 'room_result';
    }
    return { damage, hearts: room.hearts as number | undefined, health: undefined as number | undefined };
  }
  const boss = run.boss!;
  const damage = correct ? 0 : 100 / boss.questionIds.length;
  boss.health = Math.max(0, Math.min(100, boss.health - damage));
  if (boss.turn >= boss.questionIds.length) {
    run.phase = 'results'; // results are computed in logTurn, once this turn is in the log
  }
  return { damage, hearts: undefined as number | undefined, health: boss.health as number | undefined };
}

const damageFields = (d: { hearts?: number; health?: number }) => ({
  ...(d.hearts !== undefined ? { hearts: d.hearts } : {}),
  ...(d.health !== undefined ? { health: d.health } : {}),
});

function helpMeTurnOf(run: Run, q: Question): HelpMeTurn {
  const p = run.pendingHelpMe!;
  return {
    kind: 'help_me',
    eventId: p.eventId,
    question: toPublicQuestion(q),
    timeBudgetSec: p.timeBudgetSec,
    deadline: p.deadline,
  };
}

/** Resolves the pending "Help me!" event (answer, or late/expired). Mutates the (already cloned) run. */
async function resolveHelp(
  deps: EngineDeps,
  ctx: EngineContext,
  run: Run,
  answer: Answer | null,
  forceLate: boolean,
): Promise<TurnOutcome> {
  const pending = run.pendingHelpMe!;
  const q = questionById(ctx.questions, pending.questionId);
  const now = deps.clock.now();
  const solveTimeSec = Math.max(0, Math.round(((now.getTime() - new Date(pending.startedAt).getTime()) / 1000) * 100) / 100);
  const late = forceLate || (pending.deadline !== null && now.getTime() > new Date(pending.deadline).getTime());

  let correct = false;
  if (!late && answer) correct = (await grade(deps, ctx, run, q, answer)).correct;

  const stats: StatsEvent[] = [];
  const tally = run.helpMeTally;
  tally.solveTimesSec.push(solveTimeSec);
  let noteAdded: string | undefined;
  if (correct) {
    tally.correct += 1;
    stats.push({ questionId: q.id, kind: 'help_solve', solveTimeSec });
    noteAdded = `Teacher showed me: ${correctAnswerOf(q).text}`;
    const conceptId = q.conceptIds[0];
    if (conceptId) {
      run.notebookMd = addNote(run.notebookMd, scopeTitles(run, ctx.pack), conceptTitle(ctx.pack, conceptId), noteAdded);
    }
  } else if (late) tally.late += 1;
  else tally.wrong += 1;

  run.pendingHelpMe = undefined;
  const d = advance(run, ctx, deps, correct);
  const result: HelpResultTurn = {
    kind: 'help_result',
    eventId: pending.eventId,
    question: toPublicQuestion(q),
    correct,
    late,
    correctAnswer: correctAnswerOf(q),
    explanation: q.explanation,
    solveTimeSec,
    ...(noteAdded ? { noteAdded } : {}),
    damage: d.damage,
    ...damageFields(d),
    phaseAfter: run.phase,
  };
  logTurn(run, result, ctx, deps);
  run.updatedAt = nowIso(now);
  return { run, result, stats };
}

/** Appends the turn to the fight's log; when it ended the boss, computes the results from the full log. */
function logTurn(run: Run, turn: TurnResult, ctx: EngineContext, deps: EngineDeps): void {
  const log = (run.phase === 'room' || run.phase === 'room_result' ? run.room! : run.boss!).log;
  log.push(turn);
  if (run.phase === 'room_result') recordRoomAttempt(run, ctx, deps);
  if (run.phase === 'results') run.results = computeResults(run, ctx, deps.config);
}

/** Saves the finished room attempt for the between-room report: the turns the player saw and the lesson's counts. */
function recordRoomAttempt(run: Run, ctx: EngineContext, deps: EngineDeps): void {
  const room = run.room!;
  const asked = run.learning.pendingQuestions;
  run.history = [
    ...(run.history ?? []),
    {
      roomId: run.scope.roomIds[run.roomIndex],
      roomIndex: run.roomIndex,
      attempt: room.attempt,
      passed: room.passed === true,
      hearts: room.hearts,
      maxHearts: deps.config.roomHearts,
      turns: room.log.flatMap((t) =>
        t.kind === 'student_answer' || t.kind === 'help_result'
          ? [{
              questionId: t.question.id,
              prompt: t.question.prompt,
              conceptIds: [...(ctx.questions.find((q) => q.id === t.question.id)?.conceptIds ?? [])],
              correct: t.correct,
              by: t.kind === 'help_result' ? ('help' as const) : ('student' as const),
            }]
          : [],
      ),
      teachCount: run.learning.teachCount,
      questionsAsked: asked.length,
      questionsAnswered: asked.filter((q) => q.status === 'answered').length,
      questionsSkipped: asked.filter((q) => q.status === 'skipped').length,
    },
  ];
}

export async function takeTurn(deps: EngineDeps, ctx: EngineContext, input: Run): Promise<TurnOutcome> {
  if (input.phase === 'learning') throw new AppError('wrong_phase', 'no fight in the learning phase');
  const run = structuredClone(input);

  if (run.phase === 'room_result') {
    const room = run.room!;
    const failedTurns = room.log
      .filter((t): t is StudentAnswerTurn => t.kind === 'student_answer' && !t.correct)
      .map((t) => ({ question: t.question, reasoning: t.reasoning, citedNotes: t.citedNotes }));
    return { run, result: { kind: 'room_end', passed: room.passed === true, hearts: room.hearts, failedTurns }, stats: [] };
  }
  if (run.phase === 'results') {
    return { run, result: { kind: 'boss_end', results: structuredClone(run.results!) }, stats: [] };
  }

  const { kind, f } = fightOf(run);

  // 1. A pending "Help me!" event.
  if (run.pendingHelpMe) {
    const p = run.pendingHelpMe;
    const expired = p.deadline !== null && deps.clock.now().getTime() > new Date(p.deadline).getTime();
    if (!expired) return { run, result: helpMeTurnOf(run, questionById(ctx.questions, p.questionId)), stats: [] };
    return resolveHelp(deps, ctx, run, null, true);
  }

  const q = questionById(ctx.questions, f.questionIds[f.turn]);
  const now = deps.clock.now();

  // 2. Roll for "Help me!".
  const cap = kind === 'room' ? deps.config.helpMeMaxPerRoom : deps.config.helpMeMaxPerBoss;
  if (q.type !== 'free_response' && f.helpMeUsed < cap && deps.rng.next() < deps.config.helpMeProb) {
    const timeBudgetSec = Math.max(1, Math.round(q.timeBudgetSec * deps.config.helpMeTimeMultiplier));
    run.pendingHelpMe = {
      eventId: `help_${fightKey(run)}_t${f.turn}`,
      questionId: q.id,
      startedAt: nowIso(now),
      timeBudgetSec,
      deadline: deps.config.helpMeTimed ? nowIso(new Date(now.getTime() + timeBudgetSec * 1000)) : null,
    };
    f.helpMeUsed += 1;
    run.helpMeTally.offered += 1;
    const result = helpMeTurnOf(run, q);
    f.log.push(result);
    run.updatedAt = nowIso(now);
    return { run, result, stats: [] };
  }

  // 3. The student answers from its notebook only.
  const pq = toPublicQuestion(q);
  const out = await deps.tasks.studentAnswer(
    { notebookMd: run.notebookMd, question: pq },
    {
      question: q,
      keyPoints: ctx.pack.concepts
        .flatMap((c) => c.keyPoints)
        .filter((k) => q.keyPointIds.includes(k.id))
        .map((k) => ({ id: k.id, statement: k.statement })),
      misconceptions: allMisconceptions(ctx.pack),
      activeMisconceptionIds: activeMisconceptionIds(run),
    },
  );
  const answer: Answer = answerFitsQuestion(pq, out.answer) ? out.answer : { dontKnow: true };
  const g = await grade(deps, ctx, run, q, answer);
  const citedNotes = out.citedNotes ?? [];
  const grounded = citedNotes.some((c) => citationMatches(c, run.notebookMd));
  const correct = g.correct && grounded;
  const reason = correct
    ? undefined
    : g.dontKnow || (g.correct && !grounded)
      ? ('not in my notes' as const)
      : g.misconceptionIds.length > 0
        ? ('wrong belief' as const)
        : ('unknown' as const);

  const d = advance(run, ctx, deps, correct);
  const result: StudentAnswerTurn = {
    kind: 'student_answer',
    question: pq,
    answer,
    answerText: formatAnswer(pq, answer),
    correct,
    correctAnswer: correctAnswerOf(q),
    explanation: q.explanation,
    reasoning: out.reasoning,
    citedNotes,
    ...(reason ? { reason } : {}),
    damage: d.damage,
    ...damageFields(d),
    phaseAfter: run.phase,
  };
  logTurn(run, result, ctx, deps);
  run.updatedAt = nowIso(now);
  return { run, result, stats: [{ questionId: q.id, kind: correct ? 'student_correct' : 'student_wrong' }] };
}

export async function submitHelp(
  deps: EngineDeps,
  ctx: EngineContext,
  input: Run,
  eventId: string,
  answer: Answer,
): Promise<TurnOutcome> {
  if (input.phase !== 'room' && input.phase !== 'boss') {
    throw new AppError('wrong_phase', `"Help me!" is not allowed in phase "${input.phase}"`);
  }
  if (!input.pendingHelpMe || input.pendingHelpMe.eventId !== eventId) {
    throw new AppError('help_event_not_pending', `event ${eventId} is not pending`);
  }
  const q = questionById(ctx.questions, input.pendingHelpMe.questionId);
  if (!answerFitsQuestion(toPublicQuestion(q), answer)) {
    throw new AppError('invalid_answer', `the answer does not fit a ${q.type} question`);
  }
  return resolveHelp(deps, ctx, structuredClone(input), answer, false);
}

/** POST /continue: next room's learning, or the boss after the last room. */
export function continueRun(deps: EngineDeps, ctx: EngineContext, input: Run): { run: Run } {
  assertPhase(input, 'room_result');
  if (input.room?.passed !== true) throw new AppError('wrong_phase', 'the room was failed: use retry');
  const run = structuredClone(input);
  run.room = undefined;
  run.learning = { pendingQuestions: [], teachCount: 0 };
  const nextIndex = run.roomIndex + 1;

  if (nextIndex < run.scope.roomIds.length) {
    const next = roomById(ctx.pack, run.scope.roomIds[nextIndex]);
    if (!roomReady(ctx.pack, next)) throw new AppError('room_not_ready', `room ${next.id} is still being prepared`);
    run.roomIndex = nextIndex;
    run.phase = 'learning';
  } else {
    const scopeIds = scopeConceptIds(run, ctx.pack);
    const pool = poolFor(ctx.questions, scopeIds);
    if (pool.length === 0) throw new AppError('room_not_ready', 'no questions for the boss yet');
    const active = run.hidden.misconceptions
      .filter((s) => s.status === 'active' && scopeIds.includes(s.conceptId))
      .map((s) => misconceptionById(ctx.pack, s.id))
      .filter((m) => !!m)
      .sort((a, b) => b.likelihood - a.likelihood);
    const draw = composeBoss(pool, scopeIds, active, deps.config.bossQuestions, deps.config.bossTargetedShare, deps.rng);
    run.roomIndex = run.scope.roomIds.length;
    run.phase = 'boss';
    run.boss = { ...draw, turn: 0, health: 100, helpMeUsed: 0, log: [] };
  }
  run.updatedAt = nowIso(deps.clock.now());
  return { run };
}
