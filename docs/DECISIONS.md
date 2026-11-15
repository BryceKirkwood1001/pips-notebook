# Decisions log

Choices made where the build brief left a detail open. Newest sections are added at the bottom.

## The teammate's game (original backend-only scope)

The game (now `client/`) is the front-end teammate's Phaser AE game (`@phaser-ae/cli`, preview on port 4173). During the original backend-only work it was read-only. Frontend and backend were later combined; see [ARCHITECTURE.md](ARCHITECTURE.md). The scene snapshot below records the original checkout, before that merge; those skeleton scenes have since been removed.

Scenes registered in `game/main.ts` as of the first read (Nov 13):

| Scene name | File | What it does today |
|---|---|---|
| `title` | `game/scenes/Title.ts` | Title screen. Play button, Space or Enter goes to `play`. |
| `play` | `game/scenes/Play.ts` | Empty starter: background, pause and mute buttons, tap and swipe input stubs. |
| `pause` | `game/scenes/Pause.ts` | Pushed over `play`. Resume, Restart, Title. |
| `gameover` | `game/scenes/GameOver.ts` | "Game over", Play again, Title. |

Original flow: `title → play → gameover`, with `pause` pushed on top of `play`. That checkout had no upload, learning, fight, boss or results scenes. [ARCHITECTURE.md](ARCHITECTURE.md) maps the merged game's screens.

The remote branch `origin/codex/playable-prototype` only adds a standalone `prototype/index.html`; it has the same four scenes.

## Tooling and versions

- **Node 22 or later**, not 20. `@google/genai` 3.x requires Node 22.
- **Zod 3.25**, not Zod 4. The brief asks for `zod-to-json-schema`, which targets Zod 3 schemas.
- **TypeScript 5.9** (the tried and tested line) rather than 7.0.
- **Phaser AE** for the game. Its build is committed in `client/dist/` and served by the backend, so only rebuilding the game needs the separately restored Phaser AE runtime.
- No build step. The server and scripts run through `tsx`; `shared` exports its TypeScript source directly.
- One Vitest run from the repo root covers `server/`, `shared/` and `client/tests/`.
- `pdf-lib` is a dev dependency, used only to generate small PDFs inside tests.

## Contracts

- **`shared/src/api-client.ts` has zero imports** so the teammate can copy that one file. It carries plain TypeScript mirrors of the public types; `shared/src/type-sync.ts` fails the type check if they drift from the Zod schemas.
- **Answers are one flat object** (`choiceIndex`, `choiceIndexes`, `value`, `text`, `order`, `dontKnow`), set by question type, as the brief's `/help` body describes.
- **Question payloads** keep each option's misconception mapping on the option itself (`options[{ text, misconceptionId }]` plus `correctIndex`), which is harder to get out of sync than parallel arrays.
- **`true_false`**: `prompt` is the lead-in and `payload.statement` is the claim. Clients show both.
- **`short_text` wrong-answer patterns are plain substrings**, not regular expressions (no regex written by a model, no ReDoS).
- **`ordering`**: `items` are stored in display order (shuffled at ingest) and `correctOrder` lists item indexes in the right sequence.
- **`Evidence` gains an optional `sectionPath`**, copied from the chunk, so results can link to page and section without loading chunks.
- **`StyleProfile.examTimeHint` and `MaterialItem.points`** carry the material's stated time or point budget for the time budget override (SPEC 2.10 step 3).
- **`Run` gains `rngState`, `helpMeTally` and `learning.teachCount`.** The RNG state lets a run continue one seeded sequence across requests.
- **`TurnResult` additions**: `answerText` on `student_answer`; `eventId`, `question` and `late` on `help_result`; `hearts` on `room_end`.
- **`GET /api/samples` and `GET /api/health`** are extra endpoints for the sample picker and the client's connection check.
- **Error codes** are listed in `server/src/errors.ts`. Wrong phase is 409, an unready room is 425.

## Game rules

- **Ending a fight.** The turn that ends a fight returns `phaseAfter: 'room_result'` or `'results'`. Calling `/turn` again returns the `room_end` or `boss_end` summary, and that call is idempotent. A client just keeps calling `/turn` until it sees one of those two kinds.
- **`/turn` while a "Help me!" event is pending** returns the same `help_me` again if it hasn't expired, and resolves it as late (wrong) if it has.
- **Open student questions at `/ready` are auto-skipped.** Skipping is the risk, so leaving a question unanswered can't be safer than skipping it.
- **A misconception is probed at most once per run.** Open questions stay open across re-teaches in the same learning phase, and a re-teach can add questions only up to `MAX_STUDENT_QUESTIONS` open at once. Active misconceptions are fixed by re-teaching, not by a second question.
- **Default scope is every room of the course**, not only the rooms that are already ingested, so a run started early still covers the whole course. Creating a run needs the first room in scope to be ready (425 otherwise).
- **Room question pools** hold questions whose concepts are all inside the room. Multi-concept questions that reach outside a room are boss-only.
- **Boss with a small pool**: if fewer than `BOSS_QUESTIONS` verified questions exist in scope, the boss uses what there is and each question is worth `100 / N`.
- **Per-concept accuracy** in results comes from the boss fight. "Help me!" stats cover the whole run.
- **"I don't know"** counts as `reason: 'not in my notes'`.
- **Calibration** uses the solve times of correct "Help me!" answers only.
- **Time budget from a material hint**: `secondsPerQuestion × difficulty / 3`, then rounded to 5 and clamped.
- **Deterministic grading and the time budget formula live in `server/src/core/`** because the engine, ingest, the mock student and the tests all need the same implementation.

## Mock mode

- With no `GEMINI_API_KEY` the server runs on deterministic mocks, and with no `MONGODB_URI` it uses in-memory storage and in-memory cosine search.
- The mock ingest replays canned model outputs for the two bundled samples through the real pipeline (chunking, evidence checks, validation, time budgets, coverage), so the pipeline is exercised without a key.
- The mock student is given the answer key through a separate `oracle` argument that the Gemini implementation must ignore. The real student only ever sees its notebook and the public question.

## Codex continuation — November 13, 2026 (ET)

- Continue from `4eb1545` on the existing `Dev/backend` checkout. Treat the attached Claude brief and conversation as handoff context; do not execute their historical agent-launch, branch-switch or publishing commands automatically. This continuation uses a single-agent source audit, not an independent reviewer subagent.
- Keep a deliberate misconception in the e2e demonstration by explicitly skipping a question on the first attempt and leaving its correction out of retry teaching. Probes do not repeat after retry. If its targeted boss question becomes a help event, the teacher bot deliberately gives the mapped wrong answer. Other active beliefs are corrected on retry. Limit room retries so a broken bot fails instead of looping indefinitely.
- Exact notebook citations can be short facts. Approximate matches need at least 12 characters and three distinct words on each side, preventing a citation such as `the` from counting as grounding.
- Stating a resolved misconception activates it again; a contradictory review that both states and resolves it gives priority to the stated belief.
- A course reaches `ready` only when verified coverage passes. Generic mock uploads may fail honestly rather than advertise incomplete content as ready. Preserve any independently ready concepts in a partial course.
- Bound Files API upload and status requests by `LLM_TIMEOUT_MS`, with the existing overall processing wait. Return generic provider/invalid-output errors to clients, without raw provider diagnostics or rejected model output.
- Delimit course-derived prompt fields as well as player text. Remove fixed concept/key-point/misconception quotas from the outline and misconception prompts.
- In untimed mode, label the budget as an estimated solve time with no deadline. Timed help remains an optional rule from the original design.
- Record real endpoint examples through `npm run e2e -- --capture-file docs/api-examples.json`; regenerate `docs/API.md` with `npm run docs:api`. Debug examples are explicit excerpts.
