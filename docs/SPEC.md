# Teach or Perish: backend spec

Sections 1-7 of the build brief, copied verbatim. Where the brief left a detail open, the choice we made is in [DECISIONS.md](DECISIONS.md); the contracts in `shared/src/schemas.ts` and the `server/src/**/types.ts` files are the source of truth for shapes.

---

## 1. Product summary

**Teach or Perish** is a turn-based dungeon game. An AI **student**, a non-human avatar, has to beat a **Gauntlet** of rooms, but the **player can't fight. The player can only teach.**

- The player uploads their course material. The game builds a **course pack**: an outline of units, concepts and key points, a **style profile** of how the material teaches, misconceptions, and a question bank pulled from the material wherever possible.
- The Gauntlet is **one mini room per concept** (small concepts can share a room), plus a final **boss/exam room** that mixes every concept in scope.
- Before each room comes a **learning phase**: the player explains the concept, the student writes notes in its **notebook**, and the student asks questions that probe likely misconceptions.
- In fights, the student answers questions **using only its notebook**. Good teaching wins. Gaps and misconceptions lose.
- The health left after the boss is the player's **predicted exam grade**.

---

## 2. Locked game design (implement exactly)

### 2.1 Gauntlet flow
`Upload → Course pack → Player picks scope (units/rooms) → [for each room: Learning phase → Mini room fight → pass: next room / fail: back to learning] → Boss/exam → Results`

### 2.2 The student and its notebook
- The student starts **knowing nothing**. It never sees the course material. Its only knowledge is a per-run **`notebook.md`**: markdown with one `## <Concept title>` section per concept and bullet notes in the student's voice.
- **The player can see the notebook.**
- Misconceptions show up in the notebook as **ordinary-looking notes** with no label. A careful reader can spot them.
- Misconception tracking lives in a **separate hidden state**, never sent to the client except in debug mode:
  ```json
  {"misconceptions": [{"id": "distance_causes_seasons", "conceptId": "c1", "status": "active|resolved", "origin": "stated|skipped"}]}
  ```

### 2.3 Learning phase (per room)
1. **Teach:** the player submits an explanation as free text covering the room's concept(s).
2. **Student review** (one LLM call): the student
   - adds notes derived **only** from the explanation,
   - flags misconceptions the explanation **states**, which become active right away with origin `stated`,
   - asks **up to `MAX_STUDENT_QUESTIONS` (default 3)** naive, curious questions. Each probes one misconception from the concept's hidden list, chosen as the most likely given what the explanation said or left out. The questions must never reveal that something is a misconception.
3. **For each question, the player either:**
   - **Answers:** an LLM resolution check runs, grounded in retrieved material. If the answer resolves the misconception, it's marked resolved and a corrective note is added. If not, it behaves like a skip.
   - **Skips:** the misconception becomes **active** (origin `skipped`), and its `beliefStatement` is written into the notebook as a normal note.
4. **Re-teaching** (after a failed room) runs the review again. Any active misconception for that room's concepts that the new explanation clearly corrects becomes resolved, and its belief note is replaced with the correction.
5. The player presses **Ready** to start the room. There's no energy or cost for answering. Skipping is the risk.

### 2.4 Mini room fight
- Draw `ROOM_QUESTIONS` (default 5) random questions from the room's question pool. Use a seedable RNG, don't repeat a question within an attempt, and prefer questions not seen in earlier attempts.
- The student has `ROOM_HEARTS` (default 3) hearts. A wrong answer costs 1 heart.
- **Pass** if hearts are above 0 after all questions. **Fail** at 0 hearts.
- **Option B is locked:** room hearts reset on retry, and **mini rooms never affect the grade**. Keep a flag `ROOM_DAMAGE_CARRIES_OVER=false` that's bookmarked but not implemented.
- On fail, return the **reasoning trace**: the student's reasoning and the notebook lines it cited for each wrong answer. Then the run goes back to the learning phase for the same room, with the notebook kept.

### 2.5 "Help me!" events (rooms and boss)
- Before each fight turn, with probability `HELP_ME_PROB` (default 0.25), the student asks the **player** to solve that question instead.
- Caps: `HELP_ME_MAX_PER_ROOM` (1) and `HELP_ME_MAX_PER_BOSS` (2). Never use `free_response` questions for "Help me!".
- **There is no fixed timer.** Each question has its own **`timeBudgetSec`**, computed from its difficulty (Section 2.10). Before the player starts, the client shows the budget, for example "Tough one: 90s".
  - The deadline is now + `timeBudgetSec × HELP_ME_TIME_MULTIPLIER`.
  - If `HELP_ME_TIMED=false`, there's no deadline. This is the untimed mode, also useful for accessibility.
- **Correct:** no damage, and a note `Teacher showed me: <correct answer>` is added under that concept.
- **Wrong or late:** damage, the same as a wrong student answer.
- The server checks the deadline. Store the player's actual solve time in `questionStats` for calibration.

### 2.6 Boss / exam
- `BOSS_QUESTIONS` (default 10; 6 in demo mode). Each question is worth `100 / BOSS_QUESTIONS` health. Health starts at **100**.
- **Composition**, decided at boss start and drawn from the **same question bank**, filtered to the run's scope:
  - `k = min(#active misconceptions, floor(BOSS_QUESTIONS * BOSS_TARGETED_SHARE))`, with `BOSS_TARGETED_SHARE = 0.5`.
  - For each of `k` active misconceptions, pick a question that has a **wrong-answer path mapped to that misconception**.
  - Fill the rest, preferring **multi-concept** questions (`conceptIds.length ≥ 2`), and make sure every concept in scope appears at least once where possible.
  - Shuffle.
- "Help me!" events can happen here too.
- **Final health = predicted grade %**, rounded to an integer.

### 2.7 Target grade
- Chosen when the run is created: `A, A-, B+, B, B-, C+, C, C-, D`.
- Thresholds are configurable: `A 93, A- 90, B+ 87, B 83, B- 80, C+ 77, C 73, C- 70, D 60`.
- A final grade below the target means the gauntlet is **failed**, which the results screen shows.

### 2.8 Results
Return:
- `predictedGradePct` and `letter`
- `target` and `metTarget`
- per-concept accuracy
- "Help me!" stats
- **`costlyMisconceptions`**: each active misconception whose targeted boss question was answered wrong, now revealed with its description, correction and a link to where the material covers it (page/section). This list is the player's study guide.

### 2.9 Questions: pulled from the material, in the material's style
**Priority for building the bank** (record it in `provenance.origin`):
1. **`verbatim`:** practice problems, worked examples, review questions, quiz items and "common mistake" callouts that already exist in the material, converted to a supported type with wording kept as close to the original as possible. Use the material's own solution when one exists.
2. **`adapted`:** same structure and style as a material item, with new numbers, names or context. Use this to get extra questions for retries.
3. **`generated`:** only to fill coverage gaps. Generation is conditioned on the course's **style profile** plus **few-shot exemplars taken from the material itself**, so new questions read like the course: same notation, units, code language, scenario types, depth and phrasing.

**Supported types**, all graded deterministically except where noted:

| Type | Payload | Grading | Misconception mapping |
|---|---|---|---|
| `mcq` | options (count follows the material, usually 4) | choice index | each wrong option → `misconceptionId` or null |
| `true_false` | statement | boolean | wrong value → misconception |
| `multi_select` | options, `correctIndexes` | exact set | per option |
| `numeric` | answer, tolerance (abs/rel), unit | within tolerance | `wrongAnswers[{value, tolerance, misconceptionId}]` |
| `short_text` | `acceptedAnswers`, rubric | normalized match, then LLM rubric fallback | `wrongAnswers[{pattern, misconceptionId}]` |
| `ordering` | items, `correctOrder` | exact order | optional mapped wrong orders |
| `free_response` | rubric | **LLM-graded** with retrieved evidence; use sparingly | LLM classifies into misconception ids |

The **type mix should follow the style profile**. A physics course with numeric problems gets numeric questions, and a CS course with code tracing gets `short_text`/`numeric` code-output questions.

### 2.10 Time budget (how hard a question is, in seconds)
No model can reliably guess "seconds" directly, so build the budget from **observable features of a worked solution**:

1. At ingest, **verification** solves every question independently from the material and returns `workedSteps[]`. Each step is tagged `recall | reason | compute | write`.
2. Code computes:
   ```
   raw = BASE[type] + promptAndOptionWords / 3 + Σ STEP_SECONDS[step.kind]
   timeBudgetSec = clamp(roundTo5(raw × (0.8 + 0.1 × difficulty)), HELP_ME_MIN_SEC, HELP_ME_MAX_SEC)
   ```
   - `BASE`: true_false 5, mcq 10, multi_select 15, numeric 15, short_text 15, ordering 20, free_response 60
   - `STEP_SECONDS`: recall 6, reason 12, compute 20, write 25
   - `difficulty` is 1–5, from the same verification call.
3. **Material hints override:** if the material states a time or point budget (for example "50 minutes, 25 questions" or "(10 pts)"), derive a per-question budget from it, scaled by relative difficulty.
4. **Calibration from play:** once a question has 5 or more observed "Help me!" solves, set `timeBudgetSec = clamp(roundTo5(1.5 × median observed))`.

`difficulty` and `timeBudgetSec` are public (the client shows them). The worked steps stay hidden.

### 2.11 Bookmarked (do not build, but keep flags or stubs)
- Option A (room damage carries over)
- Progression beyond knowledge (Balatro-style jokers and cosmetics), a beta feature
- PvP mode
- Multimodal embeddings for diagrams/slides (see 3.2)

---

## 3. Architecture, stack, and RAG

### 3.1 Repo layout and stack
npm workspaces: `shared`, `server`, `test-client` only.
```
/                         repo root
  teach-or-perish/        TEAMMATE'S PHASER GAME — READ-ONLY
  shared/                 Zod schemas, TS types, dependency-free API client
  server/                 Node 20 + TypeScript backend
  test-client/            our throwaway Phaser test harness (emoji sprites)
  samples/                sample course materials + cached course-pack fixtures
  docs/                   SPEC, API, STATE_MACHINE, PHASER_INTEGRATION, DECISIONS
  .claude/agents/         saved subagent briefs for reuse
```

**Stack:**
- Node 20+ and TypeScript
- **Fastify** with `@fastify/multipart` and `@fastify/cors`
- **Zod** for every schema, with `zod-to-json-schema` for LLM structured output
- **Vitest** for tests
- **Generation:** Google Gemini through the official **`@google/genai`** SDK. Use the model from env `GEMINI_MODEL`, a current fast Flash model (check the SDK docs for the right name). Use JSON structured output (`responseMimeType: application/json` plus a response schema), validate everything with Zod, retry once on a parse or validation failure, and give every call a timeout.
- **Storage:** MongoDB Atlas through the official `mongodb` driver, behind a `Repository` interface. If `MONGODB_URI` isn't set, use an in-memory repo so tests and offline work need no database.
- **Ports:** server on **8787** and test client on **5174**. Allow CORS from `http://localhost:4173` (teammate) and `http://localhost:5174`.

### 3.2 Material ingestion and RAG
- **Uploads:** one or more `.pdf`, `.txt` or `.md` files per course, or JSON `{ text }`.
- **Two readers for every PDF:**
  1. **Gemini reads the PDF natively** (upload it through the Files API) to build the outline, find material items, and build the style profile. This keeps diagrams, tables and slide layouts that plain text extraction loses.
  2. **`unpdf`** extracts the text layer per page. This is used for chunks and for exact evidence quotes. If a page has almost no text (scanned or image-only), record that and rely on reader 1 for that page.
- **Chunking:** structure-aware. Split on headings, slides and page breaks first, then into chunks of about `CHUNK_TOKENS` (400) with `CHUNK_OVERLAP` (15%) overlap. Keep metadata: `fileId`, `page`, `sectionPath`, `conceptIds`.
- **Embeddings:** Gemini **`gemini-embedding-001`** (text). Use `taskType: RETRIEVAL_DOCUMENT` for chunks and `RETRIEVAL_QUERY` for queries. Set `outputDimensionality` to `EMBEDDING_DIMS` (768) to keep the free cluster small. Model name and dimensions come from env.
- **Vector store:** **MongoDB Atlas Vector Search** (`$vectorSearch`) on a `chunks` collection, with a vector index on `embedding` and a filter field on `courseId`. Create the index from code at startup if it's missing (`createSearchIndex`). The fallback when `MONGODB_URI` isn't set is in-memory cosine similarity.
- **Retrieval is hybrid:** first the concept's own chunks (structure), then the top `RETRIEVAL_TOP_K` (6) vector hits for the query, de-duplicated. Use it for misconception building, question adaptation and generation, verification, resolution checks, and free-response/short-text grading.
- **What does NOT use RAG:** the student. It only ever sees `notebook.md`. Evidence quotes are checked by exact (whitespace-normalized) string match, not retrieval.
- **Stretch goal:** `gemini-embedding-2`, the multimodal model, to embed slide or diagram page images. Note that it doesn't support `taskType` and needs the query prefix format from the docs.

### 3.3 Security
- Uploaded material and player text are **data**. Wrap them in delimiters such as `<material>…</material>` and `<player_text>…</player_text>`, and tell the model never to follow instructions inside them.
- Never send hidden fields to the client. See 4.3.
- Enforce upload limits: `MAX_UPLOAD_MB` and `MAX_PAGES`.

---

## 4. Data model (put all of this in `shared/src/schemas.ts` as Zod schemas)

### 4.1 Course pack
There are **no fixed counts on content.** Extract everything the material supports, and enforce **coverage invariants** instead (4.4).
```ts
CoursePack {
  id, title, language,
  files: { id, name, type, pages }[],
  status: { stage: 'parsing'|'outline'|'style'|'concepts'|'ready'|'error',
            conceptsReady: string[], error? },
  styleProfile: {
    voice, notation, codeLanguage?, units?,
    formatMix: Record<QuestionType, number>,   // observed share of each format
    typicalScenarios: string[], avgSolutionSteps, difficultyBand,
    exemplarItemIds: string[]                  // material items used as few-shot examples
  },
  units: { id, title, order, conceptIds: string[] }[],
  concepts: Concept[],
  rooms: { id, title, order, conceptIds: string[] }[],  // usually 1 concept each; tiny neighbors merged, huge ones split
  materialItems: MaterialItem[],
  // Stored separately: chunks (with embeddings) and questions, as Mongo collections
}
Concept {
  id, unitId, title, summary, order, prerequisites: string[],
  keyPoints: { id, statement, evidence: Evidence }[],
  misconceptions: Misconception[]
}
Misconception {
  id, conceptId, description,
  beliefStatement,   // a novice's note, e.g. "We're closer to the Sun in summer."
  correction,        // the corrective note
  evidence: Evidence,   // a quote that supports the CORRECTION (misconceptions themselves usually aren't in the material)
  origin: 'material'|'inferred',   // 'material' = the course itself warns about it (prefer these)
  likelihood: 1|2|3
}
MaterialItem {
  id, kind: 'practice_problem'|'worked_example'|'review_question'|'quiz_item'|'definition'|'common_mistake',
  text, solution?, conceptIds: string[], evidence: Evidence
}
Evidence { chunkId, fileId, page, quote }   // quote must exist verbatim (whitespace-normalized) in the chunk

Chunk { id, courseId, fileId, page, sectionPath, conceptIds, text, embedding: number[] }

Question {
  id, courseId, conceptIds: string[], keyPointIds: string[], misconceptionIds: string[],
  type: 'mcq'|'true_false'|'multi_select'|'numeric'|'short_text'|'ordering'|'free_response',
  prompt, payload,            // discriminated union by type, per the 2.9 table
  solution: { finalAnswer, workedSteps: { text, kind: 'recall'|'reason'|'compute'|'write' }[] },
  explanation, difficulty: 1|2|3|4|5, timeBudgetSec,
  provenance: { origin: 'verbatim'|'adapted'|'generated', materialItemId?, evidence: Evidence },
  verified: boolean
}
QuestionStats { questionId, helpMeSolveTimesSec: number[], studentCorrect, studentWrong }
```

### 4.2 Run
```ts
Run {
  id, courseId, targetGrade, studentEmoji, scope: { roomIds: string[] },
  phase: 'learning'|'room'|'room_result'|'boss'|'results',
  roomIndex, notebookMd,
  hidden: { misconceptions: MisconceptionState[] },
  learning: { pendingQuestions: { id, misconceptionId, text, status: 'open'|'answered'|'skipped' }[] },
  room?: { attempt, questionIds, seenQuestionIds, turn, hearts, helpMeUsed, log: TurnResult[], passed? },
  boss?: { questionIds, targetedMap: Record<questionId, misconceptionId>, turn, health, helpMeUsed, log: TurnResult[] },
  pendingHelpMe?: { eventId, questionId, startedAt, deadline: string | null },
  results?: Results,
  rngSeed, createdAt, updatedAt
}
```

### 4.3 Public projections (what the client may see)
- **Never send** answer keys (`correctIndex`, accepted answers, numeric answer), misconception mappings, misconception lists, `solution`, `explanation` before a question is answered, or `hidden`.
- **Public question fields:** `id`, `type`, `prompt`, the public payload (option texts, ordering items, numeric unit), `difficulty`, `timeBudgetSec`.
- After a turn, the client may see whether the answer was correct, the correct answer, and the explanation for **that** question.
- Results reveal `costlyMisconceptions`.
- Write explicit `toPublicRun()` and `toPublicQuestion()` functions, and test that no hidden field ever leaks.
- `GET /api/runs/:id/debug` returns everything, **only** when `DEBUG=true`.

### 4.4 Coverage invariants (these replace the old fixed counts)
The ingest must guarantee these, generating `adapted` or `generated` questions only where the material falls short:
- Every key point has 1 or more questions.
- Every misconception has 1 or more questions with a wrong-answer path mapped to it. Learning-phase probing and boss targeting depend on this.
- Every room has at least `ROOM_QUESTIONS × ROOM_POOL_FACTOR` (default 2) questions, so retries get fresh ones.
- If the scope has 2 or more concepts, there are at least `ceil(BOSS_QUESTIONS / 2)` multi-concept questions.
- Every question has `verified: true`. Unverified questions are kept for debugging but never served.

**Limits that remain are only for gameplay length or safety, never for content:**
- **Gameplay:** `ROOM_QUESTIONS`, `ROOM_HEARTS`, `BOSS_QUESTIONS`, `MAX_STUDENT_QUESTIONS`
- **Safety and cost:** `MAX_UPLOAD_MB`, `MAX_PAGES`, `GEN_BATCH_SIZE` (items per LLM call, so JSON outputs stay reliable), `INGEST_CONCURRENCY`

---

## 5. LLM layer

Build it in **two layers**, so mocking is easy and ownership is clean:
- **`LlmClient`** is the transport: `generateJson(schema, prompt, opts)`, `embed(texts, taskType)`, and `uploadFile(path)`. There's a Gemini implementation and a thin test double.
- **Task modules**, each with a Gemini-backed implementation and a **deterministic mock**:
  - `IngestTasks` (owned by content-engineer)
  - `GameplayTasks` (owned by llm-engineer)

**IngestTasks** (all grounded in material; batch outputs by `GEN_BATCH_SIZE`):

| Task | Output |
|---|---|
| `extractOutline` (native PDF) | units → concepts → key points with evidence, plus `materialItems` with locations |
| `buildStyleProfile` | `styleProfile` built from material items and sample pages |
| `buildMisconceptions` | per concept. Prefer the material's own `common_mistake` items, then inferred ones. Evidence must support the correction. |
| `convertItems` | material items → typed `verbatim` questions, wording preserved |
| `adaptQuestions` / `generateQuestions` | fill coverage gaps, conditioned on `styleProfile` and few-shot exemplars from the material |
| `verifyQuestion` | solves the question **independently** from retrieved evidence without seeing the key. It must agree with the key, and it returns `workedSteps` (with kinds) and `difficulty`. If it disagrees, mark the question unverified and regenerate once. |

**GameplayTasks:**

| Task | Input | Output |
|---|---|---|
| `studentReview` | room concept summaries, player explanation, current notebook sections, hidden misconception list (with likelihood), active ids | `notesToAdd[]`, `statedMisconceptionIds[]`, `questions[{misconceptionId, text}]` (at most the max), `resolvedMisconceptionIds[]` |
| `checkResolution` | misconception, student question, player answer, retrieved evidence | `{ resolved, noteToAdd, why }` |
| `studentAnswer` | **notebook markdown only** and the public question | a typed answer (or "I don't know"), `reasoning`, `citedNotes[]` |
| `gradeOpen` | short_text fallback or free_response, rubric, retrieved evidence | `{ correct, misconceptionIds[], feedback }` |

**Student honesty rules** (the core of the game):
- The `studentAnswer` system prompt says the student knows **nothing** except its notebook. It must reason only from notes, cite the exact note lines it used, and answer "I don't know" if the notes don't cover the question. Use low temperature.
- **Grounding check (deterministic code):** an answer counts as **correct only if** it's correct by the type's grading **and** at least one `citedNote` fuzzy-matches a line in the notebook. A correct answer with no valid citation counts as **wrong** with the reason `"not in my notes"`.
- Notes from `studentReview` must come only from the player's explanation. Students write in a curious, slightly naive voice.

**Validation at ingest** (drop or regenerate on failure):
- the evidence quote isn't found in its chunk,
- the payload is invalid for its type (for example, an MCQ without exactly one correct option),
- a mapping points to a misconception id that doesn't exist,
- verification disagrees with the key.

**Mocks:** the ingest mock returns fixtures from `samples/cache/*.json`. The `studentAnswer` mock:
- If a notebook line equals an active misconception's `beliefStatement` and an answer path maps to it, give that wrong answer.
- Otherwise, if any note shares keywords with the correct answer, give it and cite that note.
- Otherwise answer "I don't know".

---

## 6. API contract (`/api`, JSON)

| Method and path | Purpose |
|---|---|
| `POST /courses` | Upload one or more files (multipart `files`) or `{ text, title }`. Returns `202 { courseId }` and starts async, **progressive** ingest. |
| `GET /courses/:id` | `{ title, status, units[{id, title, concepts[{id, title, ready}]}], rooms[{id, title, conceptIds, ready}], styleSummary }`. Public fields only. |
| `POST /courses/seed/:sample` | Loads a cached sample pack instantly, for the demo. Returns `{ courseId }`. |
| `POST /runs` | `{ courseId, targetGrade, studentEmoji?, scope?: { roomIds } }` → PublicRun. Defaults to all ready rooms. A run can start once its **first room** is ready, while later rooms finish ingesting. |
| `GET /runs/:id` | PublicRun |
| `POST /runs/:id/teach` | `{ explanation }` → `{ notebookMd, questions[] }` |
| `POST /runs/:id/questions/:qid/answer` | `{ answer }` → `{ resolved, notebookMd }` |
| `POST /runs/:id/questions/:qid/skip` | → `{ notebookMd }` |
| `POST /runs/:id/ready` | Starts the room fight → PublicRun (phase `room`). Returns 425 if the room isn't ingested yet. |
| `POST /runs/:id/turn` | Next turn in the room or boss → `TurnResult` |
| `POST /runs/:id/help/:eventId` | `{ answer }`, typed by question type: `choiceIndex`, `choiceIndexes`, `value`, `text` or `order` → `TurnResult` |
| `POST /runs/:id/retry` | After a failed room → back to `learning` for the same room |
| `POST /runs/:id/continue` | After a passed room → next room `learning`, or `boss` after the last room |
| `GET /runs/:id/results` | Results |
| `GET /runs/:id/debug` | Full run, course pack and questions (only when `DEBUG=true`) |

```ts
TurnResult =
 | { kind: 'student_answer', question: PublicQuestion, answer, correct, correctAnswer, explanation,
     reasoning, citedNotes, reason?: 'not in my notes'|'wrong belief'|'unknown',
     damage, hearts?: number, health?: number, phaseAfter }
 | { kind: 'help_me', eventId, question: PublicQuestion, timeBudgetSec, deadline: string | null }
 | { kind: 'help_result', correct, correctAnswer, explanation, solveTimeSec, noteAdded?, damage, hearts?, health?, phaseAfter }
 | { kind: 'room_end', passed, failedTurns: { question, reasoning, citedNotes }[] }
 | { kind: 'boss_end', results: Results }
```
- Errors return `{ error: { code, message } }` with sensible HTTP codes. Calling an action in the wrong phase returns 409.
- Targets: each fight turn should take about 3 seconds or less. The first room should be ready about 60 seconds or less after upload, with the rest following in the background.

---

## 7. Config (`server/src/config.ts`, read from env, with `.env.example`)
```
GEMINI_API_KEY=            GEMINI_MODEL=            LLM_PROVIDER=gemini|mock
EMBEDDING_MODEL=gemini-embedding-001                EMBEDDING_DIMS=768
MONGODB_URI=               ATLAS_VECTOR_INDEX=chunks_vector
DEBUG=false                PORT=8787
CHUNK_TOKENS=400           CHUNK_OVERLAP=0.15       RETRIEVAL_TOP_K=6
MAX_UPLOAD_MB=25           MAX_PAGES=300            GEN_BATCH_SIZE=5        INGEST_CONCURRENCY=4
MAX_STUDENT_QUESTIONS=3    ROOM_QUESTIONS=5         ROOM_HEARTS=3           ROOM_POOL_FACTOR=2
ROOM_DAMAGE_CARRIES_OVER=false
BOSS_QUESTIONS=10          BOSS_TARGETED_SHARE=0.5
HELP_ME_PROB=0.25          HELP_ME_MAX_PER_ROOM=1   HELP_ME_MAX_PER_BOSS=2
HELP_ME_TIMED=true         HELP_ME_TIME_MULTIPLIER=1.0  HELP_ME_MIN_SEC=20  HELP_ME_MAX_SEC=240
GRADE_THRESHOLDS=A:93,A-:90,B+:87,B:83,B-:80,C+:77,C:73,C-:70,D:60
DEMO_MODE=false   # when true: BOSS_QUESTIONS=6, ROOM_QUESTIONS=3, HELP_ME_TIME_MULTIPLIER=0.75
```

