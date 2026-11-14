/** Keyword helpers for the deterministic mock gameplay tasks. */

const STOPWORDS = new Set(
  (
    'the and for are but not you all any can had her was one our out has have his how its may new now old see two way who ' +
    'did get let put say she too use that this with from they will would there their what when which while about into than then them these those been being were your also just some such only over very more most'
  ).split(' '),
);

export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/\d+(?:\.\d+)?|[a-z]+/g) ?? []) {
    if (/^\d/.test(raw)) {
      out.add(raw);
      continue;
    }
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    out.add(raw.length > 3 && raw.endsWith('s') ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** Share (0..1) of the needle's keywords that appear in the haystack. 0 when the needle has none. */
export function coverage(needle: string, haystack: string): number {
  const n = keywords(needle);
  if (n.size === 0) return 0;
  const h = keywords(haystack);
  let hit = 0;
  for (const k of n) if (h.has(k)) hit += 1;
  return hit / n.size;
}

/** Number of keywords two texts share. */
export function sharedKeywords(a: string, b: string): number {
  const hb = keywords(b);
  let n = 0;
  for (const k of keywords(a)) if (hb.has(k)) n += 1;
  return n;
}
