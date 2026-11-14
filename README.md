# Pip's Notebook

A turn-based dungeon game where you can't fight. You can only teach.

Upload your course material, teach Pip what's in it, then send Pip into the dungeon. Pip writes down what you explain and asks questions when something is unclear. In battle, Pip answers using **only that notebook**: never your material and never the answer key. Whatever you left out or taught wrong shows up in the fight.

The final boss is an exam on the rooms you chose. The results show a predicted grade and the parts of your material to revisit. The grade is a game estimate, not a prediction of a real exam score.

![](docs/marketing/pips-notebook-thumbnail-3x2.png)

## Play it

1. Install **Node.js 22 or later** (the LTS from [nodejs.org](https://nodejs.org) works). It includes npm.
2. Get this repository: `git clone` it, or use **Code → Download ZIP** on GitHub and unzip it.
3. Start it:
   - **macOS:** double-click `start.command`.
   - **Windows:** double-click `start.bat`.
   - **Any terminal**, including Linux, from the repository folder:

     ```sh
     npm start
     ```

The first start downloads dependencies, so it needs an internet connection and takes about a minute. Later starts take a few seconds. The game opens in your browser at [localhost:8787](http://localhost:8787). Keep the window open while you play; press **Ctrl+C** or close the window to stop.

- If Pip's Notebook is already running, starting it again opens the running game instead of a second copy.
- If another program is using port 8787, the next free port is used. To choose one: `npm start -- --port 9000`.
- If macOS won't open a downloaded `start.command`, go to **System Settings → Privacy & Security** and choose **Open Anyway**, or run `npm start` in Terminal.

**No API key is needed to try it.** A fresh install runs in **Offline** mode, which uses canned AI responses. Open **My archive → Library** and pick one of the sample lessons. To play with your own material, choose OpenAI or Google Gemini in **Settings** and paste a key. Uploads in Offline mode use a simple heuristic and often fail to prepare.

## How a game works

| In the game | What it means |
|---|---|
| **Dungeon** | A course prepared from your material: PDF, Markdown or plain-text files and pasted notes, up to 25 MB and 300 pages. Create one under **My archive → Create New Dungeon**. |
| **Room** | One lesson in the dungeon, with a description and teaching goals. With an AI provider, a lecture usually becomes 3–5 rooms (1–2 for short material, never more than 6). |
| **Topic** | One idea inside a room. You teach a room topic by topic. |
| **Notebook** | What Pip wrote down from your teaching. It is Pip's only source in battle. |
| **Wrong belief** | A common misconception about a topic. If you teach it, or skip Pip's question about it, it goes into the notebook looking like any other note. |
| **Expedition** | One playthrough of a dungeon, from the first room to the results. Expeditions are saved in **My archive**, where you can resume, end or remove them. |
| **"Help me!"** | Now and then Pip asks you to answer a question yourself, with a timer based on how hard it is. |

A room has two halves. In the **lesson**, open **Talk to Pip**, explain each topic and answer Pip's questions; **Pip has a question!** means one is waiting. Then press **Ready: go fight** and use **Next turn** to watch Pip answer from the notebook. Each turn shows Pip's answer, reasoning, the notes Pip used and the correct answer. If Pip runs out of hearts, **Retry** returns to the lesson with the notebook kept and hearts refilled. The boss exam covers every room in the expedition, and up to half of its questions aim at wrong beliefs still in the notebook.

Other things in the game:

- **Rooms** and **Pause** open the expedition menu without losing your place, and pausing stops "Help me!" timers.
- **Dictate** turns speech into text using your browser's speech recognition. If the browser can do it on your computer (recent Chrome with the language downloaded), the audio stays there. Otherwise Chrome, Edge and Safari send your voice to Google, Microsoft or Apple to turn it into text; the Dictate button, the listening message and Settings say so. Browsers without speech recognition, such as Firefox, download an open speech model once (Moonshine base, about 63 MB, from jsDelivr and Hugging Face) and run it in the page, so the audio stays on your computer.
- While a dungeon is being prepared, **Thinking** shows progress and, with OpenAI, the model's public reasoning summary (not its private reasoning). You can start an expedition as soon as its first room is ready.
- Music changes with each scene. The **Music** button on the title screen and in the header turns it off, and your browser remembers the choice.

## How it's built

One Node.js process runs everything. The server (Fastify, TypeScript run directly by `tsx`, no build step) serves the game at `/` and the API under `/api`. It keeps all game state and makes every AI call, so API keys never reach the browser. The game is a Phaser AE project whose prebuilt copy is committed in `client/dist/`, so playing never needs the Phaser tools.

| Path | What it is |
|---|---|
| `client/` | The game. Source in `client/game/` (screens in `client/game/course/`), prebuilt copy in `client/dist/`. |
| `server/` | API, game rules, course preparation, search over your material, AI providers and storage. Also serves the game. |
| `shared/` | The data contracts (Zod schemas) the server checks every request against, and the API client the game and scripts use. |
| `samples/` | Two sample handouts with ready-made dungeons, plus `rock-paper-scissors.pdf` for trying an upload. |
| `scripts/` | `start.mjs` (what `npm start` runs), the offline end-to-end test and the API doc generator. |
| `docs/` | Architecture, API reference, run phases, course preparation, rules and decisions, and marketing art. |
| `start.command`, `start.bat` | Double-click launchers for macOS and Windows. Both run `scripts/start.mjs`. |

The game needs the internet only for an AI provider, the first install, and dictation (your browser's speech service, or the one-time model download). The server listens on every network interface, so other devices on your network can open the game at your computer's address; changing Settings works only from the computer running it. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Configuration

A fresh install needs no configuration. To set things before the first start, copy `.env.example` to `.env`:

| Variable | What it does |
|---|---|
| `LLM_PROVIDER` | `openai`, `gemini` or `mock` (Offline). If unset: Gemini when `GEMINI_API_KEY` is set, otherwise OpenAI when `OPENAI_API_KEY` is set, otherwise Offline. |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | Keys for the provider. It prepares dungeons, plays Pip, grades written answers and creates search embeddings. Live calls cost API credit. |
| `OPENAI_MODEL`, `GEMINI_MODEL` | Models for writing and answering. Embedding models are set separately: `OPENAI_EMBEDDING_MODEL` for OpenAI, `EMBEDDING_MODEL` for Gemini. |
| `MONGODB_URI`, `MONGODB_DB` | Optional MongoDB storage (default database `pips_notebook`). Without it, data is saved in `.local/archive/`. Easier: **Settings → MongoDB**. |
| `PORT` | Port for the game and API (default 8787). |
| `DEMO_MODE` | `true` for a shorter game: 3 questions per room, 6 in the boss, and tighter "Help me!" timers. |
| `DEBUG` | `true` turns on the developer endpoint that shows hidden answers. Never use it for real play. |

Every other setting is explained in `.env.example`.

**Settings in the game** override the AI settings in `.env` and apply immediately. The server saves them in `.local/api-settings.json`, readable only by your user account. Keys can be replaced or removed but never read back. To return to the `.env` values, stop the game, delete that file and start again.

**Your saved data** lives in `.local/` (ignored by Git): prepared dungeons, notebooks and expeditions survive restarts, but your original files are not kept. To keep it in MongoDB instead, open **Settings → MongoDB**, paste your connection string, **Test connection**, then **Save & switch**. The game switches right away, and can copy your saved dungeons across; nothing is deleted from where they were. The choice is saved in `.local/storage-settings.json` and overrides `MONGODB_URI`. If MongoDB can't be reached when the game starts, it uses `.local/` and the MongoDB tab says why. Atlas Vector Search is used when available. Everyone who opens the game shares one archive; there are no user accounts. **Remove expedition** deletes one playthrough. **Delete dungeon** deletes the prepared course and all its expeditions, never the files on your computer.

## Commands

Run these from the repository folder.

| Command | What it does |
|---|---|
| `npm start` | Installs dependencies when needed, starts the game and API, and opens the browser. |
| `npm run dev` | Runs the server and restarts it when server code changes. Install dependencies first (`npm ci`). |
| `npm test` | Runs the tests, including a check that `client/dist/` is up to date with the game source. `npm run test:watch` reruns on changes. |
| `npm run typecheck` | Type-checks `server/` and `shared/`. The game's own check is `npm --prefix client run typecheck`, which needs the Phaser tools. |
| `npm run e2e` | Plays a full game against a temporary Offline server and prints the transcript. Add `-- --sample binary-search` for the other sample. |
| `npm run build:game` | Rebuilds `client/dist/` from the game source. Needs the Phaser tools (below). |
| `npm run dev:game` | Live-rebuilding game preview at localhost:4173, using the API on port 8787. Needs the Phaser tools. |
| `npm run ingest -- <file>` | Prepares a dungeon from a file and saves it to `samples/cache/`, which adds it to the built-in samples. Uses the configured provider. |
| `npm run llm:smoke` | Makes one live call for each in-game AI task plus one embedding, to check a provider works. Skipped in Offline mode. |
| `npm run docs:api` | Rebuilds `docs/API.md` from recorded requests. `npm run e2e -- --capture-file docs/api-examples.json` records new ones. |

## Demo script

1. Start the game ([Play it](#play-it)).
2. Open **My archive → Library**, pick **Why Earth Has Seasons**, choose the rooms and a target grade, and start.
3. **Lesson.** Open **Talk to Pip**, explain each topic and answer Pip's questions. Check the notebook before pressing **Ready: go fight**.
4. **Room fight.** Press **Next turn** and watch Pip answer from the notebook. Click a turn to see Pip's answer, the notes Pip cited and how it was graded.
5. **"Help me!"** When Pip asks for help, answer before the timer runs out.
6. **Boss.** The exam covers every room you chose and goes after wrong beliefs left in the notebook.
7. **Results.** See the predicted grade, whether you met your target, and each wrong belief that cost points, with the page and section of your material that explains it.

## Changing the game

Playing uses the prebuilt copy in `client/dist/`. Changing game code means rebuilding it, which needs the Phaser AE tools. Install them once from the `client/` folder; the setup asks you to sign in with your own Phaser account:

```sh
cd client
npx -y @phaser-ae/cli@0.8.0 setup
npx -y @phaser-ae/cli@0.8.0 update
node restore-packs.mjs
npm run build
```

`update` may warn that the game did not build; the next two commands fix that. Afterwards, `npm run build:game` rebuilds from the repository folder. Commit `client/dist/` together with your code change: `npm test` fails when the prebuilt copy is older than the source. The game starts in `client/game/main.ts`. Add `?mock=1` to the game's address for **Practice mode**, where the page answers itself with canned data and never calls the server's API. `client/AGENTS.md` lists the other Phaser AE commands.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit, AI providers and Settings, storage, and how the game uses the API.
- [docs/API.md](docs/API.md): every endpoint with a real request and response.
- [docs/STATE_MACHINE.md](docs/STATE_MACHINE.md): the phases of an expedition and which action is allowed when.
- [docs/INGEST.md](docs/INGEST.md): how uploaded material becomes rooms and checked questions.
- [docs/FRONTEND_VARIABLES.md](docs/FRONTEND_VARIABLES.md): every public field, by game screen.
- [client/game/README.md](client/game/README.md): the game's source files.
- [docs/SPEC.md](docs/SPEC.md) and [docs/DECISIONS.md](docs/DECISIONS.md): the rules and the choices made along the way.

## Artwork

[3:2 thumbnail](docs/marketing/pips-notebook-thumbnail-3x2.png) · [landscape version](docs/marketing/pips-notebook-thumbnail-v2.png). The prompts used to make them are next to the images in `docs/marketing/`.

## Credits

| Library or service | Used for | License |
|---|---|---|
| [Phaser AE](https://phaser.io) | The game engine and build tools | PolyForm Shield 1.0.0, with permission to make and sell games |
| [Fastify](https://fastify.dev) with [`@fastify/cors`](https://github.com/fastify/fastify-cors), [`@fastify/multipart`](https://github.com/fastify/fastify-multipart) and [`@fastify/static`](https://github.com/fastify/fastify-static) | The server, uploads and serving the game | MIT |
| [Zod](https://zod.dev), [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema) | Data contracts and structured AI output | MIT, ISC |
| [`@google/genai`](https://github.com/googleapis/js-genai) and the Google Gemini API | AI provider | Apache-2.0 |
| [OpenAI API](https://platform.openai.com/docs), called directly over HTTPS | AI provider | OpenAI terms |
| [MongoDB Node.js driver](https://github.com/mongodb/node-mongodb-native), MongoDB Atlas Vector Search | Optional storage and search | Apache-2.0 |
| [`unpdf`](https://github.com/unjs/unpdf) | Reading PDF text | MIT |
| [Transformers.js](https://github.com/huggingface/transformers.js) with [Moonshine base](https://huggingface.co/onnx-community/moonshine-base-ONNX) | Dictation fallback, loaded in the browser when needed | Apache-2.0, MIT |
| [Silkscreen](https://fonts.google.com/specimen/Silkscreen) | Pixel font | SIL Open Font License (`client/game/media/OFL-Silkscreen.txt`) |
| [`dotenv`](https://github.com/motdotla/dotenv) | Reading `.env` | BSD-2-Clause |
| [TypeScript](https://www.typescriptlang.org), [`tsx`](https://tsx.is), [Vitest](https://vitest.dev), [`pdf-lib`](https://pdf-lib.js.org) | Language, running TypeScript, tests, test PDFs | Apache-2.0, MIT, MIT, MIT |

Art and music: **TODO, ask the team** who made the sprites, backgrounds and soundtrack in `client/game/media/`, and under what terms.

The game, server and docs were built during the event with help from Claude Code and Codex.
