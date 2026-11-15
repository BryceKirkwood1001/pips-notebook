# Architecture

How the game, the in-page backend and the shared contracts fit together, how to build and serve them, and how the
game talks to the API. For the rules of play see [SPEC.md](SPEC.md); for every endpoint with a real request and
response see [API.md](API.md); for which action is allowed when see [STATE_MACHINE.md](STATE_MACHINE.md); for
putting the site online see [HOSTING.md](HOSTING.md).

## How the pieces fit

This is the public edition: **there is no server**. The original edition ran the game logic on a Node server; here
the same code runs in the player's browser tab.

| Folder | What it is |
|---|---|
| `client/` | The game: a Phaser AE project. Source in `client/game/` (`main.ts` registers the screens, `course/` holds them). The committed build is `client/dist/`. |
| `server/` | The game logic, bundled for the browser as `backend.js`: the `/api` routes (`router.ts`), the run engine, ingest and retrieval, the model providers and storage. The folder keeps its name from the server edition. |
| `shared/` | Zod contracts (`schemas.ts`) and a dependency-free API client (`api-client.ts`) used by both sides. |
| `scripts/` | `build.mjs` (the static site), `start.mjs` and `serve.mjs` (the local launcher and file server), the end-to-end gauntlet (`e2e.ts`) and the API doc generator. |
| `samples/` | Prebuilt course packs playable without any API key. A pack can set its own `pace` for a short game: questions per room and boss, hearts, how many questions Pip asks, the "Help me!" chance, or a fixed room turn for "Help me!". Packs with a pace are listed first (`short` in `samples/index.json`). |

`npm run build` writes the static site, and any static host serves it:

```
site/
├── index.html, game.js, text-shaper.wasm    the game (client/dist), loads ./backend.js on first use
├── backend.js, backend/*.js                 server/src/browser/main.ts; pdf.js and the Gemini SDK are lazy chunks
├── media/                                   art, music, styles (client/game/media)
└── samples/index.json, samples/<id>.json    the Offline sample lessons (samples/cache)
```

Inside the page:

```
game (client/game/course/app.ts)
  └─ createApiClient({ fetch: localFetch })          shared/src/api-client.ts, unchanged API
       └─ backend.js: buildApp(container).fetch       server/src/app.ts → router.ts (Request → Response)
            └─ services → engine | ingest | rag | llm → repo (IndexedDB) and vector store (IndexedDB)
                                                 └─ llm → api.openai.com or generativelanguage.googleapis.com (player's key)
```

The API client still speaks HTTP-shaped requests (`/api/...`, JSON bodies, multipart uploads, status codes), but its
`fetch` is answered by the router in the page, so nothing goes over a network. `BACKEND_ORIGIN`
(`https://backend.pips-notebook.invalid`) is a made-up origin that only labels those requests. The same router runs
in Node for the tests and `npm run e2e`.

`?mock=1` runs the game's built-in practice API instead (`client/game/course/mock.ts`). That is separate from the
**Offline** provider, which runs the real backend with canned model outputs.

The game imports the API client straight from `shared/src/api-client.ts`; there is no copy to keep in sync.
`shared/src/type-sync.ts` fails the type check if the client's plain types drift from the Zod schemas.

## Building, serving and rebuilding

| Command | What it does |
|---|---|
| `npm run build` | `scripts/build.mjs`: bundles `server/src/browser/main.ts` with esbuild (browser platform, ES2022, minified, split chunks), copies the game build, `client/game/media` and `samples/cache`, writes `samples/index.json` and `.nojekyll`. Fails if the bundle would pull in a Node built-in. |
| `npm start` (or `start.command` / `start.bat`) | `scripts/start.mjs`: checks Node 22+, runs `npm ci` when `package-lock.json` changed, builds the site, serves `site/` on `127.0.0.1` (`--port`, `PORT`, else 8787; a busy port moves on; an existing Pip's Notebook file server is reused) and opens the browser. `--no-open`, `--no-build`. |
| `npm run build:game` | Rebuilds `client/dist/` from `client/game/`. Needs the Phaser AE toolkit (below). |
| `npm run dev:game` | The live-rebuilding game preview on port 4173. It has no `backend.js` beside it, so use `?mock=1` there, or `npm start` for the real thing. Needs the toolkit. |

**Changing game code.** `client/dist/` is committed so nobody needs the toolkit just to play or deploy. After editing
anything under `client/game/` (or `shared/src/api-client.ts`), run `npm run build:game` and commit `client/dist/` with
the change. `client/tests/bundle.test.ts` compares the source hashes the build recorded in `client/dist/build.json`
with the files on disk and fails `npm test` when the build is stale. Changes under `server/` need no toolkit: the
site build bundles them.

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
| `server/src/browser/main.ts` | The bundle's entry: `start()` opens IndexedDB (memory if blocked), keeps AI settings in Web Storage, loads samples over `fetch`, holds a Web Lock per preparing upload, returns `{ fetch, preparing, storage }` |
| `server/src/app.ts`, `router.ts`, `errors.ts` | The in-page app (`fetch`, and Fastify-style `inject` for tests), the routes (all under `/api`) and error codes |
| `server/src/container.ts`, `wiring.ts`, `config.ts`, `settings.ts` | Dependency wiring, game config, the player's AI settings |
| `server/src/storage.ts` | The storage report for Settings, and backup export and import |
| `server/src/samples.ts`, `server/src/node/samples.ts` | Where sample lessons come from: static files in the browser, `samples/cache` in Node |
| `server/src/services/` | One service method per route: courses, runs, archive |
| `server/src/engine/` | The run state machine: learning, room fights, "Help me!", boss, results, public projections |
| `server/src/ingest/` | Material → outline → lesson plan → question bank, with coverage checks ([INGEST.md](INGEST.md)) |
| `server/src/rag/` | Parsing (pdf.js through `unpdf`), chunking, embeddings, the in-memory vector store, retrieval and exact evidence |
| `server/src/llm/`, `server/src/prompts/` | Gemini and OpenAI transports, mock and fake clients, task prompts |
| `server/src/repo/` | Storage: IndexedDB (the browser; repository and vector store) and memory (tests) |
| `server/src/util/names.ts` | Ids and file names without `node:crypto` or `node:path` |
| `shared/src/schemas.ts`, `api-client.ts`, `type-sync.ts` | Contracts, the client, and their mutual type check |
| `client/game/main.ts` | Registers the screens: Title, Upload, Learning, Fight, Boss, Results, Settings, Menu |
| `client/game/course/app.ts`, `backend.ts`, `page.ts`, `ui.ts` | Run state and navigation; loading `backend.js`; page frame; DOM helpers |
| `client/game/course/Upload.ts` | My archive: samples, Create New Dungeon, saved dungeons, run setup and preparation progress |
| `client/game/course/expedition.ts` | Ending and removing expeditions, and the in-game confirm dialog |
| `client/game/course/Learning.ts`, `lesson-guide.ts`, `dictation.ts` | Teaching Pip, lesson guidance, dictation |
| `client/game/course/battle.ts`, `battle-feedback.ts`, `help.ts` | Room and boss fights, turn cards, "Help me!" questions |
| `client/game/course/Results.ts`, `report.ts`, `Menu.ts` | Results, the expedition report, the Rooms/Pause menu |
| `client/game/course/Settings.ts`, `settings-view.ts`, `storage-view.ts` | Settings: the AI provider tab and the Saved in this browser tab |
| `client/game/course/soundtrack.ts`, `transition.ts`, `client/game/art.ts` | Music fades, scene transitions, sprites and backgrounds |
| `client/game/engine.ts` | Generated by the Phaser AE bake from `manifest.json`; never edit it |

## Model providers and the player's key

**Settings** selects **OpenAI**, **Google Gemini** or **Offline** (mock models with canned outputs for the samples).
A live provider needs the player's own key; model names can be changed, and **Timeouts** holds the interactive request
timeout (1–180 s, default 30) and the course preparation timeout (1–600 s per request, default 180). **Test
connection** checks the unsaved settings with a small generation and embedding request (this can use API credit;
Offline makes no calls). **Save & apply** takes effect at once and keeps courses and runs.

| Setting | Default |
|---|---|
| OpenAI generation / embedding | `gpt-5.6-luna` / `text-embedding-3-small` |
| Gemini generation / embedding | `gemini-2.5-flash` / `gemini-embedding-001` |
| Embedding dimensions | 768 (not editable: changing it means preparing courses again) |

- **Where keys live.** Settings and keys are saved as one JSON value under `pips-notebook.ai-settings` in
  `localStorage`, or in `sessionStorage` when **Remember my key on this device** is unticked (gone when the tab
  closes). Saving moves it between the two. Nothing else stores a key: not the site, not a backup, not IndexedDB.
- **Where keys go.** Only to the chosen provider, from the page: OpenAI as an `Authorization` header to
  `api.openai.com`, Gemini through `@google/genai` to `generativelanguage.googleapis.com`. Both APIs allow browser
  requests (CORS). OpenAI answers a rejected key on its POST endpoints without CORS headers, which the browser reports
  as a network error, so the OpenAI client then asks `GET /v1/models` (which keeps them) to tell "wrong key" from "no
  connection".
- **Keys are write-only** through the API: reads only say `hasApiKey`. An empty key field keeps the saved key.
- **Snapshots.** Each engine action uses the settings active when it starts; an ingest job keeps the provider it
  started with. Changing settings never cancels running work.
- **Embedding spaces.** New course packs record a hidden `embeddingProfile` (provider, model, dims) and keep
  retrieving in that space after a provider switch, so keep the original provider's key while those courses matter.
- **OpenAI** is called with plain `fetch` (no SDK): Responses with strict JSON Schema, Files for PDFs, batched
  embeddings, `store:false`. Uploaded files are not cleaned up automatically. Invalid structured output is retried once.
- The Node scripts (`npm run ingest`, `npm run llm:smoke`) read keys from environment variables instead.

## Storage in the browser

Everything is saved in one IndexedDB database, `pips-notebook` (`server/src/repo/indexeddb.ts`), with the object
stores `courses`, `questions`, `questionStats`, `runs` and `chunks` (source text with its embedding; indexed by
`courseId`). Search ranks one course's chunks by cosine similarity in the page; each course's chunks are read once and
cached until the course changes. Original upload bytes are not kept. `GET /api/health` reports `storage`: `browser`,
or `memory` when the browser blocks IndexedDB (dungeons then last until the page closes, and Settings says why).

- **Reloads.** Expeditions, notebooks and dungeons survive reloads; the run id in the URL resumes the open one.
- **Interrupted preparation.** Preparation runs in the page. While it runs, the page asks before closing, and the tab
  holds a Web Lock named after the course. When the page opens, a dungeon still marked as preparing whose lock no other
  tab holds is marked as stopped and needs another upload.
- **Eviction.** Browsers may clear a site's data under storage pressure. **Settings → Saved in this browser** shows
  the counts and the browser's estimate, and **Keep my dungeons** asks for persistent storage
  (`navigator.storage.persist()`).
- **Backups.** `GET /api/backup` returns every dungeon (course, questions, statistics, chunks) and its expeditions as
  one JSON file; **Download backup** saves it. `POST /api/backup` validates a file against the schema and adds its
  dungeons; ids already saved are skipped and nothing is replaced or deleted. A backup holds answer keys (it is the
  player's own copy) and never API keys.
- **Hidden fields.** Everything is on the player's device, so the developer tools can show answer keys. The API's
  public responses still never contain them; that is what keeps the game itself fair.

- `GET /api/archive` lists public course projections and every run with its rooms and `endedAt`.
- **End expedition** (`POST /api/runs/:id/end`) keeps the run as a read-only record; **Remove expedition**
  (`DELETE /api/runs/:id`) deletes only that run.
- **Delete dungeon** (`DELETE /api/courses/:id`) removes the course, its questions, statistics, chunks and all its
  runs, after an in-game confirmation. It returns `409 course_busy` while that course is preparing. Run writes, new
  runs, reseeding and deletion share a per-course lock. Files on the player's device are never touched.

## Talking to the API from the game

Everything the game needs goes through `shared/src/api-client.ts`. The backend keeps all game state, so the game only
shows what the backend returns and sends the player's actions. [FRONTEND_VARIABLES.md](FRONTEND_VARIABLES.md) lists
every public field by screen.

```ts
import { createApiClient, BACKEND_ORIGIN } from '../../../shared/src/api-client.js';
import { localFetch } from './backend.js';   // loads ./backend.js and calls its start() once
export const api = createApiClient({ baseUrl: BACKEND_ORIGIN, fetch: localFetch });
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
| Settings | `Settings` (`course/Settings.ts`) | `getApiSettings`, `testApiSettings`, `updateApiSettings`, `getStorageSettings`, `exportBackup`, `importBackup` | Back returns to the prior screen |

`run.phase` decides the screen: `learning` → `Learning`, `room` and `room_result` → `Fight`, `boss` → `Boss`,
`results` → `Results`. The run id lives in the URL, so a reload calls `getRun` and resumes.

### Course preparation

After an upload the backend builds the course in the background, in the page; poll `getCourse(courseId)` about once a second.
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
budget before the player starts, count down to `deadline` (display only; the backend judges lateness; `null` means
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

Indexes are positions exactly as the backend sent them; never shuffle on the client.

### Results and hidden fields

`getResults` gives `predictedGradePct`, `letter`, `target`/`metTarget`, `conceptAccuracy`, `helpMe` statistics and
`costlyMisconceptions` (each with the wrong belief, the correction and a `materialRef` to the page and section that
covers it). That is the only place misconceptions are revealed. The normal endpoints never send answer keys early.
`getDebug(runId)` returns everything hidden and only works with `DEBUG=true` (never in the built site); never call it from the game.

### Errors

| Status | Code | What the game does |
|---|---|---|
| 409 | `wrong_phase` | The screen is out of date: `getRun` and show the scene for `run.phase`. |
| 409 | `help_pending` | Show the waiting "Help me!" question (`run.pendingHelpMe`). |
| 409 | `help_event_not_pending`, `question_not_open` | Already handled (a double click): refresh from `getRun`. |
| 409 | `run_paused`, `run_ended` | Open the menu, or show the run as a read-only record. |
| 425 | `room_not_ready` | Still building the room: retry in a second or two. |
| 502 | `llm_error` | The model failed or timed out; nothing changed, so offer "Try again". |
| 0 | `network_error` | `backend.js` could not be loaded (offline, or a broken deployment): reload the page. |

Disable buttons while a request is in flight; model-backed calls (`teach`, `answerQuestion`, `turn`) can take a few
seconds.
