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
