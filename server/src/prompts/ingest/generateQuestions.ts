import type { Concept, MaterialItem, StyleProfile } from '@top/shared';
import type { CoverageGap } from '../../llm/types';
import type { RetrievedChunk } from '../../rag/types';
import { gapsBlock } from './adaptQuestions';
import { conceptsBlock, itemsBlock, labelledEvidenceBlock, styleBlock, system } from './common';
import { FLAT_QUESTION_SPEC } from './questionSpec';

export const GENERATE_QUESTIONS_SYSTEM = system(
  [
    'Task: write brand-new questions that fill the coverage gaps, so they read as if the course authored them: same notation, units, code language, scenario types, depth and phrasing as the exemplars.',
    'Use only facts stated in the material excerpts; do not rely on outside knowledge for the key. Follow the preferred types, and vary the position of the correct option. Each question must have exactly one defensible answer.',
    FLAT_QUESTION_SPEC,
  ].join('\n'),
);

export function buildGenerateQuestionsPrompt(
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
    'Few-shot exemplars from the course (imitate their style):',
    itemsBlock(exemplars),
    '',
    gapsBlock(gaps, concepts),
    '',
    'Material excerpts (evidence quotes must come from here):',
    labelledEvidenceBlock(evidence),
  ].join('\n');
}
