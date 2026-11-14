import type { ParsedFile, ParsedPage } from '../../rag/types';

export const OUTLINE_BATCH_PAGES = 12;
export const OUTLINE_BATCH_CHARS = 24000;

export function fitsNativeOutline(pages: ParsedPage[]): boolean {
  return pages.length <= OUTLINE_BATCH_PAGES && pages.reduce((n, page) => n + page.text.length, 0) <= OUTLINE_BATCH_CHARS;
}

/** Keep every page and its original evidence coordinates, with bounded text per model request. */
export function outlineBatches(files: ParsedFile[]): ParsedFile[][] {
  if (fitsNativeOutline(files.flatMap(file => file.pages))) return [files];
  const batches: ParsedFile[][] = [];
  let batch: ParsedFile[] = [], pages = 0, chars = 0;
  const flush = () => { if (batch.length) batches.push(batch); batch = []; pages = 0; chars = 0; };
  for (const file of files) {
    for (const page of file.pages) {
      let offset = 0;
      do {
        let end = Math.min(offset + OUTLINE_BATCH_CHARS, page.text.length);
        if (end < page.text.length) {
          const space = page.text.lastIndexOf(' ', end - 1);
          if (space > offset + OUTLINE_BATCH_CHARS / 2) end = space + 1;
        }
        const text = page.text.slice(offset, end);
        if (pages >= OUTLINE_BATCH_PAGES || chars + text.length > OUTLINE_BATCH_CHARS) flush();
        let part = batch.find(f => f.fileId === file.fileId);
        if (!part) {
          // Attaching the original PDF would make each text batch process the entire document again.
          part = { fileId: file.fileId, name: file.name, type: file.type, pages: [] };
          batch.push(part);
        }
        part.pages.push({ ...page, text }); pages++; chars += text.length;
        offset = end;
      } while (offset < page.text.length);
    }
  }
  flush();
  return batches;
}
