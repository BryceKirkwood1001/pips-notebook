# Frontend variables by screen

This is the game-data handoff for the frontend teammate, checked against `shared/src/api-client.ts` and the working test client. For the literal source-level list (including temporary locals, DOM handles and parameters), see [FRONTEND_SOURCE_VARIABLES.md](FRONTEND_SOURCE_VARIABLES.md).

Use [api-client.ts](../shared/src/api-client.ts) for the exact TypeScript types and API methods. It has zero imports and can be copied into the Phaser AE game. [API.md](API.md) supplies real requests/responses; [PHASER_INTEGRATION.md](PHASER_INTEGRATION.md) explains scene wiring.

`?` means optional; `[]` means an array; `null` is an intentional empty value. Server responses own game state. Frontend state owns form inputs, animation and presentation.

## Screen map

| Screen/page | Working test-client scene | Teammate's game | Main variables | API methods |
|---|---|---|---|---|
| Boot/resume | `BootScene` | Startup or `title` | `runId`, `run.phase`, `run.results`, `run.pendingHelpMe` | `getRun` |
| Course picker/upload | `UploadScene` | Add `upload` | `samples`, uploaded `files`, pasted `text`, optional `title`, `courseId` | `listSamples`, `seedCourse`, `uploadCourse`, `createCourseFromText` |
| Ingest progress/run setup | `UploadScene` | Same `upload` page | `course`, `status`, units, rooms, selected room ids, `targetGrade`, `studentEmoji` | `getCourse`, `createRun` |
| Learning/notebook | `LearningScene` | Add `learning` | `run`, `currentRoom`, `notebookMd`, `explanation`, student questions, answer text, `resolved` | `teach`, `answerQuestion`, `skipQuestion`, `ready` |
| Room fight/failure/retry | `FightScene` via `BattleScene` | Wire into `play` | `run.room`, `TurnResult`, hearts, reasoning, cited notes, `passed`, `failedTurns` | `turn`, `help`, `retry`, `continueRun` |
| Help modal | `buildHelp` in `helpModal.ts` | Overlay on `play`/boss | `eventId`, public `question`, typed `answer`, `timeBudgetSec`, `deadline`, derived time left | `help` |
| Boss/exam | `BossScene` via `BattleScene` | `play` in boss mode, or add `boss` | `run.boss`, health, `TurnResult`, final `results` | `turn`, `help` |
| Results/study guide | `ResultsScene` | Wire into `gameover` | `Results`, accuracy, help stats, costly misconceptions, material references | `getResults` |
| Pause | No separate test scene | Existing `pause` | Existing `runId` and current phase | No API needed; timed deadlines keep running |
| Development overlay | `debug.ts` | Optional dev-only overlay | `run`, `pack`, `questions`, `stats`, `timeBudgets` from debug | `getDebug` |

The teammate's registered scenes are currently `title`, `play`, `pause`, `gameover`; the upload/learning/boss names above are proposed integration targets. Their game files were only read during this continuation.

## Shared frontend state and configuration

| Variable | Type/default | Where used | Purpose |
|---|---|---|---|
| `api` | `ApiClient` | Every screen | Shared HTTP client |
| `state.run` | `PublicRun \| null`, initially `null` | All run screens | Current public server state |
| `state.results` | `Results \| null`, initially `null` | Boss, Results | Cache the final results |
| `state.game` | `Phaser.Game \| null` | Startup/navigation | Test-client game instance |
| `inflight` | `boolean`, initially `false` | `app.ts` call wrapper | Prevent concurrent UI submissions |
| `params` | `URLSearchParams` | Startup | Read the query parameters below |
| `params.get('api')` | `string \| null`; default `http://localhost:8787` | API initialization | Server origin, without `/api` |
| `params.get('run')` / `runId` | `string \| null` | Boot/resume and URL persistence | Reload an existing run |
| `params.get('mock')` / `isMock` | `mock=1` → `true` | API initialization | Use the browser's canned mock API; omit this to test the real backend, even when that backend uses mock LLM tasks |
| `TARGET_GRADES` | `A, A-, B+, B, B-, C+, C, C-, D` | Setup | Target selector options |
| `STUDENT_EMOJIS` | Exported `readonly` list from client | Setup, all run headers | Allowed non-human student choices |
| `GAME_W`, `GAME_H` | `1100`, `720` | Test-client layout | Harness dimensions; real UI can choose its own |
| `EMOJI_FONT` | System emoji font stack | Harness text/sprites | Presentation only |
| `SCENE_STARTED`, `SCENE_SLEEPING` | `2`, `7` | Harness navigation | Phaser 3 lifecycle bounds; not needed in Phaser AE |
| `ApiError.status`, `.code`, `.message` | `number`, `string`, `string` | Error banner on every screen | Show/handle failed requests; status `0` denotes a network error |

No Gemini key, MongoDB URI, hidden misconception state or answer key belongs in browser configuration. Gameplay settings come from `run.rules`; set server environment variables on the backend.

## Course picker and upload inputs

| Variable/field | Type | Source → use |
|---|---|---|
| `samples[]` | `{ id: string; title: string }[]` | `listSamples()` → sample buttons |
| `sample` | `string` (`seasons` or `binary-search`) | Selected sample id → `seedCourse(sample)` |
| `files[]` | `{ name: string; data: Blob }[]` | File input → `uploadCourse(files, title?)`; a browser `File` is a `Blob` |
| `text` | Nonempty `string` | Textarea → `createCourseFromText(text, title?)` |
| `title?` | `string`, max 200 chars for JSON | Optional course title input |
| `courseId` | `string` | Upload/seed response → poll course and create run |

File formats are `.pdf`, `.txt`, `.md` (`.markdown` is also accepted by the server). `POST /courses` returns 202 before ingest finishes; watch `status` rather than treating upload acceptance as readiness.

## Ingest/setup: every `PublicCourse` field

| Field | Type | UI use |
|---|---|---|
| `course.id` | `string` | Course identity; same role as `courseId` |
| `course.title` | `string` | Course heading |
| `course.status.stage` | `parsing \| outline \| style \| concepts \| ready \| error` | Progress indicator; stop polling on `ready` or `error` |
| `course.status.conceptsReady[]` | `string[]` | Ready concept ids; room/concept booleans below are convenient public projections |
| `course.status.error?` | `string` | Ingest error message |
| `course.files[].id` | `string` | File identity for evidence references |
| `course.files[].name` | `string` | Uploaded filename |
| `course.files[].type` | `pdf \| txt \| md` | File type badge |
| `course.files[].pages` | `number` | Page count |
| `course.units[].id`, `.title` | `string` | Unit grouping/heading |
| `course.units[].concepts[].id`, `.title` | `string` | Concept identity/label |
| `course.units[].concepts[].ready` | `boolean` | Ready/pending indicator |
| `course.rooms[].id`, `.title` | `string` | Room checkbox identity/label |
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
| `studentEmoji?` | `StudentEmoji` | Student selector; use `STUDENT_EMOJIS` |
| `scope?.roomIds[]` | Nonempty `string[]` if supplied | Selected rooms; omit scope to include every room |

Enable Start once the first selected room is ready. Later rooms can still be ingesting. A 425 response means the requested room needs more time.

Harness setup state: `courseId`, `course`, `chosen: Set<string>` (selected rooms), `known: Set<string>` (rooms already discovered), `grade`, `emoji`, `polling: boolean`, `timer: number` (one-second ingest poll interval, **not a gameplay countdown**). DOM handles: `sourceEl`, `courseEl`, `progressEl`, `roomsEl`, `startBtn`, `hintEl`.

## Shared run fields: every `PublicRun` field

These are available on the run, even if a particular screen does not render them.

| Field | Type | Screens/use |
|---|---|---|
| `run.id` | `string` | Every action, resume URL |
| `run.courseId`, `run.courseTitle` | `string` | Course context, headings |
| `run.targetGrade` | `TargetGrade` | Learning/fight headers, target display |
| `run.studentEmoji` | `string` | Student sprite/header |
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

`PublicRunRoom`, used in both `rooms[]` and `currentRoom`:

| Field | Type | UI use |
|---|---|---|
| `id`, `title` | `string` | Room identity/title |
| `concepts[].id`, `.title` | `string` | Concepts to teach |
| `ready` | `boolean` | Room readiness |
| `state` | `upcoming \| current \| passed` | Progress-map styling |

Navigation: `learning` → Learning; `room` or `room_result` → Fight; `boss` → Boss; `results` → Results. Keep the server's current run rather than recalculating phase/health locally.

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

Harness state: `notebookEl`, `questionsEl`, `teachInfo` are DOM handles. `blocks: Map<string, QBlock>` tracks each question's `status: HTMLElement` and `controls: HTMLElement`. `explain` is the explanation textarea; each question has an `input` textarea.

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

Harness presentation state shared by Fight/Boss: `kind: 'room' | 'boss'`, `hearts`, `maxHearts`, `health`, `answered`, `total`; sprite handles `student`, `monster`, `fx`, `statText`, optional `bar`; DOM handles `logEl`, `detailEl`, `endEl`, `nextBtn`; optional `modal` and cleanup callback `stopHelp`. `MONSTERS` is a harness-only sprite list.

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

Harness Results locals: `results` is chosen from `state.results`, then `run.results`, then `getResults`. Rendering uses `r` for Results, `c` for each accuracy entry, `h` for help stats, `m` for each costly misconception and `ref` for its material reference. Start over clears `state.run` and `state.results`.

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
