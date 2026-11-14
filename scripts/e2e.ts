/**
 * End-to-end gauntlet with a "teacher bot". Drives the real API (in-process by default) with mocks.
 *
 *   npx tsx scripts/e2e.ts [--url http://localhost:8787] [--sample seasons]
 *   npm run e2e -- --capture-file docs/api-examples.json
 *
 * The bot reads the hidden course data from /debug ONLY to decide what to type, the way a teacher who
 * knows the subject would. Exits non-zero if any final assertion fails.
 */
import { ApiError, createApiClient, type PublicRun, type TurnResult } from '@top/shared/api-client';
import { buildApp } from '../server/src/app';
import { createContainer } from '../server/src/container';
import { correctAnswerOf, wrongAnswerFor } from '../server/src/core/grading';
import { FORBIDDEN_KEYS } from '../server/test/helpers/leaks';
import { coverage } from '../server/src/llm/mock-text';
import { writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const sample = flag('sample') ?? 'seasons';

const log = (s = '') => console.log(s);
const head = (s: string) => log(`\n=== ${s} ===`);

/** Every public response body, for the final leak scan. */
const bodies: unknown[] = [];
const seen = <T>(x: T): T => (bodies.push(x), x);

function findLeaks(v: unknown, path = '$'): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => findLeaks(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [
      ...((FORBIDDEN_KEYS as readonly string[]).includes(k) ? [`${path}.${k}`] : []),
      ...findLeaks(x, `${path}.${k}`),
    ]);
  }
  return [];
}

async function main() {
  let close = async () => {};
  let baseUrl = flag('url');
  if (!baseUrl) {
    const container = await createContainer({ env: { LLM_PROVIDER: 'mock', DEBUG: 'true' }, seed: 42 });
    const app = await buildApp(container);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    close = () => app.close();
    log(`Started an in-process server at ${baseUrl}`);
  }
  const captures = new Map<string, unknown>();
  const api = createApiClient({ baseUrl, fetch: async (input, init) => {
    const res = await fetch(input, init);
    if (!flag('capture-file')) return res;
    const pathname = new URL(String(input)).pathname;
    const route = pathname.replace(/\/runs\/[^/]+/, '/runs/:id')
      .replace(/\/questions\/[^/]+/, '/questions/:qid').replace(/\/help\/[^/]+/, '/help/:eventId')
      .replace(/\/courses\/seed\/[^/]+/, '/courses/seed/:sample').replace(/\/courses\/(?!seed)[^/]+/, '/courses/:id');
    let response = await res.clone().json() as any;
    const debug = route.endsWith('/debug');
    if (!debug) seen(response);
    if (debug) {
      response = {
        run: { id: response.run.id, phase: response.run.phase, hidden: response.run.hidden },
        pack: { id: response.pack.id, title: response.pack.title },
        questions: response.questions.slice(0, 1), stats: response.stats.slice(0, 1),
        timeBudgets: Object.fromEntries(Object.entries(response.timeBudgets).slice(0, 1)),
      };
    }
    const multipart = init?.body instanceof FormData;
    const request = typeof init?.body === 'string' ? JSON.parse(init.body) : multipart
      ? [...(init!.body as FormData).entries()].map(([field, value]) => ({ field, value: typeof value === 'string' ? value : { name: value.name, type: value.type, size: value.size } })) : undefined;
    const key = `${init?.method ?? 'GET'} ${route}${multipart ? ' multipart' : ''}${response.kind ? ` ${response.kind}` : ''}`;
    if (!captures.has(key)) captures.set(key, { method: init?.method ?? 'GET', route, path: pathname, status: res.status, request,
      ...(multipart ? { multipart: true } : {}), ...(debug ? { responseIsExcerpt: true } : {}), response });
    return res;
  } });
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
    if (!ok) failures.push(what);
  };

  try {
    // Fail early and clearly while the routes are still stubs.
    seen(await api.health());
    seen(await api.listSamples());
    head(`Seed "${sample}" and create a run (target B)`);
    const { courseId } = await api.seedCourse(sample);
    seen(await api.getCourse(courseId));
    if (flag('capture-file')) {
      const text = '# Seasons\n\nEarth has seasons because its axis is tilted.\n';
      seen(await api.createCourseFromText(text, 'API upload example'));
      seen(await api.uploadCourse([{ name: 'seasons.md', data: new Blob([text], { type: 'text/markdown' }) }], 'Multipart example'));
    }
    let run: PublicRun = seen(await api.createRun({ courseId, targetGrade: 'B' }));
    const runId = run.id;
    log(`course ${courseId}, run ${runId}, ${run.rooms.length} rooms`);

    const hidden = async () => (await api.getDebug(runId)) as any;
    let dbg = await hidden();
    const concept = (id: string) => dbg.pack.concepts.find((c: any) => c.id === id);
    const misconceptionOf = (id: string) => dbg.pack.concepts.flatMap((c: any) => c.misconceptions).find((m: any) => m.id === id);
    const roomStatements = (r: PublicRun) =>
      r.currentRoom!.concepts.flatMap((c) => concept(c.id).keyPoints.map((k: any) => k.statement as string));

    const printNotebook = (md: string) => log(md.trimEnd().split('\n').map((l) => '    ' + l).join('\n'));

    /** Rescue ordinary help events, but preserve the chosen wrong belief in the boss demonstration. */
    async function fight(label: string): Promise<TurnResult> {
      dbg = await hidden();
      for (let guard = 0; guard < 100; guard++) {
        const t = seen(await api.turn(runId));
        switch (t.kind) {
          case 'student_answer':
            log(`  ${t.correct ? 'ok ' : 'WRONG'} [${t.question.type}] ${t.question.prompt.slice(0, 60)} -> ${t.answerText}` +
              (t.reason ? ` (${t.reason})` : '') + (t.hearts !== undefined ? `  hearts ${t.hearts}` : `  health ${t.health?.toFixed(0)}`));
            break;
          case 'help_me': {
            const q = dbg.questions.find((x: any) => x.id === t.question.id);
            log(`  HELP ME! "${t.question.prompt.slice(0, 50)}" you have ${t.timeBudgetSec}s`);
            const targeted = dbg.run.phase === 'boss' && dbg.run.boss.targetedMap[q.id] === skippedMisconception;
            const answer = targeted ? wrongAnswerFor(q, skippedMisconception) : correctAnswerOf(q).answer;
            if (!answer) throw new Error('the targeted question needs a deterministic wrong-answer path');
            if (targeted) log('    demonstrating the skipped belief: the teacher gives its mapped wrong answer');
            const r = seen(await api.help(runId, t.eventId, answer));
            if (r.kind === 'help_result') log(`    you answered ${r.correct ? 'correctly' : 'wrong'}${r.noteAdded ? `; note: ${r.noteAdded}` : ''}`);
            break;
          }
          case 'room_end':
            log(`  ${label}: ${t.passed ? 'PASSED' : 'FAILED'} with ${t.hearts} hearts`);
            for (const f of t.failedTurns) log(`    why it failed: "${f.question.prompt.slice(0, 50)}" - ${f.reasoning} [cited: ${f.citedNotes.join(' | ') || 'nothing'}]`);
            return t;
          case 'boss_end':
            return t;
        }
      }
      throw new Error('fight did not end');
    }

    // ── Room 1, first attempt: one vague sentence ──
    head('Room 1, attempt 1: teaching one vague sentence');
    const vague = await api.teach(runId, 'Seasons are just a thing that happens every year.');
    seen(vague);
    printNotebook(vague.notebookMd);
    dbg = await hidden();
    const questionToSkip = vague.questions.find((q) => q.status === 'open');
    if (!questionToSkip) throw new Error('the first teaching must produce a question to skip');
    const skippedMisconception = dbg.run.learning.pendingQuestions.find((q: any) => q.id === questionToSkip.id).misconceptionId as string;
    seen(await api.skipQuestion(runId, questionToSkip.id));
    log(`  SKIPPED: "${questionToSkip.text}" (hidden: ${skippedMisconception}); other questions will be auto-skipped`);
    seen(await api.ready(runId));
    const firstEnd = await fight('room 1');
    const firstAttemptFailed = firstEnd.kind === 'room_end' && !firstEnd.passed;
    check(firstAttemptFailed, 'first attempt of room 1 failed');

    // ── Retry: teach properly, skip one question on purpose ──
    head('Room 1: retry, teaching the key points while keeping the deliberately skipped belief');
    run = seen(await api.retry(runId));
    async function learnRoom() {
      run = seen(await api.getRun(runId));
      dbg = await hidden();
      const corrections = run.currentRoom!.concepts.flatMap((c) => concept(c.id).misconceptions)
        .filter((m: any) => m.id !== skippedMisconception && dbg.run.hidden.misconceptions.some((s: any) => s.id === m.id && s.status === 'active'))
        .map((m: any) => m.correction as string);
      let statements = [...roomStatements(run), ...corrections];
      const keptBelief = misconceptionOf(skippedMisconception);
      if (run.currentRoom!.concepts.some((c) => c.id === keptBelief.conceptId)) {
        // The mock resolves by keyword coverage. Leave this one gap in the otherwise useful lesson.
        while (statements.length > 0 && coverage(keptBelief.correction, statements.join('\n')) >= 0.6) {
          const choices = statements.map((_, i) => statements.filter((_, j) => i !== j));
          choices.sort((a, b) => coverage(keptBelief.correction, a.join('\n')) - coverage(keptBelief.correction, b.join('\n')));
          statements = choices[0];
        }
      }
      const text = statements.join('\n');
      log(`  teaching: ${text.slice(0, 120)}...`);
      const taught = seen(await api.teach(runId, text));
      dbg = await hidden();
      for (const q of taught.questions.filter((x) => x.status === 'open')) {
        const hid = dbg.run.learning.pendingQuestions.find((p: any) => p.id === q.id);
        const m = misconceptionOf(hid.misconceptionId);
        const r = seen(await api.answerQuestion(runId, q.id, m.correction));
        log(`  answered: "${q.text}" -> ${r.resolved ? 'resolved' : 'not resolved'}`);
      }
      const after = seen(await api.getRun(runId));
      printNotebook(after.notebookMd);
      seen(await api.ready(runId));
    }
    await learnRoom();
    const retryEnd = await fight('room 1 retry');
    check(retryEnd.kind === 'room_end' && retryEnd.passed, 'the retry of room 1 passed');
    run = seen(await api.continueRun(runId));

    // ── Later rooms ──
    for (let attempts = 0; run.phase === 'learning'; attempts++) {
      if (attempts >= 30) throw new Error('room retries exceeded the e2e safety limit');
      head(`Room ${run.roomIndex + 1}: ${run.currentRoom!.title}`);
      await learnRoom();
      const end = await fight(`room ${run.roomIndex + 1}`);
      if (end.kind !== 'room_end') break;
      run = seen(end.passed ? await api.continueRun(runId) : await api.retry(runId));
    }

    // ── Boss ──
    head('Boss / exam');
    run = seen(await api.getRun(runId));
    if (run.phase === 'boss') await fight('boss');
    const results = seen(await api.getResults(runId));
    run = seen(await api.getRun(runId));

    head('Results');
    log(`  predicted grade: ${results.predictedGradePct}% (${results.letter}), target ${results.target}, ${results.metTarget ? 'target met' : 'target missed'}`);
    for (const c of results.conceptAccuracy) log(`  ${c.title}: ${c.correct}/${c.total}`);
    log(`  Help me: ${JSON.stringify(results.helpMe)}`);
    for (const c of results.costlyMisconceptions) {
      log(`  COSTLY: ${c.description}\n     believed: ${c.beliefStatement}\n     actually: ${c.correction}\n     see: page ${c.materialRef.page} ${c.materialRef.sectionPath.join(' > ')}`);
    }

    head('Assertions');
    check(skippedMisconception !== undefined, 'a student question was skipped on purpose');
    check(results.costlyMisconceptions.some((c) => c.id === skippedMisconception), `the skipped misconception (${skippedMisconception}) is in results.costlyMisconceptions`);
    const leaks = bodies.flatMap((b) => findLeaks(b));
    check(leaks.length === 0, `no response contained a hidden key${leaks.length ? ': ' + leaks.slice(0, 5).join(', ') : ''}`);
    check(run.phase === 'results', 'the run ended in phase results');
    if (flag('results-file')) await writeFile(flag('results-file')!, JSON.stringify(results, null, 2) + '\n');
    if (flag('capture-file')) {
      // The good lessons can cover every probe already. Use a separate run to capture an explicit answer.
      const extra = await api.createRun({ courseId, targetGrade: 'B' });
      const lesson = await api.teach(extra.id, 'This topic is something we study.');
      const debug = await api.getDebug(extra.id) as any;
      const open = lesson.questions.find((q) => q.status === 'open');
      if (!open) throw new Error('API capture needs an open student question');
      const id = debug.run.learning.pendingQuestions.find((q: any) => q.id === open.id).misconceptionId;
      const m = debug.pack.concepts.flatMap((c: any) => c.misconceptions).find((m: any) => m.id === id);
      await api.answerQuestion(extra.id, open.id, m.correction);
      try {
        await api.turn(extra.id);
        throw new Error('turn in learning should fail');
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
      }
      check(bodies.flatMap((b) => findLeaks(b)).length === 0, 'capture-only public responses contain no hidden keys');
      await writeFile(flag('capture-file')!, JSON.stringify({ sample, provider: 'mock', examples: [...captures.values()] }, null, 2) + '\n');
    }
  } catch (err) {
    const msg = err instanceof ApiError ? `API error ${err.status} ${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
    failures.push(msg);
    console.error(`\nE2E could not finish: ${msg}`);
    if (err instanceof ApiError && err.code === 'not_implemented') console.error('The routes are still stubs: wait for integration.');
  } finally {
    await close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} problem(s):\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  log('\nAll end-to-end assertions passed.');
}

main();
