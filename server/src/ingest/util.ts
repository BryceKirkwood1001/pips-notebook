import type { Question, PublicQuestion } from '@pips-notebook/shared';
import { createRng, hashString } from '../core/rng';

/** "Binary search: lo <= hi" -> "binary_search_lo_hi". Never empty. */
export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/g, '');
  return s === '' ? 'misconception' : s;
}

/** Lowercase, collapsed whitespace: the key used to spot duplicate prompts. */
export function promptKey(prompt: string, statement?: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(prompt) + (statement ? `||${norm(statement)}` : '');
}

/** Key of a question, from its full form or from its public form. */
export function questionKey(q: Pick<Question, 'prompt' | 'payload'> | Pick<PublicQuestion, 'prompt' | 'payload'>): string {
  const statement = (q.payload as { statement?: string }).statement;
  return promptKey(q.prompt, statement);
}

const isIdentity = (order: number[]): boolean => order.every((x, i) => x === i);

/**
 * Shuffles ordering items so the display order is not the answer (SPEC 2.9). `correctOrder` and every
 * wrong order are remapped to the new item positions. Deterministic for a given prompt.
 */
export function shuffleOrdering(
  payload: { items: string[]; correctOrder: number[]; wrongOrders: { order: number[]; misconceptionId: string }[] },
  seedText: string,
): typeof payload {
  const n = payload.items.length;
  const rng = createRng(hashString(seedText));
  let perm = rng.shuffle([...Array(n).keys()]); // newItems[j] = items[perm[j]]
  const remap = (order: number[]) => {
    const newIndexOf = new Map(perm.map((oldIdx, j) => [oldIdx, j]));
    return order.map((oldIdx) => newIndexOf.get(oldIdx) as number);
  };
  // Try a few shuffles until the correct order is no longer 0, 1, 2, ...
  for (let tries = 0; tries < 20 && isIdentity(remap(payload.correctOrder)); tries++) perm = rng.shuffle([...Array(n).keys()]);
  if (isIdentity(remap(payload.correctOrder))) perm = [...Array(n).keys()].reverse(); // n >= 2: always differs
  return {
    items: perm.map((oldIdx) => payload.items[oldIdx]),
    correctOrder: remap(payload.correctOrder),
    wrongOrders: payload.wrongOrders.map((w) => ({ order: remap(w.order), misconceptionId: w.misconceptionId })),
  };
}

/** The public form of a question: id, type, prompt, public payload, difficulty, time budget. */
export function toPublicQuestion(q: Question): PublicQuestion {
  const base = { id: q.id, prompt: q.prompt, difficulty: q.difficulty, timeBudgetSec: q.timeBudgetSec };
  switch (q.type) {
    case 'mcq':
      return { ...base, type: 'mcq', payload: { options: q.payload.options.map((o) => o.text) } };
    case 'true_false':
      return { ...base, type: 'true_false', payload: { statement: q.payload.statement } };
    case 'multi_select':
      return { ...base, type: 'multi_select', payload: { options: q.payload.options.map((o) => o.text) } };
    case 'numeric':
      return { ...base, type: 'numeric', payload: { unit: q.payload.unit } };
    case 'short_text':
      return { ...base, type: 'short_text', payload: {} };
    case 'ordering':
      return { ...base, type: 'ordering', payload: { items: [...q.payload.items] } };
    case 'free_response':
      return { ...base, type: 'free_response', payload: {} };
  }
}
