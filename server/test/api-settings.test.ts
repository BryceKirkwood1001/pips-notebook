import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app';
import { browserSettingsStore } from '../src/browser/main';
import { loadConfig, testConfig, type Config } from '../src/config';
import { createContainer } from '../src/container';
import { createFakeLlmClient } from '../src/llm/fake-client';
import type { LlmClient } from '../src/llm/types';
import { createDirectorySampleSource } from '../src/node/samples';
import { createApiSettingsManager, memorySettingsStore } from '../src/settings';

/** A Web Storage area (localStorage / sessionStorage) backed by a Map. */
function storageArea(): Storage & { dump(): Record<string, string> } {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => { items.set(k, String(v)); },
    removeItem: (k: string) => { items.delete(k); },
    clear: () => items.clear(),
    dump: () => Object.fromEntries(items),
  };
}

const secret = 'test-credential-never-return';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe('API settings', () => {
  it('selects OpenAI from the environment without reusing the Gemini embedding model', () => {
    const config = loadConfig({ OPENAI_API_KEY: secret, EMBEDDING_MODEL: 'gemini-embedding-001' });
    expect(config.llmProvider).toBe('openai');
    expect(config.embeddingModel).toBe('text-embedding-3-small');
    expect(() => loadConfig({ LLM_PROVIDER: 'openai' })).toThrow('needs OPENAI_API_KEY');
    expect(loadConfig({ OPENAI_API_KEY: secret, LLM_PROVIDER: 'mock' }).llmProvider).toBe('mock');
  });

  it('keeps keys write-only, retains omitted keys, and removes explicitly cleared keys', async () => {
    const manager = await createApiSettingsManager(testConfig());
    const saved = await manager.save({ provider: 'openai', openai: { apiKey: secret, model: 'my-model' } });
    expect(saved.providers.openai).toMatchObject({ hasApiKey: true, model: 'my-model' });
    expect(JSON.stringify(saved)).not.toContain(secret);
    await manager.save({ provider: 'openai', openai: { model: 'next-model' } });
    expect(manager.config().openaiApiKey).toBe(secret);
    await expect(manager.save({ provider: 'openai', openai: { apiKey: null } })).rejects.toThrow(/API key/);
    expect(manager.config().openaiApiKey).toBe(secret);
    await manager.save({ provider: 'mock', openai: { apiKey: null } });
    expect(manager.read().providers.openai.hasApiKey).toBe(false);
  });

  it('keeps settings in this browser and restores them after a reload', async () => {
    const local = storageArea(), session = storageArea();
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session);
    cleanups.push(async () => vi.unstubAllGlobals());
    const manager = await createApiSettingsManager(testConfig(), { store: browserSettingsStore });
    expect(manager.read().persistence).toBe('local');
    await manager.save({ provider: 'openai', openai: { apiKey: secret }, timeoutMs: 45000, ingestTimeoutMs: 240000 });
    expect(Object.keys(local.dump())).toEqual(['pips-notebook.ai-settings']);
    expect(JSON.parse(local.getItem('pips-notebook.ai-settings')!).openai.apiKey).toBe(secret);
    expect(session.dump()).toEqual({});
    const restored = await createApiSettingsManager(testConfig(), { store: browserSettingsStore });
    expect(restored.read()).toMatchObject({ provider: 'openai', timeoutMs: 45000, ingestTimeoutMs: 240000, persistence: 'local' });
    expect(restored.config().openaiApiKey).toBe(secret);
    const legacy = JSON.parse(local.getItem('pips-notebook.ai-settings')!); delete legacy.ingestTimeoutMs;
    local.setItem('pips-notebook.ai-settings', JSON.stringify(legacy));
    const migrated = await createApiSettingsManager(testConfig(), { store: browserSettingsStore });
    expect(migrated.read().ingestTimeoutMs).toBe(180000);
    expect(migrated.read().timeoutMs).toBe(45000);
  });

  it('"only this tab" moves the key to sessionStorage, and back again', async () => {
    const local = storageArea(), session = storageArea();
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session);
    cleanups.push(async () => vi.unstubAllGlobals());
    const manager = await createApiSettingsManager(testConfig(), { store: browserSettingsStore });
    await manager.save({ provider: 'gemini', gemini: { apiKey: secret } });
    const tabOnly = await manager.save({ provider: 'gemini', rememberKey: false });
    expect(tabOnly.persistence).toBe('session');
    expect(local.dump()).toEqual({});
    expect(JSON.parse(session.getItem('pips-notebook.ai-settings')!).gemini.apiKey).toBe(secret);
    expect((await createApiSettingsManager(testConfig(), { store: browserSettingsStore })).read()).toMatchObject({ provider: 'gemini', persistence: 'session' });
    session.clear(); // the tab closed
    expect((await createApiSettingsManager(testConfig(), { store: browserSettingsStore })).read()).toMatchObject({ provider: 'mock', persistence: 'local' });
    await manager.save({ provider: 'gemini', rememberKey: true });
    expect(session.dump()).toEqual({});
    expect(JSON.parse(local.getItem('pips-notebook.ai-settings')!).gemini.apiKey).toBe(secret);
  });

  it('ignores unreadable saved settings instead of failing to start', async () => {
    for (const text of ['not json', JSON.stringify({ version: 1, provider: 'openai' }), JSON.stringify({ version: 1, provider: 'openai', timeoutMs: 30000,
      openai: { model: 'm', embeddingModel: 'e', apiKey: '' }, gemini: { model: 'm', embeddingModel: 'e', apiKey: '' } })]) {
      const manager = await createApiSettingsManager(testConfig(), { store: memorySettingsStore({ text, place: 'local' }) });
      expect(manager.read().provider).toBe('mock');
    }
  });

  it('preserves active settings on a persistence failure', async () => {
    const store = { load: async () => null, save: async () => { throw new Error('QuotaExceededError'); } };
    const manager = await createApiSettingsManager(testConfig(), { store });
    await expect(manager.save({ provider: 'openai', openai: { apiKey: secret } })).rejects.toThrow(/previous settings/);
    expect(manager.read().provider).toBe('mock');
    expect(manager.read().providers.openai.hasApiKey).toBe(false);
  });

  it('tests unsaved generation and embedding credentials without applying them', async () => {
    const calls: string[] = [];
    let tested: Config | undefined;
    const manager = await createApiSettingsManager(testConfig(), { llmFactory: config => {
      tested = config;
      return {
        ...createFakeLlmClient(),
        generateJson: async schema => { calls.push('generate'); return schema.parse({ ready: true }); },
        embed: async () => { calls.push('embed'); return [[1]]; },
      };
    } });
    expect(await manager.test({ provider: 'openai', openai: { apiKey: secret } })).toMatchObject({ ok: true, provider: 'openai' });
    expect(tested!.openaiApiKey).toBe(secret);
    expect(calls).toEqual(['generate', 'embed']);
    expect(manager.read().provider).toBe('mock');
    expect(manager.read().providers.openai.hasApiKey).toBe(false);
  });

  it('retains a course embedding space across generation-provider changes', async () => {
    const manager = await createApiSettingsManager(testConfig({ geminiApiKey: 'old-key' }));
    await manager.save({ provider: 'openai', openai: { apiKey: secret } });
    const config = manager.embeddingConfig({ provider: 'gemini', model: 'original-embedding', dims: 768 });
    expect(config).toMatchObject({ llmProvider: 'gemini', embeddingModel: 'original-embedding', geminiApiKey: 'old-key' });
    await manager.save({ provider: 'openai', gemini: { apiKey: null } });
    expect(() => manager.embeddingConfig({ provider: 'gemini', model: 'original-embedding', dims: 768 })).toThrow(/Restore/);
  });
});

describe('settings API (in the page)', () => {
  async function start() {
    const used: Config[] = [];
    const llmFactory = (config: Config): LlmClient => {
      used.push(config);
      return { ...createFakeLlmClient({ embeddingDims: config.embeddingDims }), generateJson: async (schema, _prompt, options) => schema.parse(options?.label === 'studentReview'
        ? { feedback: 'Could you explain one idea from this topic?', notesToAdd: [], statedMisconceptionIds: [], questions: [], resolvedMisconceptionIds: [] }
        : { ready: true }) };
    };
    const container = await createContainer({ env: { LLM_PROVIDER: 'mock' }, llmFactory, seed: 42, samples: createDirectorySampleSource() });
    const app = buildApp(container);
    cleanups.push(() => app.close());
    return { app, container, used };
  }

  it('uses the separate preparation budget without changing the interactive budget', async () => {
    const { app, container, used } = await start();
    await container.settings.save({ provider: 'openai', openai: { apiKey: secret }, timeoutMs: 15000, ingestTimeoutMs: 240000 });
    used.length = 0;
    const seeded = await app.inject({ method: 'POST', url: '/api/courses/seed/seasons' });
    expect(seeded.statusCode).toBe(200);
    expect(used.at(-1)!.llmTimeoutMs).toBe(240000);
    const run = await app.inject({ method: 'POST', url: '/api/runs', payload: { courseId: seeded.json().courseId, targetGrade: 'B' } });
    expect(run.statusCode).toBe(201);
    expect(used.at(-1)!.llmTimeoutMs).toBe(15000);
    expect(container.config.llmTimeoutMs).toBe(15000);
  });

  it('redacts settings and applies changes without discarding courses or runs', async () => {
    const { app, container, used } = await start();
    const seeded = await app.inject({ method: 'POST', url: '/api/courses/seed/seasons' });
    const created = await app.inject({ method: 'POST', url: '/api/runs', payload: { courseId: seeded.json().courseId, targetGrade: 'B' } });
    expect(created.statusCode).toBe(201);
    const response = await app.inject({ method: 'POST', url: '/api/settings/api', payload: { provider: 'openai', openai: { apiKey: secret } } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain(secret);
    expect((await app.inject('/api/health')).json().llmProvider).toBe('openai');
    expect((await app.inject(`/api/runs/${created.json().id}`)).json().phase).toBe('learning');
    const liveTeach = await app.inject({ method: 'POST', url: `/api/runs/${created.json().id}/teach`, payload: { explanation: 'Earth has seasons because its axis is tilted.' } });
    expect(liveTeach.statusCode).toBe(200);
    expect(used.at(-1)!.llmProvider).toBe('openai');
    await container.settings.save({ provider: 'mock' });
    const taught = await app.inject({ method: 'POST', url: `/api/runs/${created.json().id}/teach`, payload: { explanation: 'Earth has seasons because its axis is tilted.' } });
    expect(taught.statusCode).toBe(200);
  });

  it('validates requests, and tests without saving', async () => {
    const { app, container, used } = await start();
    const settings = await app.inject({ url: '/api/settings/api' });
    expect(settings.statusCode).toBe(200);
    expect(settings.headers['cache-control']).toBe('no-store');
    for (const payload of [{ provider: 'bad' }, { provider: 'openai' }, { provider: 'mock', timeoutMs: 1 }, { provider: 'mock', ingestTimeoutMs: 600001 }, { provider: 'mock', unknown: secret }]) {
      const bad = await app.inject({ method: 'POST', url: '/api/settings/api', payload });
      expect(bad.statusCode).toBe(400);
      expect(bad.body).not.toContain(secret);
    }
    const response = await app.inject({ method: 'POST', url: '/api/settings/api/test', payload: { provider: 'openai', openai: { apiKey: secret } } });
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(used.at(-1)!.llmProvider).toBe('openai');
    expect(container.settings.read().provider).toBe('mock');
    expect(JSON.stringify(container.settings.read())).not.toContain(secret);
    expect(z.object({ ok: z.boolean() }).parse(response.json()).ok).toBe(true);
  });
});
