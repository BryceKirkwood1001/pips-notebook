import { QuestionSchema } from '@top/shared';
import { describe, expect, it } from 'vitest';
import { computeTimeBudget } from '../core/timeBudget';
import { quoteInText } from '../rag';
import { buildFixture, checkCoverage, runIngest, validateQuestion } from './index';
import { makeDeps, sampleFile } from './testHelpers';

async function ingest(name: string, opts: Parameters<typeof makeDeps>[0] = {}) {
  const ctx = makeDeps(opts);
  const report = await runIngest(ctx.deps, { courseId: `sample-${name}`, files: [sampleFile(name)] });
  const pack = (await ctx.repo.getCoursePack(`sample-${name}`))!;
  const questions = await ctx.repo.listQuestions(`sample-${name}`);
  return { ...ctx, report, pack, questions };
}

describe.each(['seasons', 'binary-search'])('mock ingest of %s', (name) => {
  it('ends ready with every coverage invariant satisfied', async () => {
    const { report, pack, questions, config } = await ingest(name);
    expect(report.error).toBeUndefined();
    expect(pack.status.stage).toBe('ready');
    expect(report.ok).toBe(true);
    expect(pack.concepts).toHaveLength(3);
    expect(pack.rooms).toHaveLength(3);
    expect(pack.status.conceptsReady).toHaveLength(3);
    const cov = checkCoverage(pack, questions, config);
    expect(cov).toMatchObject({ ok: true, unverified: 0, keyPointsWithoutQuestion: [], misconceptionsWithoutPath: [], roomsBelowPool: [] });
    expect(cov.multiConcept.have).toBeGreaterThanOrEqual(5);
    expect(pack.concepts.flatMap((c) => c.misconceptions)).toHaveLength(8);
  });

  it('stores only valid, verified questions with evidence that exists in its chunk', async () => {
    const { pack, questions, store } = await ingest(name);
    const chunks = new Map((await store.listByCourse(`sample-${name}`)).map((c) => [c.id, c]));
    for (const q of questions) {
      expect(q.verified).toBe(true);
      expect(QuestionSchema.safeParse(q).success).toBe(true);
      expect(validateQuestion(q, pack)).toEqual([]);
      const ev = q.provenance.evidence;
      expect(quoteInText(ev.quote, chunks.get(ev.chunkId)!.text)).toBe(true);
      if (q.type === 'ordering') expect(q.payload.correctOrder).not.toEqual(q.payload.items.map((_, i) => i));
      expect(q.solution.workedSteps.length).toBeGreaterThan(0);
    }
    for (const c of pack.concepts) for (const k of c.keyPoints) expect(chunks.get(k.evidence.chunkId)).toBeDefined();
    expect([...chunks.values()].some((c) => c.conceptIds.length > 0)).toBe(true);
  });

  it('builds a valid fixture', async () => {
    const { deps } = await ingest(name).then((r) => ({ deps: r.deps }));
    const fixture = await buildFixture(deps, `sample-${name}`, name);
    expect(fixture.embedderId).toBe(deps.embedder.id);
    expect(fixture.questions.length).toBeGreaterThan(30);
  });

  it('uses material items as verbatim questions first and generates only for gaps', async () => {
    const { questions, pack } = await ingest(name);
    const verbatim = questions.filter((q) => q.provenance.origin === 'verbatim');
    const generated = questions.filter((q) => q.provenance.origin === 'generated');
    expect(verbatim.length).toBeGreaterThan(questions.length / 2);
    expect(verbatim.every((q) => q.provenance.materialItemId)).toBe(true);
    // Every material item became a question.
    const used = new Set(verbatim.map((q) => q.provenance.materialItemId));
    expect(pack.materialItems.every((m) => used.has(m.id))).toBe(true);
    expect(generated.length).toBeLessThan(verbatim.length / 4);
    // Room 1 (c1) was already full from the handout: nothing adapted or generated for it alone.
    if (name === 'seasons') {
      const c1Only = questions.filter((q) => q.conceptIds.length === 1 && q.conceptIds[0] === 'c1');
      expect(c1Only.filter((q) => q.provenance.origin === 'generated')).toHaveLength(0);
    }
  });

  it('computes time budgets with the core formula', async () => {
    const { questions, pack, config } = await ingest(name);
    for (const q of questions) {
      expect(q.timeBudgetSec).toBeGreaterThanOrEqual(config.helpMeMinSec);
      expect(q.timeBudgetSec).toBeLessThanOrEqual(config.helpMeMaxSec);
      if (!pack.styleProfile.examTimeHint) expect(q.timeBudgetSec).toBe(computeTimeBudget(q, config).timeBudgetSec);
    }
  });
});

describe('seasons specifics', () => {
  it('picks up the "10 minutes for 5 questions" hint', async () => {
    const { pack, questions, config } = await ingest('seasons');
    expect(pack.styleProfile.examTimeHint).toEqual({ totalMinutes: 10, questionCount: 5 });
    for (const q of questions) {
      const expected = computeTimeBudget(q, config, { secondsPerQuestion: 120 });
      expect(q.timeBudgetSec).toBe(expected.timeBudgetSec);
    }
  });

  it('saves progressively and marks concepts ready in room order', async () => {
    const { saves } = await ingest('seasons', { config: { ingestConcurrency: 1 } });
    expect(saves.map((p) => p.status.stage)).toEqual(
      expect.arrayContaining(['parsing', 'outline', 'style', 'concepts', 'ready']),
    );
    const readySizes = saves.map((p) => p.status.conceptsReady.length);
    expect(readySizes).toEqual([...readySizes].sort((a, b) => a - b));
    const grown = saves.filter((p) => p.status.stage === 'concepts').map((p) => p.status.conceptsReady.join());
    expect(grown).toContain('c1');
    expect(grown).toContain('c1,c2');
    expect(saves.at(-1)?.status.conceptsReady).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('validation', () => {
  it('drops bad drafts and never serves unverified questions', async () => {
    const base = makeDeps().deps.tasks;
    const badConvert: typeof base.convertItems = async (input) => {
      const drafts = await base.convertItems(input);
      if (input.items[0]?.id !== 'm1') return drafts;
      const d = drafts[0];
      return [
        ...drafts,
        { ...d, prompt: 'bad quote', evidence: { quote: 'this sentence is nowhere in the handout' } },
        { ...d, prompt: 'bad payload', type: 'mcq', payload: { options: [{ text: 'a', misconceptionId: null }], correctIndex: 5 } },
        { ...d, prompt: 'bad misconception', type: 'true_false', payload: { statement: 'x', correctValue: true, wrongMisconceptionId: 'no_such_misconception' } },
      ];
    };
    const wrongKey: typeof base.verifyQuestion = async (input) => {
      const out = await base.verifyQuestion(input);
      // Disagree with the key of one specific question.
      return input.question.prompt.startsWith('What is the tilt') ? { ...out, answer: { value: 99 } } : out;
    };
    const { questions, pack, report } = await ingest('seasons', { tasks: { convertItems: badConvert, verifyQuestion: wrongKey } });
    const prompts = questions.map((q) => q.prompt);
    expect(prompts).not.toContain('bad quote');
    expect(prompts).not.toContain('bad payload');
    expect(prompts).not.toContain('bad misconception');
    const tilt = questions.filter((q) => q.prompt.startsWith('What is the tilt'));
    expect(tilt).toHaveLength(1);
    expect(tilt[0].verified).toBe(false); // stored for debugging, never served
    expect(report.coverage?.unverified).toBeGreaterThanOrEqual(1);
    expect(validateQuestion(questions.find((q) => q.verified)!, pack)).toEqual([]);
  });

  it('validateQuestion flags unknown ids', async () => {
    const { questions, pack } = await ingest('seasons');
    const q = structuredClone(questions.find((x) => x.type === 'true_false' && x.misconceptionIds.length > 0)!);
    q.conceptIds = ['c99'];
    q.keyPointIds = ['c1_k99'];
    q.misconceptionIds = ['nope'];
    const problems = validateQuestion(q, pack);
    expect(problems.join(' ')).toMatch(/unknown concept id "c99"/);
    expect(problems.join(' ')).toMatch(/unknown key point id/);
    expect(problems.join(' ')).toMatch(/unknown misconception id "nope"/);
  });
});

describe('failures', () => {
  it('a failing task leads to stage error and runIngest still resolves', async () => {
    const { report, pack } = await ingest('seasons', {
      tasks: {
        buildMisconceptions: async () => {
          throw new Error('boom');
        },
      },
    });
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/boom/);
    expect(pack.status.stage).toBe('error');
    expect(pack.status.error).toMatch(/boom/);
  });

  it('empty material ends in error, not a rejection', async () => {
    const ctx = makeDeps();
    const report = await runIngest(ctx.deps, { courseId: 'x', files: [sampleFile('empty', '   ')] });
    expect(report.ok).toBe(false);
    expect((await ctx.repo.getCoursePack('x'))?.status.stage).toBe('error');
  });
});

describe('unknown material (heuristic fallback)', () => {
  it('does not crash and builds a pack', async () => {
    const text = '# Plants\n\n## Photosynthesis\n\nPlants turn sunlight into chemical energy. Chlorophyll absorbs mostly red and blue light. Oxygen is released as a by-product.\n\n## Roots\n\nRoots anchor the plant in the soil. Roots absorb water and minerals from the ground.\n';
    const ctx = makeDeps();
    const report = await runIngest(ctx.deps, { courseId: 'plants', files: [sampleFile('plants', text)] });
    const pack = (await ctx.repo.getCoursePack('plants'))!;
    expect(report.error).toBeUndefined();
    expect(pack.status.stage).toBe('ready');
    expect(pack.concepts.map((c) => c.title)).toEqual(['Photosynthesis', 'Roots']);
    expect((await ctx.repo.listQuestions('plants')).some((q) => q.verified)).toBe(true);
  });
});
