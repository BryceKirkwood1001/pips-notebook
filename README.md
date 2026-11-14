# Teach or Perish

A turn-based dungeon game where you can't fight. You can only teach.

You upload your own course material. An AI student, who starts out knowing nothing, has to get through a gauntlet of rooms built from that material, one room per concept, and then a final boss that is the exam. Before each room you explain the concept. The student writes what you said into its notebook and asks the kind of naive questions that expose common misconceptions. In the fights the student answers questions using **only its notebook**, so good teaching wins and gaps or wrong ideas lose. The health left after the boss is your predicted exam grade, and the results list the misconceptions that cost you, with the page of your material that covers each one.

Built at HackPrinceton (November 13 to 15, 2026).

## What's in this repository

| Folder | What it is |
|---|---|
| `teach-or-perish/` | The game itself: a 2D pixel-art dungeon built with Phaser AE. See [The Phaser game](#the-phaser-game). |
| `server/` | The backend: API, game engine, material ingestion and retrieval. Node and TypeScript. |
| `shared/` | The data contracts (Zod schemas) and a dependency-free API client that front ends copy. |
| `test-client/` | A throwaway Phaser 3 test harness with emoji sprites that plays the whole loop against the API. |
| `samples/` | Two sample course handouts and their prebuilt course packs. |
| `docs/` | Spec, API reference, state machine, ingest pipeline, and the guide for wiring the game to the backend. |
| `scripts/` | The end-to-end script that plays a full gauntlet. |

## Backend quick start

You need **Node.js 22 or later**.

```sh
npm install
cp .env.example .env
npm run dev:server
```

The API is now on [localhost:8787/api](http://localhost:8787/api/health). In a second terminal, start the test client and open [localhost:5174](http://localhost:5174):

```sh
npm run dev:client
```

**No keys are needed to try it.** With an empty `.env` the server uses built-in deterministic mocks in place of the language model and keeps everything in memory, and the two sample courses load instantly.

To use the real model and database, fill these in `.env`:

| Variable | What it is |
|---|---|
| `GEMINI_API_KEY` | A Google Gemini API key. With a key the server uses Gemini for the student, grading, and building course packs from uploads. |
| `MONGODB_URI` | A MongoDB Atlas connection string. A free M0 cluster is enough. The server creates its collections and the vector search index on startup. |

Every other setting has a default and is described in `.env.example`.

### Setting up MongoDB Atlas

1. Create a free **M0** cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. Under **Database Access**, add a database user with read and write access.
3. Under **Network Access**, allow your IP address.
4. Click **Connect**, choose **Drivers**, and copy the connection string into `MONGODB_URI` in `.env`, with the user's password filled in.

The first start creates the `chunks_vector` search index. Atlas takes a minute or so to build a new index; until it is ready the server ranks chunks in memory, so nothing needs to wait.

### Commands

Run these from the repository root.

| Command | What it does |
|---|---|
| `npm run dev:server` | Starts the API on port 8787 and restarts on changes. |
| `npm run dev:client` | Starts the test client on port 5174. |
| `npm test` | Runs the test suite. |
| `npm run e2e` | Plays a full gauntlet against the API with mocks and prints a transcript. |
| `npm run typecheck` | Type-checks `shared`, `server` and `test-client`. |
| `npm run ingest -- samples/seasons.md` | Builds a course pack from a file and writes it to `samples/cache/`. |
| `npm run llm:smoke` | Calls each model task once. Skips itself when there is no `GEMINI_API_KEY`. |

## Demo script

1. Start the server and the test client (above) and open [localhost:5174](http://localhost:5174).
2. Pick the **seasons** sample. It loads instantly. Choose a target grade and a student, then start.
3. **Learning.** Explain why Earth has seasons. Watch the student's notebook fill in, then answer its questions. Skip one on purpose: the student writes down a wrong belief that looks like any other note.
4. **Room fight.** Press **Next turn** and watch the student answer from its notebook. Teach badly and it fails; the game shows the reasoning and the exact notes behind each wrong answer, and you go back to teach again.
5. **"Help me!"** Now and then the student asks you to solve a question yourself, with a time budget that depends on how hard the question is.
6. **Boss.** The exam mixes every concept and aims questions at the wrong beliefs still in the notebook.
7. **Results.** The predicted grade, whether you met your target, and the misconceptions that cost you, each with the page and section of the material that covers it.

Press **D** in the test client to see the hidden state (which notes are wrong beliefs, answer keys, where each question came from). This needs `DEBUG=true` in `.env`.

For a shorter demo, set `DEMO_MODE=true`: rooms have 3 questions and the boss has 6.

## Docs

- [docs/API.md](docs/API.md): every endpoint with a real request and response.
- [docs/STATE_MACHINE.md](docs/STATE_MACHINE.md): the phases of a run and which action is allowed when.
- [docs/PHASER_INTEGRATION.md](docs/PHASER_INTEGRATION.md): how to wire the Phaser game to the backend.
- [docs/INGEST.md](docs/INGEST.md): how uploaded material becomes a verified question bank.
- [docs/SPEC.md](docs/SPEC.md) and [docs/DECISIONS.md](docs/DECISIONS.md): the game rules and the choices made along the way.

## The Phaser game

The game in `teach-or-perish/` is built with Phaser AE and is set up separately from the backend.

Install Node.js 20 or later. From the repository root, enter the project folder:

```sh
cd teach-or-perish
```

On a fresh clone, sign in with your own Phaser account and restore the engine and packs:

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

Edit scenes in `teach-or-perish/game/scenes/`. Run `npm run build` from `teach-or-perish/` to check your changes. For the headless smoke test, install Chromium once with `npx -y @phaser-ae/cli@0.8.0 doctor --fix`, then run `npm run smoke`.

## Credits

Libraries and services this project uses:

| Library or service | Used for | License |
|---|---|---|
| [Phaser AE](https://phaser.io) (`@phaser-ae/cli`) | The game in `teach-or-perish/` | Phaser AE terms |
| [Phaser 3](https://phaser.io) | The test client | MIT |
| [Vite](https://vite.dev) | Test client dev server and build | MIT |
| [Fastify](https://fastify.dev), [`@fastify/cors`](https://github.com/fastify/fastify-cors), [`@fastify/multipart`](https://github.com/fastify/fastify-multipart) | The HTTP API and file uploads | MIT |
| [Zod](https://zod.dev), [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema) | Data schemas and structured model output | MIT, ISC |
| [`@google/genai`](https://github.com/googleapis/js-genai) with the Google Gemini API | The AI student, grading, course pack generation, embeddings | Apache-2.0 |
| [MongoDB Node.js driver](https://github.com/mongodb/node-mongodb-native) with MongoDB Atlas Vector Search | Storage and vector search | Apache-2.0 |
| [`unpdf`](https://github.com/unjs/unpdf) | PDF text extraction | MIT |
| [`pdf-lib`](https://pdf-lib.js.org) | Generating small PDFs inside tests | MIT |
| [`dotenv`](https://github.com/motdotla/dotenv) | Loading `.env` | BSD-2-Clause |
| [TypeScript](https://www.typescriptlang.org), [`tsx`](https://tsx.is), [Vitest](https://vitest.dev) | Language, running TypeScript, tests | Apache-2.0, MIT, MIT |

The backend, test client and docs were written during the event with help from Claude Code.
