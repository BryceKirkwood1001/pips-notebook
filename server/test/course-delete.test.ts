import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, test } from 'vitest';
import { openBrowserStorage } from '../src/browser/main';
import type { Container } from '../src/container';
import { createIndexedDbRepository, createIndexedDbVectorStore, openBrowserDatabase } from '../src/repo';
import { createDirectorySampleSource } from '../src/node/samples';
import { engine } from '../src/engine';
import { createServices } from '../src/services/create';
import { createMockGameplayTasks } from '../src/llm/gameplay/mock';
import { makeDeps } from '../src/ingest/testHelpers';
import { runIngest } from '../src/ingest';
import type { IngestReport } from '../src/ingest/types';
import { createTestContainer, startTestApp } from './helpers/app';

const containers: Container[] = [];
afterEach(async()=>{
  for (const c of containers.splice(0)) await c.close();
});
const env={LLM_PROVIDER:'mock',HELP_ME_PROB:'0',HELP_ME_TIMED:'false'};

test('HTTP dungeon deletion removes all associated runs and leaves other dungeons playable',async()=>{
  const t=await startTestApp({HELP_ME_PROB:'0'});
  try {
    const {courseId}= (await t.post('/api/courses/seed/seasons')).body;
    const other=(await t.post('/api/courses/seed/binary-search')).body.courseId;
    const runIds=[];
    for(let i=0;i<2;i++) runIds.push((await t.post('/api/runs',{courseId,targetGrade:'B'})).body.id);
    const kept=(await t.post('/api/runs',{courseId:other,targetGrade:'B'})).body;
    const deleted=await t.send('DELETE',`/api/courses/${courseId}`);
    expect(deleted).toEqual({status:200,body:{deleted:true,id:courseId}});
    expect((await t.get(`/api/courses/${courseId}`)).status).toBe(404);
    for(const id of runIds) expect((await t.get(`/api/runs/${id}`)).status).toBe(404);
    expect((await t.post('/api/runs',{courseId,targetGrade:'B'})).status).toBe(404);
    expect((await t.send('DELETE',`/api/courses/${courseId}`)).status).toBe(404);
    expect((await t.get(`/api/runs/${kept.id}`)).body).toEqual(kept);
    const archive=(await t.get('/api/archive')).body;
    expect(archive.courses.map((c:{id:string})=>c.id)).toEqual([other]);
    expect(archive.runs.map((r:{id:string})=>r.id)).toEqual([kept.id]);
  } finally { await t.close(); }
});

test('deletion persists across a reload and removes questions, statistics and source chunks',async()=>{
  const factory=new IDBFactory();
  const first=await createTestContainer({env,storage:await openBrowserStorage({factory}),seed:42});
  const {courseId}=await first.services.seedCourse('seasons');
  const other=(await first.services.seedCourse('binary-search')).courseId;
  const run=await first.services.createRun({courseId,targetGrade:'B'});
  await first.services.ready(run.id);await first.services.turn(run.id);
  const db=await openBrowserDatabase({factory});
  const repo=createIndexedDbRepository(db);
  const ids=(await repo.listQuestions(courseId)).map(q=>q.id);
  expect((await repo.getQuestionStats(ids)).length).toBeGreaterThan(0);
  await first.services.deleteCourse(courseId);
  await first.close();
  const second=await createTestContainer({env,storage:await openBrowserStorage({factory})});containers.push(second);
  await expect(second.services.getCourse(courseId)).rejects.toMatchObject({code:'not_found'});
  await expect(second.services.getRun(run.id)).rejects.toMatchObject({code:'not_found'});
  expect((await second.services.getCourse(other)).id).toBe(other);
  expect(await repo.listQuestions(courseId)).toEqual([]);
  expect(await repo.getQuestionStats(ids)).toEqual([]);
  const store=createIndexedDbVectorStore(db);
  expect(await store.listByCourse(courseId)).toEqual([]);
  expect((await store.listByCourse(other)).length).toBeGreaterThan(0);
});

function serviceContext(overrides: Partial<Parameters<typeof createServices>[0]>={}) {
  const ctx=makeDeps();
  return {...ctx,services:createServices({
    config:ctx.config,clock:ctx.deps.clock,repo:ctx.repo,store:ctx.store,embedder:ctx.deps.embedder,
    retriever:ctx.deps.retriever,engine,gameplayTasks:createMockGameplayTasks(),
    makeIngestDeps:()=>ctx.deps,runIngest,samples:createDirectorySampleSource(),
    newSeed:()=>42,storage:'memory',...overrides,
  })};
}

test('actively ingesting dungeons cannot be deleted and recreated by background work',async()=>{
  let finish!: (report:IngestReport)=>void;
  const ctx=serviceContext({runIngest:()=>new Promise(resolve=>{finish=resolve;})});
  const {courseId}=await ctx.services.createCourse({files:[{name:'notes.md',data:new TextEncoder().encode('Some course material.')}]});
  await expect(ctx.services.deleteCourse(courseId)).rejects.toMatchObject({code:'course_busy',status:409});
  expect(await ctx.repo.getCoursePack(courseId)).not.toBeNull();
  finish({courseId,ok:false,error:'Preparation stopped.',totalMs:0});
  await ctx.services.idle();
  expect(await ctx.services.deleteCourse(courseId)).toEqual({deleted:true,id:courseId});
});

test('failed ingestion setup clears the busy guard so its failed dungeon can be deleted',async()=>{
  const ctx=serviceContext({makeIngestDeps:()=>{throw new Error('Ingestion setup failed.');}});
  const {courseId}=await ctx.services.createCourse({files:[{name:'notes.md',data:new TextEncoder().encode('Course notes.')} ]});
  await ctx.services.idle();
  expect((await ctx.repo.getCoursePack(courseId))!.status.stage).toBe('error');
  expect(await ctx.services.deleteCourse(courseId)).toEqual({deleted:true,id:courseId});
});

test('deletion waits for an in-flight teaching write and prevents the run from reappearing',async()=>{
  let release!:()=>void, entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const ctx=serviceContext({engine:{...engine,teach:async(...args)=>{entered();await gate;return engine.teach(...args);}}});
  const {courseId}=await ctx.services.seedCourse('seasons');
  const run=await ctx.services.createRun({courseId,targetGrade:'B'});
  const teaching=ctx.services.teach(run.id,'Seasons are caused by Earth’s tilted axis.');
  await waiting;
  const deleting=ctx.services.deleteCourse(courseId);
  release();
  await teaching;await deleting;
  expect(await ctx.repo.getRun(run.id)).toBeNull();
  expect(await ctx.repo.getCoursePack(courseId)).toBeNull();
  expect(await ctx.store.listByCourse(courseId)).toEqual([]);
});
