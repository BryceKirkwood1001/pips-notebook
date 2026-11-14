# Pip's Notebook

The Phaser AE entry point in `main.ts` registers the title, course picker, learning, room fight, boss and report. The shared environment art and combat sprites are in `art.ts` and `media/`.

The public backend contract lives in `course/api-client.ts`. The files under `course/` implement course ingestion, notebook teaching, fight turns, timed help and results. `app.ts` owns the current public run, navigation and request recovery. The server owns scoring, health, retry and progress. `mock.ts` supplies the canned API for offline practice. See the repository README for commands and test modes.

My archive has Library and Create New Dungeon sections. The creation form shows optional Files and Notes subsections together, one title and one Create dungeon action; either source or both can create the same course. Notes supplied with files become a separate Markdown source, and switching sections retains the draft. Learning and combat use `RoomView` in `course/page.ts` for parchment conversation, notebook and battle chronicle panels; drafts survive closing or switching books. `art.ts` controls the student/monster sprite-sheet poses and attack animations.

The header's Settings button opens `course/Settings.ts`; `course/settings-view.ts` provides the API setup form within this game on port 4173. It supports OpenAI, Gemini and backend Offline mode. See `NOTES.md` and the root `docs/API_SETTINGS.md` for testing, storage behavior and remaining runtime limitations.
