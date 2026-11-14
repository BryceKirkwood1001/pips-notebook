# Frontend variables by screen

This is the public game-data handoff for the main Phaser AE site on port 4173. Source paths below are relative to `pips-notebook/game/` unless stated otherwise. See [the game source map](../pips-notebook/game/README.md) for implementation details.

Use [api-client.ts](../shared/src/api-client.ts) for the exact TypeScript types and API methods. It has zero imports and can be copied into the Phaser AE game. [API.md](API.md) supplies real requests/responses; [PHASER_INTEGRATION.md](PHASER_INTEGRATION.md) explains scene wiring.

`?` means optional; `[]` means an array; `null` is an intentional empty value. Server responses own game state. Frontend state owns form inputs, animation and presentation.

## Screen map

| Screen/page | Main game source | Main variables | API methods |
|---|---|---|---|
| Title/resume | `main.ts` | URL run id, `run.phase`, `run.results`, `run.pendingHelpMe` | `getRun` |
| Course picker/upload | `course/Upload.ts` | `samples`, uploaded `files`, pasted `text`, optional `title`, `courseId` | `listSamples`, `seedCourse`, `uploadCourse`, `createCourseFromText` |
| Saved dungeons | `course/Upload.ts` | Saved courses and expeditions, selected course/run | `listArchive`, `deleteCourse`, `endRun`, `deleteRun`, `resumeRun` |
| Ingest progress/run setup | `course/Upload.ts` | `course`, `status`, units, rooms, selected room ids, `targetGrade` | `getCourse`, `createRun` |
| Learning/notebook | `course/Learning.ts` | `run`, `currentRoom`, `notebookMd`, explanation, student questions, answer text, feedback | `teach`, `answerQuestion`, `skipQuestion`, `ready` |
| Room fight/failure/retry | `course/battle.ts` | `run.room`, `TurnResult`, hearts, reasoning, cited notes, `passed`, `failedTurns` | `turn`, `help`, `retry`, `continueRun` |
| Help modal | `course/help.ts` | `eventId`, public `question`, typed `answer`, `timeBudgetSec`, `deadline`, derived time left | `help`, `turn` for expiry |
| Boss/exam | `course/battle.ts` | `run.boss`, health, `TurnResult`, final `results` | `turn`, `help` |
| Results/study guide | `course/Results.ts` | `Results`, accuracy, help stats, costly misconceptions, material references | `getResults` |
| Rooms/pause/report | `course/Menu.ts`, `course/report.ts` | `run.rooms`, `pausedAt`, room history, accuracy, weak points | `pauseRun`, `resumeRun`, `endRun`, `deleteRun` |
| API setup | `course/Settings.ts`, `course/settings-view.ts` | Provider, model fields, write-only key inputs, backend origin, timeout, saved-key flags, connection status | `getApiSettings`, `testApiSettings`, `updateApiSettings` |

The game registers `Title`, `Upload`, `Learning`, `Fight`, `Boss`, `Results`, `Settings` and `Menu`. The backend owns run state; the frontend owns navigation, drafts and presentation. Hidden debug payloads are not inputs to normal game screens.

## Shared frontend state and configuration

| Variable | Type/default | Where used | Purpose |
|---|---|---|---|
| `api` | `ApiClient` | Every screen | Shared HTTP client |
| `state.run` | `PublicRun \| null`, initially `null` | All run screens | Current public server state |
| `state.results` | `Results \| null`, initially `null` | Boss, Results | Cache the final results |
| `inflight` | `boolean`, initially `false` | `app.ts` call wrapper | Prevent concurrent UI submissions |
| `params` | `URLSearchParams` | Startup | Read the query parameters below |
| `params.get('api')` | `string \| null`; default `http://localhost:8787` | API initialization | Server origin, without `/api` |
| `params.get('run')` / `runId` | `string \| null` | Boot/resume and URL persistence | Reload an existing run |
| `params.get('mock')` / `mock` | `mock=1` → `true` | API initialization | Use the browser's canned mock API; omit this to test the real backend, even when that backend uses mock LLM tasks |
| `TARGET_GRADES` | `A, A-, B+, B, B-, C+, C, C-, D` | Setup | Target selector options |
| `ApiError.status`, `.code`, `.message` | `number`, `string`, `string` | Error banner on every screen | Show/handle failed requests; status `0` denotes a network error |

No API key, MongoDB URI, hidden misconception state or answer key belongs in browser configuration or local storage. Settings accepts keys only as temporary password inputs sent to the local backend; the read API exposes only `hasApiKey`. Gameplay settings come from `run.rules`; set server environment variables on the backend.

## API Settings fields and source variables

`course/settings-view.ts` implements the setup form, mounted by `course/Settings.ts` in the main game's frame. See [API_SETTINGS.md](API_SETTINGS.md) for setup and storage rules.

| Name/field | Type | Use |
|---|---|---|
| `selected` / request `provider` | `'openai' \| 'gemini' \| 'mock'` | Selected provider card; Save/Test body |
| `profiles[provider].model` / `model` | Input / string | Generation model |
| `profiles[provider].embedding` / `embeddingModel` | Input / string | Embedding model for new ingests |
| `profiles[provider].key` / `apiKey` | Password input / optional string or null | Blank omits the key (keep saved); nonblank replaces; `remove` sends null |
| `profiles[provider].remove` | Checkbox | Remove saved provider key |
| `profiles[provider].state` / `providers[provider].hasApiKey` | Status element / boolean | Key-presence indicator; never the key itself |
| `timeout` / `timeoutMs` | Seconds input / integer milliseconds | UI accepts 1–180 whole seconds |
| `ingestTimeout` / `ingestTimeoutMs` | Seconds input / integer milliseconds | Per-request course preparation budget; 1–600 whole seconds, default 180; separate from interactive turns |
| `origin` / `apiOrigin` | URL input / string | Backend origin; query parameter overrides `top.apiOrigin` in localStorage, then localhost default |
| `persistence` / response `persistence` | Paragraph / `'local' \| 'session'` | Backend persistence feedback |
| `dimensions` / response `embeddingDims` | Paragraph / number | Read-only retrieval dimensions |
| `loaded`, `active` | boolean | Gate Save/Test until load; ignore responses after scene closes |
| `controller` | AbortController | Cancel browser requests when leaving Settings; each request also has a deadline |
| `root`, `status`, `keyStatus`, `providerCards`, `cards`, `fields`, `offline` | DOM handles / map | Component structure, selected state and request feedback |
| `connection`, `clientFor` | API client / factory | Read, test or save settings against the chosen origin |
| `save`, `test`, `load`, `back`, `advanced` | DOM handles | Component controls; Back remains usable while a request runs |
| `currentScreen`, `settingsReturn` | Game `Screen` | Return from Settings to the previous page or current run phase |
| `setApiOrigin`, `openSettings`, `backFromSettings` | Game app helpers | Update the shared client, clear a run when changing servers, navigate |

These setup responses do not belong in `PublicRun`. Changing a provider keeps existing runs; changing the backend origin starts a new client session. The browser's `?mock=1` canned practice mode remains independent of the backend provider.

The actual game's battle feedback now lives in `course/battle-feedback.ts`: `turnCard(event)` renders one completed event with labeled answer/reasoning/evidence/expected-answer fields and a separate damage footer. `course/battle.ts` keeps title, hearts/attempt/answered counts and actions separate and refreshes the canonical run after completed turns. Question headings can be suppressed by `questionEl(question, false)` when the card summary already displays the prompt. See [QUESTION_QUALITY.md](QUESTION_QUALITY.md) for the associated layout and prompt fixes.

The actual game's `UploadScene.retryUpload` retains the submitted file array or notes/title while that scene stays open. An ingest error exposes **Retry preparation**, which submits a new course and clears stale room selections. Leaving/reloading Upload releases those inputs. A failed course keeps Start disabled and shows a preparation-error hint, rather than asking the player to select nonexistent rooms.

## Course picker and upload inputs

| Variable/field | Type | Source → use |
|---|---|---|
| `samples[]` | `{ id: string; title: string }[]` | `listSamples()` → sample buttons |
| `sample` | `string` (`seasons` or `binary-search`) | Selected sample id → `seedCourse(sample)` |
| `files[]` | `{ name: string; data: Blob }[]` | Files subsection → `uploadCourse(files, title?, text?)`; a browser `File` is a `Blob` |
| `text` | `string` | Notes subsection; notes alone use `createCourseFromText(text, title?)`, while mixed sources use the third `uploadCourse` argument |
| `title?` | `string`, max 200 chars for JSON | Optional course title input |
| `courseId` | `string` | Upload/seed response → poll course and create run |

File formats are `.pdf`, `.txt`, `.md` (`.markdown` is also accepted by the server). `POST /courses` returns 202 before ingest finishes; watch `status` rather than treating upload acceptance as readiness.

My archive switches between Library and Create New Dungeon. The creation form keeps both sources visible, one optional title and one submit action; at least one file or nonblank notes is required. With files present, the shared client adds notes as a uniquely named `pasted-notes.md` source in the same multipart request, preserving text, indentation and source provenance. Section switches retain files, notes and title; Retry preparation uses the complete submitted source snapshot.

## Ingest/setup: every `PublicCourse` field

| Field | Type | UI use |
|---|---|---|
| `course.id` | `string` | Course identity; same role as `courseId` |
| `course.title` | `string` | Course heading |
| `course.status.stage` | `parsing \| outline \| style \| concepts \| ready \| error` | Progress indicator; stop polling on `ready` or `error` |
| `course.status.conceptsReady[]` | `string[]` | Ready concept ids; room/concept booleans below are convenient public projections |
| `course.status.error?` | `string` | Ingest error message |
| `course.status.activity?` | `{ message: string; summary?: string; completed?: number; total?: number }` | Actual-game Thinking panel directly below Stage; refreshed by the existing poll |
| `activity.message` | Up to 240 characters | Current actual task/page-batch progress, also available without OpenAI summaries |
| `activity.summary?` | Latest 1200 characters | Public OpenAI document-analysis summary, labeled “Latest OpenAI reasoning summary”; render as text |
| `activity.completed?`, `.total?` | Integers | Counts for the current task, when known; do not infer a full-course percentage |
| `course.files[].id` | `string` | File identity for evidence references |
| `course.files[].name` | `string` | Uploaded filename |
| `course.files[].type` | `pdf \| txt \| md` | File type badge |
| `course.files[].pages` | `number` | Page count |
| `course.units[].id`, `.title` | `string` | Unit grouping/heading |
| `course.units[].concepts[].id`, `.title` | `string` | Concept identity/label |
| `course.units[].concepts[].summary?` | `string` | Describes what the learner should explain |
| `course.units[].concepts[].ready` | `boolean` | Ready/pending indicator |
| `course.rooms[].id`, `.title` | `string` | Room checkbox identity/label |
| `course.rooms[].description?`, `.learningObjectives?` | `string`, `string[]` | Lesson scope and concrete teaching checklist |
| `course.rooms[].conceptIds[]` | `string[]` | Concepts covered by each room |
| `course.rooms[].ready` | `boolean` | Whether the room can start |
| `course.styleSummary.voice` | `string` | Optional course style summary |
| `course.styleSummary.notation` | `string` | Optional notation description |
| `course.styleSummary.codeLanguage?` | `string` | Optional programming language |
| `course.styleSummary.units?` | `string` | Optional measurement units |
| `course.styleSummary.topFormats[]` | `QuestionType[]` | Optional preview of question formats |

Run-creation inputs:

| Field | Type/default | Source |
|---|---|---|
| `courseId` | Required `string` | Selected/uploaded course |
| `targetGrade` | Required `TargetGrade` | Target selector; test client starts at `B` |
| `studentEmoji?` | `StudentEmoji` | Optional API compatibility field; main-game setup omits it and always presents Pip |
| `scope?.roomIds[]` | Nonempty `string[]` if supplied | Selected rooms; omit scope to include every room |

Enable Start once the first selected room is ready. Later rooms can still be ingesting. A 425 response means the requested room needs more time.


## Shared run fields: every `PublicRun` field

These are available on the run, even if a particular screen does not render them.

| Field | Type | Screens/use |
|---|---|---|
| `run.id` | `string` | Every action, resume URL |
| `run.courseId`, `run.courseTitle` | `string` | Course context, headings |
| `run.targetGrade` | `TargetGrade` | Learning/fight headers, target display |
| `run.studentEmoji` | `string` | API compatibility metadata; the main game's fixed Pip sprite does not depend on it |
| `run.phase` | `learning \| room \| room_result \| boss \| results` | Choose the screen |
| `run.roomIndex` | Zero-based `number` | Progress; display `+1` to the player |
| `run.rooms[]` | `PublicRunRoom[]` | Gauntlet map/progress |
| `run.currentRoom` | `PublicRunRoom \| null` | Learning/fight context; null in boss/results |
| `run.notebookMd` | `string` | Notebook panel; preserved on retry |
| `run.learning.pendingQuestions[]` | `PublicStudentQuestion[]` | Learning questions |
| `run.learning.teachCount` | `number` | Teaching count |
| `run.room?` | Public room state below | Fight, room result, retry |
| `run.boss?` | Public boss state below | Boss and final logs |
| `run.pendingHelpMe?` | `HelpMeTurn` | Reopen the help modal after reload |
| `run.results?` | `Results` | Final screen after completion |
| `run.rules.roomQuestions` | `number` | Configured room question count; actual draw is `room.totalTurns` |
| `run.rules.roomHearts` | `number` | Room heart capacity |
| `run.rules.bossQuestions` | `number` | Configured exam size; actual draw is `boss.totalTurns` |
| `run.rules.maxStudentQuestions` | `number` | Max open questions label |
| `run.rules.helpMeTimed` | `boolean` | Timed/untimed UI; event `deadline` is authoritative |
| `run.createdAt`, `run.updatedAt` | ISO `string` | Optional metadata |
| `run.pausedAt?` | ISO `string` | Open Menu instead of gameplay; resume through `resumeRun` |

`PublicRunRoom`, used in both `rooms[]` and `currentRoom`:

| Field | Type | UI use |
|---|---|---|
| `id`, `title` | `string` | Room identity/title |
| `concepts[].id`, `.title` | `string` | Concepts to teach |
| `concepts[].summary?` | `string` | Teaching guide topic explanation |
| `description?`, `learningObjectives?` | `string`, `string[]` | Lesson scope/checklist in setup, Learning and Menu |
| `ready` | `boolean` | Room readiness |
| `state` | `upcoming \| current \| passed` | Progress-map styling |

Navigation: `learning` → Learning; `room` or `room_result` → Fight; `boss` → Boss; `results` → Results. Keep the server's current run rather than recalculating phase/health locally.

New native-game navigation: `pausedAt` opens `Menu`; Rooms/Pause calls `pauseRun(id)` and Resume expedition calls `resumeRun(id)`. `listArchive()` supplies public `courses[]` and recent run summaries for My archive / Your saved dungeons. The game uses the latest `student_answer`/`help_result` in the current fight log for its persistent outcome card. Click opens and focuses that same turn in the chronicle. See [ARCHIVE_AND_LESSONS.md](ARCHIVE_AND_LESSONS.md) for the full native file map and persistence behavior.

## Learning and notebook variables

| Variable/field | Type | Source/action |
|---|---|---|
| `explanation` | Nonempty text, max 8,000 chars | Player form → `teach(run.id, explanation)` |
| `notebookMd` | `string` | `teach`, `answerQuestion`, `skipQuestion` responses, or `getRun` |
| `questions[]` | `PublicStudentQuestion[]` | `teach` response; initial list is `run.learning.pendingQuestions` |
| `questions[].id` / `qid` | `string` | Pass to Answer/Skip |
| `questions[].text` | `string` | Student's question text |
| `questions[].status` | `open \| answered \| skipped` | Show controls only while open |
| `answer` | Nonempty text, max 4,000 chars | Player form → `answerQuestion(run.id, qid, answer)` |
| `resolved` | `boolean` | Answer response → resolved/unresolved feedback |

`teach` returns `{ notebookMd, questions }`; Answer returns `{ resolved, notebookMd }`; Skip returns `{ notebookMd }`; Ready returns a fresh `PublicRun`.

Render the notebook's `##` headings and `-` bullets as text. Wrong beliefs are ordinary notes. Refresh the notebook after a correct help event, too: use `noteAdded` immediately or reload the run.


## Room and boss state

| Room field | Type | UI use |
|---|---|---|
| `run.room.attempt` | `number` | Attempt counter |
| `run.room.turn` | `number` | Number of completed questions |
| `run.room.totalTurns` | `number` | Actual question count |
| `run.room.hearts` | `number` | Current hearts |
| `run.room.maxHearts` | `number` | Heart capacity |
| `run.room.helpMeUsed` | `number` | Help events used in this attempt |
| `run.room.log[]` | `TurnResult[]` | Restore the fight UI on reload |
| `run.room.passed?` | `boolean` | Absent during fight; true/false after completion |

| Boss field | Type | UI use |
|---|---|---|
| `run.boss.turn` | `number` | Completed exam questions |
| `run.boss.totalTurns` | `number` | Actual exam question count |
| `run.boss.health` | `number`, 0–100 | Grade/health bar |
| `run.boss.helpMeUsed` | `number` | Help events used in the boss |
| `run.boss.log[]` | `TurnResult[]` | Restore exam UI on reload |


## Every `TurnResult` field, by variant

Always switch on `turn.kind` before reading variant-specific fields. `?` fields may be absent.

| `kind` | Fields | Page/action |
|---|---|---|
| `student_answer` | `question: PublicQuestion`, `answer: Answer`, `answerText: string`, `correct: boolean`, `correctAnswer: RevealedAnswer`, `explanation: string`, `reasoning: string`, `citedNotes: string[]`, `reason?: 'not in my notes' \| 'wrong belief' \| 'unknown'`, plus damage fields below | Fight/Boss: question → attack → hit/miss → bars → reasoning |
| `help_me` | `eventId: string`, `question: PublicQuestion`, `timeBudgetSec: number`, `deadline: string \| null` | Fight/Boss: show modal and wait for player |
| `help_result` | `eventId: string`, `question: PublicQuestion`, `correct: boolean`, `late: boolean`, `correctAnswer: RevealedAnswer`, `explanation: string`, `solveTimeSec: number`, `noteAdded?: string`, plus damage fields below | Fight/Boss: animate player's outcome, show feedback, add notebook note if present |
| `room_end` | `passed: boolean`, `hearts: number`, `failedTurns: { question: PublicQuestion; reasoning: string; citedNotes: string[] }[]` | Fight: Continue if passed; failure trace and Retry otherwise |
| `boss_end` | `results: Results` | Navigate to Results |

Damage fields exist on `student_answer` and `help_result`: `damage: number`, `hearts?: number` (room), `health?: number` (boss), `phaseAfter: RunPhase`. Use the returned hearts/health values; do not subtract damage a second time. When `phaseAfter` is `room_result` or `results`, call `turn()` once more for the summary.

`RevealedAnswer` is `{ answer: Answer; text: string }`. Use `.text` for display. The correct answer and explanation are available only after that question is answered.

## Public questions and player answer inputs

Every `PublicQuestion` has `id: string`, `type: QuestionType`, `prompt: string`, `difficulty: number` (1–5), `timeBudgetSec: number`. Its payload varies:

| `type` | Public `payload` | `Answer` field to send | Page |
|---|---|---|---|
| `mcq` | `options: string[]` | `choiceIndex: number` | Fight/Boss details; help radio/buttons |
| `true_false` | `statement: string` | `value: boolean` | Show both prompt and statement; help True/False |
| `multi_select` | `options: string[]` | `choiceIndexes: number[]` | Help checkboxes |
| `numeric` | `unit: string \| null` | `value: number` | Help number input |
| `short_text` | `{}` | `text: string` | Help text input |
| `ordering` | `items: string[]` | `order: number[]` | Help ordering control |
| `free_response` | `{}` | `text: string` | Student turn display; never a help event |

`Answer` also has `dontKnow?: boolean` for student answers. Set only the field appropriate to the question. All indexes are zero-based; `order` is the complete item-index permutation, not the item texts. Submit help through `api.help(runId, eventId, answer)`; the HTTP body is `{ answer }`.

Help modal state: `q` (the public question), `pick` (MCQ index or true/false choice), `boxes` (multi-select inputs), `n` (numeric input), `order` (ordering indexes), `t` (text input), `build(final)` (builds the typed answer), `sent` (submission guard), `tick` (interval id), `end` (deadline in milliseconds), `left` (seconds left), `timer` (display element), `stop()` (clear interval). `LEVELS` provides difficulty labels.

There are two budgets: `question.timeBudgetSec` is the question's baseline estimate; `help_me.timeBudgetSec` is the effective event budget after the backend multiplier. Countdown to the actual `deadline`, not `Date.now() + budget`. If `deadline === null`, show no countdown. The remaining seconds are presentation state, not server authority.

## Results: every `Results` field

| Field | Type | UI use |
|---|---|---|
| `results.predictedGradePct` | `number`, integer 0–100 | Final score |
| `results.letter` | `TargetGrade \| 'F'` | Letter grade |
| `results.target` | `TargetGrade` | Chosen target |
| `results.metTarget` | `boolean` | Target success/failure |
| `results.conceptAccuracy[].conceptId`, `.title` | `string` | Concept identity/label |
| `results.conceptAccuracy[].correct`, `.total` | `number` | Correct/total boss questions |
| `results.conceptAccuracy[].accuracy` | `number`, 0–1 | Convert to percent for the bar |
| `results.helpMe.offered` | `number` | Help events offered across the whole run |
| `results.helpMe.correct`, `.wrong`, `.late` | `number` | Help outcomes; late is a separate category |
| `results.helpMe.avgSolveTimeSec` | `number \| null` | Average help time; display n/a when null |
| `results.costlyMisconceptions[]` | `CostlyMisconception[]` | Study guide, revealed at results |

Every `CostlyMisconception` field:

| Field | Type | UI use |
|---|---|---|
| `id` | `string` | Stable item key |
| `conceptId`, `conceptTitle` | `string` | Group study-guide entries by concept |
| `description` | `string` | What went wrong |
| `beliefStatement` | `string` | Student's wrong note |
| `correction` | `string` | What to study instead |
| `origin` | `stated \| skipped` | How the belief became active |
| `questionId`, `questionPrompt` | `string` | Boss question that cost health |
| `materialRef.fileId`, `.fileName` | `string` | Source file identity/name |
| `materialRef.page` | `number` | One-based page reference |
| `materialRef.sectionPath[]` | `string[]` | Section breadcrumb |
| `materialRef.quote` | `string` | Exact supporting passage |

There is currently no file-download URL in `materialRef`. Show file/page/section; opening the original PDF requires the frontend to retain the upload or add a document-serving feature.

`course/Results.ts` reads the saved or fetched results. The player can replay the course, expand the expedition report or return to My archive.

## Debug-only data

`getDebug(runId)` returns `run`, `pack`, `questions`, `stats`, `timeBudgets` only when `DEBUG=true`. These are development data, not gameplay UI inputs. Hidden misconception ids/mappings, answer keys, `solution`, worked steps, rubrics and boss targeting must stay out of normal screens. The intended reveal is `correctAnswer`/`explanation` after a turn and `costlyMisconceptions` on Results.

## How frontend actions update state

| Action | Update on success |
|---|---|
| Seed/upload | Save `courseId`, poll `course` |
| Create run | Replace `state.run`, clear cached results, enter Learning |
| Teach | Replace `notebookMd` and question list; refresh run if exact server state is needed |
| Answer/Skip | Replace notebook; mark the selected question answered/skipped |
| Ready/Retry/Continue | Replace the whole run from the response and navigate by `phase` |
| Student/help result | Animate, then apply returned hearts/health and `phaseAfter`; refresh run for a canonical snapshot |
| `help_me` | Set pending event and open modal; keep the turn loop paused |
| `room_end` | Show outcome and allowed Retry/Continue button |
| `boss_end` | Save results and enter Results |
| HTTP 409 | Refresh `getRun(runId)`, navigate to its current phase |
| HTTP 425 | Show preparing state; retry after readiness changes |
| Network failure | Refresh the run before resending a mutation; it may already have succeeded |

The backend owns question selection, scoring, grade thresholds, readiness, misconception targeting, retry heart resets and deadlines. The frontend sends player choices and renders the returned state.
