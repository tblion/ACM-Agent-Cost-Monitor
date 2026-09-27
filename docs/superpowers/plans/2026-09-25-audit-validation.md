# Audit Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the cost algorithms and displayed results against a fixed, manually verified OpenCode dataset.

**Architecture:** Add a Rust audit pipeline that reads source rows, resolves the effective rate, exposes a component-level cost proof, and compares its output with a checked-in golden fixture. Add a dedicated React audit view that renders and exports the last successful backend report, with a deterministic mock and MCP Chrome verification.

**Tech Stack:** Rust, Tauri 2, rusqlite, serde, React 19, TypeScript, Vitest, Vite, MCP Chrome.

---

## File Map

- Create `src-tauri/src/audit.rs` for report construction, anomalies, cost proofs, and invariants.
- Create `src-tauri/tests/fixtures/audit/reference.sql` for deterministic source rows.
- Create `src-tauri/tests/fixtures/audit/reference-config.jsonc` for custom rates.
- Create `src-tauri/tests/fixtures/audit/reference-catalog.json` for historical rates.
- Create `src-tauri/tests/fixtures/audit/reference-expected.json` for hand-calculated expected output.
- Create `src/lib/audit-export.ts` for JSON/CSV serialization.
- Create `src/lib/audit-export.test.ts` for export behavior.
- Create `src/components/AuditView.tsx` and `src/components/AuditView.test.tsx` for the dedicated UI.
- Modify `src-tauri/src/cost.rs` for component-level cost breakdowns.
- Modify `src-tauri/src/aggregate.rs` for rate provenance.
- Modify `src-tauri/src/db.rs` for message identity and audit counters.
- Modify `src-tauri/src/model.rs` for serialized audit contracts.
- Modify `src-tauri/src/commands.rs` for audit and export commands.
- Modify `src-tauri/tests/acceptance_test.rs` for exact identity comparisons.
- Modify `src/types.ts`, `src/api.ts`, `src/data-source.ts`, `src/demo/generator.ts`, `src/mock/tauri-mock.ts`, and `src/App.tsx` for the frontend contract and navigation.
- Modify `src/components/Header.tsx`, `src/i18n/resources.ts`, `src/App.css`, and `src/index.css` for navigation, translations, and accessible presentation.

## Task 1: Add Component-Level Cost Proof

**Files:**
- Modify `src-tauri/src/cost.rs`.
- Modify `src-tauri/src/model.rs` because the component breakdown is part of the serialized audit report.
- Test in `src-tauri/src/cost.rs` module tests.

- [ ] **Step 1: Write the failing breakdown test.**

Add a test that calls a new `message_cost_breakdown` function with one million tokens in every component and rates `input=2.0`, `output=8.0`, `cache_read=0.2`, `cache_write=2.5`. Assert:

```rust
assert_eq!(breakdown.input, 2.0);
assert_eq!(breakdown.output, 8.0);
assert_eq!(breakdown.cache_read, 0.2);
assert_eq!(breakdown.cache_write, 2.5);
assert_eq!(breakdown.reasoning, 8.0);
assert!((breakdown.total - 20.7).abs() < 1e-9);
```

- [ ] **Step 2: Run the focused test and verify the expected failure.**

Run `cd src-tauri && cargo test cost::tests::full_rate_breakdown -- --exact`.

Expected result: compilation or test failure because `message_cost_breakdown` and its result type do not exist yet.

- [ ] **Step 3: Implement the minimal breakdown.**

Add an internal `CostBreakdown` with `input`, `output`, `cache_read`, `cache_write`, `reasoning`, and `total` fields. Implement `message_cost_breakdown` using the existing per-million formula, with reasoning multiplied by `rate.output`. Make `message_cost` return `message_cost_breakdown(tokens, rate).total` so the existing algorithm has one formula implementation.

- [ ] **Step 4: Run the focused and existing cost tests.**

Run `cd src-tauri && cargo test cost::tests -- --nocapture`.

Expected result: all cost tests pass and the existing `full_rate` result remains `20.7`.

## Task 2: Preserve Source Identity and Rate Provenance

**Files:**
- Modify `src-tauri/src/aggregate.rs`.
- Modify `src-tauri/src/db.rs`.
- Modify existing `src-tauri/src/aggregate.rs` and `src-tauri/tests/pricing_test.rs` fixture row literals to include `message_id`.
- Test in `src-tauri/src/db.rs`, `src-tauri/src/aggregate.rs`, and `src-tauri/tests/pricing_test.rs`.

- [ ] **Step 1: Add failing identity and provenance tests.**

Add `message_id: String` to the expected `RawRow` returned by a temporary SQLite database and assert that `load_rows` returns the SQL `message.id`.

Add a rate provenance test with two catalog rates for the same provider/model and one custom override. Assert that a resolved custom rate reports source `configured` and no `effective_from`, while a catalog rate reports source `catalog` and the selected catalog `effective_from`.

- [ ] **Step 2: Run the focused tests and verify failure.**

Run `cd src-tauri && cargo test db::tests -- --nocapture`, then `cd src-tauri && cargo test aggregate::tests -- --nocapture`, then `cd src-tauri && cargo test --test pricing_test -- --nocapture`.

Expected result: failure because `RawRow` has no message identity and rate resolution returns only a numeric rate.

- [ ] **Step 3: Implement source identity.**

Change the SQL projection in `src-tauri/src/db.rs` to select `m.id` before `m.session_id`, map it into `RawRow.message_id`, and update all Rust row literals and test schemas to provide an `id` column. Add separate read-only helpers for total database sessions and total messages so the audit can distinguish all sessions from sessions with assistant messages.

- [ ] **Step 4: Implement reusable rate provenance.**

Add a resolved-rate structure containing the numeric `Rate`, a source enum/string, and optional catalog `effective_from`. Add a helper used by both aggregation and audit. Preserve the existing precedence: configured override first, applicable catalog rate second, no resolved rate otherwise. Keep `resolve_rate` behavior consistent for existing aggregation callers by deriving the numeric rate from the detailed result.

- [ ] **Step 5: Run backend tests.**

Run `cd src-tauri && cargo test -- --nocapture`.

Expected result: existing aggregation, pricing, database, and read-only tests pass with the new message identity field.

## Task 3: Create the Golden Reference Dataset

**Files:**
- Create `src-tauri/tests/fixtures/audit/reference.sql`.
- Create `src-tauri/tests/fixtures/audit/reference-config.jsonc`.
- Create `src-tauri/tests/fixtures/audit/reference-catalog.json`.
- Create `src-tauri/tests/fixtures/audit/reference-expected.json`.

- [ ] **Step 1: Write the fixed SQL source.**

Use this minimal schema and fixed data shape in `reference.sql`:

```sql
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  directory TEXT NOT NULL,
  title TEXT NOT NULL,
  parent_id TEXT,
  time_created INTEGER NOT NULL
);
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  time_created,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL
);
```

Insert sessions `s-custom`, `s-history`, `s-fallback`, `s-invalid`, `s-parent`, `s-child`, and `s-empty`. Use these exact assistant message cases: `m-custom` with the custom provider and one million tokens in every component; `m-before` with the history provider before the first catalog date and stored cost `4.0`; `m-old` with one million input and output tokens during the old catalog rate and stored cost `99.0`; `m-new` with one million input and output tokens during the new catalog rate and stored cost `99.0`; `m-fallback` with an unknown provider, valid input tokens, and stored cost `4.25`; `m-no-tokens` with no tokens and stored cost `3.5`; `m-no-date` with valid tokens but a non-integer `time_created` and stored cost `6.75`; `m-parent` in `s-parent` with the custom provider and one million input tokens; and `m-child` in `s-child` with `parent_id='s-parent'`, the custom provider, and one million output tokens. Insert one user-role message in `s-custom`; the audit must count it as ignored and never include it as an assistant calculation row.

Use deterministic timestamps and token counts. The custom message must contain one million tokens in each of input, output, cache read, cache write, and reasoning so its hand-calculated total is unambiguous.

- [ ] **Step 2: Write the fixed custom configuration.**

Put one custom entry for provider `fixture-custom` and model `fixture-model` in `reference-config.jsonc`, with rates `2.0`, `8.0`, `0.5`, and `1.5` dollars per million tokens. Include one comment and one trailing comma so the JSONC parser is exercised.

- [ ] **Step 3: Write the fixed historical catalog.**

Put two non-overlapping rates for provider `fixture-history` and model `fixture-model` in `reference-catalog.json`: an old rate effective `2025-01-01T00:00:00Z` with input `1.0` and output `2.0`, and a new rate effective `2026-01-01T00:00:00Z` with input `3.0` and output `4.0`. Set cache rates to zero and use source `fixture`.

- [ ] **Step 4: Write the expected output manually.**

Record expected assistant count `9`, all-session count `7`, sessions-with-assistant count `6`, and ignored-message count `1`. The custom message breakdown is exactly `2.0 + 8.0 + 0.5 + 1.5 + 8.0 = 20.0`; the old catalog message costs `3.0`, the new catalog message costs `7.0`, the parent message costs `2.0`, and the child message costs `8.0`. Record `4.0`, `4.25`, `3.5`, and `6.75` as stored fallbacks for the four non-recalculable messages. Include exact expected rate sources, effective dates, anomaly codes, and session totals for every message. Do not generate this file by calling the application.

- [ ] **Step 5: Verify fixture syntax before implementation.**

Run the existing Rust tests after adding a small fixture parser test, and assert that the JSONC configuration and catalog parse successfully. Expected result: the fixture files parse independently before the audit module exists.

## Task 4: Implement the Audit Report and Invariants

**Files:**
- Create `src-tauri/src/audit.rs`.
- Modify `src-tauri/src/model.rs`.
- Modify `src-tauri/src/lib.rs` to register the module.
- Modify `src-tauri/src/db.rs` only for the independent counters required by the report.
- Test in `src-tauri/tests/audit_test.rs`.

- [ ] **Step 1: Write the failing golden-report integration test.**

Create `src-tauri/tests/audit_test.rs` with helpers that create a temporary SQLite database from `reference.sql`, load `reference-config.jsonc`, load `reference-catalog.json`, and deserialize `reference-expected.json`. Assert that `build_audit_report` serialized as JSON equals the expected report for all stable fields. Assert separately that every fixture assistant message appears once by `messageId`, the user message is counted as ignored, and the session counters distinguish `s-empty`.

- [ ] **Step 2: Run the test and verify it fails for the missing implementation.**

Run `cd src-tauri && cargo test --test audit_test -- --nocapture`.

Expected result: compilation failure because `AuditReport` and `build_audit_report` do not exist.

- [ ] **Step 3: Add serialized audit contracts.**

In `model.rs`, add camelCase serializable types for report metadata, summary counters, message details, rate provenance, component breakdown, anomaly codes, and invariant status. Represent optional calculated values as `Option<f64>` and keep identifiers as strings.

- [ ] **Step 4: Implement report construction.**

In `audit.rs`, accept raw rows, total session/message counters, catalog, and overrides. For every assistant row:

1. validate tokens and date;
2. resolve detailed rate provenance;
3. compute the component breakdown only when tokens and rate are valid;
4. select stored cost when calculation is impossible;
5. attach stable anomalies without hiding the row;
6. accumulate message, session, token, source, and anomaly totals.

Do not call the aggregate output to create expected values. The report must calculate its own message/session totals from its detail rows.

- [ ] **Step 5: Implement calculation invariants.**

Check breakdown-to-message cost, message-to-session cost, message-to-session tokens, and rate provenance precedence using the existing relative floating-point tolerance. Store failed invariant identifiers and mark the report invalid when any invariant fails. Missing-rate and missing-token fallbacks are explicit classified outcomes, not invariant failures.

- [ ] **Step 6: Run the golden test and all backend tests.**

Run `cd src-tauri && cargo test --test audit_test -- --nocapture`, then `cd src-tauri && cargo test -- --nocapture`.

Expected result: the golden report matches the manually authored expected file and the existing suite remains green.

## Task 5: Expose Audit and Exact-Report Export Commands

**Files:**
- Modify `src-tauri/src/commands.rs`.
- Modify `src-tauri/src/main.rs` or `src-tauri/src/lib.rs` where Tauri commands are registered.
- Do not add a command-specific model unless compilation requires a serialized request type; the export command accepts plain content and a suggested filename.
- Test command report construction in `src-tauri/tests/audit_test.rs`.

- [ ] **Step 1: Add the failing command contract test.**

Add a test around the pure command helper that resolves settings, loads the fixture source, and returns an `AuditReport` whose `valid` flag and generated timestamp are populated. Assert that a missing database returns an error and does not produce a replacement report.

- [ ] **Step 2: Implement `get_audit_report`.**

Add a Tauri command that resolves the current database/config paths, loads rows and independent counters read-only, loads custom rates and the embedded catalog, and calls the audit builder. Return the complete report only after successful construction.

- [ ] **Step 3: Implement native exact-report export.**

Add a backend command accepting the already serialized report content and a suggested filename, opens the existing native save dialog, and writes the exact content selected by the frontend. Use separate suggested extensions for JSON and CSV. Cancelled dialogs return `None`, while file-system errors return an error.

- [ ] **Step 4: Register and typecheck the commands.**

Run `cd src-tauri && cargo check` and `cd src-tauri && cargo test -- --nocapture`.

Expected result: commands compile, existing commands remain registered, and no database write occurs.

## Task 6: Add Frontend Contract and Deterministic Export Helpers

**Files:**
- Modify `src/types.ts`.
- Modify `src/api.ts`.
- Modify `src/data-source.ts`.
- Modify `src/demo/generator.ts` and `src/mock/tauri-mock.ts`.
- Create `src/lib/audit-export.ts`.
- Create `src/lib/audit-export.test.ts`.

- [ ] **Step 1: Write failing serialization tests.**

Test a hand-built audit report and assert that JSON serialization preserves the complete report and that CSV serialization emits one header plus one row per message with stable columns for IDs, provider/model, tokens, breakdown, costs, source, rate date, and anomaly codes. Assert escaping for commas, quotes, and newlines.

- [ ] **Step 2: Run the focused frontend tests and verify failure.**

Run `npm test -- src/lib/audit-export.test.ts`.

Expected result: failure because the serialization helpers and audit types do not exist.

- [ ] **Step 3: Add TypeScript audit types and API methods.**

Add camelCase interfaces matching the Rust report and add `getAuditReport()` plus `exportAudit(content, suggestedName)` to `src/api.ts`. Extend `AppDataSource` with the audit method so demo and real modes share one interface.

- [ ] **Step 4: Implement pure JSON/CSV serializers.**

Implement deterministic JSON formatting and CSV escaping in `src/lib/audit-export.ts`. Keep the serializers independent from React and do not recompute any costs in TypeScript.

- [ ] **Step 5: Add deterministic demo/mock data.**

Return the fixed audit report from the mock data source, including the same counters and detail rows used by the frontend tests. Ensure demo mode visibly identifies that the data is fixed and synthetic, not a real `opencode.db`.

- [ ] **Step 6: Run frontend tests and build.**

Run `npm test -- src/lib/audit-export.test.ts` and `npm run build`.

Expected result: serializers pass and TypeScript compilation succeeds.

## Task 7: Build the Dedicated Audit View

**Files:**
- Create `src/components/AuditView.tsx`.
- Create `src/components/AuditView.test.tsx`.
- Modify `src/App.tsx`.
- Modify `src/components/Header.tsx`.
- Modify `src/App.css` and `src/index.css`.
- Modify `src/i18n/resources.ts`.

- [ ] **Step 1: Write failing view tests.**

Test the empty state, refresh button, successful report counters, last-update timestamp, stale indicator, anomaly filter, expandable message detail, invariant failure state, and disabled export before a successful report. Use the fixed mock report and assert visible text and accessible roles rather than implementation details.

- [ ] **Step 2: Run the focused tests and verify failure.**

Run `npm test -- src/components/AuditView.test.tsx`.

Expected result: failure because the view and navigation state do not exist.

- [ ] **Step 3: Implement the dedicated view.**

Create `AuditView` with local report/loading/error/filter/expanded-row state. Refresh only on the explicit button. Keep the last successful report on refresh failure. Render summary cards, anomaly counts, provenance, filtered detail table, cost breakdown, and invariant status.

- [ ] **Step 4: Add app navigation and stale tracking.**

Add a header action and `showAudit` state in `App.tsx`. Lazy-load the audit view like existing modal components. Mark the report stale when normal data/settings update after the last audit, but do not recalculate it automatically. Return to the main dashboard without losing the last report in the current app session.

- [ ] **Step 5: Add accessible translations and styles.**

Add French and English strings for every label, anomaly, source, state, action, and error. Use real buttons, table captions/headers, `aria-live` for refresh status, `role="alert"` for errors, visible focus states, and responsive tables/details on narrow screens.

- [ ] **Step 6: Implement export actions.**

Serialize the in-memory last successful report, call the native export command, and never call `getAuditReport` as part of exporting. Disable export while no successful report exists or while a save operation is active.

- [ ] **Step 7: Run frontend tests and build.**

Run `npm test -- src/components/AuditView.test.tsx src/lib/audit-export.test.ts` and `npm run build`.

Expected result: the dedicated view tests pass and the frontend bundle typechecks.

## Task 8: Strengthen Legacy Acceptance and Verify the Visible Result

**Files:**
- Modify `src-tauri/tests/acceptance_test.rs`.
- Modify `README.md` with the fixture and audit validation workflow.

- [ ] **Step 1: Write the failing exact-set assertions.**

Change the acceptance test to build explicit `HashSet`s for CSV session IDs and application session IDs. Assert both `csv - app` and `app - csv` are empty, then compare costs with the existing tolerance. Print concrete missing and extra IDs before failing.

- [ ] **Step 2: Run the acceptance test against configured snapshots.**

Run `cd src-tauri && cargo test --test acceptance_test -- --nocapture` with `ACCEPTANCE_DB` and `ACCEPTANCE_CSV` set. If the variables are absent, confirm the documented skip; with a snapshot and CSV, confirm exact counts and no mismatches.

- [ ] **Step 3: Add the fixed-fixture workflow to documentation.**

Document the golden fixture test, the real-database legacy test, and the MCP Chrome verification commands. State clearly that the fixture expected file is manually authored and that the app database remains read-only.

- [ ] **Step 4: Verify the visible result through MCP Chrome.**

Run `npm run dev:mock`, open the mock URL, and verify:

1. the audit view opens from the header;
2. the fixed counters and total costs are visible;
3. a message detail shows all cost components and the selected rate source;
4. anomaly filtering changes the visible rows;
5. JSON and CSV export actions are available only after generation;
6. the last-update timestamp and stale state are visible;
7. keyboard navigation and error announcements work.

- [ ] **Step 5: Run final verification.**

Run `npm test`, `npm run build`, `cd src-tauri && cargo test`, and the configured acceptance test. Re-run the MCP Chrome scenario after the final build. Report any skipped acceptance test explicitly rather than claiming legacy parity.

## Completion Criteria

- The golden fixture backend test compares manually authored expected message and session calculations.
- Component contributions, rate selection, fallbacks, and aggregation invariants are visible in the audit report.
- The dedicated frontend view displays the exact backend report without recalculating it.
- JSON and CSV exports contain the last successful report only.
- The real snapshot acceptance test detects missing and extra identifiers, not only count differences.
- The fixed database source remains untouched by all calculations and exports.
- Rust tests, frontend tests, frontend build, and MCP Chrome verification pass; any unavailable legacy environment is documented as skipped.
