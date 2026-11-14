/**
 * The Fastify app: CORS, multipart uploads, routes, and one error shape for everything.
 *
 *   const container = await createContainer();
 *   const app = await buildApp(container);
 *   await app.listen({ port: container.config.port });
 *
 * Tests use `app.inject(...)` instead of listening.
 */
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Container } from './container';
import { AppError, ERROR_STATUS, isAppError, type ErrorCode } from './errors';
import { registerRoutes } from './routes';

/** Maps an HTTP status that Fastify or a plugin produced onto one of our error codes. */
const codeForStatus = (status: number): ErrorCode => {
  const hit = (Object.keys(ERROR_STATUS) as ErrorCode[]).find((code) => ERROR_STATUS[code] === status);
  if (hit) return hit;
  return status >= 400 && status < 500 ? 'validation_error' : 'internal_error';
};

export async function buildApp(container: Container): Promise<FastifyInstance> {
  const { config } = container;
  const maxBytes = Math.floor(config.maxUploadMb * 1024 * 1024);

  const app = Fastify({
    logger: false,
    // JSON `{ text }` uploads share the upload cap.
    bodyLimit: maxBytes,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  await app.register(multipart, {
    limits: { fileSize: maxBytes, files: 20, fields: 10 },
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: `No route ${req.method} ${req.url}` } });
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (isAppError(err)) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    // Errors from Fastify itself or a plugin (bad JSON, body too large, upload limits).
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      const status = e.code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : e.statusCode;
      return reply.code(status).send({
        error: { code: codeForStatus(status), message: e.message ?? 'Bad request' },
      });
    }
    console.error('[server] unhandled error:', err);
    return reply.code(500).send({
      error: {
        code: 'internal_error',
        message: config.debug && e.message ? e.message : 'Something went wrong on the server',
      },
    });
  });

  registerRoutes(app, container.services, container.settings, config);

  app.addHook('onClose', async () => {
    await container.close();
  });

  return app;
}

export { AppError };
