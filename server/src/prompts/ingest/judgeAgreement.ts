import type { Question } from '@top/shared';
import { system, wrap } from './common';

export const JUDGE_AGREEMENT_SYSTEM = system(
  [
    'Task: decide whether a candidate answer agrees with the answer key of a question.',
    'Agree when the candidate states the same result or the same essential points as the key, even if worded differently, in a different unit form or in a different order. Disagree when it contradicts the key or misses a required point. Do not judge whether the key itself is right.',
    'Reply with "agrees" (true or false) and "why" (one sentence).',
  ].join('\n'),
);

/** The key in words, per question type. */
export function keyText(q: Question): string {
  const p = q.payload as Record<string, any>;
  const parts = [`Final answer: ${q.solution.finalAnswer}`];
  switch (q.type) {
    case 'short_text':
      parts.push(`Accepted answers: ${p.acceptedAnswers.join(' | ')}`, `Rubric: ${p.rubric}`);
      break;
    case 'free_response':
      parts.push(`Rubric: ${p.rubric}`);
      if (p.modelAnswer) parts.push(`Model answer: ${p.modelAnswer}`);
      break;
    case 'numeric':
      parts.push(`Value: ${p.answer}${p.unit ? ` ${p.unit}` : ''}`);
      break;
    case 'mcq':
      parts.push(`Correct option: ${p.options[p.correctIndex]?.text}`);
      break;
    case 'multi_select':
      parts.push(`Correct options: ${p.correctIndexes.map((i: number) => p.options[i]?.text).join(' | ')}`);
      break;
    case 'true_false':
      parts.push(`Correct value: ${p.correctValue}`);
      break;
    case 'ordering':
      parts.push(`Correct order: ${p.correctOrder.map((i: number) => p.items[i]).join(' -> ')}`);
      break;
  }
  return parts.join('\n');
}

export function buildJudgeAgreementPrompt(question: Question, verifierAnswer: string): string {
  return [
    wrap('material', `Question (${question.type}): ${question.prompt}`),
    '',
    'Answer key:',
    wrap('material', keyText(question)),
    '',
    'Candidate answer:',
    wrap('material', verifierAnswer),
  ].join('\n');
}
