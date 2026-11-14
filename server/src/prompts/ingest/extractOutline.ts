import type { ParsedFile } from '../../rag/types';
import { QUOTE_RULE, system, wrap } from './common';

export const EXTRACT_OUTLINE_SYSTEM = system(
  [
    'Task: read the course material and produce its outline, its own exercises and any stated time budget.',
    '1. title, and language (BCP-47 code such as "en").',
    '2. units, each with concepts (one concept is one coherent teachable idea, not one slide, label or API method). Combine repeated review and closely related definitions/operations. Extract supported key points without fixed counts. Each concept has a substantive 2-3 sentence summary telling a learner what to explain and which mechanism/example to cover, prerequisite concept titles, and keyPoints: atomic supported claims with evidence. A summary must provide scope, not just repeat the title.',
    '3. materialItems: find EVERY practice problem, worked example, review question, quiz item, definition and "common mistake" callout in the material. kind is one of practice_problem, worked_example, review_question, quiz_item, definition, common_mistake. "text" is the item as written (include its options if it has them) and "solution" the material\'s own solution or answer when it has one. List the concept titles it belongs to, and "points" if the material states them.',
    '4. examTimeHint: only when the material states a time or point budget for an exam or quiz (for example "10 minutes for 5 questions"); otherwise null.',
    'Learning scope: use the lesson title and stated learning objectives to organize the current subject. Omit administrative announcements, due dates, greetings and unrelated previous-lesson review. Keep prerequisite facts only when they support the current objectives.',
    'A key point is a factual claim, mechanism, relationship or procedure taught by the material, not a rhetorical question, section heading or diagram label. Do not turn a hook such as "Can we improve this?" into its own concept/key point. Consolidate repeated animation/reveal slides into the same idea.',
    'Extract actual exercises, explanations and definitions as material items. A rhetorical question with no substantive problem is not a practice question. Prefer complete worked/review exercises over incidental numerical labels.',
    QUOTE_RULE,
    'If a PDF is attached, read it fully, including tables and diagrams; the page text in the prompt is the exact text to quote from.',
  ].join('\n'),
);

export function buildExtractOutlinePrompt(files: ParsedFile[], titleHint?: string, courseScope = ''): string {
  const body = files
    .map((f) => {
      const pages = f.pages.map((p) => `[file ${f.fileId} page ${p.page}]\n${p.text}`).join('\n\n');
      return `=== file ${f.fileId} ("${f.name}") ===\n${pages}`;
    })
    .join('\n\n');
  return [
    titleHint ? wrap('player_text', `Title hint from the uploader: ${titleHint}`) : '',
    courseScope ? 'Course title/objectives from the uploaded document (organization only; extract facts and evidence from the current part):\n' + wrap('material', courseScope) : '',
    wrap('material', `Files: ${files.map((f) => `${f.fileId} = ${f.name}`).join(', ')}`),
    'Course material:',
    wrap('material', body),
  ]
    .filter(Boolean)
    .join('\n');
}
