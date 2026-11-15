/**
 * The API routes (SPEC 6), answered inside the page. Thin on purpose: validate with Zod, call one service
 * method, return JSON. All paths are under /api. Errors become `{ error: { code, message } }` with the status
 * from errors.ts, as an HTTP server would send them, so the API client and the game cannot tell the difference.
 *
 * It speaks the standard `Request`/`Response` of the Fetch API, which browsers and Node both have.
 */
import { z } from 'zod';
import {
  AnswerQuestionBodySchema,
  CreateCourseTextBodySchema,
  CreateRunBodySchema,
  HelpBodySchema,
  TeachBodySchema,
  UpdateApiSettingsBodySchema,
} from '@pips-notebook/shared';
import type { Container } from './container';
import { AppError, isAppError } from './errors';
import type { UploadInput } from './services/types';

const IdSchema = z.string().min(1).max(200);
/** A backup holds every dungeon with its embeddings, so it may be much larger than one upload. */
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
/** Files in one upload, as the server edition allowed. */
const MAX_FILES = 20;

/** Parses with a Zod schema or throws a 400 `validation_error` naming the bad fields. */
export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const detail = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || what}: ${i.message}`)
    .join('; ');
  throw new AppError('validation_error', `Invalid ${what}: ${detail}`);
}

interface Context {
  request: Request;
  params: Record<string, string>;
  /** Path parameter, validated. */
  param(name: string): string;
  /** The JSON body; an empty body is undefined. */
  json(limit?: number): Promise<unknown>;
}
type Handler = (ctx: Context) => Promise<unknown> | unknown;
interface Route { method: string; pattern: RegExp; keys: string[]; status: number; handler: Handler }

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const failure = (status: number, code: string, message: string) => json(status, { error: { code, message } });

/** Reads a multipart upload: every `files` part becomes bytes; a `title` field is optional. */
async function readMultipart(request: Request, maxBytes: number): Promise<{ title?: string; files: UploadInput[] }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError('validation_error', 'Could not read the upload');
  }
  const files: UploadInput[] = [];
  let title: string | undefined;
  for (const [field, value] of form.entries()) {
    if (typeof value !== 'string') {
      if (field !== 'files') continue;
      if (value.size > maxBytes) throw new AppError('payload_too_large', `File "${value.name}" is too large`);
      if (files.length >= MAX_FILES) throw new AppError('payload_too_large', `Upload at most ${MAX_FILES} files at once`);
      if (value.size > 0) files.push({ name: value.name || 'upload', data: new Uint8Array(await value.arrayBuffer()) });
    } else if (field === 'title') {
      title = value.slice(0, 200);
    }
  }
  if (files.length === 0) throw new AppError('validation_error', 'Upload at least one file in the "files" field');
  return { title, files };
}

export function createRouter(container: Container): (request: Request) => Promise<Response> {
  const { config } = container;
  const maxBytes = Math.floor(config.maxUploadMb * 1024 * 1024);
  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler, status = 200) => {
    const keys: string[] = [];
    const pattern = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_m, key: string) => { keys.push(key); return '([^/]+)'; }) + '$');
    routes.push({ method, pattern, keys, status, handler });
  };
  // Every call reads the services object at call time, so test spies on it take effect.
  const services = () => container.services;

  add('GET', '/api/health', () => services().health());

  add('GET', '/api/settings/api', () => container.settings.read());
  add('POST', '/api/settings/api', async (c) => container.settings.save(parse(UpdateApiSettingsBodySchema, await c.json(32768), 'API settings')));
  add('POST', '/api/settings/api/test', async (c) => container.settings.test(parse(UpdateApiSettingsBodySchema, await c.json(32768), 'API settings')));
  add('GET', '/api/settings/storage', () => container.storage.read());
  add('GET', '/api/backup', () => container.storage.exportBackup());
  add('POST', '/api/backup', async (c) => container.storage.importBackup(await c.json(MAX_BACKUP_BYTES)));

  // ── Courses ───────────────────────────────────────────────────────────────

  add('GET', '/api/samples', () => services().listSamples());
  add('GET', '/api/archive', () => services().listArchive());
  add('POST', '/api/courses/seed/:sample', (c) => services().seedCourse(c.param('sample')));

  add('POST', '/api/courses', async (c) => {
    let input: { title?: string; files: UploadInput[] };
    if ((c.request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
      input = await readMultipart(c.request, maxBytes);
    } else {
      const body = parse(CreateCourseTextBodySchema, await c.json(), 'body');
      const title = body.title?.trim() || undefined;
      input = { title, files: [{ name: `${title ?? 'material'}.md`, data: new TextEncoder().encode(body.text) }] };
    }
    return services().createCourse(input);
  }, 202);

  add('GET', '/api/courses/:id', (c) => services().getCourse(c.param('id')));
  add('DELETE', '/api/courses/:id', (c) => services().deleteCourse(c.param('id')));

  // ── Runs ──────────────────────────────────────────────────────────────────

  add('POST', '/api/runs', async (c) => services().createRun(parse(CreateRunBodySchema, await c.json(), 'body')), 201);
  add('GET', '/api/runs/:id', (c) => services().getRun(c.param('id')));
  add('POST', '/api/runs/:id/pause', (c) => services().pauseRun(c.param('id')));
  add('POST', '/api/runs/:id/resume', (c) => services().resumeRun(c.param('id')));
  add('POST', '/api/runs/:id/end', (c) => services().endRun(c.param('id')));
  add('DELETE', '/api/runs/:id', (c) => services().deleteRun(c.param('id')));
  add('POST', '/api/runs/:id/teach', async (c) => {
    const body = parse(TeachBodySchema, await c.json(), 'body');
    return services().teach(c.param('id'), body.explanation, body.conceptId);
  });
  add('POST', '/api/runs/:id/questions/:qid/answer', async (c) => {
    const body = parse(AnswerQuestionBodySchema, await c.json(), 'body');
    return services().answerQuestion(c.param('id'), c.param('qid'), body.answer);
  });
  add('POST', '/api/runs/:id/questions/:qid/skip', (c) => services().skipQuestion(c.param('id'), c.param('qid')));
  add('POST', '/api/runs/:id/ready', (c) => services().ready(c.param('id')));
  add('POST', '/api/runs/:id/turn', (c) => services().turn(c.param('id')));
  add('POST', '/api/runs/:id/help/:eventId', async (c) => {
    const body = parse(HelpBodySchema, await c.json(), 'body');
    return services().help(c.param('id'), c.param('eventId'), body.answer);
  });
  add('POST', '/api/runs/:id/retry', (c) => services().retry(c.param('id')));
  add('POST', '/api/runs/:id/continue', (c) => services().continueRun(c.param('id')));
  add('GET', '/api/runs/:id/results', (c) => services().getResults(c.param('id')));
  add('GET', '/api/runs/:id/debug', (c) => services().getDebug(c.param('id')));

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let path: string;
    try { path = decodeURI(url.pathname); } catch { path = url.pathname; }
    const route = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
    if (!route) return failure(404, 'not_found', `No route ${method} ${path}`);
    const values = route.pattern.exec(url.pathname)!.slice(1);
    const params: Record<string, string> = {};
    route.keys.forEach((key, i) => {
      try { params[key] = decodeURIComponent(values[i]); } catch { params[key] = values[i]; }
    });
    const ctx: Context = {
      request,
      params,
      param: (name) => parse(IdSchema, params[name], `path parameter "${name}"`),
      async json(limit = maxBytes) {
        const text = await request.text();
        if (text.length > limit) throw new AppError('payload_too_large', `Request body is larger than ${Math.round(limit / 1024 / 1024)} MB`);
        if (text.trim() === '') return undefined;
        try {
          return JSON.parse(text);
        } catch {
          throw new AppError('validation_error', 'Body is not valid JSON');
        }
      },
    };
    try {
      const result = await route.handler(ctx);
      return json(route.status, result);
    } catch (err) {
      if (isAppError(err)) return failure(err.status, err.code, err.message);
      console.error('[backend] unhandled error:', err);
      const message = err instanceof Error && err.message ? err.message : String(err);
      return failure(500, 'internal_error', config.debug && message ? message : 'Something went wrong in the game');
    }
  };
}
