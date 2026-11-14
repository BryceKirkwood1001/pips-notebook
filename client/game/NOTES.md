# Integrated dungeon frontend

## How to test

`?mock=1` plays the canned practice API (room 1 is lost once on purpose, then everything passes);
`?api=<origin>` picks a backend (default 8787). My archive lists Your saved dungeons.
Title: Play (Create New Dungeon), My archive, Settings, Music.
Title controls live in the menu; the usual header returns on other screens. Settings Back returns here.
Start run shows a title card (curtain), then Pip walks into the library.

Learning (library): Talk to Pip opens the lesson book: Overview, one page per topic (its own
explanation box, Dictate, Pip's reply thread and Pip's questions for that topic), then Review.
Its speech bubble floats gently (1.8s); open questions keep the faster 1.1s bob. Reduced motion disables both.
Pip replies to each explanation; short/partial statements can become notes, including mistaken claims you must reteach.
Teach sends `conceptId`, so Pip only notes/asks about that topic. The Expedition log card (top right)
shows rooms cleared, battle accuracy (readable percentage plus correct/total) and weak points from `PublicRun.history` and the notebook;
Report opens the full report (also in the Rooms/Pause menu). Ready shows a battle title card.

Battle: arena and monster scale with the room's position (danger tier, `art.ts` `tiers`/`tierFor`):
first room = sunset meadow + Misconception slime, middle = deep forest + Muddle beast, last = moonlit
ruins + Fallacy drake (5 rooms: 1,2,2,3,3). Nameplate and battle title card show "Danger n of 3".
The final exam uses the boss room and dragon.
Next turn: the question flies out of the foe to the centre (click to skip), retracts into it, then
Pip's thought bubble shows while `/turn` answers (`room/boss.nextQuestion` is the public next question).
Room changes: Pip gets up from the desk and walks off (right; left past a standing foe after a loss
or the exam), the title card covers the change, then Pip walks in and stands still.
Nameplates show Pip's hearts (or exam grade) and questions left; the outcome card is top right.
Hits float a label over whoever took them. Sprites never cross: attacks tween from a stored home
spot and never come within 140 units. Room end shows a victory card (stars, stats, door to the next
room: Pip walks off, title card, walks in) or a defeat card (Pip's wrong reasoning, retry).

Dictation never uploads audio. It uses the browser's on-device recogniser (live text) when
`SpeechRecognition.available({langs, processLocally:true})` allows; otherwise it records a clip
(max 30s) and transcribes it in the page with Moonshine base (MIT) via transformers.js 4.3.2 on
WASM. The ~63 MB library/model download comes once from jsDelivr/Hugging Face (Cache API). English
only. It only edits the text box (appends); navigation cancels it.

Markdown (`ui.ts` `markdown`/`inline`, text nodes only): fenced code, inline code, bold, italics,
lists and line breaks in questions, options, answers, reasoning, explanations, notes and chat.
"Help me!" answer buttons use the serif text face so code keeps its case.

Zoom: the HUD is laid out in CSS px on a stage exactly over the canvas, so browser zoom resizes
the HUD while the scene fills the window (HUD shrinks with the window below 0.8 CSS px/unit).

Expeditions: My archive lists every expedition per course (In progress / Ended / Finished) with
Resume (or View record / View results), End and Remove; the Rooms/Pause menu has End expedition and
Remove expedition. Both ask first (in-game dialog, Cancel focused, Escape cancels). End keeps the run
as a read-only record (opens in the menu as "Expedition ended"); Remove deletes it, the course stays.
Delete dungeon in My archive removes its lessons and all expeditions after confirmation; active preparation blocks deletion.

Header: the Pip's Notebook chip is Home (pauses a run in progress, which stays in My archive);
Music on/off is remembered per browser. Soundtrack (`course/soundtrack.ts`, teammate): menu, learning,
mini-boss by danger tier (miniboss_1..3), finalboss. Results: Play this course again, Expedition report,
My archive (top and bottom).
Track changes fade out over 650ms, then fade in over 900ms once playback starts. Shared tracks continue;
rapid navigation replaces pending fades. Music off silences immediately; returning to the tab fades in.

Settings: OpenAI / Gemini / Offline, write-only keys, Test/Save, connection and preparation
timeouts (see root docs/ARCHITECTURE.md).

## Map

- `art.ts`: positions (`POS`), danger tiers, sheets, walk/strike/defeat animations, `drawStage`.
- `course/page.ts`: stage fit (zoom), header, `atWorld`, `RoomView` books.
- `course/Learning.ts`: topic steps, teaching, Pip's questions, expedition card.
- `course/battle.ts`: nameplates, outcome card, hit labels, victory/defeat, room changes, help modal.
- `course/report.ts`: expedition log card and full report (public data only).
- `course/transition.ts`: title-card curtain; `app.ts` goTo walks only when no curtain is up.
- `course/dictation.ts`: on-device speech recognition button.
- `course/expedition.ts`: end/remove actions, confirm dialog, archive run lines.
- `course/soundtrack.ts`: scene music, tier-matched combat tracks, music toggle.
- `course/Upload.ts`, `Menu.ts`, `Results.ts`, `Settings.ts`, `settings-view.ts`, `help.ts`.
- `../../shared/src/api-client.ts`: the API client, imported directly. `course/mock.ts`: practice API.
- `media/game.css`, `media/font.css` (Silkscreen, OFL in `OFL-Silkscreen.txt`).

## Missing or simplified

Native `smoke` fails at course/ui.ts:2 (`document` undefined): the headless simulator has no DOM.
Dictation was verified with a sample clip as the microphone (no live voice test). Hosted Phaser operations need an owner-linked build; local preview works. No new debug cheats.
