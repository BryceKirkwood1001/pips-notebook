/** Engine-level test environment and play helpers. */
import type { Run, TurnResult } from '@top/shared';
import { testConfig, type Config } from '../../src/config';
import { correctAnswerOf } from '../../src/core/grading';
import { createRng, type Rng } from '../../src/core/rng';
import { engine } from '../../src/engine';
import type { CreateRunInput, EngineContext, EngineDeps } from '../../src/engine/types';
import { COURSE_ID, fixtureCoursePack, fixtureQuestions } from './fixtures';
import { createScriptedTasks, createTestClock, fakeRetriever, type ScriptedTasks, type TestClock } from './fakes';

export interface Env {
  deps: EngineDeps;
  ctx: EngineContext;
  tasks: ScriptedTasks;
  clock: TestClock;
  config: Config;
}

export function makeEnv(o: { config?: Partial<Config>; ctx?: EngineContext; rng?: Rng; script?: Parameters<typeof createScriptedTasks>[0]; seed?: number } = {}): Env {
  // No "Help me!" unless a test asks for it.
  const config = testConfig({ helpMeProb: 0, ...o.config });
  const tasks = createScriptedTasks(o.script);
  const clock = createTestClock();
  const ctx = o.ctx ?? { pack: fixtureCoursePack(), questions: fixtureQuestions() };
  const deps: EngineDeps = { config, tasks, retriever: fakeRetriever, rng: o.rng ?? createRng(o.seed ?? 1), clock };
  return { deps, ctx, tasks, clock, config };
}

export const newRun = (env: Env, input: Partial<CreateRunInput> = {}): Run =>
  engine.createRun(env.deps, env.ctx, { courseId: COURSE_ID, targetGrade: 'B', rngSeed: 1, ...input });

export const EXPLAIN = 'Concept notes are written here. The explanation covers the main idea.';

export async function teach(env: Env, run: Run, text = EXPLAIN) {
  return engine.teach(env.deps, env.ctx, run, text);
}

/** The player's correct answer for a public question id (from the hidden course data). */
export const keyFor = (env: Env, questionId: string) => correctAnswerOf(env.ctx.questions.find((q) => q.id === questionId)!).answer;

/** Plays turns until the fight ends. A "Help me!" event is answered correctly. */
export async function playFight(env: Env, run: Run): Promise<{ run: Run; turns: TurnResult[] }> {
  const turns: TurnResult[] = [];
  for (let i = 0; i < 200; i++) {
    const out = await engine.takeTurn(env.deps, env.ctx, run);
    run = out.run;
    turns.push(out.result);
    if (out.result.kind === 'help_me') {
      const h = await engine.submitHelp(env.deps, env.ctx, run, out.result.eventId, keyFor(env, out.result.question.id));
      run = h.run;
      turns.push(h.result);
      if ('phaseAfter' in h.result && (h.result.phaseAfter === 'room_result' || h.result.phaseAfter === 'results')) break;
      continue;
    }
    if ('phaseAfter' in out.result && (out.result.phaseAfter === 'room_result' || out.result.phaseAfter === 'results')) break;
  }
  return { run, turns };
}

/** teach -> ready -> fight -> continue. Expects the room to pass. */
export async function passRoom(env: Env, run: Run, text = EXPLAIN): Promise<Run> {
  run = (await teach(env, run, text)).run;
  run = engine.startRoom(env.deps, env.ctx, run).run;
  run = (await playFight(env, run)).run;
  if (run.room?.passed !== true) throw new Error('room did not pass in passRoom');
  return engine.continueRun(env.deps, env.ctx, run).run;
}

/** Passes every room in scope; the run is then in phase 'boss'. */
export async function toBoss(env: Env, run: Run): Promise<Run> {
  for (let i = run.roomIndex; i < run.scope.roomIds.length; i++) run = await passRoom(env, run);
  return run;
}

/** Skips every open student question of the current learning phase. */
export function skipAll(env: Env, run: Run): Run {
  for (const q of run.learning.pendingQuestions.filter((x) => x.status === 'open')) {
    run = engine.skipQuestion(env.deps, env.ctx, run, q.id).run;
  }
  return run;
}
