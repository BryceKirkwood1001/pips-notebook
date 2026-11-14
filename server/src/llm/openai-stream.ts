import { AppError } from '../errors';

/** Consume SSE internally. Only opt-in public summary events reach the progress callback. */
export async function readOpenAiStream(response: Response, onSummary: (text: string) => void | Promise<void>, onActivity: () => void): Promise<any> {
  if (!response.body) throw new AppError('llm_error', 'OpenAI returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', summary = '', summaryId = '';
  let completed: any;
  async function event(block: string) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let item: any;
    try { item = JSON.parse(data); } catch { throw new AppError('llm_error', 'OpenAI returned an invalid stream event.'); }
    if (typeof item.type !== 'string') return;
    onActivity();
    if (item.type === 'error' || item.type === 'response.failed') throw new AppError('llm_error', 'OpenAI could not complete the streamed request. Please retry.');
    if (item.type === 'response.reasoning_summary_text.delta' && typeof item.delta === 'string') {
      const id = `${item.item_id ?? ''}:${item.summary_index ?? 0}`;
      if (id !== summaryId) { summary = ''; summaryId = id; }
      summary = (summary + item.delta).slice(-1200);
      await onSummary(summary);
    }
    if (item.type === 'response.reasoning_summary_text.done' && typeof item.text === 'string') {
      summary = item.text.slice(-1200); await onSummary(summary);
    }
    // Partial JSON, raw reasoning and encrypted reasoning content are never forwarded.
    if (item.type === 'response.completed' || item.type === 'response.incomplete') {
      completed = item.response;
      if (!summary && Array.isArray(completed?.output)) {
        const text = completed.output.filter((part: any) => part.type === 'reasoning').flatMap((part: any) => part.summary ?? [])
          .filter((part: any) => part.type === 'summary_text' && typeof part.text === 'string').map((part: any) => part.text).join('\n');
        if (text) await onSummary(text.slice(-1200));
      }
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_000_000) throw new AppError('llm_error', 'OpenAI stream event exceeded its size limit.');
      let split: RegExpExecArray | null;
      while ((split = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, split.index); buffer = buffer.slice(split.index + split[0].length);
        await event(block);
        if (completed) return completed;
      }
      if (done) { if (buffer.trim()) await event(buffer); break; }
    }
    if (!completed) throw new AppError('llm_error', 'OpenAI stream ended before the response completed. Please retry.');
    return completed;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
