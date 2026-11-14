/**
 * Test double for `LlmClient`: scripted `generateJson` handlers keyed by `opts.label`, deterministic
 * hashed bag-of-words embeddings, and a fake file upload. Records every `generateJson` call.
 */
import type { z } from 'zod';
import { AppError } from '../errors';
import type { EmbedTaskType, GenerateOptions, LlmClient, UploadedFile } from './types';

export type FakeHandler = (prompt: string, opts: GenerateOptions) => unknown | Promise<unknown>;

export interface FakeLlmOptions {
  handlers?: Record<string, FakeHandler>;
  /** Vector size for `embed`. Default 768 (the config default). */
  embeddingDims?: number;
}

export interface FakeCall {
  label: string;
  prompt: string;
  opts: GenerateOptions;
}

export interface FakeLlmClient extends LlmClient {
  readonly provider: 'fake';
  readonly calls: FakeCall[];
  handlers: Record<string, FakeHandler>;
}

/** FNV-1a 32-bit hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Hashed bag-of-words embedding: lowercase, word tokens, each token adds 1 at `fnv1a(token) % dims`,
 * then unit-normalize. Texts that share words get a high cosine similarity. Empty text gives a zero vector.
 */
export function fakeEmbed(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const t of tokens) v[fnv1a(t) % dims] += 1;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

export function createFakeLlmClient(opts: FakeLlmOptions = {}): FakeLlmClient {
  const dims = opts.embeddingDims ?? 768;
  const calls: FakeCall[] = [];
  const handlers = { ...(opts.handlers ?? {}) };
  let uploads = 0;

  return {
    provider: 'fake',
    calls,
    handlers,
    async generateJson<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, prompt: string, o: GenerateOptions = {}) {
      const label = o.label ?? '';
      calls.push({ label, prompt, opts: o });
      const handler = handlers[label];
      if (!handler) throw new Error(`fake LLM: no handler for label "${label}"`);
      const raw = await handler(prompt, o);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError('llm_error', `fake LLM: handler "${label}" output failed validation: ${parsed.error.message}`);
      }
      return parsed.data;
    },
    async embed(texts: string[], _taskType: EmbedTaskType) {
      return texts.map((t) => fakeEmbed(t, dims));
    },
    async uploadFile(_source, o): Promise<UploadedFile> {
      uploads += 1;
      return { uri: `fake://files/${uploads}`, mimeType: o.mimeType, name: `files/fake-${uploads}` };
    },
  };
}
