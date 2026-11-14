import type { LlmClient } from '../llm/types';

/** Hashed bag-of-words: texts that share words are similar. Unit length. */
export function hashEmbed(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[(h >>> 0) % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function fakeLlm(dims = 768, opts: { failUpload?: boolean } = {}): LlmClient & { embedCalls: string[] } {
  const embedCalls: string[] = [];
  return {
    provider: 'fake',
    embedCalls,
    async generateJson() {
      throw new Error('not used in rag tests');
    },
    async embed(texts, taskType) {
      embedCalls.push(`${taskType}:${texts.length}`);
      return texts.map((t) => hashEmbed(t, dims));
    },
    async uploadFile(_src, o) {
      if (opts.failUpload) throw new Error('upload down');
      return { uri: 'files/x', mimeType: o.mimeType, name: 'files/x' };
    },
  };
}
