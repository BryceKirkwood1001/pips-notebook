import type {
  CoursePack,
  HelpMeTurn,
  PublicQuestion,
  PublicRoomReport,
  PublicRun,
  PublicRunRoom,
  PublicStudentQuestion,
  Question,
  Run,
  StudentQuestion,
} from '@top/shared';
import type { Config } from '../config';
import type { EngineContext } from './types';
import { conceptTitle, misconceptionById, roomReady } from './scope';

/** A learning-phase question without its misconception id; the concept it is about is public. */
export function toPublicStudentQuestion(q: StudentQuestion, pack: CoursePack): PublicStudentQuestion {
  const conceptId = misconceptionById(pack, q.misconceptionId)?.conceptId;
  return { id: q.id, text: q.text, status: q.status, ...(conceptId ? { conceptId } : {}) };
}

/** Finished room attempts, restating only turns and learning counts the player already saw. */
export function toPublicHistory(run: Run, pack: CoursePack): PublicRoomReport[] {
  return (run.history ?? []).map((h) => ({
    roomId: h.roomId,
    title: pack.rooms.find((r) => r.id === h.roomId)?.title ?? h.roomId,
    attempt: h.attempt,
    passed: h.passed,
    hearts: h.hearts,
    maxHearts: h.maxHearts,
    correct: h.turns.filter((t) => t.correct).length,
    total: h.turns.length,
    helped: h.turns.filter((t) => t.by === 'help').length,
    teachCount: h.teachCount,
    questionsAsked: h.questionsAsked,
    questionsAnswered: h.questionsAnswered,
    questionsSkipped: h.questionsSkipped,
    missed: h.turns
      .filter((t) => !t.correct)
      .map((t) => ({
        prompt: t.prompt,
        by: t.by,
        concepts: t.conceptIds.map((id) => ({ id, title: conceptTitle(pack, id) })),
      })),
  }));
}

/** The ONLY way an unanswered question leaves the server. Built field by field. */
export function toPublicQuestion(q: Question): PublicQuestion {
  const base = { id: q.id, prompt: q.prompt, difficulty: q.difficulty, timeBudgetSec: q.timeBudgetSec };
  switch (q.type) {
    case 'mcq':
      return { ...base, type: 'mcq', payload: { options: q.payload.options.map((o) => o.text) } };
    case 'multi_select':
      return { ...base, type: 'multi_select', payload: { options: q.payload.options.map((o) => o.text) } };
    case 'true_false':
      return { ...base, type: 'true_false', payload: { statement: q.payload.statement } };
    case 'numeric':
      return { ...base, type: 'numeric', payload: { unit: q.payload.unit } };
    case 'short_text':
      return { ...base, type: 'short_text', payload: {} };
    case 'ordering':
      return { ...base, type: 'ordering', payload: { items: [...q.payload.items] } };
    case 'free_response':
      return { ...base, type: 'free_response', payload: {} };
  }
}

function publicRooms(run: Run, pack: CoursePack): PublicRunRoom[] {
  return run.scope.roomIds.map((rid, i) => {
    const room = pack.rooms.find((r) => r.id === rid);
    return {
      id: rid,
      title: room?.title ?? rid,
      ...(room?.description ? { description: room.description } : {}),
      ...(room?.learningObjectives ? { learningObjectives: [...room.learningObjectives] } : {}),
      concepts: (room?.conceptIds ?? []).map((id) => ({ id, title: conceptTitle(pack, id), summary: pack.concepts.find(c => c.id === id)?.summary ?? '' })),
      ready: room ? roomReady(pack, room) : false,
      state: i < run.roomIndex ? 'passed' : i === run.roomIndex ? 'current' : 'upcoming',
    };
  });
}

/** What the client may see of a run (SPEC 4.3). Every field is copied explicitly: never spread the run. */
export function toPublicRun(run: Run, ctx: EngineContext, config: Config): PublicRun {
  const rooms = publicRooms(run, ctx.pack);

  let pendingHelpMe: HelpMeTurn | undefined;
  if (run.pendingHelpMe) {
    const q = ctx.questions.find((x) => x.id === run.pendingHelpMe?.questionId);
    if (q) {
      pendingHelpMe = {
        kind: 'help_me',
        eventId: run.pendingHelpMe.eventId,
        question: toPublicQuestion(q),
        timeBudgetSec: run.pendingHelpMe.timeBudgetSec,
        deadline: run.pendingHelpMe.deadline,
      };
    }
  }

  const out: PublicRun = {
    id: run.id,
    courseId: run.courseId,
    courseTitle: ctx.pack.title,
    targetGrade: run.targetGrade,
    studentEmoji: run.studentEmoji,
    phase: run.phase,
    roomIndex: run.roomIndex,
    rooms,
    currentRoom: rooms[run.roomIndex] ?? null,
    notebookMd: run.notebookMd,
    learning: {
      pendingQuestions: run.learning.pendingQuestions.map((q) => toPublicStudentQuestion(q, ctx.pack)),
      teachCount: run.learning.teachCount,
    },
    rules: {
      roomQuestions: config.roomQuestions,
      roomHearts: config.roomHearts,
      bossQuestions: config.bossQuestions,
      maxStudentQuestions: config.maxStudentQuestions,
      helpMeTimed: config.helpMeTimed,
    },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
  if (run.room) {
    out.room = {
      attempt: run.room.attempt,
      turn: run.room.turn,
      totalTurns: run.room.questionIds.length,
      hearts: run.room.hearts,
      maxHearts: config.roomHearts,
      helpMeUsed: run.room.helpMeUsed,
      log: structuredClone(run.room.log),
      ...(run.room.passed !== undefined ? { passed: run.room.passed } : {}),
    };
  }
  if (run.boss) {
    out.boss = {
      turn: run.boss.turn,
      totalTurns: run.boss.questionIds.length,
      health: run.boss.health,
      helpMeUsed: run.boss.helpMeUsed,
      log: structuredClone(run.boss.log),
    };
  }
  if (pendingHelpMe) out.pendingHelpMe = pendingHelpMe;
  if (run.history?.length) out.history = toPublicHistory(run, ctx.pack);
  if (run.results) out.results = structuredClone(run.results);
  if (run.pausedAt) out.pausedAt = run.pausedAt;
  if (run.endedAt) out.endedAt = run.endedAt;
  return out;
}
