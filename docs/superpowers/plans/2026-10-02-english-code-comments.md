# English Comments and Headers Implementation Plan

> **For agentic workers:** Execute this plan inline in the current workspace. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish English-only explanatory comments and concise purpose headers across supported maintained textual project files.

**Architecture:** This is a documentation-only pass. Inspect each eligible file, add a concise purpose header using its native syntax, and add explanatory comments only for non-obvious behavior. Keep unsupported data formats, generated files, dependencies, lockfiles, binaries, and build output untouched.

**Tech Stack:** Markdown, TypeScript/TSX, CSS, JavaScript/ESM, C#, HTML, JSONC, SQL, YAML, shell/scripts.

---

## File Groups

- `AGENTS.md`: update repository conventions; preserve all current user edits and instructions.
- `src/`: renderer, app hooks, components, tests, fixtures and styles.
- `electron/`: Electron main/preload/process and Vite configuration source.
- `src-dotnet/`: backend application, protocol, infrastructure, models and packaging probe source.
- `e2e/`: Playwright specs, fixtures and helper scripts.
- Root maintained text configs, `.github/workflows/`, and `scripts/`: inspect supported formats and annotate only where meaningful.
- Exclude JSON/JSONC data fixtures and catalogs, package lockfiles, generated `obj/` output, binaries, dependency files, and build artifacts.

## Task 1: Record the convention

**Files:**
- Modify: `AGENTS.md`

- [x] Add explicit rules: code and comments are English; each maintained source/config file should have a short purpose header when its syntax supports comments; inline comments should explain non-obvious intent and must not merely repeat code; never inject comments into strict data formats or generated artifacts.
- [x] Preserve the file's existing project guidance and all user changes unrelated to the convention.
- [x] Inspect `git diff -- AGENTS.md` and confirm the final file retains current user-provided content.

## Task 2: Annotate renderer and tests

**Files:**
- Modify eligible files under `src/`, including `.ts`, `.tsx`, `.css`, `.d.ts`.
- Exclude `src/fixtures/**/*.json`, `src/fixtures/**/*.jsonc`, and generated/binary files.

- [x] Inspect each eligible file and add a one-line purpose header with valid TypeScript/TSX or CSS comment syntax.
- [x] Add targeted English inline comments only where a constraint or intent is not evident from the code.
- [x] Do not add comments to JSON fixtures or alter UI copy, behavior, or tests.
- [x] Review representative and final diffs for accurate descriptions and clean placement before imports/directives where syntax requires.

## Task 3: Annotate Electron sources

**Files:**
- Modify eligible source/config files under `electron/` (`.ts`, `.js`, `.mjs`, `.cjs`).

- [x] Add concise purpose headers using JavaScript/TypeScript comments.
- [x] Add inline comments only for non-obvious process, IPC, protocol, or security constraints.
- [x] Leave generated outputs and configuration formats without comment support untouched.

## Task 4: Annotate .NET backend sources

**Files:**
- Modify maintained `.cs` files under `src-dotnet/`, including `PackagingProbe/Program.cs`.

- [x] Add concise file-purpose comments in English, respecting file-scoped namespace and using-directive placement conventions.
- [x] Add inline comments only to clarify non-obvious domain rules or platform constraints.
- [x] Leave JSON catalogs and generated `obj/` files unmodified; annotate maintained XML project files because their format supports comments.

## Task 5: Annotate E2E and root text sources

**Files:**
- Modify eligible `.ts`, `.mjs`, `.js`, `.sql`, `.jsonc`, `.yml`, `.yaml`, `.css`, `.html`, and shell source files under `e2e/` and the repository root.
- Exclude strict JSON, lockfiles, generated files, and binary assets.

- [x] Add concise purpose headers where each file format supports comments (including HTML comments in `index.html` and YAML comments in maintained workflows and packaging configs).
- [x] Do not alter E2E scenario behavior or fixture data.
- [x] Leave Markdown prose files, strict JSON, and data fixtures untouched; retain valid syntax in JSONC where comments are already supported.

## Task 6: Validate the pass

**Files:**
- Review all changed files.

- [x] Run `git diff --check` and confirm no whitespace errors.
- [x] Run `npm run build` and confirm the renderer build succeeds.
- [x] Run browser and Electron Playwright E2E scenarios; all 14 scenarios pass, including a Release backend build.
- [x] Review `git status --short` and `git diff --stat` to confirm intended source/docs changes and preservation of user-owned pre-existing changes.
- [x] Review comments for English wording, correctness, non-redundancy, supported-format validity, and absence of behavior changes.
