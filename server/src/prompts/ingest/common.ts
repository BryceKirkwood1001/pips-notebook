/** Shared pieces of the ingest prompts: system preamble and text blocks. All material text goes through `wrap`. */
import type { Concept, MaterialItem, StyleProfile } from '@pips-notebook/shared';
import type { RetrievedChunk } from '../../rag/types';
import { DATA_RULE, wrap } from '../gameplay/safety';

export { DATA_RULE, wrap };

export const INGEST_PREAMBLE = [
  'You are a careful course-content engineer. You read course material and produce structured study data from it.',
  'Quotes you return must be copied character for character from the material (one sentence, no paraphrase, no ellipsis).',
  'Only use ids that appear in the lists you are given. Leave a field empty rather than invent a value.',
  DATA_RULE,
].join('\n');

export function system(task: string): string {
  return `${INGEST_PREAMBLE}\n\n${task}`;
}

/** Concepts with their key points and misconceptions, with ids, as plain text (itself material-derived, so wrapped). */
export function conceptsBlock(concepts: Concept[]): string {
  const body = concepts
    .map((c) => {
      const kps = c.keyPoints.map((k) => `    - keyPoint ${k.id}: ${k.statement}`).join('\n') || '    (none)';
      const ms =
        c.misconceptions
          .map((m) => `    - misconception ${m.id}: believes "${m.beliefStatement}" / correct: "${m.correction}"`)
          .join('\n') || '    (none)';
      return `concept ${c.id}: ${c.title}\n  summary: ${c.summary}\n  key points:\n${kps}\n  misconceptions:\n${ms}`;
    })
    .join('\n\n');
  return wrap('material', body || '(no concepts)');
}

export function styleBlock(style: StyleProfile): string {
  const mix = Object.entries(style.formatMix)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
    .join(', ');
  return wrap('material', [
    'Course style profile (match it):',
    `- voice: ${style.voice}`,
    `- notation: ${style.notation}`,
    style.codeLanguage ? `- code language: ${style.codeLanguage}` : '',
    style.units ? `- units: ${style.units}` : '',
    `- format mix: ${mix || 'unknown'}`,
    `- typical scenarios: ${style.typicalScenarios.join('; ') || 'unknown'}`,
    `- typical solution steps: ${style.avgSolutionSteps}`,
    `- difficulty band: ${style.difficultyBand.min} to ${style.difficultyBand.max} (of 5)`,
  ]
    .filter(Boolean)
    .join('\n'));
}

export function itemsBlock(items: MaterialItem[]): string {
  const body = items
    .map(
      (it) =>
        `item ${it.id} (${it.kind}${it.points ? `, ${it.points} pts` : ''}; concepts: ${it.conceptIds.join(', ') || 'none'}; ` +
        `file ${it.evidence.fileId} page ${it.evidence.page})\n${it.text}${it.solution ? `\nSolution: ${it.solution}` : ''}`,
    )
    .join('\n\n---\n\n');
  return wrap('material', body || '(no items)');
}

/** Evidence chunks labelled with file id and page so quotes can name where they came from. */
export function labelledEvidenceBlock(evidence: RetrievedChunk[]): string {
  if (evidence.length === 0) return wrap('material', '(no material retrieved)');
  const body = evidence
    .map((c) => `[file ${c.fileId} page ${c.page}${c.sectionPath.length ? ` | ${c.sectionPath.join(' > ')}` : ''}]\n${c.text}`)
    .join('\n\n');
  return wrap('material', body);
}

export const QUOTE_RULE =
  'Evidence: "quote" is one short sentence copied exactly from the material that supports the item, with its "fileId" and "page" (from the [file ... page ...] markers).';
