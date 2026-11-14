/** Gemini-backed ingest tasks: one LLM call per task, flat output schemas, converted to drafts in code. */
import { z } from 'zod';
import {
  ExamTimeHintSchema,
  FreeResponsePayloadSchema,
  MATERIAL_ITEM_KINDS,
  McqPayloadSchema,
  MultiSelectPayloadSchema,
  NumericPayloadSchema,
  OrderingPayloadSchema,
  QUESTION_TYPES,
  ShortTextPayloadSchema,
  TrueFalsePayloadSchema,
  WORKED_STEP_KINDS,
  type Answer,
  type Concept,
  type MaterialItem,
  type ProvenanceOrigin,
  type QuestionType,
  type StyleProfile,
} from '@pips-notebook/shared';
import type { Config } from '../../config';
import { answerFitsQuestion } from '../../core/grading';
import {
  ADAPT_QUESTIONS_SYSTEM,
  BUILD_MISCONCEPTIONS_SYSTEM,
  BUILD_STYLE_PROFILE_SYSTEM,
  CONVERT_ITEMS_SYSTEM,
  EXTRACT_OUTLINE_SYSTEM,
  GENERATE_QUESTIONS_SYSTEM,
  JUDGE_AGREEMENT_SYSTEM,
  VERIFY_QUESTION_SYSTEM,
  buildAdaptQuestionsPrompt,
  buildConvertItemsPrompt,
  buildExtractOutlinePrompt,
  buildGenerateQuestionsPrompt,
  buildJudgeAgreementPrompt,
  buildMisconceptionsPrompt,
  buildStyleProfilePrompt,
  buildVerifyQuestionPrompt,
} from '../../prompts/ingest';
import type { IngestTasks, LlmClient, MisconceptionDraft, OutlineDraft, QuestionDraft, QuoteRef } from '../types';
import { outlineBatches } from './outline-batches';
import { lessonPlanSchemaFor, lessonPlanPrompt, PLAN_LESSONS_SYSTEM } from '../../ingest/lesson-plan';

// ── small helpers ───────────────────────────────────────────────────────────

const str = z.string().nullish();
const num = z.number().nullish();
const clean = (s: string | null | undefined): string => (s ?? '').trim();

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'misconception';
}

/** A quote with fileId and page, tolerant of missing or unknown values. */
function toQuote(quote: string | null | undefined, fileId: string | null | undefined, page: number | null | undefined, fileIds: string[]): QuoteRef {
  const id = fileId && fileIds.includes(fileId) ? fileId : fileIds.length === 1 ? fileIds[0] : undefined;
  return {
    quote: clean(quote),
    ...(id ? { fileId: id } : {}),
    ...(typeof page === 'number' && Number.isInteger(page) && page >= 1 ? { page } : {}),
  };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic shuffle seeded by `seed`. The result is never the identity permutation.
 * Returns `perm` where displayed item i is `itemsInOrder[perm[i]]`.
 */
export function shufflePermutation(n: number, seed: string): number[] {
  let state = fnv1a(seed) || 1;
  const rand = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  if (perm.every((v, i) => v === i)) perm.push(perm.shift() as number); // rotate: never the identity for n >= 2
  return perm;
}

// ── extractOutline ──────────────────────────────────────────────────────────

const OutlineSchema = z.object({
  title: z.string(),
  language: z.string().nullish(),
  units: z.array(
    z.object({
      title: z.string(),
      concepts: z.array(
        z.object({
          title: z.string(),
          summary: z.string(),
          prerequisites: z.array(z.string()).nullish(),
          keyPoints: z.array(z.object({ statement: z.string(), quote: str, fileId: str, page: num })),
        }),
      ),
    }),
  ),
  materialItems: z.array(
    z.object({
      kind: z.string(),
      text: z.string(),
      solution: str,
      conceptTitles: z.array(z.string()).nullish(),
      points: num,
      quote: str,
      fileId: str,
      page: num,
    }),
  ),
  examTimeHint: z.object({ totalMinutes: num, questionCount: num, totalPoints: num }).nullish(),
});

type FlatOutline = z.infer<typeof OutlineSchema>;
function mergeOutlines(parts: FlatOutline[]): FlatOutline {
  const merged: FlatOutline = { title: parts[0]?.title ?? 'Untitled course', language: parts[0]?.language, units: [], materialItems: [], examTimeHint: parts.find(p => p.examTimeHint)?.examTimeHint };
  const normalize = (text: string) => text.trim().toLocaleLowerCase();
  const units = new Map<string, FlatOutline['units'][number]>();
  const concepts = new Map<string, FlatOutline['units'][number]['concepts'][number]>();
  const items = new Set<string>();
  for (const part of parts) {
    for (const u of part.units) {
      let unit = units.get(normalize(u.title));
      if (!unit) { unit = { title: u.title, concepts: [] }; units.set(normalize(u.title), unit); merged.units.push(unit); }
      for (const c of u.concepts) {
        const key = normalize(c.title);
        const old = concepts.get(key);
        if (!old) { const copy = structuredClone(c); concepts.set(key, copy); unit.concepts.push(copy); }
        else {
          old.prerequisites = [...new Set([...(old.prerequisites ?? []), ...(c.prerequisites ?? [])])];
          const known = new Set(old.keyPoints.map(k => JSON.stringify([k.statement, k.fileId, k.page, k.quote])));
          for (const k of c.keyPoints) { const id = JSON.stringify([k.statement, k.fileId, k.page, k.quote]); if (!known.has(id)) { old.keyPoints.push(k); known.add(id); } }
        }
      }
    }
    for (const item of part.materialItems) {
      const key = JSON.stringify([item.kind, item.text, item.fileId, item.page, item.quote]);
      if (!items.has(key)) { merged.materialItems.push(structuredClone(item)); items.add(key); }
    }
  }
  for (const c of concepts.values()) c.prerequisites = [...new Set((c.prerequisites ?? []).map(title => concepts.get(normalize(title))?.title ?? title))].filter(title => title !== c.title);
  for (const item of merged.materialItems) item.conceptTitles = [...new Set((item.conceptTitles ?? []).map(title => concepts.get(normalize(title))?.title ?? title))];
  merged.units = merged.units.filter(u => u.concepts.length);
  return merged;
}

function toOutline(out: z.infer<typeof OutlineSchema>, fileIds: string[]): OutlineDraft {
  const titles = new Set(out.units.flatMap((u) => u.concepts.map((c) => c.title)));
  const hint = out.examTimeHint
    ? ExamTimeHintSchema.safeParse({
        totalMinutes: out.examTimeHint.totalMinutes ?? undefined,
        questionCount: out.examTimeHint.questionCount ?? undefined,
        totalPoints: out.examTimeHint.totalPoints ?? undefined,
      })
    : null;
  return {
    title: clean(out.title) || 'Untitled course',
    language: clean(out.language) || 'en',
    units: out.units.map((u) => ({
      title: u.title,
      concepts: u.concepts.map((c) => ({
        title: c.title,
        summary: c.summary,
        prerequisites: (c.prerequisites ?? []).filter((p) => titles.has(p) && p !== c.title),
        keyPoints: c.keyPoints.map((k) => ({ statement: k.statement, evidence: toQuote(k.quote, k.fileId, k.page, fileIds) })),
      })),
    })),
    materialItems: out.materialItems
      .filter((it) => (MATERIAL_ITEM_KINDS as readonly string[]).includes(it.kind) && clean(it.text))
      .map((it) => ({
        kind: it.kind as MaterialItem['kind'],
        text: it.text,
        ...(clean(it.solution) ? { solution: clean(it.solution) } : {}),
        conceptTitles: (it.conceptTitles ?? []).filter((t) => titles.has(t)),
        ...(typeof it.points === 'number' && it.points > 0 ? { points: it.points } : {}),
        evidence: toQuote(it.quote ?? it.text.split(/(?<=[.!?])\s/)[0], it.fileId, it.page, fileIds),
      })),
    ...(hint?.success ? { examTimeHint: hint.data } : {}),
  };
}

// ── style profile ───────────────────────────────────────────────────────────

const StyleSchema = z.object({
  voice: z.string(),
  notation: z.string(),
  codeLanguage: str,
  units: str,
  formatMix: z.object(Object.fromEntries(QUESTION_TYPES.map((t) => [t, num])) as Record<QuestionType, typeof num>),
  typicalScenarios: z.array(z.string()),
  avgSolutionSteps: z.number(),
  difficultyMin: z.number(),
  difficultyMax: z.number(),
  exemplarItemIds: z.array(z.string()),
});

function toStyle(out: z.infer<typeof StyleSchema>, items: MaterialItem[]): Omit<StyleProfile, 'examTimeHint'> {
  const raw = Object.fromEntries(QUESTION_TYPES.map((t) => [t, Math.max(0, out.formatMix[t] ?? 0)])) as Record<QuestionType, number>;
  const sum = QUESTION_TYPES.reduce((s, t) => s + raw[t], 0);
  const mix = sum > 0 ? raw : { ...raw, mcq: 0.4, true_false: 0.2, numeric: 0.2, short_text: 0.2 };
  const total = QUESTION_TYPES.reduce((s, t) => s + mix[t], 0);
  const formatMix = Object.fromEntries(QUESTION_TYPES.map((t) => [t, mix[t] / total])) as StyleProfile['formatMix'];

  const clamp = (n: number): number => Math.min(5, Math.max(1, Math.round(n)));
  const a = clamp(out.difficultyMin);
  const b = clamp(out.difficultyMax);

  const known = new Set(items.map((i) => i.id));
  const exemplars = [...new Set(out.exemplarItemIds.filter((id) => known.has(id)))];
  // Top up to 3 exemplars from the material's own exercises.
  const exercises = items.filter((i) => i.kind !== 'definition' && i.kind !== 'common_mistake');
  for (const it of exercises) {
    if (exemplars.length >= Math.min(3, exercises.length)) break;
    if (!exemplars.includes(it.id)) exemplars.push(it.id);
  }
  return {
    voice: out.voice,
    notation: out.notation,
    ...(clean(out.codeLanguage) ? { codeLanguage: clean(out.codeLanguage) } : {}),
    ...(clean(out.units) ? { units: clean(out.units) } : {}),
    formatMix,
    typicalScenarios: out.typicalScenarios,
    avgSolutionSteps: Math.max(0, out.avgSolutionSteps),
    difficultyBand: { min: Math.min(a, b) as 1, max: Math.max(a, b) as 5 },
    exemplarItemIds: exemplars,
  };
}

// ── misconceptions ──────────────────────────────────────────────────────────

const MisconceptionsSchema = z.object({
  misconceptions: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      beliefStatement: z.string(),
      correction: z.string(),
      quote: str,
      fileId: str,
      page: num,
      origin: z.string(),
      likelihood: z.number(),
    }),
  ),
});

// ── flat questions ──────────────────────────────────────────────────────────

const FlatQuestionSchema = z.object({
  type: z.string(),
  prompt: z.string(),
  itemId: str,
  conceptIds: z.array(z.string()).nullish(),
  keyPointIds: z.array(z.string()).nullish(),
  finalAnswer: str,
  explanation: str,
  evidenceQuote: str,
  evidenceFileId: str,
  evidencePage: num,
  options: z.array(z.object({ text: z.string(), isCorrect: z.boolean().nullish(), misconceptionId: str })).nullish(),
  statement: str,
  correctValue: z.boolean().nullish(),
  wrongMisconceptionId: str,
  answer: num,
  toleranceKind: str,
  toleranceValue: num,
  unit: str,
  wrongAnswers: z.array(z.object({ value: num, pattern: str, misconceptionId: str })).nullish(),
  acceptedAnswers: z.array(z.string()).nullish(),
  rubric: str,
  modelAnswer: str,
  itemsInCorrectOrder: z.array(z.string()).nullish(),
  wrongOrders: z.array(z.object({ itemsInOrder: z.array(z.string()), misconceptionId: str })).nullish(),
});
type FlatQuestion = z.infer<typeof FlatQuestionSchema>;
const QuestionsSchema = z.object({ questions: z.array(FlatQuestionSchema) });

interface QuestionContext {
  concepts: Concept[];
  /** For verbatim/adapted: the items the question may come from. */
  items: MaterialItem[];
  origin: ProvenanceOrigin;
  fileIds: string[];
}

/** Builds the exact stored payload for the flat question, or null when it is unusable. */
export function buildPayload(q: FlatQuestion, miscIds: Set<string>): unknown | null {
  const misc = (id: string | null | undefined): string | null => (id && miscIds.has(id) ? id : null);
  switch (q.type) {
    case 'mcq':
    case 'multi_select': {
      const opts = q.options ?? [];
      const options = opts.map((o) => ({ text: clean(o.text), misconceptionId: o.isCorrect ? null : misc(o.misconceptionId) }));
      const correct = opts.flatMap((o, i) => (o.isCorrect ? [i] : []));
      const parsed =
        q.type === 'mcq'
          ? correct.length === 1 && McqPayloadSchema.safeParse({ options, correctIndex: correct[0] })
          : MultiSelectPayloadSchema.safeParse({ options, correctIndexes: correct });
      return parsed && parsed.success ? parsed.data : null;
    }
    case 'true_false': {
      if (typeof q.correctValue !== 'boolean') return null;
      const r = TrueFalsePayloadSchema.safeParse({
        statement: clean(q.statement) || q.prompt,
        correctValue: q.correctValue,
        wrongMisconceptionId: misc(q.wrongMisconceptionId),
      });
      return r.success ? r.data : null;
    }
    case 'numeric': {
      if (typeof q.answer !== 'number') return null;
      const r = NumericPayloadSchema.safeParse({
        answer: q.answer,
        tolerance: { kind: q.toleranceKind === 'rel' ? 'rel' : 'abs', value: Math.max(0, q.toleranceValue ?? 0.01) },
        unit: clean(q.unit) || null,
        wrongAnswers: (q.wrongAnswers ?? []).flatMap((w) =>
          typeof w.value === 'number' && misc(w.misconceptionId)
            ? [{ value: w.value, tolerance: Math.max(0.005, Math.abs(w.value) * 0.005), misconceptionId: misc(w.misconceptionId) }]
            : [],
        ),
      });
      return r.success ? r.data : null;
    }
    case 'short_text': {
      const r = ShortTextPayloadSchema.safeParse({
        acceptedAnswers: (q.acceptedAnswers ?? []).map(clean).filter(Boolean),
        rubric: clean(q.rubric) || `Express the required idea: ${clean(q.finalAnswer)}. Accept semantically equivalent wording.`,
        wrongAnswers: (q.wrongAnswers ?? []).flatMap((w) =>
          clean(w.pattern) && misc(w.misconceptionId) ? [{ pattern: clean(w.pattern), misconceptionId: misc(w.misconceptionId) }] : [],
        ),
      });
      return r.success ? r.data : null;
    }
    case 'ordering': {
      const correct = (q.itemsInCorrectOrder ?? []).map(clean);
      if (correct.length < 2 || new Set(correct).size !== correct.length) return null;
      // items[i] = correct[perm[i]]; correctOrder lists display indexes in the correct sequence.
      const perm = shufflePermutation(correct.length, `${q.prompt}|${correct.join('|')}`);
      const items = perm.map((p) => correct[p]);
      const correctOrder = correct.map((c) => items.indexOf(c));
      const wrongOrders = (q.wrongOrders ?? []).flatMap((w) => {
        const order = w.itemsInOrder.map((t) => items.indexOf(clean(t)));
        return misc(w.misconceptionId) && order.length === items.length && !order.includes(-1) ? [{ order, misconceptionId: misc(w.misconceptionId) }] : [];
      });
      const r = OrderingPayloadSchema.safeParse({ items, correctOrder, wrongOrders });
      return r.success ? r.data : null;
    }
    case 'free_response': {
      const r = FreeResponsePayloadSchema.safeParse({
        rubric: clean(q.rubric),
        ...(clean(q.modelAnswer) ? { modelAnswer: clean(q.modelAnswer) } : {}),
      });
      return r.success ? r.data : null;
    }
    default:
      return null;
  }
}

/** Flat model questions -> drafts. Unknown ids are dropped; unusable questions are dropped. */
export function toQuestionDrafts(flat: FlatQuestion[], ctx: QuestionContext): QuestionDraft[] {
  const conceptIds = new Set(ctx.concepts.map((c) => c.id));
  const keyPointIds = new Set(ctx.concepts.flatMap((c) => c.keyPoints.map((k) => k.id)));
  const miscIds = new Set(ctx.concepts.flatMap((c) => c.misconceptions.map((m) => m.id)));
  const itemsById = new Map(ctx.items.map((i) => [i.id, i]));
  const drafts: QuestionDraft[] = [];

  for (const q of flat) {
    if (!(QUESTION_TYPES as readonly string[]).includes(q.type) || !clean(q.prompt)) continue;
    const item = q.itemId ? itemsById.get(q.itemId) : undefined;
    if (ctx.origin === 'verbatim' && !item) continue;

    let cIds = [...new Set((q.conceptIds ?? []).filter((id) => conceptIds.has(id)))];
    if (cIds.length === 0 && item) cIds = item.conceptIds.filter((id) => conceptIds.has(id));
    if (cIds.length === 0) continue;

    const payload = buildPayload(q, miscIds);
    if (payload === null) continue;

    // Verbatim questions use the item's own evidence; others use the quote the model copied.
    const evidence: QuoteRef =
      ctx.origin === 'verbatim' && item
        ? { quote: item.evidence.quote, fileId: item.evidence.fileId, page: item.evidence.page }
        : toQuote(q.evidenceQuote, q.evidenceFileId, q.evidencePage, ctx.fileIds);

    const materialItemId =
      ctx.origin === 'generated' ? undefined : item?.id ?? (ctx.origin === 'adapted' ? ctx.items[0]?.id : undefined);

    drafts.push({
      type: q.type as QuestionType,
      prompt: clean(q.prompt),
      payload,
      conceptIds: cIds,
      keyPointIds: [...new Set((q.keyPointIds ?? []).filter((id) => keyPointIds.has(id)))],
      finalAnswer: clean(q.finalAnswer),
      explanation: clean(q.explanation),
      origin: ctx.origin,
      ...(materialItemId ? { materialItemId } : {}),
      evidence,
    });
  }
  return drafts;
}

// ── verify and judge ────────────────────────────────────────────────────────

const VerifySchema = z.object({
  usable: z.boolean(),
  qualityIssue: z.string(),
  dontKnow: z.boolean().nullish(),
  choiceIndex: num,
  choiceIndexes: z.array(z.number()).nullish(),
  boolValue: z.boolean().nullish(),
  numberValue: num,
  text: str,
  order: z.array(z.number()).nullish(),
  workedSteps: z.array(z.object({ text: z.string(), kind: z.string() })),
  difficulty: z.number(),
});

const JudgeSchema = z.object({ agrees: z.boolean(), why: z.string() });

// ── factory ─────────────────────────────────────────────────────────────────

export function createIngestTasks(llm: LlmClient, _config: Config): IngestTasks {
  const gen = async (
    schema: typeof QuestionsSchema,
    prompt: string,
    system: string,
    label: string,
    temperature: number,
    ctx: QuestionContext,
  ): Promise<QuestionDraft[]> => {
    const out = await llm.generateJson(schema, prompt, { system, label, temperature });
    return toQuestionDrafts(out.questions, ctx);
  };
  const fileIdsOf = (concepts: Concept[], items: MaterialItem[]): string[] =>
    [...new Set([...concepts.flatMap((c) => c.keyPoints.map((k) => k.evidence.fileId)), ...items.map((i) => i.evidence.fileId)])];

  return {
    planLessons: input => llm.generateJson(lessonPlanSchemaFor(input.concepts), lessonPlanPrompt(input.title, input.concepts, input.repair), {
      system: PLAN_LESSONS_SYSTEM, label: 'planLessons', temperature: 0.2,
    }),
    async extractOutline({ files, titleHint, onProgress }) {
      const parts: FlatOutline[] = [];
      const batches = outlineBatches(files);
      const seenScope = new Set<string>();
      const courseScope = files.flatMap(file => file.pages.filter((page, index) => index === 0 || /learning\s+(?:objectives|outcomes)|(?:short\s+)?outline|agenda|what\s+(?:we|you)\s+(?:will|just)\s+(?:uncover|learn)|(?:course|lesson)\s+(?:goals|objectives)/i.test(page.text))
        .filter(page => { const key = page.text.replace(/\s+/g, ' ').trim(); if (!key || seenScope.has(key)) return false; seenScope.add(key); return true; })
        .map(page => `[file ${file.fileId} page ${page.page}]\n${page.text.slice(0, 1500)}`)).join('\n\n').slice(0, 6000);
      // Sequential batches bound rate/concurrency and stop immediately if a provider call fails.
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const pages = batch.flatMap(f => f.pages.map(p => p.page));
        const range = batch.length === 1 ? `pages ${Math.min(...pages)}–${Math.max(...pages)}` : `${pages.length} page segments`;
        const message = `Reading ${range}, part ${i + 1} of ${batches.length}.`;
        await onProgress?.({ message, completed: i, total: batches.length });
        let latestSummary = '', lastUpdate = 0;
        const uploaded = batch.flatMap(f => f.uploaded ? [f.uploaded] : []);
        const context = batches.length > 1 ? `\nThis is course-material part ${i + 1} of ${batches.length}. Extract only this part, keeping its original file ids and page numbers. Reuse standard concept/unit titles for related ideas.\n` : '';
        parts.push(await llm.generateJson(OutlineSchema, buildExtractOutlinePrompt(batch, titleHint, courseScope) + context, {
          system: EXTRACT_OUTLINE_SYSTEM,
          label: 'extractOutline', temperature: 0.2,
          ...(onProgress ? { onReasoningSummary: async (summary: string) => {
            latestSummary = summary.slice(-1200);
            if (Date.now() - lastUpdate >= 800) {
              lastUpdate = Date.now();
              await onProgress({ message, summary: latestSummary, completed: i, total: batches.length });
            }
          } } : {}),
          ...(uploaded.length ? { files: uploaded } : {}),
        }));
        await onProgress?.({ message: `Read part ${i + 1} of ${batches.length}.`, completed: i + 1, total: batches.length,
          ...(latestSummary ? { summary: latestSummary } : {}) });
      }
      const out = parts.length === 1 ? parts[0] : mergeOutlines(parts);
      return toOutline(out, files.map((f) => f.fileId));
    },

    async buildStyleProfile({ materialItems, samplePages }) {
      const out = await llm.generateJson(StyleSchema, buildStyleProfilePrompt(materialItems, samplePages), {
        system: BUILD_STYLE_PROFILE_SYSTEM,
        label: 'buildStyleProfile',
        temperature: 0.2,
      });
      return toStyle(out, materialItems);
    },

    async buildMisconceptions({ concept, commonMistakes, evidence }) {
      const out = await llm.generateJson(MisconceptionsSchema, buildMisconceptionsPrompt(concept, commonMistakes, evidence), {
        system: BUILD_MISCONCEPTIONS_SYSTEM,
        label: 'buildMisconceptions',
        temperature: 0.4,
      });
      const fileIds = [...new Set(evidence.map((e) => e.fileId))];
      const seen = new Set<string>();
      const drafts: MisconceptionDraft[] = [];
      for (const m of out.misconceptions) {
        const id = slug(m.id || m.description);
        if (seen.has(id) || !clean(m.description) || !clean(m.beliefStatement) || !clean(m.correction)) continue;
        seen.add(id);
        drafts.push({
          id,
          description: clean(m.description),
          beliefStatement: clean(m.beliefStatement),
          correction: clean(m.correction),
          evidence: toQuote(m.quote, m.fileId, m.page, fileIds),
          origin: m.origin === 'material' ? 'material' : 'inferred',
          likelihood: Math.min(3, Math.max(1, Math.round(m.likelihood))),
        });
      }
      // The material's own mistakes first (stable sort).
      return drafts.sort((a, b) => Number(b.origin === 'material') - Number(a.origin === 'material'));
    },

    async convertItems({ items, concepts, styleProfile }) {
      if (items.length === 0) return [];
      return gen(QuestionsSchema, buildConvertItemsPrompt(items, concepts, styleProfile), CONVERT_ITEMS_SYSTEM, 'convertItems', 0.2, {
        concepts,
        items,
        origin: 'verbatim',
        fileIds: fileIdsOf(concepts, items),
      });
    },

    async adaptQuestions({ exemplars, gaps, concepts, styleProfile, evidence }) {
      if (gaps.length === 0) return [];
      return gen(
        QuestionsSchema,
        buildAdaptQuestionsPrompt(exemplars, gaps, concepts, styleProfile, evidence),
        ADAPT_QUESTIONS_SYSTEM,
        'adaptQuestions',
        0.7,
        { concepts, items: exemplars, origin: 'adapted', fileIds: [...new Set(evidence.map((e) => e.fileId))] },
      );
    },

    async generateQuestions({ exemplars, gaps, concepts, styleProfile, evidence }) {
      if (gaps.length === 0) return [];
      return gen(
        QuestionsSchema,
        buildGenerateQuestionsPrompt(exemplars, gaps, concepts, styleProfile, evidence),
        GENERATE_QUESTIONS_SYSTEM,
        'generateQuestions',
        0.8,
        { concepts, items: [], origin: 'generated', fileIds: [...new Set(evidence.map((e) => e.fileId))] },
      );
    },

    async verifyQuestion({ question, evidence }) {
      const out = await llm.generateJson(VerifySchema, buildVerifyQuestionPrompt(question, evidence), {
        system: VERIFY_QUESTION_SYSTEM,
        label: 'verifyQuestion',
        temperature: 0.1,
      });
      const answer = toVerifierAnswer(question, out);
      const kinds = WORKED_STEP_KINDS as readonly string[];
      return {
        answer,
        quality: { acceptable: out.usable, reason: out.qualityIssue },
        workedSteps: out.workedSteps
          .filter((s) => clean(s.text) && kinds.includes(s.kind))
          .map((s) => ({ text: clean(s.text), kind: s.kind as (typeof WORKED_STEP_KINDS)[number] })),
        difficulty: Math.min(5, Math.max(1, Math.round(out.difficulty))),
      };
    },

    async judgeAgreement({ question, verifierAnswer }) {
      return llm.generateJson(JudgeSchema, buildJudgeAgreementPrompt(question, verifierAnswer), {
        system: JUDGE_AGREEMENT_SYSTEM,
        label: 'judgeAgreement',
        temperature: 0.1,
      });
    },
  };
}

/** Flat verifier reply -> `Answer`. Anything missing or out of range becomes `{ dontKnow: true }`. */
function toVerifierAnswer(question: Parameters<typeof answerFitsQuestion>[0], out: z.infer<typeof VerifySchema>): Answer {
  if (out.dontKnow) return { dontKnow: true };
  const answer: Answer = {};
  switch (question.type) {
    case 'mcq':
      if (typeof out.choiceIndex === 'number') answer.choiceIndex = out.choiceIndex;
      break;
    case 'multi_select':
      if (out.choiceIndexes) answer.choiceIndexes = out.choiceIndexes;
      break;
    case 'true_false':
      if (typeof out.boolValue === 'boolean') answer.value = out.boolValue;
      break;
    case 'numeric':
      if (typeof out.numberValue === 'number') answer.value = out.numberValue;
      break;
    case 'short_text':
    case 'free_response':
      if (clean(out.text)) answer.text = clean(out.text);
      break;
    case 'ordering':
      if (out.order) answer.order = out.order;
      break;
  }
  return answerFitsQuestion(question, answer) ? answer : { dontKnow: true };
}
