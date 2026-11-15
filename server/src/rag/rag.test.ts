import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import type { Chunk } from '@pips-notebook/shared';
import { testConfig } from '../config';
import { isAppError } from '../errors';
import {
  createChunker,
  createEmbedder,
  createMaterialParser,
  createMemoryVectorStore,
  createRetriever,
  locateQuote,
  normalizeForMatch,
  quoteInText,
  verifyEvidence,
} from './index';
import { fakeLlm, hashEmbed } from './testHelpers';
import type { ParsedFile, SourceFile } from './types';

const config = testConfig();
const sample = (n: string) => readFileSync(fileURLToPath(new URL(`../../../samples/${n}`, import.meta.url)), 'utf8');
const enc = (s: string) => new TextEncoder().encode(s);

async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of pages) {
    const p = doc.addPage();
    if (t) p.drawText(t, { x: 50, y: 700, size: 12, font });
  }
  return doc.save();
}

describe('parser', () => {
  it('keeps every page of a large PDF without uploading the full document for every outline batch', async () => {
    const llm = fakeLlm();
    const upload = vi.spyOn(llm, 'uploadFile');
    const data = await makePdf(Array.from({ length: 108 }, (_, i) => `Memory hierarchy evidence on page ${i + 1}.`));
    const parsed = await createMaterialParser({ llm, config }).parse({ id: 'f1', name: 'lecture.pdf', type: 'pdf', data });
    expect(parsed.pages).toHaveLength(108);
    expect(parsed.pages[107].text).toContain('page 108');
    expect(parsed.uploaded).toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it('reads a PDF per page, flags low-text pages, uploads', async () => {
    const data = await makePdf([
      'Page one has plenty of readable text about the seasons of the year.',
      '',
      'Page three also has plenty of readable text about axial tilt angle.',
    ]);
    const parser = createMaterialParser({ llm: fakeLlm(), config });
    const r = await parser.parse({ id: 'f1', name: 'a.pdf', type: 'pdf', data });
    expect(r.pages).toHaveLength(3);
    expect(r.pages.map((p) => p.lowText)).toEqual([false, true, false]);
    expect(r.pages[0].text).toContain('seasons of the year');
    expect(r.uploaded?.mimeType).toBe('application/pdf');
  });

  it('continues without the upload handle when upload fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = await makePdf(['Some readable text that is long enough to count as text.']);
    const r = await createMaterialParser({ llm: fakeLlm(768, { failUpload: true }), config }).parse({
      id: 'f1', name: 'a.pdf', type: 'pdf', data,
    });
    expect(r.uploaded).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects garbage PDFs and too many pages', async () => {
    const parser = createMaterialParser({ config: testConfig({ maxPages: 2 }) });
    await expect(parser.parse({ id: 'f1', name: 'x.pdf', type: 'pdf', data: enc('not a pdf') })).rejects.toMatchObject({
      code: 'unsupported_file',
    });
    const data = await makePdf(['a one two three four five six seven eight nine ten eleven twelve', 'b', 'c']);
    const err = await parser.parse({ id: 'f1', name: 'x.pdf', type: 'pdf', data }).catch((e) => e);
    expect(isAppError(err) && err.code).toBe('payload_too_large');
  });

  it('splits TXT/MD on form feeds', async () => {
    const parser = createMaterialParser({ config });
    const one = await parser.parse({ id: 'f1', name: 'a.md', type: 'md', data: enc('# Hi\nthere') });
    expect(one.pages).toHaveLength(1);
    const two = await parser.parse({ id: 'f2', name: 'a.txt', type: 'txt', data: enc('one\fTwo\f') });
    expect(two.pages.map((p) => p.text)).toEqual(['one', 'Two']);
    const limited = createMaterialParser({ config: testConfig({ maxPages: 1 }) });
    await expect(limited.parse({ id: 'f3', name: 'a.txt', type: 'txt', data: enc('a\fb') })).rejects.toMatchObject({
      code: 'payload_too_large',
    });
  });
});

async function parsedSample(name: string, id: string): Promise<ParsedFile> {
  const file: SourceFile = { id, name, type: 'md', data: enc(sample(name)) };
  return createMaterialParser({ config }).parse(file);
}

describe('chunker', () => {
  for (const name of ['seasons.md', 'binary-search.md']) {
    it(`chunks ${name}`, async () => {
      const parsed = await parsedSample(name, 'f1');
      const chunks = createChunker(config).chunk('c1', parsed);
      const max = config.chunkTokens * 4;
      expect(chunks.length).toBeGreaterThan(2);
      expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
      expect(chunks[0].id).toBe('c1_f1_p1_0');
      for (const c of chunks) {
        expect(c.page).toBe(1);
        expect(c.conceptIds).toEqual([]);
        expect(c.text.length).toBeLessThanOrEqual(max * 1.1);
      }
      // Every sentence of the source is found whole in some chunk.
      const sentences = sample(name).match(/[A-Z][^.\n]{30,}\./g) ?? [];
      expect(sentences.length).toBeGreaterThan(10);
      const found = sentences.filter((s) => locateQuote(s, chunks) !== null);
      expect(found.length / sentences.length).toBeGreaterThan(0.9);
    });
  }

  it('records section paths', async () => {
    const chunks = createChunker(config).chunk('c1', await parsedSample('seasons.md', 'f1'));
    const tilt = chunks.find((c) => c.text.includes('Worked example 1.1'))!;
    expect(tilt.sectionPath).toEqual(['Why Earth Has Seasons', '1. Axial tilt and sunlight angle', 'Worked example 1.1']);
    expect(chunks[0].sectionPath[0]).toBe('Why Earth Has Seasons');
  });

  it('overlaps long sections and keeps the heading in the first chunk', () => {
    const small = testConfig({ chunkTokens: 50, chunkOverlap: 0.3 });
    const paras = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} says something quite specific about topic ${i}.`);
    const file: ParsedFile = {
      fileId: 'f1', name: 'a.md', type: 'md',
      pages: [{ page: 1, text: `# Title\n\n${paras.join('\n\n')}`, lowText: false }],
    };
    const chunks = createChunker(small).chunk('c', file);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].text.startsWith('# Title')).toBe(true);
    expect(chunks.slice(1).every((c) => !c.text.startsWith('# Title'))).toBe(true);
    for (let i = 1; i < chunks.length; i++) {
      const lastPara = chunks[i - 1].text.split('\n\n').pop()!;
      expect(chunks[i].text).toContain(lastPara); // overlap
    }
  });

  it('never spans pages, splits slides, keeps code whole', () => {
    const file: ParsedFile = {
      fileId: 'f2', name: 'a.md', type: 'md',
      pages: [
        { page: 1, text: 'Slide A text.\n---\nSlide B text.\n\n```py\nx = 1\n\ny = 2\n```', lowText: false },
        { page: 2, text: 'Page two text.', lowText: false },
      ],
    };
    const chunks = createChunker(config).chunk('c', file);
    expect(chunks.map((c) => c.id)).toEqual(['c_f2_p1_0', 'c_f2_p1_1', 'c_f2_p2_0']);
    expect(chunks[1].text).toContain('x = 1\n\ny = 2');
    expect(chunks[2].page).toBe(2);
  });

  it('treats short title-like lines in PDF text as headings', () => {
    const file: ParsedFile = {
      fileId: 'f1', name: 'a.pdf', type: 'pdf',
      pages: [{ page: 1, text: 'Axial Tilt\nThe axis is tilted by 23.5 degrees from the vertical.\n\nDay Length\nDays vary with latitude.', lowText: false }],
    };
    const chunks = createChunker(config).chunk('c', file);
    expect(chunks.map((c) => c.sectionPath)).toEqual([['Axial Tilt'], ['Day Length']]);
  });
});

async function seededStore() {
  const llm = fakeLlm();
  const embedder = createEmbedder(llm, config);
  const store = createMemoryVectorStore();
  const chunker = createChunker(config);
  const all: Chunk[] = [];
  for (const [course, name, id] of [['c1', 'seasons.md', 'f1'], ['c2', 'binary-search.md', 'f1']] as const) {
    const drafts = chunker.chunk(course, await parsedSample(name, id));
    const vecs = await embedder.embedDocuments(drafts.map((d) => d.text));
    const chunks = drafts.map((d, i) => ({ ...d, embedding: vecs[i] }));
    all.push(...chunks);
    await store.upsert(chunks);
  }
  return { llm, embedder, store, all };
}

describe('embedder', () => {
  it('has ids and batches', async () => {
    const llm = fakeLlm();
    const e = createEmbedder(llm, config);
    expect(e.id).toBe('fake-hash@768');
    expect(e.dims).toBe(768);
    const out = await e.embedDocuments(Array.from({ length: 250 }, (_, i) => `t${i}`));
    expect(out).toHaveLength(250);
    expect(llm.embedCalls).toEqual(['RETRIEVAL_DOCUMENT:100', 'RETRIEVAL_DOCUMENT:100', 'RETRIEVAL_DOCUMENT:50']);
    await e.embedQuery('q');
    expect(llm.embedCalls.at(-1)).toBe('RETRIEVAL_QUERY:1');
    expect(createEmbedder({ ...llm, provider: 'gemini' }, config).id).toBe('gemini-embedding-001@768');
  });
});

describe('memory store and retriever', () => {
  it('ranks the relevant chunk first and never crosses courses', async () => {
    const { store, embedder } = await seededStore();
    const retriever = createRetriever({ store, embedder, config });
    const a = await retriever.retrieve({ courseId: 'c1', query: 'noon Sun altitude declination latitude' });
    expect(a[0].text).toMatch(/altitude/i);
    expect(a.every((r) => r.chunkId.startsWith('c1_'))).toBe(true);
    const b = await retriever.retrieve({ courseId: 'c2', query: 'binary search midpoint invariant sorted list' });
    expect(b[0].text).toMatch(/binary search/i);
    expect(b.every((r) => r.chunkId.startsWith('c2_'))).toBe(true);
    expect(a.length).toBe(config.retrievalTopK);
    expect(a.every((r) => r.source === 'vector')).toBe(true);
  });

  it('puts concept chunks first, capped at 8, without duplicates', async () => {
    const { store, embedder, all } = await seededStore();
    const c1 = all.filter((c) => c.courseId === 'c1');
    const tagged = c1.slice(3, 15).map((c) => ({ ...c, conceptIds: ['k1'] }));
    await store.upsert(tagged);
    const retriever = createRetriever({ store, embedder, config });
    const r = await retriever.retrieve({ courseId: 'c1', query: tagged[0].text, conceptIds: ['k1'], topK: 3 });
    expect(r.slice(0, 8).every((x) => x.source === 'concept')).toBe(true);
    expect(r.slice(0, 8).map((x) => x.chunkId)).toEqual(tagged.slice(0, 8).map((c) => c.id));
    expect(r.slice(8).every((x) => x.source === 'vector')).toBe(true);
    expect(new Set(r.map((x) => x.chunkId)).size).toBe(r.length);
    expect(r[0]).not.toHaveProperty('embedding');
  });

  it('lists in document order, gets by ids, deletes a course', async () => {
    const { store } = await seededStore();
    const list = await store.listByCourse('c1');
    const pages = list.map((c) => c.page);
    expect(pages).toEqual([...pages].sort((x, y) => x - y));
    expect(list[0].id).toBe('c1_f1_p1_0');
    expect((await store.getByIds(['c1_f1_p1_0', 'nope'])).map((c) => c.id)).toEqual(['c1_f1_p1_0']);
    await store.deleteCourse('c1');
    expect(await store.listByCourse('c1')).toEqual([]);
    expect((await store.listByCourse('c2')).length).toBeGreaterThan(0);
  });
});

describe('evidence', () => {
  const chunk = { id: 'c_f1_p1_0', fileId: 'f1', page: 1, sectionPath: ['A'], text: 'Earth’s axis  is tilted\n23.5 degrees.' };
  it('normalizes', () => {
    expect(normalizeForMatch('  a \n\t b c­ d  ')).toBe('a b c d');
    expect(normalizeForMatch('“q” ‘x’')).toBe('"q" \'x\'');
  });
  it('matches exactly after whitespace and typographic normalization', () => {
    expect(quoteInText("Earth's axis is tilted 23.5 degrees.", chunk.text)).toBe(true);
    expect(quoteInText('axis is   tilted', chunk.text)).toBe(true);
    expect(quoteInText('earth’s axis', chunk.text)).toBe(false); // no case folding
    expect(quoteInText('axis is slightly tilted', chunk.text)).toBe(false);
    expect(quoteInText('   ', chunk.text)).toBe(false);
  });
  it('locates quotes and honours hints', () => {
    const other = { ...chunk, id: 'c_f2_p3_0', fileId: 'f2', page: 3 };
    const ev = locateQuote('axis is tilted', [chunk, other], { fileId: 'f2', page: 3 });
    expect(ev).toMatchObject({ chunkId: 'c_f2_p3_0', fileId: 'f2', page: 3, sectionPath: ['A'] });
    expect(locateQuote('axis is tilted', [chunk, other])?.chunkId).toBe('c_f1_p1_0');
    expect(locateQuote('not here', [chunk])).toBeNull();
  });
  it('verifies evidence', () => {
    const ev = locateQuote('axis is tilted', [chunk])!;
    expect(verifyEvidence(ev, chunk)).toBe(true);
    expect(verifyEvidence({ ...ev, quote: 'made up' }, chunk)).toBe(false);
    expect(verifyEvidence({ ...ev, chunkId: 'other' }, chunk)).toBe(false);
  });
});
