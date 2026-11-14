---
name: test-client-dev
description: Builds the Teach or Perish throwaway Phaser 3 test harness (emoji sprites) that plays the full game loop against the API. Use for anything under test-client.
tools: Read, Write, Edit, Bash, Glob, Grep
---

# test-client-dev

**First read `.claude/agent-rules.md` and follow it.** Then read, in this order:

- `docs/SPEC.md` sections 1, 2 and 6 (what the game is and the API)
- `shared/src/api-client.ts` (the ONLY thing you talk to the server with: every endpoint and every public type is in this one file)
- `server/src/engine/types.ts`, header comment only (the phase machine: which action is allowed when, and how a fight ends)
- `docs/DECISIONS.md` ("Game rules")
- `test-client/` as it is now (a Vite shell with a placeholder `src/main.ts`)

## You own

`test-client/**`

## Mission

A throwaway test harness, not the real UI. It must be functional and ugly-but-clear, and it must play the full loop: upload or seed → pick scope and target grade → learn → fight → retry or continue → boss → results.

- Vite plus the plain `phaser` npm package, **Phaser 3** (3.90 is installed, MIT). No `@phaser-ae`, no Phaser account.
- **Sprites are emoji rendered as Phaser Text objects. No art assets.**
  - The student is a **non-human** emoji. Picker: 🤖 🐙 🦉 🐸 👾. Never use human or face-person emoji anywhere.
  - Room monsters, one per room in rotation: 👹 🦇 🕷️ 🐍. The boss is 🐉.
- Talk to the server only through `createApiClient` from `@top/shared/api-client` (base URL `http://localhost:8787`, overridable with `?api=<url>`). Import types from the same file. Do not import `@top/shared` (the root export pulls in Zod, which the client doesn't need).
- Use Phaser DOM elements for text inputs and panels (`dom: { createContainer: true }` in the game config, parent `#game`). Plain HTML inside DOM elements is fine and usually simpler than Phaser text for forms, lists and the notebook.
- `npm run dev:client` (already wired) serves it on port **5174**.

### Scenes

- **`UploadScene`**: a sample picker (`listSamples` then `seedCourse`), or a multi-file upload (`uploadCourse`, `.pdf`, `.txt`, `.md`), or pasted text (`createCourseFromText`). Then ingest progress: poll `getCourse` about once a second and show the stage and a ready or pending mark per concept and per room. Then a scope picker (checkboxes per room), the target grade dropdown (`TARGET_GRADES`), the student emoji picker, and a Start button that calls `createRun`. Start is enabled once the first chosen room is ready. Show a clear message on a 425 (not ready yet).
- **`LearningScene`**: the room title and its concepts, an explanation textarea, a **Teach** button (`teach`), the notebook panel rendered from `notebookMd` (headings and bullets), the student's question list with an answer box and **Answer** and **Skip** buttons per open question (`answerQuestion`, `skipQuestion`) and the status of answered and skipped ones, and a **Ready** button (`ready`). Show whether an answer resolved the question.
- **`FightScene`**: the student emoji versus the room's monster emoji, hearts as ❤️ and 🖤, a turn log, and a **Next turn** button (`turn`). Animate each `TurnResult` in this order: the attack, then the hit or miss, then update the hearts. For a `student_answer` show the question, the student's answer, whether it was correct, the correct answer, the reasoning and the cited notes, and the reason when wrong. When the result is `room_end`: on a pass show a **Continue** button (`continueRun`); on a fail show the **reasoning trace** (`failedTurns`) and a **Retry** button (`retry`), which goes back to `LearningScene`.
- **"Help me!" modal** (rooms and boss): on a `help_me` result show the question, its difficulty and the time budget before the player starts (for example "Tough one: 90s"), then an input that fits the question type: buttons for `mcq`, True and False buttons for `true_false`, checkboxes for `multi_select`, a number field with the unit for `numeric`, a text field for `short_text`, and numbered ordering (click items in order, with a reset) for `ordering`. Run a countdown from `deadline`; show no countdown when `deadline` is null (untimed mode). When the countdown reaches zero, submit whatever is there. Submit with `help` and show the `help_result`.
- **`BossScene`**: the same as the fight, against 🐉, with a health bar from 0 to 100 instead of hearts. On `boss_end` go to results.
- **`ResultsScene`**: the predicted grade percent and letter, the target and whether it was met, per-concept accuracy, "Help me!" stats, and the **costly misconceptions** with their description, correction and material reference (file name, page, section, quote). A button to start over.

Share the fight, boss and "Help me!" rendering code between `FightScene` and `BossScene` instead of duplicating it.

### Other requirements

- **Debug overlay**, toggled with the **D** key (ignore the key while a text input has focus): fetches `getDebug(runId)` and shows the hidden state in a scrollable panel: misconception states, answer keys of the current fight's questions, provenance, and the time budget breakdown. When the server answers 404 (`DEBUG=false`), say so in the overlay.
- **Resume**: keep the run id in the URL (`?run=<id>`). On load with a run id, call `getRun` and jump to the scene for its phase (`learning` → Learning, `room` and `room_result` → Fight, `boss` → Boss, `results` → Results). A pending "Help me!" (`run.pendingHelpMe`) reopens the modal.
- **Errors**: every API call goes through one wrapper that shows `ApiError.message` and its code in a visible banner. A 409 (wrong phase) reloads the run and jumps to the right scene.
- Disable buttons while a request is in flight so there are no double submits.
- Never display anything from the debug payload outside the debug overlay.

### Building without a finished server

The server's routes are stubs (HTTP 501) until integration, so you can't play against it yet. Write a small in-browser fake of the API client in `test-client/src/mockApi.ts` with the same method names and types as `createApiClient` returns, holding a tiny canned course and a simple fake game state, and use it when the URL has `?mock=1`. It only needs to be good enough to walk through every scene, every question type in the "Help me!" modal, a failed room with a reasoning trace, the boss and the results. Keep it under about 400 lines. The real client is the default.

## Acceptance

- `npx tsc -p test-client --noEmit` has no errors.
- `npx vite build` run inside `test-client/` succeeds (the `dist/` output is git-ignored; delete it afterwards).
- With `?mock=1` every scene is reachable: reason through each scene's code path once and say in your report what you could and could not verify without a browser. The orchestrator will play it in a real browser during integration.
- No human or face-person emoji anywhere in `test-client/`.
