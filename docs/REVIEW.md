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

## Evidence

`npm test`: **319 tests passed in 29 files**. `npm run typecheck`: passed. The API docs generator ran successfully. `llm:smoke` explicitly skipped for missing credentials.

- [Seasons HTTP transcript](verification/e2e-seasons.txt): first attempt fails, retry passes, all rooms and boss complete, 90% A-, target B met, `distance_causes_seasons` revealed.
- [Binary-search HTTP transcript](verification/e2e-binary-search.txt): first attempt fails, retry passes, all rooms and boss complete, 80% B-, target B missed, `returns_value_not_index` revealed.
- [API captures](api-examples.json): 22 captures covering all 17 endpoints, five turn variants and a wrong-phase error; debug response is an excerpt.
- Browser screenshot (historical screenshot retired during rebranding): separate one-room run, failure → retry → pass → boss → 100% A; debug overlay also checked. Browser run used the real local API with mock LLM/in-memory storage, forced help probability 1 and untimed help.

The teammate's `pips-notebook/` subtree was not edited, installed, built or run. Local `main` and `origin/main` tracking refs stayed at `d618e1f28c044c0f5e6bded896291df7322d1bc3`. The initial continuation left changes uncommitted; the user subsequently requested a local commit on `Dev/backend`. No push, merge or PR is part of that checkpoint.

## Later integration Settings review

The earlier scope/evidence above predates the `integration` branch and the requested OpenAI/Settings feature. The later work modifies the actual game and backend; see [API_SETTINGS.md](API_SETTINGS.md) and [CONTINUATION_LOG.md](CONTINUATION_LOG.md) for the complete change map and verification.

Reviewed OpenAI request shape/strict-schema conversion, optional-value restoration, one invalid-output retry, provider timeouts/errors, vector dimensions/order/normalization, and PDF upload form fields using a fake transport. Reviewed settings redaction, omitted/replaced/removed keys, failed-write rollback, file/directory permissions, reload, unsaved Test behavior, local HTTP guards and runtime provider changes without losing an existing run. Regression suite: 341 tests / 31 files; type check passes. Both sample HTTP gauntlets and browser setup controls pass.

Limits: live provider/model availability, PDF interpretation and Atlas behavior still need real credentials. Uploaded OpenAI files have no automatic deletion lifecycle. Local settings are plaintext behind OS file permissions, with loopback/origin guards rather than a production authentication system. Older packs lacking embedding metadata require a matching startup profile or reseeding. Full native game build/play/smoke remain blocked by the absent Phaser AE runtime.

Later startup verification resolved the runtime blocker: the user authorized Phaser sign-in, the official CLI restored engine `v3-82bf126` and the declared packs, and the native build passed. The actual game is running on port 4173. Browser-checked Title/Settings/OpenAI/Back and the backend course picker. This supersedes the earlier build-blocked status; it does not establish a full native gameplay/smoke or live-model pass. See [INTEGRATION.md](INTEGRATION.md).

The later 108-page timeout fix adds separate preparation deadlines, bounded outline input, native attachment limits, operation labels and a retry action. Regression suite now passes 348 tests in 31 files, plus type checks, native build and the offline HTTP workflow. Browser retry and settings controls were tested against an isolated offline API. The user's live model/key were retained; the original PDF was not retried by the agent. Batch merging matches normalized concept titles and may need semantic consolidation for documents that name the same topic differently; large documents' image-only information is still unavailable to exact-text evidence validation.

Later progress/summary review: Thinking under Stage now receives bounded persisted activity and only public OpenAI outline-summary events. Raw reasoning, encrypted content and partial/generated question output are excluded. Stream tests cover pre-completion updates, framing, idle reset, request cap, truncated output, summary unavailability and gameplay isolation; a pipeline test checks persistence before outline completion. A small live GPT-6 Luna synthetic-document probe verified streaming/account support (85 updates, 3804 ms, valid structured output). Current suite: 356 tests / 32 files, with type checks, native build and offline HTTP workflow passing. Browser layout was checked with an explicitly labeled fixture. Full live ingestion of the user's PDF and the remaining provider/Atlas/gameplay quality checks are still outstanding.

Later question-quality/UI refinement: reviewed the supplied slide deck, refined all question-writing/verification prompts around source-supported objectives, added a live verifier usefulness gate and included the missing short-text grading rubric. Three source-backed generated questions passed exact evidence/independent checks; the reported rhetorical prompt was rejected. Repaired title/status overlap, scrollable feedback, duplicated failure cards, damage labels and canonical notebook refresh. The actual correct help turn had damage 0. Current suite passes 360 tests / 32 files plus type/native/offline-HTTP checks. The user later authorized a restart; refined prompts are active and the old in-memory run was cleared. See [QUESTION_QUALITY.md](QUESTION_QUALITY.md) for evidence and remaining limits.

The new teaching-dungeon design through `5991240` is now integrated. Reviewed the two overlapping files to retain settings/progress and corrected scoring feedback while adopting the archive, conversation books and sprite animations. Build/type/tests remain green; browser checks show functioning archive, teaching, notebook, combat chronicle and settings. Native headless smoke fails because its simulator has no `document` for the existing DOM frontend; this limitation and exact browser coverage are recorded in [INTEGRATION.md](INTEGRATION.md).

Later saved-dungeon review: local persistence uses serialized atomic snapshots, strict reads and private files; restart tests cover courses/questions/vectors/notebooks/runs and paused help clocks. Pause is idempotent and blocks mutations, including after a restart. Global lesson planning validates complete one-time source assignment and retains evidence while merging topics. An approved ArrayLists reference call produced 5 rooms from 25, and the rebuilt cached bank passes reference/evidence validation and coverage. Browser checks verify permanent outcome links, lesson previews, room map/progress, modal pause and archive recovery. Original PDFs/private snapshots stay ignored; no raw credentials are included in docs. See [ARCHIVE_AND_LESSONS.md](ARCHIVE_AND_LESSONS.md).
