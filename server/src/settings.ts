/** Local development settings: secrets are server-only, write-only over HTTP, and never logged. */
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type ApiSettings, type CourseEmbedding, type TestApiSettingsResponse, type UpdateApiSettingsBody, UpdateApiSettingsBodySchema } from '@top/shared';
import type { Config } from './config';
import { AppError } from './errors';
import { createLlmClient } from './llm/provider';
import type { LlmClient } from './llm/types';

const ProfileSchema = z.object({ model: z.string(), embeddingModel: z.string(), apiKey: z.string() }).strict();
const StoredSchema = z.object({
  version: z.literal(1), provider: z.enum(['mock', 'gemini', 'openai']), timeoutMs: z.number().int().min(1000).max(180000),
  ingestTimeoutMs: z.number().int().min(1000).max(600000).optional(),
  openai: ProfileSchema, gemini: ProfileSchema,
}).strict();
type Stored = z.infer<typeof StoredSchema>;
export type LlmFactory = (config: Config) => LlmClient;

export interface ApiSettingsManager {
  read(): ApiSettings;
  config(): Config;
  embeddingConfig(profile: CourseEmbedding): Config;
  save(body: UpdateApiSettingsBody): Promise<ApiSettings>;
  test(body: UpdateApiSettingsBody): Promise<TestApiSettingsResponse>;
}

export async function createApiSettingsManager(base: Config, options: { file?: string; llmFactory?: LlmFactory } = {}): Promise<ApiSettingsManager> {
  const factory = options.llmFactory ?? createLlmClient;
  let current: Stored = {
    version: 1, provider: base.llmProvider, timeoutMs: base.llmTimeoutMs,
    ingestTimeoutMs: base.ingestLlmTimeoutMs,
    openai: { model: base.openaiModel, embeddingModel: base.openaiEmbeddingModel, apiKey: base.openaiApiKey },
    gemini: { model: base.geminiModel, embeddingModel: base.geminiEmbeddingModel, apiKey: base.geminiApiKey },
  };
  if (options.file) {
    try {
      current = StoredSchema.parse(JSON.parse(await readFile(options.file, 'utf8')));
      await chmod(options.file, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not load local API settings. Check .local/api-settings.json.');
    }
  }

  function configured(state: Stored): Config {
    return {
      ...base, llmProvider: state.provider, llmTimeoutMs: state.timeoutMs,
      ingestLlmTimeoutMs: state.ingestTimeoutMs ?? base.ingestLlmTimeoutMs,
      openaiApiKey: state.openai.apiKey, openaiModel: state.openai.model, openaiEmbeddingModel: state.openai.embeddingModel,
      geminiApiKey: state.gemini.apiKey, geminiModel: state.gemini.model, geminiEmbeddingModel: state.gemini.embeddingModel,
      embeddingModel: state.provider === 'openai' ? state.openai.embeddingModel : state.gemini.embeddingModel,
    };
  }
  function validate(state: Stored): void {
    if (state.provider !== 'mock' && !state[state.provider].apiKey) {
      throw new AppError('validation_error', `Enter ${state.provider === 'openai' ? 'an OpenAI' : 'a Gemini'} API key before selecting this provider.`);
    }
  }
  validate(current);
  Object.assign(base, configured(current));

  function read(): ApiSettings {
    const publicProfile = (p: Stored['openai']) => ({ model: p.model, embeddingModel: p.embeddingModel, hasApiKey: !!p.apiKey });
    return { provider: current.provider, providers: { openai: publicProfile(current.openai), gemini: publicProfile(current.gemini) },
      timeoutMs: current.timeoutMs, ingestTimeoutMs: current.ingestTimeoutMs ?? base.ingestLlmTimeoutMs, embeddingDims: base.embeddingDims, persistence: options.file ? 'local' : 'session' };
  }
  function candidate(input: UpdateApiSettingsBody): Stored {
    const body = UpdateApiSettingsBodySchema.safeParse(input);
    if (!body.success) throw new AppError('validation_error', 'Invalid API settings. Check provider, model names and timeout.');
    const next = structuredClone(current);
    next.provider = body.data.provider;
    if (body.data.timeoutMs !== undefined) next.timeoutMs = body.data.timeoutMs;
    if (body.data.ingestTimeoutMs !== undefined) next.ingestTimeoutMs = body.data.ingestTimeoutMs;
    for (const provider of ['openai', 'gemini'] as const) {
      const patch = body.data[provider];
      if (!patch) continue;
      if (patch.model !== undefined) next[provider].model = patch.model;
      if (patch.embeddingModel !== undefined) next[provider].embeddingModel = patch.embeddingModel;
      if (patch.apiKey !== undefined) next[provider].apiKey = patch.apiKey ?? '';
    }
    validate(next);
    return next;
  }
  let saves: Promise<unknown> = Promise.resolve();
  return {
    read,
    config: () => configured(current),
    embeddingConfig(profile) {
      const config = configured(current);
      if (profile.provider !== 'mock' && !current[profile.provider].apiKey) {
        throw new AppError('llm_error', `This course uses ${profile.provider} embeddings. Restore that provider's API key in Settings.`);
      }
      return { ...config, llmProvider: profile.provider, embeddingModel: profile.model, embeddingDims: profile.dims };
    },
    save(body) {
      const save = saves.catch(() => undefined).then(async () => {
        const next = candidate(body);
        if (options.file) {
          const temporary = `${options.file}.${randomUUID()}.tmp`;
          try {
            await mkdir(dirname(options.file), { recursive: true, mode: 0o700 });
            await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
            await rename(temporary, options.file);
          } catch {
            await unlink(temporary).catch(() => undefined);
            throw new AppError('internal_error', 'Could not save local API settings. The previous settings are still active.');
          }
        }
        current = next;
        Object.assign(base, configured(current));
        return read();
      });
      saves = save;
      return save;
    },
    async test(body) {
      const next = candidate(body);
      if (next.provider === 'mock') return { ok: true, provider: 'mock', message: 'Offline mode is ready. No API key is needed.' };
      const llm = factory(configured(next));
      const reply = await llm.generateJson(z.object({ ready: z.boolean() }), 'Return JSON with ready set to true.', { label: 'settingsTest', maxOutputTokens: 1024 });
      if (!reply.ready) throw new AppError('llm_error', 'The model did not complete the connection check.');
      await llm.embed(['Connection test'], 'RETRIEVAL_QUERY');
      return { ok: true, provider: next.provider, message: 'Connection verified: generation and embeddings both responded.' };
    },
  };
}
