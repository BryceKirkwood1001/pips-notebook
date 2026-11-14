# Architecture

How the game, the server and the shared contracts fit together, how to run and rebuild them, and how the game talks
to the API. For the rules of play see [SPEC.md](SPEC.md); for every endpoint with a real request and response see
[API.md](API.md); for which action is allowed when see [STATE_MACHINE.md](STATE_MACHINE.md).

## How the pieces fit

| Folder | What it is |
|---|---|
| `client/` | The game: a Phaser AE project. Source in `client/game/` (`main.ts` registers the screens, `course/` holds them). The committed build is `client/dist/`. |
| `server/` | Fastify on Node: the `/api` routes, the run engine, ingest and retrieval, the model providers and storage. It also serves the game. |
| `shared/` | Zod contracts (`schemas.ts`) and a dependency-free API client (`api-client.ts`) used by both sides. |
| `scripts/` | `start.mjs` (the one-command launcher), the offline HTTP gauntlet (`e2e.ts`) and the API doc generator. |
| `samples/` | Two sample handouts and their prebuilt course packs, playable without any API key. |

One process serves everything on one port (8787 by default):

```
browser ──> http://localhost:8787 ──> server/src/app.ts (Fastify)
                                       ├── /            client/dist/   index.html, game.js, text-shaper.wasm  (server/src/static.ts)
                                       ├── /media/*     client/game/media/   art, music, styles
                                       └── /api/*       routes.ts → services → engine | ingest | rag | llm → repo
```

The game calls the API on its own origin, so it works on any port. `?api=<origin>` points it at another backend, and
`?mock=1` runs the game's built-in practice API with no backend at all (`client/game/course/mock.ts`). That is separate
from the server's mock model mode, which still uses the real HTTP API.

The game imports the API client straight from `shared/src/api-client.ts`; there is no copy to keep in sync.
`shared/src/type-sync.ts` fails the type check if the client's plain types drift from the Zod schemas.

## Running and rebuilding

| Command | What it does |
|---|---|
| `npm start` (or double-click `start.command` / `start.bat`) | Runs `scripts/start.mjs`: checks Node 22+, runs `npm ci` when `package-lock.json` changed since the last install, picks the port (`--port`, `PORT`, `.env`, else 8787; a busy port moves to the next free one, and a running Pip's Notebook is reused), starts the server and opens the browser. `--no-open` skips the browser. |
| `npm run dev` | The same server in watch mode, for backend work. |
| `npm run build:game` | Rebuilds `client/dist/` from `client/game/`. Needs the Phaser AE toolkit (below). |
| `npm run dev:game` | The live-rebuilding game preview on port 4173, talking to the API on 8787 (allowed by the default `CORS_ORIGINS`). Needs the toolkit. |

**Changing game code.** `client/dist/` is committed so nobody needs the toolkit just to play. After editing anything
under `client/game/` (or `shared/src/api-client.ts`), run `npm run build:game` and commit `client/dist/` with the
change. `client/tests/bundle.test.ts` compares the source hashes the build recorded in `client/dist/build.json` with
the files on disk and fails `npm test` when the build is stale.

**Getting the toolkit.** `client/phaser/` (the engine and build tools) and `client/game/node_modules/` (expansion
packs) are not in git. Restore them once, signing in with your own Phaser account when asked:

```sh
cd client
npx -y @phaser-ae/cli@0.8.0 setup
npx -y @phaser-ae/cli@0.8.0 update
node restore-packs.mjs
npm run build
```

The update command may warn that the game did not bake; the next two commands restore the packs and build. Every
build also writes the engine manual to `client/game/docs/` (ignored by git). `client/AGENTS.md` describes the rest of
the Phaser AE commands.

## Source map

| Files | Responsibility |
|---|---|
| `server/src/index.ts`, `app.ts`, `static.ts` | Entry point; the Fastify app, error shape, CORS, uploads; serving the game |
| `server/src/routes.ts`, `errors.ts` | HTTP routes (all under `/api`) and error codes |
| `server/src/container.ts`, `wiring.ts`, `config.ts`, `settings.ts` | Dependency wiring, environment config, saved API settings |
| `server/src/storage.ts` | Saved storage choice, opening local or MongoDB storage, copying an archive, switching live |
| `server/src/services/` | One service method per route: courses, runs, archive, settings |
| `server/src/engine/` | The run state machine: learning, room fights, "Help me!", boss, results, public projections |
| `server/src/ingest/` | Material → outline → lesson plan → question bank, with coverage checks ([INGEST.md](INGEST.md)) |
| `server/src/rag/` | Parsing, chunking, embeddings, vector stores (Atlas or in-memory), retrieval and exact evidence |
| `server/src/llm/`, `server/src/prompts/` | Gemini and OpenAI transports, mock and fake clients, task prompts |
| `server/src/repo/` | Storage: local files, memory (tests) and MongoDB |
| `shared/src/schemas.ts`, `api-client.ts`, `type-sync.ts` | Contracts, the client, and their mutual type check |
| `client/game/main.ts` | Registers the screens: Title, Upload, Learning, Fight, Boss, Results, Settings, Menu |
| `client/game/course/app.ts`, `page.ts`, `ui.ts` | Run state, navigation and API origin; page frame; DOM helpers |
| `client/game/course/Upload.ts` | My archive: samples, Create New Dungeon, saved dungeons, run setup and preparation progress |
| `client/game/course/expedition.ts` | Ending and removing expeditions, and the in-game confirm dialog |
| `client/game/course/Learning.ts`, `lesson-guide.ts`, `dictation.ts` | Teaching Pip, lesson guidance, dictation |
| `client/game/course/battle.ts`, `battle-feedback.ts`, `help.ts` | Room and boss fights, turn cards, "Help me!" questions |
| `client/game/course/Results.ts`, `report.ts`, `Menu.ts` | Results, the expedition report, the Rooms/Pause menu |
| `client/game/course/Settings.ts`, `settings-view.ts`, `storage-view.ts` | Settings: the AI provider tab and the MongoDB (storage) tab |
| `client/game/course/soundtrack.ts`, `transition.ts`, `client/game/art.ts` | Music fades, scene transitions, sprites and backgrounds |
| `client/game/engine.ts` | Generated by the Phaser AE bake from `manifest.json`; never edit it |

## Model providers and API setup

**Settings** in the game's header selects **OpenAI**, **Google Gemini** or **Offline** (the server's mock models).
A live provider needs a key; model names can be changed, and **Connection details** holds the backend origin, the
interactive request timeout (1–180 s, default 30) and the course preparation timeout (1–600 s per request, default
180). **Test connection** checks the unsaved settings with a small generation and embedding request (this can use API
credit; Offline makes no calls). **Save & apply** takes effect without a restart and keeps courses and runs.

| Setting | Default |
|---|---|
| OpenAI generation / embedding | `gpt-5.6-luna` / `text-embedding-3-small` |
| Gemini generation / embedding | `gemini-2.5-flash` / `gemini-embedding-001` |
| Embedding dimensions | 768 (not editable: changing it needs a vector index migration and re-ingest) |

- **Precedence.** Saved settings in `.local/api-settings.json` override the LLM settings in `.env`. Without an explicit
  `LLM_PROVIDER`, a Gemini key wins, then an OpenAI key, otherwise Offline. To go back to `.env`, stop the server,
  delete the settings file and restart. The ingest CLI and `npm run llm:smoke` read the same file; test containers do not.
- **Keys** are write-only: responses only say `hasApiKey`. An empty key field keeps the saved key. The file is plain
  text, gitignored, mode `0600`, written atomically. Only the non-secret backend origin is kept in the browser
  (`top.apiOrigin`; `?api=` wins over it).
- **Local only.** The three setup routes require a loopback peer, a localhost Host and either no Origin or an allowed
  one. Fastify does not trust proxy headers. This is a local setup page, not multi-user credential management.
- **Snapshots.** Each engine action uses the settings active when it starts; an ingest job keeps the provider it
  started with. Changing settings never cancels running work.
- **Embedding spaces.** New course packs record a hidden `embeddingProfile` (provider, model, dims) and keep
  retrieving in that space after a provider switch, so keep the original provider's key while those courses matter.
- **OpenAI** is called with plain `fetch` (no SDK): Responses with strict JSON Schema, Files for PDFs, batched
  embeddings, `store:false`. Uploaded files are not cleaned up automatically. Invalid structured output is retried once.

## Storage and the archive

Without `MONGODB_URI`, the server keeps courses, question banks, statistics, runs and notebooks in
`.local/archive/repository.json`, and source chunks and embeddings in `.local/archive/chunks.json` (owner-only,
gitignored). Writes are serialized and replace the file atomically; a malformed file stops startup rather than
silently starting empty. Original upload bytes are not kept. A preparation interrupted by a restart becomes an error
and needs another upload. This is single-process, single-user storage; large installations should use MongoDB.

In MongoDB the same data goes to the `courses`, `questions`, `questionStats`, `runs` and `chunks` collections, and the
server tries to create the Atlas vector index, ranking in process when the cluster has no Atlas Search or while the
index builds. `GET /api/health` reports `storage`.

**Choosing the storage.** Settings → **MongoDB** picks *This computer* or *MongoDB* (connection string, database, vector
index) and has its own Test connection. The choice is saved in `.local/storage-settings.json` (owner-only; the
connection string is write-only over HTTP, never returned or logged) and overrides `MONGODB_URI`, `MONGODB_DB` and
`ATLAS_VECTOR_INDEX`, which only apply until something is saved there. If MongoDB cannot be reached at startup, the
server uses this computer's storage and the MongoDB tab says why.

**Switching while the game runs** (`server/src/storage.ts`): the new storage is opened first, so a bad connection
changes nothing. Background preparation then finishes, the archive is copied across if *Copy the dungeons…* is ticked
(dungeons, questions, statistics, source chunks and their expeditions; ids already there are skipped, nothing is
deleted), the services are rebuilt on the new storage and the old one is closed. `container.services` always forwards
to the current services, so routes never hold the old storage. The game drops the open expedition after a switch,
since it lives in the old storage. Setting `MONGODB_URI` in `.env` never copies anything.

- `GET /api/archive` lists public course projections and every run with its rooms and `endedAt`.
- **End expedition** (`POST /api/runs/:id/end`) keeps the run as a read-only record; **Remove expedition**
  (`DELETE /api/runs/:id`) deletes only that run.
- **Delete dungeon** (`DELETE /api/courses/:id`) removes the course, its questions, statistics, chunks and all its
  runs, after an in-game confirmation. It returns `409 course_busy` while that course is preparing. Run writes, new
  runs, reseeding and deletion share a per-course lock. Files on the player's computer are never touched.

## Talking to the API from the game

Everything the game needs goes through `shared/src/api-client.ts`. The server keeps all game state, so the game only
shows what the server returns and sends the player's actions. [FRONTEND_VARIABLES.md](FRONTEND_VARIABLES.md) lists
every public field by screen.

```ts
import { createApiClient, ApiError } from '../../../shared/src/api-client.js';
export const api = createApiClient({ baseUrl: location.origin });
```

Every method returns a promise and rejects with an `ApiError` (`status`, `code`, `message`).

### Screens and calls

| Screen | Scene | Calls | Leaves when |
|---|---|---|---|
| Title/resume | `Title` in `main.ts` | `getRun(id)` when a run id is in the URL | Play → `Upload`; resume → current phase |
| Course and run setup | `Upload` (`course/Upload.ts`) | `listSamples()`, `seedCourse(sample)`, `uploadCourse(files, title?, notes?)` or `createCourseFromText(notes)`, poll `getCourse(id)`, `createRun({ courseId, targetGrade, scope })` | `createRun` succeeds → `Learning` |
| Learning phase | `Learning` (`course/Learning.ts`) | `teach`, `answerQuestion`, `skipQuestion`, `ready` | `ready` succeeds → `Fight` |
| Room fight | `Fight` (`course/battle.ts`) | `turn`, `help`, `retry`, `continueRun` | retry → `Learning`; continue → `Learning` or `Boss` |
| Boss | `Boss` (`course/battle.ts`) | `turn`, `help` | `boss_end` → `Results` |
| Results | `Results` (`course/Results.ts`) | Cached `boss_end.results`, `run.results`, or `getResults` | Start over → `Upload` |
| Rooms/pause | `Menu` (`course/Menu.ts`) | `pauseRun`, `resumeRun`, `endRun`, `deleteRun` | Resume restores the saved phase |
| Settings | `Settings` (`course/Settings.ts`) | `getApiSettings`, `testApiSettings`, `updateApiSettings` | Back returns to the prior screen |

`run.phase` decides the screen: `learning` → `Learning`, `room` and `room_result` → `Fight`, `boss` → `Boss`,
`results` → `Results`. The run id lives in the URL, so a reload calls `getRun` and resumes.

### Course preparation

After an upload the server builds the course in the background; poll `getCourse(courseId)` about once a second.
`status.stage` goes `parsing` → `outline` → `style` → `concepts` → `ready` (or `error`), and `status.activity` carries
task progress and, from OpenAI, public reasoning summaries ([INGEST.md](INGEST.md#progress-while-preparing)). Show a
ready or pending mark per room. **A run can start once its first room is ready**; a `425 room_not_ready` from
`createRun` or `ready` means try again shortly.

### Learning

```ts
const { notebookMd, questions } = await api.teach(run.id, explanationText);
const { resolved, notebookMd } = await api.answerQuestion(run.id, q.id, answerText);
const { notebookMd } = await api.skipQuestion(run.id, q.id);
const run = await api.ready(run.id);     // phase is now 'room'
```

The player can teach more than once. Answering Pip's questions is free; skipping (or pressing Ready with questions
open) makes Pip write down a wrong belief. The questions sound naive on purpose: never label one a trap. The notebook
is small Markdown, one `## ` heading per concept and one `- ` bullet per note. A wrong belief looks like any other
note; never highlight it. Refresh it from every response that carries `notebookMd`, and from `getRun` after a fight.

### Fights

**Next turn** calls `api.turn(run.id)` and switches on `result.kind`: `student_answer`, `help_me`, `help_result`,
`room_end` or `boss_end`. For an answer, show the question, Pip's (or the player's) answer, hit or miss, the correct
answer and explanation, the new `hearts` (rooms) or `health` (boss, 100 down to 0), and Pip's reasoning and cited
notes; when wrong, `reason` is `'not in my notes'`, `'wrong belief'` or `'unknown'`. If `phaseAfter` is
`room_result` or `results`, call `turn` once more for the summary. `room_end` with `passed: false` shows the failed
turns and Retry (back to learning, notebook kept, hearts reset). `run.room.log` and `run.boss.log` rebuild the screen
after a reload.

### "Help me!"

`turn` can return `{ kind: 'help_me', eventId, question, timeBudgetSec, deadline }`. Show the difficulty and time
budget before the player starts, count down to `deadline` (display only; the server judges lateness; `null` means
untimed mode), then send `api.help(run.id, eventId, answer)`. When the countdown ends, submit what the player entered.
While paused, deadlines freeze. On reload, `run.pendingHelpMe` holds a waiting event.

### Answers by question type

| `type` | Show | `answer` to send |
|---|---|---|
| `mcq` | `payload.options` | `{ choiceIndex: 2 }` |
| `true_false` | `payload.statement` | `{ value: true }` |
| `multi_select` | `payload.options` | `{ choiceIndexes: [0, 2] }` |
| `numeric` | `payload.unit` (may be `null`) | `{ value: 71.5 }` |
| `short_text` | | `{ text: 'O(log n)' }` |
| `ordering` | `payload.items` in the order given | `{ order: [2, 0, 1] }` |
| `free_response` | never used for "Help me!" | |

Indexes are positions exactly as the server sent them; never shuffle on the client.

### Results and hidden fields

`getResults` gives `predictedGradePct`, `letter`, `target`/`metTarget`, `conceptAccuracy`, `helpMe` statistics and
`costlyMisconceptions` (each with the wrong belief, the correction and a `materialRef` to the page and section that
covers it). That is the only place misconceptions are revealed. The normal endpoints never send answer keys early.
`getDebug(runId)` returns everything hidden and only works with `DEBUG=true`; never call it from the game.

### Errors

| Status | Code | What the game does |
|---|---|---|
| 409 | `wrong_phase` | The screen is out of date: `getRun` and show the scene for `run.phase`. |
| 409 | `help_pending` | Show the waiting "Help me!" question (`run.pendingHelpMe`). |
| 409 | `help_event_not_pending`, `question_not_open` | Already handled (a double click): refresh from `getRun`. |
| 409 | `run_paused`, `run_ended` | Open the menu, or show the run as a read-only record. |
| 425 | `room_not_ready` | Still building the room: retry in a second or two. |
| 502 | `llm_error` | The model failed or timed out; nothing changed, so offer "Try again". |
| 0 | `network_error` | The server isn't reachable. |

Disable buttons while a request is in flight; model-backed calls (`teach`, `answerQuestion`, `turn`) can take a few
seconds.
