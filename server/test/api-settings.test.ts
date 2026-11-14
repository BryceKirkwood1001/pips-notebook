import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app';
import { loadConfig, testConfig, type Config } from '../src/config';
import { createContainer } from '../src/container';
import { createFakeLlmClient } from '../src/llm/fake-client';
import type { LlmClient } from '../src/llm/types';
import { createApiSettingsManager } from '../src/settings';

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

  it('atomically persists private settings and restores them after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'top-settings-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'private', 'api-settings.json');
    const manager = await createApiSettingsManager(testConfig(), { file });
    await manager.save({ provider: 'openai', openai: { apiKey: secret }, timeoutMs: 45000, ingestTimeoutMs: 240000 });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, 'private'))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(file, 'utf8')).openai.apiKey).toBe(secret);
    const restored = await createApiSettingsManager(testConfig(), { file });
    expect(restored.read()).toMatchObject({ provider: 'openai', timeoutMs: 45000, ingestTimeoutMs: 240000, persistence: 'local' });
    expect(restored.config().openaiApiKey).toBe(secret);
    const legacy = JSON.parse(await readFile(file, 'utf8')); delete legacy.ingestTimeoutMs;
    await writeFile(file, JSON.stringify(legacy));
    const migrated = await createApiSettingsManager(testConfig(), { file });
    expect(migrated.read().ingestTimeoutMs).toBe(180000);
    expect(migrated.read().timeoutMs).toBe(45000);
  });

  it('preserves active settings on a persistence failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'top-settings-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'api-settings.json');
    const manager = await createApiSettingsManager(testConfig(), { file });
    await rm(directory, { recursive: true });
    // A regular file cannot serve as the settings directory.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(directory, 'blocked');
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

describe('local settings HTTP API', () => {
  async function start() {
    const used: Config[] = [];
    const llmFactory = (config: Config): LlmClient => {
      used.push(config);
      return { ...createFakeLlmClient({ embeddingDims: config.embeddingDims }), generateJson: async (schema, _prompt, options) => schema.parse(options?.label === 'studentReview'
        ? { feedback: 'Could you explain one idea from this topic?', notesToAdd: [], statedMisconceptionIds: [], questions: [], resolvedMisconceptionIds: [] }
        : { ready: true }) };
    };
    const container = await createContainer({ env: { LLM_PROVIDER: 'mock' }, llmFactory, seed: 42 });
    const app = await buildApp(container);
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

  it.each([
    { remoteAddress: '192.0.2.1' },
    { headers: { host: 'attacker.example' } },
    { headers: { origin: 'https://attacker.example' } },
  ])('rejects nonlocal or untrusted access: %j', async options => {
    const { app } = await start();
    for (const [method, url] of [['GET', '/api/settings/api'], ['POST', '/api/settings/api'], ['POST', '/api/settings/api/test']] as const) {
      const response = await app.inject({ method, url, ...options, ...(method === 'POST' ? { payload: { provider: 'mock' } } : {}) });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('settings_forbidden');
    }
  });

  it('accepts the local frontend, validates requests, and tests without saving', async () => {
    const { app, container, used } = await start();
    const headers = { origin: 'http://localhost:5174' };
    expect((await app.inject({ url: '/api/settings/api', headers })).statusCode).toBe(200);
    for (const payload of [{ provider: 'bad' }, { provider: 'openai' }, { provider: 'mock', timeoutMs: 1 }, { provider: 'mock', ingestTimeoutMs: 600001 }, { provider: 'mock', unknown: secret }]) {
      const bad = await app.inject({ method: 'POST', url: '/api/settings/api', payload });
      expect(bad.statusCode).toBe(400);
      expect(bad.body).not.toContain(secret);
    }
    const response = await app.inject({ method: 'POST', url: '/api/settings/api/test', headers, payload: { provider: 'openai', openai: { apiKey: secret } } });
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(used.at(-1)!.llmProvider).toBe('openai');
    expect(container.settings.read().provider).toBe('mock');
    expect(JSON.stringify(container.settings.read())).not.toContain(secret);
    expect(z.object({ ok: z.boolean() }).parse(response.json()).ok).toBe(true);
  });
});
