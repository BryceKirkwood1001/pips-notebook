import { normalizeText } from '../core/grading';

export interface NotebookSection {
  title: string;
  notes: string[];
}

/** Sections in document order. `notes` are bullet texts without the "- " prefix. */
export function parseNotebook(notebookMd: string): NotebookSection[] {
  const sections: NotebookSection[] = [];
  for (const raw of notebookMd.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      sections.push({ title: line.slice(3).trim(), notes: [] });
    } else if (line.startsWith('- ') && sections.length > 0) {
      sections[sections.length - 1].notes.push(line.slice(2).trim());
    }
  }
  return sections;
}

/** Every bullet text in the notebook, without the "- " prefix. */
export function notebookLines(notebookMd: string): string[] {
  return parseNotebook(notebookMd).flatMap((s) => s.notes);
}

export const EMPTY_NOTEBOOK = '# Notebook\n';

/** "# Notebook", then each section separated by a blank line. */
export function renderNotebook(sections: NotebookSection[]): string {
  if (sections.length === 0) return EMPTY_NOTEBOOK;
  const body = sections.map((s) => `## ${s.title}\n${s.notes.map((n) => `- ${n}`).join('\n')}`.trimEnd());
  return `# Notebook\n\n${body.join('\n\n')}\n`;
}

/** Sorts sections by their position in `order` (concept titles in scope order); unknown titles go last. */
function sortSections(sections: NotebookSection[], order: string[]): NotebookSection[] {
  const rank = (t: string): number => {
    const i = order.indexOf(t);
    return i < 0 ? order.length : i;
  };
  return sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.title) - rank(b.s.title) || a.i - b.i)
    .map((x) => x.s);
}

function sectionFor(sections: NotebookSection[], title: string): NotebookSection {
  let sec = sections.find((s) => s.title === title);
  if (!sec) {
    sec = { title, notes: [] };
    sections.push(sec);
  }
  return sec;
}

/** Adds "- text" under the concept's section (created lazily, in scope order). Never adds a duplicate. */
export function addNote(notebookMd: string, order: string[], title: string, text: string): string {
  const sections = parseNotebook(notebookMd);
  const sec = sectionFor(sections, title);
  const note = text.trim().replace(/\s*\n\s*/g, ' ');
  if (note && !sec.notes.includes(note)) sec.notes.push(note);
  return renderNotebook(sortSections(sections, order));
}

/** Replaces the `oldText` bullet with `newText`; appends `newText` when `oldText` is not there. No duplicates. */
export function replaceNote(notebookMd: string, order: string[], title: string, oldText: string, newText: string): string {
  const sections = parseNotebook(notebookMd);
  const sec = sectionFor(sections, title);
  const next = newText.trim().replace(/\s*\n\s*/g, ' ');
  const at = sec.notes.indexOf(oldText.trim());
  if (at >= 0) {
    if (sec.notes.includes(next) && next !== sec.notes[at]) sec.notes.splice(at, 1);
    else sec.notes[at] = next;
  } else if (next && !sec.notes.includes(next)) {
    sec.notes.push(next);
  }
  return renderNotebook(sortSections(sections, order));
}

const words = (s: string): string[] => s.split(' ').filter(Boolean);

/**
 * The grounding check (SPEC 5): does the cited note fuzzy-match a notebook bullet? After normalizing both
 * sides: equal, or a substantial excerpt/near-match. Exact short facts remain valid, but approximate
 * matches require at least three distinct words and 12 characters on both sides.
 */
export function citationMatches(citedNote: string, notebookMd: string): boolean {
  const cited = normalizeText(citedNote.trim().replace(/^[-*]\s+/, ''));
  if (!cited) return false;
  const citedWords = [...new Set(words(cited))];
  return notebookLines(notebookMd).some((line) => {
    const l = normalizeText(line);
    if (!l) return false;
    if (l === cited) return true;
    if (Math.min(l.length, cited.length) < 12 || citedWords.length < 3 || new Set(words(l)).size < 3) return false;
    const shorter = l.length < cited.length ? l : cited;
    if ((l.includes(cited) || cited.includes(l)) && shorter.length >= 12) return true;
    const lineWords = new Set(words(l));
    const hits = citedWords.filter((w) => lineWords.has(w)).length;
    return hits / citedWords.length >= 0.8;
  });
}
