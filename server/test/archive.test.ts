/** The archive in the browser: dungeons, notebooks and expeditions survive a page reload (a new container on the same IndexedDB). */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, test } from 'vitest';
import { openBrowserStorage } from '../src/browser/main';
import type { Container, ContainerOptions } from '../src/container';
import { createIndexedDbRepository, openBrowserDatabase } from '../src/repo';
import { buildApp } from '../src/app';
import { createTestContainer } from './helpers/app';

const containers: Container[] = [];
afterEach(async () => { for (const c of containers.splice(0)) await c.close(); });
const env = {LLM_PROVIDER:'mock',HELP_ME_PROB:'1',HELP_ME_TIMED:'true'};

/** One browser profile: every `load` is the page opening (again) on the same IndexedDB. */
function browser() {
  const factory = new IDBFactory();
  return {
    factory,
    async load(options: ContainerOptions = {}) {
      const c = await createTestContainer({ env, ...options, storage: await openBrowserStorage({ factory }) });
      containers.push(c);
      return c;
    },
  };
}

test('course, questions, chunks, notebook and run survive a reload; archive stays public',async()=>{
  const profile=browser();
  const first=await profile.load({seed:12});
  const {courseId}=await first.services.seedCourse('seasons');
  const run=await first.services.createRun({courseId,targetGrade:'B'});
  await first.services.teach(run.id,'Seasons come from the tilt of Earth’s axis.');
  const before=await first.services.getRun(run.id);
  const debug=await first.services.getCourse(courseId);
  await first.close();
  const second=await profile.load({seed:12});
  expect(second.services.health().storage).toBe('browser');
  expect(await second.services.getRun(run.id)).toEqual(before);
  expect(await second.services.getCourse(courseId)).toEqual(debug);
  const archive=await second.services.listArchive();
  expect(archive.courses.map(c=>c.id)).toContain(courseId);
  expect(archive.runs.map(r=>r.id)).toContain(run.id);
  expect(JSON.stringify(archive)).not.toMatch(/acceptedAnswers|beliefStatement|keyPoints|correctAnswer/);
  const repo=createIndexedDbRepository(await openBrowserDatabase({factory:profile.factory}));
  expect((await repo.listQuestions(courseId)).length).toBeGreaterThan(0);
  expect((await second.storage.read())).toMatchObject({active:'browser',courses:1,runs:1,error:null});
});

test('pause is idempotent, blocks turns and shifts help deadlines/solve time across a reload',async()=>{
  const profile=browser();let now=Date.parse('2026-11-14T10:00:00Z');const clock={now:()=>new Date(now)};
  let c=await profile.load({clock,seed:15});
  const {courseId}=await c.services.seedCourse('seasons');
  const r=await c.services.createRun({courseId,targetGrade:'B'});await c.services.ready(r.id);
  const event=await c.services.turn(r.id);expect(event.kind).toBe('help_me');if(event.kind!=='help_me')throw Error('Expected help');
  now+=3000;const paused=await c.services.pauseRun(r.id);
  now+=10000;expect((await c.services.pauseRun(r.id)).pausedAt).toBe(paused.pausedAt);
  await expect(c.services.turn(r.id)).rejects.toMatchObject({code:'run_paused'});
  await c.close();
  now+=60000;c=await profile.load({clock,seed:15});
  expect((await c.services.getRun(r.id)).pausedAt).toBe(paused.pausedAt);
  const resumed=await c.services.resumeRun(r.id);
  expect(resumed.pausedAt).toBeUndefined();
  expect(Date.parse(resumed.pendingHelpMe!.deadline!)-Date.parse(event.deadline!)).toBe(70000);
  const repo=createIndexedDbRepository(await openBrowserDatabase({factory:profile.factory}));
  const pending=(await repo.getRun(r.id))!.pendingHelpMe!;
  expect(now-Date.parse(pending.startedAt)).toBe(3000);
  const again=await c.services.resumeRun(r.id);expect(again.pendingHelpMe!.deadline).toBe(resumed.pendingHelpMe!.deadline);
});

test('concurrent stat writes all land',async()=>{
  const factory=new IDBFactory();
  const repo=createIndexedDbRepository(await openBrowserDatabase({factory}));
  await Promise.all(Array.from({length:20},()=>repo.recordStats([{questionId:'q1',kind:'student_correct'}])));
  const reopened=createIndexedDbRepository(await openBrowserDatabase({factory}));
  expect((await reopened.getQuestionStats(['q1']))[0].studentCorrect).toBe(20);
});

test('a browser that blocks storage still plays, in memory, and says so',async()=>{
  const blocked={open(){throw new Error('The operation is insecure.');}} as unknown as IDBFactory;
  const c=await createTestContainer({env,storage:await openBrowserStorage({factory:blocked})});containers.push(c);
  expect(c.services.health().storage).toBe('memory');
  const {courseId}=await c.services.seedCourse('seasons');
  expect((await c.services.listArchive()).courses.map(x=>x.id)).toEqual([courseId]);
  expect((await c.storage.read()).error).toMatch(/blocked saving dungeons.*until this page closes/);
});

test('an upload interrupted by a reload is marked, unless another tab is still preparing it',async()=>{
  const profile=browser();
  const first=await profile.load();
  const repo=createIndexedDbRepository(await openBrowserDatabase({factory:profile.factory}));
  const {courseId}=await first.services.seedCourse('seasons');
  const seeded=(await repo.getCoursePack(courseId))!;
  await repo.saveCoursePack({...seeded,id:'crs_cut',status:{...seeded.status,stage:'concepts'}});
  await repo.saveCoursePack({...seeded,id:'crs_other_tab',status:{...seeded.status,stage:'outline'}});
  await first.close();
  const second=await profile.load({preparingElsewhere:async()=>new Set(['crs_other_tab'])});
  expect((await second.services.getCourse('crs_cut')).status).toMatchObject({stage:'error',error:expect.stringMatching(/page was closed or reloaded/)});
  expect((await second.services.getCourse('crs_other_tab')).status.stage).toBe('outline');
});

test('completed room-attempt history survives a reload without exposing hidden state',async()=>{
  const profile=browser();
  const options={env:{...env,HELP_ME_PROB:'0'},seed:42};
  const first=await profile.load(options);
  const {courseId}=await first.services.seedCourse('seasons');
  const created=await first.services.createRun({courseId,targetGrade:'B'});
  await first.services.ready(created.id);
  let before=await first.services.getRun(created.id);
  for(let turn=0;before.phase==='room' && turn<10;turn++){
    await first.services.turn(created.id);
    before=await first.services.getRun(created.id);
  }
  expect(before.phase).toBe('room_result');
  expect(before.history).toHaveLength(1);
  expect(before.history![0]).toMatchObject({roomId:created.currentRoom!.id,attempt:1,passed:false,total:3,correct:0});
  await first.close();
  const second=await profile.load(options);
  const restored=await second.services.getRun(created.id);
  expect(restored.history).toEqual(before.history);
  expect(JSON.stringify(restored.history)).not.toMatch(/misconceptionId|beliefStatement|questionIds|targetedMap/);
});

test('pause and resume over the API',async()=>{
  const c=await createTestContainer({env});containers.push(c);const app=buildApp(c);
  const {courseId}=await c.services.seedCourse('seasons');
  const r=await c.services.createRun({courseId,targetGrade:'B'});
  expect((await app.inject({method:'GET',url:'/api/archive'})).statusCode).toBe(200);
  const paused=await app.inject({method:'POST',url:`/api/runs/${r.id}/pause`});expect(paused.json().pausedAt).toBeTruthy();
  expect((await app.inject({method:'POST',url:`/api/runs/${r.id}/ready`})).json().error.code).toBe('run_paused');
  expect((await app.inject({method:'POST',url:`/api/runs/${r.id}/resume`})).json().pausedAt).toBeUndefined();
});
