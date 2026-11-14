import type { Concept, MaterialItem, StyleProfile } from '@top/shared';
import type { CoverageGap } from '../../llm/types';
import type { RetrievedChunk } from '../../rag/types';
import { conceptsBlock, itemsBlock, labelledEvidenceBlock, styleBlock, system } from './common';
import { FLAT_QUESTION_SPEC } from './questionSpec';

export const ADAPT_QUESTIONS_SYSTEM = system(
  [
    'Task: write NEW questions by adapting the course\'s own exercises: same structure, notation, depth and phrasing, but new numbers, names or context.',
    'Add a field "itemId": the id of the exemplar item each question is adapted from. Compute any numeric answer carefully and make sure the explanation shows how it follows from the material. The question must be answerable from the material excerpts.',
    FLAT_QUESTION_SPEC,
  ].join('\n'),
);

export function gapsBlock(gaps: CoverageGap[], concepts: Concept[]): string {
  const kp = new Map(concepts.flatMap((c) => c.keyPoints.map((k) => [k.id, k.statement] as const)));
  const ms = new Map(concepts.flatMap((c) => c.misconceptions.map((m) => [m.id, m.beliefStatement] as const)));
  const lines = gaps.map((g, i) =>
    [
      `Gap ${i + 1}: write ${g.count} question(s)${g.multiConcept ? ' that each span at least two of these concepts' : ''}`,
      `  concepts: ${g.conceptIds.join(', ')}`,
      `  preferred types: ${g.preferredTypes.join(', ') || 'any'}`,
      `  key points to cover: ${g.keyPointIds.map((id) => `${id} (${kp.get(id) ?? '?'})`).join('; ') || 'none specific'}`,
      `  misconceptions to give a wrong-answer path for: ${g.misconceptionIds.map((id) => `${id} ("${ms.get(id) ?? '?'}")`).join('; ') || 'none specific'}`,
    ].join('\n'),
  );
  return `Coverage to achieve (${gaps.reduce((s, g) => s + g.count, 0)} questions in total):\n${lines.join('\n')}`;
}

export function buildAdaptQuestionsPrompt(
  exemplars: MaterialItem[],
  gaps: CoverageGap[],
  concepts: Concept[],
  style: StyleProfile,
  evidence: RetrievedChunk[],
): string {
  return [
    styleBlock(style),
    '',
    'Concepts, key points and misconceptions:',
    conceptsBlock(concepts),
    '',
    'Exemplar items from the course:',
    itemsBlock(exemplars),
    '',
    gapsBlock(gaps, concepts),
    '',
    'Material excerpts (evidence quotes must come from here):',
    labelledEvidenceBlock(evidence),
  ].join('\n');
}
