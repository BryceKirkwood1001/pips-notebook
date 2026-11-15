/** The Gravity sample: listed first, short pace applied, room fight and boss both reached, and playable offline. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app';

let t: TestApp;
beforeEach(async () => { t = await startTestApp(); });
afterEach(async () => { await t.close(); });

describe('gravity sample', () => {
  it('is the first sample in the Library', async () => {
    const { body } = await t.get('/api/samples');
    expect(body.samples[0]).toEqual({ id: 'gravity', title: 'Gravity' });
  });

  it('plays a short room fight whose second question is a "Help me!", then a short boss, with one question from Pip', async () => {
    const { courseId } = (await t.post('/api/courses/seed/gravity')).body;
    let run = (await t.post('/api/runs', { courseId, targetGrade: 'C' })).body;
    expect(run.rules).toEqual({ roomQuestions: 3, roomHearts: 3, bossQuestions: 4, maxStudentQuestions: 1, helpMeTimed: true });
    expect(run.currentRoom.concepts.map((c: { title: string }) => c.title)).toEqual(['Why things fall', 'Gravity in space']);

    let requests = 2;
    const teach = async (conceptId: string, explanation: string) => {
      requests += 1;
      return (await t.post(`/api/runs/${run.id}/teach`, { explanation, conceptId })).body;
    };
    await teach('c1', 'Gravity pulls everything toward the center of the Earth. Without air, a heavy ball and a light ball land at the same time.');
    const second = await teach('c2', 'There is gravity in space. It is what keeps the Moon going around the Earth.');
    // Each response carries the whole list of Pip's questions so far.
    expect(second.questions.length).toBeLessThanOrEqual(1);

    const bossKinds: string[] = [];
    let bossTurns = 0;
    for (let attempt = 0; attempt < 3 && run.phase !== 'boss' && run.phase !== 'results'; attempt++) {
      run = (await t.post(`/api/runs/${run.id}/ready`)).body; requests += 1;
      expect(run.room.totalTurns).toBe(3);
      const roomKinds: string[] = [];
      for (;;) {
        const turn = (await t.post(`/api/runs/${run.id}/turn`)).body; requests += 1;
        roomKinds.push(turn.kind);
        if (turn.kind === 'help_me') {
          // The player answers this one: true/false or multiple choice.
          const answer = turn.question.type === 'true_false' ? { value: true } : { choiceIndex: 0 };
          const help = (await t.post(`/api/runs/${run.id}/help/${turn.eventId}`, { answer })).body; requests += 1;
          roomKinds.push(help.kind);
        }
        if (turn.kind === 'room_end') {
          // Every attempt: a student answer, then "Help me!" on the second question, then the third question.
          expect(roomKinds.slice(0, 3)).toEqual(['student_answer', 'help_me', 'help_result']);
          expect(roomKinds.filter((k) => k === 'help_me')).toHaveLength(1);
          run = (await t.post(`/api/runs/${run.id}/${turn.passed ? 'continue' : 'retry'}`)).body; requests += 1;
          break;
        }
      }
    }
    expect(run.phase).toBe('boss');
    expect(run.boss.totalTurns).toBe(4);
    for (;;) {
      const turn = (await t.post(`/api/runs/${run.id}/turn`)).body; requests += 1;
      bossKinds.push(turn.kind);
      if (turn.kind === 'student_answer') bossTurns += 1;
      if (turn.kind === 'boss_end') break;
    }
    const results = await t.get(`/api/runs/${run.id}/results`);
    expect(results.status).toBe(200);
    expect(bossKinds).not.toContain('help_me');
    expect(bossTurns).toBe(4);
    // Two explanations, a short room fight (with at most a couple of retries) and a short boss.
    expect(requests).toBeLessThanOrEqual(30);
  });

  it('offline, Pip answers every question right after a plain-words lesson', async () => {
    const { courseId } = (await t.post('/api/courses/seed/gravity')).body;
    const run = (await t.post('/api/runs', { courseId, targetGrade: 'C' })).body;
    await t.post(`/api/runs/${run.id}/teach`, { conceptId: 'c1', explanation: 'Gravity pulls things down toward the Earth. Heavy and light things fall at the same speed.' });
    const taught = (await t.post(`/api/runs/${run.id}/teach`, { conceptId: 'c2', explanation: 'There is gravity in space. Gravity keeps the Moon going around the Earth.' })).body;
    // Both common mistakes were already answered, so Pip has nothing to ask.
    expect(taught.questions).toHaveLength(0);

    await t.post(`/api/runs/${run.id}/ready`);
    const pipAnswers: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      const turn = (await t.post(`/api/runs/${run.id}/turn`)).body;
      if (turn.kind === 'student_answer') pipAnswers.push(turn.correct);
      if (turn.kind === 'help_me') {
        const answer = turn.question.type === 'true_false' ? { value: true } : { choiceIndex: 0 };
        await t.post(`/api/runs/${run.id}/help/${turn.eventId}`, { answer });
      }
      if (turn.kind === 'room_end') {
        expect(turn.passed).toBe(true);
        break;
      }
    }
    expect(pipAnswers.length).toBeGreaterThan(0);
    expect(pipAnswers.every(Boolean)).toBe(true);
  });

  it('leaves other dungeons at the server defaults', async () => {
    const { courseId } = (await t.post('/api/courses/seed/seasons')).body;
    const run = (await t.post('/api/runs', { courseId, targetGrade: 'B' })).body;
    expect(run.rules).toMatchObject({ roomQuestions: 5, bossQuestions: 10, maxStudentQuestions: 3 });
  });
});
