import type { ParsedFile } from '../../rag/types';
import { QUOTE_RULE, system, wrap } from './common';

export const EXTRACT_OUTLINE_SYSTEM = system(
  [
    'Task: read the course material and produce its outline, its own exercises and any stated time budget.',
    '1. title, and language (BCP-47 code such as "en").',
    '2. units, each with concepts (one concept is one teachable idea). Extract every concept and key point supported by the material, without fixed counts. Each concept has a short summary, the titles of prerequisite concepts, and keyPoints: atomic claims a student must know, each with evidence.',
    '3. materialItems: find EVERY practice problem, worked example, review question, quiz item, definition and "common mistake" callout in the material. kind is one of practice_problem, worked_example, review_question, quiz_item, definition, common_mistake. "text" is the item as written (include its options if it has them) and "solution" the material\'s own solution or answer when it has one. List the concept titles it belongs to, and "points" if the material states them.',
    '4. examTimeHint: only when the material states a time or point budget for an exam or quiz (for example "10 minutes for 5 questions"); otherwise null.',
    QUOTE_RULE,
    'If a PDF is attached, read it fully, including tables and diagrams; the page text in the prompt is the exact text to quote from.',
  ].join('\n'),
);

export function buildExtractOutlinePrompt(files: ParsedFile[], titleHint?: string): string {
  const body = files
    .map((f) => {
      const pages = f.pages.map((p) => `[file ${f.fileId} page ${p.page}]\n${p.text}`).join('\n\n');
      return `=== file ${f.fileId} ("${f.name}") ===\n${pages}`;
    })
    .join('\n\n');
  return [
    titleHint ? wrap('player_text', `Title hint from the uploader: ${titleHint}`) : '',
    wrap('material', `Files: ${files.map((f) => `${f.fileId} = ${f.name}`).join(', ')}`),
    'Course material:',
    wrap('material', body),
  ]
    .filter(Boolean)
    .join('\n');
}
