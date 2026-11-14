import { extractText } from 'unpdf';
import { AppError } from '../errors';
import type { Config } from '../config';
import type { LlmClient, UploadedFile } from '../llm/types';
import { fitsNativeOutline } from '../llm/ingest/outline-batches';
import type { MaterialParser, ParsedFile, ParsedPage, SourceFile } from './types';

/** A page with fewer non-whitespace characters than this is treated as scanned or image-only. */
const LOW_TEXT_CHARS = 40;

const toPage = (page: number, text: string): ParsedPage => ({
  page,
  text,
  lowText: text.replace(/\s/g, '').length < LOW_TEXT_CHARS,
});

export function createMaterialParser(deps: { llm?: LlmClient; config: Config }): MaterialParser {
  const { llm, config } = deps;

  const checkPageLimit = (count: number) => {
    if (count > config.maxPages) {
      throw new AppError('payload_too_large', `The file has ${count} pages; the limit is ${config.maxPages}.`);
    }
  };

  async function parsePdf(file: SourceFile): Promise<ParsedFile> {
    let texts: string[];
    try {
      // pdf.js may take ownership of the buffer, so hand it a copy.
      const res = await extractText(new Uint8Array(file.data), { mergePages: false });
      texts = res.text;
    } catch (err) {
      throw new AppError('unsupported_file', `Could not read "${file.name}" as a PDF: ${(err as Error).message}`);
    }
    checkPageLimit(texts.length);
    const pages = texts.map((t, i) => toPage(i + 1, t));

    let uploaded: UploadedFile | undefined;
    if (llm && fitsNativeOutline(pages)) {
      try {
        uploaded = await llm.uploadFile(file.data, { mimeType: 'application/pdf', displayName: file.name });
      } catch (err) {
        console.warn(`[rag] Files API upload failed for "${file.name}", continuing without it:`, (err as Error).message);
      }
    }
    return { fileId: file.id, name: file.name, type: 'pdf', pages, ...(uploaded ? { uploaded } : {}) };
  }

  function parseText(file: SourceFile): ParsedFile {
    const text = new TextDecoder('utf-8').decode(file.data).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const parts = text.split('\f');
    // A trailing form feed leaves an empty last part: it is not a page.
    if (parts.length > 1 && parts[parts.length - 1].trim() === '') parts.pop();
    checkPageLimit(parts.length);
    return { fileId: file.id, name: file.name, type: file.type, pages: parts.map((t, i) => toPage(i + 1, t)) };
  }

  return {
    async parse(file) {
      if (file.type === 'pdf') return parsePdf(file);
      return parseText(file);
    },
  };
}
