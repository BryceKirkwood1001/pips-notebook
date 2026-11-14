/**
 * `npm run ingest -- samples/seasons.md [more files]`
 * Ingests one or more files into in-memory storage and writes samples/cache/<name>.json (a CourseFixture).
 * With several files they are ingested as one course named after the first file. Exits non-zero when
 * ingest fails or a coverage invariant does not hold.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileType } from '@top/shared';
import { loadConfigFromProcess } from '../config';
import { systemClock } from '../engine/types';
import { createLlmClient } from '../llm';
import { createApiSettingsManager } from '../settings';
import { createMockIngestTasks } from '../llm/ingest/mock';
import type { IngestTasks } from '../llm/types';
import { createChunker, createEmbedder, createMaterialParser, createMemoryVectorStore, createRetriever } from '../rag';
import type { SourceFile } from '../rag/types';
import { createMemoryRepository } from '../repo';
import { buildFixture, runIngest } from './index';

const CACHE_DIR = fileURLToPath(new URL('../../../samples/cache/', import.meta.url));

async function main(): Promise<number> {
  const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    console.error('usage: npm run ingest -- <file.md|.txt|.pdf> [more files]');
    return 2;
  }
  const manager = await createApiSettingsManager(loadConfigFromProcess(), { file: fileURLToPath(new URL('../../../.local/api-settings.json', import.meta.url)) });
  const config = manager.config();
  config.llmTimeoutMs = config.ingestLlmTimeoutMs;
  const mock = config.llmProvider === 'mock';
  const llm = createLlmClient(config);
  let tasks: IngestTasks;
  if (mock) tasks = createMockIngestTasks();
  else tasks = (await import('../llm/ingest/gemini')).createIngestTasks(llm, config);

  const files: SourceFile[] = [];
  for (const [i, p] of paths.entries()) {
    const ext = extname(p).slice(1).toLowerCase();
    if (ext !== 'pdf' && ext !== 'txt' && ext !== 'md') throw new Error(`unsupported file type: ${p}`);
    files.push({ id: `f${i + 1}`, name: basename(p), type: ext as FileType, data: new Uint8Array(await readFile(resolve(p))) });
  }
  const name = basename(paths[0], extname(paths[0])).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const courseId = `sample-${name}`;

  const store = createMemoryVectorStore();
  const embedder = createEmbedder(llm, config);
  const deps = {
    config,
    tasks,
    parser: createMaterialParser({ llm: mock ? undefined : llm, config }),
    chunker: createChunker(config),
    embedder,
    store,
    retriever: createRetriever({ store, embedder, config }),
    repo: createMemoryRepository(),
    clock: systemClock,
    log: (m: string) => console.log(`  ${m}`),
  };

  console.log(`Ingesting ${paths.join(', ')} as "${courseId}" (${config.llmProvider})`);
  const report = await runIngest(deps, { courseId, files });
  const fixture = await buildFixture(deps, courseId, name);
  await mkdir(CACHE_DIR, { recursive: true });
  const out = `${CACHE_DIR}${name}.json`;
  await writeFile(out, `${JSON.stringify(fixture, null, 2)}\n`);

  const cov = report.coverage;
  console.log(`\nResult: ${report.ok ? 'OK' : 'FAILED'}${report.error ? ` (${report.error})` : ''}`);
  console.log(`Time: first room ${report.firstRoomReadyMs ?? '-'} ms, total ${report.totalMs} ms`);
  if (cov) {
    console.log(`Questions: ${cov.totalVerified} verified, ${cov.unverified} unverified`);
    console.log(`Provenance: ${JSON.stringify(cov.provenanceMix)}`);
    console.log(`Types: ${JSON.stringify(cov.typeMix)}`);
    console.log(`Multi-concept: ${cov.multiConcept.have} (need ${cov.multiConcept.need})`);
    if (cov.roomsBelowPool.length) console.log(`Rooms below pool: ${JSON.stringify(cov.roomsBelowPool)}`);
    if (cov.keyPointsWithoutQuestion.length) console.log(`Key points without question: ${cov.keyPointsWithoutQuestion.join(', ')}`);
    if (cov.misconceptionsWithoutPath.length) console.log(`Misconceptions without path: ${cov.misconceptionsWithoutPath.join(', ')}`);
  }
  console.log(`Fixture: ${out}`);
  return report.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
