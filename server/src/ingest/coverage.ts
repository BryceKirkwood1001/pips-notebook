import {
  PROVENANCE_ORIGINS,
  QUESTION_TYPES,
  type CoursePack,
  type ProvenanceOrigin,
  type Question,
  type QuestionType,
} from '@pips-notebook/shared';
import type { Config } from '../config';
import { targetsMisconception } from '../core/grading';
import type { CoverageGap } from '../llm/types';
import type { CoverageReport } from './types';

/** Questions a room must hold: ROOM_QUESTIONS × ROOM_POOL_FACTOR. */
export const roomPoolNeed = (config: Config): number => Math.ceil(config.roomQuestions * config.roomPoolFactor);

/** Multi-concept questions the boss pool needs (SPEC 4.4). */
export const multiConceptNeed = (pack: CoursePack, config: Config): number =>
  pack.concepts.length >= 2 ? Math.ceil(config.bossQuestions / 2) : 0;

export function checkCoverage(pack: CoursePack, questions: Question[], config: Config): CoverageReport {
  const verified = questions.filter((q) => q.verified);

  const keyPointsWithoutQuestion = pack.concepts
    .flatMap((c) => c.keyPoints)
    .filter((k) => !verified.some((q) => q.keyPointIds.includes(k.id)))
    .map((k) => k.id);

  const misconceptionsWithoutPath = pack.concepts
    .flatMap((c) => c.misconceptions)
    .filter((m) => !verified.some((q) => targetsMisconception(q, m.id)))
    .map((m) => m.id);

  const need = roomPoolNeed(config);
  const roomsBelowPool = pack.rooms
    .map((room) => ({
      roomId: room.id,
      need,
      have: verified.filter((q) => q.conceptIds.every((id) => room.conceptIds.includes(id))).length,
    }))
    .filter((r) => r.have < r.need);

  const multiConcept = {
    have: verified.filter((q) => q.conceptIds.length >= 2).length,
    need: multiConceptNeed(pack, config),
  };

  const provenanceMix = Object.fromEntries(PROVENANCE_ORIGINS.map((o) => [o, 0])) as Record<ProvenanceOrigin, number>;
  const typeMix = Object.fromEntries(QUESTION_TYPES.map((t) => [t, 0])) as Record<QuestionType, number>;
  for (const q of verified) {
    provenanceMix[q.provenance.origin]++;
    typeMix[q.type]++;
  }

  const ok =
    keyPointsWithoutQuestion.length === 0 &&
    misconceptionsWithoutPath.length === 0 &&
    roomsBelowPool.length === 0 &&
    multiConcept.have >= multiConcept.need;

  return {
    ok,
    keyPointsWithoutQuestion,
    misconceptionsWithoutPath,
    roomsBelowPool,
    multiConcept,
    unverified: questions.length - verified.length,
    totalVerified: verified.length,
    provenanceMix,
    typeMix,
  };
}

/** Preferred question types: the style profile's format mix, most common first (at most 4). */
export function preferredTypes(pack: CoursePack): QuestionType[] {
  const mix = Object.entries(pack.styleProfile.formatMix) as [QuestionType, number][];
  const types = mix.filter(([, share]) => share > 0).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return (types.length > 0 ? types : ['mcq', 'true_false', 'numeric', 'short_text']).slice(0, 4) as QuestionType[];
}

/**
 * What the given questions leave uncovered for a set of concepts: key points without a question,
 * misconceptions without a wrong-answer path, and how many more questions a room-sized pool needs.
 * `poolTarget` is how many questions fully inside `conceptIds` the pool should hold.
 */
export function gapFor(
  pack: CoursePack,
  conceptIds: string[],
  questions: Question[],
  poolTarget: number,
  multiConcept = false,
): CoverageGap {
  const concepts = pack.concepts.filter((c) => conceptIds.includes(c.id));
  const keyPointIds = concepts
    .flatMap((c) => c.keyPoints)
    .filter((k) => !questions.some((q) => q.keyPointIds.includes(k.id)))
    .map((k) => k.id);
  const misconceptionIds = concepts
    .flatMap((c) => c.misconceptions)
    .filter((m) => !questions.some((q) => targetsMisconception(q, m.id)))
    .map((m) => m.id);
  const have = questions.filter((q) => q.conceptIds.every((id) => conceptIds.includes(id))).length;
  // One question per uncovered key point or misconception is enough: a question can cover several.
  const count = Math.max(poolTarget - have, keyPointIds.length, misconceptionIds.length);
  return { conceptIds, keyPointIds, misconceptionIds, count, multiConcept, preferredTypes: preferredTypes(pack) };
}
