import type { Config } from '../config';
import type { ChunkDraft, Chunker, ParsedFile } from './types';

/** A run of text with the separator that preceded it in the source (blank line or a space). */
interface Unit {
  sep: string;
  text: string;
}

interface Section {
  path: string[];
  lines: string[];
}

const HEADING_RE = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const SLIDE_RE = /^ {0,3}-{3,}\s*$/;
const FENCE_RE = /^ {0,3}(```|~~~)/;

/** Cheap, safe title test for PDF text: a short line with no sentence punctuation, after a blank line. */
function looksLikePdfTitle(lines: string[], i: number): boolean {
  const line = lines[i].trim();
  if (line === '' || line.length > 60 || line.split(/\s+/).length > 8) return false;
  if (!/[A-Za-z]/.test(line) || /[.,;:!?]$/.test(line)) return false;
  if (i > 0 && lines[i - 1].trim() !== '') return false;
  return i + 1 < lines.length && lines[i + 1].trim() !== '';
}

/** Splits one page into sections by headings and slide separators. `trail` is the heading trail so far. */
function splitPage(
  text: string,
  isPdf: boolean,
  trail: { level: number; title: string }[],
): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  const currentPath = () => trail.map((h) => h.title);
  let cur: Section = { path: currentPath(), lines: [] };
  let inFence = false;

  const flush = () => {
    if (cur.lines.some((l) => l.trim() !== '')) sections.push(cur);
  };
  const startSection = () => {
    flush();
    cur = { path: currentPath(), lines: [] };
  };
  const pushHeading = (level: number, title: string) => {
    while (trail.length > 0 && trail[trail.length - 1].level >= level) trail.pop();
    trail.push({ level, title });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isPdf && FENCE_RE.test(line)) inFence = !inFence;
    if (!inFence && !isPdf && SLIDE_RE.test(line)) {
      startSection(); // a slide separator starts a new section; the rule itself carries no content
      continue;
    }
    const m = !inFence && !isPdf ? HEADING_RE.exec(line) : null;
    if (m) {
      // A heading that directly follows another heading is folded into the same section.
      const onlyHeadings = cur.lines.every((l) => l.trim() === '' || HEADING_RE.test(l));
      if (!onlyHeadings) startSection();
      pushHeading(m[1].length, m[2].trim());
      cur.path = currentPath();
      cur.lines.push(line);
      continue;
    }
    if (isPdf && looksLikePdfTitle(lines, i)) {
      const onlyHeadings = cur.lines.every((l) => l.trim() === '');
      if (!onlyHeadings) startSection();
      pushHeading(1, line.trim());
      cur.path = currentPath();
    }
    cur.lines.push(line);
  }
  flush();
  return sections;
}

/** Breaks a section's text into paragraph units; fenced code blocks stay whole. */
function toParagraphs(lines: string[]): Unit[] {
  const units: Unit[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (buf.length) units.push({ sep: '\n\n', text: buf.join('\n') });
    buf = [];
  };
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      if (!inFence) flush(); // a fence opens its own block
      inFence = !inFence;
      buf.push(line);
      if (!inFence) flush();
      continue;
    }
    if (!inFence && line.trim() === '') {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  // Keep a heading line together with the paragraph that follows it.
  const merged: Unit[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const isHeading = !u.text.includes('\n') && HEADING_RE.test(u.text);
    if (isHeading && i + 1 < units.length) {
      units[i + 1] = { sep: u.sep, text: `${u.text}\n\n${units[i + 1].text}` };
      continue;
    }
    merged.push(u);
  }
  return merged;
}

/** Splits a unit longer than `max` into sentences, then words (or lines, for code), keeping text as written. */
function splitLong(unit: Unit, max: number): Unit[] {
  if (unit.text.length <= max) return [unit];
  const isCode = FENCE_RE.test(unit.text);
  const pieces = isCode
    ? unit.text.split(/(?<=\n)/)
    : unit.text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s !== '');
  const out: Unit[] = [];
  pieces.forEach((p, i) => {
    const text = isCode ? p : p;
    const sep = i === 0 ? unit.sep : isCode ? '' : ' ';
    if (text.length > max && !isCode) {
      // A sentence longer than the target: cut at word boundaries.
      const words = text.split(/\s+/);
      let acc = '';
      let first = true;
      for (const w of words) {
        if (acc && acc.length + 1 + w.length > max) {
          out.push({ sep: first ? sep : ' ', text: acc });
          first = false;
          acc = w;
        } else acc = acc ? `${acc} ${w}` : w;
      }
      if (acc) out.push({ sep: first ? sep : ' ', text: acc });
    } else out.push({ sep, text });
  });
  return out;
}

const joinUnits = (units: Unit[]) => units.map((u, i) => (i === 0 ? u.text : u.sep + u.text)).join('');

/** Packs units into chunks of at most `max` characters, carrying `overlap` characters of tail units. */
function pack(units: Unit[], max: number, overlap: number): string[] {
  const chunks: string[] = [];
  let cur: Unit[] = [];
  let curLen = 0;
  let fresh = 0; // units in `cur` that are new (not carried-over overlap)

  const lenWith = (u: Unit) => (cur.length === 0 ? u.text.length : curLen + u.sep.length + u.text.length);

  for (const u of units) {
    if (fresh > 0 && lenWith(u) > max) {
      chunks.push(joinUnits(cur));
      // Carry a tail of whole units as overlap, never the whole chunk.
      const tail: Unit[] = [];
      let tailLen = 0;
      for (let i = cur.length - 1; i > 0; i--) {
        const add = cur[i].text.length + cur[i].sep.length;
        if (tailLen + add > overlap) break;
        tail.unshift(cur[i]);
        tailLen += add;
      }
      cur = tail;
      curLen = joinUnits(cur).length;
      fresh = 0;
      // The overlap must leave room for the new unit.
      while (cur.length > 0 && lenWith(u) > max) {
        cur.shift();
        curLen = joinUnits(cur).length;
      }
    }
    cur.push(u);
    curLen = joinUnits(cur).length;
    fresh++;
  }
  if (fresh > 0) chunks.push(joinUnits(cur));
  return chunks;
}

export function createChunker(config: Config): Chunker {
  const max = Math.max(1, Math.round(config.chunkTokens * 4)); // 1 token ~ 4 characters
  const overlap = Math.floor(max * config.chunkOverlap);

  return {
    chunk(courseId, file: ParsedFile): ChunkDraft[] {
      const out: ChunkDraft[] = [];
      const isPdf = file.type === 'pdf';
      const trail: { level: number; title: string }[] = []; // heading trail carries across pages
      for (const page of file.pages) {
        let n = 0;
        const sections = splitPage(page.text, isPdf, trail);
        for (const section of sections) {
          const units = toParagraphs(section.lines).flatMap((u) => splitLong(u, max));
          for (const text of pack(units, max, overlap)) {
            if (text.trim() === '') continue;
            out.push({
              id: `${courseId}_${file.fileId}_p${page.page}_${n++}`,
              courseId,
              fileId: file.fileId,
              page: page.page,
              sectionPath: section.path,
              conceptIds: [],
              text,
            });
          }
        }
      }
      return out;
    },
  };
}
