import type { PublicQuestion } from '@top/shared';
import type { RetrievedChunk } from '../../rag/types';
import { labelledEvidenceBlock, system, wrap } from './common';

export const VERIFY_QUESTION_SYSTEM = system(
  [
    'Task: you are a diligent student with the course material open. Answer the question using ONLY the material excerpts.',
    'Set exactly the field that fits the type: choiceIndex (mcq, 0-based), choiceIndexes (multi_select), boolValue (true_false), numberValue (numeric), text (short_text, free_response), order (ordering: item indexes in the correct sequence). If the material does not let you answer, set dontKnow=true.',
    'Also write workedSteps: the steps a solver takes, each tagged "recall" (remember a fact), "reason" (infer or compare), "compute" (do arithmetic) or "write" (compose text). And a difficulty from 1 (trivial) to 5 (very hard) for a student of this course.',
  ].join('\n'),
);

/** Only the public question: text, options and items with indexes. No key, no explanation, no ids of misconceptions. */
export function publicQuestionText(q: PublicQuestion): string {
  const lines = [`Type: ${q.type}`, `Question: ${q.prompt}`];
  switch (q.type) {
    case 'mcq':
    case 'multi_select':
      lines.push(...q.payload.options.map((o, i) => `  [${i}] ${o}`));
      if (q.type === 'multi_select') lines.push('(choose all that apply)');
      break;
    case 'true_false':
      lines.push(`Statement: ${q.payload.statement}`);
      break;
    case 'numeric':
      if (q.payload.unit) lines.push(`Answer unit: ${q.payload.unit}`);
      break;
    case 'ordering':
      lines.push(...q.payload.items.map((o, i) => `  [${i}] ${o}`), '(give the indexes in the correct order)');
      break;
    default:
      break;
  }
  return lines.join('\n');
}

export function buildVerifyQuestionPrompt(question: PublicQuestion, evidence: RetrievedChunk[]): string {
  return ['Material excerpts:', labelledEvidenceBlock(evidence), '', 'Question to answer:', wrap('material', publicQuestionText(question))].join('\n');
}
