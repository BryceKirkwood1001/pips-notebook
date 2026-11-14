import type { Concept, MaterialItem } from '@top/shared';
import type { RetrievedChunk } from '../../rag/types';
import { QUOTE_RULE, itemsBlock, labelledEvidenceBlock, system, wrap } from './common';

export const BUILD_MISCONCEPTIONS_SYSTEM = system(
  [
    'Task: list the misconceptions students commonly hold about ONE concept.',
    'Put every supported "common mistake" item from the material first (origin "material"), then add inferred ones (origin "inferred") supported by the topic and evidence. Do not impose a fixed count.',
    'Fields: id (snake_case slug), description (what the misconception is), beliefStatement (a short note in a novice student\'s voice stating the wrong belief, e.g. "We are closer to the Sun in summer."), correction (a short note in a student\'s voice stating the right idea), likelihood (1 rare to 3 very common).',
    'The evidence quote must support the CORRECTION, not the wrong belief.',
    QUOTE_RULE,
  ].join('\n'),
);

export function buildMisconceptionsPrompt(concept: Concept, commonMistakes: MaterialItem[], evidence: RetrievedChunk[]): string {
  return [
    wrap('material', `Concept ${concept.id}: ${concept.title}`),
    wrap('material', `summary: ${concept.summary}\n${concept.keyPoints.map((k) => `- ${k.statement}`).join('\n')}`),
    '',
    'The material\'s common mistakes for this concept:',
    commonMistakes.length ? itemsBlock(commonMistakes) : '(none)',
    '',
    'Material excerpts:',
    labelledEvidenceBlock(evidence),
  ].join('\n');
}
