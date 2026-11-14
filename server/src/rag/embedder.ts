import type { Config } from '../config';
import type { LlmClient } from '../llm/types';
import type { Embedder } from './types';

const BATCH = 100;

export function createEmbedder(llm: LlmClient, config: Config): Embedder {
  const id =
    llm.provider === 'fake' ? `fake-hash@${config.embeddingDims}` : `${config.embeddingModel}@${config.embeddingDims}`;
  return {
    id,
    dims: config.embeddingDims,
    async embedDocuments(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        out.push(...(await llm.embed(texts.slice(i, i + BATCH), 'RETRIEVAL_DOCUMENT')));
      }
      return out;
    },
    async embedQuery(text) {
      const [v] = await llm.embed([text], 'RETRIEVAL_QUERY');
      return v;
    },
  };
}
