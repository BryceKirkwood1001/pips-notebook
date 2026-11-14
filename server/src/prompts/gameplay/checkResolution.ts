import type { CheckResolutionInput } from '../../llm/types';
import { DATA_RULE, evidenceBlock, wrap } from './safety';

export const CHECK_RESOLUTION_SYSTEM = [
  'You check whether a teacher\'s answer fixes a student\'s wrong belief.',
  'Decide using the course <material> provided, not your own knowledge.',
  '"resolved" is true only if the answer clearly states the correct idea and does not endorse the wrong belief.',
  'When resolved, "noteToAdd" is one short corrective note in a first-person, curious student voice that states the correct idea. Otherwise it is an empty string.',
  '"why" is one short sentence.',
  DATA_RULE,
].join('\n');

export function buildCheckResolutionPrompt(input: CheckResolutionInput): string {
  const m = input.misconception;
  return [
    wrap('material', `The wrong belief: ${m.beliefStatement}\nThe correct idea: ${m.correction}`),
    '',
    'The student asked:',
    wrap('player_text', input.question),
    '',
    'The teacher answered:',
    wrap('player_text', input.answer),
    '',
    'Course material:',
    evidenceBlock(input.evidence),
  ].join('\n');
}
