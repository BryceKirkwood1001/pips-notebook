import { describe, expect, it } from 'vitest';
import { correctAnswerOf } from '../src/core/grading';
import { startTestApp } from './helpers/app';
import { Bot } from './helpers/bot';

describe('edge cases over HTTP', () => {
  it('double submits: a second /help for one event and a second answer to one student question', async () => {
    const t = await startTestApp({ HELP_ME_PROB: '1', HELP_ME_MAX_PER_ROOM: '1' });
    try {
      const bot = new Bot(t);
      await bot.start();
      const taught = await t.post(`/api/runs/${bot.runId}/teach`, { explanation: 'Seasons come from the tilt of the axis. The tilt stays fixed.' });
      const open = taught.body.questions.find((q: any) => q.status === 'open');
      expect(open).toBeDefined();
      expect((await t.post(`/api/runs/${bot.runId}/questions/${open.id}/answer`, { answer: 'The tilt of the axis causes seasons.' })).status).toBe(200);
      const again = await t.post(`/api/runs/${bot.runId}/questions/${open.id}/answer`, { answer: 'again' });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ error: { code: 'question_not_open' } });
      expect((await t.post(`/api/runs/${bot.runId}/questions/${open.id}/skip`)).status).toBe(409);

      await t.post(`/api/runs/${bot.runId}/ready`);
      const dbg = (await t.get(`/api/runs/${bot.runId}/debug`)).body;
      const turn = await t.post(`/api/runs/${bot.runId}/turn`);
      expect(turn.body.kind).toBe('help_me');
      const key = correctAnswerOf(dbg.questions.find((q: any) => q.id === turn.body.question.id)).answer;
      const first = await t.post(`/api/runs/${bot.runId}/help/${turn.body.eventId}`, { answer: key });
      expect(first.status).toBe(200);
      expect(first.body.kind).toBe('help_result');
      const second = await t.post(`/api/runs/${bot.runId}/help/${turn.body.eventId}`, { answer: key });
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ error: { code: 'help_event_not_pending' } });
    } finally {
      await t.close();
    }
  });

  it('an expired "Help me!" followed by /turn resolves as late; a live one is returned again', async () => {
    const t = await startTestApp({ HELP_ME_PROB: '1', HELP_ME_MAX_PER_ROOM: '1' });
    try {
      const bot = new Bot(t);
      await bot.start();
      await bot.learn();
      const first = await t.post(`/api/runs/${bot.runId}/turn`);
      expect(first.body.kind).toBe('help_me');
      const same = await t.post(`/api/runs/${bot.runId}/turn`);
      expect(same.body).toMatchObject({ kind: 'help_me', eventId: first.body.eventId });
      t.clock.advance(first.body.timeBudgetSec + 10);
      const late = await t.post(`/api/runs/${bot.runId}/turn`);
      expect(late.body).toMatchObject({ kind: 'help_result', correct: false, late: true });
      expect(late.body.damage).toBeGreaterThan(0);
      expect((await t.get(`/api/runs/${bot.runId}`)).body.pendingHelpMe).toBeUndefined();
    } finally {
      await t.close();
    }
  });

  it('/turn after the fight has ended returns the same summary every time', async () => {
    const t = await startTestApp({ HELP_ME_PROB: '0' });
    try {
      const bot = new Bot(t);
      await bot.start();
      await bot.learn();
      const end = await bot.fight();
      expect((await t.post(`/api/runs/${bot.runId}/turn`)).body).toEqual(end);
      expect((await t.post(`/api/runs/${bot.runId}/turn`)).body).toEqual(end);
      expect((await t.get(`/api/runs/${bot.runId}`)).body.phase).toBe('room_result');
      await bot.finish();
      const x = await t.post(`/api/runs/${bot.runId}/turn`);
      const y = await t.post(`/api/runs/${bot.runId}/turn`);
      expect(x.body.kind).toBe('boss_end');
      expect(y.body).toEqual(x.body);
      expect((await t.get(`/api/runs/${bot.runId}/results`)).body).toEqual(x.body.results);
    } finally {
      await t.close();
    }
  });

  it('untimed mode: a help event has no deadline and a late answer is fine', async () => {
    const t = await startTestApp({ HELP_ME_PROB: '1', HELP_ME_TIMED: 'false', HELP_ME_MAX_PER_ROOM: '1' });
    try {
      const bot = new Bot(t);
      await bot.start();
      await bot.learn();
      const dbg = (await t.get(`/api/runs/${bot.runId}/debug`)).body;
      const ev = (await t.post(`/api/runs/${bot.runId}/turn`)).body;
      expect(ev).toMatchObject({ kind: 'help_me', deadline: null });
      t.clock.advance(100000);
      const key = correctAnswerOf(dbg.questions.find((q: any) => q.id === ev.question.id)).answer;
      const res = await t.post(`/api/runs/${bot.runId}/help/${ev.eventId}`, { answer: key });
      expect(res.body).toMatchObject({ kind: 'help_result', correct: true, late: false, damage: 0 });
    } finally {
      await t.close();
    }
  });
});
