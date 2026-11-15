/**
 * A course pack's own pace (short demos): listed first when named demo-*, its rules apply only to its runs, and a
 * placed "Help me!" turn always fires. Uses a copy of the Seasons sample with a pace added.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app';

const PACE = { roomQuestions: 2, bossQuestions: 3, maxStudentQuestions: 1, helpMeProb: 0, helpMeRoomTurn: 2 };
let dir: string;
let t: TestApp;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pips-pace-'));
  await mkdir(join(dir, 'cache'));
  const seasons = await readFile(new URL('../../samples/cache/seasons.json', import.meta.url), 'utf8');
  const demo = JSON.parse(seasons.replaceAll('sample-seasons', 'sample-demo-short'));
  demo.sample = 'demo-short';
  demo.pack.title = 'Short demo';
  demo.pack.pace = PACE;
  await writeFile(join(dir, 'cache', 'seasons.json'), seasons);
  await writeFile(join(dir, 'cache', 'demo-short.json'), JSON.stringify(demo));
  t = await startTestApp({}, { samplesDir: dir });
});
afterEach(async () => {
  await t.close();
  await rm(dir, { recursive: true, force: true });
});

describe('course pace', () => {
  it('lists demo samples first', async () => {
    expect((await t.get('/api/samples')).body.samples.map((s: { id: string }) => s.id)).toEqual(['demo-short', 'seasons']);
  });

  it('applies the pace to runs of that course only', async () => {
    const demo = (await t.post('/api/courses/seed/demo-short')).body.courseId;
    const seasons = (await t.post('/api/courses/seed/seasons')).body.courseId;
    const paced = (await t.post('/api/runs', { courseId: demo, targetGrade: 'B' })).body;
    expect(paced.rules).toMatchObject({ roomQuestions: 2, bossQuestions: 3, maxStudentQuestions: 1 });
    const normal = (await t.post('/api/runs', { courseId: seasons, targetGrade: 'B' })).body;
    expect(normal.rules).toMatchObject({ roomQuestions: 5, bossQuestions: 10, maxStudentQuestions: 3 });
  });

  it('always asks for help on the placed room turn', async () => {
    const courseId = (await t.post('/api/courses/seed/demo-short')).body.courseId;
    const run = (await t.post('/api/runs', { courseId, targetGrade: 'B', scope: { roomIds: ['r1'] } })).body;
    await t.post(`/api/runs/${run.id}/teach`, { explanation: "Earth's axis is tilted 23.5 degrees, so sunlight hits each hemisphere at a different angle through the year." });
    expect((await t.post(`/api/runs/${run.id}/ready`)).body.room.totalTurns).toBe(2);
    expect((await t.post(`/api/runs/${run.id}/turn`)).body.kind).toBe('student_answer');
    const help = (await t.post(`/api/runs/${run.id}/turn`)).body;
    expect(help.kind).toBe('help_me');
  });
});
