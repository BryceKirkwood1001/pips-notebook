/**
 * A "teacher bot" over HTTP for the integration tests. It reads the hidden data from /debug
 * (only to decide what to type) and records every public response body for the leak scan.
 */
import { correctAnswerOf } from '../../src/core/grading';
import type { TestApp } from './app';

export class Bot {
  /** Every body returned by a public endpoint (everything except /debug). */
  bodies: { path: string; body: unknown }[] = [];
  runId = '';
  constructor(public t: TestApp) {}

  private async rec(path: string, r: { status: number; body: any }, method = 'POST') {
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    this.bodies.push({ path, body: r.body });
    return r.body;
  }
  post = async (suffix: string, body?: unknown) => this.rec(suffix, await this.t.post(`/api/runs/${this.runId}${suffix}`, body));
  private get = async (suffix: string) => this.rec(suffix, await this.t.get(`/api/runs/${this.runId}${suffix}`), 'GET');

  debug = async () => {
    const r = await this.t.get(`/api/runs/${this.runId}/debug`);
    if (r.status !== 200) throw new Error(`debug -> ${r.status}`);
    return r.body;
  };

  async start(sample = 'seasons', target = 'B') {
    const seeded = await this.t.post(`/api/courses/seed/${sample}`);
    const courseId = (await this.rec('/courses/seed', seeded)).courseId;
    await this.rec('/courses/:id', await this.t.get(`/api/courses/${courseId}`), 'GET');
    const run = await this.rec('/runs', await this.t.post('/api/runs', { courseId, targetGrade: target }));
    this.runId = run.id;
    return run;
  }

  /** Teach the room's key point statements; answer open questions with the correction (or skip them). */
  async learn(opts: { text?: string; skip?: 'all' | 'none' } = {}) {
    const dbg = await this.debug();
    const room = dbg.pack.rooms[dbg.run.roomIndex];
    const concepts = dbg.pack.concepts.filter((c: any) => room.conceptIds.includes(c.id));
    const text = opts.text ?? concepts.flatMap((c: any) => c.keyPoints.map((k: any) => k.statement)).join('. ') + '.';
    const taught = await this.post('/teach', { explanation: text });
    const after = await this.debug();
    for (const q of taught.questions.filter((x: any) => x.status === 'open')) {
      if (opts.skip === 'all') {
        await this.post(`/questions/${q.id}/skip`);
        continue;
      }
      const hidden = after.run.learning.pendingQuestions.find((p: any) => p.id === q.id);
      const m = after.pack.concepts.flatMap((c: any) => c.misconceptions).find((x: any) => x.id === hidden.misconceptionId);
      await this.post(`/questions/${q.id}/answer`, { answer: m.correction });
    }
    return this.post('/ready');
  }

  /** Plays turns until room_end or boss_end. "Help me!" is answered correctly from the debug keys. */
  async fight() {
    const dbg = await this.debug();
    for (let i = 0; i < 100; i++) {
      const r = await this.post('/turn');
      if (r.kind === 'help_me') {
        const q = dbg.questions.find((x: any) => x.id === r.question.id);
        await this.post(`/help/${r.eventId}`, { answer: correctAnswerOf(q).answer });
      }
      if (r.kind === 'room_end' || r.kind === 'boss_end') return r;
    }
    throw new Error('fight did not end');
  }

  async run() {
    return this.get('');
  }

  /** Plays the whole run to the results screen. `firstTeach` lets a test teach badly on room 1. */
  async finish(opts: { firstTeach?: string } = {}) {
    let first = opts.firstTeach;
    for (let guard = 0; guard < 60; guard++) {
      const run = await this.run();
      if (run.phase === 'results') break;
      if (run.phase === 'learning') {
        await this.learn({ text: first });
        first = undefined;
      } else if (run.phase === 'room' || run.phase === 'boss') await this.fight();
      else if (run.phase === 'room_result') {
        if (run.room.passed) await this.post('/continue');
        else await this.post('/retry');
      }
    }
    return this.get('/results');
  }
}
