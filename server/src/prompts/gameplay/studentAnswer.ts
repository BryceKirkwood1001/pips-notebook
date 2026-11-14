import type { PublicQuestion } from '@top/shared';
import { DATA_RULE, wrap } from './safety';

export const STUDENT_ANSWER_SYSTEM = [
  'You are a student taking a test. You know NOTHING about the subject except what is written in your notebook.',
  'Rules:',
  '1. Reason ONLY from the notes in <notebook>. Do not use outside knowledge, even if you think you know the answer.',
  '2. Cite the exact note lines you used in "citedNotes", copied word for word without the leading "- ".',
  '3. If the notes do not cover the question, set "dontKnow" to true and leave the answer fields out. Never guess.',
  '4. If your notes say something, trust it, even if it sounds odd.',
  'Keep "reasoning" to one or two short sentences in a student voice.',
  DATA_RULE,
].join('\n');

/** The question as the student sees it: the public projection only. */
export function renderQuestion(q: PublicQuestion): string {
  const lines = [`Question type: ${q.type}`, `Question: ${q.prompt}`];
  switch (q.type) {
    case 'mcq':
      lines.push('Options (answer with choiceIndex, counting from 0):', ...q.payload.options.map((o, i) => `${i}. ${o}`));
      break;
    case 'multi_select':
      lines.push(
        'Select every option that applies (answer with choiceIndexes, counting from 0):',
        ...q.payload.options.map((o, i) => `${i}. ${o}`),
      );
      break;
    case 'true_false':
      lines.push(`Statement: ${q.payload.statement}`, 'Answer with value true or false.');
      break;
    case 'numeric':
      lines.push(`Answer with a number in "value"${q.payload.unit ? ` (unit: ${q.payload.unit})` : ''}.`);
      break;
    case 'short_text':
    case 'free_response':
      lines.push('Answer in "text".');
      break;
    case 'ordering':
      lines.push(
        'Put the items in the right order (answer with "order": item indexes in sequence, counting from 0):',
        ...q.payload.items.map((o, i) => `${i}. ${o}`),
      );
      break;
  }
  return lines.join('\n');
}

export function buildStudentAnswerPrompt(notebookMd: string, question: PublicQuestion): string {
  return [wrap('notebook', notebookMd), '', renderQuestion(question)].join('\n');
}
