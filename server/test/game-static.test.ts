/** The server serves the committed game build next to the API, on one port (`npm start`). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

const get = (url: string, headers: Record<string, string> = {}) => t.app.inject({ method: 'GET', url, headers });

describe('game served with the API', () => {
  it('serves the game page at /', async () => {
    const res = await get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="game">');
  });

  it('serves the bundle and the text shaper with browser-usable types', async () => {
    const js = await get('/game.js');
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('javascript');
    const wasm = await get('/text-shaper.wasm');
    expect(wasm.statusCode).toBe(200);
    expect(wasm.headers['content-type']).toBe('application/wasm');
  });

  it('serves media from client/game/media, with ranges for audio', async () => {
    const css = await get('/media/game.css');
    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toContain('text/css');
    const music = await get('/media/music/menu.mp3', { range: 'bytes=0-99' });
    expect(music.statusCode).toBe(206);
    expect(music.rawPayload.length).toBe(100);
  });

  it('keeps the API and its JSON errors as they were', async () => {
    const health = await t.get('/api/health');
    expect(health.status).toBe(200);
    expect(typeof health.body.llmProvider).toBe('string');
    const missing = await t.get('/api/no-such-route');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
  });

  it('does not serve files outside the build', async () => {
    for (const url of ['/../package.json', '/%2e%2e/package.json', '/media/../../main.ts', '/main.ts']) {
      const res = await get(url);
      expect(res.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(res.body, url).not.toContain('"workspaces"');
    }
  });
});
