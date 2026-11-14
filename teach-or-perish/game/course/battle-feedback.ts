import type { TurnResult } from './api-client.js';
import { el, inline, markdown, questionEl } from './ui.js';

type AnswerTurn = Extract<TurnResult, { kind: 'student_answer' | 'help_result' }>;
const reasons: Record<string, string> = {
  'not in my notes': 'The answer was not supported by the student’s notebook.',
  'wrong belief': 'The answer followed a misconception in the notebook.',
  unknown: 'The answer did not satisfy the grading criteria.',
};

export function turnCard(event: AnswerTurn): HTMLDetailsElement {
  const field = (label: string, text: string) => el('div', 'turn-field', el('span', 'turn-label', label), markdown(text));
  const body = el('div', 'turn-body', questionEl(event.question, false));
  if (event.kind === 'student_answer') {
    body.append(field('Student answer', event.answerText), field('Student reasoning', event.reasoning));
    const notes = event.citedNotes.length ? el('ul', '', ...event.citedNotes.map(note => el('li', '', inline(note)))) : el('p', 'dim', 'No notes cited.');
    body.append(el('div', 'turn-field', el('span', 'turn-label', 'Notebook evidence'), notes));
    if (event.reason) body.append(el('p', 'turn-reason dim', reasons[event.reason] ?? event.reason));
  } else {
    body.append(field('Teacher help', event.late ? 'The deadline passed before help arrived.' : `Answer received in ${event.solveTimeSec}s.`));
    if (event.noteAdded) body.append(field('Notebook update', event.noteAdded));
  }
  body.append(field('Expected answer', event.correctAnswer.text), field('Explanation', event.explanation));
  const amount = Number(event.damage.toFixed(1));
  const unit = event.health !== undefined ? 'health' : amount === 1 ? 'heart' : 'hearts';
  body.append(el('div', 'turn-damage', amount === 0 ? 'No damage' : `Damage: ${amount} ${unit}`));
  return el('details', 'turn-card', el('summary', '', el('span', 'turn-summary-text', inline(event.question.prompt)),
    el('span', event.correct ? 'turn-outcome ok' : 'turn-outcome bad', event.correct ? 'Correct' : 'Incorrect')), body);
}
