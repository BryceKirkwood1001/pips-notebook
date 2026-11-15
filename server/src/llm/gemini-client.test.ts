import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testConfig } from '../config';
import { createGeminiClient, toGeminiSchema, type GenAiLike } from './gemini-client';

const schema = z.object({ n: z.number() });

function stub(replies: (string | Error | Promise<string>)[]) {
  const generateContent = vi.fn(async (_p: any) => {
    const r = replies.shift();
    if (r instanceof Error) throw r;
    return { text: await r };
  });
  const embedContent = vi.fn(async (p: any) => ({
    embeddings: (p.contents as string[]).map(() => ({ values: [3, 4] })),
  }));
  const upload = vi.fn(async () => ({ name: 'files/1', uri: 'u', mimeType: 'application/pdf', state: 'PROCESSING' }));
  const get = vi.fn(async () => ({ name: 'files/1', uri: 'u', mimeType: 'application/pdf', state: 'ACTIVE' }));
  const sdk: GenAiLike = { models: { generateContent, embedContent }, files: { upload, get } };
  return { sdk, generateContent, embedContent, upload, get };
}

describe('toGeminiSchema', () => {
  it('strips unsupported keywords', () => {
    const s = JSON.stringify(toGeminiSchema(z.object({ a: z.array(z.object({ b: z.string() })) })));
    expect(s).not.toMatch(/\$schema|additionalProperties|\$ref/);
    expect(s).toContain('"type":"object"');
  });
});

describe('createGeminiClient.generateJson', () => {
  const config = testConfig({ llmTimeoutMs: 50 });

  it('returns parsed output and sends schema, system, files and temperature 0.2', async () => {
    const { sdk, generateContent } = stub(['{"n":1}']);
    const llm = createGeminiClient(config, sdk);
    const out = await llm.generateJson(schema, 'hi', { system: 'sys', files: [{ uri: 'gs://f', mimeType: 'application/pdf', name: 'files/1' }] });
    expect(out).toEqual({ n: 1 });
    const p = generateContent.mock.calls[0][0];
    expect(p.config.responseMimeType).toBe('application/json');
    expect(p.config.responseJsonSchema).toBeTruthy();
    expect(p.config.systemInstruction).toBe('sys');
    expect(p.config.temperature).toBe(0.2);
    expect(p.contents[0].parts[0].fileData.fileUri).toBe('gs://f');
    expect(p.model).toBe(config.geminiModel);
  });

  it('retries once on a validation failure, adding the error to the prompt', async () => {
    const { sdk, generateContent } = stub(['{"n":"x"}', '{"n":2}']);
    const out = await createGeminiClient(config, sdk).generateJson(schema, 'hi');
    expect(out).toEqual({ n: 2 });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0].contents[0].parts.at(-1).text).toMatch(/rejected/);
  });

  it('retries once on invalid JSON, then throws llm_error', async () => {
    const { sdk, generateContent } = stub(['not json', 'still not json']);
    await expect(createGeminiClient(config, sdk).generateJson(schema, 'hi')).rejects.toMatchObject({ code: 'llm_error' });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('turns SDK errors and timeouts into llm_error', async () => {
    const a = stub([new Error('boom')]);
    await expect(createGeminiClient(config, a.sdk).generateJson(schema, 'hi')).rejects.toMatchObject({ code: 'llm_error' });
    const never = new Promise<string>(() => undefined);
    const b = stub([never]);
    await expect(createGeminiClient(config, b.sdk).generateJson(schema, 'hi', { timeoutMs: 20 })).rejects.toThrow(/timed out/);
  });

  it('keeps provider diagnostics and invalid model output out of public errors', async () => {
    const a = stub([new Error('secret-key answer-key')]);
    await expect(createGeminiClient(config, a.sdk).generateJson(schema, 'hi')).rejects.toThrow(/^LLM call failed$/);
    const b = stub(['answer-key secret-key', 'answer-key secret-key']);
    await expect(createGeminiClient(config, b.sdk).generateJson(schema, 'hi')).rejects.toThrow(/^LLM reply invalid after retry$/);
  });
});

describe('createGeminiClient.embed and uploadFile', () => {
  const config = testConfig({ embeddingDims: 2 });
  it('batches by 100, normalizes and passes taskType and dims', async () => {
    const { sdk, embedContent } = stub([]);
    const out = await createGeminiClient(config, sdk).embed(Array(150).fill('x'), 'RETRIEVAL_DOCUMENT');
    expect(out).toHaveLength(150);
    expect(out[0]).toEqual([0.6, 0.8]);
    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(embedContent.mock.calls[0][0].config).toEqual({ taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 2 });
  });
  it('waits for the file to become active', async () => {
    vi.useFakeTimers();
    const { sdk, get } = stub([]);
    const p = createGeminiClient(config, sdk).uploadFile(new Uint8Array([1]), { mimeType: 'application/pdf' });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toMatchObject({ uri: 'u', name: 'files/1' });
    expect(get).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each(['upload', 'get'] as const)('times out a stalled Files API %s call', async (method) => {
    vi.useFakeTimers();
    try {
      const { sdk } = stub([]);
      sdk.files[method] = vi.fn(() => new Promise<never>(() => {}));
      const pending = createGeminiClient({ ...config, llmTimeoutMs: 50 }, sdk)
        .uploadFile(new Uint8Array([1]), { mimeType: 'application/pdf' });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'llm_error', message: expect.stringMatching(/timed out/) });
      await vi.advanceTimersByTimeAsync(1100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
