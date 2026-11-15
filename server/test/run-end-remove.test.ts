/** Ending an expedition early (kept as a read-only record) and removing one permanently. */
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, describe, expect, it, test } from 'vitest';
import { openBrowserStorage } from '../src/browser/main';
import type { Container } from '../src/container';
import { createTestContainer, startTestApp, type TestApp } from './helpers/app';
import { Bot } from './helpers/bot';
import { findHiddenKeys } from './helpers/leaks';

let t: TestApp;
beforeAll(async () => { t = await startTestApp({ HELP_ME_PROB: '0' }); });
afterAll(() => t.close());

describe('ending an expedition', () => {
  it('keeps a read-only record: play is refused, pause is a no-op, the archive shows it ended', async () => {
    const bot = new Bot(t);
    const run = await bot.start();
    await bot.learn();
    const ended = await t.post(`/api/runs/${bot.runId}/end`);
    expect(ended.status).toBe(200);
    expect(ended.body.endedAt).toEqual(expect.any(String));
    expect(ended.body.pausedAt).toBeUndefined();
    expect(findHiddenKeys(ended.body)).toEqual([]);

    for (const [path, body] of [['/teach', { explanation: 'More words about it.' }], ['/ready', undefined], ['/turn', undefined], ['/resume', undefined]] as const) {
      const r = await t.post(`/api/runs/${bot.runId}${path}`, body);
      expect(r.status, path).toBe(409);
      expect(r.body).toMatchObject({ error: { code: 'run_ended' } });
    }
    const paused = await t.post(`/api/runs/${bot.runId}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body.pausedAt).toBeUndefined();

    const again = await t.post(`/api/runs/${bot.runId}/end`);
    expect(again.body.endedAt).toBe(ended.body.endedAt); // idempotent

    const archive = await t.get('/api/archive');
    expect(archive.body.runs.find((r: { id: string }) => r.id === bot.runId)).toMatchObject({ endedAt: ended.body.endedAt, rooms: run.rooms.length });
  });

  it('an unanswered "Help me!" closes with the expedition', async () => {
    const helpful = await startTestApp({ HELP_ME_PROB: '1' });
    try {
      const bot = new Bot(helpful);
      await bot.start();
      await bot.learn();
      expect((await helpful.post(`/api/runs/${bot.runId}/turn`)).body.kind).toBe('help_me');
      const ended = await helpful.post(`/api/runs/${bot.runId}/end`);
      expect(ended.body.pendingHelpMe).toBeUndefined();
      expect((await helpful.get(`/api/runs/${bot.runId}`)).body.pendingHelpMe).toBeUndefined();
    } finally { await helpful.close(); }
  });

  it('a finished expedition cannot be ended; an unknown one is 404', async () => {
    const bot = new Bot(t);
    await bot.start();
    await bot.finish();
    const r = await t.post(`/api/runs/${bot.runId}/end`);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: { code: 'wrong_phase' } });
    expect((await t.post('/api/runs/nope/end')).status).toBe(404);
  });
});

describe('removing an expedition', () => {
  it('deletes the run only: the course stays and the archive forgets the run', async () => {
    const bot = new Bot(t);
    const run = await bot.start();
    const removed = await t.send('DELETE', `/api/runs/${bot.runId}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true, id: bot.runId });
    expect((await t.get(`/api/runs/${bot.runId}`)).status).toBe(404);
    expect((await t.send('DELETE', `/api/runs/${bot.runId}`)).status).toBe(404);
    expect((await t.get(`/api/courses/${run.courseId}`)).status).toBe(200);
    const archive = await t.get('/api/archive');
    expect(archive.body.runs.map((r: { id: string }) => r.id)).not.toContain(bot.runId);
  });
});

const containers: Container[] = [];
afterEach(async () => { for (const c of containers.splice(0)) await c.close(); });

test('ended and removed expeditions stay that way across a page reload', async () => {
  const factory = new IDBFactory();
  const env = { LLM_PROVIDER: 'mock', HELP_ME_PROB: '0' };
  const first = await createTestContainer({ env, storage: await openBrowserStorage({ factory }), seed: 21 });
  const { courseId } = await first.services.seedCourse('seasons');
  const kept = await first.services.createRun({ courseId, targetGrade: 'B' });
  const gone = await first.services.createRun({ courseId, targetGrade: 'B' });
  const ended = await first.services.endRun(kept.id);
  expect(await first.services.deleteRun(gone.id)).toEqual({ deleted: true, id: gone.id });
  await first.close();

  const second = await createTestContainer({ env, storage: await openBrowserStorage({ factory }), seed: 21 }); containers.push(second);
  expect((await second.services.getRun(kept.id)).endedAt).toBe(ended.endedAt);
  await expect(second.services.getRun(gone.id)).rejects.toMatchObject({ code: 'not_found' });
  await expect(second.services.teach(kept.id, 'Still words.')).rejects.toMatchObject({ code: 'run_ended' });
  expect((await second.services.listArchive()).runs.map(r => r.id)).toEqual([kept.id]);
});
