# Teach or Perish

A browser game about teaching Pip, a young dungeon apprentice. Spend three energy per room on examples, analogies, questions, or counterexamples. Pip fights independently using the notebook you helped build. The final examination combines light paths, shadows, and reflection.

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

Play works without a network connection once the dependencies are installed and the game is built. To deploy the prototype, serve the contents of `teach-or-perish/dist/` from a static web server. Progress and selected file metadata last for the current page session.

## Mock services and gameplay

`game/lesson.ts` defines the planner, teaching, and answering contracts. Replace `MockLessonPlanner` to supply concepts, questions, and weights. Replace `MockStudent` and `MockAnswer` to interpret a notebook or generate answers. The planner supports promises and falls back to the demo on an invalid response. The student adapters are synchronous today. For networked replacements, await them in the run controller, disable repeat actions while pending, and retain the local fallback.

`game/run.ts` owns health, room snapshots, the notebook, and answer history. Room retries rewind all four. Files stay on the device; only metadata reaches the demo planner. Typed notes are saved verbatim. Teaching-card choices determine the mock learning outcomes. Final health is a gameplay score.

`game/main.ts` connects Phaser scenes to the run. `game/art.ts` renders and animates the local images in `game/media/`. `game/interface.ts` provides the accessible HTML controls and reports.

## Verify

From the inner project directory, run `npm run build`. For a full browser playthrough, install Chromium once with `npx -y @phaser-ae/cli@0.8.0 doctor --fix`, then run `node tests/playthrough.mjs`. The check serves the built game locally and blocks external requests.
