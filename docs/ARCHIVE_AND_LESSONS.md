# Saved dungeons, lesson guidance and navigation

Implemented on `integration`, November 14, 2026. The archive page remains **My archive**; its saved-content heading is **Your saved dungeons**, per the user's latest wording.

## Lessons that have enough context to teach

Previously, page batches produced overlapping concepts, and `buildRooms` usually created one room per concept. The supplied 53-page ArrayLists lecture produced 26 concepts across 25 rooms. Live ingestion now performs global lesson planning after evidence lookup and before question generation. It normally aims for 3–5 complete lessons (1–2 for short material; at most 6), merges overlapping concepts across batches and gives each room a description and 2–5 teaching objectives. Every source concept must occur exactly once. Provider output restricts source ids to this upload's actual concept ids; a coverage mismatch requests one correction with the exact missing, repeated or unknown ids and the previous plan. A second mismatch stops preparation rather than dropping topics. Source evidence is carried over in code; the planner cannot replace it with generated quotes. The planning prompt excludes hidden misconception data.

Concept summaries, room descriptions and objectives are public study guidance for the player. Question keys and hidden beliefs remain private. The student-answer model still sees only its notebook and public question; displaying guidance does not silently teach the student.

Setup shows descriptions and expandable teaching checklists. Its wider layout keeps Start run pinned while the lesson list scrolls. Talk to Pip shows the same scope, goals and topic explanations before the explanation field.

## Persistent My archive

Without MongoDB, the actual server now uses owner-only, ignored `.local/archive/repository.json` and `chunks.json`. Courses, question banks, calibration stats, source chunks/vectors and complete current run/notebook state survive backend restarts. Updates are serialized and use temporary-file/rename replacement; failed writes do not change committed in-memory state. Malformed files fail startup instead of silently resetting data. Test containers default to isolated memory storage; `createContainer({dataDir})` opts a test into disk storage. MongoDB repositories support the same archive listing.

`GET /api/archive` returns public course projections and recent run summaries. The archive offers View lessons and Resume expedition/View last results. Private keys remain separately stored in `.local/api-settings.json`.

Each saved dungeon also has **Delete dungeon**. An in-game confirmation names the dungeon and explains that all its lessons, prepared source material, questions, statistics and expeditions (notebooks/history/progress) will be permanently removed; Cancel is focused and Escape cancels. `DELETE /api/courses/:id` removes that course from the repository and vector store, preserving other dungeons. Run writes, new runs, sample reseeding and deletion share a course lock so an in-flight action cannot recreate deleted progress. Deletion returns `409 course_busy` while that course is actively ingesting; failed and finished preparations can be deleted. Disk repository deletion is one serialized snapshot; MongoDB performs collection cleanup sequentially. A partial storage failure returns an error and can be retried. The original files on the user's computer are never deleted.

This is local, single-backend storage, not a multi-user cloud account or multi-process database. Snapshots are rewritten per update, so large installations should use MongoDB. Original upload bytes are not saved; the prepared text chunks, metadata and bank are. Interrupted ingestion becomes an actionable preparation error on restart and requires another upload; it does not resume an unfinished provider request. Restarts preserve prepared courses and paused runs. An unpaused pending deadline continues in wall-clock time; pause before leaving a timed run.

## Rooms, progress and real pause

Rooms and Pause open the expedition menu without advancing or resetting the run. The menu lists all lessons, teaching guides, current/passed/upcoming status, completed-room progress, Resume expedition and My archive. A compact current-room progress bar also stays visible in learning/combat and opens the menu.

`POST /api/runs/:id/pause` is idempotent and stores `pausedAt`; gameplay changes return `409 run_paused` while paused. Resume shifts a pending help deadline and started time by the paused interval, including a backend restart. Already expired time is not restored. Pending help also has Pause & rooms, so its modal cannot trap the player. The timeout path now asks `/turn` to settle the expired event instead of submitting an invalid empty short-text answer. Practice mode mirrors pause/deadline behavior and expired-event settlement.

## Persistent turn outcome

The latest completed turn stays above Next turn on the right: turn number, Pip's answer/your help, correct/incorrect/expired outcome, damage and question text. Clicking it opens the chronicle, expands that turn and focuses its summary. It is reconstructed from the saved log after reload/resume. Existing separated answer/reasoning/evidence/expected-answer fields remain. The transient slime-hit cue is replaced by this persistent panel. Hit feedback explicitly restores actor opacity at completion.

## ArrayLists reference and old-data removal

Read the supplied lecture's text and rendered its outline slide. Automatic approval initially rejected sending its private derived content externally; the user then explicitly approved one OpenAI planning check. That check yielded **5 rooms / 21 concepts**, covering all 26 original concept ids. All retained key-point evidence came from the original extraction. [Plan](verification/arraylists-lesson-plan.json).

The user explicitly asked to remove legacy rooms/lessons. Removed the two old preparations (one failed, one ready) and their old run from the active archive. A private recovery snapshot is outside the active archive under ignored `.local/archive-removed-*`; neither it nor the source PDF is committed or shown by the API.

Built a fresh course `crs_ed72d61578` using the approved five-room plan and the already verified ArrayLists question bank, without another provider generation request. Remapped concept/key-point ids, misconception ownership, material references, question ids and source chunk ids into the new course; kept question wording and answer keys. All references and source quotes validate; full coverage passes: **255 verified questions**, 17 rejected/unverified questions retained privately and excluded from play, all key points and misconception paths covered, every room above its pool target, and 5/5 required multi-concept questions. No old run was imported. [Rebuild report](verification/arraylists-rebuild.json). This is a regrouped existing bank, not a claim of full new PDF ingestion or regenerated question wording.

## Implementation map

| Files | Responsibility |
| --- | --- |
| `server/src/ingest/lesson-plan.ts`, `pipeline.ts`, `llm/ingest/gemini.ts`, `llm/types.ts`, `prompts/ingest/extractOutline.ts` | Global planning, bounded validated grouping, source mapping and descriptive summaries |
| `server/src/repo/file.ts`, `repo/{types,memory,mongo}.ts`, `container.ts`, `wiring.ts` | Persistent snapshots, archive queries and restart handling |
| `server/src/services/{create,types}.ts`, `routes.ts`, `errors.ts`, `engine/public.ts` | Public archive/guidance and pause/resume semantics |
| `shared/src/{schemas,api-client}.ts`, copied game client | Optional study metadata, archive listing and pause/resume endpoints |
| `game/course/{Menu,lesson-guide,Learning,Upload,page,app}.ts`, `main.ts`, `media/game.css` | Saved dungeons, lesson previews, navigation, progress and pause |
| `game/course/{battle,help,mock}.ts` | Outcome deep link, expiry settlement and practice behavior |
| `server/test/archive.test.ts`, `server/src/ingest/lesson-plan.test.ts` | Restart persistence, concurrent writes, privacy, deadlines, evidence/assignment validation |

## Verification

Local regression, type checks, native game build and isolated offline HTTP flow are run after implementation. HTTP documentation now has 28 captures covering 23 endpoints, including archive/pause/resume. Browser checks cover the real five-room saved course, teaching previews and renamed saved-dungeons heading, plus practice combat outcome/log navigation, Rooms/Pause and a help timer retaining its remaining time through the menu. The native headless simulator still lacks the DOM required by the existing frontend; a smoke failure there is not reported as a pass. Full live gameplay and fresh PDF question generation are not claimed.

Final results: **370 tests / 34 files pass**, root type check and native build pass. The real backend restart preserved the same ready course (`storage: local`), and the old preparations/run return 404: [restart receipt](verification/archive-restart.json). Both browser tabs reported no console errors. Screenshots: saved dungeons (historical screenshot retired during rebranding), teaching guidance (historical screenshot retired during rebranding), turn outcome (historical screenshot retired during rebranding), room menu (historical screenshot retired during rebranding). The final native smoke attempt still fails at `course/ui.ts:2` with `document is not defined`. The user subsequently requested committing and pushing this work on `integration`; see the continuation log and Git history for that checkpoint.

## Ending and removing expeditions

`POST /api/runs/:id/end` ends an expedition early: it persists `endedAt`, closes any pending "Help me!", and keeps the run as a read-only record (gameplay and resume return 409 `run_ended`; pause is a no-op; a finished run is 409 `wrong_phase`). `DELETE /api/runs/:id` permanently removes a run; its course, questions and stats stay. Both work in memory, local-file and MongoDB storage (`Repository.deleteRun`), and survive restarts. The archive now reports every run with `rooms` and `endedAt`. In the game, My archive lists all expeditions per course with Resume/View, End and Remove, and the Rooms/Pause menu offers End expedition and Remove expedition; both confirm in an in-game dialog first. CORS allows `DELETE`.
