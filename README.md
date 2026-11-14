# Teach or Perish

Teach an apprentice using your course material, answer its follow-up questions, and watch it fight from its notebook. The final exam returns a predicted grade and a study guide with references to your material.

## Run locally

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

## Connect the backend

In a separate checkout of the team's `Dev/backend` branch, install Node.js 22 or later and run `npm ci` followed by `npm run dev:server`. Its default local configuration uses a mock language model and in-memory storage. Backend credentials belong on the server.

Open [the game](http://localhost:4173). Live play uses `http://localhost:8787` by default. To use another server, set `?api=https://your-server.example` (origin only). Allow the game's origin in the server's `CORS_ORIGINS`. File and pasted-text submissions are sent to that server. The game stores the run ID in the URL so reloading restores the server's current phase, notebook, fight log and pending help.

For an offline demonstration, use [practice mode](http://localhost:4173/?mock=1). This uses the team's canned seasons course, scripted turns and example report. The practice run survives refreshes in the same tab. A live server with a mock language model still uses the default live URL.

## Verify

From the inner game folder, run `npm run build`. Install test Chromium once with `npx -y @phaser-ae/cli@0.8.0 doctor --fix`. Run `node tests/playthrough.mjs` for the offline playthrough or `node tests/live-course.mjs` with the local server and preview running for a real HTTP smoke test.
