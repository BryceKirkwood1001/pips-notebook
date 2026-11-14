# Frontend/backend integration

The main site is the Phaser AE game at **http://localhost:4173**. Its backend API runs separately at **http://localhost:8787/api**. API setup, uploads, saved dungeons and gameplay all belong to the main site.

## Running the project

Use Node.js 22 or later. The root npm workspaces are `shared` and `server`; the game keeps its separate Phaser AE toolchain.

From the repository root, on a fresh checkout:

```sh
npm ci
cp .env.example .env
npm run dev:server
```

Keep an existing `.env` rather than overwriting it. With no provider credentials or saved provider selection, the backend uses mock model tasks. Bundled sample courses need no credentials; arbitrary uploads can fail mock coverage. The normal server persists its archive locally unless MongoDB is configured.

Restore the game's runtime and packs as described in the [root README](../README.md#the-phaser-game). Then, in another terminal at the repository root:

```sh
npm run build:game
npm run dev:game
```

Open [the game](http://localhost:4173). Live HTTP API mode is the default. `?api=<server-origin>` selects another backend; `?mock=1` selects the game's independent canned browser practice mode. Default CORS allows only the main game's local origin; configure `CORS_ORIGINS` for another deployment.

Root `.claude/launch.json` starts the main game and API. The inner game's launch configuration also targets the same game port.

## Current integration

- `pips-notebook/game/main.ts` registers Title, Upload, Learning, Fight, Boss, Results, Settings and Menu.
- `game/course/api-client.ts` mirrors `shared/src/api-client.ts`. Keep these synchronized when changing contracts.
- Settings configures OpenAI, Gemini or Offline mode, write-only credentials, generation/embedding models and timeouts. See [API settings](API_SETTINGS.md).
- Whole-course planning groups related topics into complete lessons with descriptions and objectives; preparation verifies source coverage.
- Learning uses topic pages and Pip's notebook. Combat renders canonical server outcomes and links the latest turn to the battle log.
- Rooms and Pause use server pause/resume; help deadlines freeze while paused. Completed help events refresh canonical run/notebook state, and expired help settles through `turn`.
- My archive lists saved dungeons and expeditions. End retains an expedition as a read-only record; Remove deletes only a run; Delete dungeon removes its prepared data and associated runs.
- Courses, source chunks, question banks, statistics and runs persist across backend restarts. Original upload bytes are not retained. See [archive behavior](ARCHIVE_AND_LESSONS.md).

## Verification

```sh
npm test
npm run typecheck
npm run e2e
npm run e2e -- --sample binary-search
npm run build:game
```

The root type check covers backend/shared contracts; the game build checks its own TypeScript. The HTTP gauntlets use an isolated mock server. Existing browser scripts need updating for current controls; the native headless smoke simulator still fails on the DOM-dependent frontend. Consult the [continuation log](CONTINUATION_LOG.md) for recorded browser/live-model checks and remaining verification limits.

## Merge provenance

The original integration branch was created on November 13, 2026 from backend parent `79e45cb` and frontend parent `3f6d959` without flattening their histories. The Phaser AE runtime was subsequently restored with the pinned CLI, engine and manifest packs. Generated runtime files and credentials stay outside version control. Historical checkpoint results remain in the continuation log; current setup is documented here and in the root README.
