# Pip's Notebook

A turn-based dungeon game where you can't fight. You can only teach.

Repository: [BryceKirkwood1001/pips-notebook](https://github.com/BryceKirkwood1001/pips-notebook).

Upload lecture slides or notes, then teach Pip, your apprentice, before sending them into battle. The material becomes a few coherent lessons, each with a room, teaching objectives and several related topics. Pip keeps a notebook of what you explain and asks follow-up questions. In combat, Pip answers questions using **only that notebook**, without access to your uploaded material or the answer keys. Gaps and misconceptions in your teaching affect the fight.

The final boss is an exam covering the course. Results show the game's predicted grade and the material to revisit. This is a gameplay estimate, not a validated prediction of a real exam score.

Built at HackPrinceton (November 13 to 15, 2026).

## Play it

1. Install **Node.js 22 or later** (the LTS from [nodejs.org](https://nodejs.org) is fine).
2. Get this repository: `git clone` it, or use **Code → Download ZIP** on GitHub and unzip it.
3. Start it with one of these:
   - **macOS:** double-click `start.command`.
   - **Windows:** double-click `start.bat`.
   - **Any terminal** (also Linux), from the repository folder:

     ```sh
     npm start
     ```

The first start installs dependencies (about a minute); later starts take a few seconds. The game opens in your browser at [localhost:8787](http://localhost:8787). Keep the window open while you play and press **Ctrl+C** (or close the window) to stop. If port 8787 is busy, the next free port is used; `npm start -- --port 9000` picks one.

If macOS refuses to open a downloaded `start.command`, open **System Settings → Privacy & Security** and choose **Open Anyway**, or run `npm start` in Terminal instead.

**No API keys are needed.** Without keys the server uses deterministic offline models: open **My archive → Library** and pick a sample lesson. For your own material, choose OpenAI or Google Gemini in **Settings** and paste a key (or put it in a `.env` file, see below). Arbitrary uploads in offline mode use a limited heuristic and can fail coverage.

## Current game

- **Centered main menu:** Play, My archive, Settings and Music on/off.
- **Create New Dungeon:** inside My archive, upload files, paste notes, or combine both in one form with one dungeon title. All sources are prepared together.
- **Source-grounded preparation:** PDF, Markdown and plain-text uploads, plus pasted notes. The planner normally groups a lecture into 3–5 complete lessons (1–2 for short material, at most 6), with descriptions and teaching objectives. Source-concept coverage and question quality are checked before preparation completes.
- **Teach topic by topic:** a lesson book with an overview, topic pages and review. A floating Talk to Pip / Pip has a question bubble opens the teaching conversation. Feedback distinguishes new notes, unclear explanations and unrelated messages; incorrect teaching can become a misconception in Pip's notebook.
- **Readable combat feedback:** room encounters, a final dragon exam, hit animations and a persistent turn outcome above Next turn. Click the outcome to open that turn in the battle log. The expedition report shows room progress, correct/total answers, accuracy and weak points.
- **Navigation and saved progress:** Rooms and Pause open the lesson/progress menu. Pausing freezes pending help deadlines. My archive lists **Your saved dungeons** and their expeditions: resume, end or remove an expedition, or delete an entire dungeon after confirmation.
- **Music transitions:** scene and battle tracks fade out and in; the music preference is remembered in the browser.
- **On-device dictation only:** Dictate uses the browser's local speech recognition when available (live text, e.g. recent desktop Chrome with the language pack); otherwise it records a short clip and transcribes it inside the page with an open speech model (Moonshine base, MIT, English) via transformers.js. That model (about 63 MB) downloads once from Hugging Face/jsDelivr and is cached by the browser. Audio is never uploaded, and there is no cloud transcription backend.

Preparation shows stage/task progress and, when supplied by OpenAI, public reasoning summaries. These summaries are optional and are not the model's private chain of thought. You can start with a ready selected room while later rooms continue preparing.

## What's in this repository

| Folder | What it is |
|---|---|
| `client/` | The game: a 2D pixel-art dungeon built with Phaser AE. Source in `client/game/`; the ready-to-serve build in `client/dist/`. |
| `server/` | The backend: API, game engine, material ingestion and retrieval. Node and TypeScript. It also serves the game. |
| `shared/` | Public Zod contracts and a dependency-free API client, used by both the server and the game. |
| `samples/` | Two sample course handouts with their prebuilt course packs, plus `rock-paper-scissors.pdf` to try uploading your own material. |
| `scripts/` | The one-command launcher (`start.mjs`), the offline HTTP gauntlet and the API doc generator. |
| `docs/` | Architecture, spec, API reference, state machine, ingest pipeline, and marketing art. |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Configuration

Everything has a default, so a `.env` file is optional. To use one, copy `.env.example` to `.env` and fill in what you need:

| Variable | What it is |
|---|---|
| `LLM_PROVIDER` | `openai`, `gemini` or `mock`. Without an explicit selection, a Gemini key takes precedence, then OpenAI, then mocks. |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Credentials for the selected provider. Document preparation, teaching, grading and embeddings use that provider; live requests may incur usage charges. |
| `OPENAI_MODEL` / `GEMINI_MODEL` | Generation model names. Choose a model available to your account; embedding models are configured separately. |
| `MONGODB_URI` | Optional MongoDB connection string. Without it, everything is saved on disk in `.local/archive/`. |
| `PORT` | The port for the game and API (default 8787). |

Every other setting is described in `.env.example`.

**Settings in the game** (OpenAI, Google Gemini or Offline; models; keys; timeouts) apply without a restart. Keys are write-only, stored by the server in the ignored `.local/api-settings.json` with owner-only permissions, and override `.env`. Only the non-secret backend URL is kept in the browser. Setup is limited to the server's own machine. During preparation, **Thinking** below Stage shows task progress and, from OpenAI, public reasoning summaries; these are not the model's private chain of thought.

**Storage.** Prepared courses, notebooks and expeditions survive restarts in `.local/archive/` (ignored by Git); original upload bytes are not kept. With `MONGODB_URI` set, the same data goes to MongoDB (default database `pips_notebook`; set `MONGODB_DB` to keep an existing one), with Atlas vector search when available. A failed connection falls back to local storage; [API health](http://localhost:8787/api/health) reports `storage`. Setting a URI does not migrate local data. This is a shared local archive, not separate user accounts. **Remove expedition** deletes one run; **Delete dungeon** deletes a prepared course and all its runs, never your source files. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#storage-and-the-archive).

## Commands

Run these from the repository root.

| Command | What it does |
|---|---|
| `npm start` | Installs dependencies if needed, starts the game and API on one port, and opens the browser. |
| `npm run dev` | Starts the same server in watch mode, restarting on backend changes. |
| `npm test` | Runs the test suite, including a check that the committed game build matches the game source. |
| `npm run typecheck` | Type-checks `shared` and `server`. |
| `npm run e2e` | Plays a full gauntlet against an isolated mock API and prints a transcript. `-- --sample binary-search` checks the other sample. |
| `npm run build:game` | Rebuilds the game into `client/dist/`. Needs the Phaser AE toolkit (see below). |
| `npm run dev:game` | The game's live-rebuilding preview on port 4173, talking to the API on 8787. Needs the toolkit. |
| `npm run ingest -- samples/seasons.md` | Builds a course pack from a file and writes it to `samples/cache/`. |
| `npm run llm:smoke` | Calls each model task using the saved/environment provider. Skips in Offline mode. |
| `npm run docs:api` | Rebuilds the API reference from captured HTTP examples (`npm run e2e -- --capture-file docs/api-examples.json` refreshes them). |

## Demo script

1. Start the game ([Play it](#play-it)); it opens at [localhost:8787](http://localhost:8787).
2. Open **My archive**, pick the **Why Earth Has Seasons** sample from Library, select rooms and a target grade, then start. Pip is your apprentice throughout the game.
3. **Learning.** Open Talk to Pip, explain each topic and answer follow-up questions. Check the notebook and review the lesson before sending Pip to fight.
4. **Room fight.** Press **Next turn** and watch Pip answer from the notebook. Click the turn outcome to inspect the answer, cited notes and grading. Use Rooms or Pause to inspect lesson progress without losing your place.
5. **"Help me!"** Now and then the student asks you to solve a question yourself, with a time budget that depends on how hard the question is.
6. **Boss.** The exam mixes every concept and aims questions at the wrong beliefs still in the notebook.
7. **Results.** The predicted grade, whether you met your target, and the misconceptions that cost you, each with the page and section of the material that covers it.

For backend development, `DEBUG=true` enables the protected debug endpoint. Hidden answer keys and misconception state must stay out of normal gameplay screens.

For a shorter demo, set `DEMO_MODE=true`: rooms have 3 questions and the boss has 6.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the game, server and contracts fit together, model providers, storage, and how the game uses the API.
- [docs/API.md](docs/API.md): every endpoint with a real request and response.
- [docs/STATE_MACHINE.md](docs/STATE_MACHINE.md): the phases of a run and which action is allowed when, including pause and end.
- [docs/INGEST.md](docs/INGEST.md): how uploaded material becomes lessons and a verified question bank.
- [docs/FRONTEND_VARIABLES.md](docs/FRONTEND_VARIABLES.md): public API fields and state mapped to the game's screens.
- [client/game/README.md](client/game/README.md): the game's source map and frontend behavior.
- [docs/SPEC.md](docs/SPEC.md) and [docs/DECISIONS.md](docs/DECISIONS.md): the game rules and the choices made along the way.

## Changing the game

The game is built with Phaser AE. `client/dist/` holds a committed build, so playing never needs the Phaser toolchain. Changing game code does: restore the toolkit once (sign in with your own Phaser account when asked), then rebuild and commit `client/dist/` with your change.

```sh
cd client
npx -y @phaser-ae/cli@0.8.0 setup
npx -y @phaser-ae/cli@0.8.0 update
node restore-packs.mjs
npm run build
```

The update command may warn that the game did not bake; the next two commands restore the packs and build. After that, `npm run build:game` (from the root) rebuilds, and `npm run dev:game` serves a live preview on port 4173. `npm test` fails if `client/dist/` is older than the game source. The entry point is `client/game/main.ts`; lesson, combat, archive and settings screens are in `client/game/course/`. `?mock=1` runs the game's own canned practice API with no backend at all.

Hosted Phaser publishing and crew commands require the owner to link an accessible hosted build.

Known verification limits: the native `npm run smoke` simulator fails at the frontend's DOM dependency (`document is not defined`). On-device speech recognition and audible music transitions need manual checks in a supporting browser; a full fresh-upload, live-model boss/results playthrough is not claimed.

## Artwork

[3:2 thumbnail](docs/marketing/pips-notebook-thumbnail-3x2.png) · [original landscape variant](docs/marketing/pips-notebook-thumbnail-v2.png)

The thumbnails use the game's official title, **Pip's Notebook**. Exact image prompts are kept beside the PNGs in `docs/marketing/`.

## Credits

Libraries and services this project uses:

| Library or service | Used for | License |
|---|---|---|
| [Phaser AE](https://phaser.io) (`@phaser-ae/cli`) | The game in `client/` | Phaser AE terms |
| [Fastify](https://fastify.dev), [`@fastify/cors`](https://github.com/fastify/fastify-cors), [`@fastify/multipart`](https://github.com/fastify/fastify-multipart), [`@fastify/static`](https://github.com/fastify/fastify-static) | The HTTP API, file uploads and serving the game | MIT |
| [Zod](https://zod.dev), [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema) | Data schemas and structured model output | MIT, ISC |
| [`@google/genai`](https://github.com/googleapis/js-genai) with the Google Gemini API | The AI student, grading, course pack generation, embeddings | Apache-2.0 |
| [OpenAI API](https://platform.openai.com/docs) (called directly over HTTPS, no SDK) | Optional second provider for the AI student, grading, course pack generation and embeddings | OpenAI terms |
| [MongoDB Node.js driver](https://github.com/mongodb/node-mongodb-native) with MongoDB Atlas Vector Search | Storage and vector search | Apache-2.0 |
| [`unpdf`](https://github.com/unjs/unpdf) | PDF text extraction | MIT |
| [`pdf-lib`](https://pdf-lib.js.org) | Generating small PDFs inside tests | MIT |
| [`dotenv`](https://github.com/motdotla/dotenv) | Loading `.env` | BSD-2-Clause |
| [TypeScript](https://www.typescriptlang.org), [`tsx`](https://tsx.is), [Vitest](https://vitest.dev) | Language, running TypeScript, tests | Apache-2.0, MIT, MIT |

The game, backend and docs were developed during the event with help from Claude Code and Codex.
