/**
 * The in-page app: the router plus a `fetch` with the browser's signature, so the API client can use it as its
 * transport. Nothing it answers goes over a network.
 *
 *   const container = await createContainer({ ... });
 *   const app = buildApp(container);
 *   const api = createApiClient({ fetch: app.fetch });
 *
 * Tests call `app.inject(...)`, shaped like Fastify's, so the HTTP-level suites read as before.
 */
import { BACKEND_ORIGIN } from '@pips-notebook/shared/api-client';
import type { Container } from './container';
import { createRouter } from './router';

export interface InjectOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  /** An object or array is sent as JSON; a string or bytes as they are. */
  payload?: unknown;
}

export interface InjectReply {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  json(): any;
}

export interface App {
  /** The browser's `fetch` signature, answered in the page. */
  fetch: typeof fetch;
  /** Answers one standard Request. */
  handle(request: Request): Promise<Response>;
  inject(options: InjectOptions | string): Promise<InjectReply>;
  close(): Promise<void>;
}

export function buildApp(container: Container): App {
  const handle = createRouter(container);
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof fetch;
  return {
    fetch: fetchFn,
    handle,
    async inject(options) {
      const o = typeof options === 'string' ? { url: options } : options;
      const headers = new Headers(o.headers);
      let body: BodyInit | undefined;
      if (o.payload !== undefined) {
        if (typeof o.payload === 'string' || o.payload instanceof Uint8Array || o.payload instanceof ArrayBuffer) {
          body = o.payload as BodyInit;
        } else {
          body = JSON.stringify(o.payload);
          if (!headers.has('content-type')) headers.set('content-type', 'application/json');
        }
      }
      const res = await handle(new Request(new URL(o.url, BACKEND_ORIGIN), { method: o.method ?? 'GET', headers, body }));
      const text = await res.text();
      return {
        statusCode: res.status,
        headers: Object.fromEntries(res.headers),
        body: text,
        json: () => JSON.parse(text),
      };
    },
    close: () => container.close(),
  };
}
