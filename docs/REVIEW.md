# Integration review — Codex continuation

Reviewed November 13, 2026 (America/New_York), starting at `4eb1545` on `Dev/backend`. This was a single-agent source audit plus automated and browser checks, not an independent reviewer-agent audit. No live Gemini/Atlas validation was possible without credentials.

## Findings fixed

| Severity | Finding and concrete trigger | Fix | Verification |
|---|---|---|---|
| High | `citationMatches('the', notebook)` could satisfy the 80% word-overlap branch. A correct answer with a trivial citation could receive credit. | Approximate matches require 12 characters and three distinct words on both sides; repeated-token citations no longer count as substantive. Exact short facts are still valid. | `server/src/engine/fight.test.ts`: trivial, repeated, empty, unrelated, exact and fuzzy citations |
| Medium | Re-stating a previously resolved misconception left its hidden status resolved, because `teach` activated only unknown ids. | Activate stated beliefs regardless of prior state; a stated belief takes priority if a review also lists it as resolved. | `server/src/engine/learning.test.ts`: resolved → stated → active; original input remains unchanged |
| High | Ingest marked concepts ready after processing regardless of verified coverage, and set the course to `ready` even when the final report had `ok: false`. | Progressive readiness checks verified coverage/pool share; final failed coverage produces stage `error`. | `server/src/ingest/pipeline.test.ts`: rejecting every verifier answer never produces ready concepts/course; generic heuristic shortfall is reported as an error |
| High | Derived material fields bypassed prompt data delimiters: question prompts, concept titles/summaries, misconception text, style profiles, rubrics, filenames and uploader titles. Embedded instructions in these fields sat outside the protected blocks. | Wrap these fields through the existing delimiter/escaping helpers. | Nine cases in `server/test/prompt-boundaries.test.ts`; existing student prompt tests still prove the oracle/key is excluded |
| Medium | Files API upload and status requests could hang indefinitely; the processing loop's timeout did not bound an individual stalled SDK call. | Apply `LLM_TIMEOUT_MS` to upload and status calls; status calls also respect the remaining processing window. | `server/src/llm/gemini-client.test.ts`: stalled upload and stalled status calls reject with `llm_error` |
| Medium | Provider error strings and rejected model output could reach clients through public `llm_error` messages. | Use generic public transport/invalid-output errors; retain safe timeout and embedding-count messages. | Provider/invalid-output redaction regression test |
| Medium | E2e expected a new probe on retry even though the same misconceptions had already been probed. It also rescued the deliberately targeted boss question when it became a help event. | Explicitly skip during attempt one, correct other active beliefs on retry, preserve the chosen teaching gap, and demonstrate its wrong answer even if targeted help is offered. Bound retries. | Both bundled gauntlets complete with the chosen costly misconception in results |
| Low | Ingest prompts imposed fixed concept/key-point/misconception counts, contrary to coverage-driven content extraction. | Remove those content quotas. Batch/cost limits remain. | Source review; existing ingest tests pass |
| Low | Untimed help still displayed a prominent seconds label that looked like a deadline. | Explicitly label it estimated solve time with no deadline. | Verified in the built-in browser with `HELP_ME_TIMED=false` |

## Audit coverage

| Area | Checks and result |
|---|---|
| Spec/game rules | Teaching, skips, resolution/re-teaching, retry heart reset, fresh draws, boss targeting/coverage, scoring, targets, results, time budgets, calibration and supported answer types are covered by the suite. The sample workflows complete over actual localhost HTTP. |
| Public/hidden separation | Reviewed public projections and route/service returns. Whole-run HTTP leak scans pass; debug-off returns 404. Correct answers/explanations are revealed only on completed turns, and costly misconceptions at results. Structural key scans do not prove that arbitrary live model prose can never disclose an unwanted fact. |
| State-machine edges | Wrong phases, 425 readiness, duplicate answers/help submissions, expired/repeated/untimed help, idempotent summaries, small pools, RNG persistence, retry/continue guards and zero-bounded damage have test coverage. Added concurrent-turn and concurrent-help regression checks over HTTP. |
| Prompt handling | Reviewed gameplay/ingest prompts, escaping, public-only student input and the ignored Gemini oracle argument. Added boundaries for derived fields. No live adversarial-model test was run. |
| Verification/grounding | Independent verification receives public questions without keys; evidence uses exact whitespace-normalized matching; failed verification is retained unverified and regenerated once; public pools filter verified questions. Tightened the deterministic citation check. |
| Errors/timeouts | Reviewed JSON retry/validation, generation timeout/abort, embedding timeout, background-ingest error handling, upload/page limits and cloned run mutations before persistence. Added bounds for Files API operations and generic public provider errors. |

## Remaining limitations

- Gemini generation, embeddings, native PDF interpretation and Atlas connectivity/vector search are unverified against live services. SDK-facing tests and Atlas tests use doubles. Model availability/default suitability and real-turn latency are not established by offline tests.
- Arbitrary mock uploads use a heuristic that may fail coverage. Cached seasons and binary-search packs pass. `202` acceptance is not ingest success.
- Image-only PDFs have no OCR/evidence path. Native PDF context cannot replace the exact extracted-text evidence check; entirely scanned PDFs fail ingest. The parser can fall back to text when native upload fails.
- Grounding is a citation-match heuristic, not semantic proof that the cited note supports an answer. Live LLM notebook honesty and grading quality still need evaluation.
- Per-run locks work within one backend process. Multiple backend replicas would need shared concurrency control. There is no account/authentication layer in the current API; debug is intended for local development.
- The test-client production bundle includes Phaser and emits Vite's >500 kB chunk warning. The build succeeds; bundle optimization was outside this continuation.

## Evidence

`npm test`: **319 tests passed in 29 files**. `npm run typecheck`: passed. `npm run build -w test-client`: passed. The docs generators ran successfully. `llm:smoke` explicitly skipped for missing credentials.

- [Seasons HTTP transcript](verification/e2e-seasons.txt): first attempt fails, retry passes, all rooms and boss complete, 90% A-, target B met, `distance_causes_seasons` revealed.
- [Binary-search HTTP transcript](verification/e2e-binary-search.txt): first attempt fails, retry passes, all rooms and boss complete, 80% B-, target B missed, `returns_value_not_index` revealed.
- [API captures](api-examples.json): 22 captures covering all 17 endpoints, five turn variants and a wrong-phase error; debug response is an excerpt.
- [Browser screenshot](verification/browser-results.png): separate one-room run, failure → retry → pass → boss → 100% A; debug overlay also checked. Browser run used the real local API with mock LLM/in-memory storage, forced help probability 1 and untimed help.

The teammate's `teach-or-perish/` subtree was not edited, installed, built or run. Local `main` and `origin/main` tracking refs stayed at `d618e1f28c044c0f5e6bded896291df7322d1bc3`. The initial continuation left changes uncommitted; the user subsequently requested a local commit on `Dev/backend`. No push, merge or PR is part of that checkpoint.
