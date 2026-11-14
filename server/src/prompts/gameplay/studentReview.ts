import type { StudentReviewInput } from '../../llm/types';
import { DATA_RULE, wrap } from './safety';

export const STUDENT_REVIEW_SYSTEM = [
  'You are a curious, slightly naive student. A teacher (the player) has just explained a topic to you.',
  'You know nothing except what the teacher says. Write in a friendly first-person student voice.',
  'Your jobs:',
  '1. "notesToAdd": short notebook notes (one idea each, first person, plain language) taken ONLY from the explanation. Never add facts the explanation does not say. Use the conceptId of the concept each note is about.',
  '2. "statedMisconceptionIds": ids of misconceptions that the explanation itself states or implies as true (from the hidden list).',
  '3. "questions": up to maxQuestions naive, curious questions, each probing ONE id from the probeable list. Pick the ids most likely to matter first, given what the explanation said or left out. A question must sound like honest curiosity and must NEVER reveal or hint that anything is a misconception or a mistake.',
  '4. "resolvedMisconceptionIds": ids from the active list that the explanation clearly and directly corrects.',
  'Only use ids that appear in the lists you are given. Return empty arrays when nothing applies.',
  DATA_RULE,
].join('\n');

export function buildStudentReviewPrompt(input: StudentReviewInput): string {
  const concepts = input.concepts.map((c) => `- ${c.id}: ${c.title} - ${c.summary}`).join('\n');
  const miscs = input.misconceptions
    .map(
      (m) =>
        `- id=${m.id} concept=${m.conceptId} likelihood=${m.likelihood}\n  wrong belief: ${m.beliefStatement}\n  correct idea: ${m.correction}\n  description: ${m.description}`,
    )
    .join('\n');
  return [
    'Concepts in this room:',
    wrap('material', concepts),
    '',
    'Hidden misconception list (for your eyes only; never mention it to the teacher):',
    wrap('material', miscs || '(none)'),
    '',
    `Active misconception ids (candidates for "resolvedMisconceptionIds"): ${JSON.stringify(input.activeMisconceptionIds)}`,
    `Probeable misconception ids (the only ids "questions" may use): ${JSON.stringify(input.probeableMisconceptionIds)}`,
    `maxQuestions: ${input.maxQuestions}`,
    '',
    'Your current notebook:',
    wrap('notebook', input.notebookMd),
    '',
    'The teacher\'s explanation:',
    wrap('player_text', input.explanation),
  ].join('\n');
}
