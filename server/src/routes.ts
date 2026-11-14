/**
 * HTTP routes (SPEC 6). Thin on purpose: validate with Zod, call one service method, send JSON.
 * All paths are under /api. Errors become `{ error: { code, message } }` in app.ts.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AnswerQuestionBodySchema,
  CreateCourseTextBodySchema,
  CreateRunBodySchema,
  HelpBodySchema,
  TeachBodySchema,
} from '@top/shared';
import { AppError } from './errors';
import type { Services, UploadInput } from './services/types';

const IdSchema = z.string().min(1).max(200);

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

const param = (req: FastifyRequest, name: string): string =>
  parse(IdSchema, (req.params as Record<string, unknown>)[name], `path parameter "${name}"`);

/** Reads a multipart upload: every `files` part becomes a buffer; a `title` field is optional. */
async function readMultipart(req: FastifyRequest): Promise<{ title?: string; files: UploadInput[] }> {
  const files: UploadInput[] = [];
  let title: string | undefined;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const data = await part.toBuffer();
      if (part.file.truncated) throw new AppError('payload_too_large', `File "${part.filename}" is too large`);
      if (data.length > 0) files.push({ name: part.filename || 'upload', data: new Uint8Array(data) });
    } else if (part.fieldname === 'title' && typeof part.value === 'string') {
      title = part.value.slice(0, 200);
    }
  }
  if (files.length === 0) throw new AppError('validation_error', 'Upload at least one file in the "files" field');
  return { title, files };
}

export function registerRoutes(app: FastifyInstance, services: Services): void {
  app.get('/api/health', async () => services.health());

  // ── Courses ───────────────────────────────────────────────────────────────

  app.get('/api/samples', async () => services.listSamples());

  app.post('/api/courses/seed/:sample', async (req) => services.seedCourse(param(req, 'sample')));

  app.post('/api/courses', async (req, reply) => {
    let input: { title?: string; files: UploadInput[] };
    if (req.isMultipart()) {
      input = await readMultipart(req);
    } else {
      const body = parse(CreateCourseTextBodySchema, req.body, 'body');
      const title = body.title?.trim() || undefined;
      input = { title, files: [{ name: `${title ?? 'material'}.md`, data: new TextEncoder().encode(body.text) }] };
    }
    const result = await services.createCourse(input);
    return reply.code(202).send(result);
  });

  app.get('/api/courses/:id', async (req) => services.getCourse(param(req, 'id')));

  // ── Runs ──────────────────────────────────────────────────────────────────

  app.post('/api/runs', async (req, reply) => {
    const body = parse(CreateRunBodySchema, req.body, 'body');
    return reply.code(201).send(await services.createRun(body));
  });

  app.get('/api/runs/:id', async (req) => services.getRun(param(req, 'id')));

  app.post('/api/runs/:id/teach', async (req) => {
    const body = parse(TeachBodySchema, req.body, 'body');
    return services.teach(param(req, 'id'), body.explanation);
  });

  app.post('/api/runs/:id/questions/:qid/answer', async (req) => {
    const body = parse(AnswerQuestionBodySchema, req.body, 'body');
    return services.answerQuestion(param(req, 'id'), param(req, 'qid'), body.answer);
  });

  app.post('/api/runs/:id/questions/:qid/skip', async (req) =>
    services.skipQuestion(param(req, 'id'), param(req, 'qid')),
  );

  app.post('/api/runs/:id/ready', async (req) => services.ready(param(req, 'id')));

  app.post('/api/runs/:id/turn', async (req) => services.turn(param(req, 'id')));

  app.post('/api/runs/:id/help/:eventId', async (req) => {
    const body = parse(HelpBodySchema, req.body, 'body');
    return services.help(param(req, 'id'), param(req, 'eventId'), body.answer);
  });

  app.post('/api/runs/:id/retry', async (req) => services.retry(param(req, 'id')));

  app.post('/api/runs/:id/continue', async (req) => services.continueRun(param(req, 'id')));

  app.get('/api/runs/:id/results', async (req) => services.getResults(param(req, 'id')));

  app.get('/api/runs/:id/debug', async (req) => services.getDebug(param(req, 'id')));
}
