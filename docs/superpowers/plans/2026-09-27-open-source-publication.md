# Open Source Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the current application as an English-first MIT open-source project with a clean one-commit history and no existing GitHub releases or tags.

**Architecture:** Keep the application behavior and file layout intact. Update only licensing metadata, bilingual documentation, source comments, and the runtime language fallback, then validate before replacing local and remote Git history.

**Tech Stack:** React 19, TypeScript, Vite, Tauri 2, Rust, npm, Cargo, Git, GitHub CLI/API.

---

### Task 1: Add MIT licensing metadata

**Files:**
- Create: `LICENSE`
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Regenerated: `package-lock.json` only if npm metadata requires it

- [ ] **Step 1: Add the standard MIT license text**

Create `LICENSE` with the standard MIT text, using the project copyright holder and year already established by the repository owner.

- [ ] **Step 2: Declare MIT in package manifests**

Add the JSON field `"license": "MIT"` to `package.json` and the TOML field `license = "MIT"` under `[package]` in `src-tauri/Cargo.toml`. Do not alter dependency license entries in `package-lock.json`.

- [ ] **Step 3: Validate metadata and whitespace**

Run:

```sh
npm pkg get license
cargo metadata --manifest-path src-tauri/Cargo.toml --no-deps --format-version 1
git diff --check
```

Expected: npm reports `MIT`, Cargo metadata reports `license: MIT`, and `git diff --check` reports no errors.

### Task 2: Create bilingual documentation

**Files:**
- Replace: `README.md`
- Create: `README.fr.md`

- [ ] **Step 1: Translate the canonical README to English**

Rewrite `README.md` in English while retaining the current sections and concrete commands: features, prerequisites, installation, development, platform builds, GitHub releases, pricing catalog, configuration, tests, and structure. Add a language link to `README.fr.md` near the title.

- [ ] **Step 2: Preserve the French documentation as a translation**

Create `README.fr.md` from the existing French content, correcting wording only as needed for consistency with the English document. Add a link to `README.md` near the title.

- [ ] **Step 3: Check documentation parity**

Verify manually that both documents describe the same commands, supported platforms, default paths, test commands, and release behavior. Search both files for the reciprocal links and for accidental untranslated French in `README.md`.

### Task 3: Make runtime language behavior English-first

**Files:**
- Modify: `src/i18n/locale.ts`
- Modify: `src/i18n/config.ts` only if the existing initialization does not expose the English default clearly
- Test: `src/i18n/config.test.ts`
- Test: `src/i18n/resources.test.ts` if resource completeness assertions require updates

- [ ] **Step 1: Add or update fallback tests**

Cover these cases in the existing locale/config tests: no browser language selects `en`, malformed language selects `en`, unsupported language such as `de-DE` selects `en`, and `fr-FR` still selects `fr`.

- [ ] **Step 2: Implement the minimal fallback change**

Keep `supportedLanguages` as `fr` and `en`. Ensure `normalizeLanguage()` and `detectSystemLanguage()` return `en` for missing, invalid, and unsupported values, while preserving the existing French prefix match.

- [ ] **Step 3: Run focused tests**

Run:

```sh
npm test -- src/i18n/config.test.ts src/i18n/resources.test.ts
```

Expected: all focused i18n tests pass.

### Task 4: Translate source comments to English

**Files:**
- Modify all source/configuration files containing French explanatory comments under `src/`, `src-tauri/`, and root build/test configuration files.

- [ ] **Step 1: Inventory comments before editing**

Search comments with:

```sh
rg -n --glob '*.{ts,tsx,rs,css,html,jsonc,yml,yaml,toml}' '//|/\\*|\\*/|<!--|^\s*#' .
```

Classify matches as explanatory comments, compiler/test directives, URLs, or fixture content.

- [ ] **Step 2: Translate only explanatory comments**

Translate French comments such as module descriptions, algorithm explanations, and Rust doc comments into concise English. Preserve `@vitest-environment`, `@ts-expect-error`, TypeScript references, URLs, mathematical examples, JSONC fixture comments used by tests, and all string literals.

- [ ] **Step 3: Check for remaining French comments**

Run a targeted search for common French comment words and manually inspect every match. Do not change French UI resources or README.fr.md.

### Task 5: Validate the application changes

**Files:**
- No additional files unless tests expose a required correction.

- [ ] **Step 1: Run the frontend build**

Run:

```sh
npm run build
```

Expected: TypeScript and Vite complete successfully.

- [ ] **Step 2: Run frontend unit tests**

Run:

```sh
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 3: Run E2E tests when prerequisites are available**

Run:

```sh
npm run test:e2e
```

Expected: all Playwright scenarios pass. If the local browser dependency is missing, install/use the repository's documented prerequisite and rerun; do not substitute a Rust test because the repository's validation policy prioritizes E2E for frontend changes.

- [ ] **Step 4: Inspect the final pre-history diff**

Run:

```sh
git status --short
```

Expected: only the planned license, metadata, README, locale, comment, and plan/spec files are changed, with no whitespace errors.

### Task 6: Replace local history with one initial commit

**Files:**
- No source files; Git references only.

- [ ] **Step 1: Stage the complete final tree**

Run `git add -A`, then inspect `git diff --cached --stat` and `git diff --cached --check`. Confirm that no secrets, build outputs, or generated dependencies are staged.

- [ ] **Step 2: Create the new root commit**

Create one commit on `main` with a message such as:

```sh
git commit -m "chore: publish project as open source"
```

- [ ] **Step 3: Remove local tags**

List tags with `git tag --list`, then delete every listed local tag. Confirm `git tag --list` returns no output.

### Task 7: Rewrite GitHub and remove releases

**Files:**
- No source files; remote GitHub refs and releases only.

- [ ] **Step 1: Enumerate remote releases and tags**

Use GitHub CLI against `tblion/OpencodeCostsViewer` to list releases and tags before deletion. Confirm the target repository and record the identifiers.

- [ ] **Step 2: Delete all GitHub releases**

Delete every release through `gh release delete <tag> --repo tblion/OpencodeCostsViewer --yes`. If a release has a corresponding tag, delete the release first.

- [ ] **Step 3: Force-push the new main history**

Run:

```sh
git push --force origin main
```

Expected: remote `main` points to the new single initial commit.

- [ ] **Step 4: Delete all remote tags**

Run `git ls-remote --tags origin`, then delete each remote tag with `git push origin --delete <tag>`. Confirm no tags remain remotely.

- [ ] **Step 5: Verify the public state**

Run:

```sh
git status --short
```

Expected: one commit on the relevant branches, no local or remote tags, no GitHub releases, and a clean working tree.

### Task 8: Final verification and backup confirmation

- [ ] **Step 1: Re-run lightweight checks**

Run `git bundle create` against the final repository, `git bundle verify`, `npm run build`, and the focused locale tests. This confirms the rewritten repository remains recoverable and buildable.

- [ ] **Step 2: Report exact outcomes**

Report the final commit hash, the backup path, build/test results, and the verified absence of releases and tags. Explicitly mention any validation command that could not run and why.
