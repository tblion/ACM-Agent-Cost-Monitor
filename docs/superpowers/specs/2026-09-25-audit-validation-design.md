# Validation Audit Design

## Goal

Provide an in-application audit that proves which OpenCode data was read, which rate was selected, how each message cost was calculated, and how the displayed totals were obtained.

## Scope

The feature includes:

- a backend-generated audit report based on the configured database, JSONC configuration, and embedded pricing catalog;
- a dedicated frontend audit view;
- message-level provenance and anomaly details;
- JSON and CSV exports of the last successful report;
- synthetic SQLite coverage for data-source edge cases;
- stronger legacy comparison checks for message/session identity and costs.

The feature does not expose message content and never writes to `opencode.db`.

## Architecture

The Rust backend remains the source of truth for the audit. A dedicated Tauri command reads the database in read-only mode, loads custom rates and the validated embedded catalog, and returns a serializable `AuditReport`. The React frontend keeps the last successful report in memory and renders a dedicated view from that report.

The audit is separate from `SessionRecord` and from the normal session-loading path. This prevents already-aggregated data from hiding ignored, malformed, or non-recalculable messages.

The database reader will include `message.id` in `RawRow`, so every audit line can be tied to a concrete source message. No raw message JSON or prompt/response content is returned.

## Report Contract

The backend report contains:

- `generatedAt`;
- `valid`, which is false when a calculation invariant fails;
- resolved database and configuration paths;
- pricing catalog version, source version, generation date, and rate count;
- global counters:
  - sessions present in the database;
  - sessions with at least one assistant message;
  - assistant messages;
  - recalculable messages;
  - custom-rate messages;
  - catalog-rate messages;
  - stored-cost fallback messages;
  - messages with missing or invalid tokens;
  - messages with missing dates;
  - messages with missing rates;
  - stored-cost total;
  - calculated-cost total for messages with a resolved rate;
- one detail record per assistant message containing:
  - session ID and message ID;
  - project, provider, and model;
  - message date;
  - parsed tokens, when valid;
  - stored cost;
  - calculated cost, when possible;
  - component cost breakdown, when possible;
  - selected cost source;
  - selected rate and `effectiveFrom`, when applicable;
  - stable anomaly codes.

Anomaly codes are machine-readable and independent from translated UI text. They cover missing/invalid tokens, missing dates, missing rates, and stored-cost fallback. A message may have more than one anomaly.

The session counters are intentionally separate: the normal assistant-message query can omit sessions with no assistant messages, while the audit must make that omission visible. The report therefore obtains the total session count independently from the session table.

## Calculation Proof

The audit must validate the calculation algorithm, not only display its inputs. Every message with a resolved rate includes a cost breakdown containing the five independent contributions:

- input tokens multiplied by the input rate;
- output tokens multiplied by the output rate;
- cache-read tokens multiplied by the cache-read rate;
- cache-write tokens multiplied by the cache-write rate;
- reasoning tokens multiplied by the output rate.

The unrounded sum of these contributions is the message calculated cost. The report also checks that:

- the breakdown sum equals the recorded calculated message cost within the existing floating-point tolerance;
- the sum of message costs equals each session cost before display formatting;
- the sum of message token components equals each session token total;
- the selected rate obeys custom-rate precedence and historical `effectiveFrom` selection;
- messages without a valid calculation use the stored cost and are explicitly marked as fallbacks rather than silently treated as recalculated.

The audit exposes failed invariant counts and their affected identifiers. A successful report with a failed calculation invariant is considered invalid and cannot be exported as a validated report.

The tests use hand-calculated expected values in synthetic fixtures. They do not derive expected results by calling the implementation under test. The legacy acceptance test remains the independent end-to-end oracle for real session totals.

## Golden Reference Dataset

The repository will contain a small, deterministic reference dataset dedicated to algorithm validation. It will be intentionally separate from any personal `opencode.db` snapshot and will contain no private prompt or response content.

The fixture consists of:

- a readable SQL setup containing the minimum OpenCode `session` and `message` schema plus fixed rows;
- a JSONC configuration fixture containing known custom rates;
- a small test pricing catalog with explicit effective dates;
- a manually authored expected-result file containing message, session, token, component-cost, rate-source, anomaly, and global-counter expectations.

The expected-result file is an oracle, not generated by the application. Any change to an expected value must therefore be an intentional algorithm or fixture change reviewed alongside the source data.

The fixed rows cover custom-rate precedence, historical rates before and after an effective date, every token component including reasoning, missing/invalid tokens, missing dates, missing rates, stored-cost fallback, parent/sub-session metadata, and ignored non-assistant messages.

The backend integration test creates a temporary database from the SQL fixture and compares the complete audit output with the manually authored expectations. It also verifies that every fixture message is classified exactly once and that ignored rows are accounted for explicitly.

The frontend mock uses the same deterministic report contract. A browser-level test checks that the dedicated view displays the expected counters, costs, rate sources, anomalies, and detail breakdowns. This validates the full path from fixed source data through backend calculation to visible UI output.

Rate resolution follows the existing business rule:

1. configured custom rate for the provider/model;
2. latest catalog rate applicable to the message date;
3. stored OpenCode cost when recalculation is impossible.

## Audit Lifecycle

The view exposes an explicit `Actualiser l’audit` action. It invokes a dedicated Tauri command that:

1. resolves current settings paths;
2. opens the database read-only;
3. loads custom rates;
4. validates and loads the embedded catalog;
5. analyzes every assistant message;
6. resolves rates and computes per-message provenance;
7. builds the report;
8. replaces the displayed report only after successful completion.

The audit is not automatically recalculated when normal data is refreshed or when live mode receives a database event. The view marks the report as potentially stale when the loaded data or settings change after report generation. The displayed timestamp is the last successful generation timestamp.

When generation fails, the previous successful report remains visible, an accessible error is shown, and no export is changed. If no report exists yet, the view shows an empty state explaining that the user must run the audit.

## Dedicated View

The audit view is separate from the main session table and includes:

- a back action;
- explicit refresh action with busy state;
- last successful audit timestamp;
- stale-report indicator;
- summary counters;
- anomaly counts and descriptions;
- database/configuration/catalog provenance;
- a filterable message table;
- filters for session, provider, model, cost source, and anomaly;
- expandable message rows with tokens, component cost breakdown, stored/calculated costs, selected rate, effective date, invariant status, and anomaly codes.

The view supports French and English translations and WCAG 2.2/RGAA-compatible keyboard navigation, table labels, live loading announcements, and error announcements.

### Reading Notice

The audit view displays a substantial general explanation near the top of the page. It explains the purpose of the audit, the source data and calculations it checks, the recommended reading order, the meaning of anomalies, and when the report should be refreshed.

Small information controls provide contextual definitions for technical terms near the relevant counters, costs, anomalies, and message details. Each information control must be usable by mouse, touch, keyboard focus, and assistive technology; the explanation must not depend on hover alone. The general explanation remains visible while the contextual definitions stay short and local to the item they describe.

## Exports

The user can export the exact last successful report through a native save dialog:

- JSON contains the complete structured `AuditReport`;
- CSV contains one row per message, including identifiers, source metadata, token fields, stored/calculated costs, selected rate fields, source, and anomaly codes.

Exports are disabled until a successful report exists. Exporting never triggers a new calculation, so the file cannot silently differ from the report currently displayed.

## Legacy Comparison

`acceptance_test.rs` will continue to compare the application against the legacy CSV using the same database snapshot and configuration. It will additionally assert:

- exact session ID set equality, detecting IDs present only on either side;
- exact message/model/provider grouping where the legacy output provides it;
- per-message costs where a stable message identifier is available;
- per-session cost equality within the existing numeric tolerance.

The test must report concrete missing, extra, and divergent identifiers instead of inferring extras only from collection lengths.

## Testing Strategy

Backend tests cover report counters, anomaly codes, component formula values, rounding tolerance, rate precedence, historical effective dates, token components, stored fallback, aggregate invariants, parent/sub-session metadata, and read-only database access. A synthetic SQLite fixture exercises valid, missing, and malformed source data with hand-calculated expected costs.

Frontend tests cover rendering the empty/loading/error/success states, filters, expandable details, stale status, JSON serialization, and CSV serialization. A browser-level E2E or MCP Chrome scenario covers opening the dedicated view, generating the report, inspecting an anomaly, filtering a message, and exporting both formats.

Implementation follows TDD: each behavior starts with a failing test, then receives the smallest implementation needed to pass, followed by refactoring while the complete suite remains green.

## File Boundaries

Expected implementation boundaries are:

- `src-tauri/src/db.rs`: message identity and source-row loading;
- `src-tauri/src/aggregate.rs`: reusable rate-resolution provenance;
- `src-tauri/src/audit.rs`: report construction and anomaly classification;
- `src-tauri/src/model.rs`: serialized audit types;
- `src-tauri/src/commands.rs`: audit and export commands;
- `src-tauri/tests/`: SQLite fixtures and acceptance strengthening;
- `src/types.ts` and `src/api.ts`: frontend report contract and API calls;
- `src/components/AuditView.tsx` and focused helpers/tests: dedicated UI and export formatting;
- `src/App.tsx`, translations, and styles: navigation and accessible presentation.

## Non-Goals

- modifying, migrating, or repairing `opencode.db`;
- exposing prompt or response content;
- automatically rewriting historical costs;
- replacing the existing session view or recalculation flow;
- treating a successful aggregate total as proof that every source row was valid.
