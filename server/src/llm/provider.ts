import type { Config } from '../config';
import { createFakeLlmClient } from './fake-client';
import { createGeminiClient } from './gemini-client';
import { createOpenAiClient } from './openai-client';
import type { LlmClient } from './types';

export function createLlmClient(config: Config): LlmClient {
  switch (config.llmProvider) {
    case 'openai': return createOpenAiClient(config);
    case 'gemini': return createGeminiClient(config);
    case 'mock': return createFakeLlmClient({ embeddingDims: config.embeddingDims });
  }
}
