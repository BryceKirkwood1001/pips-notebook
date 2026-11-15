/**
 * SPEC 4.4 and 2.9 checked independently of the ingest module, on every pack in samples/cache. Short packs with
 * their own pace are checked against that pace, and skip the provenance rules that only apply to ingested material.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CourseFixtureSchema } from '@pips-notebook/shared';
import { testConfig, withPace } from '../src/config';
import { targetsMisconception } from '../src/core/grading';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const CONVERTIBLE = ['practice_problem', 'review_question', 'quiz_item'];

const samples = readdirSync(new URL('../../samples/cache/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

it('finds the bundled samples', () => {
  expect(samples).toEqual(expect.arrayContaining(['seasons', 'binary-search']));
});

for (const sample of samples) {
  describe(`sample pack: ${sample}`, () => {
    const raw = readFileSync(new URL(`../../samples/cache/${sample}.json`, import.meta.url), 'utf8');
    const fx = CourseFixtureSchema.parse(JSON.parse(raw));
    const { pack } = fx;
    const config = withPace(testConfig(), pack.pace);
    const paced = !!pack.pace;
    const verified = fx.questions.filter((q) => q.verified);
    const chunks = new Map(fx.chunks.map((c) => [c.id, c]));

    it('every key point has a question', () => {
      for (const c of pack.concepts) for (const k of c.keyPoints) {
        expect(verified.some((q) => q.keyPointIds.includes(k.id)), k.id).toBe(true);
      }
    });

    it('every misconception has a wrong-answer path', () => {
      for (const c of pack.concepts) for (const m of c.misconceptions) {
        expect(verified.some((q) => targetsMisconception(q, m.id)), m.id).toBe(true);
      }
    });

    it('every room has enough questions inside it', () => {
      const need = config.roomQuestions * config.roomPoolFactor;
      for (const r of pack.rooms) {
        const pool = verified.filter((q) => q.conceptIds.every((c) => r.conceptIds.includes(c)));
        expect(pool.length, r.id).toBeGreaterThanOrEqual(need);
      }
    });

    it('has enough multi-concept questions for the boss', () => {
      if (pack.concepts.length < 2) return;
      expect(verified.filter((q) => q.conceptIds.length >= 2).length).toBeGreaterThanOrEqual(Math.ceil(config.bossQuestions / 2));
    });

    it('every question is verified', () => {
      expect(fx.questions.filter((q) => !q.verified).map((q) => q.id)).toEqual([]);
    });

    it('every evidence quote is in its chunk', () => {
      const evidences = [
        ...pack.concepts.flatMap((c) => [...c.keyPoints.map((k) => k.evidence), ...c.misconceptions.map((m) => m.evidence)]),
        ...pack.materialItems.map((m) => m.evidence),
        ...fx.questions.map((q) => q.provenance.evidence),
      ];
      expect(evidences.length).toBeGreaterThan(0);
      for (const e of evidences) {
        const chunk = chunks.get(e.chunkId);
        expect(chunk, e.chunkId).toBeDefined();
        expect(norm(chunk!.text).includes(norm(e.quote)), `${e.chunkId}: ${e.quote}`).toBe(true);
      }
    });

    it.skipIf(paced)('provenance priority: every convertible material item has a verbatim question', () => {
      const items = pack.materialItems.filter((m) => CONVERTIBLE.includes(m.kind));
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(
          verified.some((q) => q.provenance.origin === 'verbatim' && q.provenance.materialItemId === item.id),
          `${item.id}: ${item.text.slice(0, 40)}`,
        ).toBe(true);
      }
      const verbatim = verified.filter((q) => q.provenance.origin === 'verbatim').length;
      expect(verbatim).toBeGreaterThanOrEqual(items.length);
    });

    it.skipIf(paced)('generated questions only fill gaps (they always target a key point, misconception or multi-concept need)', () => {
      for (const q of verified.filter((x) => x.provenance.origin === 'generated')) {
        expect(q.keyPointIds.length + q.misconceptionIds.length + q.conceptIds.length - 1, q.id).toBeGreaterThan(0);
      }
      // verbatim and adapted material questions exist before any generation is needed
      expect(verified.some((q) => q.provenance.origin !== 'generated')).toBe(true);
    });
  });
}
