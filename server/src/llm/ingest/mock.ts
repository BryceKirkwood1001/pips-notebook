/**
 * Deterministic, offline ingest tasks. They replay canned model outputs for the two bundled samples
 * (mock-data/*.json), so the real pipeline (chunking, evidence checks, validation, time budgets,
 * coverage) runs end to end without a key. Unknown material falls back to a crude heuristic pack.
 *
 * The instance is stateful in one way: adapt/generate hand out each canned question once, so repeated
 * calls for the same gap move on to the next canned questions instead of repeating the first ones.
 */
import { readFileSync } from 'node:fs';
import type { Answer, Concept, WorkedStep } from '@pips-notebook/shared';
import { normalizeText } from '../../core/grading';
import { questionKey } from '../../ingest/util';
import type { CoverageGap, IngestTasks, QuestionDraft, VerifyQuestionOutput } from '../types';
import { heuristicOutline, heuristicQuestions, heuristicStyle } from './heuristic';
import type { CannedQuestion, CannedSample } from './mock-types';

const load = (name: string): CannedSample =>
  JSON.parse(readFileSync(new URL(`./mock-data/${name}.json`, import.meta.url), 'utf8')) as CannedSample;

const STEP_TEXT: Record<WorkedStep['kind'], string> = {
  recall: 'Recall the relevant fact from the notes.',
  reason: 'Reason from the rule to the answer.',
  compute: 'Work out the number.',
  write: 'Write the answer out.',
};

/** Canned question -> the QuestionDraft the model would have returned. */
export function cannedToDraft(c: CannedQuestion): QuestionDraft {
  const options = (c.opts ?? []).map((text, i) => ({ text, misconceptionId: c.mis?.[String(i)] ?? null }));
  let payload: unknown;
  switch (c.type) {
    case 'mcq':
      payload = { options, correctIndex: c.ans };
      break;
    case 'multi_select':
      payload = { options, correctIndexes: c.ans };
      break;
    case 'true_false':
      payload = { statement: c.stmt, correctValue: c.tf, wrongMisconceptionId: c.tfMis ?? null };
      break;
    case 'numeric':
      payload = {
        answer: c.num,
        tolerance: { kind: 'abs', value: c.tol ?? 0.01 },
        unit: c.unit ?? null,
        wrongAnswers: (c.numWrong ?? []).map((w) => ({ value: w.v, tolerance: 0.01, misconceptionId: w.m })),
      };
      break;
    case 'short_text':
      payload = {
        acceptedAnswers: c.acc,
        rubric: c.rubric ?? '',
        wrongAnswers: (c.txtWrong ?? []).map((w) => ({ pattern: w.p, misconceptionId: w.m })),
      };
      break;
    case 'ordering':
      payload = {
        items: c.order,
        correctOrder: (c.order ?? []).map((_, i) => i),
        wrongOrders: (c.ordWrong ?? []).map((w) => ({ order: w.order, misconceptionId: w.m })),
      };
      break;
    case 'free_response':
      payload = { rubric: c.rubric ?? '', modelAnswer: c.model, misconceptionIds: c.frMis ?? [] };
      break;
  }
  return {
    type: c.type,
    prompt: c.prompt,
    payload,
    conceptIds: c.c,
    keyPointIds: c.k,
    finalAnswer: c.fa,
    explanation: c.ex,
    origin: c.o,
    ...(c.item ? { materialItemId: c.item } : {}),
    evidence: { quote: c.q, page: 1 },
  };
}

type Registry = Map<string, { canned?: CannedQuestion; answer?: Answer }>;

export function createMockIngestTasks(): IngestTasks {
  const samples = [load('seasons'), load('binary-search')];
  const emitted = new Set<CannedQuestion>();
  const registry: Registry = new Map();
  for (const s of samples) for (const q of s.questions) registry.set(questionKey({ prompt: q.prompt, payload: { statement: q.stmt } as never }), { canned: q });

  const sampleByText = (text: string) => samples.find((s) => text.includes(s.match));
  const sampleByConcept = (title: string) =>
    samples.find((s) => s.outline.units.some((u) => u.concepts.some((c) => c.title === title)));
  const sampleByItem = (text: string) => samples.find((s) => s.outline.materialItems.some((m) => m.text === text));

  /** Canned adapted/generated questions for a gap: inside the gap's concepts, gap-covering ones first. */
  function pick(origin: 'adapted' | 'generated', gap: CoverageGap, concepts: Concept[]): QuestionDraft[] {
    const sample = concepts[0] ? sampleByConcept(concepts[0].title) : undefined;
    if (!sample) return [];
    const inside = (q: CannedQuestion) =>
      q.o === origin &&
      !emitted.has(q) &&
      q.c.every((id) => gap.conceptIds.includes(id)) &&
      (gap.multiConcept ? q.c.length >= 2 : q.c.length === 1);
    const score = (q: CannedQuestion) =>
      q.k.filter((k) => gap.keyPointIds.includes(k)).length +
      [...(q.numWrong ?? []).map((w) => w.m), ...(q.txtWrong ?? []).map((w) => w.m), ...(q.tfMis ? [q.tfMis] : []), ...Object.values(q.mis ?? {})].filter(
        (m) => gap.misconceptionIds.includes(m),
      ).length;
    const chosen = sample.questions
      .filter(inside)
      .map((q, i) => ({ q, i, s: score(q) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, Math.max(0, gap.count))
      .map((x) => x.q);
    chosen.forEach((q) => emitted.add(q));
    return chosen.map(cannedToDraft);
  }

  function fallback(gap: CoverageGap, concepts: Concept[]): QuestionDraft[] {
    const drafts = heuristicQuestions(concepts.filter((c) => gap.conceptIds.includes(c.id)), gap.count);
    for (const d of drafts) {
      registry.set(questionKey({ prompt: d.prompt, payload: d.payload as never }), { answer: { value: true } });
    }
    return drafts;
  }

  return {
    async extractOutline({ files, titleHint }) {
      const text = files.flatMap((f) => f.pages.map((p) => p.text)).join('\n');
      const sample = sampleByText(text);
      return sample ? structuredClone(sample.outline) : heuristicOutline(files, titleHint);
    },

    async buildStyleProfile({ materialItems }) {
      const sample = materialItems[0] ? sampleByItem(materialItems[0].text) : undefined;
      return sample ? structuredClone(sample.style) : heuristicStyle();
    },

    async buildMisconceptions({ concept }) {
      const sample = sampleByConcept(concept.title);
      return structuredClone(sample?.misconceptions[concept.title] ?? []);
    },

    async convertItems({ items, concepts }) {
      const sample = items[0] ? sampleByItem(items[0].text) : undefined;
      if (!sample) return [];
      const ids = new Set(items.map((m) => m.id));
      return sample.questions.filter((q) => q.o === 'verbatim' && q.item && ids.has(q.item)).map(cannedToDraft);
    },

    async adaptQuestions({ gaps, concepts }) {
      return gaps.flatMap((g) => pick('adapted', g, concepts));
    },

    async generateQuestions({ gaps, concepts }) {
      const known = concepts[0] ? sampleByConcept(concepts[0].title) : undefined;
      return gaps.flatMap((g) => (known ? pick('generated', g, concepts) : fallback(g, concepts)));
    },

    async verifyQuestion({ question }): Promise<VerifyQuestionOutput> {
      const entry = registry.get(questionKey(question));
      if (!entry) return { answer: { dontKnow: true }, workedSteps: [], difficulty: 3 };
      const c = entry.canned;
      if (!c) return { answer: entry.answer ?? { dontKnow: true }, workedSteps: [{ text: STEP_TEXT.recall, kind: 'recall' }], difficulty: 1 };

      const indexOfText = (texts: string[], wanted: string[]) =>
        wanted.map((w) => texts.indexOf(w)).filter((i) => i >= 0);
      let answer: Answer;
      switch (question.type) {
        case 'mcq':
          answer = { choiceIndex: question.payload.options.indexOf((c.opts ?? [])[c.ans as number]) };
          break;
        case 'multi_select':
          answer = { choiceIndexes: indexOfText(question.payload.options, (c.ans as number[]).map((i) => (c.opts ?? [])[i])) };
          break;
        case 'true_false':
          answer = { value: c.tf };
          break;
        case 'numeric':
          answer = { value: c.num };
          break;
        case 'short_text':
          answer = { text: (c.acc ?? [c.fa])[0] };
          break;
        case 'ordering':
          // The stored items are shuffled: find the canned correct sequence by text.
          answer = { order: indexOfText(question.payload.items, c.order ?? []) };
          break;
        case 'free_response':
          answer = { text: c.model ?? c.fa };
          break;
      }
      const workedSteps = c.st.split(/\s+/).filter(Boolean).map((k) => ({ kind: k as WorkedStep['kind'], text: STEP_TEXT[k as WorkedStep['kind']] }));
      return { answer, workedSteps, difficulty: c.d };
    },

    async judgeAgreement({ question, verifierAnswer }) {
      const key = question.type === 'free_response' ? (question.payload.modelAnswer ?? question.solution.finalAnswer) : question.solution.finalAnswer;
      const words = (s: string) => new Set(normalizeText(s).split(/\W+/).filter((w) => w.length > 2));
      const a = words(verifierAnswer);
      const b = words(key);
      const shared = [...a].filter((w) => b.has(w)).length;
      const agrees = normalizeText(verifierAnswer) === normalizeText(key) || (b.size > 0 && shared / b.size >= 0.6);
      return { agrees, why: agrees ? 'same answer' : 'different answer' };
    },
  };
}
