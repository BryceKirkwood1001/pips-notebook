/**
 * Ingest pipeline contract (SPEC 2.9, 2.10, 3.2, 4.4). Owner: content-engineer (server/src/ingest/**).
 *
 * EXPORTS other modules import from `server/src/ingest/index.ts` (exact names):
 *   runIngest(deps: IngestDeps, input: IngestInput): Promise<IngestReport>
 *   checkCoverage(pack, questions, config): CoverageReport
 *   buildFixture(deps: IngestDeps, courseId: string, sample: string): Promise<CourseFixture>
 *   validateQuestion(question, pack): string[]        // problems found; empty = valid
 *
 * ── Pipeline (progressive: the pack is saved after every stage) ─────────────
 *   The caller has already saved `emptyCoursePack(courseId, title, now)` with stage 'parsing'.
 *
 *   parsing   parser.parse each file -> pack.files; chunker.chunk -> embed -> store.upsert
 *   outline   tasks.extractOutline -> units, concepts, key points, material items, rooms.
 *             Ids are assigned here; every QuoteRef is located in a chunk (rag `locateQuote`) and
 *             items whose quote cannot be found are dropped. Chunks get their conceptIds.
 *   style     tasks.buildStyleProfile (+ examTimeHint from the outline)
 *   concepts  per concept, in room order, INGEST_CONCURRENCY at a time, so the first room is ready first:
 *               buildMisconceptions -> convertItems ('verbatim') -> coverage gaps ->
 *               adaptQuestions ('adapted') -> generateQuestions ('generated') -> verifyQuestion ->
 *               time budgets (core/timeBudget.ts) -> repo.upsertQuestions ->
 *               add the concept id to pack.status.conceptsReady and save the pack
 *             then multi-concept questions for the boss pool.
 *   ready     every coverage invariant checked; the report says what (if anything) is still short.
 *   error     any uncaught failure: pack.status = { stage: 'error', error: message }. `runIngest`
 *             itself never rejects.
 *
 * ── Validation at ingest (drop, or regenerate once) ─────────────────────────
 *   - the evidence quote is not found in its chunk
 *   - the payload is invalid for its type (QuestionSchema fails)
 *   - a mapping points to a misconception id that does not exist
 *   - verification disagrees with the key (core/grading.ts; `judgeAgreement` for open answers):
 *     the question is stored with verified=false (kept for debugging, never served) and
 *     regenerated once.
 *
 * ── Ids ─────────────────────────────────────────────────────────────────────
 *   unit u1..  concept c1..  key point `${conceptId}_k1`..  room r1..  material item m1..
 *   misconception: unique snake_case slug   question: `${courseId}_q1`..   chunk: from the Chunker
 *   The CLI ingests a sample under the fixed course id `sample-${name}` (e.g. `sample-seasons`),
 *   so `POST /courses/seed/:sample` can load the fixture as it is and seeding stays idempotent.
 */
import type { ProvenanceOrigin, QuestionType } from '@pips-notebook/shared';
import type { Config } from '../config';
import type { Clock } from '../engine/types';
import type { IngestTasks } from '../llm/types';
import type { Chunker, Embedder, MaterialParser, Retriever, SourceFile, VectorStore } from '../rag/types';
import type { Repository } from '../repo/types';

export interface IngestDeps {
  config: Config;
  tasks: IngestTasks;
  parser: MaterialParser;
  chunker: Chunker;
  embedder: Embedder;
  store: VectorStore;
  retriever: Retriever;
  repo: Repository;
  clock: Clock;
  /** Progress and warnings. Default: no-op. */
  log?: (message: string, data?: unknown) => void;
}

export interface IngestInput {
  courseId: string;
  /** Falls back to the outline's title. */
  title?: string;
  files: SourceFile[];
}

/** Do the coverage invariants of SPEC 4.4 hold? Counts only verified questions. */
export interface CoverageReport {
  ok: boolean;
  keyPointsWithoutQuestion: string[];
  misconceptionsWithoutPath: string[];
  /** Rooms with fewer than ROOM_QUESTIONS × ROOM_POOL_FACTOR questions. */
  roomsBelowPool: { roomId: string; have: number; need: number }[];
  /** Multi-concept questions: need ceil(BOSS_QUESTIONS / 2) when the course has 2+ concepts, else 0. */
  multiConcept: { have: number; need: number };
  /** Stored but unverified questions (never served). */
  unverified: number;
  totalVerified: number;
  provenanceMix: Record<ProvenanceOrigin, number>;
  typeMix: Record<QuestionType, number>;
}

export interface IngestReport {
  courseId: string;
  ok: boolean;
  error?: string;
  coverage?: CoverageReport;
  /** Wall-clock milliseconds until the first room was ready, and until the whole pack was. */
  firstRoomReadyMs?: number;
  totalMs: number;
}
