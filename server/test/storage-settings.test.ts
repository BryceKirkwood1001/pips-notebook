/** Settings → MongoDB: choosing where dungeons are saved, switching while the server runs, and copying them. */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createContainer } from '../src/container';
import { AppError } from '../src/errors';
import type { MongoConnector } from '../src/storage';
import { fakeMongoCluster } from './helpers/fake-mongo';

const password = 'never-show-this-password';
const uri = `mongodb+srv://pip:${password}@cluster0.example.net/?retryWrites=true`;
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function start(options: { dir?: string; connect?: MongoConnector } = {}) {
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), 'pips-storage-'));
  if (!options.dir) cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const cluster = fakeMongoCluster();
  const container = await createContainer({
    env: { LLM_PROVIDER: 'mock' }, seed: 42,
    dataDir: join(dir, 'archive'), storageFile: join(dir, 'storage-settings.json'),
    connectMongo: options.connect ?? cluster.connect,
  });
  const app = await buildApp(container);
  cleanups.push(() => app.close());
  const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    return { status: res.statusCode, body: res.json(), raw: res.body };
  };
  return { dir, cluster, container, app, call };
}

describe('storage settings', () => {
  it('reports this computer as the storage, without any connection string', async () => {
    const { call } = await start();
    await call('POST', '/api/courses/seed/seasons');
    const { status, body } = await call('GET', '/api/settings/storage');
    expect(status).toBe(200);
    expect(body).toEqual({
      backend: 'local', active: 'local', courses: 1, error: null, persistence: 'local',
      mongodb: { hasUri: false, host: null, database: 'pips_notebook', vectorIndex: 'chunks_vector' },
    });
  });

  it('switches to MongoDB right away and copies dungeons, expeditions and statistics', async () => {
    const { call, cluster, dir } = await start();
    const { courseId } = (await call('POST', '/api/courses/seed/seasons')).body;
    const run = (await call('POST', '/api/runs', { courseId, targetGrade: 'B' })).body;
    await call('POST', `/api/runs/${run.id}/ready`);
    await call('POST', `/api/runs/${run.id}/turn`);

    const saved = await call('POST', '/api/settings/storage', { backend: 'mongodb', mongodb: { uri, database: 'pips' }, copyExisting: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      backend: 'mongodb', active: 'mongodb', courses: 1, error: null,
      mongodb: { hasUri: true, host: 'cluster0.example.net', database: 'pips' },
      copied: { courses: 1, runs: 1, skipped: 0 },
    });
    expect(saved.raw).not.toContain(password);

    expect((await call('GET', '/api/health')).body.storage).toBe('mongodb');
    expect((await call('GET', '/api/archive')).body.courses.map((c: { id: string }) => c.id)).toEqual([courseId]);
    expect((await call('GET', `/api/runs/${run.id}`)).body.phase).toBe('room');
    expect(cluster.docs('pips', 'questions').size).toBeGreaterThan(0);
    expect(cluster.docs('pips', 'questionStats').size).toBeGreaterThan(0);
    expect(cluster.docs('pips', 'chunks').size).toBeGreaterThan(0);

    const file = join(dir, 'storage-settings.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ backend: 'mongodb', mongodb: { uri, database: 'pips' } });
  });

  it('switches back to this computer, keeping its copy and skipping dungeons it already has', async () => {
    const { call } = await start();
    const { courseId } = (await call('POST', '/api/courses/seed/seasons')).body;
    await call('POST', '/api/settings/storage', { backend: 'mongodb', mongodb: { uri }, copyExisting: true });
    const other = (await call('POST', '/api/courses/seed/binary-search')).body.courseId;

    const back = await call('POST', '/api/settings/storage', { backend: 'local', copyExisting: true });
    expect(back.body).toMatchObject({ backend: 'local', active: 'local', courses: 2, copied: { courses: 1, skipped: 1 } });
    const ids = (await call('GET', '/api/archive')).body.courses.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual([courseId, other].sort());
  });

  it('starts empty in MongoDB when copying is not requested', async () => {
    const { call } = await start();
    await call('POST', '/api/courses/seed/seasons');
    const saved = await call('POST', '/api/settings/storage', { backend: 'mongodb', mongodb: { uri } });
    expect(saved.body).toMatchObject({ active: 'mongodb', courses: 0, copied: null });
    expect((await call('GET', '/api/archive')).body.courses).toEqual([]);
  });

  it('keeps the current storage when MongoDB cannot be reached', async () => {
    const { call, dir } = await start();
    await call('POST', '/api/courses/seed/seasons');
    const failed = await call('POST', '/api/settings/storage', {
      backend: 'mongodb', mongodb: { uri: `mongodb://pip:${password}@unreachable.example.net` }, copyExisting: true,
    });
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('storage_error');
    expect(failed.raw).not.toContain(password);
    expect((await call('GET', '/api/settings/storage')).body).toMatchObject({ backend: 'local', active: 'local', courses: 1 });
    await expect(stat(join(dir, 'storage-settings.json'))).rejects.toThrow();
  });

  it('remembers the choice across restarts and falls back to this computer if MongoDB is down at startup', async () => {
    const first = await start();
    await first.call('POST', '/api/settings/storage', { backend: 'mongodb', mongodb: { uri } });
    await first.app.close();

    const down: MongoConnector = async () => { throw new AppError('storage_error', 'Could not connect to MongoDB: connection refused'); };
    const second = await start({ dir: first.dir, connect: down });
    const report = (await second.call('GET', '/api/settings/storage')).body;
    expect(report).toMatchObject({ backend: 'mongodb', active: 'local', mongodb: { hasUri: true, host: 'cluster0.example.net' } });
    expect(report.error).toContain('MongoDB');
    expect(JSON.stringify(report)).not.toContain(password);
  });

  it('tests a connection without saving it', async () => {
    const { call, dir } = await start();
    expect((await call('POST', '/api/settings/storage/test', { backend: 'local' })).body).toEqual({
      ok: true, message: 'Dungeons are saved on this computer, in .local/archive.',
    });
    const tested = await call('POST', '/api/settings/storage/test', { backend: 'mongodb', mongodb: { uri, database: 'pips' } });
    expect(tested.body).toEqual({ ok: true, message: 'Connected to cluster0.example.net. Database "pips" has 0 dungeons.' });
    expect(tested.raw).not.toContain(password);
    expect((await call('GET', '/api/settings/storage')).body.backend).toBe('local');
    await expect(stat(join(dir, 'storage-settings.json'))).rejects.toThrow();
  });

  it('rejects bad input and requests from other machines', async () => {
    const { call, app } = await start();
    for (const payload of [{ backend: 'mongodb' }, { backend: 'mongodb', mongodb: { uri: 'http://example.net' } },
      { backend: 'mongodb', mongodb: { uri, database: 'bad name' } }, { backend: 'cloud' }, { backend: 'local', extra: true }]) {
      const bad = await call('POST', '/api/settings/storage', payload);
      expect(bad.status, JSON.stringify(payload)).toBe(400);
    }
    for (const [method, url] of [['GET', '/api/settings/storage'], ['POST', '/api/settings/storage'], ['POST', '/api/settings/storage/test']] as const) {
      const res = await app.inject({ method, url, remoteAddress: '192.0.2.1', ...(method === 'POST' ? { payload: { backend: 'local' } } : {}) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('settings_forbidden');
    }
  });
});
