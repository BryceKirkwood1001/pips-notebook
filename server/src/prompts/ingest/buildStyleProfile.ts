import type { MaterialItem } from '@top/shared';
import { itemsBlock, system, wrap } from './common';

export const BUILD_STYLE_PROFILE_SYSTEM = system(
  [
    'Task: describe how this course writes its questions, so new questions can match it.',
    'Fields: voice (tone and phrasing habits), notation (symbols, math or code conventions), codeLanguage (only if code appears), units (only if the course uses units), formatMix (share 0..1 of each question format among the material\'s items: mcq, true_false, multi_select, numeric, short_text, ordering, free_response; roughly summing to 1), typicalScenarios (short phrases), avgSolutionSteps, difficultyMin and difficultyMax (1 to 5), and exemplarItemIds (3 to 5 item ids that best show the style; use only the item ids listed).',
  ].join('\n'),
);

export function buildStyleProfilePrompt(items: MaterialItem[], samplePages: { fileId: string; page: number; text: string }[]): string {
  const pages = samplePages.map((p) => `[file ${p.fileId} page ${p.page}]\n${p.text}`).join('\n\n');
  return ['The material\'s own items:', itemsBlock(items), '', 'Sample pages:', wrap('material', pages || '(none)')].join('\n');
}
