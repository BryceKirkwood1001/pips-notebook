# Teach or Perish

Run the game from the parent Phaser project directory with `npm run serve`. The repository README covers installation, static hosting and playthrough checks.

- `main.ts` registers the title, setup, room, boss and report scenes.
- `run.ts` owns a single run and restores exact room-entry snapshots on retry.
- `lesson.ts` defines the demo curriculum, card rules and mock service contracts.
- `interface.ts` handles browser controls and notebook/report views.
- `art.ts` and `media/` supply local pixel art, effects and styling.

The running game needs no API keys. Only filenames, sizes and types are retained during a run. The example scenes under `scenes/` are starter references; the prototype uses the scene registration in `main.ts`. The engine manual is in `docs/make-a-2d-game.md`.
