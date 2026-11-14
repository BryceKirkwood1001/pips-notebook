/** OpenAI Responses, embeddings and Files REST APIs. Uses Node fetch; no browser credentials. */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Config } from '../config';
import { AppError } from '../errors';
import type { GenerateOptions, LlmClient } from './types';
import { readOpenAiStream } from './openai-stream';

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  [key: string]: unknown;
};
const allowsNull = (s: JsonSchema): boolean => s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null')) || !!s.anyOf?.some(allowsNull);
const originalSchema = (schema: z.ZodTypeAny) => zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as JsonSchema;

/** OpenAI requires closed objects with every property required; optional values become nullable. */
export function toOpenAiSchema(schema: z.ZodTypeAny): JsonSchema {
  function convert(node: JsonSchema): JsonSchema {
    const { $schema, default: _default, definitions, $defs, ...out } = node;
    if (node.properties) {
      out.properties = Object.fromEntries(Object.entries(node.properties).map(([name, prop]) => {
        const converted = convert(prop);
        return [name, !node.required?.includes(name) && !allowsNull(prop) ? { anyOf: [converted, { type: 'null' }] } : converted];
      }));
      out.type = 'object';
      out.required = Object.keys(node.properties);
      out.additionalProperties = false;
    }
    if (node.items) out.items = convert(node.items);
    if (node.anyOf) out.anyOf = node.anyOf.map(convert);
    return out;
  }
  return convert(originalSchema(schema));
}

/** Remove only the artificial nulls introduced for optional, non-nullable properties. */
function restoreOptionalFields(value: unknown, schema: JsonSchema): unknown {
  if (schema.anyOf) {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const variant = schema.anyOf.find((s) => s.type === type || (Array.isArray(s.type) && s.type.includes(type)));
    if (variant) return restoreOptionalFields(value, variant);
  }
  if (Array.isArray(value) && schema.items) return value.map((v) => restoreOptionalFields(v, schema.items!));
  if (value && typeof value === 'object' && schema.properties) {
    return Object.fromEntries(Object.entries(value).flatMap(([name, v]) => {
      const prop = schema.properties![name];
      if (!prop) return [[name, v]];
      if (v === null && !schema.required?.includes(name) && !allowsNull(prop)) return [];
      return [[name, restoreOptionalFields(v, prop)]];
    }));
  }
  return value;
}

const API = 'https://api.openai.com/v1';
class OpenAiHttpError extends AppError {
  constructor(readonly httpStatus: number, message: string) { super('llm_error', message); }
}
const errors: Record<number, string> = {
  401: 'OpenAI rejected the API key. Check it in Settings.',
  403: 'OpenAI denied access to this resource or model.',
  404: 'OpenAI could not find the configured model or file. Check the model name and account access.',
  429: 'OpenAI rate limit or quota reached. Check your API account and retry later.',
  400: 'OpenAI rejected the request. Check model support and API settings.',
};

export function createOpenAiClient(config: Config, doFetch: typeof fetch = fetch): LlmClient {
  let summariesAvailable = true;
  async function request(path: string, body: unknown, timeoutMs = config.llmTimeoutMs, task = 'request', onSummary?: GenerateOptions['onReasoningSummary']): Promise<any> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cap: ReturnType<typeof setTimeout> | undefined;
    let rejectTimeout: (reason: AppError) => void = () => {};
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        controller.abort();
        rejectTimeout(new AppError('llm_error', `OpenAI ${task} timed out after ${timeoutMs} ms${onSummary ? ' without progress' : ''}`));
      }, timeoutMs);
    };
    const expired = new Promise<never>((_, reject) => {
      rejectTimeout = reject; arm();
      if (onSummary) cap = setTimeout(() => { controller.abort(); reject(new AppError('llm_error', `OpenAI ${task} exceeded the request time limit. Please retry.`)); }, Math.max(timeoutMs, 600000));
    });
    const operation = (async () => {
      const form = body instanceof FormData;
      const response = await doFetch(API + path, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.openaiApiKey}`, ...(!form ? { 'content-type': 'application/json' } : {}) },
        body: form ? body : JSON.stringify(body), signal: controller.signal,
      });
      if (!response.ok) throw new OpenAiHttpError(response.status, errors[response.status] ?? 'OpenAI request failed. Please retry.');
      if (onSummary && response.headers.get('content-type')?.includes('text/event-stream')) return readOpenAiStream(response, onSummary, arm);
      return response.json();
    })();
    try {
      return await Promise.race([operation, expired]);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('llm_error', 'Could not complete the OpenAI request. Please retry.');
    } finally {
      clearTimeout(timer);
      clearTimeout(cap);
    }
  }

  async function generateOnce(format: JsonSchema, prompt: string, opts: GenerateOptions): Promise<string> {
    const model = opts.model ?? config.openaiModel;
    const luna = ['gpt-5.6-luna', 'gpt-6-luna'].includes(model);
    const summaries = summariesAvailable && luna && opts.label === 'extractOutline' && !!opts.onReasoningSummary;
    const payload: Record<string, unknown> = {
      model, store: false,
      instructions: opts.system,
      input: [{ role: 'user', content: [
        ...(opts.files ?? []).map((f) => ({ type: 'input_file', file_id: f.uri })),
        { type: 'input_text', text: prompt },
      ] }],
      text: { format: { type: 'json_schema', name: 'task_result', schema: format, strict: true } },
      max_output_tokens: opts.maxOutputTokens ?? 16384,
      ...(summaries ? { stream: true } : {}),
      // These verified Luna models support none; do not infer support for arbitrary model names.
      ...(luna ? { reasoning: summaries ? { effort: 'low', summary: 'auto' } : { effort: 'none' } } : {}),
      ...(/^gpt-4/.test(model) ? { temperature: opts.temperature ?? 0.2 } : {}),
    };
    let response: any;
    try {
      response = await request('/responses', payload, opts.timeoutMs, opts.label ?? 'generation', summaries ? opts.onReasoningSummary : undefined);
    } catch (error) {
      // Some accounts cannot use summaries. Keep document preparation available with normal progress.
      if (!summaries || !(error instanceof OpenAiHttpError) || ![400, 403].includes(error.httpStatus)) throw error;
      summariesAvailable = false;
      delete payload.stream; payload.reasoning = { effort: 'none' };
      response = await request('/responses', payload, opts.timeoutMs, opts.label ?? 'generation');
    }
    if (response.status && response.status !== 'completed') throw new AppError('llm_error', 'OpenAI returned an incomplete response. Try a larger output budget or a different model.');
    const content = (response.output ?? []).flatMap((item: any) => item.type === 'message' ? item.content ?? [] : []);
    if (content.some((part: any) => part.type === 'refusal')) throw new AppError('llm_error', 'OpenAI could not complete this task.');
    return content.filter((part: any) => part.type === 'output_text').map((part: any) => part.text).join('');
  }

  return {
    provider: 'openai',
    async generateJson<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, prompt: string, opts: GenerateOptions = {}): Promise<T> {
      const jsonSchema = toOpenAiSchema(schema);
      const original = originalSchema(schema);
      for (let attempt = 0; attempt < 2; attempt++) {
        const text = await generateOnce(jsonSchema, prompt + (attempt ? '\nThe previous response was invalid. Return valid JSON matching the supplied schema.' : ''), opts);
        try {
          const result = schema.safeParse(restoreOptionalFields(JSON.parse(text), original));
          if (result.success) return result.data;
        } catch { /* Invalid JSON: one retry, without echoing model output or secrets. */ }
      }
      throw new AppError('llm_error', 'OpenAI reply invalid after retry');
    },
    async embed(texts, _taskType) {
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += 100) {
        const batch = texts.slice(start, start + 100);
        const response = await request('/embeddings', { model: config.embeddingModel, input: batch, dimensions: config.embeddingDims, encoding_format: 'float' }, config.llmTimeoutMs, 'embedding request');
        const items = Array.isArray(response.data) ? [...response.data].sort((a, b) => a.index - b.index) : [];
        if (items.length !== batch.length || items.some((item, i) => item.index !== i || !Array.isArray(item.embedding) || item.embedding.length !== config.embeddingDims || item.embedding.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n)))) {
          throw new AppError('llm_error', 'OpenAI returned invalid embedding vectors');
        }
        for (const item of items) {
          const vector: number[] = item.embedding;
          const norm = Math.hypot(...vector);
          vectors.push(norm ? vector.map((n) => n / norm) : vector);
        }
      }
      return vectors;
    },
    async uploadFile(source, opts) {
      const bytes = typeof source === 'string' ? await readFile(source) : source;
      const form = new FormData();
      form.append('purpose', 'user_data');
      form.append('file', new Blob([new Uint8Array(bytes)], { type: opts.mimeType }), opts.displayName ?? (typeof source === 'string' ? basename(source) : 'material.pdf'));
      const uploaded = await request('/files', form, config.llmTimeoutMs, 'file upload');
      if (typeof uploaded.id !== 'string' || !uploaded.id) throw new AppError('llm_error', 'OpenAI file upload returned no file id');
      return { uri: uploaded.id, name: uploaded.id, mimeType: opts.mimeType };
    },
  };
}
