# Wiring the Phaser AE game to the backend

For the front-end teammate. Everything the game needs from the backend goes through one file, `shared/src/api-client.ts`. The server keeps all game state, so the game only has to show what the server returns and send the player's actions.

Related docs: [API.md](API.md) has a real request and response for every endpoint, and [STATE_MACHINE.md](STATE_MACHINE.md) shows which action is allowed when.

## 1. Setup

| What | Where |
|---|---|
| Backend API | `http://localhost:8787/api` (start it with `npm run dev:server` from the repo root) |
| Your game preview | `http://localhost:4173` (already allowed by the server's CORS settings) |
| Our test client | `http://localhost:5174` (`npm run dev:client`): a working reference for every screen |

To allow another origin, set `CORS_ORIGINS` in `.env` (comma-separated).

**Copy the client into the game.** `shared/src/api-client.ts` has no imports and only needs `fetch`:

```sh
cp shared/src/api-client.ts teach-or-perish/game/api-client.ts
```

Then, from a scene (your imports use `.js` extensions):

```ts
import { createApiClient, ApiError } from '../api-client.js';
import type { PublicRun, TurnResult, PublicQuestion, Answer } from '../api-client.js';

export const api = createApiClient({ baseUrl: 'http://localhost:8787' });
```

Every method returns a promise and rejects with an `ApiError` (`status`, `code`, `message`). When we change the API we change that file, so copy it again after pulling.

With no keys in `.env` the server runs on built-in mocks and two sample courses, so you can build every screen without Gemini or MongoDB.

## 2. Your scenes and our endpoints

Your game registers four scenes today (`game/main.ts`): `title`, `play`, `pause` and `gameover`. The game loop needs five screens. This is one way to map them; the names of new scenes are suggestions.

| Screen | Scene | Calls | Leaves when |
|---|---|---|---|
| Title | `title` (yours) | `api.health()` to show whether the server is up | Play → `upload` |
| Course and run setup | `upload` (new) | `listSamples()`, `seedCourse(sample)` or `uploadCourse(files)`, then poll `getCourse(id)`, then `createRun({ courseId, targetGrade, studentEmoji, scope })` | `createRun` succeeds → `learning` |
| Learning phase | `learning` (new) | `teach(runId, text)`, `answerQuestion(runId, qid, text)`, `skipQuestion(runId, qid)`, `ready(runId)` | `ready` succeeds → `play` |
| Room fight | `play` (yours) | `turn(runId)`, `help(runId, eventId, answer)`, then `retry(runId)` or `continueRun(runId)` | retry → `learning`; continue → `learning` or the boss |
| Boss | `play` in boss mode, or `boss` (new) | `turn(runId)`, `help(runId, eventId, answer)` | `boss_end` → `gameover` |
| Results | `gameover` (yours) | `getResults(runId)` (also inside the `boss_end` turn result) | Play again → `upload` |
| Pause | `pause` (yours) | none | |

Notes on your existing scenes:

- **`pause`** needs no API call. The fight only advances when the game calls `turn`, so pausing is always safe. The one exception is a timed "Help me!" question: its deadline is on the server and keeps running.
- **Restart** in the pause menu currently does `game.scenes.go('play')`. With the backend, a restart means creating a new run (`createRun`) and going to `learning`.
- **Which scene to show** is always decided by `run.phase`: `learning` → learning, `room` and `room_result` → fight, `boss` → boss, `results` → results. Keep the run id (for example in the URL or in your save data) and call `getRun(runId)` on load to resume.

## 3. Course setup and ingest progress

```ts
const { samples } = await api.listSamples();            // [{ id: 'seasons', title: '...' }, ...]
const { courseId } = await api.seedCourse('seasons');   // instant, for the demo

// or a real upload (File objects from an <input type="file" multiple>):
const { courseId } = await api.uploadCourse(files.map((f) => ({ name: f.name, data: f })));
```

After an upload the server builds the course in the background. Poll about once a second:

```ts
const course = await api.getCourse(courseId);
course.status.stage;      // 'parsing' | 'outline' | 'style' | 'concepts' | 'ready' | 'error'
course.status.error;      // set when stage is 'error'
course.units;             // [{ title, concepts: [{ id, title, ready }] }]
course.rooms;             // [{ id, title, conceptIds, ready }]
```

- Show the stage, and a ready or pending mark next to each concept and room.
- **A run can start as soon as its first room is ready**, while later rooms are still being built. If `createRun` or `ready` answers 425 (`room_not_ready`), show "still preparing this room" and try again in a moment.
- `createRun` takes the target grade (`TARGET_GRADES`), an optional student emoji (one of `STUDENT_EMOJIS`; the student is never a human) and an optional `scope.roomIds` (default: every room).

## 4. Learning phase

```ts
const { notebookMd, questions } = await api.teach(run.id, explanationText);
// questions: [{ id, text, status: 'open' | 'answered' | 'skipped' }]

const { resolved, notebookMd } = await api.answerQuestion(run.id, q.id, answerText);
const { notebookMd } = await api.skipQuestion(run.id, q.id);
const run = await api.ready(run.id);     // phase is now 'room'
```

- `run.currentRoom` has the room title and its concepts. `run.rooms` has every room with `state: 'upcoming' | 'current' | 'passed'` for a progress map.
- The player can teach more than once. Questions that are still open stay on the list.
- Answering has no cost. Skipping is the risk: the student writes down a wrong belief. Pressing Ready with open questions skips them.
- The questions sound naive on purpose. Never label one as a trap.

**Showing the notebook.** `notebookMd` is small, predictable Markdown, and the player is meant to read it:

```md
# Notebook

## Axial tilt and sunlight angle
- Earth's axis is tilted 23.5 degrees.
- We're closer to the Sun in summer.
```

One `## ` heading per concept and one `- ` bullet per note. A wrong belief looks like any other note; do not highlight it. Refresh the notebook from every response that carries `notebookMd`, and from `getRun` after a fight (a correct "Help me!" answer adds a note).

## 5. Fights: animating a `TurnResult`

One button, **Next turn**, calls `api.turn(run.id)`. Switch on `result.kind`:

```ts
const result = await api.turn(run.id);
switch (result.kind) {
  case 'student_answer': /* the student answered */ break;
  case 'help_me':        /* the student asks the player: see section 6 */ break;
  case 'help_result':    /* a "Help me!" event that timed out was settled */ break;
  case 'room_end':       /* summary: result.passed, result.failedTurns */ break;
  case 'boss_end':       /* summary: result.results */ break;
}
```

For `student_answer` and `help_result`, animate in this order:

1. **The question appears** (`result.question.prompt` and its options or items).
2. **The attack**: the student (or the player) answers. Show `result.answerText` for the student.
3. **Hit or miss**: `result.correct` is true → the student's attack lands on the monster. False → the monster hits the student. Then reveal `result.correctAnswer.text` and `result.explanation`.
4. **Update the bar**: set hearts to `result.hearts` (rooms) or health to `result.health` (boss). `result.damage` is what was just lost.
5. **The student's thinking**: `result.reasoning` and `result.citedNotes`. When wrong, `result.reason` says why: `'not in my notes'`, `'wrong belief'` or `'unknown'`.
6. **Check `result.phaseAfter`**: `'room'` or `'boss'` means the fight goes on. `'room_result'` or `'results'` means it just ended: call `turn` once more to get the summary.

The summaries:

- **`room_end`**: `passed: true` → show Continue (`continueRun`). `passed: false` → show the reasoning trace (`failedTurns`: each wrong question with the student's reasoning and the notes it cited) and Retry (`retry`). Retry goes back to learning for the same room with the notebook kept and hearts reset.
- **`boss_end`**: `results` has the predicted grade. Go to the results screen.

Sizes for the bars come from the run: `run.rules.roomHearts`, `run.room.totalTurns`, `run.boss.totalTurns`. Boss health runs from 100 down to 0. Mini rooms never change the grade.

On reload, `run.room.log` or `run.boss.log` holds every turn result so far, so the screen can be rebuilt.

## 6. "Help me!" events

Sometimes the student asks the player to solve a question. `turn` returns:

```ts
{ kind: 'help_me', eventId, question, timeBudgetSec, deadline }   // deadline: ISO string or null
```

1. **Before the player starts, show how hard it is**: `question.difficulty` (1 to 5) and `timeBudgetSec`, for example "Tough one: 90s".
2. **Countdown**: count down to `deadline` (`new Date(deadline).getTime() - Date.now()`). The server is the judge of lateness, so the countdown is only a display. **If `deadline` is `null`, show no countdown**: that is the untimed mode (`run.rules.helpMeTimed` is false), also used for accessibility.
3. **Input by question type** (section 7), then send it:

```ts
const result = await api.help(run.id, eventId, answer);   // kind: 'help_result'
```

4. When the countdown reaches zero, submit whatever the player has entered. A late answer counts as wrong.
5. `help_result` has `correct`, `late`, `correctAnswer`, `explanation`, `solveTimeSec`, `noteAdded` (the note the student wrote on a correct answer) and the same damage fields as a student turn. Animate it like section 5.

If the game reloads while an event is waiting, `run.pendingHelpMe` holds it: reopen the question.

## 7. Rendering each question type

`PublicQuestion` is `{ id, type, prompt, payload, difficulty, timeBudgetSec }`. Always show `prompt`. The payload and the answer to send depend on `type`:

| `type` | Show | Input | `answer` to send |
|---|---|---|---|
| `mcq` | `payload.options` (strings) | One button per option | `{ choiceIndex: 2 }` |
| `true_false` | `payload.statement` | True and False buttons | `{ value: true }` |
| `multi_select` | `payload.options` | Checkboxes and a Submit button | `{ choiceIndexes: [0, 2] }` |
| `numeric` | `payload.unit` next to the field (may be `null`) | Number field | `{ value: 71.5 }` |
| `short_text` | | Text field | `{ text: 'O(log n)' }` |
| `ordering` | `payload.items` in the order given | Tap items in sequence, or drag to reorder | `{ order: [2, 0, 1] }` (item indexes in the chosen order) |
| `free_response` | | Never used for "Help me!" | |

Indexes are positions in the arrays exactly as the server sent them, so don't shuffle options or items on the client. `student_answer` results carry `answerText` and `correctAnswer.text`, ready to display, so the game never has to format an answer itself.

## 8. Results

```ts
const r = await api.getResults(run.id);
r.predictedGradePct;      // 0..100, the boss health that was left
r.letter;                 // 'A' ... 'D' or 'F'
r.target; r.metTarget;    // metTarget false = the gauntlet is failed
r.conceptAccuracy;        // [{ title, correct, total, accuracy }]
r.helpMe;                 // { offered, correct, wrong, late, avgSolveTimeSec }
r.costlyMisconceptions;   // the study guide
```

Each costly misconception has `description`, `beliefStatement` (the wrong note the student held), `correction`, the `questionPrompt` it cost, and `materialRef` (`fileName`, `page`, `sectionPath`, `quote`) pointing at where the course material covers it. This is the one place where misconceptions are revealed.

## 9. Fields that must never be shown

The public API never sends answer keys or misconception data before they are meant to be seen, so anything the client receives from the normal endpoints is safe to show at the moment it arrives. Two rules remain for the game:

- **`getDebug(runId)` is for development only.** It returns everything hidden (answer keys, the misconception list, which notes are wrong beliefs, the boss targeting). Never call it from the real game. It only works when the server runs with `DEBUG=true`.
- **Don't reveal ahead of time.** Show `correctAnswer` and `explanation` only as part of the turn result they arrive in, never mark a notebook line as wrong, and don't hint that a student question is a trap.

## 10. Errors

| Status | Code | What the game should do |
|---|---|---|
| 409 | `wrong_phase` | The screen is out of date. Call `getRun` and show the scene for `run.phase`. |
| 409 | `help_pending` | A "Help me!" question is waiting. Show it (`run.pendingHelpMe`). |
| 409 | `help_event_not_pending`, `question_not_open` | Already handled (a double click). Refresh from `getRun`. |
| 425 | `room_not_ready` | Still building the room. Retry in a second or two. |
| 502 | `llm_error` | The model timed out. Nothing changed, so offer "Try again". |
| 0 | `network_error` | The server isn't reachable. |

Disable buttons while a request is in flight. Calls that use the model (`teach`, `answerQuestion`, `turn`) can take a couple of seconds, so show the student "thinking".
