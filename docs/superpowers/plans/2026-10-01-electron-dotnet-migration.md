# Electron and .NET Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tauri/Rust desktop runtime and backend with Electron and a self-contained .NET backend while preserving the React UI, application behavior, and Windows/macOS/Linux distribution.

**Architecture:** Electron main owns the desktop window, native dialogs, and lifecycle of a .NET child process. React communicates through a restricted preload API; Electron main communicates with .NET over a versioned JSON Lines protocol on stdin/stdout. The migration is gated by end-to-end parity before the old Tauri/Rust implementation is removed.

**Tech Stack:** Electron, electron-builder, React 19, TypeScript, Vite, .NET/C#, SQLite, Playwright, GitHub Actions.

---

## Implementation boundaries

The migration is split into working checkpoints so the native runtime is not removed before its replacement is exercised:

1. Contract and distribution prototype.
2. .NET protocol host and backend domain/infrastructure.
3. Electron host and React bridge.
4. Packaged E2E validation and platform release pipelines.
5. Removal of Tauri/Rust after parity sign-off.

The approved design is `docs/superpowers/specs/2026-10-01-electron-dotnet-migration-design.md`. Keep current XDG path behavior, read-only OpenCode database access, camelCase API payloads, JSONC parsing, historical pricing, audit semantics, and live watcher behavior.

## Files and responsibilities

### New Electron host

- `electron/main.ts`: create the window, initialize native dialogs and allowlisted external links, launch/stop the backend, route renderer IPC, and forward backend events.
- `electron/preload.ts`: expose only the typed, narrow API consumed by React.
- `electron/backend-process.ts`: resolve the packaged/development backend path, own stdin/stdout/stderr, correlate requests, and handle process termination.
- `electron/protocol.ts`: JSON Lines request/response/event message types.
- `electron/ipc-contract.ts`, `electron/renderer-api.ts`: fixed IPC channel names, typed renderer API, and result envelopes.
- `electron-builder.yml`: bundle resources and configure Windows NSIS/MSI, macOS DMG, Linux deb, application metadata, and one launcher entry per installation.
- `vite.config.ts`: retain the existing renderer build configuration.
- `electron/vite.config.electron.ts`: build the Electron main entrypoint as ESM.
- `electron/vite.config.preload.ts`: build the sandboxed preload as CommonJS.

### New .NET backend

- `src-dotnet/OpencodeCostsViewer.Backend.csproj`: target framework, nullable settings, publish settings, and resource inclusion.
- `src-dotnet/Program.cs`: stdin/stdout JSON Lines host; stdout is protocol-only and diagnostics go to stderr.
- `src-dotnet/Protocol/`: request/response/event DTOs, version negotiation, serialization, and dispatch.
- `src-dotnet/Application/`: cost calculation, aggregation, pricing resolution, settings operations, audit, and recalculation services.
- `src-dotnet/Infrastructure/`: read-only SQLite access, JSONC loading, XDG paths, settings persistence, filesystem watcher, metrics, and catalog loading.
- `src-dotnet/Infrastructure/AtomicFileOperations.cs`: atomic settings replacement and parent-directory durability operations.
- `src-dotnet/Models/`: API DTOs preserving the shapes in `src/types.ts`.
- `src-tauri/catalog/pricing.json`: embedded into the .NET assembly during the transition to avoid maintaining duplicate catalogs; move it to `src-dotnet/Resources/pricing.json` when Tauri is removed.

### Frontend bridge

- `src/api.ts`: keep exported frontend methods and API map; replace Tauri `invoke`/`listen` calls with the preload bridge.
- `src/types.ts`: remain the shared public response contract; update only for protocol errors or lifecycle states if needed.
- `src/vite-env.d.ts`: declare the typed preload API on `Window`.
- `src/mock/tauri-mock.ts`: replace Tauri-specific mock wiring with an Electron bridge mock for browser and E2E runs.
- `src/main.tsx`, `src/data-source.ts`, React components: preserve behavior; modify only where platform initialization or API contract requires it.

### E2E and releases

- `e2e/fixtures/`: retain and extend SQL/config/catalog fixtures for real backend packaged scenarios.
- `e2e/electron-app.spec.ts`: launch the packaged/development Electron app with Playwright Electron support and verify the real IPC/backend path.
- `playwright.config.ts`, `e2e/run-playwright.mjs`: add an Electron-backed E2E mode while preserving browser mock scenarios.
- `.github/workflows/release.yml`: matrix-build Windows NSIS and MSI, macOS Apple Silicon and Intel DMGs, and Linux `.deb`.
- `.github/workflows/windows-release.yml`: retain or replace the Windows-only rebuild flow for both NSIS and MSI assets.
- `package.json`, `package-lock.json`: add Electron, electron-builder, Electron typing, and development scripts; remove Tauri commands only in the final retirement task.
- `README.md`, `README.fr.md`, `AGENTS.md`: document prerequisites for contributors, package formats, signing/notarization, and release validation.

## Task 1: Create a stable API contract fixture

**Files:**
- Modify: `src/fixtures/api-contract.json`
- Reference: `src/api.ts`
- Reference: `src/types.ts`

- [ ] **Step 1: Enumerate the existing commands and their payloads**

Record the public operations already declared in `ApiCommandMap` and `ApiCommandArgs`: `get_data`, `get_settings`, `get_settings_status`, `get_runtime_metrics`, `save_settings`, `pick_path`, `get_resolved_paths`, `get_rates`, `get_cost_summary`, `get_catalog_status`, `recalculate_data`, `get_audit_report`, and `export_audit_report`; also record `db-changed`.

- [ ] **Step 2: Extend the API fixture with protocol envelopes**

For each operation, add one request and one representative success response using the exact existing TypeScript field names. Add structured error and `db-changed` event examples. Keep JSON serializable and avoid duplicating large audit arrays already covered by current fixtures.

- [ ] **Step 3: Verify the contract fixture**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('src/fixtures/api-contract.json', 'utf8'))"`

Run: `npm run build`

Expected: the fixture parses as JSON and the renderer build passes without renaming existing payload fields. The fixture is consumed by the backend protocol E2E in Task 9.

## Task 2: Prototype backend packaging modes before choosing the final .NET publish mode

**Files:**
- Create: `src-dotnet/PackagingProbe/PackagingProbe.csproj`
- Create: `src-dotnet/PackagingProbe/Program.cs`
- Create: `scripts/measure-dotnet-packaging.mjs`
- Create: `.github/workflows/dotnet-packaging-probe.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Add a minimal backend packaging probe**

Create a console program that prints one JSON line and exits. Keep it independent of application logic so output size and process-launch behavior are measurable.

- [ ] **Step 2: Publish the probe on matching platform runners**

Run the probe in a CI matrix on native Windows x64, macOS Apple Silicon, macOS Intel, and Linux x64 runners. For each RID, measure framework-dependent, self-contained, and Native AOT publish outputs. Save the RID, publish mode, compressed artifact size, and launch result in `artifacts/packaging-probe/` (ignored by Git). Record an explicit unsupported/build-failed result when a mode or dependency cannot publish for a RID.

- [ ] **Step 3: Verify framework-dependent runtime prerequisite**

Run the Linux framework-dependent probe inside the `runtime-deps` container, which has native dependencies but no .NET runtime. Verify that it exits with the documented missing-runtime message. Record runtime download/bootstrapper behavior as deferred; do not make end-user installation depend on an unimplemented bootstrapper.

- [ ] **Step 4: Run the probe and keep the approved default**

Run: `node scripts/measure-dotnet-packaging.mjs`

Expected: a report exists for all supported RIDs. Until the user approves a different mode, production packages remain self-contained as specified; use the measurements to make a later explicit decision.

## Task 3: Implement the .NET JSON Lines host

**Files:**
- Create: `src-dotnet/OpencodeCostsViewer.Backend.csproj`
- Create: `src-dotnet/Program.cs`
- Create: `src-dotnet/Protocol/ProtocolMessage.cs`
- Create: `src-dotnet/Protocol/ProtocolHost.cs`
- Create: `src-dotnet/Protocol/OperationDispatcher.cs`
- Create: `src-dotnet/Protocol/ProtocolError.cs`
- Reference: `src/fixtures/api-contract.json`

- [ ] **Step 1: Define versioned request, response, error, and event DTOs**

Implement JSON DTOs with `id`, `operation`, `arguments`, and `protocolVersion` on requests; `id`, `result` or `error` on responses; and `event` plus `payload` on notifications. Configure JSON to preserve lower camelCase property names and serialize nullable results explicitly.

- [ ] **Step 2: Add a line-oriented protocol loop**

Read stdin one complete line at a time. Validate JSON shape, protocol version, request id, operation name, and bounded line length. Write exactly one JSON response line per request to stdout. Write all diagnostics to stderr. Continue after a malformed request when its framing remains recoverable.

- [ ] **Step 3: Add asynchronous event output and clean shutdown**

Serialize protocol writes behind one writer so responses and events cannot interleave at the byte level. On EOF or shutdown request, stop event producers and exit without writing diagnostics to stdout.

- [ ] **Step 4: Build the backend host**

Run: `dotnet build src-dotnet/OpencodeCostsViewer.Backend.csproj -c Release`

Expected: the backend host builds for the developer platform with nullable analysis enabled and no protocol output is written during build.

## Task 4: Port domain models and pricing/cost services

**Files:**
- Create: `src-dotnet/Models/SessionRecord.cs`
- Create: `src-dotnet/Models/Tokens.cs`
- Create: `src-dotnet/Models/UsageRow.cs`
- Create: `src-dotnet/Models/PricingCatalog.cs`
- Create: `src-dotnet/Application/CostCalculator.cs`
- Create: `src-dotnet/Application/PricingService.cs`
- Create: `src-dotnet/Application/SessionAggregator.cs`
- Create: `src-dotnet/Infrastructure/PricingCatalogLoader.cs`
- Modify: `src-dotnet/OpencodeCostsViewer.Backend.csproj`
- Reference: `src-tauri/src/model.rs`
- Reference: `src-tauri/src/cost.rs`
- Reference: `src-tauri/src/pricing.rs`
- Reference: `src-tauri/src/aggregate.rs`
- Reference: `src-tauri/catalog/pricing.json`
- Reference: `src/types.ts`

- [ ] **Step 1: Port cost and usage DTO shapes**

Create C# DTOs for token totals, cost breakdowns, session records, model usage, cost-source values, pricing catalog entries, and raw usage rows. Preserve camelCase JSON fields, nullable parent IDs, integer millisecond timestamps, and the distinction between stored and configured cost sources. Settings and audit DTOs are ported with their application services in Tasks 5 and 6.

- [ ] **Step 2: Port rate selection and cost rules**

Port custom-rate precedence, historical `effectiveFrom` selection, stored-cost fallback, cache token rates, and reasoning-at-output-rate behavior from the Rust implementation. Keep arithmetic and fallback decisions in `CostCalculator` and `PricingService`, not in protocol dispatch.

- [ ] **Step 3: Port session aggregation**

Port subagent linkage, dates, token totals, model usage, cost provenance, and ordering behavior from `aggregate.rs` into `SessionAggregator`.

- [ ] **Step 4: Embed and load the catalog**

Embed `src-tauri/catalog/pricing.json` as a named .NET resource without copying it. Validate catalog metadata and entries before exposing `get_catalog_status` or using catalog rates. The file moves under `src-dotnet/Resources/` in Task 12 when the Rust project is removed.

- [ ] **Step 5: Build the backend**

Run: `dotnet build src-dotnet/OpencodeCostsViewer.Backend.csproj -c Release`

Expected: all DTO and pricing/aggregation services compile and the catalog is present in the build output.

## Task 5: Port SQLite, JSONC, settings, and path resolution

**Files:**
- Create: `src-dotnet/Infrastructure/OpencodeDatabase.cs`
- Create: `src-dotnet/Infrastructure/SqliteProvider.cs`
- Create: `src-dotnet/Infrastructure/AtomicFileOperations.cs`
- Create: `src-dotnet/Infrastructure/JsoncReader.cs`
- Create: `src-dotnet/Infrastructure/SettingsStore.cs`
- Create: `src-dotnet/Infrastructure/PathResolver.cs`
- Create: `src-dotnet/Models/Settings.cs`
- Create: `src-dotnet/Models/CostSummary.cs`
- Create: `src-dotnet/Application/DataService.cs`
- Create: `src-dotnet/Application/SettingsService.cs`
- Create: `src-dotnet/Application/BackendException.cs`
- Modify: `src-dotnet/OpencodeCostsViewer.Backend.csproj`
- Reference: `src-tauri/src/db.rs`
- Reference: `src-tauri/src/jsonc.rs`
- Reference: `src-tauri/src/config.rs`
- Reference: `src-tauri/src/settings.rs`
- Reference: `AGENTS.md` XDG constraints
- Reference: `e2e/fixtures/opencode-fixture.sql`

- [ ] **Step 1: Implement XDG-compatible path resolution**

Resolve `$XDG_DATA_HOME/opencode/opencode.db` or `~/.local/share/opencode/opencode.db`, and `$XDG_CONFIG_HOME/opencode/opencode.jsonc` or `~/.config/opencode/opencode.jsonc` on all three desktop operating systems. Respect explicitly configured paths and never substitute OS-specific `AppData` or `Library` defaults for OpenCode data.

- [ ] **Step 2: Implement read-only SQLite loading**

Initialize the OS SQLite provider before the first connection. Open the configured database with `Mode=ReadOnly` and a five-second default timeout. Port assistant-message, session, ignored-message, and stored-cost-summary queries. Preserve current handling of missing/invalid token fields and schema errors. Do not create tables or execute writes. Use the Windows system `winsqlite3` provider and `sqlite3` on macOS/Linux; do not add the audited `SQLitePCLRaw.lib.e_sqlite3` bundle.

- [ ] **Step 3: Implement JSONC parsing and configured rates**

Support comments and trailing commas before JSON parsing. Port extraction and validation of custom model costs, including invalid or absent configuration diagnostics.

- [ ] **Step 4: Implement settings persistence and validation**

Port default settings, unknown-field rejection, `defaultPeriodDays` validation (`1..3650`), configuration diagnostics, and atomic settings persistence to the application settings location.

- [ ] **Step 5: Build the backend**

Run: `dotnet build src-dotnet/OpencodeCostsViewer.Backend.csproj -c Release`

Expected: database, JSONC, path, and settings services compile; no operation opens the OpenCode database for writing.

## Task 6: Port audit, runtime metrics, watcher, and command dispatch

**Files:**
- Create: `src-dotnet/Application/AuditService.cs`
- Create: `src-dotnet/Application/AuditReportBuilder.cs`
- Create: `src-dotnet/Application/RuntimeMetricsService.cs`
- Create: `src-dotnet/Application/BackendRuntime.cs`
- Create: `src-dotnet/Infrastructure/DatabaseWatcher.cs`
- Create: `src-dotnet/Models/AuditReport.cs`
- Create: `src-dotnet/Models/RuntimeModels.cs`
- Modify: `src-dotnet/Infrastructure/OpencodeDatabase.cs`
- Modify: `src-dotnet/Infrastructure/ConfigReader.cs`
- Modify: `src-dotnet/Application/DataService.cs`
- Modify: `src-dotnet/Application/SettingsService.cs`
- Modify: `src-dotnet/Program.cs`
- Modify: `src-dotnet/Protocol/ProtocolHost.cs`
- Modify: `src-dotnet/Protocol/OperationDispatcher.cs`
- Reference: `src-tauri/src/audit.rs`
- Reference: `src-tauri/src/runtime.rs`
- Reference: `src-tauri/src/watcher.rs`
- Reference: `src-tauri/src/commands.rs`
- Reference: `src/api.ts`
- Reference: `src-tauri/tests/fixtures/audit/`

- [ ] **Step 1: Port audit report generation**

Preserve audit provenance, anomaly classifications, invariant checks, ignored-message reasons, and all public report fields. Use the existing audit SQL/config/catalog fixtures as reference inputs for later packaged E2E scenarios.

- [ ] **Step 2: Port runtime metrics**

Expose process memory and optional database size using the current response shape, returning null when a metric is unavailable rather than failing unrelated application calls.

- [ ] **Step 3: Port database watcher lifecycle**

Watch only the configured database file, debounce bursts for one second, publish `db-changed`, restart on settings path changes, and stop/join the watcher when live mode is disabled or the backend exits.

- [ ] **Step 4: Dispatch every current public operation**

Map each operation listed in Task 1 to an application service. Keep dialog operations in Electron rather than implementing OS dialogs in .NET. Return structured error categories compatible with `ApiError`.

- [ ] **Step 5: Build the complete backend**

Run: `dotnet build src-dotnet/OpencodeCostsViewer.Backend.csproj -c Release`

Expected: all operations except host-owned file dialogs are dispatched, and watcher events use the protocol writer without corrupting response framing.

## Task 7: Add Electron main, preload, and backend process management

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `electron/backend-process.ts`
- Create: `electron/protocol.ts`
- Create: `electron/renderer-api.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Create: `electron/vite.config.electron.ts`
- Create: `electron/vite.config.preload.ts`
- Create: `tsconfig.electron.json`
- Create: `electron/ipc-contract.ts`

- [ ] **Step 1: Add Electron development dependencies and scripts**

Add Electron, electron-builder, and Node type declarations. Add separate scripts for Vite renderer development, Electron development, frontend build, and desktop packaging without deleting Tauri scripts yet. Add the direct `playwright` dependency alongside `@playwright/test` in Task 9 when the Electron E2E runner is implemented.

- [ ] **Step 2: Build the process manager**

Spawn the backend with `child_process.spawn` using argument arrays (never a shell command string). Resolve development and packaged executable paths separately. Parse stdout as line-delimited messages, correlate pending ids, route events, retain bounded stderr diagnostics, reject pending requests on process exit, and terminate/reap the child on app shutdown.

- [ ] **Step 3: Add the restricted preload API**

Expose only named functions for the API operations, native path selection, audit export, and database-change subscription. Do not expose `ipcRenderer`, `process`, or generic channel names.

- [ ] **Step 4: Create the BrowserWindow securely**

Configure `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Load only the packaged renderer or the explicitly configured local Vite development URL.

- [ ] **Step 5: Add native file dialogs and export handling**

Implement path selection and save-file dialogs in the main process. Validate export extension and content size before writing. Open only allowlisted HTTPS GitHub links in the system browser. Return null on user cancellation and structured errors on failure.

- [ ] **Step 6: Build TypeScript and renderer**

Run: `npm run electron:build:desktop`

Expected: renderer, main, and preload type-check/build; main is ESM, sandboxed preload is CommonJS, and Electron APIs remain external to the renderer bundle.

## Task 8: Replace the Tauri frontend adapter while preserving the browser mock

**Files:**
- Modify: `src/api.ts`
- Modify: `src/vite-env.d.ts`
- Move: `src/mock/tauri-mock.ts` to `src/mock/desktop-mock.ts`
- Modify: `src/mock/desktop-mock.test.ts`
- Modify: `src/api.test.ts`
- Modify: `src/api.contract.test.ts`
- Modify: `src/data-source.ts`
- Modify: `src/data-source.test.ts`
- Modify: `src/components/AboutModal.tsx`
- Modify: `src/components/AboutModal.test.tsx`
- Modify: `vite.config.mock.ts`

- [ ] **Step 1: Declare the typed preload contract**

Add a `Window` declaration matching the named preload functions and use existing public DTO types from `src/types.ts` for request results.

- [ ] **Step 2: Implement the Electron adapter**

Keep the public helper names used by hooks and components. Replace Tauri `invoke` and `listen` with preload functions, preserving error translation and async unsubscribe behavior for database-change events.

- [ ] **Step 3: Adapt browser mock initialization**

Provide a development-only mock bridge for browser UI and existing mock Playwright scenarios. It must not be included as an active fallback in production when preload initialization fails.

- [ ] **Step 4: Run frontend build and browser E2E**

Run: `npm run build`

Run: `npm run test:e2e`

Expected: frontend methods and response shapes remain stable and established browser mock scenarios still work without Electron.

## Task 9: Add packaged Electron end-to-end scenarios against the real .NET backend

**Files:**
- Create: `e2e/fixtures/opencode-backend-fixture.sql`
- Create: `e2e/fixtures/opencode-backend-config.jsonc`
- Create: `e2e/electron-app.spec.ts`
- Create: `playwright.electron.config.ts`
- Modify: `e2e/run-playwright.mjs`
- Modify: `e2e/global.d.ts`
- Modify: `package.json`
- Modify: `.github/workflows/e2e.yml`

- [ ] **Step 1: Add scenario selection for Electron E2E**

Extend the Playwright runner with an Electron mode that starts the built Electron app and passes fixture database/config paths through an explicit test-only environment contract.

- [ ] **Step 2: Verify startup and primary data flow**

Import `_electron` from the `playwright` package and use `@playwright/test` assertions to verify that the app window loads, the .NET backend responds, session rows and KPIs render from the SQLite fixture, and a backend crash is surfaced as an actionable application error.

- [ ] **Step 3: Verify settings, dialogs, and exports**

Exercise path changes, persisted settings, canceled and successful export flows through the Electron main-process API.

- [ ] **Step 4: Verify live watcher behavior**

Mutate only the isolated E2E fixture database, wait for one debounced event, verify the UI refreshes, then verify disabling live mode stops subsequent notifications.

- [ ] **Step 5: Run real-backend E2E and browser mock E2E**

Run: `npm run test:e2e:electron`

Expected: Electron E2E proves the API bridge, real read-only SQLite provider, watcher, settings, native dialogs and export against an isolated fixture. Run `npm run test:e2e` separately to keep the established browser mock scenarios green.

## Task 10: Configure platform bundles and Windows installer variants

**Files:**
- Create: `electron-builder.yml`
- Create: `scripts/publish-backend.mjs`
- Create: `scripts/publish-electron-release.mjs`
- Create: `scripts/run-electron-builder.mjs`
- Create: `scripts/verify-macos-dmg.sh`
- Create: `scripts/verify-deb-installation.mjs`
- Create: `scripts/verify-windows-installers.ps1`
- Create: `scripts/verify-release-version.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/windows-release.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Bundle the backend beside Electron resources**

Configure electron-builder `extraResources` to include the .NET publish output at a stable app-resource path for each RID. Ensure Electron resolves that path through `process.resourcesPath` in production and a local publish directory in development.

- [ ] **Step 2: Configure Windows NSIS per-user installer**

Build the `.exe` installer in per-user mode. Create one Start Menu shortcut, no desktop shortcut by default, preserve settings on upgrade/uninstall, and set a stable application identity.

- [ ] **Step 3: Configure Windows MSI per-machine installer**

Build the `.msi` installer per-machine with a stable upgrade code and one Start Menu shortcut. Ensure silent installation and uninstall work for DSI deployment. Document that MSI updates are distributed by the DSI and that installing MSI and NSIS variants side by side is unsupported.

- [ ] **Step 4: Configure macOS DMG**

Build separate Apple Silicon and Intel DMGs. Put the `.app` and an alias to `/Applications` in the DMG window. Keep signing and notarization credentials in CI secrets, never in repository files.

- [ ] **Step 5: Configure Linux deb**

Build the x64 `.deb`, include application metadata and icon, declare `libsqlite3-0` as a runtime dependency, and ensure the package creates one desktop/menu launcher.

- [ ] **Step 6: Build packages on matching CI runners**

Update the release matrix to produce Windows NSIS+MSI, macOS Apple Silicon+Intel DMGs, and Linux x64 deb. Verify package/tag version synchronization, upload each artifact separately, and require the publication job to confirm all five installer assets.

- [ ] **Step 7: Build local package on the current OS**

Run: `npm run desktop:package`

Expected: the host-OS installer contains the relative-asset renderer, Electron main/preload, and matching self-contained .NET backend. On macOS, verify the DMG with `hdiutil verify` and confirm its window includes the app and `/Applications` alias. Installing creates one app launcher.

## Task 11: Validate installers, signing, and release documentation

**Files:**
- Modify: `README.md`
- Modify: `README.fr.md`
- Modify: `AGENTS.md`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/windows-release.yml`
- Create: `scripts/verify-macos-dmg.sh`
- Create: `scripts/verify-deb-installation.mjs`
- Create: `scripts/verify-windows-installers.ps1`
- Create: `scripts/resolve-packaged-electron.mjs`
- Create: `scripts/run-packaged-electron-e2e.mjs`

- [x] **Step 1: Document developer prerequisites and commands**

Replace Rust/Tauri setup instructions with the supported Node and .NET SDK versions, Electron development command, backend build command, E2E command, and platform-specific packaging commands.

- [x] **Step 2: Document user packages and runtime inclusion**

Explain Windows NSIS versus MSI audiences, macOS DMG drag-to-Applications flow, Linux `.deb` support, bundled backend behavior, and current signing/notarization status.

- [ ] **Step 3: Exercise install, reinstall/repair, and uninstall behavior**

On Windows, install, reinstall the NSIS variant, repair the MSI, run the installed app against the isolated backend fixture, then uninstall both separately. Verify Start Menu shortcut count, absence of desktop shortcuts, settings preservation, and clean process shutdown. The first Electron release has no previous Electron version to upgrade from; test a version-to-version upgrade once a previous Electron release exists. On macOS, mount the DMG, verify its `/Applications` alias, copy the app to a temporary Applications directory, run the packaged E2E, then remove it. On Linux, install the `.deb`, run the packaged E2E, reinstall it, then remove it and verify the launcher and executable are gone.

- [ ] **Step 4: Exercise signed release candidates**

Build release candidates on all OS runners. The release matrix verifies the installed DMG/.deb app and installs, repairs/reinstalls, tests, and uninstalls both Windows variants. Confirm macOS signature/notarization and Windows signatures when credentials are configured, and record installer hashes before publishing. The first Electron release has no previous Electron version to upgrade from; verify true version-to-version upgrades after that release exists.

## Task 12: Retire Tauri and Rust after parity sign-off

**Sequencing note:** The owner requested removing Tauri and Rust before Windows/Linux packaged-install validation is available. Remove the legacy runtime now, but keep the release completion gate open until all platform installers have passed their CI scenarios.

**Files:**
- Delete: `src-tauri/`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `README.fr.md`
- Modify: `AGENTS.md`
- Modify: CI workflow files that still install Rust or invoke Tauri
- Review: `.gitignore`, `playwright.config.ts`, release scripts

- [ ] **Step 1: Confirm the release matrix and packaged E2E evidence**

Before removal, require green packaged E2E for database read-only behavior, cost parity, settings, audit, export, live mode, and installation/upgrade on the supported platforms. Require all release artifacts: Windows NSIS, Windows MSI, macOS Apple Silicon DMG, macOS Intel DMG, and Linux x64 `.deb`.

- [x] **Step 2: Remove Tauri runtime references**

Remove `@tauri-apps/api`, Tauri CLI/configuration, Rust setup from CI, `src-tauri/`, and stale Tauri-only mocks after a repository-wide search confirms the active application and documentation no longer depend on them.

- [x] **Step 3: Run final build and required E2E validation**

Run: `npm ci`

Run: `npm run build`

Run: `npm run test:e2e`

Expected: a clean install, frontend build, browser mock scenarios, and Electron-backed scenarios pass with no Rust or Tauri installation required.

## Acceptance criteria

- React user workflows and API payloads remain behaviorally compatible.
- `opencode.db` is always opened read-only.
- XDG paths, JSONC, pricing history, audit, settings, and watcher semantics are preserved.
- The frontend has no direct Node.js access; only the preload API is available.
- The .NET backend starts, reports errors, emits live events, and stops with Electron.
- End users do not install .NET separately.
- Windows delivers NSIS per-user and MSI per-machine, each with one Start Menu shortcut.
- macOS delivers Apple Silicon and Intel DMGs with an Applications alias.
- Linux delivers one Debian/Ubuntu `.deb` with one app launcher.
- Release completion remains blocked until packaged E2E and release artifacts prove the replacement on every supported platform.
