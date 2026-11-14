# Integrated dungeon frontend

## How to test

Play opens The lesson archive: Library / Files / Notes switch source methods
without losing drafts. Choose a sample and rooms, then Start run. In Learning,
Talk to Pip opens the lesson book; Notebook opens the notebook. Close/Escape
puts the book away without discarding an unsent answer. Teach updates Pip's pose
and question cue; Answer/Skip and Ready advance the lesson. Combat keeps health
and Next turn outside the books; Battle log opens labeled feedback/damage cards.

The `Settings` scene opens from the header's Settings button. Choose OpenAI,
Google Gemini or Offline; edit the password key, model fields and remove-key
checkbox. Expand Connection details for the backend origin and timeout.
Test connection validates unsaved settings; Save & apply persists and activates
them. Back to game returns to the existing run phase/previous page. A changed
backend origin clears the local run/results. Timed help deadlines keep running.
Connection details has a separate preparation timeout (180 seconds by default,
up to 600) for new uploads. Preparation errors offer Retry preparation using
the submitted file/text while Upload remains open. Reloading/leaving Upload
requires selecting the file again; Start stays disabled after a failure.
Thinking below Stage shows `course.status.activity.message` and the latest
available public OpenAI analysis summary. Other providers show task progress.
Active streamed analysis extends the idle deadline (ten-minute request cap).

The panel sits at (72,86), width 1136 on the native 1280×720 stage, with scrolling
for expanded connection details. Standard labeled DOM controls and provider
radio roles identify every field. The standalone `/api-settings.html` preview
on port 5174 uses the same view and supports narrower screens.

## Map

- `course/Settings.ts`: scene lifecycle and view cleanup.
- `course/settings-view.ts`: provider form, Test/Save, feedback and cancellation.
- `course/app.ts`: origin preference, provider-independent client and navigation.
- `course/page.ts`: header Settings button and shared page frame.
- `course/Learning.ts`, `page.ts`: conversation/inventory books and draft retention.
- `course/Upload.ts`: tabbed archive, expedition setup and Thinking/retry.
- `course/battle.ts`, `battle-feedback.ts`: battle chronicle, result cues, canonical run refresh and explicit damage labels.
- `art.ts`, `manifest.json`, `media/*idle.png` and pose sheets: animated actors.
- `main.ts`: registers Settings alongside the existing six scenes.
- `course/api-client.ts`: dependency-free copy of the shared backend client.
- `media/game.css`: existing theme plus scoped setup/preview styles.

## Missing or simplified

The local Phaser AE runtime/packs were restored after user authorization.
Native build passes and the real game is served on localhost:4173. Title,
Settings/OpenAI/Back and the backend sample list were browser-checked.
Browser checks also cover archive tabs/drafts, teaching/answer/skip, notebook,
combat log and help submission in practice mode. No complete walkthrough is claimed.
Native smoke was attempted: its headless simulator fails at course/ui.ts:2
with document undefined; the existing frontend requires a real DOM browser.
A small live GPT-6 Luna request verified summary streaming and structured output.
Full live ingestion/gameplay/PDF/Atlas checks and publish were not performed.
See the root `docs/API_SETTINGS.md` for storage, provider-switching behavior,
verification and complete source map. Existing gameplay/debug behavior is
described by the root integration/handoff docs; no new cheats were added.
