import type { Chunk, Evidence } from '@top/shared';
import type { EvidenceHelpers } from './types';

/**
 * Collapses whitespace runs to one space and trims. On top of that we map the typographic variants a
 * PDF text layer produces (curly quotes -> straight quotes, non-breaking and other odd spaces ->
 * space, soft hyphens and zero-width characters removed). This is applied to BOTH the quote and the
 * chunk text, so a quote copied from either form still matches. No case folding, no fuzzy matching.
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[­​‌‍⁠﻿]/g, '')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[   -   　]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteInText(quote: string, text: string): boolean {
  const q = normalizeForMatch(quote);
  if (q === '') return false;
  return normalizeForMatch(text).includes(q);
}

type Locatable = Pick<Chunk, 'id' | 'fileId' | 'page' | 'sectionPath' | 'text'>;

export function locateQuote(
  quote: string,
  chunks: Locatable[],
  hint?: { fileId?: string; page?: number },
): Evidence | null {
  if (normalizeForMatch(quote) === '') return null;
  const matchesHint = (c: Locatable) =>
    (hint?.fileId === undefined || c.fileId === hint.fileId) && (hint?.page === undefined || c.page === hint.page);
  // Chunks matching the hint are tried first; the rest keep their order.
  const ordered = hint ? [...chunks.filter(matchesHint), ...chunks.filter((c) => !matchesHint(c))] : chunks;
  const hit = ordered.find((c) => quoteInText(quote, c.text));
  if (!hit) return null;
  return {
    chunkId: hit.id,
    fileId: hit.fileId,
    page: hit.page,
    quote: quote.trim(),
    sectionPath: hit.sectionPath,
  };
}

export function verifyEvidence(evidence: Evidence, chunk: Pick<Chunk, 'id' | 'text'>): boolean {
  return evidence.chunkId === chunk.id && quoteInText(evidence.quote, chunk.text);
}

// Compile-time check that we match the documented signatures.
export const evidenceHelpers: EvidenceHelpers = { normalizeForMatch, quoteInText, locateQuote, verifyEvidence };
