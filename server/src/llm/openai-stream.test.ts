import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testConfig } from '../config';
import { createOpenAiClient } from './openai-client';

const config = testConfig({ llmProvider: 'openai', openaiModel: 'gpt-6-luna', openaiApiKey: 'test-key' });
const finish = { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }] } };
const bytes = (event: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\r\n\r\n`);
const schema = z.object({ ok: z.boolean() });
afterEach(() => vi.useRealTimers());

describe('OpenAI document summary streaming', () => {
  it('publishes public summary deltas before completion, ignoring raw reasoning and partial output', async () => {
    let control!: ReadableStreamDefaultController<Uint8Array>;
    let published!: () => void;
    const first = new Promise<void>(resolve => { published = resolve; });
    const response = new Response(new ReadableStream<Uint8Array>({ start(c) { control = c; } }), { headers: { 'content-type': 'text/event-stream' } });
    const send = vi.fn<typeof fetch>(async () => response);
    const summaries: string[] = [];
    let done = false;
    const result = createOpenAiClient(config, send).generateJson(schema, 'document', { label: 'extractOutline', onReasoningSummary: text => { summaries.push(text); published(); } }).then(value => { done = true; return value; });
    const data = bytes({ type: 'response.reasoning_summary_text.delta', item_id: 'rs1', delta: 'Grouping the cache topics.' });
    control.enqueue(data.slice(0, 11)); control.enqueue(data.slice(11));
    await first;
    expect(done).toBe(false);
    expect(summaries).toEqual(['Grouping the cache topics.']);
    control.enqueue(bytes({ type: 'response.reasoning_text.delta', delta: 'PRIVATE REASONING' }));
    control.enqueue(bytes({ type: 'response.output_text.delta', delta: 'PRIVATE JSON' }));
    control.enqueue(bytes(finish)); control.close();
    await expect(result).resolves.toEqual({ ok: true });
    expect(summaries.join('')).not.toContain('PRIVATE');
    expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toMatchObject({ stream: true, model: 'gpt-6-luna', reasoning: { effort: 'low', summary: 'auto' } });
  });

  it('extends the idle deadline while stream events continue', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream<Uint8Array>({ start(c) {
      for (const delay of [30, 60, 90]) setTimeout(() => c.enqueue(bytes({ type: 'response.in_progress' })), delay);
      setTimeout(() => { c.enqueue(bytes(finish)); c.close(); }, 120);
    } }), { headers: { 'content-type': 'text/event-stream' } });
    const result = createOpenAiClient({ ...config, llmTimeoutMs: 50 }, async () => response).generateJson(schema, 'doc', { label: 'extractOutline', onReasoningSummary() {} });
    const assertion = expect(result).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(125);
    await assertion;
  });

  it('caps a continuously active request instead of allowing it to run forever', async () => {
    vi.useFakeTimers();
    let interval: ReturnType<typeof setInterval>;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(c) { interval = setInterval(() => c.enqueue(bytes({ type: 'response.in_progress' })), 5000); },
      cancel() { clearInterval(interval); },
    }), { headers: { 'content-type': 'text/event-stream' } });
    const send = vi.fn<typeof fetch>(async (_url, options) => {
      options!.signal!.addEventListener('abort', () => { void response.body!.cancel().catch(() => undefined); clearInterval(interval); });
      return response;
    });
    const result = createOpenAiClient({ ...config, llmTimeoutMs: 10000 }, send).generateJson(schema, 'doc', { label: 'extractOutline', onReasoningSummary() {} });
    const assertion = expect(result).rejects.toThrow(/request time limit/);
    await vi.advanceTimersByTimeAsync(600001);
    await assertion;
    expect(send.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it('rejects a truncated stream without a completed response', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes({ type: 'response.in_progress' })); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    await expect(createOpenAiClient(config, async () => response).generateJson(schema, 'doc', { label: 'extractOutline', onReasoningSummary() {} })).rejects.toThrow(/before the response completed/);
  });

  it.each([400, 403])('falls back to progress-only when summaries are unavailable (HTTP %s)', async status => {
    let calls = 0;
    const send = vi.fn<typeof fetch>(async () => ++calls === 1
      ? new Response('{"error":"private provider diagnostic"}', { status })
      : new Response(JSON.stringify(finish.response), { headers: { 'content-type': 'application/json' } }));
    const client = createOpenAiClient(config, send);
    const callback = vi.fn();
    await expect(client.generateJson(schema, 'doc', { label: 'extractOutline', onReasoningSummary: callback })).resolves.toEqual({ ok: true });
    await client.generateJson(schema, 'doc', { label: 'extractOutline', onReasoningSummary: callback });
    expect(send).toHaveBeenCalledTimes(3);
    expect(JSON.parse(send.mock.calls[0][1]!.body as string).stream).toBe(true);
    expect(JSON.parse(send.mock.calls[1][1]!.body as string)).not.toHaveProperty('stream');
    expect(JSON.parse(send.mock.calls[2][1]!.body as string)).not.toHaveProperty('stream');
    expect(callback).not.toHaveBeenCalled();
  });

  it('never streams gameplay/answer generation even when a callback is passed', async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(finish.response)));
    await createOpenAiClient(config, send).generateJson(schema, 'question', { label: 'studentAnswer', onReasoningSummary() {} });
    const body = JSON.parse(send.mock.calls[0][1]!.body as string);
    expect(body.stream).toBeUndefined(); expect(body.reasoning).toEqual({ effort: 'none' });
  });
});
