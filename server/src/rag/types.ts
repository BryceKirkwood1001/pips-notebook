/**
 * Material ingestion and RAG contracts (SPEC 3.2). Owner: rag-engineer (server/src/rag/**).
 *
 * FACTORIES AND HELPERS other modules import from `server/src/rag/index.ts` (exact names):
 *   createMaterialParser(deps: { llm?: LlmClient; config: Config }): MaterialParser
 *   createChunker(config: Config): Chunker
 *   createEmbedder(llm: LlmClient, config: Config): Embedder
 *   createMemoryVectorStore(): VectorStore
 *   createIndexedDbVectorStore(db: IDBDatabase): VectorStore     // the browser; lives in server/src/repo/indexeddb.ts
 *   createRetriever(deps: { store: VectorStore; embedder: Embedder; config: Config }): Retriever
 *   normalizeForMatch(text: string): string
 *   quoteInText(quote: string, text: string): boolean
 *   locateQuote(quote, chunks, hint?): Evidence | null
 *   verifyEvidence(evidence: Evidence, chunk: Pick<Chunk, 'id' | 'text'>): boolean
 *
 * What does NOT use RAG: the student. It only ever sees its notebook.
 */
import type { Chunk, Evidence, FileType } from '@pips-notebook/shared';
import type { UploadedFile } from '../llm/types';

/** One uploaded file, in memory (uploads are capped by MAX_UPLOAD_MB). */
export interface SourceFile {
  /** `f1`, `f2`, ... unique within the course. */
  id: string;
  name: string;
  type: FileType;
  data: Uint8Array;
}

export interface ParsedPage {
  /** 1-based. */
  page: number;
  /** The page's text layer ('' when there is none). */
  text: string;
  /** True when the page has almost no text (scanned or image-only): rely on the native PDF reader. */
  lowText: boolean;
}

export interface ParsedFile {
  fileId: string;
  name: string;
  type: FileType;
  /**
   * PDF: one entry per page, from `unpdf`. TXT/MD: split on form feeds, otherwise a single page 1.
   * Throws `AppError('payload_too_large')` beyond MAX_PAGES.
   */
  pages: ParsedPage[];
  /**
   * PDF only, and only when an `LlmClient` was given: the Files API handle, so the outline task can
   * have Gemini read the PDF natively (diagrams, tables, slide layouts).
   */
  uploaded?: UploadedFile;
}

/** Reader 2 of the two readers (text layer per page), plus the upload that enables reader 1. */
export interface MaterialParser {
  parse(file: SourceFile): Promise<ParsedFile>;
}

export type ChunkDraft = Omit<Chunk, 'embedding'>;

/**
 * Structure-aware chunking: split on headings, slides and page breaks first, then into chunks of
 * about CHUNK_TOKENS with CHUNK_OVERLAP overlap. A chunk never spans two pages. `conceptIds` starts
 * empty; the ingest pipeline fills it once the outline exists.
 * Ids are `${courseId}_${fileId}_p${page}_${n}` (n counts from 0 within the page). The course id is
 * part of the id because stores upsert by chunk id, so two courses must never share one.
 */
export interface Chunker {
  chunk(courseId: string, file: ParsedFile): ChunkDraft[];
}

export interface Embedder {
  /** Identifies the vector space, e.g. "gemini-embedding-001@768" or "fake-hash@768". Stored in fixtures. */
  readonly id: string;
  readonly dims: number;
  /** taskType RETRIEVAL_DOCUMENT. */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** taskType RETRIEVAL_QUERY. */
  embedQuery(text: string): Promise<number[]>;
}

export interface ScoredChunk {
  chunk: Chunk;
  /** Cosine similarity. Higher is closer. */
  score: number;
}

export interface VectorStore {
  /** Prepares the store. A no-op for the memory and IndexedDB stores. Safe to call twice. */
  init(): Promise<void>;
  /** Insert or replace by chunk id. */
  upsert(chunks: Chunk[]): Promise<void>;
  /** Top-k chunks of ONE course by vector similarity. */
  search(params: { courseId: string; embedding: number[]; topK: number }): Promise<ScoredChunk[]>;
  /** Every chunk of a course, ordered by file, page and position. */
  listByCourse(courseId: string): Promise<Chunk[]>;
  getByIds(ids: string[]): Promise<Chunk[]>;
  deleteCourse(courseId: string): Promise<void>;
}

export interface RetrieveQuery {
  courseId: string;
  query: string;
  /** Structure first: chunks tagged with these concepts come before vector hits. */
  conceptIds?: string[];
  /** Number of vector hits. Default `config.retrievalTopK`. */
  topK?: number;
}

/** A chunk as handed to prompts: no embedding. */
export interface RetrievedChunk {
  chunkId: string;
  fileId: string;
  page: number;
  sectionPath: string[];
  text: string;
  /** 1 for concept chunks; the similarity score for vector hits. */
  score: number;
  source: 'concept' | 'vector';
}

/**
 * Hybrid retrieval: the concepts' own chunks first, then the top-k vector hits for the query,
 * de-duplicated by chunk id.
 */
export interface Retriever {
  retrieve(query: RetrieveQuery): Promise<RetrievedChunk[]>;
}

/** Signatures of the evidence helpers exported from `server/src/rag/index.ts`. */
export interface EvidenceHelpers {
  /** Collapses all whitespace runs to one space and trims. Nothing else: matching is otherwise exact. */
  normalizeForMatch(text: string): string;
  /** Exact, whitespace-normalized containment. */
  quoteInText(quote: string, text: string): boolean;
  /**
   * Finds the chunk that contains the quote and returns full `Evidence` (with `sectionPath`), or null.
   * Chunks matching the hint (fileId, page) are tried first.
   */
  locateQuote(
    quote: string,
    chunks: Pick<Chunk, 'id' | 'fileId' | 'page' | 'sectionPath' | 'text'>[],
    hint?: { fileId?: string; page?: number },
  ): Evidence | null;
  /** True when `evidence.chunkId` is this chunk and the quote is in its text. */
  verifyEvidence(evidence: Evidence, chunk: Pick<Chunk, 'id' | 'text'>): boolean;
}
