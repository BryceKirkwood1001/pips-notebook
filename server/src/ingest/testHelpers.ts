import { readFileSync } from 'node:fs';
import type { CoursePack } from '@top/shared';
import { testConfig, type Config } from '../config';
import { systemClock } from '../engine/types';
import { createFakeLlmClient } from '../llm';
import { createMockIngestTasks } from '../llm/ingest/mock';
import type { IngestTasks } from '../llm/types';
import { createChunker, createEmbedder, createMaterialParser, createMemoryVectorStore, createRetriever } from '../rag';
import type { SourceFile } from '../rag/types';
import { createMemoryRepository } from '../repo';
import type { IngestDeps } from './types';

export const sampleFile = (name: 'seasons' | 'binary-search' | string, text?: string): SourceFile => ({
  id: 'f1',
  name: `${name}.md`,
  type: 'md',
  data: new Uint8Array(
    Buffer.from(text ?? readFileSync(new URL(`../../../samples/${name}.md`, import.meta.url), 'utf8')),
  ),
});

export function makeDeps(opts: { config?: Partial<Config>; tasks?: Partial<IngestTasks> } = {}) {
  const config = testConfig(opts.config);
  const llm = createFakeLlmClient({ embeddingDims: config.embeddingDims });
  const store = createMemoryVectorStore();
  const embedder = createEmbedder(llm, config);
  const repo = createMemoryRepository();
  const saves: CoursePack[] = [];
  const realSave = repo.saveCoursePack.bind(repo);
  repo.saveCoursePack = async (pack) => {
    saves.push(structuredClone(pack));
    return realSave(pack);
  };
  const deps: IngestDeps = {
    config,
    tasks: { ...createMockIngestTasks(), ...opts.tasks },
    parser: createMaterialParser({ config }),
    chunker: createChunker(config),
    embedder,
    store,
    retriever: createRetriever({ store, embedder, config }),
    repo,
    clock: systemClock,
  };
  return { deps, repo, store, saves, config };
}
