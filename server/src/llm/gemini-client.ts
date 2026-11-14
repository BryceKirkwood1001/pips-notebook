/**
 * Gemini transport (`@google/genai`). The SDK object can be injected so the retry, validation and
 * timeout logic is unit-testable with a stub.
 */
import { GoogleGenAI } from '@google/genai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { Config } from '../config';
import { AppError } from '../errors';
import type { EmbedTaskType, GenerateOptions, LlmClient, UploadedFile } from './types';

/** The slice of the SDK this client uses. The real `GoogleGenAI` satisfies it. */
export interface GenAiLike {
  models: {
    generateContent(params: any): Promise<{ text?: string }>;
    embedContent(params: any): Promise<{ embeddings?: { values?: number[] }[] }>;
  };
  files: {
    upload(params: any): Promise<{ name?: string; uri?: string; mimeType?: string; state?: string }>;
    get(params: { name: string }): Promise<{ name?: string; uri?: string; mimeType?: string; state?: string }>;
  };
}

const EMBED_BATCH = 100; // the embedContent API accepts at most 100 texts per call
const FILE_POLL_MS = 1000;
const FILE_WAIT_MS = 120_000;

/** Removes the JSON-schema keywords Gemini's schema subset rejects, inlining local $refs. */
export function toGeminiSchema(schema: z.ZodTypeAny): unknown {
  const root = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<string, unknown>;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === '$schema' || k === 'additionalProperties' || k === '$ref' || k === 'definitions' || k === '$defs') continue;
        out[k] = clean(v);
      }
      return out;
    }
    return node;
  };
  return clean(root);
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rejects with a timeout error if `p` takes longer than `ms`. */
async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError('llm_error', `${what} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createGeminiClient(config: Config, sdk?: GenAiLike): LlmClient {
  const ai: GenAiLike = sdk ?? (new GoogleGenAI({ apiKey: config.geminiApiKey }) as unknown as GenAiLike);

  async function callOnce(jsonSchema: unknown, prompt: string, opts: GenerateOptions): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? config.llmTimeoutMs;
    const controller = new AbortController();
    const parts: unknown[] = [
      ...(opts.files ?? []).map((f) => ({ fileData: { fileUri: f.uri, mimeType: f.mimeType } })),
      { text: prompt },
    ];
    const req = ai.models.generateContent({
      model: opts.model ?? config.geminiModel,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: opts.system,
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxOutputTokens,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        abortSignal: controller.signal,
      },
    });
    try {
      const res = await withTimeout(req, timeoutMs, `LLM call ${opts.label ?? ''}`.trim());
      return res.text ?? '';
    } catch (err) {
      controller.abort();
      req.catch(() => undefined); // the aborted request may reject later; ignore it
      if (err instanceof AppError) throw err;
      throw new AppError('llm_error', `LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, text: string): { ok: true; value: T } | { ok: false; error: string } {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: `Reply was not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
    const r = schema.safeParse(json);
    return r.success ? { ok: true, value: r.data } : { ok: false, error: `Reply did not match the schema: ${r.error.message}` };
  }

  return {
    provider: 'gemini',

    async generateJson<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, prompt: string, opts: GenerateOptions = {}) {
      const jsonSchema = toGeminiSchema(schema);
      const first = parse(schema, await callOnce(jsonSchema, prompt, opts));
      if (first.ok) return first.value;
      // One retry, telling the model what was wrong.
      const retryPrompt = `${prompt}\n\nYour previous reply was rejected: ${first.error}\nReply again with valid JSON that matches the schema exactly.`;
      const second = parse(schema, await callOnce(jsonSchema, retryPrompt, opts));
      if (second.ok) return second.value;
      throw new AppError('llm_error', `LLM reply invalid after retry: ${second.error}`);
    },

    async embed(texts: string[], taskType: EmbedTaskType) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH);
        let res: { embeddings?: { values?: number[] }[] };
        try {
          res = await withTimeout(
            ai.models.embedContent({
              model: config.embeddingModel,
              contents: batch,
              config: { taskType, outputDimensionality: config.embeddingDims },
            }),
            config.llmTimeoutMs,
            'embed call',
          );
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw new AppError('llm_error', `Embedding call failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        const vectors = res.embeddings ?? [];
        if (vectors.length !== batch.length || vectors.some((e) => !e.values)) {
          throw new AppError('llm_error', `Embedding call returned ${vectors.length} vectors for ${batch.length} texts`);
        }
        for (const e of vectors) out.push(normalize(e.values as number[]));
      }
      return out;
    },

    async uploadFile(source, opts): Promise<UploadedFile> {
      try {
        const file =
          typeof source === 'string'
            ? source
            : new Blob([source as Uint8Array<ArrayBuffer>], { type: opts.mimeType });
        let f = await ai.files.upload({ file, config: { mimeType: opts.mimeType, displayName: opts.displayName } });
        const deadline = Date.now() + FILE_WAIT_MS;
        while (f.state === 'PROCESSING') {
          if (Date.now() > deadline) throw new Error('file stayed in PROCESSING too long');
          await sleep(FILE_POLL_MS);
          f = await ai.files.get({ name: f.name as string });
        }
        if (f.state === 'FAILED') throw new Error('file processing failed');
        if (!f.uri || !f.name) throw new Error('upload returned no uri');
        return { uri: f.uri, mimeType: f.mimeType ?? opts.mimeType, name: f.name };
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('llm_error', `File upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
