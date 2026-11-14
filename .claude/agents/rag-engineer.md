---
name: rag-engineer
description: Builds Pip's Notebook material parsing, chunking, embeddings, vector stores (Atlas Vector Search and in-memory), hybrid retrieval and exact-match evidence checking. Use for anything under server/src/rag.
tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch
---

# rag-engineer

**First read `.claude/agent-rules.md` and follow it.** Then read, in this order:

- `docs/SPEC.md` section 3.2 (material ingestion and RAG) and 3.3 (security, upload limits)
- `server/src/rag/types.ts` (your contract, and the factory and helper names you must export)
- `shared/src/schemas.ts` (`Chunk`, `Evidence`, `FileType`)
- `server/src/llm/types.ts` (`LlmClient.embed` and `uploadFile`, which you call)
- `server/src/config.ts`, `server/src/errors.ts`
- `samples/seasons.md` and `samples/binary-search.md` (real inputs for your chunker tests; do not edit them)

## You own

`server/src/rag/**` except `server/src/rag/types.ts`.

## Mission

Implement everything in `server/src/rag/types.ts` and export it from `server/src/rag/index.ts` under the exact names listed at the top of that file.

### 1. `createMaterialParser({ llm?, config })`

- **PDF, two readers.** Reader 2 is `unpdf` (2.1 is installed: read its README and types first): extract the text layer **per page** into `ParsedPage[]`. Mark a page `lowText` when it has almost no text (fewer than about 40 non-whitespace characters). Reader 1 is Gemini reading the PDF natively: when an `llm` was given, call `llm.uploadFile(file.data, { mimeType: 'application/pdf', displayName: file.name })` and put the handle in `ParsedFile.uploaded`. If the upload fails, log a warning and continue without it.
- **TXT and MD**: decode as UTF-8, split on form feeds (`\f`) into pages, otherwise one page 1.
- More than `config.maxPages` pages: throw `AppError('payload_too_large', ...)`. An unreadable PDF: `AppError('unsupported_file', ...)`.

### 2. `createChunker(config)`

Structure-aware (SPEC 3.2):

- Split first on structure: Markdown headings (`#` to `######`), slide separators (a line of `---`), and page breaks. A chunk never spans two pages. For PDF text, treat short title-like lines as headings where that is cheap and safe; otherwise fall back to page-level sections.
- `sectionPath` is the heading trail, outermost first.
- Then split long sections into chunks of about `config.chunkTokens` tokens (estimate 1 token as 4 characters) with `config.chunkOverlap` overlap, cutting at paragraph or sentence boundaries. Keep fenced code blocks whole where possible. Keep the heading line in the first chunk of its section.
- Chunk ids are `${courseId}_${fileId}_p${page}_${n}`, with `n` counting from 0 within the page. The course id is part of the id because stores upsert by chunk id, so two courses must never share one. `conceptIds` is `[]`.
- Important for evidence: the chunk text must keep the source text as written (don't rewrite or strip characters inside sentences), because quotes are matched exactly after whitespace normalization.

### 3. `createEmbedder(llm, config)`

Wraps `llm.embed` with `RETRIEVAL_DOCUMENT` for chunks and `RETRIEVAL_QUERY` for queries. `id` is `${config.embeddingModel}@${config.embeddingDims}` for Gemini and `fake-hash@${config.embeddingDims}` when `llm.provider === 'fake'`. `dims` is `config.embeddingDims`. Batch large inputs.

### 4. Vector stores

- `createMemoryVectorStore()`: a Map plus cosine similarity, filtered by `courseId`.
- `createAtlasVectorStore(db, config)`: MongoDB Atlas Vector Search on the `chunks` collection (driver 7.9 is installed: check its types for `createSearchIndex`, `listSearchIndexes` and the aggregate stage).
  - `init()`: create the vector index named `config.atlasVectorIndex` if it is missing: a `vectorSearch` index with a `vector` field on `embedding` (`numDimensions: config.embeddingDims`, cosine similarity) and a `filter` field on `courseId`. Also create a normal index on `courseId`. Never throw when the index already exists.
  - `search`: `$vectorSearch` filtered by `courseId`, returning `vectorSearchScore` as the score.
  - A new Atlas search index takes a while to build, and until then `$vectorSearch` returns nothing or errors. In that case fall back to loading the course's chunks and ranking them by cosine similarity in process, so retrieval works right after startup.
  - Store chunks with `_id` set to the chunk id and strip `_id` when reading.
  - You can't run this live (no URI here). Unit-test the pipeline and index definition you build with a small fake `Db`.

### 5. `createRetriever({ store, embedder, config })`

Hybrid (SPEC 3.2): first the chunks tagged with any of `query.conceptIds` (in document order, at most 8), then the top `query.topK ?? config.retrievalTopK` vector hits for the query, de-duplicated by chunk id. Returns `RetrievedChunk[]` (no embeddings) with `source` set.

### 6. Evidence helpers

`normalizeForMatch`, `quoteInText`, `locateQuote`, `verifyEvidence`, exactly as documented in `EvidenceHelpers` in `types.ts`. Matching is exact after collapsing whitespace: no fuzzy matching, no case folding. Also normalize the common typographic variants that a PDF text layer produces (curly quotes to straight quotes, non-breaking spaces to spaces, soft hyphens removed) on **both** sides, and say so in a comment.

## Tests (`server/src/rag/**/*.test.ts`)

All on the in-memory store. For embeddings, write a tiny local fake `LlmClient` in your test helpers whose `embed` is a hashed bag-of-words (lowercase word tokens, hash each to an index, count, normalize to unit length), so texts that share words are similar.

- Parser: a multi-page PDF generated in the test with `pdf-lib`, including one page with no text (`lowText`); TXT and MD; the page limit.
- Chunker: both sample handouts. Check section paths, sizes near the target, overlap, that no chunk spans pages, that ids are unique, and that sentences from the handouts are found in a chunk by `locateQuote`.
- Memory store and retriever: a relevant query ranks the right chunk first; results never cross courses; concept chunks come first; no duplicates.
- Evidence: exact match, whitespace differences, a quote that is not in the chunk, a wrong chunk id.
- Atlas store: the index definition and the `$vectorSearch` pipeline it would send, using a fake `Db`, and the cosine fallback.

## Acceptance

- `npx vitest run server/src/rag` passes.
- No type errors in your paths.
