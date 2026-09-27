# Persistent Demo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent in-memory demo data source with realistic provider-branded models, anonymized projects, a rolling deterministic two-year history, and a `npm run dev:mock` command that always forces demo mode.

**Architecture:** Keep the existing Tauri API as the real data source and add a frontend `DataSource` boundary exposing sessions, rates, and cost summaries. The demo source generates a complete snapshot in memory from a date-derived seed; `localStorage` selects the source in the packaged app, while `VITE_OPENCODE_MOCK=true` overrides the selection and forces demo mode.

**Tech Stack:** React 19, TypeScript strict mode, Vite, Vitest, Tauri 2 API, existing `SessionRecord`/`RateEntry`/`CostSummary` DTOs.

---

## Files and Responsibilities

- Create `src/demo/catalog.ts`: real provider/model names and current pricing constants.
- Create `src/demo/generator.ts`: deterministic two-year session and aggregate generator.
- Create `src/demo/generator.test.ts`: generator invariants and cost/provenance tests.
- Create `src/data-source.ts`: `real`/`demo` selection, persistence, and source interface.
- Create `src/data-source.test.ts`: storage, environment override, and source dispatch tests.
- Modify `src/App.tsx`: load data through the selected source, react to mode changes, and expose demo state.
- Modify `src/components/SettingsModal.tsx`: add the accessible persistent mode toggle.
- Modify `src/components/RatesModal.tsx`: consume the selected source instead of importing real API functions directly.
- Modify `src/mock/tauri-mock.ts`: remove the old static business fixtures and retain only settings/path command behavior required by the browser shell.
- Modify `src/index.css`: style the persistent demo banner and the settings mode control if existing styles are insufficient.
- Modify `src/App.test.tsx` or the existing frontend test locations: cover the visible toggle/banner behavior if the current test setup supports component rendering.

### Task 1: Demo Catalog and Deterministic Generator

**Files:**
- Create: `src/demo/catalog.ts`
- Create: `src/demo/generator.ts`
- Create: `src/demo/generator.test.ts`

- [ ] **Step 1: Define the real provider catalog and exact rates**

Export a typed catalog containing these entries, with amounts in dollars per million tokens:

```ts
export interface DemoModelPricing {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const DEMO_PRICING: DemoModelPricing[] = [
  { provider: "Anthropic", model: "claude-sonnet-4-6", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { provider: "Anthropic", model: "claude-haiku-4-5", input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { provider: "OpenAI", model: "gpt-5.4", input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  { provider: "OpenAI", model: "gpt-5.4-mini", input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  { provider: "OpenAI", model: "gpt-4.1", input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  { provider: "Mistral", model: "mistral-medium-3.5", input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
  { provider: "Mistral", model: "mistral-small-4", input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
  { provider: "Mistral", model: "codestral", input: 0.3, output: 0.9, cacheRead: 0.03, cacheWrite: 0 },
];
```

Export the configured entries as `RateEntry[]` for the Rates window. A separate current-pricing history catalog may contain real provider/model pairs absent from that `RateEntry[]` list so `stored` provenance remains demonstrable; it must not represent historical price changes. Keep both catalogs independent from the old `tauri-mock.ts` fixtures so no real project/path data can leak into demo mode.

- [ ] **Step 2: Add a deterministic pseudo-random generator**

Implement a small seeded generator without external dependencies:

```ts
export function createSeededRandom(seed: number): () => number;
export function dateSeed(referenceDate: number): number;
```

Normalize the reference date to UTC calendar-day precision before deriving the seed. The same UTC day must produce the same sequence, and adjacent days must normally produce different sequences.

- [ ] **Step 3: Add the cost and token helpers**

Implement helpers with explicit numeric behavior:

```ts
export function calculateDemoCost(tokens: Tokens, pricing: DemoModelPricing): number;
export function sumTokens(tokens: Tokens[]): Tokens;
export function roundCurrency(value: number): number;
```

Use input, output, cache read, cache write, and reasoning at the same per-million rate conventions as `src-tauri/src/cost.rs`; reasoning uses the output rate. Round only final displayed/stored monetary values, not each token component, and prevent negative or non-finite values.

- [ ] **Step 4: Write failing generator invariant tests**

Add tests for `generateDemoSnapshot(referenceDate)` that assert:

```ts
expect(snapshot.sessions.length).toBeGreaterThan(100);
expect(snapshot.sessions.every(s => s.date >= from && s.date <= referenceDate)).toBe(true);
expect(snapshot.sessions.some(s => s.source === "configured")).toBe(true);
expect(snapshot.sessions.some(s => s.source === "stored")).toBe(true);
expect(snapshot.sessions.some(s => s.models.length > 1)).toBe(true);
expect(snapshot.sessions.some(s => s.isSubagent && s.parentId !== null)).toBe(true);
expect(generateDemoSnapshot(day).sessions).toEqual(generateDemoSnapshot(day).sessions);
expect(generateDemoSnapshot(day).sessions).not.toEqual(generateDemoSnapshot(nextDay).sessions);
```

Also assert every provider/model pair belongs to `DEMO_PRICING`, every project is fictitious, and no project contains a local path prefix such as `/Users/`, `/home/`, `C:/`, or a known workspace name.

- [ ] **Step 5: Implement the snapshot generator**

Export:

```ts
export interface DemoSnapshot {
  sessions: SessionRecord[];
  rates: RateEntry[];
  costSummary: CostSummary[];
}

export function generateDemoSnapshot(referenceDate: number = Date.now()): DemoSnapshot;
```

Generate several fictional projects such as `Atlas Console`, `Nebula Ledger`, `Orchid CLI`, and `Signal Workshop`. Use fictional relative-looking paths such as `/demo/atlas-console`, never user paths. Vary weekly activity, include quiet weeks, generate short and long sessions, and guarantee at least one configured-only session, stored-only session, mixed session, zero-cost session, and parent/child pair. Use current fixed rates for both configured and history-only model catalogs; do not simulate price changes.

For each session, build model-level tokens and costs first, derive the session totals from those models, and mark a session `stored` if at least one model is stored. Build `CostSummary` from positive stored costs only, mark `configured` based on the catalog pair, and keep the total represented by sessions and summary numerically consistent.

- [ ] **Step 6: Run generator tests**

Run: `npm test -- src/demo/generator.test.ts`

Expected: all generator tests pass, with no access to Tauri or browser globals.

### Task 2: Data Source Selection and Persistence

**Files:**
- Create: `src/data-source.ts`
- Create: `src/data-source.test.ts`

- [ ] **Step 1: Define the source interface and mode type**

Add:

```ts
export type DataMode = "real" | "demo";

export interface AppDataSource {
  getData(): Promise<SessionRecord[]>;
  getRates(): Promise<RateEntry[]>;
  getCostSummary(): Promise<CostSummary[]>;
}
```

- [ ] **Step 2: Implement persistent mode resolution**

Use a named storage key such as `opencode-costs-viewer:data-mode`. Export pure functions:

```ts
export function readDataMode(storage?: Storage): DataMode;
export function writeDataMode(mode: DataMode, storage?: Storage): void;
export function isMockBuild(): boolean;
export function resolveDataMode(storage?: Storage): DataMode;
```

`readDataMode` returns `real` for missing or invalid values. `resolveDataMode` returns `demo` when `import.meta.env.VITE_OPENCODE_MOCK === "true"`, otherwise the persisted value.

- [ ] **Step 3: Implement source dispatch**

Export `createDataSource(mode: DataMode, referenceDate?: number): AppDataSource`. The real implementation delegates to `getData`, `getRates`, and `getCostSummary` from `src/api.ts`; the demo implementation returns the generated snapshot and never imports or calls those functions.

- [ ] **Step 4: Test persistence and dispatch**

Test missing storage, invalid storage, read/write round trips, mock-build override, real API delegation, demo API non-invocation, and a stable demo snapshot for an injected reference date. Use mocked API functions or dependency injection so these tests never require Tauri.

- [ ] **Step 5: Run source tests and typecheck**

Run: `npm test -- src/data-source.test.ts`

Run: `npm run build`

Expected: source tests pass and TypeScript compilation succeeds.

### Task 3: Application and Settings Integration

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/components/RatesModal.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Load all dashboard data through one selected source**

In `App.tsx`, resolve the initial mode before loading dashboard data, create the corresponding `AppDataSource`, and load sessions, rates, and cost summary through that source. Keep settings/path persistence on the existing Tauri API. Do not call `getData` directly from `App.tsx` after this change.

- [ ] **Step 2: Add mode state and immediate reload**

Pass `dataMode` and an `onDataModeChange` callback to `SettingsModal`. On change, persist the mode, replace the source, reload all data, reset filters to the new data's default range, and close the modal after the new snapshot is ready. Ensure changing to `real` reuses the existing Tauri calls and changing to `demo` does not call SQLite data commands.

- [ ] **Step 3: Add the accessible settings control**

Add a labeled switch or radio group to `SettingsModal` with the exact user-facing states `Mode réel — données de opencode.db` and `Mode démo — données générées en mémoire`. The control must expose its state through a native checkbox/radio semantics, have a programmatic label, remain usable with keyboard navigation, and not alter `dbPath` or `configPath`.

- [ ] **Step 4: Make RatesModal consume the selected source**

Replace its direct imports of `getRates` and `getCostSummary` with an `AppDataSource` prop supplied by `App`. Preserve the existing independent loading/error states, focus trap, captions, and overlap messaging. In demo mode, the rates table must show the real provider/model catalog and the historical section must show generated stored costs rather than the old mock fixtures.

- [ ] **Step 5: Make the banner reflect the effective mode**

Change the banner condition from the build flag alone to the effective `dataMode`. Keep the mock-build text and add the same banner when the packaged application has persistent demo mode enabled. Do not render it in effective real mode.

- [ ] **Step 6: Add or update styles and UI tests**

Keep the existing high-contrast banner and add only the minimal spacing/description styles needed for the settings control. Test the settings label, mode persistence callback, effective banner visibility, and that the rates window receives the selected source.

### Task 4: Mock Command and Fixture Cleanup

**Files:**
- Modify: `src/mock/tauri-mock.ts`
- Modify: `vite.config.mock.ts` only if the existing environment injection needs a named constant
- Modify: existing mock/browser tests

- [ ] **Step 1: Remove real-looking project and provider fixtures**

Delete the static `Keolis`, `VendeeEau`, `Convivio`, `ado-mcp`, `Audit_RGAA`, `Hub`, `PocMaxime`, `llmproxy`, `openrama`, and user-path values from the mock business data. Retain only the mock implementations needed for settings, paths, and non-data Tauri commands.

- [ ] **Step 2: Verify `dev:mock` forces demo mode**

Start with `npm run dev:mock`, inspect the application through the browser MCP, and verify the banner, real provider brands, fictional projects, two-year range, rates, KPI source split, and session badges. Confirm that changing the persisted local storage value to `real` does not disable demo mode in this command.

- [ ] **Step 3: Verify packaged/default behavior remains real**

Run the frontend build and inspect the generated bundle for the demo banner behavior: the demo generator may be bundled, but effective mode must default to real when the mock environment variable is absent and no persisted mode exists.

### Task 5: Final Verification

**Files:**
- No new implementation files.

- [ ] **Step 1: Run all frontend tests**

Run: `npm test`

Expected: all existing provenance/rates tests and new demo/source tests pass.

- [ ] **Step 2: Run the frontend build**

Run: `npm run build`

Expected: exit code 0. The existing Vite warning about a chunk larger than 500 kB is acceptable if no new TypeScript or build error is emitted.

- [ ] **Step 3: Check the diff**

Run: `git diff --check`

Expected: no whitespace errors. Do not modify or revert unrelated existing worktree changes.

- [ ] **Step 4: Run backend regression tests**

Run: `cd src-tauri && cargo test`

Expected: all existing Rust, integration, and available acceptance tests pass; no backend behavior or cost calculation is changed by the demo source.

- [ ] **Step 5: Run the browser acceptance scenario**

Run: `npm run dev:mock`, open the local mock URL, verify the demo banner and fictional projects, toggle between demo/real in settings, reopen the app state, and verify the rates modal, KPI split, filters, sub-agents, and provenance badges.

- [ ] **Step 6: Do not commit unless explicitly requested**

Leave the worktree changes available for user review. No commit, worktree, reset, or checkout operation is part of this task.
