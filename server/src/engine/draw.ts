import type { Question } from '@pips-notebook/shared';
import { targetsMisconception, wrongAnswerFor } from '../core/grading';
import type { Rng } from '../core/rng';

/** min(n, pool) ids, no repeats, preferring ids not in `seen`. */
export function drawRoomQuestions(pool: Question[], seen: string[], n: number, rng: Rng): string[] {
  const count = Math.min(n, pool.length);
  const fresh = rng.shuffle(pool.filter((q) => !seen.includes(q.id)));
  const old = rng.shuffle(pool.filter((q) => seen.includes(q.id)));
  const picked = [...fresh, ...old].slice(0, count);
  return rng.shuffle(picked).map((q) => q.id);
}

export interface BossDraw {
  questionIds: string[];
  targetedMap: Record<string, string>;
}

/**
 * Boss composition (SPEC 2.6). `active` is the active misconceptions in scope, highest likelihood first.
 * k targeted questions, then fill preferring multi-concept questions and covering every concept, then shuffle.
 */
export function composeBoss(
  pool: Question[],
  scopeConceptIds: string[],
  active: { id: string }[],
  bossQuestions: number,
  targetedShare: number,
  rng: Rng,
): BossDraw {
  const n = Math.min(bossQuestions, pool.length);
  const k = Math.min(active.length, Math.floor(n * targetedShare));
  const chosen: Question[] = [];
  const targetedMap: Record<string, string> = {};
  const isChosen = (q: Question) => chosen.some((c) => c.id === q.id);

  // 1. targeted questions
  for (const m of active) {
    if (Object.keys(targetedMap).length >= k) break;
    const candidates = pool.filter((q) => !isChosen(q) && targetsMisconception(q, m.id));
    if (candidates.length === 0) continue;
    // Prefer a question where the wrong belief leads to one definite wrong answer (not a free response).
    const definite = candidates.filter((q) => wrongAnswerFor(q, m.id) !== null);
    const q = rng.pick(definite.length > 0 ? definite : candidates);
    chosen.push(q);
    targetedMap[q.id] = m.id;
  }

  // 2. coverage: every concept in scope at least once where possible, multi-concept questions first
  const covered = new Set(chosen.flatMap((q) => q.conceptIds));
  while (chosen.length < n) {
    const uncovered = scopeConceptIds.filter((c) => !covered.has(c));
    if (uncovered.length === 0) break;
    const gain = (q: Question) => q.conceptIds.filter((c) => uncovered.includes(c)).length;
    const candidates = pool.filter((q) => !isChosen(q) && gain(q) > 0);
    if (candidates.length === 0) break;
    const best = Math.max(...candidates.map(gain));
    const q = rng.pick(candidates.filter((c) => gain(c) === best));
    chosen.push(q);
    q.conceptIds.forEach((c) => covered.add(c));
  }

  // 3. the rest: multi-concept first
  const rest = pool.filter((q) => !isChosen(q));
  const multi = rng.shuffle(rest.filter((q) => q.conceptIds.length >= 2));
  const single = rng.shuffle(rest.filter((q) => q.conceptIds.length < 2));
  for (const q of [...multi, ...single]) {
    if (chosen.length >= n) break;
    chosen.push(q);
  }

  return { questionIds: rng.shuffle(chosen).map((q) => q.id), targetedMap };
}
