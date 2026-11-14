# Pip's Notebook

A turn-based dungeon game where you can't fight. You can only teach.

Repository: [BryceKirkwood1001/pips-notebook](https://github.com/BryceKirkwood1001/pips-notebook).

Upload lecture slides or notes, then teach Pip, your apprentice, before sending them into battle. The material becomes a few coherent lessons, each with a room, teaching objectives and several related topics. Pip keeps a notebook of what you explain and asks follow-up questions. In combat, Pip answers questions using **only that notebook**, without access to your uploaded material or the answer keys. Gaps and misconceptions in your teaching affect the fight.

The final boss is an exam covering the course. Results show the game's predicted grade and the material to revisit. This is a gameplay estimate, not a validated prediction of a real exam score.

Built at HackPrinceton (November 13 to 15, 2026).

## Current game

- **Centered main menu:** Play, My archive, Settings and Music on/off.
- **Source-grounded preparation:** PDF, Markdown and plain-text uploads, plus pasted notes. The planner normally groups a lecture into 3–5 complete lessons (1–2 for short material, at most 6), with descriptions and teaching objectives. Source-concept coverage and question quality are checked before preparation completes.
- **Teach topic by topic:** a lesson book with an overview, topic pages and review. A floating Talk to Pip / Pip has a question bubble opens the teaching conversation. Feedback distinguishes new notes, unclear explanations and unrelated messages; incorrect teaching can become a misconception in Pip's notebook.
- **Readable combat feedback:** room encounters, a final dragon exam, hit animations and a persistent turn outcome above Next turn. Click the outcome to open that turn in the battle log. The expedition report shows room progress, correct/total answers, accuracy and weak points.
- **Navigation and saved progress:** Rooms and Pause open the lesson/progress menu. Pausing freezes pending help deadlines. My archive lists **Your saved dungeons** and their expeditions: resume, end or remove an expedition, or delete an entire dungeon after confirmation.
- **Music transitions:** scene and battle tracks fade out and in; the music preference is remembered in the browser.
- **On-device dictation only:** Dictate requires browser support for local speech recognition and an available language pack. If unavailable, use typing or your computer's dictation. There is no cloud transcription fallback or audio-upload backend.

Preparation shows stage/task progress and, when supplied by OpenAI, public reasoning summaries. These summaries are optional and are not the model's private chain of thought. You can start with a ready selected room while later rooms continue preparing.

## What's in this repository

| Folder | What it is |
|---|---|
| `pips-notebook/` | The game itself: a 2D pixel-art dungeon built with Phaser AE. See [The Phaser game](#the-phaser-game). |
| `server/` | The backend: API, game engine, material ingestion and retrieval. Node and TypeScript. |
| `shared/` | Public Zod contracts and a dependency-free API client, also copied into the game. |
| `samples/` | Two sample course handouts and their prebuilt course packs. |
| `docs/` | Spec, API reference, state machine, ingest pipeline, and the guide for wiring the game to the backend. |
| `scripts/` | Offline HTTP gauntlet checks and API/frontend documentation generators. |
| `assets/marketing/` | Thumbnail artwork and its generation/edit prompts. |

## Backend quick start

You need **Node.js 22 or later**. On a fresh checkout:

```sh
npm ci
cp .env.example .env
npm run dev:server
```

If you already have a `.env`, keep it instead of copying over it.

The API is now on [localhost:8787/api](http://localhost:8787/api/health). The integrated Phaser game runs on port **4173**; follow [The Phaser game](#the-phaser-game) below to restore its engine, build and serve it from this same checkout.

After restoring the game's runtime, `npm run build:game` and `npm run dev:game` from the repository root build and serve the main site on **4173**. The backend remains a separate process on **8787**.

**No keys are needed for the sample demo.** On a fresh setup without provider keys, the server uses deterministic mock models. Choose a sample from **My archive → Library**. Existing saved API settings take precedence over `.env`; select **Offline** in Settings if a provider was configured previously.

Use the bundled samples for the offline demo. Arbitrary uploads use a limited heuristic in mock mode and can fail coverage; a `202` upload response means accepted, so keep polling ingest status.

For model-backed uploads, configure a provider in Settings or `.env`. MongoDB is optional:

| Variable | What it is |
|---|---|
| `LLM_PROVIDER` | `openai`, `gemini` or `mock`. Without an explicit selection, a Gemini key takes precedence, then OpenAI, then mocks. |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Credentials for the selected provider. Document preparation, teaching, grading and embeddings use that provider; live requests may incur usage charges. |
| `OPENAI_MODEL` / `GEMINI_MODEL` | Generation model names. Choose a model available to your account; embedding models are configured separately. |
| `MONGODB_URI` | Optional MongoDB connection string. With no connection configured, the normal server uses local disk storage. |

Every other setting has a default and is described in `.env.example`.

### API setup in Settings

Open **Settings** in the game's header to select **OpenAI**, **Google Gemini**, or **Offline**, change generation/embedding model names, replace/remove keys, or change the backend URL. Connection details separates the interactive timeout (30 seconds by default) from course preparation (180 seconds per request). Large uploads are outlined in bounded page/text batches. **Test connection** checks unsaved settings; **Save & apply** activates them without restarting the backend. A live connection test uses a small amount of API usage.

During preparation, **Thinking** below Stage shows current task/page progress and public OpenAI reasoning summaries when available. Active document streams extend their idle timeout, with a ten-minute request cap. See [API_SETTINGS.md](docs/API_SETTINGS.md) for model support and fallback behavior.

API setup is part of the main game's **Settings** screen on port 4173.

Keys are write-only in the setup API and stored by the backend in ignored `.local/api-settings.json` with owner-only file permissions. Only the non-secret backend URL is kept in browser storage. Saved API settings override the initial LLM environment settings; removing the local settings file restores environment defaults on the next restart. Setup is restricted to the backend's local machine and allowed browser origins. See [API_SETTINGS.md](docs/API_SETTINGS.md) for behavior, limits and implementation notes.

### Storage and MongoDB

The default server persists courses, question banks, statistics and runs in `.local/archive/repository.json`, and extracted source chunks/embeddings in `.local/archive/chunks.json`. These files and the API settings file are ignored by Git. Prepared courses and notebooks survive restarts; original upload bytes are not retained. An interrupted preparation is marked as failed on restart and requires another upload. Pause before leaving a timed run so its deadline is frozen.

To use MongoDB, set `MONGODB_URI`, optionally `MONGODB_DB` and `ATLAS_VECTOR_INDEX`, and restart the backend. The database user needs permission to read/write the project's collections, and the backend must be allowed to connect. The server stores courses, questions, question statistics, runs and chunks in MongoDB and attempts to create the Atlas vector index. If vector search is unavailable or still building, it ranks retrieved MongoDB chunks in process.

A failed MongoDB connection falls back to local storage with a warning. Check [API health](http://localhost:8787/api/health): `storage` reports `local`, `mongodb` or `memory`. Setting a URI does **not** migrate existing local data. This application currently uses a shared backend archive, not separate authenticated user accounts.

The default MongoDB database is `pips_notebook`. Existing MongoDB installations should explicitly set `MONGODB_DB` to their current database before restarting; changing the project name does not migrate or rename a database. The local `.local/archive` path is unchanged.

**Remove expedition** deletes only that run. **Delete dungeon** deletes its prepared course, questions, statistics, chunks and all associated runs; it never deletes the source files on your computer. Deletion is blocked while that dungeon is actively preparing. See [archive and lesson behavior](docs/ARCHIVE_AND_LESSONS.md).

### Commands

Run these from the repository root.

| Command | What it does |
|---|---|
| `npm run dev:server` | Starts the API on port 8787 and restarts on changes. |
| `npm run dev:game` | Starts the main Phaser AE site on port 4173; requires its restored runtime. |
| `npm run build:game` | Builds and type-checks the main game using its own toolchain. |
| `npm test` | Runs the test suite. |
| `npm run e2e` | Plays a full gauntlet against the API with mocks and prints a transcript. |
| `npm run typecheck` | Type-checks `shared` and `server`. |
| `npm run ingest -- samples/seasons.md` | Builds a course pack from a file and writes it to `samples/cache/`. |
| `npm run llm:smoke` | Calls each model task using the saved/environment provider. Skips in Offline mode. |
| `npm run docs:api` | Rebuilds the API reference from captured HTTP examples. |

To refresh the examples first, run `npm run e2e -- --capture-file docs/api-examples.json`. The script starts its own mock API on a temporary localhost port; no separately running server is needed. `npm run e2e -- --sample binary-search` checks the other sample.

## Demo script

1. Start the backend and the Phaser game (see below), then open [localhost:4173](http://localhost:4173).
2. Open **My archive**, pick the **Why Earth Has Seasons** sample from Library, select rooms, choose a target grade and a student, then start.
3. **Learning.** Open Talk to Pip, explain each topic and answer follow-up questions. Check the notebook and review the lesson before sending Pip to fight.
4. **Room fight.** Press **Next turn** and watch Pip answer from the notebook. Click the turn outcome to inspect the answer, cited notes and grading. Use Rooms or Pause to inspect lesson progress without losing your place.
5. **"Help me!"** Now and then the student asks you to solve a question yourself, with a time budget that depends on how hard the question is.
6. **Boss.** The exam mixes every concept and aims questions at the wrong beliefs still in the notebook.
7. **Results.** The predicted grade, whether you met your target, and the misconceptions that cost you, each with the page and section of the material that covers it.

For backend development, `DEBUG=true` enables the protected debug endpoint. Hidden answer keys and misconception state must stay out of normal gameplay screen.

For a shorter demo, set `DEMO_MODE=true`: rooms have 3 questions and the boss has 6.

## Docs

- [docs/API.md](docs/API.md): every endpoint with a real request and response.
- [docs/API_SETTINGS.md](docs/API_SETTINGS.md): OpenAI/Gemini setup, key storage and provider switching.
- [docs/STATE_MACHINE.md](docs/STATE_MACHINE.md): the phases of a run and which action is allowed when.
- [docs/PHASER_INTEGRATION.md](docs/PHASER_INTEGRATION.md): how to wire the Phaser game to the backend.
- [docs/ARCHIVE_AND_LESSONS.md](docs/ARCHIVE_AND_LESSONS.md): lesson grouping, persistence, pause, progress and archive controls.
- [pips-notebook/game/README.md](pips-notebook/game/README.md): the actual game's source map and frontend behavior.
- [docs/FRONTEND_VARIABLES.md](docs/FRONTEND_VARIABLES.md): public API fields and state mapped to the main game's screens.
- [docs/INGEST.md](docs/INGEST.md): how uploaded material becomes a verified question bank.
- [docs/QUESTION_QUALITY.md](docs/QUESTION_QUALITY.md): source-alignment rules, quality validation, reference-slide evaluation and battle feedback fixes.
- [docs/SPEC.md](docs/SPEC.md) and [docs/DECISIONS.md](docs/DECISIONS.md): the game rules and the choices made along the way.
- [docs/CONTINUATION_LOG.md](docs/CONTINUATION_LOG.md): the Codex handoff, changes, verification results and remaining live checks.
- [docs/REVIEW.md](docs/REVIEW.md): the backend audit, fixes and limitations.
- [docs/INTEGRATION.md](docs/INTEGRATION.md): combined branch history, launch commands, verification and remaining frontend issues.

## The Phaser game

The game in `pips-notebook/` is built with Phaser AE and is set up separately from the backend.

The checked-in Phaser metadata supports local restore/build/preview. Hosted Phaser publishing and crew commands require the owner to link an accessible hosted build; a GitHub repository rename does not rename that separate service.

Use **Node.js 22 or later**, as required by the root workspace. The Phaser AE runtime is restored separately; root `npm ci` installs the `shared` and `server` workspaces. From the repository root, enter the game folder:

```sh
cd pips-notebook
```

On a fresh clone, sign in with your own Phaser account when prompted and restore the engine and packs using the version pinned in this project's setup:

```sh
npx -y @phaser-ae/cli@0.8.0 setup
npx -y @phaser-ae/cli@0.8.0 update
node restore-packs.mjs
npm run build
```

On a fresh clone, the update command may warn that the game did not bake. The next two commands restore the missing packs and build the game.

Start the local preview and open [localhost:4173](http://localhost:4173). Reload the browser after editing a scene.

```sh
npm run serve
```

The integrated entry point is `pips-notebook/game/main.ts`; lesson, combat, archive and settings UI are in `pips-notebook/game/course/`. Registered screens are `Title`, `Upload`, `Learning`, `Fight`, `Boss`, `Results`, `Settings` and `Menu`.

### Connect the backend

Both the frontend and backend are present in this checkout. Keep `npm run dev:server` running from the repository root in one terminal, and `npm run serve` from the inner `pips-notebook/` folder in another after restoring/building its engine as above.

Open [the game](http://localhost:4173). Live API mode is the default and uses `http://localhost:8787`. To point at another server, use `?api=https://your-server.example` (origin only) and allow the game origin in the backend's `CORS_ORIGINS`. Credentials belong on the server. The run id is stored in the URL so reload restores server state.

For the browser's standalone canned demonstration, open [practice mode](http://localhost:4173/?mock=1). This differs from the backend's mock LLM mode: omit `?mock=1` to exercise the real HTTP API even when the server uses mocks.

### Verify the game

Run these from the repository root:

```sh
npm test
npm run typecheck
npm run e2e
npm run e2e -- --sample binary-search
```

Build the game with root `npm run build:game` (or `npm run build` from the inner game folder). The root type check covers the backend and shared contracts; the game build checks its own TypeScript. The HTTP gauntlet uses an isolated mock server; it does not prove live-model quality or a complete browser playthrough.

The latest recorded code verification on November 14, 2026 passed **405 tests across 39 files**, the root type check, the native game build and the offline HTTP gauntlet. See [the continuation log](docs/CONTINUATION_LOG.md) for individual checks and live-model diagnostics.

Known verification limits: the native `npm run smoke` simulator fails at the frontend's DOM dependency (`document is not defined`). The older `tests/playthrough.mjs` and `tests/live-course.mjs` browser scripts still reference earlier button labels and teaching controls and need updating before serving as regression gates. On-device speech recognition and audible music transitions still need manual checks in a supporting browser; a full fresh-upload, live-model boss/results playthrough is not claimed.

## Artwork

[3:2 thumbnail](assets/marketing/pips-notebook-thumbnail-3x2.png) · [original landscape variant](assets/marketing/pips-notebook-thumbnail-v2.png)

The thumbnails use the game's official title, **Pip's Notebook**. Exact image prompts are kept beside the PNGs in `assets/marketing/`.

## Credits

Libraries and services this project uses:

| Library or service | Used for | License |
|---|---|---|
| [Phaser AE](https://phaser.io) (`@phaser-ae/cli`) | The game in `pips-notebook/` | Phaser AE terms |
| [Fastify](https://fastify.dev), [`@fastify/cors`](https://github.com/fastify/fastify-cors), [`@fastify/multipart`](https://github.com/fastify/fastify-multipart) | The HTTP API and file uploads | MIT |
| [Zod](https://zod.dev), [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema) | Data schemas and structured model output | MIT, ISC |
| [`@google/genai`](https://github.com/googleapis/js-genai) with the Google Gemini API | The AI student, grading, course pack generation, embeddings | Apache-2.0 |
| [OpenAI API](https://platform.openai.com/docs) (called directly over HTTPS, no SDK) | Optional second provider for the AI student, grading, course pack generation and embeddings | OpenAI terms |
| [MongoDB Node.js driver](https://github.com/mongodb/node-mongodb-native) with MongoDB Atlas Vector Search | Storage and vector search | Apache-2.0 |
| [`unpdf`](https://github.com/unjs/unpdf) | PDF text extraction | MIT |
| [`pdf-lib`](https://pdf-lib.js.org) | Generating small PDFs inside tests | MIT |
| [`dotenv`](https://github.com/motdotla/dotenv) | Loading `.env` | BSD-2-Clause |
| [TypeScript](https://www.typescriptlang.org), [`tsx`](https://tsx.is), [Vitest](https://vitest.dev) | Language, running TypeScript, tests | Apache-2.0, MIT, MIT |

The game, backend and docs were developed during the event with help from Claude Code and Codex.
