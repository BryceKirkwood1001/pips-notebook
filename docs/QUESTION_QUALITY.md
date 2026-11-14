# Source-aligned questions and battle feedback

The user reported layout glitches and weak questions, supplied the 108-page CS230 Memory Hierarchy deck, and requested system prompts that assess the uploaded learning material directly.

## Source review

Extracted the complete PDF text and visually reviewed representative code/diagram slides with Poppler. Slide 8's “Can we speed up memory access?” is a rhetorical transition, not an answer students should memorize. The substantive topics include cache performance (31–33), locality and array traversal (49–71), write policies (79–91), and placement/conflicts/set mapping (93–104). Early administrative announcements, previous-class review and repeated reveal slides should not become independent cache-learning rooms.

## Prompt and verification changes

The shared `QUESTION_QUALITY_RULES` in `server/src/prompts/ingest/questionSpec.ts` now applies to conversion, adaptation, generation and verification:

- Every required fact, relationship, formula and answer must be supported by the uploaded passages; no filling gaps with outside knowledge.
- Assess mechanisms, explanations, comparisons and representative applications rather than slide wording, rhetorical hooks or decorative numbers.
- Include necessary code, data and assumptions in the question. Avoid references to unseen diagrams/examples.
- Respect bounds such as `100+`. Numerical questions should apply taught relationships instead of manufacturing incidental arithmetic.
- Written-answer rubrics should accept equivalent meaning, not require verbatim phrasing.
- Omit unsupported or ambiguous candidates instead of inventing questions to fill a count.

The outline prompt filters logistics, unrelated previous-class review, rhetorical hooks and duplicate reveals as independent objectives. Each batch also receives bounded title/objective context from the uploaded document. That context is protected as data; evidence must come from the current part. Limits are 24,000 current-batch text characters plus up to 6,000 orientation characters.

Live verification now requires `usable` and `qualityIssue` alongside an independent solution. A solvable but poor/unsupported question remains unverified, stays out of the public pool, and follows the existing bounded regeneration path. A narrow deterministic check also rejects prompts explicitly asking what a slide/instructor said; it does not ban substantive questions merely for asking what problem a mechanism raises. Legacy mock task outputs remain compatible, while live verifier JSON requires the new fields.

Short-text grading now includes its full stored rubric inside the protected material block. The generated fallback rubric asks for equivalent meaning. Related wording alone is not automatically credited: the required idea and valid notebook evidence must still be present.

## Live reference check

[source-quality-review.json](verification/source-quality-review.json) records a small evaluation using the selected GPT-6 Luna model and actual PDF excerpts. It fingerprints the PDF without committing the file or credentials.

| Source | Generated example | Answer |
|---|---|---|
| Slide 31 | Hit time 2 cycles, miss penalty 100 cycles, miss rate 3%: average access time? | 5 cycles |
| Slide 61 | Given the nested row traversal, which locality does `v` exhibit and why? | Spatial locality from nearby data accesses |
| Slide 104 | Three sets, block id 11: which set using the given modulo rule? | Set 2 |

All three passed exact evidence lookup and independent quality/answer agreement checks. The live verifier rejected the reported rhetorical machine-model question. A semantic grading check accepted a differently worded locality answer. This representative check does not establish that every question from a complete re-ingest will be ideal; the complete PDF has not yet been re-ingested with these rules.

## Battle UI fixes

- `course/battle.ts`: separate room title from hearts/attempt/answered counts; keep controls fixed while only feedback scrolls; fetch the canonical run after answers, including help notebook updates; remove duplicate failed-turn articles.
- New `course/battle-feedback.ts`: distinct cards with labeled answer, reasoning, notebook evidence, expected answer and explanation. A block footer says “No damage” or gives damage with heart/health units.
- `course/ui.ts`: avoid repeating the question heading inside its expanded card, use readable type names and label solve time as an estimate.
- `media/game.css`: title wrapping, fixed toolbar, scrolling cards, notebook popover and result badges.

Read the active run without advancing it. Its correct numeric help response had damage 0; both incorrect student responses had damage 1. The apparent damage on the correct response was a display-boundary issue. “I don't know” was legitimately wrong because the notebook lacked the required idea; the rhetorical question was the quality issue.

Browser-checked the new frontend against that same run: long title fits, controls remain within the pane while logs scroll, and correct feedback says “No damage”. No game actions were taken. [battle-feedback-fixed.png](verification/battle-feedback-fixed.png) records the check.

## Activation and limits

The user initially chose to preserve the run, then explicitly requested “restart now.” The backend was restarted on November 14 and the refined prompts are active. Health and redacted settings checks passed; the saved OpenAI model/key and separate request budgets were retained. In-memory courses/runs were cleared (the old run returns 404). Upload the course again to prepare a new bank with these rules. Prompt changes do not retroactively replace stored questions.

Current checks: 360 tests in 32 files, type check, native build and offline HTTP gauntlet pass. Model quality checks and citation matching are useful filters, not semantic proofs. Large-document diagram-only information still has the existing text/evidence limitations. Full revised ingestion/gameplay remains unverified.
