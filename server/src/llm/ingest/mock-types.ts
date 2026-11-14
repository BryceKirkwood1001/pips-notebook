import type { MisconceptionDraft, OutlineDraft } from '../types';
import type { QuestionType, StyleProfile } from '@pips-notebook/shared';

/**
 * Compact format of one canned question in mock-data/*.json. Concept and key point ids (c1, c1_k2) and
 * material item ids (m3) follow the pipeline's id scheme for the canned outline, which never drops an item.
 */
export interface CannedQuestion {
  o: 'verbatim' | 'adapted' | 'generated';
  /** Source material item (verbatim) or exemplar (adapted). */
  item: string | null;
  type: QuestionType;
  c: string[];
  k: string[];
  prompt: string;
  fa: string;
  ex: string;
  /** Evidence quote, copied from the handout. */
  q: string;
  d: number;
  /** Worked-step kinds, space separated: recall reason compute write. */
  st: string;
  // true_false
  stmt?: string;
  tf?: boolean;
  tfMis?: string | null;
  // mcq / multi_select: options in display order, correct index(es), option index -> misconception id
  opts?: string[];
  ans?: number | number[];
  mis?: Record<string, string>;
  // numeric
  num?: number;
  tol?: number;
  unit?: string | null;
  numWrong?: { v: number; m: string }[];
  // short_text
  acc?: string[];
  rubric?: string;
  txtWrong?: { p: string; m: string }[];
  // ordering: items in the CORRECT order; wrong orders are index permutations of that list
  order?: string[];
  ordWrong?: { order: number[]; m: string }[];
  // free_response
  model?: string;
  frMis?: string[];
}

export interface CannedSample {
  /** Text that identifies the handout (its title). */
  match: string;
  outline: OutlineDraft;
  style: Omit<StyleProfile, 'examTimeHint'>;
  /** Misconception drafts by concept title. */
  misconceptions: Record<string, MisconceptionDraft[]>;
  questions: CannedQuestion[];
}
