import type { Concept, CoursePack, Misconception, Question, Room, Run } from '@top/shared';
import { AppError } from '../errors';

export const nowIso = (d: Date): string => d.toISOString();

export function roomById(pack: CoursePack, id: string): Room {
  const room = pack.rooms.find((r) => r.id === id);
  if (!room) throw new AppError('not_found', `unknown room ${id}`);
  return room;
}

/** The room the run is currently on (learning, room, room_result). */
export function currentRoom(run: Run, pack: CoursePack): Room {
  return roomById(pack, run.scope.roomIds[run.roomIndex]);
}

export function conceptOf(pack: CoursePack, id: string): Concept | undefined {
  return pack.concepts.find((c) => c.id === id);
}

/** Concept ids of the rooms in scope, in play order. */
export function scopeConceptIds(run: Run, pack: CoursePack): string[] {
  const ids: string[] = [];
  for (const rid of run.scope.roomIds) {
    for (const cid of roomById(pack, rid).conceptIds) if (!ids.includes(cid)) ids.push(cid);
  }
  return ids;
}

/** Concept titles in scope order: the section order of the notebook. */
export function scopeTitles(run: Run, pack: CoursePack): string[] {
  return scopeConceptIds(run, pack).map((id) => conceptOf(pack, id)?.title ?? id);
}

export function conceptTitle(pack: CoursePack, id: string): string {
  return conceptOf(pack, id)?.title ?? id;
}

export function allMisconceptions(pack: CoursePack): Misconception[] {
  return pack.concepts.flatMap((c) => c.misconceptions);
}

export function misconceptionById(pack: CoursePack, id: string): Misconception | undefined {
  return allMisconceptions(pack).find((m) => m.id === id);
}

export function roomReady(pack: CoursePack, room: Room): boolean {
  return room.conceptIds.every((c) => pack.status.conceptsReady.includes(c));
}

/** Verified questions whose concepts are ALL inside `conceptIds`. */
export function poolFor(questions: Question[], conceptIds: string[]): Question[] {
  return questions.filter((q) => q.verified && q.conceptIds.every((c) => conceptIds.includes(c)));
}

export function questionById(ctxQuestions: Question[], id: string): Question {
  const q = ctxQuestions.find((x) => x.id === id);
  if (!q) throw new AppError('not_found', `unknown question ${id}`);
  return q;
}

export function activeMisconceptionIds(run: Run): string[] {
  return run.hidden.misconceptions.filter((m) => m.status === 'active').map((m) => m.id);
}
