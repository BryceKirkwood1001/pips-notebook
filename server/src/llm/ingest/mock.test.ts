import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeForMatch } from '../../rag';
import type { CannedSample } from './mock-types';
import { createMockIngestTasks } from './mock';

describe.each([
  ['seasons', 'seasons'],
  ['binary-search', 'binary-search'],
])('canned data for %s', (file, md) => {
  const sample = JSON.parse(readFileSync(new URL(`./mock-data/${file}.json`, import.meta.url), 'utf8')) as CannedSample;
  const handout = normalizeForMatch(readFileSync(new URL(`../../../../samples/${md}.md`, import.meta.url), 'utf8'));

  it('quotes every piece of evidence exactly from the handout', () => {
    const quotes = [
      ...sample.outline.units.flatMap((u) => u.concepts.flatMap((c) => c.keyPoints.map((k) => k.evidence.quote))),
      ...sample.outline.materialItems.map((m) => m.evidence.quote),
      ...Object.values(sample.misconceptions).flatMap((ms) => ms.map((m) => m.evidence.quote)),
      ...sample.questions.map((q) => q.q),
    ];
    for (const q of quotes) expect(handout).toContain(normalizeForMatch(q));
  });

  it('has unique question prompts and the six material common mistakes', () => {
    const keys = sample.questions.map((q) => `${q.prompt}||${q.stmt ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(sample.outline.materialItems.filter((m) => m.kind === 'common_mistake')).toHaveLength(6);
    expect(sample.questions.filter((q) => q.type === 'free_response').length).toBeLessThanOrEqual(1);
  });
});

describe('mock verifyQuestion', () => {
  it('answers a canned question from its public form, and gives up on unknown ones', async () => {
    const tasks = createMockIngestTasks();
    const out = await tasks.verifyQuestion({
      question: { id: 'q', type: 'numeric', prompt: 'What is the tilt of Earth\'s axis, in degrees?', payload: { unit: 'degrees' }, difficulty: 1, timeBudgetSec: 20 },
      evidence: [],
    });
    expect(out.answer).toEqual({ value: 23.5 });
    expect(out.workedSteps[0].kind).toBe('recall');
    const unknown = await tasks.verifyQuestion({
      question: { id: 'q', type: 'short_text', prompt: 'nothing like this', payload: {}, difficulty: 1, timeBudgetSec: 20 },
      evidence: [],
    });
    expect(unknown.answer).toEqual({ dontKnow: true });
  });
});
