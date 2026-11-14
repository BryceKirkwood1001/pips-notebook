/**
 * Game engine contract (SPEC 2.2-2.8, 4.3). Owner: game-engine (server/src/engine/**).
 *
 * The engine is a pure, testable state machine: no HTTP, no storage, no globals. Every function
 * takes the run plus its dependencies and returns a NEW run (never mutate the input). The service
 * layer loads the run, calls one engine function, saves the returned run and records the stats.
 *
 * EXPORTS other modules import from `server/src/engine/index.ts` (exact names):
 *   export const engine: Engine
 *   export { toPublicRun, toPublicQuestion }          // also available as engine.toPublicRun, ...
 *   notebook helpers: parseNotebook, notebookLines     // see NotebookHelpers below
 *
 * ERRORS: throw `AppError` from server/src/errors.ts.
 *   wrong_phase (409)            the action is not allowed in `run.phase`
 *   help_pending (409)           teach/ready/retry/continue while a "Help me!" event is pending
 *   help_event_not_pending (409) /help with an event id that is not the pending one
 *   question_not_open (409)      answering or skipping a student question that is not open
 *   not_found (404)              unknown student-question id, unknown room id in scope
 *   invalid_answer (400)         a "Help me!" answer that does not fit the question type
 *   room_not_ready (425)         the room's concepts are not all in pack.status.conceptsReady
 *
 * ── Phase machine ───────────────────────────────────────────────────────────
 *
 *   learning ──ready──▶ room ──(last turn)──▶ room_result ──retry (failed)────▶ learning (same room)
 *                                                  └──────continue (passed)──▶ learning (next room)
 *                                                                          └─▶ boss (after the last room)
 *   boss ──(last turn)──▶ results
 *
 *   Action        Allowed phases                  Notes
 *   teach         learning
 *   answer/skip   learning                        the student question must be 'open'
 *   ready         learning                        still-open questions are auto-skipped first
 *   turn          room, room_result, boss, results
 *   help          room, boss                      only for the pending event id
 *   retry         room_result with passed=false
 *   continue      room_result with passed=true
 *   results       results
 *
 * ── Notebook (SPEC 2.2) ─────────────────────────────────────────────────────
 *   "# Notebook\n" then one "## <Concept title>" section per concept in scope, created lazily the
 *   first time a note is added, in scope order. Notes are "- <text>" bullets, one line each. A
 *   misconception's belief is written as an ordinary note: exactly `- ${beliefStatement}`, no label.
 *   Resolving replaces that line with `- ${correction}` (or appends the corrective note when the
 *   belief line is not there). Never add a duplicate line to a section.
 *
 * ── Learning phase (SPEC 2.3) ───────────────────────────────────────────────
 *   teach: one `tasks.studentReview` call for the room's concepts.
 *     - notesToAdd -> notebook (only for concepts of the current room; ignore others)
 *     - statedMisconceptionIds -> active, origin 'stated', belief line written
 *     - resolvedMisconceptionIds (must currently be active, and belong to the room) -> resolved,
 *       belief line replaced by the correction
 *     - questions -> appended to learning.pendingQuestions as 'open'. A misconception is probeable
 *       only if it has no hidden state entry and was never asked in this run. Open questions stay
 *       open across re-teaches; `maxQuestions` = MAX_STUDENT_QUESTIONS minus the open ones.
 *     - ids the model invents (unknown, wrong room, not probeable) are silently dropped.
 *   answer: `tasks.checkResolution` grounded by `retriever.retrieve`. Resolved -> state 'resolved'
 *     and the corrective note is added. Not resolved -> exactly like a skip. Status -> 'answered'.
 *   skip: state 'active' with origin 'skipped'; the belief line is written. Status -> 'skipped'.
 *   ready: auto-skips open questions, draws the room's questions, phase -> 'room'.
 *   On entering a new room's learning phase, pendingQuestions is cleared and teachCount reset.
 *
 * ── Room fight (SPEC 2.4) ───────────────────────────────────────────────────
 *   Pool = verified questions whose conceptIds are ALL in the room's concepts (no multi-concept
 *   questions that reach outside the room). Draw min(ROOM_QUESTIONS, pool size) with the RNG, no
 *   repeats within an attempt, preferring ids not in `room.seenQuestionIds`. Hearts = ROOM_HEARTS,
 *   reset on every attempt (Option B). A wrong answer costs 1 heart. The fight ends when hearts hit
 *   0 (failed) or all questions are played (passed). Mini rooms never affect the grade.
 *
 * ── Turn (rooms and boss) ───────────────────────────────────────────────────
 *   takeTurn in phase room/boss:
 *     1. If a "Help me!" event is pending: not expired -> return the same `help_me` again;
 *        expired -> resolve it as late (a `help_result` with correct=false, late=true, damage).
 *     2. Otherwise roll for "Help me!" (SPEC 2.5): `rng.next() < HELP_ME_PROB`, under the per-room /
 *        per-boss cap, and never for a free_response question. On a hit: set `run.pendingHelpMe`,
 *        log and return `help_me` with deadline = now + timeBudgetSec × HELP_ME_TIME_MULTIPLIER
 *        (null when HELP_ME_TIMED=false). `timeBudgetSec` in the event is the multiplied, rounded value.
 *     3. Otherwise the student answers: `tasks.studentAnswer({ notebookMd, question: public }, oracle)`,
 *        graded with core/grading.ts (`needs_llm` -> `tasks.gradeOpen`), then the GROUNDING RULE:
 *        correct only if at least one cited note fuzzy-matches a notebook bullet; a right answer
 *        with no valid citation is wrong with reason 'not in my notes'.
 *        reason: dontKnow or ungrounded -> 'not in my notes'; a wrong answer that followed a
 *        misconception path -> 'wrong belief'; any other wrong answer -> 'unknown'.
 *   takeTurn in phase room_result -> `room_end` (idempotent, no state change).
 *   takeTurn in phase results     -> `boss_end` (idempotent, no state change).
 *   The turn that ends a fight sets phaseAfter to 'room_result' / 'results'.
 *
 *   submitHelp: grade the player's answer with core/grading.ts (`needs_llm` -> gradeOpen).
 *     Late (now > deadline) -> wrong regardless of the answer. Correct -> no damage and the note
 *     `Teacher showed me: <correct answer text>` under the question's first concept; emit a
 *     'help_solve' stats event with the solve time. Wrong or late -> same damage as a wrong student answer.
 *
 * ── Boss (SPEC 2.6) ─────────────────────────────────────────────────────────
 *   Composed in `continueRun` when the last room is passed. Pool = verified questions whose
 *   conceptIds are all inside the scope's concepts. N = min(BOSS_QUESTIONS, pool size).
 *     k = min(#active misconceptions in scope, floor(N × BOSS_TARGETED_SHARE))
 *     For k active misconceptions (highest likelihood first), pick a question that targets it
 *     (core/grading.ts `targetsMisconception`); record it in `boss.targetedMap`.
 *     Fill the rest preferring multi-concept questions and making sure every concept in scope
 *     appears at least once where possible. Shuffle.
 *   Health starts at 100; each wrong answer costs 100 / N. Final grade = round(health).
 *
 * ── Results (SPEC 2.7, 2.8) ─────────────────────────────────────────────────
 *   letter: the highest grade whose threshold <= predictedGradePct, else 'F'.
 *   metTarget: predictedGradePct >= threshold of the target grade.
 *   costlyMisconceptions: each misconception still ACTIVE at the end whose targeted boss question
 *   (boss.targetedMap) was answered wrong (by the student or by a failed "Help me!").
 */
import type {
  Answer,
  CoursePack,
  CreateRunBody,
  PublicQuestion,
  PublicRun,
  PublicStudentQuestion,
  Question,
  Results,
  Run,
  TurnResult,
} from '@top/shared';
import type { Config } from '../config';
import type { Rng } from '../core/rng';
import type { GameplayTasks } from '../llm/types';
import type { Retriever } from '../rag/types';
import type { StatsEvent } from '../repo/types';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Injected into every engine call. */
export interface EngineDeps {
  config: Config;
  tasks: GameplayTasks;
  retriever: Retriever;
  /** Seeded from `run.rngState` by the service, which also stores `rng.state()` back afterwards. */
  rng: Rng;
  clock: Clock;
}

/** The course data for one call. */
export interface EngineContext {
  pack: CoursePack;
  /** Verified questions of the course, with `timeBudgetSec` already calibrated from play stats. */
  questions: Question[];
}

export interface CreateRunInput extends CreateRunBody {
  /** Default: `run_${crypto.randomUUID()}`. */
  id?: string;
  /** Default: a random 32-bit seed. Tests pass a fixed one. */
  rngSeed?: number;
}

export interface TurnOutcome {
  run: Run;
  result: TurnResult;
  /** What to record in QuestionStats. */
  stats: StatsEvent[];
}

export interface Engine {
  /**
   * A new run in phase 'learning' at room 0 with an empty notebook ("# Notebook\n").
   * Scope defaults to every room of the pack, in room order. Unknown room ids -> not_found.
   * Throws room_not_ready (425) when the first room in scope is not ready.
   */
  createRun(deps: EngineDeps, ctx: EngineContext, input: CreateRunInput): Run;

  teach(
    deps: EngineDeps,
    ctx: EngineContext,
    run: Run,
    explanation: string,
  ): Promise<{ run: Run; questions: PublicStudentQuestion[] }>;

  answerQuestion(
    deps: EngineDeps,
    ctx: EngineContext,
    run: Run,
    studentQuestionId: string,
    answer: string,
  ): Promise<{ run: Run; resolved: boolean }>;

  skipQuestion(deps: EngineDeps, ctx: EngineContext, run: Run, studentQuestionId: string): { run: Run };

  /** POST /ready: learning -> room. */
  startRoom(deps: EngineDeps, ctx: EngineContext, run: Run): { run: Run };

  /** POST /turn. */
  takeTurn(deps: EngineDeps, ctx: EngineContext, run: Run): Promise<TurnOutcome>;

  /** POST /help/:eventId. */
  submitHelp(deps: EngineDeps, ctx: EngineContext, run: Run, eventId: string, answer: Answer): Promise<TurnOutcome>;

  /** POST /retry: failed room_result -> learning for the same room, notebook kept. */
  retryRoom(deps: EngineDeps, ctx: EngineContext, run: Run): { run: Run };

  /** POST /continue: passed room_result -> next room's learning, or boss after the last room. */
  continueRun(deps: EngineDeps, ctx: EngineContext, run: Run): { run: Run };

  /** GET /results. Throws wrong_phase unless the run is in 'results'. */
  getResults(run: Run): Results;

  /** The ONLY way a run leaves the server. Must not leak any hidden field (SPEC 4.3). */
  toPublicRun(run: Run, ctx: EngineContext, config: Config): PublicRun;

  /** The ONLY way an unanswered question leaves the server. */
  toPublicQuestion(question: Question): PublicQuestion;
}

/** Signatures of the notebook helpers exported from `server/src/engine/index.ts`. */
export interface NotebookHelpers {
  /** Sections in document order. `notes` are bullet texts without the "- " prefix. */
  parseNotebook(notebookMd: string): { title: string; notes: string[] }[];
  /** Every bullet text in the notebook, without the "- " prefix. */
  notebookLines(notebookMd: string): string[];
}
