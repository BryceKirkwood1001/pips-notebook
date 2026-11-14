import type { GradeOpenInput } from '../../llm/types';
import { DATA_RULE, evidenceBlock, wrap } from './safety';

export const GRADE_OPEN_SYSTEM = [
  'You grade one written answer to a test question, fairly, using the rubric and the course <material>.',
  'Accept different wording when the meaning is right.',
  'Grade on the core idea the question asks for. An answer that states that idea correctly and asserts nothing false is correct, even if it leaves out a secondary detail that the rubric or accepted answers mention (an exact type name, a qualifier, an extra example). Treat such a detail as required only when the question itself explicitly asks for it.',
  'Mark it incorrect if it misses the core idea, is too vague to show understanding, or states anything that contradicts the reference or the course material.',
  '"misconceptionIds" lists only ids from the candidate list that the answer clearly exhibits (empty when the answer is correct).',
  '"feedback" is one or two short sentences.',
  DATA_RULE,
].join('\n');

export function buildGradeOpenPrompt(input: GradeOpenInput): string {
  const q = input.question;
  const reference: string[] = [];
  if (q.type === 'short_text') reference.push(`Accepted answers: ${q.payload.acceptedAnswers.join(' | ')}`, `Rubric: ${q.payload.rubric}`);
  if (q.type === 'free_response') {
    reference.push(`Rubric: ${q.payload.rubric}`);
    if (q.payload.modelAnswer) reference.push(`Model answer: ${q.payload.modelAnswer}`);
  }
  reference.push(`Final answer: ${q.solution.finalAnswer}`);
  const cands = input.candidateMisconceptions.map((m) => `- id=${m.id}: ${m.description} (belief: ${m.beliefStatement})`).join('\n');
  return [
    wrap('material', [`Question: ${q.prompt}`, ...reference].join('\n')),
    '',
    'Candidate misconceptions:',
    wrap('material', cands || '(none)'),
    '',
    'Course material:',
    evidenceBlock(input.evidence),
    '',
    'The answer to grade:',
    wrap('player_text', input.answerText),
  ].join('\n');
}
