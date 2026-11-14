# Rules for every Pip's Notebook subagent

Repo root: `.`. All paths in your brief are relative to it.

This is a 36-hour hackathon build. Working beats elegant. Write simple, readable code: short functions, plain names, a comment where something is not obvious. No abstractions beyond the interfaces you are given.

## Hard rules

1. **Edit only the paths your brief says you own.** Everything else is read-only for you, in particular:
   - `pips-notebook/` is a teammate's game. Never edit, install, build or run anything inside it.
   - `shared/`, `docs/`, every `package.json`, the root config files, and these orchestrator-owned server files: every `types.ts` interface file, `server/src/core/**`, `server/src/config.ts`, `server/src/errors.ts`, `server/src/app.ts`, `server/src/routes.ts`, `server/src/container.ts`, `server/src/index.ts`, `server/src/services/**`.
   - If you need a change in a file you don't own, do not make it. Describe the exact diff in your final report.
2. **No git state changes.** Don't commit, stash, reset, checkout or switch branches. `git status` and `git diff` are fine. The orchestrator commits.
3. **No installs.** Don't run `npm install` or add dependencies. Installed already: `fastify` 5, `@fastify/multipart` 10, `@fastify/cors` 11, `zod` 3.25, `zod-to-json-schema` 3.25, `@google/genai` 3.3, `mongodb` 7.9, `unpdf` 2.1, `dotenv`, `pdf-lib` (tests only), `vitest` 5, `tsx`, `typescript` 5.9. If you truly need another package, say so in your report and work without it.
4. **Never write a secret** into any file. Keys are read only through `Config` (`server/src/config.ts`).

## Working alongside the other subagents

Five other subagents are editing other folders of this repo right now. Their modules may not exist yet or may be half-written while you work.

- Code against the interface files (`types.ts`) and the factory names listed at the top of each one. Those names and paths are fixed.
- In your own unit tests, use small fakes of other modules' interfaces unless your brief says otherwise.
- `npm run typecheck` checks the whole repo and may show errors in folders that aren't yours. Only errors in your own paths are your problem. To check just your files, read the output and filter by path.
- Run your tests with `npx vitest run <your folder>` from the repo root. The root Vitest config picks up `server/**/*.test.ts` and `scripts/**/*.test.ts`.

## Code conventions

- TypeScript, ESM, `strict`. Relative imports are extensionless (`./foo`). Shared schemas and types come from `@pips-notebook/shared`.
- Run TypeScript with `npx tsx <file>`. There is no build step.
- Zod is version 3: `import { z } from 'zod'`.
- Errors that should reach the client are `AppError` from `server/src/errors.ts`. Use the codes listed there.
- Several installed libraries are newer than you may remember (`@google/genai` 3.x, `mongodb` 7.x, `unpdf` 2.x, `vitest` 5, `fastify` 5). Before using an API from one of them, read its type definitions or README under `node_modules/`. Don't rely on memory.
- There is **no Gemini API key and no MongoDB URI** in this environment. Code that talks to Gemini or Atlas can't be run live here: write it carefully against the installed SDK's types and unit-test it with fakes.

## Final report

End with a report in exactly this shape:

```
## Files
<every file you created or changed, one line each with what it is>

## How to run
<commands>

## Tests
<the command you ran, and the pass/fail counts from its real output>

## Assumptions
<choices you made where the spec was open>

## Proposed contract changes
<exact diffs for files you don't own, or "none">

## Not done / known issues
<anything unfinished, untested or risky, or "none">
```

Report honestly. If something is untested or failing, say so with the output.
