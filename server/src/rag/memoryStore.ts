import type { Chunk } from '@pips-notebook/shared';
import type { ScoredChunk, VectorStore } from './types';
import { compareChunks, cosine } from './util';

export function createMemoryVectorStore(): VectorStore {
  const chunks = new Map<string, Chunk>();
  const ofCourse = (courseId: string) => [...chunks.values()].filter((c) => c.courseId === courseId);

  return {
    async init() {},
    async upsert(list) {
      for (const c of list) chunks.set(c.id, c);
    },
    async search({ courseId, embedding, topK }) {
      const scored: ScoredChunk[] = ofCourse(courseId).map((chunk) => ({ chunk, score: cosine(embedding, chunk.embedding) }));
      return scored.sort((a, b) => b.score - a.score).slice(0, topK);
    },
    async listByCourse(courseId) {
      return ofCourse(courseId).sort(compareChunks);
    },
    async getByIds(ids) {
      return ids.map((id) => chunks.get(id)).filter((c): c is Chunk => c !== undefined);
    },
    async deleteCourse(courseId) {
      for (const c of ofCourse(courseId)) chunks.delete(c.id);
    },
  };
}
