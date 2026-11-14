/** Render API.md from real HTTP examples captured by e2e.ts. */
import { readFile, writeFile } from 'node:fs/promises';

interface Example {
  method: string;
  route: string;
  path: string;
  status: number;
  request?: unknown;
  multipart?: boolean;
  responseIsExcerpt?: boolean;
  response: Record<string, any>;
}

const docs = new URL('../docs/', import.meta.url);
const capture = JSON.parse(await readFile(new URL('api-examples.json', docs), 'utf8')) as { sample: string; examples: Example[] };
const descriptions: Record<string, string> = {
  'GET /api/health': 'Reports the selected LLM provider, storage mode and debug flag.',
  'GET /api/settings/api': 'Local API setup. Returns provider, generation/embedding model names, key-presence booleans, timeout, embedding dimensions and persistence mode. Never returns keys. Requires a loopback connection, a localhost Host, and an allowed browser origin. Responses use `Cache-Control: no-store`.',
  'POST /api/settings/api': 'Saves and applies API settings for subsequent calls without restarting or deleting runs. `provider` is `openai`, `gemini` or `mock`. Optional `openai`/`gemini` objects accept `model`, `embeddingModel`, and write-only `apiKey`: omit the key to retain it, send `null` to remove it. The selected live provider requires a key. `timeoutMs` is 1,000–180,000 for interactive requests; `ingestTimeoutMs` is 1,000–600,000 for new course preparation requests (default 180,000). Unknown fields are rejected. Same local-access rules as GET. Production server saves to the ignored, permission-restricted `.local/api-settings.json`; explicit test environments default to session-only settings.',
  'POST /api/settings/api/test': 'Validates an unsaved candidate with the same body and local-access rules as Save. For a live provider, makes one small structured generation request (with at most one invalid-output retry) and an embedding request. Can incur API usage. Offline mode makes no provider calls. Does not save credentials or change the active provider.',
  'GET /api/samples': 'Lists the cached courses accepted by the seed endpoint.',
  'GET /api/archive': 'Lists prepared/uploaded courses as public course projections and recent run summaries. No answer keys, private question banks or hidden beliefs. The real server defaults to local disk storage under ignored `.local/archive`; explicit test containers stay in memory, and configured MongoDB storage remains supported.',
  'POST /api/runs/:id/pause': 'Idempotently pauses an unfinished run and persists `pausedAt`. Gameplay mutations then return 409 `run_paused`. A pending help deadline and solve clock are frozen until resume. Read-only archive/lesson views remain available.',
  'POST /api/runs/:id/end': 'Ends the expedition early and persists `endedAt` (idempotent). The run stays in the archive as a read-only record: every gameplay mutation and resume then return 409 `run_ended`; pause is a no-op; a pending "Help me!" closes with it. A finished (`results`) run returns 409 `wrong_phase`.',
  'DELETE /api/runs/:id': 'Permanently removes the run (progress, notebook, history). Its course, questions and stats stay. Returns `{ deleted: true, id }`; an unknown or already removed run is 404.',
  'DELETE /api/courses/:id': 'Permanently deletes a saved dungeon: its course, lessons, questions, question statistics, source chunks, and every associated expedition (notebook, history and progress). Other dungeons stay. Returns `{ deleted: true, id }`; unknown/already deleted ids are 404. Returns 409 `course_busy` while background preparation is active; retry after it finishes. The game requires confirmation before sending this request.',
  'POST /api/runs/:id/resume': 'Idempotently resumes the run. Shifts a pending help deadline and its started time by the paused duration, including time across server restarts. Does not advance a turn or erase notes.',
  'POST /api/courses/seed/:sample': 'Loads a cached course immediately. Bundled sample ids: `seasons` and `binary-search`.',
  'POST /api/courses': 'Accepts JSON `{ text, title? }` or multipart `files` plus optional `title`. Supported files: `.pdf`, `.txt`, `.md`, `.markdown`. The aggregate file size is capped by `MAX_UPLOAD_MB` (25 by default), with at most 20 files. JSON shares the request size cap. Each file is capped by `MAX_PAGES` (300). A 202 means accepted; poll the course until the first room is ready, or `status.stage` becomes `error`. The short upload examples below intentionally lack enough content for coverage in mock mode.',
  'GET /api/courses/:id': 'Returns public ingest progress, files, units, rooms and a style summary. Optional `status.activity` contains `message` (up to 240 characters), latest public OpenAI document-analysis `summary` (up to 1200 characters), and optional `completed`/`total` counts for the current work. Polling updates the Thinking panel below Stage. Summaries are optional; raw reasoning and question-generation output are excluded. Room readiness comes from `status.conceptsReady`; a complete course reaches `ready` only after coverage passes.',
  'POST /api/runs': 'Creates a run in `learning`. `targetGrade` is required: `A`, `A-`, `B+`, `B`, `B-`, `C+`, `C`, `C-`, `D`. Optional `studentEmoji` must be one of the values exported by the client. Optional `scope.roomIds` selects rooms; the default includes every course room. The first room must be ready (425 otherwise).',
  'GET /api/runs/:id': 'Returns the current public run, notebook, completed turn logs and pending help event. Store the run id to resume after a reload. Optional `history` contains completed room attempts, including retries: room title, hearts, answer accuracy/help counts, teaching/question counts and missed prompts with topic titles. Only already-seen outcomes are projected; hidden beliefs, question pools and answer keys remain excluded. Runs saved before this feature may have no history.',
  'POST /api/runs/:id/teach': 'Allowed in `learning`. `explanation` is trimmed, nonempty, at most 8,000 characters. Optional `conceptId` focuses review, notes and new questions on one concept of the current room; another room\'s concept returns 400 `validation_error` without mutation. Omitting it retains whole-room teaching. The response may include `feedback` (up to 600 characters): Pip\'s specific reply to this explanation, displayed alongside new notes. Brief, misspelled and partial on-topic claims are teachable; Pip reflects wrong claims without silently correcting them. Unrelated chatter need not add notes. Public learning questions include optional `conceptId` so the UI places them on the right topic. Adds notebook notes and up to the configured number of open questions. Existing open questions remain. Clear correction can resolve active beliefs; explicitly stating a wrong belief activates it again.',
  'POST /api/runs/:id/questions/:qid/answer': 'Allowed in `learning` for an open student question. `answer` is nonempty text, at most 4,000 characters. An unresolved answer activates the belief, like a skip. Answering or skipping a closed question returns 409.',
  'POST /api/runs/:id/questions/:qid/skip': 'Allowed in `learning` for an open student question. No body. Adds its belief as an ordinary notebook note and activates the hidden misconception.',
  'POST /api/runs/:id/ready': 'Allowed in `learning`. No body. Auto-skips open questions, draws fresh questions where available and starts a room with full hearts. Returns 425 if the room is still being prepared.',
  'POST /api/runs/:id/turn': 'Allowed in `room`, `room_result`, `boss`, `results`. No body. Returns a discriminated `TurnResult`; all five variants are captured below. Continue calling until `room_end` or `boss_end`. The final damage turn carries `phaseAfter`; call once more for the summary. Repeating a summary is safe. A pending help event is returned again until it expires, after which `/turn` settles it as late.',
  'POST /api/runs/:id/help/:eventId': 'Allowed in `room` or `boss` for the pending event. Send `{ answer: ... }` using the question-type table below. The server checks the deadline. A late answer costs damage. A correct answer adds a notebook note. Duplicate submissions return 409. Free-response questions never trigger help events.',
  'POST /api/runs/:id/retry': 'Allowed after a failed `room_result`. No body. Returns to `learning` for the same room; keeps the notebook and seen-question history. Hearts reset when `/ready` starts the next attempt.',
  'POST /api/runs/:id/continue': 'Allowed after a passed `room_result`. No body. Moves to the next room in `learning`, or starts the boss after the last room. Returns 425 if the next room is unready.',
  'GET /api/runs/:id/results': 'Allowed in `results`. Returns boss health rounded to a percentage, letter grade, target outcome, boss accuracy by concept, help stats and costly misconceptions with evidence references. Mini-room damage never affects the grade.',
  'GET /api/runs/:id/debug': 'Development only: 404 unless `DEBUG=true`. Returns `{ run, pack, questions, stats, timeBudgets }` with hidden state and keys. The captured response is explicitly an excerpt. Never use this endpoint in the player-facing game.',
};

const routeSource = await readFile(new URL('../server/src/routes.ts', import.meta.url), 'utf8');
const actualRoutes = [...routeSource.matchAll(/app\.(get|post|delete)\('([^']+)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
for (const route of actualRoutes) {
  if (!descriptions[route] || !capture.examples.some((e) => `${e.method} ${e.route}` === route && e.status < 400)) {
    throw new Error(`Missing description or HTTP capture for ${route}`);
  }
}
const json = (value: unknown) => '```json\n' + JSON.stringify(value, null, 2) + '\n```';
const output: string[] = [
  '# HTTP API reference',
  'Base URL: `http://localhost:8787/api`. All responses are JSON. The game is served from the same origin; the Phaser dev preview on `http://localhost:4173` is allowed by default, and `CORS_ORIGINS` adds others.',
  'These examples were captured from the integrated mock API by `scripts/e2e.ts`, using seed 42 and the seasons fixture. Ids and timestamps are real per-run values and will differ on your machine. An auxiliary run supplies the explicit learning-answer and wrong-phase examples. Full captured bodies are in [api-examples.json](api-examples.json); excerpts below omit fields, without altering the retained values. The `/debug` capture itself is also an excerpt.',
  '```sh\nnpm run e2e -- --capture-file docs/api-examples.json\nnpm run docs:api\n```',
  'The client is [shared/src/api-client.ts](../shared/src/api-client.ts), and the complete public types are in that same dependency-free file. See [STATE_MACHINE.md](STATE_MACHINE.md) for transitions and [ARCHITECTURE.md](ARCHITECTURE.md) for rendering.',
  '## Endpoints',
  '| Method | Path | Success |\n|---|---|---|\n' + actualRoutes.map((key) => {
    const e = capture.examples.find((e) => `${e.method} ${e.route}` === key && e.status < 400)!;
    return `| ${e.method} | \`${e.route}\` | ${e.status} |`;
  }).join('\n'),
  '## Answer shapes',
  '| Type | `answer` body field | Public payload |\n|---|---|---|\n' + [
    '| `mcq` | `{ "choiceIndex": 1 }` | `options: string[]` |',
    '| `true_false` | `{ "value": true }` | `statement` |',
    '| `multi_select` | `{ "choiceIndexes": [0, 2] }` | `options: string[]` |',
    '| `numeric` | `{ "value": 23.5 }` | `unit: string \\| null` |',
    '| `short_text` | `{ "text": "O(log n)" }` | `{}` |',
    '| `ordering` | `{ "order": [2, 0, 1] }` | `items: string[]` |',
    '| `free_response` | `{ "text": "..." }` | `{}`; student only, no help event |',
  ].join('\n'),
  'Indexes are zero-based and refer to the arrays exactly as served. Never shuffle them in the client. A public question also carries `id`, `type`, `prompt`, `difficulty` (1–5) and `timeBudgetSec`. A `help_me` event carries the effective budget after the time multiplier. Its `deadline` is an ISO timestamp, or `null` in untimed mode. An untimed budget is an estimate, not a deadline.',
];

for (const key of actualRoutes) {
  output.push(`## ${key}`, descriptions[key]);
  for (const e of capture.examples.filter((e) => `${e.method} ${e.route}` === key && e.status < 400)) {
    output.push(`### ${e.multipart ? 'Multipart upload' : e.response.kind ?? 'Example'}`);
    output.push(`Request: \`${e.method} ${e.path}\`${e.multipart ? ' (`multipart/form-data`; browser sets the boundary)' : e.request ? ' (`application/json`)' : ' (no body)'}.`);
    if (e.request !== undefined) output.push(json(e.request));
    let response: unknown = e.response;
    let excerpt = e.responseIsExcerpt;
    if (e.response.phase) {
      const { id, courseId, phase, roomIndex, currentRoom, learning, rules, pendingHelpMe, pausedAt, history } = e.response;
      response = { id, courseId, phase, roomIndex, currentRoom, learning, rules, ...(pausedAt ? {pausedAt} : {}),
        ...(history ? {history} : {}),
        ...(e.response.room ? { room: { attempt: e.response.room.attempt, turn: e.response.room.turn, totalTurns: e.response.room.totalTurns, hearts: e.response.room.hearts, passed: e.response.room.passed } } : {}),
        ...(e.response.boss ? { boss: { turn: e.response.boss.turn, totalTurns: e.response.boss.totalTurns, health: e.response.boss.health } } : {}),
        ...(pendingHelpMe ? { pendingHelpMe } : {}) };
      excerpt = true;
    }
    output.push(`Response: HTTP ${e.status}${excerpt ? ' (excerpt)' : ''}.`, json(response));
  }
}
const error = capture.examples.find((e) => e.status === 409)!;
output.push('## Errors and retries',
  'Errors have one shape. This response was captured by calling `/turn` during `learning`:', json(error.response),
  '| HTTP | Codes | Meaning |\n|---|---|---|\n| 400 | `validation_error`, `invalid_answer` | Invalid body or answer shape |\n| 404 | `not_found` | Unknown id/sample, or debug disabled |\n| 409 | `wrong_phase`, `run_paused`, `help_pending`, `question_not_open`, `help_event_not_pending` | Refresh the run and use the allowed action |\n| 413 | `payload_too_large` | Upload/body/page limit exceeded |\n| 415 | `unsupported_file` | Unsupported upload type |\n| 502 | `llm_error` | Model failure, invalid output after one retry, or timeout |\n| 500 | `internal_error` | Unexpected server/storage failure |\n| 425 | `room_not_ready` | Poll course readiness before retrying |',
  'Within one server process, mutations for a run are serialized. Concurrent `/turn` calls each advance a turn; clients should disable their action button while a request is in flight. Repeated `/help` and learning answers are rejected after the first succeeds. A model failure before saving a turn leaves that turn unchanged. After a network error, refresh the run before deciding whether to retry, because the request may already have committed.',
  'The API currently has no account/authentication layer; run ids identify runs. Debug mode is intended for local development. Per-run locking is process-local and does not coordinate multiple backend replicas.',
  '## Mock and live behavior',
  'No credentials are required for the cached samples. The e2e bot uses `/debug` to simulate a teacher who knows the subject; the real student prompt receives only its notebook and the public question. In the sample demonstration, one misconception remains deliberately uncorrected; if its targeted boss question becomes a help event, the bot supplies the corresponding wrong answer so it remains visible in the study guide.',
  'Arbitrary uploads in mock mode use a limited heuristic fallback and may end in `error` when coverage cannot be met. Use the bundled samples for an offline demo. Gemini-backed generation, native PDF reading and Atlas search require their credentials and have not been exercised live in this continuation.',
);
await writeFile(new URL('API.md', docs), output.join('\n\n') + '\n');
console.log(`Wrote docs/API.md from ${capture.examples.length} captures covering ${actualRoutes.length} endpoints.`);
