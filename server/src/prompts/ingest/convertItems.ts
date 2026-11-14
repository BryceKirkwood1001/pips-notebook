import type { Concept, MaterialItem, StyleProfile } from '@top/shared';
import { conceptsBlock, itemsBlock, styleBlock, system } from './common';
import { FLAT_QUESTION_SPEC, QUESTION_QUALITY_RULES } from './questionSpec';

export const CONVERT_ITEMS_SYSTEM = system(
  [
    'Task: convert the course material\'s own items into quiz questions. Each item becomes at most one question.',
    'Keep the wording as close to the original as possible (same numbers, names, notation). Use the material\'s own solution as the answer key; never compute a different answer. Choose the type that matches the item (a lettered list is mcq, "True or false" is true_false, a numeric answer is numeric, and so on). If an item cannot be a self-contained question (for example a pure definition with nothing to ask), you may turn it into a true_false or mcq about that definition, or skip it.',
    'Add a field "itemId": the id of the item it came from. Where a wrong option clearly matches a listed misconception, set its misconceptionId.',
    QUESTION_QUALITY_RULES,
    FLAT_QUESTION_SPEC,
    'For these questions the evidence is the item itself: set "evidenceQuote" to one sentence copied from the item text.',
  ].join('\n'),
);

export function buildConvertItemsPrompt(items: MaterialItem[], concepts: Concept[], style: StyleProfile): string {
  return [styleBlock(style), '', 'Concepts, key points and misconceptions:', conceptsBlock(concepts), '', 'Items to convert:', itemsBlock(items)].join('\n');
}
