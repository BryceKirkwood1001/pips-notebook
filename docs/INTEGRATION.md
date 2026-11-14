# Combined frontend/backend branch

Created `integration` at the user's request on November 13, 2026 (America/New_York), after fetching origin.

## Sources and merge

- Backend parent: `origin/Dev/backend`, `79e45cb` — backend, shared contracts, samples, reference harness, verification and handoff docs.
- Frontend parent: `origin/codex/teaching-dungeon-e964f8d`, `3f6d959` — actual Phaser AE game wired to the course/run API.
- Created the branch from the backend and merged the frontend without fast-forwarding, preserving both histories. The source branches and `main` were not changed.
- The only merge conflict was root `README.md`. Kept backend setup, commands, docs and library credits, then incorporated frontend startup, live/practice modes and test instructions. Replaced the frontend branch's separate-checkout advice with instructions for this combined checkout.
- Updated `PHASER_INTEGRATION.md` and the screen map in `FRONTEND_VARIABLES.md` to use the implemented `Title`, `Upload`, `Learning`, `Fight`, `Boss`, `Results` screens and `game/course/api-client.ts` path.
- The frontend code was merged as supplied. No gameplay code changes were added in this merge.

## Running the combined project

Use Node.js 22 or later for the complete project. Root npm workspaces remain `shared`, `server`, `test-client`; the Phaser game keeps its separate toolchain.

From the repository root:

```sh
npm ci
cp .env.example .env
npm run dev:server
```

The backend listens on `http://localhost:8787`. An empty `.env` uses mock LLM tasks and in-memory storage. The bundled sample courses need no credentials; arbitrary uploads can fail mock coverage.

In a second terminal, after restoring the local Phaser runtime/packs according to the root README:

```sh
cd teach-or-perish
npm run build
npm run serve
```

Open `http://localhost:4173` for the actual game using the backend. `?mock=1` selects the browser's independent canned practice API instead. `?api=<server-origin>` overrides the API origin. The default CORS settings already allow port 4173.

The reference harness remains available through root `npm run dev:client` on port 5174.

## Verification on this merge

| Check | Result |
|---|---|
| `npm test` | 319 tests passed across 29 files |
| `npm run typecheck` | Passed for shared, backend, scripts and reference harness |
| `npm run e2e` | Passed: full seasons HTTP gauntlet, failure/retry, boss/results and skipped-misconception assertion |
| `npm run e2e -- --sample binary-search` | Passed: full binary-search HTTP gauntlet and final assertions |
| Shared vs actual-game API client | Byte-for-byte identical |
| Actual Phaser `npm run build` | Blocked: the local `teach-or-perish/phaser/bin/bake.mjs` runtime is absent |

The resolved README and documentation pass the staged whitespace check. A full staged check also reports inherited blank lines at the ends of several frontend files and a trailing space in the supplied font license. These were preserved with the frontend source; no gameplay or license text was rewritten to remove formatting warnings.

The root type check does not include the actual Phaser game. Its native build and browser tests still need its locally restored runtime/packs. This merge did not install, authenticate or publish through Phaser, and does not claim the actual game has passed a combined browser walkthrough. Gemini/Atlas live validation remains unverified without credentials.

## Known frontend follow-ups from the branch review

1. `game/course/help.ts` auto-submits an empty short-text answer on timeout. The backend rejects that shape with `400 invalid_answer` before settling lateness, so the UI can reopen the same expired event. Call `/turn` on timeout to settle the event, or handle the empty timed-out answer explicitly. The backend rejection and recovery through `/turn` were reproduced during the review.
2. `game/course/battle.ts` appends a correct help note to the end of the local notebook. During a multi-concept boss, this can display it under the wrong concept until a refresh. Fetch the canonical run/notebook after help instead of guessing the section.

These issues predate this merge. They are documented here and remain unchanged in the combined source.

## Subsequent OpenAI / Settings implementation

The merged source now has an OpenAI provider and a `Settings` scene at the user's request. See [API_SETTINGS.md](API_SETTINGS.md) for controls, write-only credentials, local persistence, course embedding compatibility, implementation map and test results. The same styled form can be opened at `http://localhost:5174/api-settings.html` without the missing native runtime. The provider switch preserves courses/runs; changing the backend origin starts a new client session. Browser-only `?mock=1` continues to use canned practice data.

After this addition, 341 tests across 31 files pass, both sample HTTP workflows pass, and the shared/backend/harness type check plus harness/setup-page production build pass. Native Phaser validation is still blocked by the missing runtime. No live provider call, Atlas check or Phaser publish was performed.

## Runtime restored and styled game running

After the user asked to run the actual frontend, downloaded the official pinned `@phaser-ae/cli@0.8.0` from npm. Ran its `update` command from the inner game folder. The user completed Phaser sign-in/CLI authorization; the CLI installed engine `v3-82bf126`, its build dependencies and the local CLI. `node restore-packs.mjs` restored the existing manifest's packs/fonts. These generated runtime/pack files remain ignored by Git; credentials remain in the CLI's private user configuration.

`npm run build` now succeeds in the inner folder. `npm run serve` is left running at `http://localhost:4173/`, rebuilding on source changes. Backend port 8787 and reference harness port 5174 remain available. The CLI also changed `.claude/launch.json` from a Windows-specific Node path to portable `node`.

In the built-in browser, verified the actual title screen, Settings opening, OpenAI fields, Back navigation and Play loading both sample courses from the local backend. The game uses live HTTP mode with the backend's Offline model setting. No real model key/call, full native gameplay walkthrough, native smoke suite or publish was performed. Earlier missing-runtime statements in this document record the initial integration checkpoint; that startup blocker is now resolved.

## Later PDF timeout correction

After the user selected OpenAI `gpt-6-luna`, a 108-page upload hit the old 30-second request deadline. Added a separate configurable preparation budget (180 seconds by default), bounded outline batching with preserved evidence references, a Retry preparation control and operation-specific OpenAI timeouts. The original failed operation was not recorded by the old code. 348 tests, root type check, both frontend builds and the offline HTTP workflow pass. Restarted the backend with the user's saved provider/key retained; the PDF needs re-uploading. Full live ingestion of that document remains unverified. See [API_SETTINGS.md](API_SETTINGS.md) and the continuation log for all files and verification.

The subsequent Thinking-panel request is also implemented: optional public course activity drives a panel directly below Stage, with real page/task progress and available public OpenAI outline reasoning summaries. Active streams extend the idle timeout, with a ten-minute request cap. A real small GPT-6 Luna probe produced 85 summary updates and valid output in about 3.8 seconds. Current verification is 356 tests / 32 files, passing type check/native+harness builds and offline HTTP gauntlet. The screenshot in verification is an explicitly labeled synthetic UI fixture; the original PDF's full ingest is still unverified. Details and limitations are in the settings guide/log.

## Source-alignment and battle-feedback refinement

The user subsequently supplied the actual slide deck and asked to refine question prompts. [QUESTION_QUALITY.md](QUESTION_QUALITY.md) covers the new source-alignment policy, independent usefulness gate, rubric fix and live source-backed evaluation. Three relevant generated questions passed evidence/quality/key checks; the rhetorical machine-model question was rejected. The native battle now separates its title/status, fixes scrolling controls and renders distinct feedback/damage cards. Canonical post-help notebook refresh resolves the second frontend follow-up noted above; the timed empty short-text help timeout follow-up remains.

Current checks at the refinement checkpoint: 360 tests / 32 files, type check, native/harness builds and isolated offline HTTP workflow pass. The user subsequently requested a restart; the refined prompts are now active on 8787. Saved provider settings were retained and in-memory courses/runs cleared. Existing material needs fresh preparation to reflect new prompts.

## New teaching-dungeon design integrated (November 14)

Merged `origin/codex/teaching-dungeon-e964f8d` through `5991240`, including `10d97b3`, into `integration`. The previous tested integration work is preserved in local checkpoint `96f6b7b`.

| Files | Integrated behavior |
| --- | --- |
| `game/art.ts`, `manifest.json`, seven new sprite sheets | Idle, writing, hand-raising, understanding and attack animations; full room background |
| `game/course/Upload.ts` | Library / Files / Notes archive tabs, file picker and expedition setup; retains retry and Thinking progress |
| `game/course/page.ts`, `Learning.ts` | Reusable parchment books, Talk to Pip cue, notebook inventory, draft preservation and Escape/Close |
| `game/course/battle.ts`, `battle-feedback.ts` | Notebook and battle chronicle books, animated result cues; retains clear feedback, separate status/title, explicit damage and canonical run refresh |
| `game/media/game.css`, `test-client/src/settings-preview.ts` | New parchment/wine/brass styling; API setup and preview adapted to the same folio frame |
| `tests/playthrough.mjs`, `tests/live-course.mjs` | Upstream scenarios updated for the new archive/conversation controls |

Resolved conflicts in `battle.ts` and `game.css`. Moved animation/result cues after both canonical refresh and fallback paths, so successful refreshes do not bypass the new cue. No backend contract or credentials were changed by this merge.

Verification after merge: all 360 tests / 32 files, root type check, native game build and harness/settings build pass (existing harness bundle-size warning remains). Real-browser checks cover title, archive tabs/file picker/draft preservation, live saved OpenAI settings/Back, offline preparation/Thinking, teaching/answer/skip, notebook/draft preservation, battle status/log and help submission; browser errors were empty. Evidence: [lesson](verification/dungeon-lesson-integrated.png), [battle](verification/dungeon-battle-integrated.png), [settings](verification/dungeon-settings-integrated.png). Backend health remains healthy/OpenAI.

The native headless `smoke --seconds 15` was attempted and fails before scenes with `ReferenceError: document is not defined` at `course/ui.ts:2`: its simulator lacks the DOM used by the existing frontend. Real-browser checks pass; a complete revised-game walkthrough is not claimed. The imported browser scripts were not run through a separate browser driver. No full PDF re-ingestion, push or Phaser publish was performed.

## Saved dungeons and lesson navigation

The subsequent update adds a whole-course lesson planner, room descriptions/teaching goals, a permanent clickable outcome above Next turn, an expedition menu with room progress, real backend pause/resume, and disk-backed local storage. My archive now contains **Your saved dungeons**. At the user's explicit request, old generated rooms/lessons and their old run were removed from the active archive. A fresh ArrayLists course has 5 rooms / 21 concepts, reusing 255 verified questions with remapped references and passing coverage. No old run was imported. [ARCHIVE_AND_LESSONS.md](ARCHIVE_AND_LESSONS.md) records the complete implementation, live approval, data handling and verification. This supersedes earlier descriptions of the local server as memory-only and the empty-text help expiry issue as unresolved.
