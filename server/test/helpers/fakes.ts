/** Scripted fakes: GameplayTasks, Retriever, a clock you can advance, and a scriptable RNG. */
import type { Answer, Question } from '@pips-notebook/shared';
import { correctAnswerOf, mappedMisconceptionIds, wrongAnswerFor } from '../../src/core/grading';
import type { Rng } from '../../src/core/rng';
import type { Clock } from '../../src/engine/types';
import type {
  GameplayTasks, StudentAnswerInput, StudentOracle, StudentReviewInput, StudentReviewOutput,
} from '../../src/llm/types';
import type { Retriever } from '../../src/rag/types';

export interface TestClock extends Clock {
  advance(seconds: number): void;
}
export function createTestClock(startIso = '2025-01-01T00:00:00.000Z'): TestClock {
  let t = new Date(startIso).getTime();
  return { now: () => new Date(t), advance: (s) => void (t += s * 1000) };
}

/** An RNG that always returns `value` (0 or 0.99, say). shuffle keeps the order. */
export function constRng(value: number): Rng {
  return {
    next: () => value,
    int: (n) => Math.floor(value * n),
    pick: (items) => items[Math.floor(value * items.length)],
    shuffle: (items) => [...items],
    state: () => 0,
  };
}

export const fakeRetriever: Retriever = { retrieve: async () => [] };

/**
 * auto        correct (grounded), except wrong-belief when an active misconception's belief line is in the notebook
 * correct     always the right answer, citing the first note
 * wrong       a wrong answer (grounded)
 * dontKnow    "I don't know"
 * ungrounded  the right answer citing a line that is not in the notebook
 */
export type StudentMode = 'auto' | 'correct' | 'wrong' | 'dontKnow' | 'ungrounded';

export interface ScriptedTasks extends GameplayTasks {
  mode: StudentMode;
  /** Override the review; default: one note per sentence, probe the first probeable ids. */
  review?: (input: StudentReviewInput) => Partial<StudentReviewOutput>;
  resolves: boolean;
  openCorrect: boolean;
  calls: { review: StudentReviewInput[]; studentAnswer: StudentAnswerInput[]; checkResolution: unknown[]; gradeOpen: unknown[] };
}

export const bulletsOf = (md: string): string[] =>
  md.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());

function genericWrong(q: Question): Answer {
  if (q.type === 'mcq') return { choiceIndex: 0 }; // plain wrong option, no misconception
  const mid = mappedMisconceptionIds(q)[0];
  return (mid && wrongAnswerFor(q, mid)) || { dontKnow: true };
}

export function createScriptedTasks(init: Partial<Pick<ScriptedTasks, 'mode' | 'review' | 'resolves' | 'openCorrect'>> = {}): ScriptedTasks {
  const t: ScriptedTasks = {
    mode: 'auto', resolves: true, openCorrect: true, ...init,
    calls: { review: [], studentAnswer: [], checkResolution: [], gradeOpen: [] },
    async studentReview(input) {
      t.calls.review.push(input);
      const sentences = input.explanation.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
      const base: StudentReviewOutput = {
        notesToAdd: sentences.map((text) => ({ conceptId: input.concepts[0].id, text })),
        statedMisconceptionIds: [],
        questions: input.probeableMisconceptionIds.slice(0, input.maxQuestions).map((id) => ({
          misconceptionId: id,
          text: `Is it true that ${input.misconceptions.find((m) => m.id === id)?.beliefStatement ?? id}?`,
        })),
        resolvedMisconceptionIds: [],
      };
      return { ...base, ...(t.review?.(input) ?? {}) };
    },
    async checkResolution(input) {
      t.calls.checkResolution.push(input);
      return { resolved: t.resolves, noteToAdd: t.resolves ? input.misconception.correction : '', why: 'scripted' };
    },
    async studentAnswer(input, oracle?: StudentOracle) {
      t.calls.studentAnswer.push(input);
      const q = oracle!.question;
      const notes = bulletsOf(input.notebookMd);
      const first = notes[0];
      const right = { answer: correctAnswerOf(q).answer, reasoning: 'from my notes', citedNotes: first ? [first] : [] };
      switch (t.mode) {
        case 'correct': return right;
        case 'ungrounded': return { ...right, citedNotes: ['a line that is not in my notebook'] };
        case 'dontKnow': return { answer: { dontKnow: true }, reasoning: 'not covered', citedNotes: [] };
        case 'wrong': return { answer: genericWrong(q), reasoning: 'scripted wrong', citedNotes: first ? [first] : [] };
        case 'auto': {
          for (const id of oracle!.activeMisconceptionIds) {
            const m = oracle!.misconceptions.find((x) => x.id === id);
            const wrong = wrongAnswerFor(q, id);
            if (m && wrong && notes.includes(m.beliefStatement)) {
              return { answer: wrong, reasoning: 'my notes say so', citedNotes: [m.beliefStatement] };
            }
          }
          return right;
        }
      }
    },
    async gradeOpen(input) {
      t.calls.gradeOpen.push(input);
      return { correct: t.openCorrect, misconceptionIds: [], feedback: 'scripted' };
    },
  };
  return t;
}
