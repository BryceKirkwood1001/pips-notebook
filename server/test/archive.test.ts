import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContainer, type Container } from '../src/container';
import { createFileRepository, createFileVectorStore } from '../src/repo/file';
import { buildApp } from '../src/app';

const directories: string[] = [], containers: Container[] = [];
afterEach(async () => { for (const c of containers.splice(0)) await c.close(); for (const d of directories.splice(0)) await rm(d,{recursive:true,force:true}); });
async function directory() {const d=await mkdtemp(join(tmpdir(),'top-archive-'));directories.push(d);return d;}
const env = {LLM_PROVIDER:'mock',HELP_ME_PROB:'1',HELP_ME_TIMED:'true'};

test('course, questions, chunks, notebook and run survive a new container; archive stays public',async()=>{
  const dataDir=await directory();
  const first=await createContainer({env,dataDir,seed:12});
  const {courseId}=await first.services.seedCourse('seasons');
  const run=await first.services.createRun({courseId,targetGrade:'B'});
  await first.services.teach(run.id,'Seasons come from the tilt of Earth’s axis.');
  const before=await first.services.getRun(run.id);
  const debug=await first.services.getCourse(courseId);
  await first.close();
  const second=await createContainer({env,dataDir,seed:12});containers.push(second);
  expect(second.services.health().storage).toBe('local');
  expect(await second.services.getRun(run.id)).toEqual(before);
  expect(await second.services.getCourse(courseId)).toEqual(debug);
  const archive=await second.services.listArchive();
  expect(archive.courses.map(c=>c.id)).toContain(courseId);
  expect(archive.runs.map(r=>r.id)).toContain(run.id);
  expect(JSON.stringify(archive)).not.toMatch(/acceptedAnswers|beliefStatement|keyPoints|correctAnswer/);
  const repo=createFileRepository(dataDir);await repo.init();
  expect((await repo.listQuestions(courseId)).length).toBeGreaterThan(0);
  const store=createFileVectorStore(dataDir);await store.init();
  expect((await store.listByCourse(courseId)).length).toBeGreaterThan(0);
  expect((await stat(join(dataDir,'repository.json'))).mode & 0o777).toBe(0o600);
});

test('pause is idempotent, blocks turns and shifts help deadlines/solve time across a restart',async()=>{
  const dataDir=await directory();let now=Date.parse('2026-11-14T10:00:00Z');const clock={now:()=>new Date(now)};
  let c=await createContainer({env,dataDir,clock,seed:15});
  const {courseId}=await c.services.seedCourse('seasons');
  const r=await c.services.createRun({courseId,targetGrade:'B'});await c.services.ready(r.id);
  const event=await c.services.turn(r.id);expect(event.kind).toBe('help_me');if(event.kind!=='help_me')throw Error('Expected help');
  now+=3000;const paused=await c.services.pauseRun(r.id);
  now+=10000;expect((await c.services.pauseRun(r.id)).pausedAt).toBe(paused.pausedAt);
  await expect(c.services.turn(r.id)).rejects.toMatchObject({code:'run_paused'});
  await c.close();
  now+=60000;c=await createContainer({env,dataDir,clock,seed:15});containers.push(c);
  expect((await c.services.getRun(r.id)).pausedAt).toBe(paused.pausedAt);
  const resumed=await c.services.resumeRun(r.id);
  expect(resumed.pausedAt).toBeUndefined();
  expect(Date.parse(resumed.pendingHelpMe!.deadline!)-Date.parse(event.deadline!)).toBe(70000);
  const repo=createFileRepository(dataDir);await repo.init();
  const pending=(await repo.getRun(r.id))!.pendingHelpMe!;
  expect(now-Date.parse(pending.startedAt)).toBe(3000);
  const again=await c.services.resumeRun(r.id);expect(again.pendingHelpMe!.deadline).toBe(resumed.pendingHelpMe!.deadline);
});

test('concurrent stat writes are serialized and corrupted archives fail visibly',async()=>{
  const d=await directory();const repo=createFileRepository(d);await repo.init();
  await Promise.all(Array.from({length:20},()=>repo.recordStats([{questionId:'q1',kind:'student_correct'}])));
  const reopened=createFileRepository(d);await reopened.init();
  expect((await reopened.getQuestionStats(['q1']))[0].studentCorrect).toBe(20);
  await writeFile(join(d,'repository.json'),'broken');
  await expect(createFileRepository(d).init()).rejects.toThrow();
  expect(await readFile(join(d,'repository.json'),'utf8')).toBe('broken');
});

test('completed room-attempt history survives a new container without exposing hidden state',async()=>{
  const dataDir=await directory();
  const options={env:{...env,HELP_ME_PROB:'0'},dataDir,seed:42};
  const first=await createContainer(options);
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
  const second=await createContainer(options);containers.push(second);
  const restored=await second.services.getRun(created.id);
  expect(restored.history).toEqual(before.history);
  expect(JSON.stringify(restored.history)).not.toMatch(/misconceptionId|beliefStatement|questionIds|targetedMap/);
});

test('archive and pause/resume endpoints validate ids and avoid hidden fields',async()=>{
  const c=await createContainer({env});const app=await buildApp(c);
  try {
    const {courseId}=await c.services.seedCourse('seasons');const r=await c.services.createRun({courseId,targetGrade:'B'});
    expect((await app.inject({method:'GET',url:'/api/archive'})).statusCode).toBe(200);
    const paused=await app.inject({method:'POST',url:`/api/runs/${r.id}/pause`});expect(paused.json().pausedAt).toBeTruthy();
    expect((await app.inject({method:'POST',url:`/api/runs/${r.id}/ready`})).json().error.code).toBe('run_paused');
    expect((await app.inject({method:'POST',url:`/api/runs/${r.id}/resume`})).json().pausedAt).toBeUndefined();
  } finally {await app.close();}
});
