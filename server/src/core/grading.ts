/**
 * Deterministic grading for every question type (SPEC 2.9), shared by the engine (fight turns),
 * ingest (does verification agree with the key?), the mock student and the tests.
 *
 * This module only does what code can decide. Two things live elsewhere:
 *   - the LLM rubric fallback for `short_text` / `free_response` (`GameplayTasks.gradeOpen`): this
 *     module answers `needs_llm` for those cases;
 *   - the grounding rule ("correct only with a valid notebook citation"), which the engine applies
 *     on top of the outcome.
 */
import type { Answer, PublicQuestion, Question, RevealedAnswer } from '@pips-notebook/shared';

export type GradeStatus =
  /** Right by the type's rule. */
  | 'correct'
  /** Wrong by the type's rule. `misconceptionIds` lists the wrong-answer paths it followed, if any. */
  | 'incorrect'
  /** Code cannot decide: ask `GameplayTasks.gradeOpen` (short_text with no match, free_response). */
  | 'needs_llm'
  /** The answer does not fit the question type (missing field, index out of range). */
  | 'invalid';

export interface GradeOutcome {
  status: GradeStatus;
  /** Misconceptions whose wrong-answer path this answer followed. Empty unless status is 'incorrect'. */
  misconceptionIds: string[];
  /** True when the answer was "I don't know". */
  dontKnow: boolean;
}

const outcome = (status: GradeStatus, misconceptionIds: string[] = [], dontKnow = false): GradeOutcome => ({
  status,
  misconceptionIds: [...new Set(misconceptionIds)],
  dontKnow,
});

// ── Text normalization ──────────────────────────────────────────────────────

/** Lowercase, NFKC, trimmed, single spaces, without wrapping quotes/backticks or a trailing . ! */
export function normalizeText(text: string): string {
  let s = text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  // Repeat so that `"answer".` loses both the period and the quotes.
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim();
    s = s.replace(/[.!]+$/g, '').trim();
    if (s === before) break;
  }
  return s;
}

/** `normalizeText` with all whitespace removed, so "[1, 2]" equals "[1,2]" and "O(log n)" equals "O(logn)". */
export function compactText(text: string): string {
  return normalizeText(text).replace(/\s+/g, '');
}

export function textMatches(a: string, b: string): boolean {
  const ca = compactText(a);
  return ca.length > 0 && ca === compactText(b);
}

const sameSet = (a: number[], b: number[]): boolean => {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === a.length && sa.size === sb.size && [...sa].every((x) => sb.has(x));
};

const sameOrder = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const withinNumeric = (value: number, answer: number, tolerance: { kind: 'abs' | 'rel'; value: number }): boolean => {
  const allowed = tolerance.kind === 'abs' ? tolerance.value : tolerance.value * Math.abs(answer);
  // The epsilon absorbs float noise such as 0.1 + 0.2.
  return Math.abs(value - answer) <= allowed + 1e-9;
};

// ── Shape check ─────────────────────────────────────────────────────────────

/** Does the answer carry the field this question type needs, with indexes in range? */
export function answerFitsQuestion(question: Question | PublicQuestion, answer: Answer): boolean {
  if (answer.dontKnow) return true;
  const inRange = (i: unknown, n: number): boolean => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < n;
  switch (question.type) {
    case 'mcq':
      return inRange(answer.choiceIndex, question.payload.options.length);
    case 'true_false':
      return typeof answer.value === 'boolean';
    case 'multi_select': {
      const n = question.payload.options.length;
      const idx = answer.choiceIndexes;
      return Array.isArray(idx) && new Set(idx).size === idx.length && idx.every((i) => inRange(i, n));
    }
    case 'numeric':
      return typeof answer.value === 'number' && Number.isFinite(answer.value);
    case 'short_text':
    case 'free_response':
      return typeof answer.text === 'string' && answer.text.trim().length > 0;
    case 'ordering': {
      const n = question.payload.items.length;
      const order = answer.order;
      return Array.isArray(order) && order.length === n && new Set(order).size === n && order.every((i) => inRange(i, n));
    }
  }
}

// ── Grading ─────────────────────────────────────────────────────────────────

export function gradeDeterministic(question: Question, answer: Answer): GradeOutcome {
  if (answer.dontKnow) return outcome('incorrect', [], true);
  if (!answerFitsQuestion(question, answer)) return outcome('invalid');

  switch (question.type) {
    case 'mcq': {
      const i = answer.choiceIndex as number;
      if (i === question.payload.correctIndex) return outcome('correct');
      const m = question.payload.options[i].misconceptionId;
      return outcome('incorrect', m ? [m] : []);
    }
    case 'true_false': {
      if (answer.value === question.payload.correctValue) return outcome('correct');
      const m = question.payload.wrongMisconceptionId;
      return outcome('incorrect', m ? [m] : []);
    }
    case 'multi_select': {
      const chosen = answer.choiceIndexes as number[];
      if (sameSet(chosen, question.payload.correctIndexes)) return outcome('correct');
      const wrongPicks = chosen.filter((i) => !question.payload.correctIndexes.includes(i));
      const ids = wrongPicks.map((i) => question.payload.options[i].misconceptionId).filter((m): m is string => !!m);
      return outcome('incorrect', ids);
    }
    case 'numeric': {
      const value = answer.value as number;
      if (withinNumeric(value, question.payload.answer, question.payload.tolerance)) return outcome('correct');
      const hit = question.payload.wrongAnswers.find((w) => Math.abs(value - w.value) <= w.tolerance + 1e-9);
      return outcome('incorrect', hit ? [hit.misconceptionId] : []);
    }
    case 'short_text': {
      const text = answer.text as string;
      if (question.payload.acceptedAnswers.some((a) => textMatches(a, text))) return outcome('correct');
      const compact = compactText(text);
      const hits = question.payload.wrongAnswers.filter((w) => {
        const pattern = compactText(w.pattern);
        return pattern.length > 0 && compact.includes(pattern);
      });
      if (hits.length > 0) return outcome('incorrect', hits.map((h) => h.misconceptionId));
      return outcome('needs_llm');
    }
    case 'ordering': {
      const order = answer.order as number[];
      if (sameOrder(order, question.payload.correctOrder)) return outcome('correct');
      const hit = question.payload.wrongOrders.find((w) => sameOrder(order, w.order));
      return outcome('incorrect', hit ? [hit.misconceptionId] : []);
    }
    case 'free_response':
      return outcome('needs_llm');
  }
}

// ── Answer keys ─────────────────────────────────────────────────────────────

/** Display form of an answer for a question (option text, "True", "12 m", "A → B → C", ...). */
export function formatAnswer(question: Question | PublicQuestion, answer: Answer): string {
  if (answer.dontKnow) return "I don't know";
  if (!answerFitsQuestion(question, answer)) return '(no answer)';
  const optionText = (o: string | { text: string }): string => (typeof o === 'string' ? o : o.text);
  switch (question.type) {
    case 'mcq':
      return optionText(question.payload.options[answer.choiceIndex as number]);
    case 'true_false':
      return answer.value ? 'True' : 'False';
    case 'multi_select': {
      const picks = [...(answer.choiceIndexes as number[])].sort((a, b) => a - b);
      return picks.length === 0 ? '(none)' : picks.map((i) => optionText(question.payload.options[i])).join('; ');
    }
    case 'numeric': {
      const unit = question.payload.unit;
      return unit ? `${answer.value} ${unit}` : String(answer.value);
    }
    case 'short_text':
    case 'free_response':
      return (answer.text as string).trim();
    case 'ordering':
      return (answer.order as number[]).map((i) => question.payload.items[i]).join(' → ');
  }
}

/** The correct answer, in `Answer` form plus display text. Reveal only AFTER the question is answered. */
export function correctAnswerOf(question: Question): RevealedAnswer {
  let answer: Answer;
  switch (question.type) {
    case 'mcq':
      answer = { choiceIndex: question.payload.correctIndex };
      break;
    case 'true_false':
      answer = { value: question.payload.correctValue };
      break;
    case 'multi_select':
      answer = { choiceIndexes: [...question.payload.correctIndexes].sort((a, b) => a - b) };
      break;
    case 'numeric':
      answer = { value: question.payload.answer };
      break;
    case 'short_text':
      answer = { text: question.payload.acceptedAnswers[0] };
      break;
    case 'ordering':
      answer = { order: [...question.payload.correctOrder] };
      break;
    case 'free_response':
      answer = { text: question.payload.modelAnswer ?? question.solution.finalAnswer };
      break;
  }
  return { answer, text: formatAnswer(question, answer) };
}

// ── Misconception paths ─────────────────────────────────────────────────────

/**
 * An answer that follows the wrong-answer path mapped to `misconceptionId`, or null when this
 * question has no such path. For `free_response` there is no deterministic path, so it is null even
 * if the id is listed in `question.misconceptionIds`.
 */
export function wrongAnswerFor(question: Question, misconceptionId: string): Answer | null {
  switch (question.type) {
    case 'mcq': {
      const i = question.payload.options.findIndex((o) => o.misconceptionId === misconceptionId);
      return i >= 0 ? { choiceIndex: i } : null;
    }
    case 'true_false':
      return question.payload.wrongMisconceptionId === misconceptionId ? { value: !question.payload.correctValue } : null;
    case 'multi_select': {
      const i = question.payload.options.findIndex((o) => o.misconceptionId === misconceptionId);
      return i >= 0 ? { choiceIndexes: [i] } : null;
    }
    case 'numeric': {
      const w = question.payload.wrongAnswers.find((x) => x.misconceptionId === misconceptionId);
      return w ? { value: w.value } : null;
    }
    case 'short_text': {
      const w = question.payload.wrongAnswers.find((x) => x.misconceptionId === misconceptionId);
      return w ? { text: w.pattern } : null;
    }
    case 'ordering': {
      const w = question.payload.wrongOrders.find((x) => x.misconceptionId === misconceptionId);
      return w ? { order: [...w.order] } : null;
    }
    case 'free_response':
      return null;
  }
}

/** Every misconception id that has a deterministic wrong-answer path in this question. */
export function mappedMisconceptionIds(question: Question): string[] {
  const ids: (string | null)[] = [];
  switch (question.type) {
    case 'mcq':
    case 'multi_select':
      ids.push(...question.payload.options.map((o) => o.misconceptionId));
      break;
    case 'true_false':
      ids.push(question.payload.wrongMisconceptionId);
      break;
    case 'numeric':
    case 'short_text':
      ids.push(...question.payload.wrongAnswers.map((w) => w.misconceptionId));
      break;
    case 'ordering':
      ids.push(...question.payload.wrongOrders.map((w) => w.misconceptionId));
      break;
    case 'free_response':
      break;
  }
  return [...new Set(ids.filter((m): m is string => !!m))];
}

/**
 * Does this question have a wrong-answer path for the misconception? Counts the LLM-classified path
 * of `free_response` too (listed in `question.misconceptionIds`). Used for coverage and boss targeting.
 */
export function targetsMisconception(question: Question, misconceptionId: string): boolean {
  if (question.type === 'free_response') return question.misconceptionIds.includes(misconceptionId);
  return mappedMisconceptionIds(question).includes(misconceptionId);
}
