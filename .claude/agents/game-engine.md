---
name: game-engine
description: Builds the Pip's Notebook game engine (a pure state machine for the learning phase, room fights, "Help me!" events, boss and results, plus public projections) and the in-memory and MongoDB repositories. Use for server/src/engine and server/src/repo.
tools: Read, Write, Edit, Bash, Glob, Grep
---

# game-engine

**First read `.claude/agent-rules.md` and follow it.** Then read, in this order:

- `docs/SPEC.md` sections 2 (all of it: this is the game you are implementing), 4.2, 4.3 and 6
- `server/src/engine/types.ts` (your contract. Its header comment fixes every rule the spec left open: the phase machine, the notebook format, learning, room, turn, boss and results rules. Implement it literally.)
- `server/src/repo/types.ts` (the storage contract)
- `shared/src/schemas.ts` (`Run`, `TurnResult`, `PublicRun`, `PublicQuestion`, `Results`, `Question`, `CoursePack`)
- `server/src/core/grading.ts`, `server/src/core/timeBudget.ts`, `server/src/core/rng.ts` (use these; do not reimplement grading or the RNG)
- `server/src/llm/types.ts` (`GameplayTasks`, `StudentOracle`) and `server/src/rag/types.ts` (`Retriever`)
- `server/src/config.ts`, `server/src/errors.ts`

## You own

- `server/src/engine/**` except `server/src/engine/types.ts`
- `server/src/repo/**` except `server/src/repo/types.ts`

## Mission

### 1. The engine: `server/src/engine/`

A pure, testable state machine. No HTTP, no storage, no globals, no `Date.now()` or `Math.random()`: time comes from `deps.clock` and randomness from `deps.rng`. Every function returns a **new** run and never mutates its input (`structuredClone` at the top is fine). Set `run.updatedAt` from the clock on every change. Export `engine: Engine`, `toPublicRun`, `toPublicQuestion`, `parseNotebook` and `notebookLines` from `server/src/engine/index.ts`.

Suggested files: `notebook.ts`, `misconceptions.ts`, `learning.ts`, `draw.ts` (room draws and boss composition), `fight.ts` (turns, "Help me!", grounding), `results.ts`, `public.ts`, `index.ts`.

Points that need care:

- **Grounding rule (SPEC 5).** A student answer counts as correct only if it is correct by `gradeDeterministic` (or `gradeOpen` for `needs_llm`) **and** at least one cited note fuzzy-matches a notebook bullet. Fuzzy match, after `normalizeText` from core/grading.ts on both sides: equal, or one contains the other and the shorter one has at least 12 characters, or at least 80% of the cited note's words appear in the bullet. Export this as `citationMatches(citedNote, notebookMd)`.
- **The student sees only its notebook.** Call `tasks.studentAnswer({ notebookMd, question: toPublicQuestion(q) }, oracle)`. The first argument must contain nothing else. The `oracle` (the full question, the course's misconceptions, the active ids) is a mock-only side channel described in `server/src/llm/types.ts`: always pass it.
- If the student's answer does not fit the question type (`answerFitsQuestion` is false), treat it as "I don't know".
- **Retrieval** for `checkResolution` and `gradeOpen`: `deps.retriever.retrieve({ courseId, query, conceptIds })`. If retrieval throws, continue with no evidence.
- **"Help me!"**: the server checks the deadline with `deps.clock`. `solveTimeSec` is the time from `startedAt` to the submit. Keep `run.helpMeTally` up to date (offered, correct, wrong, late, solve times) and derive `results.helpMe` from it.
- **Stats events**: `student_correct` or `student_wrong` for every student answer, and `help_solve` with the solve time for every correct "Help me!" answer.
- **Logs** (`room.log`, `boss.log`) hold public `TurnResult`s only. A `help_me` entry is logged when the event starts and a `help_result` when it is answered.
- **`toPublicRun` must not leak hidden data (SPEC 4.3).** Build the public object field by field (never spread the run). No `hidden`, no `misconceptionId` on student questions, no question ids of upcoming questions, no `targetedMap`, no RNG seed or state. Unanswered questions appear only through `toPublicQuestion`. `rooms[].ready` is true when all of the room's concepts are in `pack.status.conceptsReady`. `rules` comes from the config.
- **`ROOM_DAMAGE_CARRIES_OVER`** is a bookmarked option: leave a clearly marked comment where it would apply, and do not implement it.
- **`ready` and `createRun`** throw `room_not_ready` (425) when the room's concepts are not all ready or when the room's pool has no questions.

### 2. Repositories: `server/src/repo/`

Export `createMemoryRepository()` and `createMongoRepository(db)` from `server/src/repo/index.ts`.

- Memory: Maps, returning deep copies (`structuredClone`) on read and storing copies on write.
- Mongo (`mongodb` 7.9 is installed: check its types): collections `courses`, `questions`, `questionStats` and `runs`, with `_id` set to the entity id and stripped on read. `init()` creates an index on `questions.courseId`. `recordStats` uses `$inc` and `$push` with upsert. You can't run this live (no URI here): keep it small and obviously correct, and unit-test it with a minimal fake `Db` if that is cheap.

### 3. Test fixtures

Write builders in `server/src/engine/testing/fixtures.ts`: a small hand-made pack (2 rooms, 3 concepts with one room holding 2 concepts, 2 misconceptions per concept) and around 30 questions covering every question type, with misconception mappings and several multi-concept questions; a scripted fake `GameplayTasks`; a fake `Retriever`; a fixed clock you can advance. Other people will reuse these, so keep them tidy.

## Tests (`server/src/engine/**/*.test.ts`, `server/src/repo/**/*.test.ts`)

- Learning: notes are added under the right section; a stated misconception becomes active with its belief line; skipping makes it active with origin `skipped` and writes the belief line; a good answer resolves it and adds the corrective note; a bad answer behaves like a skip; re-teaching resolves an active misconception and replaces its belief line; open questions are auto-skipped on ready; a misconception is never probed twice; invented ids are dropped.
- Room: the draw has no repeats and prefers unseen questions on retry; hearts reset on retry; a wrong answer costs one heart; fail at 0 hearts and pass otherwise; `room_end` carries the reasoning trace and is idempotent; the notebook is kept on retry.
- Grounding: a right answer with no valid citation is wrong with `not in my notes`; the three `reason` values.
- "Help me!": probability 0 and 1 through the RNG; the caps per room and per boss; never for `free_response`; correct (no damage, the `Teacher showed me:` note, a stats event), wrong, late, untimed (`deadline: null`); `/turn` while pending; a stale event id.
- Boss: `k` targeted questions when misconceptions are active; every concept covered; multi-concept preference; health math with 10 and with 6 questions; `boss_end` is idempotent.
- Results: letters and thresholds at the boundaries; `metTarget`; per-concept accuracy; `costlyMisconceptions` lists an active misconception whose targeted question was answered wrong, with its material reference, and does not list resolved ones.
- Phase guards: every action in every wrong phase throws `wrong_phase`.
- Public projection: a recursive scan of `toPublicRun` output in every phase finds none of the hidden keys (`hidden`, `misconceptionId`, `misconceptionIds`, `correctIndex`, `correctIndexes`, `correctValue`, `acceptedAnswers`, `wrongAnswers`, `wrongOrders`, `correctOrder`, `wrongMisconceptionId`, `solution`, `workedSteps`, `rubric`, `modelAnswer`, `targetedMap`, `rngSeed`, `rngState`).
- Determinism: the same seed and the same inputs give the same run.
- Repositories: round trips, copies not references, `verifiedOnly`, stats increments.

## Acceptance

- `npx vitest run server/src/engine server/src/repo` passes.
- No type errors in your paths.
