# Teach or Perish

The Phaser AE entry point in `main.ts` registers the title, course picker, learning, room fight, boss and report. The shared environment art and combat sprites are in `art.ts` and `media/`.

The public backend contract lives in `course/api-client.ts`. The files under `course/` implement course ingestion, notebook teaching, fight turns, timed help and results. `app.ts` owns the current public run, navigation and request recovery. The server owns scoring, health, retry and progress. `mock.ts` supplies the canned API for offline practice. See the repository README for commands and test modes.
