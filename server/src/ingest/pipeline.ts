/**
 * The progressive ingest pipeline (see types.ts for the contract). Stages: parsing, outline, style,
 * concepts (one concept at a time, in room order), then multi-concept questions and the coverage fill.
 * The pack is saved after every stage and after every concept.
 */
import {
  CourseFixtureSchema,
  emptyCoursePack,
  FormatMixSchema,
  QuestionSchema,
  type Chunk,
  type Concept,
  type CourseFixture,
  type CoursePack,
  type MaterialItem,
  type Misconception,
  type ProvenanceOrigin,
  type Question,
} from '@top/shared';
import { computeTimeBudget, materialTimeHintFor } from '../core/timeBudget';
import { gradeDeterministic, mappedMisconceptionIds } from '../core/grading';
import type { CoverageGap, QuestionDraft } from '../llm/types';
import { locateQuote } from '../rag';
import type { ParsedFile, RetrievedChunk } from '../rag/types';
import { checkCoverage, gapFor, multiConceptNeed, preferredTypes, roomPoolNeed } from './coverage';
import { createLimiter } from './limiter';
import { buildOutline, tagChunks } from './outline';
import { applyLessonPlan, LessonPlanCoverageError, type LessonPlanRepair } from './lesson-plan';
import type { IngestDeps, IngestInput, IngestReport } from './types';
import { questionKey, shuffleOrdering, slugify, toPublicQuestion } from './util';
import { validateQuestion } from './validate';

/** Everything the stages share during one run. */
interface Run {
  deps: IngestDeps;
  courseId: string;
  pack: CoursePack;
  chunks: Chunk[];
  parsed: ParsedFile[];
  /** Every question stored so far, verified or not. */
  bank: Question[];
  /** Prompt keys of everything accepted so far: duplicates are dropped. */
  keys: Set<string>;
  nextQuestion: number;
  save: () => Promise<void>;
  verifyLimit: <T>(fn: () => Promise<T>) => Promise<T>;
  log: (message: string, data?: unknown) => void;
}

const MAX_ROUNDS = 3; // LLM calls per stage and gap before giving up
const LESSON_PLAN_ATTEMPTS = 2;
const clampInt = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(x)));
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

// ─────────────────────────────────────────────────────────────────────────────
// Drafts -> questions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns one draft into a Question (unverified, placeholder id and time budget) or explains why it was
 * dropped: quote not found, schema failure, unknown ids, duplicate prompt.
 */
export function draftToQuestion(
  run: Pick<Run, 'courseId' | 'pack' | 'chunks' | 'keys'>,
  draft: QuestionDraft,
  origin: ProvenanceOrigin,
  fallbackItemId?: string,
): { question?: Question; problem?: string } {
  const evidence = locateQuote(draft.evidence?.quote ?? '', run.chunks, draft.evidence);
  if (!evidence) return { problem: 'evidence quote not found in any chunk' };

  let payload = draft.payload as Record<string, unknown> | null;
  if (payload === null || typeof payload !== 'object') return { problem: 'payload is not an object' };
  payload = { ...payload };

  // free_response has no deterministic wrong-answer path: its misconception ids ride along in the payload.
  let freeResponseMisconceptions: string[] = [];
  if (draft.type === 'free_response') {
    if (Array.isArray(payload.misconceptionIds)) freeResponseMisconceptions = payload.misconceptionIds.map(String);
    delete payload.misconceptionIds;
  }

  // Ordering: store the items shuffled so the display order is not the answer.
  if (draft.type === 'ordering' && Array.isArray(payload.items) && Array.isArray(payload.correctOrder)) {
    const items = payload.items as string[];
    const correctOrder = payload.correctOrder as number[];
    const wrongOrders = (Array.isArray(payload.wrongOrders) ? payload.wrongOrders : []) as {
      order: number[];
      misconceptionId: string;
    }[];
    const okPerm = (o: unknown) =>
      Array.isArray(o) && o.length === items.length && new Set(o).size === items.length && o.every((i) => i >= 0 && i < items.length);
    if (items.length >= 2 && okPerm(correctOrder) && wrongOrders.every((w) => okPerm(w.order))) {
      payload = { ...shuffleOrdering({ items, correctOrder, wrongOrders }, draft.prompt) };
    }
  }

  const materialItemId = origin === 'generated' ? undefined : (draft.materialItemId ?? fallbackItemId);
  const raw = {
    id: 'pending',
    courseId: run.courseId,
    conceptIds: unique(draft.conceptIds),
    keyPointIds: unique(draft.keyPointIds),
    misconceptionIds: [] as string[],
    type: draft.type,
    prompt: (draft.prompt ?? '').trim(),
    payload,
    solution: { finalAnswer: draft.finalAnswer ?? '', workedSteps: [] },
    explanation: draft.explanation ?? '',
    difficulty: 3,
    timeBudgetSec: 60,
    provenance: { origin, ...(materialItemId ? { materialItemId } : {}), evidence },
    verified: false,
  };
  const parsed = QuestionSchema.safeParse(raw);
  if (!parsed.success) {
    return { problem: `schema: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` };
  }
  const question: Question = parsed.data;
  question.misconceptionIds = unique([...mappedMisconceptionIds(question), ...freeResponseMisconceptions]);

  const problems = validateQuestion(question, run.pack);
  if (problems.length > 0) return { problem: problems.join('; ') };
  if (run.keys.has(questionKey(question))) return { problem: 'duplicate prompt' };
  return { question };
}

/** Accepts the valid drafts: assigns ids, records their prompt keys, and returns them (unverified). */
function acceptDrafts(
  run: Run,
  drafts: QuestionDraft[],
  origin: ProvenanceOrigin,
  fallbackItemId?: string,
): Question[] {
  const accepted: Question[] = [];
  for (const draft of drafts) {
    const { question, problem } = draftToQuestion(run, draft, origin, fallbackItemId);
    if (!question) {
      run.log(`dropped a ${origin} draft: ${problem}`, { prompt: draft.prompt });
      continue;
    }
    question.id = `${run.courseId}_q${++run.nextQuestion}`;
    run.keys.add(questionKey(question));
    accepted.push(question);
  }
  return accepted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification, time budgets, storing
// ─────────────────────────────────────────────────────────────────────────────

const retrieveFor = async (run: Run, conceptIds: string[], query: string): Promise<RetrievedChunk[]> =>
  run.deps.retriever.retrieve({ courseId: run.courseId, query, conceptIds });

/** Solves the question without the key; agreement sets verified=true and stores the worked steps. */
async function verifyOne(run: Run, q: Question): Promise<Question> {
  try {
    const evidence = await retrieveFor(run, q.conceptIds, q.prompt);
    const out = await run.deps.tasks.verifyQuestion({ question: toPublicQuestion(q), evidence });
    if (out.quality?.acceptable === false) {
      run.log('question quality rejected; stored unverified', { id: q.id, issue: out.quality.reason });
      return { ...q, verified: false };
    }
    const grade = gradeDeterministic(q, out.answer);
    let agrees = grade.status === 'correct';
    if (grade.status === 'needs_llm') {
      const text = out.answer.text?.trim() ?? '';
      agrees = text !== '' && (await run.deps.tasks.judgeAgreement({ question: q, verifierAnswer: text })).agrees;
    }
    if (!agrees) {
      run.log('verification disagrees with the key; stored unverified', { id: q.id, prompt: q.prompt });
      return { ...q, verified: false };
    }
    return {
      ...q,
      verified: true,
      difficulty: clampInt(out.difficulty, 1, 5),
      solution: { ...q.solution, workedSteps: out.workedSteps },
    };
  } catch (err) {
    run.log(`verification failed: ${(err as Error).message}`, { id: q.id });
    return { ...q, verified: false };
  }
}

const verifyAll = (run: Run, qs: Question[]): Promise<Question[]> =>
  Promise.all(qs.map((q) => run.verifyLimit(() => verifyOne(run, q))));

/**
 * Verifies the candidates, regenerates once for the ones verification disagrees with, applies the
 * time budgets and stores everything (unverified ones too, for debugging). Returns what it stored.
 */
async function finishQuestions(run: Run, candidates: Question[], conceptIds: string[]): Promise<Question[]> {
  if (candidates.length === 0) return [];
  let done = await verifyAll(run, candidates);

  const failed = done.filter((q) => !q.verified);
  if (failed.length > 0) {
    const gap: CoverageGap = {
      conceptIds: unique(failed.flatMap((q) => q.conceptIds)),
      keyPointIds: unique(failed.flatMap((q) => q.keyPointIds)),
      misconceptionIds: unique(failed.flatMap((q) => q.misconceptionIds)),
      count: failed.length,
      multiConcept: failed.some((q) => q.conceptIds.length >= 2),
      preferredTypes: preferredTypes(run.pack),
    };
    const retry = await produce(run, 'generated', gap, conceptIds);
    done = [...done, ...(await verifyAll(run, retry))];
  }

  const stored = done.map((q) => ({
    ...q,
    timeBudgetSec: computeTimeBudget(q, run.deps.config, materialTimeHintFor(q, run.pack)).timeBudgetSec,
  }));
  run.bank.push(...stored);
  await run.deps.repo.upsertQuestions(stored);
  return stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Producing questions: adapted, then generated
// ─────────────────────────────────────────────────────────────────────────────

/** Few-shot exemplars: the style profile's choices first, then the other material items (not "common mistakes"). */
function pickExemplars(run: Run, conceptIds: string[]): MaterialItem[] {
  const preferred = new Set(run.pack.styleProfile.exemplarItemIds);
  const items = run.pack.materialItems.filter(
    (m) => m.kind !== 'common_mistake' && m.conceptIds.some((id) => conceptIds.includes(id)),
  );
  items.sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)));
  return items.slice(0, 4);
}

/** One LLM call for 'adapted' or 'generated' questions. Failures are logged, not fatal. */
async function produce(run: Run, origin: 'adapted' | 'generated', gap: CoverageGap, conceptIds: string[]): Promise<Question[]> {
  const concepts = run.pack.concepts.filter((c) => gap.conceptIds.includes(c.id));
  if (concepts.length === 0) return [];
  const exemplars = pickExemplars(run, gap.conceptIds);
  if (origin === 'adapted' && exemplars.length === 0) return [];
  try {
    const evidence = await retrieveFor(run, conceptIds, concepts.map((c) => c.title).join(' '));
    const task = origin === 'adapted' ? run.deps.tasks.adaptQuestions : run.deps.tasks.generateQuestions;
    const drafts = await task({ exemplars, gaps: [gap], concepts, styleProfile: run.pack.styleProfile, evidence });
    return acceptDrafts(run, drafts, origin, exemplars[0]?.id);
  } catch (err) {
    run.log(`${origin} questions failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Fills a gap in provenance order: adapted first, then generated for whatever is still short.
 * `gapOf` recomputes the gap from the questions so far (candidates included); batches follow genBatchSize.
 */
async function topUp(
  run: Run,
  conceptIds: string[],
  existing: Question[],
  gapOf: (all: Question[]) => CoverageGap,
): Promise<Question[]> {
  const all = [...existing];
  const added: Question[] = [];
  for (const origin of ['adapted', 'generated'] as const) {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const gap = gapOf(all);
      if (gap.count <= 0) break;
      const batch = { ...gap, count: Math.min(gap.count, run.deps.config.genBatchSize) };
      const fresh = await produce(run, origin, batch, conceptIds);
      if (fresh.length === 0) break; // no progress: move on to the next provenance
      all.push(...fresh);
      added.push(...fresh);
    }
  }
  return added;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-concept pass
// ─────────────────────────────────────────────────────────────────────────────

async function buildConceptMisconceptions(run: Run, concept: Concept): Promise<void> {
  const commonMistakes = run.pack.materialItems.filter(
    (m) => m.kind === 'common_mistake' && m.conceptIds.includes(concept.id),
  );
  const evidence = await retrieveFor(run, [concept.id], `${concept.title} ${concept.summary}`);
  const drafts = await run.deps.tasks.buildMisconceptions({ concept, commonMistakes, evidence });

  const taken = new Set(run.pack.concepts.flatMap((c) => c.misconceptions.map((m) => m.id)));
  const built: Misconception[] = [];
  for (const d of drafts) {
    const ev = locateQuote(d.evidence?.quote ?? '', run.chunks, d.evidence);
    if (!ev || !d.description?.trim() || !d.beliefStatement?.trim() || !d.correction?.trim()) {
      run.log('dropped a misconception draft (no findable quote or empty field)', { id: d.id });
      continue;
    }
    let id = slugify(d.id);
    for (let n = 2; taken.has(id); n++) id = `${slugify(d.id)}_${n}`;
    taken.add(id);
    built.push({
      id,
      conceptId: concept.id,
      description: d.description.trim(),
      beliefStatement: d.beliefStatement.trim(),
      correction: d.correction.trim(),
      evidence: ev,
      origin: d.origin === 'material' ? 'material' : 'inferred',
      likelihood: clampInt(d.likelihood, 1, 3),
    });
  }
  concept.misconceptions = built;
}

/** Converts material items into 'verbatim' questions, GEN_BATCH_SIZE items per call. */
async function convertItems(run: Run, items: MaterialItem[]): Promise<Question[]> {
  const out: Question[] = [];
  const size = run.deps.config.genBatchSize;
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const ids = unique(batch.flatMap((m) => m.conceptIds));
    const concepts = run.pack.concepts.filter((c) => ids.includes(c.id));
    const drafts = await run.deps.tasks.convertItems({ items: batch, concepts, styleProfile: run.pack.styleProfile });
    out.push(...acceptDrafts(run, drafts, 'verbatim'));
  }
  return out;
}

async function processConcept(run: Run, conceptId: string): Promise<void> {
  const concept = run.pack.concepts.find((c) => c.id === conceptId) as Concept;
  const room = run.pack.rooms.find((r) => r.conceptIds.includes(conceptId)) as { conceptIds: string[] };
  run.log(`concept ${conceptId} "${concept.title}": start`);

  await buildConceptMisconceptions(run, concept);
  const newChunks = tagChunks(run.pack, run.chunks);
  if (newChunks.length > 0) await run.deps.store.upsert(newChunks);

  // 1. Verbatim: the material's own items. Items that span several concepts wait for the boss pass.
  const items = run.pack.materialItems.filter((m) => m.conceptIds.length === 1 && m.conceptIds[0] === conceptId);
  const verbatim = await convertItems(run, items);

  // 2. Adapted, then 3. generated, for what is still missing. Each concept supplies its share of the room pool.
  const share = Math.ceil(roomPoolNeed(run.deps.config) / room.conceptIds.length);
  const candidates = [...verbatim];
  candidates.push(...(await topUp(run, [conceptId], verbatim, (all) => gapFor(run.pack, [conceptId], all, share))));

  await finishQuestions(run, candidates, [conceptId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Boss pass: multi-concept questions and the coverage fill
// ─────────────────────────────────────────────────────────────────────────────

/** Windows of up to 3 neighbouring concepts, for multi-concept questions. */
function conceptWindows(pack: CoursePack): string[][] {
  const ids = pack.concepts.map((c) => c.id);
  if (ids.length <= 3) return [ids];
  const windows: string[][] = [];
  for (let i = 0; i < ids.length; i++) windows.push([ids[i], ids[(i + 1) % ids.length], ids[(i + 2) % ids.length]]);
  return windows;
}

const verified = (run: Run): Question[] => run.bank.filter((q) => q.verified);

async function bossPass(run: Run): Promise<void> {
  const { pack, deps } = run;

  // Material items that span several concepts, converted verbatim.
  const multiItems = pack.materialItems.filter((m) => m.conceptIds.length >= 2);
  if (multiItems.length > 0) {
    const converted = await convertItems(run, multiItems);
    await finishQuestions(run, converted, pack.concepts.map((c) => c.id));
  }

  // Coverage fill: up to 2 rounds of topping up whatever checkCoverage says is short.
  for (let round = 0; round < 2; round++) {
    const cov = checkCoverage(pack, run.bank, deps.config);
    if (cov.ok) return;
    run.log(`coverage round ${round + 1}`, cov);

    const fills: { conceptIds: string[]; gapOf: (all: Question[]) => CoverageGap }[] = [];
    const need = roomPoolNeed(deps.config);
    for (const r of cov.roomsBelowPool) {
      const room = pack.rooms.find((x) => x.id === r.roomId);
      if (room) fills.push({ conceptIds: room.conceptIds, gapOf: (all) => gapFor(pack, room.conceptIds, all, need) });
    }
    const shortConcepts = pack.concepts.filter(
      (c) =>
        c.keyPoints.some((k) => cov.keyPointsWithoutQuestion.includes(k.id)) ||
        c.misconceptions.some((m) => cov.misconceptionsWithoutPath.includes(m.id)),
    );
    for (const c of shortConcepts) fills.push({ conceptIds: [c.id], gapOf: (all) => gapFor(pack, [c.id], all, 0) });
    if (cov.multiConcept.have < cov.multiConcept.need) {
      for (const w of conceptWindows(pack)) {
        fills.push({
          conceptIds: w,
          gapOf: (all) => ({
            conceptIds: w,
            keyPointIds: [],
            misconceptionIds: [],
            count: Math.max(0, multiConceptNeed(pack, deps.config) - all.filter((q) => q.conceptIds.length >= 2).length),
            multiConcept: true,
            preferredTypes: preferredTypes(pack),
          }),
        });
      }
    }

    for (const fill of fills) {
      const added = await topUp(run, fill.conceptIds, verified(run), fill.gapOf);
      await finishQuestions(run, added, fill.conceptIds);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runIngest
// ─────────────────────────────────────────────────────────────────────────────

export async function runIngest(deps: IngestDeps, input: IngestInput): Promise<IngestReport> {
  const { courseId } = input;
  const log = deps.log ?? (() => {});
  const startedAt = deps.clock.now().getTime();
  const elapsed = () => deps.clock.now().getTime() - startedAt;
  let pack: CoursePack | undefined;
  let firstRoomReadyMs: number | undefined;

  try {
    const existing = await deps.repo.getCoursePack(courseId);
    pack = existing ?? emptyCoursePack(courseId, input.title ?? 'Untitled course', deps.clock.now().toISOString());
    pack.status = { stage: 'parsing', conceptsReady: [] };
    pack.embeddingProfile = { provider: deps.config.llmProvider, model: deps.config.embeddingModel, dims: deps.config.embeddingDims };
    if (input.title) pack.title = input.title;
    const current = pack;

    // Saves are chained so snapshots reach the repository in order.
    let saving: Promise<void> = Promise.resolve();
    const save = (): Promise<void> => {
      current.updatedAt = deps.clock.now().toISOString();
      const snapshot = structuredClone(current);
      saving = saving.then(() => deps.repo.saveCoursePack(snapshot));
      return saving;
    };
    const activity = async (update: NonNullable<CoursePack['status']['activity']>) => {
      const summary = update.summary ?? current.status.activity?.summary;
      current.status.activity = { ...update, message: update.message.slice(0, 240), ...(summary ? { summary: summary.slice(-1200) } : {}) };
      await save();
    };

    const run: Run = {
      deps,
      courseId,
      pack: current,
      chunks: [],
      parsed: [],
      bank: [],
      keys: new Set(),
      nextQuestion: 0,
      save,
      verifyLimit: createLimiter(Math.max(2, deps.config.ingestConcurrency * 2)),
      log,
    };
    await deps.repo.deleteQuestions(courseId); // a re-ingest starts from an empty bank
    await save();

    // ── parsing ──
    current.files = [];
    for (const file of input.files) {
      await activity({ message: `Reading ${file.name}…` });
      const parsed = await deps.parser.parse(file);
      run.parsed.push(parsed);
      current.files.push({ id: file.id, name: file.name, type: file.type, pages: parsed.pages.length });
      const drafts = deps.chunker.chunk(courseId, parsed);
      await activity({ message: `Indexing ${parsed.pages.length} pages so evidence can be found later.` });
      const vectors = await deps.embedder.embedDocuments(drafts.map((d) => d.text));
      run.chunks.push(...drafts.map((d, i) => ({ ...d, embedding: vectors[i] })));
    }
    if (run.chunks.length === 0) throw new Error('The material has no readable text.');
    await deps.store.upsert(run.chunks);
    await save();

    // ── outline ──
    current.status.stage = 'outline';
    await activity({ message: 'Finding the main ideas and supporting passages in your material.' });
    const draft = await deps.tasks.extractOutline({ files: run.parsed, titleHint: input.title, onProgress: activity });
    let outline = buildOutline(draft, run.chunks);
    for (const d of outline.dropped) log(`outline: dropped ${d}`);
    if (outline.concepts.length === 0) throw new Error('The outline has no concept with a findable quote.');
    if (deps.tasks.planLessons) {
      await activity({ message: 'Combining overlapping topics into complete lessons and writing teaching goals.' });
      let repair: LessonPlanRepair | undefined;
      for (let attempt = 0; attempt < LESSON_PLAN_ATTEMPTS; attempt++) {
        const plan = await deps.tasks.planLessons({title: input.title || draft.title, concepts: outline.concepts, ...(repair ? {repair} : {})});
        try {
          outline = applyLessonPlan(outline, plan);
          break;
        } catch (error) {
          if (!(error instanceof LessonPlanCoverageError)) throw error;
          if (attempt === LESSON_PLAN_ATTEMPTS-1) throw new Error('Could not create a complete lesson plan after checking every topic twice. Retry preparation. ' + error.message);
          repair = error.repair;
          log('lesson plan coverage invalid; requesting correction', {missingIds:repair.missingIds,duplicateIds:repair.duplicateIds,unknownIds:repair.unknownIds});
          await activity({ message: 'Repairing the lesson plan so every uploaded topic is included exactly once.' });
        }
      }
    }
    if (!input.title) current.title = draft.title || current.title;
    current.language = draft.language || 'en';
    current.units = outline.units;
    current.concepts = outline.concepts;
    current.rooms = outline.rooms;
    current.materialItems = outline.materialItems;
    const tagged = tagChunks(current, run.chunks);
    if (tagged.length > 0) await deps.store.upsert(tagged);
    await save();

    // ── style ──
    current.status.stage = 'style';
    await activity({ message: 'Matching the notation and question style used in your material.' });
    const samplePages = run.parsed
      .flatMap((f) => f.pages.map((p) => ({ fileId: f.fileId, page: p.page, text: p.text.slice(0, 2500) })))
      .filter((p) => p.text.trim() !== '')
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, 3);
    const style = await deps.tasks.buildStyleProfile({ materialItems: current.materialItems, samplePages });
    const itemIds = new Set(current.materialItems.map((m) => m.id));
    current.styleProfile = {
      ...style,
      formatMix: FormatMixSchema.parse(style.formatMix),
      exemplarItemIds: style.exemplarItemIds.filter((id) => itemIds.has(id)),
      ...(draft.examTimeHint ? { examTimeHint: draft.examTimeHint } : {}),
    };
    await save();

    // ── concepts, in room order, a few at a time ──
    current.status.stage = 'concepts';
    await activity({ message: 'Preparing lessons and checking their questions.', completed: 0, total: current.concepts.length });
    const order = current.rooms.flatMap((r) => r.conceptIds);
    const limit = createLimiter(deps.config.ingestConcurrency);
    const firstRoom = current.rooms[0];
    let prepared = 0;
    const results = await Promise.allSettled(
      order.map((conceptId) =>
        limit(async () => {
          await processConcept(run, conceptId);
          const room = current.rooms.find((r) => r.conceptIds.includes(conceptId))!;
          const share = Math.ceil(roomPoolNeed(deps.config) / room.conceptIds.length);
          if (gapFor(current, [conceptId], verified(run), share).count === 0) {
            current.status.conceptsReady.push(conceptId);
          }
          if (firstRoomReadyMs === undefined && firstRoom.conceptIds.every((id) => current.status.conceptsReady.includes(id))) {
            firstRoomReadyMs = elapsed();
          }
          prepared++;
          await activity({ message: `Prepared ${prepared} of ${order.length} lessons.`, completed: prepared, total: order.length });
          log(`concept ${conceptId} ready`);
        }),
      ),
    );
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) throw failure.reason;

    // ── boss pool and coverage fill ──
    await activity({ message: 'Checking the final exam and coverage of the course material.' });
    await bossPass(run);

    // ── ready ──
    const coverage = checkCoverage(current, run.bank, deps.config);
    if (!coverage.ok) {
      const error = 'Could not build enough verified questions to satisfy course coverage.';
      current.status = { ...current.status, stage: 'error', error };
      await activity({ message: 'Preparation stopped before enough questions could be verified.' });
      return { courseId, ok: false, error, coverage, firstRoomReadyMs, totalMs: elapsed() };
    }
    current.status.conceptsReady = current.concepts.map((c) => c.id);
    current.status.stage = 'ready';
    await activity({ message: 'Your course is ready. Choose the rooms you want to play.' });
    log('ingest finished', coverage);
    return { courseId, ok: coverage.ok, coverage, firstRoomReadyMs, totalMs: elapsed() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ingest failed: ${message}`);
    try {
      const failed =
        pack ?? emptyCoursePack(courseId, input.title ?? 'Untitled course', deps.clock.now().toISOString());
      failed.status = { ...failed.status, stage: 'error', error: message, activity: { message: 'Preparation stopped. You can retry this upload.', ...(failed.status.activity?.summary ? { summary: failed.status.activity.summary } : {}) } };
      failed.updatedAt = deps.clock.now().toISOString();
      await deps.repo.saveCoursePack(structuredClone(failed));
    } catch (saveErr) {
      log(`could not save the error status: ${(saveErr as Error).message}`);
    }
    return { courseId, ok: false, error: message, firstRoomReadyMs, totalMs: elapsed() };
  }
}

/** Snapshot of an ingested course for `samples/cache/<sample>.json`. */
export async function buildFixture(deps: IngestDeps, courseId: string, sample: string): Promise<CourseFixture> {
  const pack = await deps.repo.getCoursePack(courseId);
  if (!pack) throw new Error(`buildFixture: no course "${courseId}"`);
  const questions = await deps.repo.listQuestions(courseId);
  const chunks = await deps.store.listByCourse(courseId);
  return CourseFixtureSchema.parse({ version: 1, sample, embedderId: deps.embedder.id, pack, questions, chunks });
}
