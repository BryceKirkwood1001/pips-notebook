import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app';
import { Bot } from './helpers/bot';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp({ HELP_ME_PROB: '0' });
});
afterAll(() => t.close());

const wrongPhase = (r: { status: number; body: any }) => {
  expect(r.status).toBe(409);
  expect(r.body).toMatchObject({ error: { code: 'wrong_phase' } });
};

const actions = (id: string, qid: string) => ({
  teach: () => t.post(`/api/runs/${id}/teach`, { explanation: 'Something with enough words here.' }),
  answer: () => t.post(`/api/runs/${id}/questions/${qid}/answer`, { answer: 'x' }),
  skip: () => t.post(`/api/runs/${id}/questions/${qid}/skip`),
  ready: () => t.post(`/api/runs/${id}/ready`),
  turn: () => t.post(`/api/runs/${id}/turn`),
  help: () => t.post(`/api/runs/${id}/help/evt`, { answer: { choiceIndex: 0 } }),
  retry: () => t.post(`/api/runs/${id}/retry`),
  continue: () => t.post(`/api/runs/${id}/continue`),
  results: () => t.get(`/api/runs/${id}/results`),
});

describe('phase guards (409 wrong_phase)', () => {
  it('learning', async () => {
    const bot = new Bot(t);
    await bot.start();
    const a = actions(bot.runId, 'q_x');
    for (const name of ['turn', 'help', 'retry', 'continue', 'results'] as const) wrongPhase(await a[name]());
  });

  it('room', async () => {
    const bot = new Bot(t);
    await bot.start();
    await bot.learn();
    const a = actions(bot.runId, 'q_x');
    for (const name of ['teach', 'answer', 'skip', 'ready', 'retry', 'continue', 'results'] as const) wrongPhase(await a[name]());
  });

  it('room_result (failed): continue, ready, teach, results are wrong; retry works', async () => {
    const bot = new Bot(t);
    await bot.start();
    await bot.learn({ text: 'Hmm okay then whatever happens.' }); // a vague lesson: the student has nothing to go on
    expect(await bot.fight()).toMatchObject({ kind: 'room_end', passed: false });
    const a = actions(bot.runId, 'q_x');
    for (const name of ['teach', 'ready', 'continue', 'results', 'help'] as const) wrongPhase(await a[name]());
    expect((await a.retry()).status).toBe(200);
  });

  it('room_result (passed): retry is wrong; continue works', async () => {
    const bot = new Bot(t);
    await bot.start();
    await bot.learn();
    expect(await bot.fight()).toMatchObject({ kind: 'room_end', passed: true });
    wrongPhase(await actions(bot.runId, 'q_x').retry());
    expect((await actions(bot.runId, 'q_x').continue()).status).toBe(200);
  });

  it('boss and results', async () => {
    const bot = new Bot(t);
    await bot.start();
    for (let i = 0; i < 40; i++) {
      const run = await bot.run();
      if (run.phase === 'boss') break;
      if (run.phase === 'learning') await bot.learn();
      else if (run.phase === 'room') await bot.fight();
      else await t.post(`/api/runs/${bot.runId}/${run.room.passed ? 'continue' : 'retry'}`);
    }
    const a = actions(bot.runId, 'q_x');
    for (const name of ['teach', 'ready', 'retry', 'continue', 'results'] as const) wrongPhase(await a[name]());
    // Help IS allowed during a fight, so an unknown event id is not a phase error (see docs/STATE_MACHINE.md).
    const unknownEvent = await a.help();
    expect(unknownEvent.status).toBe(409);
    expect(unknownEvent.body).toMatchObject({ error: { code: 'help_event_not_pending' } });
    await bot.fight();
    for (const name of ['teach', 'ready', 'retry', 'continue', 'help'] as const) wrongPhase(await a[name]());
    expect((await a.results()).status).toBe(200);
  });
});

describe('other error codes', () => {
  it('unknown ids are 404', async () => {
    expect((await t.get('/api/runs/nope')).status).toBe(404);
    expect((await t.post('/api/runs/nope/turn')).status).toBe(404);
    expect((await t.get('/api/courses/nope')).status).toBe(404);
    expect((await t.get('/api/runs/nope/results')).status).toBe(404);
    expect((await t.post('/api/courses/seed/not-a-sample')).status).toBe(404);
    expect((await t.post('/api/runs', { courseId: 'nope', targetGrade: 'B' })).status).toBe(404);
    const bot = new Bot(t);
    await bot.start();
    expect((await t.post(`/api/runs/${bot.runId}/questions/nope/skip`)).status).toBe(404);
    expect((await t.get('/api/nothing-here')).status).toBe(404);
  });

  it('bad bodies are 400', async () => {
    const bot = new Bot(t);
    const run = await bot.start();
    expect((await t.post('/api/runs', {})).status).toBe(400);
    expect((await t.post('/api/runs', { courseId: run.courseId, targetGrade: 'Z' })).status).toBe(400);
    expect((await t.post('/api/runs', { courseId: run.courseId, targetGrade: 'B', studentEmoji: '😀' })).status).toBe(400);
    expect((await t.post(`/api/runs/${bot.runId}/teach`, { explanation: '   ' })).status).toBe(400);
    expect((await t.post(`/api/runs/${bot.runId}/teach`, {})).status).toBe(400);
    const otherRoomConcept = run.rooms[1]!.concepts[0]!.id;
    const foreign = await t.post(`/api/runs/${bot.runId}/teach`, { explanation: 'Words about it.', conceptId: otherRoomConcept });
    expect(foreign.status).toBe(400);
    expect(foreign.body).toMatchObject({ error: { code: 'validation_error' } });
    const focused = await t.post(`/api/runs/${bot.runId}/teach`, { explanation: 'Words about it.', conceptId: run.rooms[0]!.concepts[0]!.id });
    expect(focused.status).toBe(200);
    expect((await t.post(`/api/runs/${bot.runId}/questions/q/answer`, {})).status).toBe(400);
    expect((await t.post('/api/courses', {})).status).toBe(400);
    expect((await t.post('/api/runs', {})).body).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('an unready room is 425', async () => {
    // A sample whose first room is still being ingested, and one whose second room is.
    const dir = mkdtempSync(path.join(tmpdir(), 'top-samples-'));
    mkdirSync(path.join(dir, 'cache'));
    const seasons = JSON.parse(readFileSync(new URL('../../samples/cache/seasons.json', import.meta.url), 'utf8'));
    const withReady = (conceptsReady: string[]) =>
      JSON.stringify({ ...seasons, pack: { ...seasons.pack, status: { stage: 'concepts', conceptsReady } } });
    const [c1, c2, c3] = seasons.pack.rooms.map((r: any) => r.conceptIds[0]);
    writeFileSync(path.join(dir, 'cache', 'first-unready.json'), withReady([c2, c3]));
    writeFileSync(path.join(dir, 'cache', 'second-unready.json'), withReady([c1, c3]));

    const u = await startTestApp({}, { samplesDir: dir });
    try {
      // The first room is not ready: the run cannot start.
      const first = await u.post('/api/courses/seed/first-unready');
      const run = await u.post('/api/runs', { courseId: first.body.courseId, targetGrade: 'B' });
      expect(run.status).toBe(425);
      expect(run.body).toMatchObject({ error: { code: 'room_not_ready' } });

      // The first room is ready, the second is not: the run starts and stops at the unready room.
      const bot = new Bot(u);
      await bot.start('second-unready');
      await bot.learn();
      expect(await bot.fight()).toMatchObject({ kind: 'room_end', passed: true });
      const next = await u.post(`/api/runs/${bot.runId}/continue`);
      expect(next.status).toBe(425);
      expect(next.body).toMatchObject({ error: { code: 'room_not_ready' } });
    } finally {
      await u.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an upload is ingested in the background and can then be played', async () => {
    const created = await t.post('/api/courses', { text: '# Tiny\n\nA short note about nothing in particular.', title: 'Tiny' });
    expect(created.status).toBe(202);
    await t.container.services.idle();
    const course = await t.get(`/api/courses/${created.body.courseId}`);
    expect(course.status).toBe(200);
    expect(['ready', 'error']).toContain(course.body.status.stage);
  });

  it('seeding is idempotent and the sample list works', async () => {
    const a = await t.post('/api/courses/seed/seasons');
    const b = await t.post('/api/courses/seed/seasons');
    expect(a.body.courseId).toBe('sample-seasons');
    expect(b.body.courseId).toBe('sample-seasons');
    expect((await t.get('/api/samples')).body.samples.map((s: any) => s.id)).toEqual(expect.arrayContaining(['seasons', 'binary-search']));
    expect((await t.get('/api/health')).body.ok).toBe(true);
  });
});
