# API reference (in the page)

There is no server: these routes are answered inside the page by `backend.js` (`server/src/router.ts`), and the game reaches them through the API client with the backend's `fetch`. Paths are under `/api` on the made-up origin `https://backend.pips-notebook.invalid`; nothing goes over a network. All responses are JSON.

These examples were captured from the integrated mock API by `scripts/e2e.ts`, using seed 42 and the seasons fixture. Ids and timestamps are real per-run values and will differ on your machine. An auxiliary run supplies the explicit learning-answer and wrong-phase examples. Full captured bodies are in [api-examples.json](api-examples.json); excerpts below omit fields, without altering the retained values. The `/debug` capture itself is also an excerpt.

```sh
npm run e2e -- --capture-file docs/api-examples.json
npm run docs:api
```

The client is [shared/src/api-client.ts](../shared/src/api-client.ts), and the complete public types are in that same dependency-free file. See [STATE_MACHINE.md](STATE_MACHINE.md) for transitions and [ARCHITECTURE.md](ARCHITECTURE.md) for rendering.

## Endpoints

| Method | Path | Success |
|---|---|---|
| GET | `/api/health` | 200 |
| GET | `/api/settings/api` | 200 |
| POST | `/api/settings/api` | 200 |
| POST | `/api/settings/api/test` | 200 |
| GET | `/api/settings/storage` | 200 |
| GET | `/api/backup` | 200 |
| POST | `/api/backup` | 200 |
| GET | `/api/samples` | 200 |
| GET | `/api/archive` | 200 |
| POST | `/api/courses/seed/:sample` | 200 |
| POST | `/api/courses` | 202 |
| GET | `/api/courses/:id` | 200 |
| DELETE | `/api/courses/:id` | 200 |
| POST | `/api/runs` | 201 |
| GET | `/api/runs/:id` | 200 |
| POST | `/api/runs/:id/pause` | 200 |
| POST | `/api/runs/:id/resume` | 200 |
| POST | `/api/runs/:id/end` | 200 |
| DELETE | `/api/runs/:id` | 200 |
| POST | `/api/runs/:id/teach` | 200 |
| POST | `/api/runs/:id/questions/:qid/answer` | 200 |
| POST | `/api/runs/:id/questions/:qid/skip` | 200 |
| POST | `/api/runs/:id/ready` | 200 |
| POST | `/api/runs/:id/turn` | 200 |
| POST | `/api/runs/:id/help/:eventId` | 200 |
| POST | `/api/runs/:id/retry` | 200 |
| POST | `/api/runs/:id/continue` | 200 |
| GET | `/api/runs/:id/results` | 200 |
| GET | `/api/runs/:id/debug` | 200 |

## Answer shapes

| Type | `answer` body field | Public payload |
|---|---|---|
| `mcq` | `{ "choiceIndex": 1 }` | `options: string[]` |
| `true_false` | `{ "value": true }` | `statement` |
| `multi_select` | `{ "choiceIndexes": [0, 2] }` | `options: string[]` |
| `numeric` | `{ "value": 23.5 }` | `unit: string \| null` |
| `short_text` | `{ "text": "O(log n)" }` | `{}` |
| `ordering` | `{ "order": [2, 0, 1] }` | `items: string[]` |
| `free_response` | `{ "text": "..." }` | `{}`; student only, no help event |

Indexes are zero-based and refer to the arrays exactly as served. Never shuffle them in the client. A public question also carries `id`, `type`, `prompt`, `difficulty` (1–5) and `timeBudgetSec`. A `help_me` event carries the effective budget after the time multiplier. Its `deadline` is an ISO timestamp, or `null` in untimed mode. An untimed budget is an estimate, not a deadline.

## GET /api/health

Reports the selected LLM provider, storage mode and debug flag.

### Example

Request: `GET /api/health` (no body).

Response: HTTP 200.

```json
{
  "ok": true,
  "llmProvider": "mock",
  "storage": "memory",
  "debug": true
}
```

## GET /api/settings/api

The player's AI settings. Returns provider, generation/embedding model names, key-presence booleans, timeouts, embedding dimensions and `persistence` (`local`: kept in this browser's localStorage; `session`: this tab only). Never returns keys.

### Example

Request: `GET /api/settings/api` (no body).

Response: HTTP 200.

```json
{
  "provider": "mock",
  "providers": {
    "openai": {
      "model": "gpt-5.6-luna",
      "embeddingModel": "text-embedding-3-small",
      "hasApiKey": false
    },
    "gemini": {
      "model": "gemini-2.5-flash",
      "embeddingModel": "gemini-embedding-001",
      "hasApiKey": false
    }
  },
  "timeoutMs": 30000,
  "ingestTimeoutMs": 180000,
  "embeddingDims": 768,
  "persistence": "session"
}
```

## POST /api/settings/api

Saves and applies AI settings for subsequent calls without deleting runs. `provider` is `openai`, `gemini` or `mock`. Optional `openai`/`gemini` objects accept `model`, `embeddingModel`, and write-only `apiKey`: omit the key to retain it, send `null` to remove it. The selected live provider requires a key. `timeoutMs` is 1,000–180,000 for interactive requests; `ingestTimeoutMs` is 1,000–600,000 for new course preparation requests (default 180,000). `rememberKey: false` keeps the settings in sessionStorage (gone when the tab closes), `true` in localStorage. Unknown fields are rejected. Keys go only to their provider.

### Example

Request: `POST /api/settings/api` (`application/json`).

```json
{
  "provider": "mock"
}
```

Response: HTTP 200.

```json
{
  "provider": "mock",
  "providers": {
    "openai": {
      "model": "gpt-5.6-luna",
      "embeddingModel": "text-embedding-3-small",
      "hasApiKey": false
    },
    "gemini": {
      "model": "gemini-2.5-flash",
      "embeddingModel": "gemini-embedding-001",
      "hasApiKey": false
    }
  },
  "timeoutMs": 30000,
  "ingestTimeoutMs": 180000,
  "embeddingDims": 768,
  "persistence": "session"
}
```

## POST /api/settings/api/test

Validates an unsaved candidate with the same body as Save. For a live provider, makes one small structured generation request (with at most one invalid-output retry) and an embedding request, from the browser to the provider. Can incur API usage. Offline mode makes no provider calls. Does not save credentials or change the active provider.

### Example

Request: `POST /api/settings/api/test` (`application/json`).

```json
{
  "provider": "mock"
}
```

Response: HTTP 200.

```json
{
  "ok": true,
  "provider": "mock",
  "message": "Offline mode is ready. No API key is needed."
}
```

## GET /api/settings/storage

What is saved in this browser. `active` is `browser` (IndexedDB) or `memory` (the browser blocks storage, and in tests, like the capture below); `courses` and `runs` count what is saved; `persisted` says whether the browser promised not to clear the data (`null` when it cannot say); `usageBytes` and `quotaBytes` are the browser's estimate; `error` says why storage is blocked.

### Example

Request: `GET /api/settings/storage` (no body).

Response: HTTP 200.

```json
{
  "active": "memory",
  "courses": 0,
  "runs": 0,
  "persisted": null,
  "usageBytes": null,
  "quotaBytes": null,
  "error": null
}
```

## GET /api/backup

Every dungeon (course, questions, question statistics, search chunks) and its expeditions as one JSON file: `{ app: "pips-notebook", version: 1, exportedAt, courses, questions, questionStats, chunks, runs }`. It holds answer keys (the player's own copy) and never API keys. The captured response is an excerpt with counts.

### Example

Request: `GET /api/backup` (no body).

Response: HTTP 200 (excerpt).

```json
{
  "app": "pips-notebook",
  "version": 1,
  "exportedAt": "2026-11-15T05:18:29.752Z",
  "courses": [
    {
      "id": "sample-seasons",
      "title": "Why Earth Has Seasons"
    }
  ],
  "questions": 44,
  "questionStats": 27,
  "chunks": 15,
  "runs": 1
}
```

## POST /api/backup

Imports a backup file as returned by `GET /api/backup`. The file is validated against the schema; a file that is not a backup is 400. Dungeons already saved are skipped (`skipped`), never replaced; nothing is deleted. Returns how many dungeons and expeditions were added.

### Example

Request: `POST /api/backup` (`application/json`).

```json
"(a backup file, as GET /api/backup returns it)"
```

Response: HTTP 200.

```json
{
  "courses": 0,
  "runs": 0,
  "skipped": 3
}
```

## GET /api/samples

Lists the cached courses accepted by the seed endpoint, hand-made demos (`demo-*`) first.

### Example

Request: `GET /api/samples` (no body).

Response: HTTP 200.

```json
{
  "samples": [
    {
      "id": "binary-search",
      "title": "Binary Search"
    },
    {
      "id": "seasons",
      "title": "Why Earth Has Seasons"
    }
  ]
}
```

## GET /api/archive

Lists prepared/uploaded courses as public course projections and recent run summaries. No answer keys, private question banks or hidden beliefs. Everything is read from this browser's IndexedDB.

### Example

Request: `GET /api/archive` (no body).

Response: HTTP 200.

```json
{
  "courses": [
    {
      "id": "sample-seasons",
      "title": "Why Earth Has Seasons",
      "status": {
        "stage": "ready",
        "conceptsReady": [
          "c2",
          "c1",
          "c3"
        ]
      },
      "files": [
        {
          "id": "f1",
          "name": "seasons.md",
          "type": "md",
          "pages": 1
        }
      ],
      "units": [
        {
          "id": "u1",
          "title": "Seasons",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle",
              "summary": "Earth's tilted axis, not its distance from the Sun, causes the seasons by changing the angle of sunlight; the noon Sun altitude rule quantifies it.",
              "ready": true
            },
            {
              "id": "c2",
              "title": "Day length",
              "summary": "Day length changes with latitude and season because of the tilt, not because Earth's spin changes; the hottest weather lags the longest day.",
              "ready": true
            },
            {
              "id": "c3",
              "title": "Opposite hemispheres",
              "summary": "The hemispheres have opposite seasons, split by the equator and not by east or west.",
              "ready": true
            }
          ]
        }
      ],
      "rooms": [
        {
          "id": "r1",
          "title": "Axial tilt and sunlight angle",
          "conceptIds": [
            "c1"
          ],
          "ready": true
        },
        {
          "id": "r2",
          "title": "Day length",
          "conceptIds": [
            "c2"
          ],
          "ready": true
        },
        {
          "id": "r3",
          "title": "Opposite hemispheres",
          "conceptIds": [
            "c3"
          ],
          "ready": true
        }
      ],
      "styleSummary": {
        "voice": "A short, friendly handout: a rule, a worked example, then direct practice problems with one-line answers.",
        "notation": "Angles in degrees. Latitude is positive in the north and negative in the south. Distances in million km.",
        "units": "degrees, hours, million km",
        "topFormats": [
          "numeric",
          "true_false",
          "mcq",
          "short_text",
          "multi_select",
          "ordering",
          "free_response"
        ]
      }
    }
  ],
  "runs": []
}
```

## POST /api/courses/seed/:sample

Loads a cached course immediately. Bundled sample ids: `seasons` and `binary-search`.

### Example

Request: `POST /api/courses/seed/seasons` (no body).

Response: HTTP 200.

```json
{
  "courseId": "sample-seasons"
}
```

## POST /api/courses

Accepts JSON `{ text, title? }` or multipart `files` plus optional `title`. Supported files: `.pdf`, `.txt`, `.md`, `.markdown`. The aggregate file size is capped by `MAX_UPLOAD_MB` (25 by default), with at most 20 files. JSON shares the request size cap. Each file is capped by `MAX_PAGES` (300). A 202 means accepted; poll the course until the first room is ready, or `status.stage` becomes `error`. The short upload examples below intentionally lack enough content for coverage in mock mode.

### Example

Request: `POST /api/courses` (`application/json`).

```json
{
  "text": "# Seasons\n\nEarth has seasons because its axis is tilted.\n",
  "title": "API upload example"
}
```

Response: HTTP 202.

```json
{
  "courseId": "crs_a990e395f6"
}
```

### Multipart upload

Request: `POST /api/courses` (`multipart/form-data`; browser sets the boundary).

```json
[
  {
    "field": "title",
    "value": "Multipart example"
  },
  {
    "field": "files",
    "value": {
      "name": "seasons.md",
      "type": "text/markdown",
      "size": 57
    }
  }
]
```

Response: HTTP 202.

```json
{
  "courseId": "crs_9af7e3f583"
}
```

## GET /api/courses/:id

Returns public ingest progress, files, units, rooms and a style summary. Optional `status.activity` contains `message` (up to 240 characters), latest public OpenAI document-analysis `summary` (up to 1200 characters), and optional `completed`/`total` counts for the current work. Polling updates the Thinking panel below Stage. Summaries are optional; raw reasoning and question-generation output are excluded. Room readiness comes from `status.conceptsReady`; a complete course reaches `ready` only after coverage passes.

### Example

Request: `GET /api/courses/sample-seasons` (no body).

Response: HTTP 200.

```json
{
  "id": "sample-seasons",
  "title": "Why Earth Has Seasons",
  "status": {
    "stage": "ready",
    "conceptsReady": [
      "c2",
      "c1",
      "c3"
    ]
  },
  "files": [
    {
      "id": "f1",
      "name": "seasons.md",
      "type": "md",
      "pages": 1
    }
  ],
  "units": [
    {
      "id": "u1",
      "title": "Seasons",
      "concepts": [
        {
          "id": "c1",
          "title": "Axial tilt and sunlight angle",
          "summary": "Earth's tilted axis, not its distance from the Sun, causes the seasons by changing the angle of sunlight; the noon Sun altitude rule quantifies it.",
          "ready": true
        },
        {
          "id": "c2",
          "title": "Day length",
          "summary": "Day length changes with latitude and season because of the tilt, not because Earth's spin changes; the hottest weather lags the longest day.",
          "ready": true
        },
        {
          "id": "c3",
          "title": "Opposite hemispheres",
          "summary": "The hemispheres have opposite seasons, split by the equator and not by east or west.",
          "ready": true
        }
      ]
    }
  ],
  "rooms": [
    {
      "id": "r1",
      "title": "Axial tilt and sunlight angle",
      "conceptIds": [
        "c1"
      ],
      "ready": true
    },
    {
      "id": "r2",
      "title": "Day length",
      "conceptIds": [
        "c2"
      ],
      "ready": true
    },
    {
      "id": "r3",
      "title": "Opposite hemispheres",
      "conceptIds": [
        "c3"
      ],
      "ready": true
    }
  ],
  "styleSummary": {
    "voice": "A short, friendly handout: a rule, a worked example, then direct practice problems with one-line answers.",
    "notation": "Angles in degrees. Latitude is positive in the north and negative in the south. Distances in million km.",
    "units": "degrees, hours, million km",
    "topFormats": [
      "numeric",
      "true_false",
      "mcq",
      "short_text",
      "multi_select",
      "ordering",
      "free_response"
    ]
  }
}
```

## DELETE /api/courses/:id

Permanently deletes a saved dungeon: its course, lessons, questions, question statistics, source chunks, and every associated expedition (notebook, history and progress). Other dungeons stay. Returns `{ deleted: true, id }`; unknown/already deleted ids are 404. Returns 409 `course_busy` while background preparation is active; retry after it finishes. The game requires confirmation before sending this request.

### Example

Request: `DELETE /api/courses/sample-binary-search` (no body).

Response: HTTP 200.

```json
{
  "deleted": true,
  "id": "sample-binary-search"
}
```

## POST /api/runs

Creates a run in `learning`. `targetGrade` is required: `A`, `A-`, `B+`, `B`, `B-`, `C+`, `C`, `C-`, `D`. Optional `studentEmoji` must be one of the values exported by the client. Optional `scope.roomIds` selects rooms; the default includes every course room. The first room must be ready (425 otherwise). A course pack with its own `pace` (short demos) reports it in `rules`.

### Example

Request: `POST /api/runs` (`application/json`).

```json
{
  "courseId": "sample-seasons",
  "targetGrade": "B"
}
```

Response: HTTP 201 (excerpt).

```json
{
  "id": "run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4",
  "courseId": "sample-seasons",
  "phase": "learning",
  "roomIndex": 0,
  "currentRoom": {
    "id": "r1",
    "title": "Axial tilt and sunlight angle",
    "concepts": [
      {
        "id": "c1",
        "title": "Axial tilt and sunlight angle",
        "summary": "Earth's tilted axis, not its distance from the Sun, causes the seasons by changing the angle of sunlight; the noon Sun altitude rule quantifies it."
      }
    ],
    "ready": true,
    "state": "current"
  },
  "learning": {
    "pendingQuestions": [],
    "teachCount": 0
  },
  "rules": {
    "roomQuestions": 5,
    "roomHearts": 3,
    "bossQuestions": 10,
    "maxStudentQuestions": 3,
    "helpMeTimed": true
  }
}
```

## GET /api/runs/:id

Returns the current public run, notebook, completed turn logs and pending help event. Store the run id to resume after a reload. Optional `history` contains completed room attempts, including retries: room title, hearts, answer accuracy/help counts, teaching/question counts and missed prompts with topic titles. Only already-seen outcomes are projected; hidden beliefs, question pools and answer keys remain excluded. Runs saved before this feature may have no history.

### Example

Request: `GET /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4` (no body).

Response: HTTP 200 (excerpt).

```json
{
  "id": "run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4",
  "courseId": "sample-seasons",
  "phase": "learning",
  "roomIndex": 0,
  "currentRoom": {
    "id": "r1",
    "title": "Axial tilt and sunlight angle",
    "concepts": [
      {
        "id": "c1",
        "title": "Axial tilt and sunlight angle",
        "summary": "Earth's tilted axis, not its distance from the Sun, causes the seasons by changing the angle of sunlight; the noon Sun altitude rule quantifies it."
      }
    ],
    "ready": true,
    "state": "current"
  },
  "learning": {
    "pendingQuestions": [],
    "teachCount": 0
  },
  "rules": {
    "roomQuestions": 5,
    "roomHearts": 3,
    "bossQuestions": 10,
    "maxStudentQuestions": 3,
    "helpMeTimed": true
  },
  "history": [
    {
      "roomId": "r1",
      "title": "Axial tilt and sunlight angle",
      "attempt": 1,
      "passed": false,
      "hearts": 0,
      "maxHearts": 3,
      "correct": 1,
      "total": 4,
      "helped": 1,
      "teachCount": 1,
      "questionsAsked": 3,
      "questionsAnswered": 0,
      "questionsSkipped": 3,
      "missed": [
        {
          "prompt": "Find the noon Sun altitude in Boston (latitude 42) on the June solstice.",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        },
        {
          "prompt": "True or false?",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        },
        {
          "prompt": "What is the main cause of Earth's seasons?",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        }
      ]
    }
  ],
  "room": {
    "attempt": 1,
    "turn": 4,
    "totalTurns": 5,
    "hearts": 0,
    "passed": false
  }
}
```

## POST /api/runs/:id/pause

Idempotently pauses an unfinished run and persists `pausedAt`. Gameplay mutations then return 409 `run_paused`. A pending help deadline and solve clock are frozen until resume. Read-only archive/lesson views remain available.

### Example

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/pause` (no body).

Response: HTTP 200 (excerpt).

```json
{
  "id": "run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4",
  "courseId": "sample-seasons",
  "phase": "learning",
  "roomIndex": 0,
  "currentRoom": {
    "id": "r1",
    "title": "Axial tilt and sunlight angle",
    "concepts": [
      {
        "id": "c1",
        "title": "Axial tilt and sunlight angle",
        "summary": "Earth's tilted axis, not its distance from the Sun, causes the seasons by changing the angle of sunlight; the noon Sun altitude rule quantifies it."
      }
    ],
    "ready": true,
    "state": "current"
  },
  "learning": {
    "pendingQuestions": [],
    "teachCount": 0
  },
  "rules": {
    "roomQuestions": 5,
    "roomHearts": 3,
    "bossQuestions": 10,
    "maxStudentQuestions": 3,
    "helpMeTimed": true
  },
  "pausedAt": "2026-11-15T05:18:29.649Z"
}
```

## POST /api/runs/:id/resume

Idempotently resumes the run. Shifts a pending help deadline and its started time by the paused duration, including time across page reloads. Does not advance a turn or erase notes.

### Example

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/resume` (no body).

Response: HTTP 200 (excerpt).

```json
{
  "id": "run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4",
  "courseId": "sample-seasons",
  "phase": "learning",
  "roomIndex": 0,
  "currentRoom": {
    "id": "r1",
    "title": "Axial tilt and sunlight angle",
    "concepts": [
      {
        "id": "c1",
        "title": "Axial tilt and sunlight angle",
        "summary": "Earth's tilted axis, not its distance from the Sun, causes the seasons by changing the angle of sunlight; the noon Sun altitude rule quantifies it."
      }
    ],
    "ready": true,
    "state": "current"
  },
  "learning": {
    "pendingQuestions": [],
    "teachCount": 0
  },
  "rules": {
    "roomQuestions": 5,
    "roomHearts": 3,
    "bossQuestions": 10,
    "maxStudentQuestions": 3,
    "helpMeTimed": true
  }
}
```

## POST /api/runs/:id/end

Ends the expedition early and persists `endedAt` (idempotent). The run stays in the archive as a read-only record: every gameplay mutation and resume then return 409 `run_ended`; pause is a no-op; a pending "Help me!" closes with it. A finished (`results`) run returns 409 `wrong_phase`.

### Example

Request: `POST /api/runs/run_50d62f17-f2e4-405a-ac3b-ecba61fcfb7f/end` (no body).

Response: HTTP 200 (excerpt).

```json
{
  "id": "run_50d62f17-f2e4-405a-ac3b-ecba61fcfb7f",
  "courseId": "sample-seasons",
  "phase": "learning",
  "roomIndex": 0,
  "currentRoom": {
    "id": "r1",
    "title": "Axial tilt and sunlight angle",
    "concepts": [
      {
        "id": "c1",
        "title": "Axial tilt and sunlight angle",
        "summary": "Earth's tilted axis, not its distance from the Sun, causes the seasons by changing the angle of sunlight; the noon Sun altitude rule quantifies it."
      }
    ],
    "ready": true,
    "state": "current"
  },
  "learning": {
    "pendingQuestions": [],
    "teachCount": 0
  },
  "rules": {
    "roomQuestions": 5,
    "roomHearts": 3,
    "bossQuestions": 10,
    "maxStudentQuestions": 3,
    "helpMeTimed": true
  }
}
```

## DELETE /api/runs/:id

Permanently removes the run (progress, notebook, history). Its course, questions and stats stay. Returns `{ deleted: true, id }`; an unknown or already removed run is 404.

### Example

Request: `DELETE /api/runs/run_50d62f17-f2e4-405a-ac3b-ecba61fcfb7f` (no body).

Response: HTTP 200.

```json
{
  "deleted": true,
  "id": "run_50d62f17-f2e4-405a-ac3b-ecba61fcfb7f"
}
```

## POST /api/runs/:id/teach

Allowed in `learning`. `explanation` is trimmed, nonempty, at most 8,000 characters. Optional `conceptId` focuses review, notes and new questions on one concept of the current room; another room's concept returns 400 `validation_error` without mutation. Omitting it retains whole-room teaching. The response may include `feedback` (up to 600 characters): Pip's specific reply to this explanation, displayed alongside new notes. Brief, misspelled and partial on-topic claims are teachable; Pip reflects wrong claims without silently correcting them. Unrelated chatter need not add notes. Public learning questions include optional `conceptId` so the UI places them on the right topic. Adds notebook notes and up to the configured number of open questions. Existing open questions remain. Clear correction can resolve active beliefs; explicitly stating a wrong belief activates it again.

### Example

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/teach` (`application/json`).

```json
{
  "explanation": "Seasons are just a thing that happens every year."
}
```

Response: HTTP 200.

```json
{
  "notebookMd": "# Notebook\n\n## Axial tilt and sunlight angle\n- Seasons are just a thing that happens every year\n",
  "questions": [
    {
      "id": "sq_0_0_1",
      "text": "Quick question: is it right that it is summer when Earth is closer to the Sun, and winter when it is farther away?",
      "status": "open",
      "conceptId": "c1"
    },
    {
      "id": "sq_0_0_2",
      "text": "Quick question: is it right that earth's axis tips toward the Sun in summer and tips away in winter?",
      "status": "open",
      "conceptId": "c1"
    },
    {
      "id": "sq_0_0_3",
      "text": "Quick question: is it right that for a southern city I can use its latitude as a positive number in the noon altitude rule?",
      "status": "open",
      "conceptId": "c1"
    }
  ]
}
```

### Example

Request: `POST /api/runs/run_35c3117b-2788-452b-abfb-283c71018677/teach` (`application/json`).

```json
{
  "explanation": "This topic is something we study.",
  "conceptId": "c1"
}
```

Response: HTTP 200.

```json
{
  "notebookMd": "# Notebook\n\n## Axial tilt and sunlight angle\n- This topic is something we study\n",
  "questions": [
    {
      "id": "sq_0_0_1",
      "text": "Quick question: is it right that it is summer when Earth is closer to the Sun, and winter when it is farther away?",
      "status": "open",
      "conceptId": "c1"
    },
    {
      "id": "sq_0_0_2",
      "text": "Quick question: is it right that earth's axis tips toward the Sun in summer and tips away in winter?",
      "status": "open",
      "conceptId": "c1"
    },
    {
      "id": "sq_0_0_3",
      "text": "Quick question: is it right that for a southern city I can use its latitude as a positive number in the noon altitude rule?",
      "status": "open",
      "conceptId": "c1"
    }
  ]
}
```

## POST /api/runs/:id/questions/:qid/answer

Allowed in `learning` for an open student question. `answer` is nonempty text, at most 4,000 characters. An unresolved answer activates the belief, like a skip. Answering or skipping a closed question returns 409.

### Example

Request: `POST /api/runs/run_35c3117b-2788-452b-abfb-283c71018677/questions/sq_0_0_1/answer` (`application/json`).

```json
{
  "answer": "The tilt of Earth's axis causes the seasons. Earth is actually closest to the Sun in early January, in the middle of Northern Hemisphere winter."
}
```

Response: HTTP 200.

```json
{
  "resolved": true,
  "notebookMd": "# Notebook\n\n## Axial tilt and sunlight angle\n- This topic is something we study\n- The tilt of Earth's axis causes the seasons. Earth is actually closest to the Sun in early January, in the middle of Northern Hemisphere winter.\n"
}
```

## POST /api/runs/:id/questions/:qid/skip

Allowed in `learning` for an open student question. No body. Adds its belief as an ordinary notebook note and activates the hidden misconception.

### Example

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/questions/sq_0_0_1/skip` (no body).

Response: HTTP 200.

```json
{
  "notebookMd": "# Notebook\n\n## Axial tilt and sunlight angle\n- Seasons are just a thing that happens every year\n- It is summer when Earth is closer to the Sun, and winter when it is farther away.\n"
}
```

## POST /api/runs/:id/ready

Allowed in `learning`. No body. Auto-skips open questions, draws fresh questions where available and starts a room with full hearts. Returns 425 if the room is still being prepared.

### Example

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/ready` (no body).

Response: HTTP 200 (excerpt).

```json
{
  "id": "run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4",
  "courseId": "sample-seasons",
  "phase": "room",
  "roomIndex": 0,
  "currentRoom": {
    "id": "r1",
    "title": "Axial tilt and sunlight angle",
    "concepts": [
      {
        "id": "c1",
        "title": "Axial tilt and sunlight angle",
        "summary": "Earth's tilted axis, not its distance from the Sun, causes the seasons by changing the angle of sunlight; the noon Sun altitude rule quantifies it."
      }
    ],
    "ready": true,
    "state": "current"
  },
  "learning": {
    "pendingQuestions": [
      {
        "id": "sq_0_0_1",
        "text": "Quick question: is it right that it is summer when Earth is closer to the Sun, and winter when it is farther away?",
        "status": "skipped",
        "conceptId": "c1"
      },
      {
        "id": "sq_0_0_2",
        "text": "Quick question: is it right that earth's axis tips toward the Sun in summer and tips away in winter?",
        "status": "skipped",
        "conceptId": "c1"
      },
      {
        "id": "sq_0_0_3",
        "text": "Quick question: is it right that for a southern city I can use its latitude as a positive number in the noon altitude rule?",
        "status": "skipped",
        "conceptId": "c1"
      }
    ],
    "teachCount": 1
  },
  "rules": {
    "roomQuestions": 5,
    "roomHearts": 3,
    "bossQuestions": 10,
    "maxStudentQuestions": 3,
    "helpMeTimed": true
  },
  "room": {
    "attempt": 1,
    "turn": 0,
    "totalTurns": 5,
    "hearts": 3
  }
}
```

## POST /api/runs/:id/turn

Allowed in `room`, `room_result`, `boss`, `results`. No body. Returns a discriminated `TurnResult`; all five variants are captured below. Continue calling until `room_end` or `boss_end`. The final damage turn carries `phaseAfter`; call once more for the summary. Repeating a summary is safe. A pending help event is returned again until it expires, after which `/turn` settles it as late.

### student_answer

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/turn` (no body).

Response: HTTP 200.

```json
{
  "kind": "student_answer",
  "question": {
    "id": "sample-seasons_q1",
    "prompt": "Find the noon Sun altitude in Boston (latitude 42) on the June solstice.",
    "difficulty": 2,
    "timeBudgetSec": 80,
    "type": "numeric",
    "payload": {
      "unit": "degrees"
    }
  },
  "answer": {
    "dontKnow": true
  },
  "answerText": "I don't know",
  "correct": false,
  "correctAnswer": {
    "answer": {
      "value": 71.5
    },
    "text": "71.5 degrees"
  },
  "explanation": "The declination is +23.5, so 90 - |42 - 23.5| = 90 - 18.5 = 71.5 degrees.",
  "reasoning": "My notes don't cover this question.",
  "citedNotes": [],
  "reason": "not in my notes",
  "damage": 1,
  "hearts": 2,
  "phaseAfter": "room"
}
```

### help_me

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/turn` (no body).

Response: HTTP 200.

```json
{
  "kind": "help_me",
  "eventId": "help_r0_a1_t1",
  "question": {
    "id": "sample-seasons_q17",
    "prompt": "Find the noon Sun altitude at latitude 50 on an equinox, in degrees.",
    "difficulty": 2,
    "timeBudgetSec": 80,
    "type": "numeric",
    "payload": {
      "unit": "degrees"
    }
  },
  "timeBudgetSec": 80,
  "deadline": "2026-11-15T05:19:49.672Z"
}
```

### room_end

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/turn` (no body).

Response: HTTP 200.

```json
{
  "kind": "room_end",
  "passed": false,
  "hearts": 0,
  "failedTurns": [
    {
      "question": {
        "id": "sample-seasons_q1",
        "prompt": "Find the noon Sun altitude in Boston (latitude 42) on the June solstice.",
        "difficulty": 2,
        "timeBudgetSec": 80,
        "type": "numeric",
        "payload": {
          "unit": "degrees"
        }
      },
      "reasoning": "My notes don't cover this question.",
      "citedNotes": []
    },
    {
      "question": {
        "id": "sample-seasons_q29",
        "prompt": "True or false?",
        "difficulty": 1,
        "timeBudgetSec": 40,
        "type": "true_false",
        "payload": {
          "statement": "Earth's axis tips back and forth during the year."
        }
      },
      "reasoning": "My notes say: Earth's axis tips toward the Sun in summer and tips away in winter.",
      "citedNotes": [
        "Earth's axis tips toward the Sun in summer and tips away in winter."
      ]
    },
    {
      "question": {
        "id": "sample-seasons_q4",
        "prompt": "What is the main cause of Earth's seasons?",
        "difficulty": 1,
        "timeBudgetSec": 40,
        "type": "mcq",
        "payload": {
          "options": [
            "Earth's distance from the Sun changes during the year",
            "The tilt of Earth's axis",
            "The Sun gives off more energy in summer",
            "Earth spins faster in summer"
          ]
        }
      },
      "reasoning": "My notes say: It is summer when Earth is closer to the Sun, and winter when it is farther away.",
      "citedNotes": [
        "It is summer when Earth is closer to the Sun, and winter when it is farther away."
      ]
    }
  ]
}
```

### boss_end

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/turn` (no body).

Response: HTTP 200.

```json
{
  "kind": "boss_end",
  "results": {
    "predictedGradePct": 90,
    "letter": "A-",
    "target": "B",
    "metTarget": true,
    "conceptAccuracy": [
      {
        "conceptId": "c1",
        "title": "Axial tilt and sunlight angle",
        "correct": 5,
        "total": 6,
        "accuracy": 0.8333333333333334
      },
      {
        "conceptId": "c2",
        "title": "Day length",
        "correct": 3,
        "total": 3,
        "accuracy": 1
      },
      {
        "conceptId": "c3",
        "title": "Opposite hemispheres",
        "correct": 6,
        "total": 6,
        "accuracy": 1
      }
    ],
    "helpMe": {
      "offered": 6,
      "correct": 5,
      "wrong": 1,
      "late": 0,
      "avgSolveTimeSec": 0
    },
    "costlyMisconceptions": [
      {
        "id": "distance_causes_seasons",
        "conceptId": "c1",
        "conceptTitle": "Axial tilt and sunlight angle",
        "description": "Thinks the seasons happen because Earth is closer to the Sun in summer and farther in winter.",
        "beliefStatement": "It is summer when Earth is closer to the Sun, and winter when it is farther away.",
        "correction": "The tilt of Earth's axis causes the seasons. Earth is actually closest to the Sun in early January, in the middle of Northern Hemisphere winter.",
        "origin": "skipped",
        "questionId": "sample-seasons_q5",
        "questionPrompt": "True or false?",
        "materialRef": {
          "fileId": "f1",
          "fileName": "seasons.md",
          "page": 1,
          "sectionPath": [
            "Why Earth Has Seasons",
            "Common mistakes"
          ],
          "quote": "Earth is closest to the Sun in early January, during Northern Hemisphere winter."
        }
      }
    ]
  }
}
```

## POST /api/runs/:id/help/:eventId

Allowed in `room` or `boss` for the pending event. Send `{ answer: ... }` using the question-type table below. The backend checks the deadline. A late answer costs damage. A correct answer adds a notebook note. Duplicate submissions return 409. Free-response questions never trigger help events.

### help_result

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/help/help_r0_a1_t1` (`application/json`).

```json
{
  "answer": {
    "value": 40
  }
}
```

Response: HTTP 200.

```json
{
  "kind": "help_result",
  "eventId": "help_r0_a1_t1",
  "question": {
    "id": "sample-seasons_q17",
    "prompt": "Find the noon Sun altitude at latitude 50 on an equinox, in degrees.",
    "difficulty": 2,
    "timeBudgetSec": 80,
    "type": "numeric",
    "payload": {
      "unit": "degrees"
    }
  },
  "correct": true,
  "late": false,
  "correctAnswer": {
    "answer": {
      "value": 40
    },
    "text": "40 degrees"
  },
  "explanation": "On an equinox the declination is 0, so 90 - |50 - 0| = 40 degrees.",
  "solveTimeSec": 0,
  "noteAdded": "Teacher showed me: 40 degrees",
  "damage": 0,
  "hearts": 2,
  "phaseAfter": "room"
}
```

## POST /api/runs/:id/retry

Allowed after a failed `room_result`. No body. Returns to `learning` for the same room; keeps the notebook and seen-question history. Hearts reset when `/ready` starts the next attempt.

### Example

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/retry` (no body).

Response: HTTP 200 (excerpt).

```json
{
  "id": "run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4",
  "courseId": "sample-seasons",
  "phase": "learning",
  "roomIndex": 0,
  "currentRoom": {
    "id": "r1",
    "title": "Axial tilt and sunlight angle",
    "concepts": [
      {
        "id": "c1",
        "title": "Axial tilt and sunlight angle",
        "summary": "Earth's tilted axis, not its distance from the Sun, causes the seasons by changing the angle of sunlight; the noon Sun altitude rule quantifies it."
      }
    ],
    "ready": true,
    "state": "current"
  },
  "learning": {
    "pendingQuestions": [],
    "teachCount": 0
  },
  "rules": {
    "roomQuestions": 5,
    "roomHearts": 3,
    "bossQuestions": 10,
    "maxStudentQuestions": 3,
    "helpMeTimed": true
  },
  "history": [
    {
      "roomId": "r1",
      "title": "Axial tilt and sunlight angle",
      "attempt": 1,
      "passed": false,
      "hearts": 0,
      "maxHearts": 3,
      "correct": 1,
      "total": 4,
      "helped": 1,
      "teachCount": 1,
      "questionsAsked": 3,
      "questionsAnswered": 0,
      "questionsSkipped": 3,
      "missed": [
        {
          "prompt": "Find the noon Sun altitude in Boston (latitude 42) on the June solstice.",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        },
        {
          "prompt": "True or false?",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        },
        {
          "prompt": "What is the main cause of Earth's seasons?",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        }
      ]
    }
  ],
  "room": {
    "attempt": 1,
    "turn": 4,
    "totalTurns": 5,
    "hearts": 0,
    "passed": false
  }
}
```

## POST /api/runs/:id/continue

Allowed after a passed `room_result`. No body. Moves to the next room in `learning`, or starts the boss after the last room. Returns 425 if the next room is unready.

### Example

Request: `POST /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/continue` (no body).

Response: HTTP 200 (excerpt).

```json
{
  "id": "run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4",
  "courseId": "sample-seasons",
  "phase": "learning",
  "roomIndex": 1,
  "currentRoom": {
    "id": "r2",
    "title": "Day length",
    "concepts": [
      {
        "id": "c2",
        "title": "Day length",
        "summary": "Day length changes with latitude and season because of the tilt, not because Earth's spin changes; the hottest weather lags the longest day."
      }
    ],
    "ready": true,
    "state": "current"
  },
  "learning": {
    "pendingQuestions": [],
    "teachCount": 0
  },
  "rules": {
    "roomQuestions": 5,
    "roomHearts": 3,
    "bossQuestions": 10,
    "maxStudentQuestions": 3,
    "helpMeTimed": true
  },
  "history": [
    {
      "roomId": "r1",
      "title": "Axial tilt and sunlight angle",
      "attempt": 1,
      "passed": false,
      "hearts": 0,
      "maxHearts": 3,
      "correct": 1,
      "total": 4,
      "helped": 1,
      "teachCount": 1,
      "questionsAsked": 3,
      "questionsAnswered": 0,
      "questionsSkipped": 3,
      "missed": [
        {
          "prompt": "Find the noon Sun altitude in Boston (latitude 42) on the June solstice.",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        },
        {
          "prompt": "True or false?",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        },
        {
          "prompt": "What is the main cause of Earth's seasons?",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        }
      ]
    },
    {
      "roomId": "r1",
      "title": "Axial tilt and sunlight angle",
      "attempt": 2,
      "passed": true,
      "hearts": 2,
      "maxHearts": 3,
      "correct": 4,
      "total": 5,
      "helped": 1,
      "teachCount": 1,
      "questionsAsked": 0,
      "questionsAnswered": 0,
      "questionsSkipped": 0,
      "missed": [
        {
          "prompt": "True or false?",
          "by": "student",
          "concepts": [
            {
              "id": "c1",
              "title": "Axial tilt and sunlight angle"
            }
          ]
        }
      ]
    }
  ]
}
```

## GET /api/runs/:id/results

Allowed in `results`. Returns boss health rounded to a percentage, letter grade, target outcome, boss accuracy by concept, help stats and costly misconceptions with evidence references. Mini-room damage never affects the grade.

### Example

Request: `GET /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/results` (no body).

Response: HTTP 200.

```json
{
  "predictedGradePct": 90,
  "letter": "A-",
  "target": "B",
  "metTarget": true,
  "conceptAccuracy": [
    {
      "conceptId": "c1",
      "title": "Axial tilt and sunlight angle",
      "correct": 5,
      "total": 6,
      "accuracy": 0.8333333333333334
    },
    {
      "conceptId": "c2",
      "title": "Day length",
      "correct": 3,
      "total": 3,
      "accuracy": 1
    },
    {
      "conceptId": "c3",
      "title": "Opposite hemispheres",
      "correct": 6,
      "total": 6,
      "accuracy": 1
    }
  ],
  "helpMe": {
    "offered": 6,
    "correct": 5,
    "wrong": 1,
    "late": 0,
    "avgSolveTimeSec": 0
  },
  "costlyMisconceptions": [
    {
      "id": "distance_causes_seasons",
      "conceptId": "c1",
      "conceptTitle": "Axial tilt and sunlight angle",
      "description": "Thinks the seasons happen because Earth is closer to the Sun in summer and farther in winter.",
      "beliefStatement": "It is summer when Earth is closer to the Sun, and winter when it is farther away.",
      "correction": "The tilt of Earth's axis causes the seasons. Earth is actually closest to the Sun in early January, in the middle of Northern Hemisphere winter.",
      "origin": "skipped",
      "questionId": "sample-seasons_q5",
      "questionPrompt": "True or false?",
      "materialRef": {
        "fileId": "f1",
        "fileName": "seasons.md",
        "page": 1,
        "sectionPath": [
          "Why Earth Has Seasons",
          "Common mistakes"
        ],
        "quote": "Earth is closest to the Sun in early January, during Northern Hemisphere winter."
      }
    }
  ]
}
```

## GET /api/runs/:id/debug

Development only: 404 unless `DEBUG=true`. Returns `{ run, pack, questions, stats, timeBudgets }` with hidden state and keys. The captured response is explicitly an excerpt. Never use this endpoint in the player-facing game.

### Example

Request: `GET /api/runs/run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4/debug` (no body).

Response: HTTP 200 (excerpt).

```json
{
  "run": {
    "id": "run_3d4bfa5a-aba5-4cb4-95cf-1d4c46bd02d4",
    "phase": "learning",
    "hidden": {
      "misconceptions": []
    }
  },
  "pack": {
    "id": "sample-seasons",
    "title": "Why Earth Has Seasons"
  },
  "questions": [
    {
      "id": "sample-seasons_q6",
      "courseId": "sample-seasons",
      "conceptIds": [
        "c2"
      ],
      "keyPointIds": [
        "c2_k4"
      ],
      "misconceptionIds": [],
      "prompt": "A city at latitude 40 has 15 hours of daylight on the June solstice. How many hours of night does it have on that date?",
      "solution": {
        "finalAnswer": "9 hours",
        "workedSteps": [
          {
            "text": "Recall the relevant fact from the notes.",
            "kind": "recall"
          },
          {
            "text": "Work out the number.",
            "kind": "compute"
          }
        ]
      },
      "explanation": "A full day is 24 hours, so the night is 24 - 15 = 9 hours long.",
      "difficulty": 1,
      "timeBudgetSec": 40,
      "provenance": {
        "origin": "verbatim",
        "materialItemId": "m10",
        "evidence": {
          "chunkId": "sample-seasons_f1_p1_6",
          "fileId": "f1",
          "page": 1,
          "quote": "A city at latitude 40 has 15 hours of daylight on the June solstice.",
          "sectionPath": [
            "Why Earth Has Seasons",
            "2. Day length",
            "Worked example 2.1"
          ]
        }
      },
      "verified": true,
      "type": "numeric",
      "payload": {
        "answer": 9,
        "tolerance": {
          "kind": "abs",
          "value": 0.1
        },
        "unit": "hours",
        "wrongAnswers": []
      }
    }
  ],
  "stats": [],
  "timeBudgets": {
    "sample-seasons_q6": {
      "source": "material_hint",
      "base": 15,
      "words": 25,
      "wordSec": 8.333333333333334,
      "stepSec": 26,
      "raw": 49.333333333333336,
      "difficultyFactor": 0.9,
      "timeBudgetSec": 40
    }
  }
}
```

## Errors and retries

Errors have one shape. This response was captured by calling `/turn` during `learning`:

```json
{
  "error": {
    "code": "wrong_phase",
    "message": "no fight in the learning phase"
  }
}
```

| HTTP | Codes | Meaning |
|---|---|---|
| 400 | `validation_error`, `invalid_answer` | Invalid body or answer shape |
| 404 | `not_found` | Unknown id/sample, or debug disabled |
| 409 | `wrong_phase`, `run_paused`, `help_pending`, `question_not_open`, `help_event_not_pending` | Refresh the run and use the allowed action |
| 413 | `payload_too_large` | Upload/body/page limit exceeded |
| 415 | `unsupported_file` | Unsupported upload type |
| 502 | `llm_error` | Model failure, invalid output after one retry, or timeout |
| 500 | `internal_error` | Unexpected server/storage failure |
| 425 | `room_not_ready` | Poll course readiness before retrying |

Within one server process, mutations for a run are serialized. Concurrent `/turn` calls each advance a turn; clients should disable their action button while a request is in flight. Repeated `/help` and learning answers are rejected after the first succeeds. A model failure before saving a turn leaves that turn unchanged. After a network error, refresh the run before deciding whether to retry, because the request may already have committed.

The API currently has no account/authentication layer; run ids identify runs. Debug mode is intended for local development. Per-run locking is process-local and does not coordinate multiple backend replicas.

## Mock and live behavior

No credentials are required for the cached samples. The e2e bot uses `/debug` to simulate a teacher who knows the subject; the real student prompt receives only its notebook and the public question. In the sample demonstration, one misconception remains deliberately uncorrected; if its targeted boss question becomes a help event, the bot supplies the corresponding wrong answer so it remains visible in the study guide.

Arbitrary uploads in mock mode use a limited heuristic fallback and may end in `error` when coverage cannot be met. Use the bundled samples for an offline demo. Gemini-backed generation, native PDF reading and Atlas search require their credentials and have not been exercised live in this continuation.
