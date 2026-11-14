/** Deterministic, LLM-free gameplay tasks. Tests and the end-to-end script depend on these exact rules. */
import { compactText, correctAnswerOf, normalizeText, wrongAnswerFor } from '../../core/grading';
import { coverage, keywords } from '../mock-text';
import type {
  CheckResolutionInput,
  CheckResolutionOutput,
  GameplayTasks,
  GradeOpenInput,
  GradeOpenOutput,
  StudentAnswerInput,
  StudentAnswerOutput,
  StudentOracle,
  StudentReviewInput,
  StudentReviewOutput,
} from '../types';

export const MOCK_MIN_SHARED_KEYWORDS = 2;

/** Bullet lines of the notebook without the "- " prefix. */
export function notebookNotes(notebookMd: string): string[] {
  return notebookMd
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l.length > 0);
}

function mockStudentAnswer(input: StudentAnswerInput, oracle?: StudentOracle): StudentAnswerOutput {
  const dontKnow = (reasoning: string): StudentAnswerOutput => ({
    answer: { dontKnow: true },
    reasoning,
    citedNotes: [],
  });
  if (!oracle) return dontKnow("I can't tell from my notes.");

  const notes = notebookNotes(input.notebookMd);

  // Wrong belief first: a note that equals an active misconception's belief statement.
  for (const id of oracle.activeMisconceptionIds) {
    const m = oracle.misconceptions.find((x) => x.id === id);
    if (!m) continue;
    const note = notes.find((n) => normalizeText(n) === normalizeText(m.beliefStatement));
    if (!note) continue;
    const wrong = wrongAnswerFor(oracle.question, id);
    if (wrong) return { answer: wrong, reasoning: `My notes say: ${note}`, citedNotes: [note] };
  }

  const correct = correctAnswerOf(oracle.question);
  const target = keywords(`${input.question.prompt} ${correct.text}`);
  let best = -1;
  let bestScore = 0;
  notes.forEach((n, i) => {
    let score = 0;
    for (const k of keywords(n)) if (target.has(k)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (best >= 0 && bestScore >= MOCK_MIN_SHARED_KEYWORDS) {
    return { answer: correct.answer, reasoning: `My notes say: ${notes[best]}`, citedNotes: [notes[best]] };
  }
  return dontKnow("My notes don't cover this question.");
}

const lowerFirst = (s: string) => (s.length ? s[0].toLowerCase() + s.slice(1) : s);

function mockStudentReview(input: StudentReviewInput): StudentReviewOutput {
  const sentences = input.explanation
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= 3)
    .slice(0, 12);

  const notesToAdd = sentences.map((text) => {
    let conceptId = input.concepts[0]?.id ?? '';
    let best = 0;
    for (const c of input.concepts) {
      const score = [...keywords(text)].filter((k) => keywords(`${c.title} ${c.summary}`).has(k)).length;
      if (score > best) {
        best = score;
        conceptId = c.id;
      }
    }
    return { conceptId, text };
  });

  const compactExplanation = compactText(input.explanation);
  const stated = input.misconceptions
    .filter((m) => compactExplanation.includes(compactText(m.beliefStatement)))
    .map((m) => m.id);
  const statedSet = new Set(stated);
  const byId = new Map(input.misconceptions.map((m) => [m.id, m]));

  const resolved = input.activeMisconceptionIds.filter((id) => {
    const m = byId.get(id);
    return !!m && !statedSet.has(id) && coverage(m.correction, input.explanation) >= 0.6;
  });

  const questions = input.probeableMisconceptionIds
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => !!m && !statedSet.has(m.id) && coverage(m.correction, input.explanation) < 0.6)
    .sort((a, b) => b.likelihood - a.likelihood || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, input.maxQuestions))
    .map((m) => ({
      misconceptionId: m.id,
      text: `Quick question: is it right that ${lowerFirst(m.beliefStatement.trim().replace(/\.+$/, ''))}?`,
    }));

  return { notesToAdd, statedMisconceptionIds: stated, questions, resolvedMisconceptionIds: resolved };
}

function mockCheckResolution(input: CheckResolutionInput): CheckResolutionOutput {
  const m = input.misconception;
  const containsBelief = compactText(input.answer).includes(compactText(m.beliefStatement));
  const resolved = coverage(m.correction, input.answer) >= 0.5 && !containsBelief;
  return {
    resolved,
    noteToAdd: resolved ? m.correction : '',
    why: resolved ? 'The answer covers the correction.' : 'The answer does not clearly correct the belief.',
  };
}

function mockGradeOpen(input: GradeOpenInput): GradeOpenOutput {
  const q = input.question;
  const reference =
    q.type === 'short_text' ? q.payload.acceptedAnswers[0] : q.type === 'free_response' && q.payload.modelAnswer ? q.payload.modelAnswer : q.solution.finalAnswer;
  const correct = coverage(reference, input.answerText) >= 0.6;
  const misconceptionIds = correct
    ? []
    : input.candidateMisconceptions.filter((m) => coverage(m.beliefStatement, input.answerText) >= 0.6).map((m) => m.id);
  return {
    correct,
    misconceptionIds,
    feedback: correct ? 'Matches the reference answer.' : 'Does not match the reference answer.',
  };
}

export function createMockGameplayTasks(): GameplayTasks {
  return {
    studentReview: async (i) => mockStudentReview(i),
    checkResolution: async (i) => mockCheckResolution(i),
    studentAnswer: async (i, o) => mockStudentAnswer(i, o),
    gradeOpen: async (i) => mockGradeOpen(i),
  };
}
