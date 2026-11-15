import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { buildPack, buildQuestions, createDeps } from '../engine/testing/fixtures';
import { newRun, defaultCtx } from '../engine/testing/play';
import { createMemoryVectorStore } from '../rag';
import { createIndexedDbRepository, createIndexedDbVectorStore, createMemoryRepository, openBrowserDatabase, type Repository } from './index';

/** A fresh, empty IndexedDB (fake-indexeddb, the same API browsers have). */
const freshDb = () => openBrowserDatabase({ factory: new IDBFactory() });

const implementations: [string, () => Promise<Repository>][] = [
  ['memory', async () => createMemoryRepository()],
  ['indexeddb', async () => createIndexedDbRepository(await freshDb())],
];

describe.each(implementations)('Repository: %s', (_name, make) => {
  it('init and close are safe to call twice', async () => {
    const repo = await make();
    await repo.init();
    await repo.init();
    await repo.close();
  });

  it('course packs round-trip as copies, not references', async () => {
    const repo = await make();
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
    const repo = await make();
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
    const repo = await make();
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
    const repo = await make();
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
    const repo=await make(), pack=buildPack(), questions=buildQuestions();
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

describe('IndexedDB storage specifics', () => {
  it('keeps dungeons, expeditions and chunks across a reopen (a page reload)', async () => {
    const factory = new IDBFactory();
    const pack = buildPack();
    const questions = buildQuestions();
    const first = await openBrowserDatabase({ factory, name: 'reload-test' });
    await createIndexedDbRepository(first).saveCoursePack(pack);
    await createIndexedDbRepository(first).upsertQuestions(questions);
    await createIndexedDbRepository(first).recordStats([{ questionId: questions[0].id, kind: 'help_solve', solveTimeSec: 12 }]);
    const run = newRun(createDeps(), defaultCtx);
    await createIndexedDbRepository(first).saveRun(run);
    const chunk = { id: `${pack.id}_f1_p1_0`, courseId: pack.id, fileId: 'f1', page: 1, sectionPath: ['Intro'], conceptIds: [], text: 'Seasons come from tilt.', embedding: [1, 0, 0] };
    await createIndexedDbVectorStore(first).upsert([chunk]);
    first.close();

    const second = await openBrowserDatabase({ factory, name: 'reload-test' });
    const repo = createIndexedDbRepository(second);
    expect(await repo.getCoursePack(pack.id)).toEqual(pack);
    expect(await repo.listQuestions(pack.id)).toHaveLength(questions.length);
    expect((await repo.getQuestionStats([questions[0].id]))[0].helpMeSolveTimesSec).toEqual([12]);
    expect((await repo.getRun(run.id))?.id).toBe(run.id);
    const store = createIndexedDbVectorStore(second);
    expect(await store.listByCourse(pack.id)).toEqual([chunk]);
    const [hit] = await store.search({ courseId: pack.id, embedding: [1, 0, 0], topK: 1 });
    expect(hit.chunk.id).toBe(chunk.id);
    expect(hit.score).toBeCloseTo(1);
  });

  it('the vector store matches the in-memory one: search per course, ordered listing, delete', async () => {
    const db = await freshDb();
    const stores = [createMemoryVectorStore(), createIndexedDbVectorStore(db)];
    const chunk = (id: string, courseId: string, embedding: number[], page = 1) =>
      ({ id, courseId, fileId: 'f1', page, sectionPath: [], conceptIds: [], text: id, embedding });
    const all = [chunk('a_f1_p2_0', 'a', [0, 1], 2), chunk('a_f1_p1_1', 'a', [1, 0]), chunk('a_f1_p1_0', 'a', [1, 1]), chunk('b_f1_p1_0', 'b', [1, 0])];
    for (const store of stores) {
      await store.upsert(all);
      expect((await store.listByCourse('a')).map((c) => c.id)).toEqual(['a_f1_p1_0', 'a_f1_p1_1', 'a_f1_p2_0']);
      expect((await store.search({ courseId: 'a', embedding: [1, 0], topK: 2 })).map((s) => s.chunk.id)).toEqual(['a_f1_p1_1', 'a_f1_p1_0']);
      expect((await store.getByIds(['b_f1_p1_0', 'missing'])).map((c) => c.id)).toEqual(['b_f1_p1_0']);
      await store.deleteCourse('a');
      expect(await store.listByCourse('a')).toEqual([]);
      expect(await store.listByCourse('b')).toHaveLength(1);
    }
  });
});
