# Teach or Perish

A 2D pixel-art dungeon game about teaching an AI apprentice. This starter has a title screen and the Phaser AE example scenes.

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

Edit scenes in `teach-or-perish/game/scenes/`. Run `npm run build` from `teach-or-perish/` to check your changes. For the headless smoke test, install Chromium once with `npx -y @phaser-ae/cli@0.8.0 doctor --fix`, then run `npm run smoke`.
