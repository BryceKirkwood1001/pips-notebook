# API setup and OpenAI support

Added on `integration` at the user's request: an OpenAI option and an API setup page styled to match the pixel-art frontend. No provider SDK or other package was added.

## Open setup

Start the backend with root `npm run dev:server`. In the actual game, use **Settings** in the header; **Back to game** returns to the current run phase or previous page. The new scene is named `Settings`.

The setup form is part of the main game at [localhost:4173](http://localhost:4173), using the game's CSS, font and background. Start it with root `npm run dev:game` after restoring the Phaser AE runtime. Its narrow-screen layout stacks the form for readability.

1. Choose **OpenAI**, **Google Gemini**, or **Offline**.
2. Enter a key for a live provider. Change the generation/embedding model names if needed; the account must have access to the selected models and support the requested API features.
3. Optionally expand **Connection details** to change the backend origin, interactive request timeout (1–180 seconds), and course preparation timeout (1–600 seconds per request, default 180).
4. **Test connection** validates the unsaved candidate. Live mode makes a small structured-generation request and an embedding request; generation can retry once for invalid output. This can incur API usage. Offline mode makes no provider calls.
5. **Save & apply** writes the settings and activates them for subsequent backend calls. It does not require a restart or discard courses/runs.

An empty key field retains a saved key. Enter a new key to replace it, or check **Remove saved key**. A selected live provider must retain a key. Both providers' profiles are retained so courses prepared with either can still retrieve evidence. API responses contain only `hasApiKey`, never the key.

Changing the backend origin clears the actual game's current run/results, updates its API client, and stores the origin in `top.apiOrigin`. The URL `?api=` value takes precedence. Only this non-secret origin is stored in the browser. Browser-only `?mock=1` practice responses are independent of backend provider selection.

## Defaults and environment

| Setting | Default |
|---|---|
| OpenAI generation | `gpt-5.6-luna` |
| OpenAI embedding | `text-embedding-3-small` |
| Gemini generation | `gemini-2.5-flash` |
| Gemini embedding | `gemini-embedding-001` |
| Embedding dimensions | 768 (read-only in the page) |
| Request timeout | 30 seconds |
| Course preparation timeout | 180 seconds per provider request |

`.env.example` includes `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, and `LLM_PROVIDER=openai|gemini|mock`. The existing `EMBEDDING_MODEL` remains the Gemini embedding setting. `INGEST_LLM_TIMEOUT_MS` defaults to 180000 and is independent of `LLM_TIMEOUT_MS` (30000). Without an explicit provider, initial environment configuration chooses a Gemini key first, an OpenAI key second, or Offline if neither exists.

On normal server startup, saved `.local/api-settings.json` overrides the initial LLM provider, both profiles and timeout. The ingest CLI and smoke script also load that file. Explicit programmatic test environments default to session-only settings and do not load a developer's local keys. To return to environment settings, stop the server, remove the local settings file, then restart. An explicitly selected environment provider still requires a key during initial configuration validation.

## Backend behavior and storage

- OpenAI uses native Node `fetch` against `api.openai.com/v1`: Responses with strict JSON Schema, Files with `purpose=user_data` for PDFs, and batched embeddings with configured dimensions. Generation uses `store:false`; this does not imply uploaded files are automatically deleted. Files cleanup is not implemented.
- The existing ingest/gameplay tasks and protected prompts are reused by both live providers. OpenAI schemas close objects, require all properties, represent optional fields with null, then restore the optional values before Zod validation. Generation retries invalid JSON/schema output once. Requests have abortable deadlines and public OpenAI failures omit raw provider diagnostics.
- Saving serializes updates and atomically renames a temporary file. The settings file is plaintext, gitignored, and mode `0600`; its newly created directory is `0700`. It is intended for this local hackathon server, with no secret-vault integration.
- The three setup routes require a loopback peer address, a localhost/loopback Host, and either no Origin or an allowed/same-server Origin. Fastify does not trust proxy forwarding headers. This is a local setup surface, not a multi-user credential administration service. Gameplay routes remain as previously implemented.
- Active generation settings are snapshotted per engine action. Ingest jobs retain the provider configuration captured when they start. Changing a setting does not replace the repository/vector store or cancel jobs already running.
- Large outlines use batches of at most 12 page segments / 24,000 extracted-text characters, retaining original file ids/page numbers. Long individual pages are split without dropping text. Batch results merge repeated concept titles, key points, prerequisite links and material items. Full-PDF attachments are used only when the complete outline input fits this bound; larger PDFs use their extracted text, avoiding reprocessing every page image in every batch. Scanned/diagram-only content still needs OCR/evidence support.
- Course preparation, including parsing uploads, embedding, outline and question tasks, receives the separate preparation deadline. Interactive turns keep their own request deadline. Existing settings files without `ingestTimeoutMs` use the environment/default budget. Retry preparation resubmits the retained browser upload/text as a new course while the upload scene remains open. Leaving/reloading that scene requires selecting the file again.
- OpenAI timeouts identify the operation (for example `extractOutline` or `embedding request`). The verified Luna models use `none` reasoning for ordinary calls; document outline calls with a progress callback use `low` and opt into public reasoning summaries. Arbitrary model names keep provider defaults and progress-only display. The user's selected model is preserved.
- New course packs record a hidden `embeddingProfile` (`provider`, `model`, `dims`). Retrieval keeps that original space even after changing generation providers. Keep the original provider key until those courses are no longer needed. Removing it produces an actionable restore-key error. An older pack lacking the metadata uses the server's startup embedding configuration; reseed/re-ingest old courses if that fallback does not match their embeddings. Model names should identify a stable embedding space.
- Dimensions are deliberately not editable here: changing them may require an Atlas index migration and re-ingesting courses. Existing upload page limits/exact-evidence checks still apply; native PDF inputs do not add OCR evidence support.

## API and implementation map

See [API.md](API.md) for captured requests/responses for `GET /api/settings/api`, `POST /api/settings/api`, and `POST /api/settings/api/test`.

| Files | Responsibility |
|---|---|
| `server/src/llm/openai-client.ts`, `provider.ts`, `index.ts`, `types.ts` | OpenAI transport and provider factory |
| `server/src/config.ts`, `.env.example` | Provider/key/model defaults and selection |
| `server/src/settings.ts`, `container.ts`, `wiring.ts` | Private persistence, snapshots and runtime dependency selection |
| `server/src/routes.ts`, `app.ts`, `errors.ts` | Local setup endpoints, guards and error shape |
| `server/src/services/create.ts`, `services/types.ts`, `ingest/pipeline.ts` | Provider-aware gameplay/seeding and course embedding metadata |
| `server/src/ingest/cli.ts`, `llm/smoke.ts` | Reuse saved/provider settings from command-line tools |
| `server/src/llm/ingest/outline-batches.ts`, `ingest/gemini.ts`, `rag/parser.ts` | Bounded outline requests/merging and large-PDF text handling |
| `shared/src/schemas.ts`, `api-client.ts`, `type-sync.ts` | Setup contracts, client methods and mutual type checks |
| `pips-notebook/game/course/settings-view.ts`, `Settings.ts` | Shared styled form and actual game scene |
| Game `course/app.ts`, `course/page.ts`, `main.ts`, `media/game.css` | Settings navigation, origin changes, layout and theme |
| Game `course/api-client.ts`, `course/mock.ts` | Synchronized client; practice mock explicitly rejects local-setup calls |
| `server/src/llm/openai-client.test.ts`, `server/test/api-settings.test.ts` | Transport, redaction, persistence, local guards and runtime switching regression tests |
| `scripts/e2e.ts`, `scripts/generate-api-docs.ts`, handoff docs | Offline endpoint captures and API documentation |

## Verification and limits

- `npm test`: 356 tests passed across 32 files after the progress/summary addition. Includes 108-page outline coverage/merge, long-page text preservation, preparation budgets, summary-only streaming, pre-completion publication, idle extension, request cap, truncated streams and unsupported-summary fallback.
- `npm run typecheck`: passed for backend/shared contracts; the native game build checks the Settings view.
- Both seasons and binary-search HTTP gauntlets passed. At this checkpoint, regenerated 25 captures covering all 20 endpoints. The live smoke script explicitly skipped in Offline mode.
- Browser: inspected provider cards, model/key fields, missing-key rejection, Offline Test and Save, connection controls, invalid-origin/timeout validation, and return navigation. No real key was entered or sent to a provider. See Settings screenshot (historical screenshot retired during rebranding).
- The native Phaser runtime was subsequently restored when the user asked to run the styled game: official CLI 0.8.0, engine `v3-82bf126`, and the manifest's expansion packs. `npm run build` now passes and `npm run serve` runs the actual game on port 4173. Browser-checked Title → Settings → OpenAI → Back → Play → the backend's sample course list, with no browser errors during that check. See native Settings screenshot (historical screenshot retired during rebranding). A complete native gameplay walkthrough, native smoke suite and publication have not been performed here.
- A later small synthetic-document request verified live GPT-6 Luna summary streaming and structured output (85 summary updates, about 3.8 seconds). Full live ingest/gameplay, embeddings, native PDF handling, Gemini and Atlas switching remain unverified. This probe does not establish quality or latency for the user's large PDF.

Implementation followed the current official OpenAI [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs), [file-input guide](https://developers.openai.com/api/docs/guides/file-inputs), [embedding guide](https://developers.openai.com/api/docs/guides/embeddings), and [default model reference](https://developers.openai.com/api/docs/models/gpt-5.6-luna). Access to a model remains account-dependent.

This feature is left as working-tree changes on `integration`, without a new commit or push. The actual styled game is open on port 4173 and uses the provider saved in Settings.

## Reported large-PDF timeout

The user subsequently configured `gpt-6-luna` and reported a 108-page Memory Hierarchy PDF failing at 30 seconds, before any units/rooms were saved. The prior configuration used the same short deadline for all calls and sent the entire PDF plus extracted text to outline generation. The exact failed operation was not recorded in the old error, so parsing/embedding versus outline cannot be conclusively separated from that report. The changes above address both the preparation deadline and the unbounded outline input; future OpenAI errors name the operation.

Restarted the backend with the saved OpenAI model/key retained and saved the new 180-second preparation budget. No real provider call was made by the agent during this fix. The original PDF was not re-ingested by the agent and needs re-uploading after the restart. Browser-checked failure/retry and timeout validation/Save through an isolated offline backend on 8799, then stopped it and restored the browser's API-origin preference to 8787. At that checkpoint, the native build, type checks, 348 tests and offline HTTP gauntlet passed.

The official [file-input guide](https://developers.openai.com/api/docs/guides/file-inputs) documents that native PDF input includes page images and text; the [GPT-6 Luna reference](https://developers.openai.com/api/docs/models/gpt-6-luna) confirms `none` reasoning support and its `medium` default. Those sources informed the batching and latency changes; they do not establish this PDF's live completion time.

## Thinking snippet below Stage

The user's next request added a styled Thinking panel directly below the ingest stage indicator. It shows real task progress for reading/indexing, each outline batch, question preparation and final coverage. It also displays the latest available **public OpenAI reasoning summary**, clearly labeled as such. The browser polls `GET /api/courses/:id` once per second; the backend streams Responses events and saves bounded activity updates while the model is still running.

For `gpt-6-luna` and `gpt-5.6-luna` outline extraction, requests use `stream:true`, `reasoning.effort:low`, and `reasoning.summary:auto`. Only summary events are forwarded. Raw reasoning/encrypted content and partial structured output stay out of progress. Question generation, verification and gameplay do not publish model summaries, keeping the unrevealed question bank private. The latest document-analysis summary can remain visible under later tasks, labeled “Latest”. Other providers/models use task progress. If a summary request is rejected with HTTP 400/403, the client retries without summaries and keeps subsequent batches in progress-only mode.

Active stream events reset the configured preparation idle deadline; a silent request still times out, and a continuously active request has a ten-minute ceiling. Non-streamed requests retain their ordinary per-request deadline. This bounds stalled/runaway calls while allowing a responsive document stream to continue beyond the former fixed cutoff.

`status.activity` has `message` (240-character limit), optional `summary` (latest 1200 characters), and optional `completed`/`total` counts. It is backward-compatible with cached packs. Updates are throttled during summary deltas, and the actual game renders strings as text nodes. No invented model thoughts are used when a summary is unavailable.

Files: shared schemas/client and the copied game client; `llm/types.ts`, `llm/ingest/gemini.ts`, `ingest/pipeline.ts` for activity callbacks/persistence; `llm/openai-client.ts` and new `llm/openai-stream.ts` for SSE and deadline handling; game `course/Upload.ts`, `media/game.css`, `course/settings-view.ts` for rendering and the idle-timeout hint. Tests are in `llm/openai-stream.test.ts` and `ingest/pipeline.test.ts`.

Validated one real synthetic-document generation with the existing saved GPT-6 Luna key, with no key printed or changed. Separately browser-checked the layout through an isolated fake provider on port 8799; the screenshot (historical screenshot retired during rebranding) explicitly labels its summary as a UI test fixture. Stopped that API and closed its tab afterward. Native build, type checks, 356 tests and the offline HTTP gauntlet pass. Restarted the owned backend to activate the feature; the original large PDF still needs re-uploading and full live ingestion remains unverified. No commit, push or publish was made.

The official [reasoning-summary guide](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries) and [streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses) describe the public summary parameter and event transport used here.
