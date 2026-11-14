import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testConfig } from '../config';
import { createOpenAiClient, toOpenAiSchema } from './openai-client';

const completed = (value: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }] });
function transport(replies: { body?: unknown; status?: number; error?: Error }[]) {
  const send = vi.fn<typeof fetch>(async () => {
    const reply = replies.shift() ?? {};
    if (reply.error) throw reply.error;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return send;
}
const config = testConfig({ llmProvider: 'openai', openaiApiKey: 'test-key-do-not-echo', embeddingModel: 'text-embedding-3-small', embeddingDims: 2 });

describe('OpenAI transport', () => {
  it('preserves the configured GPT-6 Luna model and requests its supported low-latency mode', async () => {
    const send = transport([{ body: completed({ ok: true }) }]);
    await createOpenAiClient({ ...config, openaiModel: 'gpt-6-luna' }, send).generateJson(z.object({ ok: z.boolean() }), 'hi');
    expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toMatchObject({ model: 'gpt-6-luna', reasoning: { effort: 'none' } });
  });

  it('honors a per-call timeout and names the failed operation', async () => {
    const send = vi.fn<typeof fetch>(() => new Promise<never>(() => {}));
    await expect(createOpenAiClient(config, send).generateJson(z.object({ ok: z.boolean() }), 'hi', { timeoutMs: 15, label: 'extractOutline' })).rejects.toThrow('OpenAI extractOutline timed out after 15 ms');
  });

  it('uses strict Responses output with closed nested objects and nullable optional fields', async () => {
    const schema = z.object({ answer: z.string(), choice: z.number().optional(), nested: z.object({ hint: z.string().optional() }).nullish() });
    const json = toOpenAiSchema(schema);
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(['answer', 'choice', 'nested']);
    expect(JSON.stringify(json)).not.toContain('$schema');
    const send = transport([{ body: completed({ answer: 'yes', choice: null, nested: { hint: null } }) }]);
    const result = await createOpenAiClient(config, send).generateJson(schema, 'question', { system: 'Notebook only', files: [{ uri: 'file-123', name: 'file-123', mimeType: 'application/pdf' }] });
    expect(result).toEqual({ answer: 'yes', nested: {} });
    const body = JSON.parse(send.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ model: config.openaiModel, instructions: 'Notebook only', store: false, text: { format: { strict: true, type: 'json_schema' } } });
    expect(body.input[0].content[0]).toEqual({ type: 'input_file', file_id: 'file-123' });
    expect(body).not.toHaveProperty('temperature');
  });

  it('retries malformed or invalid output once, then validates with Zod', async () => {
    const send = transport([{ body: completed('not-json') }, { body: completed({ count: 2 }) }]);
    await expect(createOpenAiClient(config, send).generateJson(z.object({ count: z.number() }), 'hi')).resolves.toEqual({ count: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    const invalid = transport([{ body: completed({ count: 'secret' }) }, { body: completed({ count: 'secret' }) }]);
    await expect(createOpenAiClient(config, invalid).generateJson(z.object({ count: z.number() }), 'hi')).rejects.toThrow(/^OpenAI reply invalid after retry$/);
    expect(invalid).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 429, 500])('does not expose raw provider diagnostics for HTTP %s', async (status) => {
    const send = transport([{ status, body: { error: { message: 'test-key-do-not-echo PRIVATE MATERIAL' } } }]);
    const error = await createOpenAiClient(config, send).generateJson(z.object({ ok: z.boolean() }), 'hi').catch(e => e);
    expect(error.code).toBe('llm_error');
    expect(error.message).not.toMatch(/test-key-do-not-echo|PRIVATE MATERIAL/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('handles refusals and incomplete output instead of parsing them as successful answers', async () => {
    const refusal = transport([{ body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private' }] }] } }]);
    await expect(createOpenAiClient(config, refusal).generateJson(z.object({ ok: z.boolean() }), 'hi')).rejects.toThrow('OpenAI could not complete this task');
    const incomplete = transport([{ body: { status: 'incomplete', output: [] } }]);
    await expect(createOpenAiClient(config, incomplete).generateJson(z.object({ ok: z.boolean() }), 'hi')).rejects.toThrow(/incomplete/);
  });

  it('bounds a request even if the transport never settles', async () => {
    const send = vi.fn<typeof fetch>(() => new Promise<never>(() => {}));
    await expect(createOpenAiClient({ ...config, llmTimeoutMs: 15 }, send).generateJson(z.object({ ok: z.boolean() }), 'hi')).rejects.toThrow(/timed out/);
    expect(send.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it('sorts indexed embeddings, uses configured dimensions and normalizes vectors', async () => {
    const send = transport([{ body: { data: [{ index: 1, embedding: [0, 5] }, { index: 0, embedding: [3, 4] }] } }]);
    const vectors = await createOpenAiClient(config, send).embed(['first', 'second'], 'RETRIEVAL_DOCUMENT');
    expect(vectors).toEqual([[0.6, 0.8], [0, 1]]);
    expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toEqual({ model: config.embeddingModel, input: ['first', 'second'], dimensions: 2, encoding_format: 'float' });
    const bad = transport([{ body: { data: [{ index: 0, embedding: [1] }] } }]);
    await expect(createOpenAiClient(config, bad).embed(['x'], 'RETRIEVAL_QUERY')).rejects.toThrow(/invalid embedding/);
  });

  it('uploads native PDFs using user_data and returns the file id', async () => {
    const send = transport([{ body: { id: 'file-abc' } }]);
    const uploaded = await createOpenAiClient(config, send).uploadFile(new Uint8Array([1, 2]), { mimeType: 'application/pdf', displayName: 'lesson.pdf' });
    expect(uploaded.uri).toBe('file-abc');
    const form = send.mock.calls[0][1]!.body as FormData;
    expect(form.get('purpose')).toBe('user_data');
    expect((form.get('file') as File).name).toBe('lesson.pdf');
    expect((send.mock.calls[0][1]!.headers as Record<string, string>)['content-type']).toBeUndefined();
  });
});
