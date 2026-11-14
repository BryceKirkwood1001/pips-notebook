import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFakeLlmClient, fakeEmbed } from './fake-client';

const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe('fakeEmbed', () => {
  it('is deterministic, unit length and has the right size', () => {
    const a = fakeEmbed('Axial tilt causes seasons', 64);
    expect(a).toHaveLength(64);
    expect(a).toEqual(fakeEmbed('axial TILT causes seasons!', 64));
    expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6);
  });
  it('gives shared-word texts a higher similarity than unrelated ones', () => {
    const q = fakeEmbed('what causes the seasons on earth', 768);
    const near = fakeEmbed('the axial tilt of earth causes the seasons', 768);
    const far = fakeEmbed('binary search runs in logarithmic time', 768);
    expect(cos(q, near)).toBeGreaterThan(0.5);
    expect(cos(q, far)).toBeLessThan(0.2);
  });
});

describe('createFakeLlmClient', () => {
  it('runs handlers by label, validates and records calls', async () => {
    const llm = createFakeLlmClient({ handlers: { t: () => ({ n: 1 }) } });
    const out = await llm.generateJson(z.object({ n: z.number() }), 'hello', { label: 't', system: 's' });
    expect(out).toEqual({ n: 1 });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toMatchObject({ label: 't', prompt: 'hello' });
    expect(llm.provider).toBe('fake');
  });
  it('throws on an unknown label and on invalid handler output', async () => {
    const llm = createFakeLlmClient({ handlers: { bad: () => ({ n: 'x' }) } });
    await expect(llm.generateJson(z.object({ n: z.number() }), 'p', { label: 'nope' })).rejects.toThrow(/no handler/);
    await expect(llm.generateJson(z.object({ n: z.number() }), 'p', { label: 'bad' })).rejects.toThrow(/validation/);
  });
  it('embeds with the configured dims and fakes uploads', async () => {
    const llm = createFakeLlmClient({ embeddingDims: 32 });
    const v = await llm.embed(['a b', 'c'], 'RETRIEVAL_DOCUMENT');
    expect(v).toHaveLength(2);
    expect(v[0]).toHaveLength(32);
    const f = await llm.uploadFile(new Uint8Array([1]), { mimeType: 'application/pdf' });
    expect(f.mimeType).toBe('application/pdf');
  });
});
