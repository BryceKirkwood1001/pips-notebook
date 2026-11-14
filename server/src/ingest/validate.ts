import { QuestionSchema, type CoursePack, type Question } from '@top/shared';
import { mappedMisconceptionIds } from '../core/grading';

/**
 * Semantic checks beyond the schema (SPEC 4.4): the payload is valid for its type, and every concept,
 * key point, misconception and material item the question points to exists in the pack.
 * Returns the problems found; empty means valid. (The evidence quote is checked against its chunk when
 * the draft is turned into a question, because only the pipeline has the chunks.)
 */
export function validateQuestion(question: Question, pack: CoursePack): string[] {
  const problems: string[] = [];

  const parsed = QuestionSchema.safeParse(question);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`schema: ${issue.path.join('.')}: ${issue.message}`);
    return problems; // the semantic checks below need a well-formed question
  }

  const conceptIds = new Set(pack.concepts.map((c) => c.id));
  const keyPointIds = new Set(pack.concepts.flatMap((c) => c.keyPoints.map((k) => k.id)));
  const misconceptionIds = new Set(pack.concepts.flatMap((c) => c.misconceptions.map((m) => m.id)));

  for (const id of question.conceptIds) if (!conceptIds.has(id)) problems.push(`unknown concept id "${id}"`);
  for (const id of question.keyPointIds) if (!keyPointIds.has(id)) problems.push(`unknown key point id "${id}"`);

  const mapped = new Set([...question.misconceptionIds, ...mappedMisconceptionIds(question)]);
  for (const id of mapped) if (!misconceptionIds.has(id)) problems.push(`unknown misconception id "${id}"`);

  const { origin, materialItemId, evidence } = question.provenance;
  if (materialItemId && !pack.materialItems.some((m) => m.id === materialItemId)) {
    problems.push(`unknown material item id "${materialItemId}"`);
  }
  if (origin === 'verbatim' && !materialItemId) problems.push('a verbatim question needs a materialItemId');
  if (evidence.quote.trim() === '') problems.push('empty evidence quote');
  if (/\b(?:what|which)\b.{0,80}\b(?:slide|lecturer|instructor|presentation)\b.{0,80}\b(?:say|says|said|ask|asks|asked|mention|mentions|mentioned|raise|raises|raised)\b/i.test(question.prompt)) {
    problems.push('question tests presentation wording instead of subject understanding');
  }

  if (question.type === 'ordering' && question.payload.correctOrder.every((x, i) => x === i)) {
    problems.push('ordering: items are not shuffled (correctOrder is 0, 1, 2, ...)');
  }
  return problems;
}
