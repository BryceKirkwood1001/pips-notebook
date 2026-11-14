import type { Db, Document } from 'mongodb';
import type { Chunk } from '@top/shared';
import type { Config } from '../config';
import type { ScoredChunk, VectorStore } from './types';
import { compareChunks, cosine } from './util';

/** The Atlas vector index we create (SPEC 3.2): vectors on `embedding`, filterable by `courseId`. */
export function vectorIndexDefinition(config: Config) {
  return {
    name: config.atlasVectorIndex,
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'vector', path: 'embedding', numDimensions: config.embeddingDims, similarity: 'cosine' },
        { type: 'filter', path: 'courseId' },
      ],
    },
  };
}

/** The aggregation pipeline sent for one search. */
export function vectorSearchPipeline(config: Config, courseId: string, embedding: number[], topK: number): Document[] {
  return [
    {
      $vectorSearch: {
        index: config.atlasVectorIndex,
        path: 'embedding',
        queryVector: embedding,
        // Atlas recommends numCandidates well above limit; 20x, within its 10000 cap.
        numCandidates: Math.min(10000, Math.max(100, topK * 20)),
        limit: topK,
        filter: { courseId },
      },
    },
    { $addFields: { _score: { $meta: 'vectorSearchScore' } } },
  ];
}

/** Mongo document -> Chunk: `_id` is the chunk id and is stripped. */
function fromDoc(doc: Document): Chunk {
  const { _id, _score, ...rest } = doc;
  void _id;
  void _score;
  return rest as Chunk;
}

export function createAtlasVectorStore(db: Db, config: Config): VectorStore {
  const col = db.collection('chunks');

  const listByCourse = async (courseId: string): Promise<Chunk[]> => {
    const docs = await col.find({ courseId }).toArray();
    return docs.map(fromDoc).sort(compareChunks);
  };

  return {
    async init() {
      await col.createIndex({ courseId: 1 });
      try {
        const existing = await col.listSearchIndexes(config.atlasVectorIndex).toArray();
        if (existing.length > 0) return;
        await col.createSearchIndex(vectorIndexDefinition(config));
      } catch (err) {
        // Already exists (race, or a name clash), or the deployment has no Atlas Search: never fatal.
        // Search falls back to in-process cosine ranking.
        console.warn('[rag] could not create the Atlas vector index:', (err as Error).message);
      }
    },

    async upsert(chunks) {
      if (chunks.length === 0) return;
      await col.bulkWrite(
        chunks.map((c) => ({
          replaceOne: { filter: { _id: c.id as never }, replacement: { _id: c.id, ...c }, upsert: true },
        })),
      );
    },

    async search({ courseId, embedding, topK }) {
      let hits: ScoredChunk[] = [];
      try {
        const docs = await col.aggregate(vectorSearchPipeline(config, courseId, embedding, topK)).toArray();
        hits = docs.map((d) => ({ chunk: fromDoc(d), score: d._score as number }));
      } catch {
        // The index is still building (or missing): fall through to the fallback.
      }
      if (hits.length > 0) return hits;
      // A new Atlas index returns nothing until it is built. Rank in process so retrieval works right away.
      const all = await listByCourse(courseId);
      return all
        .map((chunk) => ({ chunk, score: cosine(embedding, chunk.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },

    listByCourse,

    async getByIds(ids) {
      if (ids.length === 0) return [];
      const docs = await col.find({ _id: { $in: ids } as never }).toArray();
      const byId = new Map(docs.map((d) => [String(d._id), fromDoc(d)]));
      return ids.map((id) => byId.get(id)).filter((c): c is Chunk => c !== undefined);
    },

    async deleteCourse(courseId) {
      await col.deleteMany({ courseId });
    },
  };
}
