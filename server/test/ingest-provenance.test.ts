/** Drives the real ingest pipeline with the mock tasks: verbatim questions come before anything generated. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyCoursePack } from '@pips-notebook/shared';
import { testConfig } from '../src/config';
import { createTestClock } from './helpers/fakes';
import { runIngest, checkCoverage } from '../src/ingest';
import { createFakeLlmClient } from '../src/llm';
import { createMockIngestTasks } from '../src/llm/ingest';
import { createChunker, createEmbedder, createMaterialParser, createMemoryVectorStore, createRetriever } from '../src/rag';
import { createMemoryRepository } from '../src/repo';

describe.each(['seasons', 'binary-search'])('runIngest with mock tasks: %s', (sample) => {
  it('stores verbatim questions for every convertible item, in order, before generated ones', async () => {
    const config = testConfig();
    const llm = createFakeLlmClient();
    const embedder = createEmbedder(llm, config);
    const store = createMemoryVectorStore();
    const repo = createMemoryRepository();
    const clock = createTestClock();
    const courseId = `qa-${sample}`;
    await repo.saveCoursePack(emptyCoursePack(courseId, sample, clock.now().toISOString()));
    const data = new Uint8Array(readFileSync(new URL(`../../samples/${sample}.md`, import.meta.url)));
    const report = await runIngest(
      {
        config, tasks: createMockIngestTasks(), parser: createMaterialParser({ config }), chunker: createChunker(config),
        embedder, store, retriever: createRetriever({ store, embedder, config }), repo, clock,
      },
      { courseId, files: [{ id: 'f1', name: `${sample}.md`, type: 'md', data }] },
    );
    expect(report.ok, report.error).toBe(true);

    const pack = (await repo.getCoursePack(courseId))!;
    const questions = await repo.listQuestions(courseId);
    expect(pack.status.stage).toBe('ready');
    expect(checkCoverage(pack, questions, config).ok).toBe(true);

    const items = pack.materialItems.filter((m) => ['practice_problem', 'review_question', 'quiz_item'].includes(m.kind));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(questions.some((q) => q.provenance.origin === 'verbatim' && q.provenance.materialItemId === item.id), item.id).toBe(true);
    }

    // Ids are `${courseId}_q<n>` in creation order within a concept: no generated question precedes a verbatim
    // question that targets the same concept.
    const num = (id: string) => Number(id.split('_q').pop());
    for (const c of pack.concepts) {
      const mine = questions.filter((q) => q.conceptIds.length === 1 && q.conceptIds[0] === c.id).sort((a, b) => num(a.id) - num(b.id));
      const firstGenerated = mine.findIndex((q) => q.provenance.origin !== 'verbatim');
      if (firstGenerated >= 0) {
        expect(mine.slice(firstGenerated).some((q) => q.provenance.origin === 'verbatim'), `${c.id}: verbatim after generated`).toBe(false);
      }
    }
  });
});
