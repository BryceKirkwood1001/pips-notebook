/**
 * Crude fallback for material that matches no canned sample, so uploads do not crash in mock mode:
 * headings become concepts, sentences become key points, key points become true/false questions.
 */
import type { OutlineDraft, QuestionDraft } from '../types';
import type { Concept, StyleProfile } from '@pips-notebook/shared';
import type { ParsedFile } from '../../rag/types';

const HEADING = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

/** Plain sentences (no markup characters) that can be quoted exactly. */
function sentencesOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => !/^\s*(#|```|>|[-*]\s|\d+\.\s)/.test(p) && !p.includes('\n'))
    .flatMap((p) => p.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 220 && !/[|`*_]/.test(s));
}

export function heuristicOutline(files: ParsedFile[], titleHint?: string): OutlineDraft {
  const concepts: OutlineDraft['units'][number]['concepts'] = [];
  let title = titleHint ?? '';
  for (const file of files) {
    for (const page of file.pages) {
      // Split the page at headings.
      let heading = '';
      let body: string[] = [];
      const flush = () => {
        const sentences = sentencesOf(body.join('\n'));
        if (heading && sentences.length > 0) {
          concepts.push({
            title: heading,
            summary: sentences[0],
            prerequisites: [],
            keyPoints: sentences.slice(0, 3).map((s) => ({
              statement: s,
              evidence: { quote: s, fileId: file.fileId, page: page.page },
            })),
          });
        }
        body = [];
      };
      for (const line of page.text.split('\n')) {
        const m = HEADING.exec(line);
        if (m) {
          flush();
          heading = m[1].trim();
          if (!title && line.startsWith('# ')) title = heading;
        } else body.push(line);
      }
      flush();
    }
  }
  // A one-heading handout would give a title as its only "concept": drop concepts named like the title.
  const real = concepts.length > 1 ? concepts.filter((c) => c.title !== title) : concepts;
  return {
    title: title || 'Uploaded material',
    language: 'en',
    units: [{ title: title || 'Uploaded material', concepts: real }],
    materialItems: [],
  };
}

export function heuristicStyle(): Omit<StyleProfile, 'examTimeHint'> {
  return {
    voice: 'Plain explanatory text.',
    notation: '',
    formatMix: { mcq: 0, true_false: 1, multi_select: 0, numeric: 0, short_text: 0, ordering: 0, free_response: 0 },
    typicalScenarios: [],
    avgSolutionSteps: 1,
    difficultyBand: { min: 1, max: 2 },
    exemplarItemIds: [],
  };
}

/** One true/false question per key point of the concepts, up to `count`. */
export function heuristicQuestions(concepts: Concept[], count: number): QuestionDraft[] {
  const out: QuestionDraft[] = [];
  for (const c of concepts) {
    for (const k of c.keyPoints) {
      if (out.length >= count) return out;
      out.push({
        type: 'true_false',
        prompt: 'True or false?',
        payload: { statement: k.statement, correctValue: true, wrongMisconceptionId: null },
        conceptIds: [c.id],
        keyPointIds: [k.id],
        finalAnswer: 'True',
        explanation: k.statement,
        origin: 'generated',
        evidence: { quote: k.evidence.quote, fileId: k.evidence.fileId, page: k.evidence.page },
      });
    }
  }
  return out;
}
