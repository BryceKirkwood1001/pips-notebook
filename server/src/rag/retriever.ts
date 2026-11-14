import type { Chunk } from '@top/shared';
import type { Config } from '../config';
import type { Embedder, RetrievedChunk, Retriever, VectorStore } from './types';

const MAX_CONCEPT_CHUNKS = 8;

const toRetrieved = (c: Chunk, score: number, source: RetrievedChunk['source']): RetrievedChunk => ({
  chunkId: c.id,
  fileId: c.fileId,
  page: c.page,
  sectionPath: c.sectionPath,
  text: c.text,
  score,
  source,
});

export function createRetriever(deps: { store: VectorStore; embedder: Embedder; config: Config }): Retriever {
  const { store, embedder, config } = deps;
  return {
    async retrieve({ courseId, query, conceptIds, topK }) {
      const out: RetrievedChunk[] = [];
      const seen = new Set<string>();

      // 1. Structure first: the concepts' own chunks, in document order.
      if (conceptIds && conceptIds.length > 0) {
        const wanted = new Set(conceptIds);
        const all = await store.listByCourse(courseId);
        for (const c of all) {
          if (out.length >= MAX_CONCEPT_CHUNKS) break;
          if (c.conceptIds.some((id) => wanted.has(id))) {
            out.push(toRetrieved(c, 1, 'concept'));
            seen.add(c.id);
          }
        }
      }

      // 2. Then the vector hits for the query.
      if (query.trim() !== '') {
        const embedding = await embedder.embedQuery(query);
        const hits = await store.search({ courseId, embedding, topK: topK ?? config.retrievalTopK });
        for (const h of hits) {
          if (seen.has(h.chunk.id)) continue;
          seen.add(h.chunk.id);
          out.push(toRetrieved(h.chunk, h.score, 'vector'));
        }
      }
      return out;
    },
  };
}
