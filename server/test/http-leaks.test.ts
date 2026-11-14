import { describe, expect, it } from 'vitest';
import { startTestApp } from './helpers/app';
import { Bot } from './helpers/bot';
import { findHiddenKeys } from './helpers/leaks';

describe('no hidden-field leakage', () => {
  it('a whole gauntlet never exposes a hidden key on any public endpoint', async () => {
    const t = await startTestApp({ HELP_ME_PROB: '0.5' });
    try {
      const bot = new Bot(t);
      await bot.start('seasons', 'B');
      const results = await bot.finish({ firstTeach: 'Seasons are a thing that happen sometimes.' });
      expect(results).toHaveProperty('predictedGradePct');
      const paths = new Set(bot.bodies.map((b) => b.path));
      for (const p of ['/courses/seed', '/courses/:id', '/runs', '/teach', '/ready', '/turn', '/continue', '/results']) {
        expect(paths.has(p), `endpoint ${p} was exercised`).toBe(true);
      }
      const leaks = bot.bodies.flatMap((b) => findHiddenKeys(b.body).map((k) => `${b.path} ${k}`));
      expect(leaks).toEqual([]);
    } finally {
      await t.close();
    }
  });

  it('answer, skip, help and retry responses are clean too', async () => {
    const t = await startTestApp({ HELP_ME_PROB: '1', HELP_ME_MAX_PER_ROOM: '1' });
    try {
      const bot = new Bot(t);
      await bot.start();
      await bot.learn({ text: 'Hmm okay then whatever happens.', skip: 'all' });
      await bot.fight();
      await bot.post('/retry');
      await bot.learn();
      await bot.fight();
      const seen = [...new Set(bot.bodies.map((b) => b.path))];
      expect(seen.some((p) => p.startsWith('/questions/'))).toBe(true);
      expect(seen.some((p) => p.startsWith('/help/'))).toBe(true);
      expect(seen).toContain('/retry');
      expect(bot.bodies.flatMap((b) => findHiddenKeys(b.body))).toEqual([]);
    } finally {
      await t.close();
    }
  });

  it('/debug is 404 with DEBUG=false and returns everything with DEBUG=true', async () => {
    const off = await startTestApp({ DEBUG: 'false' });
    try {
      const seeded = await off.post('/api/courses/seed/seasons');
      const run = await off.post('/api/runs', { courseId: seeded.body.courseId, targetGrade: 'B' });
      const r = await off.get(`/api/runs/${run.body.id}/debug`);
      expect(r.status).toBe(404);
      expect(findHiddenKeys(r.body)).toEqual([]);
    } finally {
      await off.close();
    }
    const on = await startTestApp({ DEBUG: 'true' });
    try {
      const bot = new Bot(on);
      await bot.start();
      const dbg = await bot.debug();
      expect(Object.keys(dbg)).toEqual(expect.arrayContaining(['run', 'pack', 'questions']));
      expect(findHiddenKeys(dbg).length).toBeGreaterThan(0);
      expect(dbg.run.hidden).toBeDefined();
    } finally {
      await on.close();
    }
  });
});
