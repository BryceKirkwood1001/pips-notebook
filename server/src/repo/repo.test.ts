import { describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { buildPack, buildQuestions, createDeps } from '../engine/testing/fixtures';
import { newRun, defaultCtx } from '../engine/testing/play';
import { createMemoryRepository, createMongoRepository, type Repository } from './index';

// ── A minimal fake of the parts of `Db` the Mongo repository uses ───────────

type Doc = Record<string, any>;

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, v]) =>
    v && typeof v === 'object' && '$in' in v ? (v.$in as unknown[]).includes(doc[k]) : doc[k] === v,
  );
}

function fakeCollection(store: Map<string, Doc>, indexes: string[]) {
  return {
    async createIndex(spec: Doc) {
      indexes.push(JSON.stringify(spec));
    },
    async replaceOne(filter: Doc, doc: Doc, opts?: { upsert?: boolean }) {
      const found = [...store.values()].find((d) => matches(d, filter));
      if (found || opts?.upsert) store.set(doc._id, structuredClone(doc));
    },
    async findOne(filter: Doc) {
      const d = [...store.values()].find((x) => matches(x, filter));
      return d ? structuredClone(d) : null;
    },
    async bulkWrite(ops: Doc[]) {
      for (const op of ops) store.set(op.replaceOne.replacement._id, structuredClone(op.replaceOne.replacement));
    },
    find(filter: Doc) {
      return { toArray: async () => [...store.values()].filter((d) => matches(d, filter)).map((d) => structuredClone(d)) };
    },
    async deleteMany(filter: Doc) {
      for (const [id, d] of store) if (matches(d, filter)) store.delete(id);
    },
    async deleteOne(filter: Doc) {
      const found=[...store.entries()].find(([,doc])=>matches(doc,filter));
      if (!found) return {deletedCount:0};
      store.delete(found[0]);return {deletedCount:1};
    },
    async updateOne(filter: Doc, update: Doc, opts?: { upsert?: boolean }) {
      let found = [...store.values()].find((d) => matches(d, filter));
      if (!found) {
        if (!opts?.upsert) return;
        found = { _id: filter._id, ...(update.$setOnInsert ?? {}) } as Doc;
        store.set(found._id, found);
      }
      const doc: Doc = found;
      for (const [k, v] of Object.entries<number>(update.$inc ?? {})) doc[k] = (doc[k] ?? 0) + v;
      for (const [k, v] of Object.entries<any>(update.$push ?? {})) {
        doc[k] = doc[k] ?? [];
        if (v && typeof v === 'object' && '$each' in v) doc[k].push(...v.$each);
        else doc[k].push(v);
      }
    },
  };
}

function fakeDb(): { db: Db; indexes: string[] } {
  const stores = new Map<string, Map<string, Doc>>();
  const indexes: string[] = [];
  const db = {
    collection(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      return fakeCollection(stores.get(name)!, indexes);
    },
  } as unknown as Db;
  return { db, indexes };
}

const implementations: [string, () => Repository][] = [
  ['memory', () => createMemoryRepository()],
  ['mongo (fake Db)', () => createMongoRepository(fakeDb().db)],
];

describe.each(implementations)('Repository: %s', (_name, make) => {
  it('init and close are safe to call twice', async () => {
    const repo = make();
    await repo.init();
    await repo.init();
    await repo.close();
  });

  it('course packs round-trip as copies, not references', async () => {
    const repo = make();
    const pack = buildPack();
    await repo.saveCoursePack(pack);
    const got = await repo.getCoursePack(pack.id);
    expect(got).toEqual(pack);
    expect(got).not.toHaveProperty('_id');
    got!.title = 'mutated';
    pack.title = 'mutated too';
    expect((await repo.getCoursePack(pack.id))!.title).toBe('Test Course');
    expect(await repo.getCoursePack('missing')).toBeNull();
    await repo.saveCoursePack({ ...buildPack(), title: 'Replaced' });
    expect((await repo.getCoursePack(pack.id))!.title).toBe('Replaced');
  });

  it('questions: upsert, list per course, verifiedOnly, delete', async () => {
    const repo = make();
    const qs = buildQuestions();
    await repo.upsertQuestions(qs);
    await repo.upsertQuestions([{ ...qs[0], id: 'other_q', courseId: 'other' }]);
    const all = await repo.listQuestions('course1');
    expect(all).toHaveLength(qs.length);
    expect(all.every((q) => !('_id' in q))).toBe(true);
    const verified = await repo.listQuestions('course1', { verifiedOnly: true });
    expect(verified).toHaveLength(qs.length - 1);
    expect(verified.every((q) => q.verified)).toBe(true);
    // replace by id
    await repo.upsertQuestions([{ ...qs[1], prompt: 'changed' }]);
    expect((await repo.listQuestions('course1')).find((q) => q.id === qs[1].id)!.prompt).toBe('changed');
    expect(await repo.listQuestions('course1')).toHaveLength(qs.length);
    // copies
    all[0].prompt = 'mutated';
    expect((await repo.listQuestions('course1')).find((q) => q.id === all[0].id)!.prompt).not.toBe('mutated');
    await repo.deleteQuestions('course1');
    expect(await repo.listQuestions('course1')).toEqual([]);
    expect(await repo.listQuestions('other')).toHaveLength(1);
  });

  it('stats: increments and solve times; unplayed questions are absent', async () => {
    const repo = make();
    await repo.recordStats([
      { questionId: 'a', kind: 'student_correct' },
      { questionId: 'a', kind: 'student_correct' },
      { questionId: 'a', kind: 'student_wrong' },
      { questionId: 'a', kind: 'help_solve', solveTimeSec: 12 },
      { questionId: 'a', kind: 'help_solve', solveTimeSec: 8.5 },
      { questionId: 'b', kind: 'help_solve', solveTimeSec: 3 },
      { questionId: 'c', kind: 'student_wrong' },
    ]);
    const stats = await repo.getQuestionStats(['a', 'b', 'c', 'never']);
    const by = Object.fromEntries(stats.map((s) => [s.questionId, s]));
    expect(Object.keys(by).sort()).toEqual(['a', 'b', 'c']);
    expect(by.a).toEqual({ questionId: 'a', studentCorrect: 2, studentWrong: 1, helpMeSolveTimesSec: [12, 8.5] });
    expect(by.b).toEqual({ questionId: 'b', studentCorrect: 0, studentWrong: 0, helpMeSolveTimesSec: [3] });
    expect(by.c).toEqual({ questionId: 'c', studentCorrect: 0, studentWrong: 1, helpMeSolveTimesSec: [] });
    await repo.recordStats([{ questionId: 'a', kind: 'student_wrong' }]);
    expect((await repo.getQuestionStats(['a']))[0].studentWrong).toBe(2);
    expect(await repo.getQuestionStats([])).toEqual([]);
  });

  it('runs round-trip as copies', async () => {
    const repo = make();
    const run = newRun(createDeps(), defaultCtx);
    await repo.saveRun(run);
    const got = await repo.getRun(run.id);
    expect(got).toEqual(run);
    got!.notebookMd = 'mutated';
    expect((await repo.getRun(run.id))!.notebookMd).toBe('# Notebook\n');
    await repo.saveRun({ ...run, phase: 'room' });
    expect((await repo.getRun(run.id))!.phase).toBe('room');
    expect(await repo.getRun('missing')).toBeNull();
  });

  it('deleting a dungeon cascades through questions, stats and runs, preserving another course',async()=>{
    const repo=make(), pack=buildPack(), questions=buildQuestions();
    await repo.saveCoursePack(pack);
    await repo.saveCoursePack({...pack,id:'other'});
    await repo.upsertQuestions([...questions,{...questions[0],id:'other_q',courseId:'other'}]);
    await repo.recordStats([{questionId:questions[0].id,kind:'student_correct'},{questionId:'other_q',kind:'student_wrong'}]);
    const run={...newRun(createDeps(),defaultCtx),courseId:pack.id};
    await repo.saveRun(run);await repo.saveRun({...run,id:'other_run',courseId:'other'});
    expect(await repo.deleteCourse(pack.id)).toBe(true);
    expect(await repo.deleteCourse(pack.id)).toBe(false);
    expect(await repo.getCoursePack(pack.id)).toBeNull();
    expect(await repo.listQuestions(pack.id)).toEqual([]);
    expect(await repo.getQuestionStats([questions[0].id])).toEqual([]);
    expect(await repo.getRun(run.id)).toBeNull();
    expect(await repo.getCoursePack('other')).not.toBeNull();
    expect(await repo.listQuestions('other')).toHaveLength(1);
    expect(await repo.getQuestionStats(['other_q'])).toHaveLength(1);
    expect(await repo.getRun('other_run')).not.toBeNull();
  });
});

describe('Mongo repository specifics', () => {
  it('init creates an index on questions.courseId', async () => {
    const { db, indexes } = fakeDb();
    await createMongoRepository(db).init();
    expect(indexes).toContain(JSON.stringify({ courseId: 1 }));
  });
});
