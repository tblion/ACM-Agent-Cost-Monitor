# Opencode Costs Viewer

[Français](README.fr.md)

Desktop application for Windows, macOS, and Linux that calculates the token and dollar cost of each **opencode** session and project from the local `opencode.db` database. It replaces the legacy PowerShell script `Get-OpencodeSessionCosts.ps1` (kept in `_old/`).

Unlike the script, it provides a graphical interface with filters, charts, a sortable table, live mode, and persistent settings.

## Features

- **KPIs**: total cost, tokens, number of sessions (including subagents), and number of projects for the filtered period.
- **Filters**: by project, model, provider, and date range.
- **Charts**: cost over time, by project, model, and provider; token breakdown; most expensive sessions; and cost by project group (automatic parent folder plus custom groups).
- **Session table**: sortable by date or cost, with a `rate ✓` badge (custom rate applied) or `cost 0` (local/free model, reported but not hidden).
- **Live mode**: the `LIVE` button in the header enables automatic updates as soon as the opencode database changes (file watching with debounce).
- **Persistent settings**: database and configuration paths, theme (system/light/dark), default period, and custom project groups. Saved in `settings.json`.

Costs are recalculated with the custom rates from `opencode.jsonc` (`provider.<id>.models.<model>.cost`); otherwise, the cost already stored by opencode is used. Reasoning tokens are charged at the `output` rate.

## Prerequisites

### All systems

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) `^20.19.0` or `>=22.12.0` (Node.js 22 LTS recommended)

### Windows

- **Microsoft C++ Build Tools**: download the installer from [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and select **Desktop development with C++**.
- **WebView2**: preinstalled on recent Windows 10/11 systems. Otherwise install the [WebView2 runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

### macOS

- **Xcode Command Line Tools**:
  ```sh
  xcode-select --install
  ```

### Linux (Debian / Ubuntu)

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential curl wget file \
  libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

> Fedora: `sudo dnf install webkit2gtk4.1-devel` · Arch: `sudo pacman -S webkit2gtk-4.1`

## Installation

```sh
git clone https://github.com/tblion/OpencodeCostsViewer.git
cd OpencodeCostsViewer
npm ci
```

## Development

### Development mode

```sh
npm run tauri dev
```

This compiles the Rust backend, starts the Vite server, and opens the application window.

## Local builds

Local builds produce installers for the platform on which the command is run. Tauri does not automatically build bundles for other systems from macOS, Windows, or Linux.

### macOS

```sh
npm run tauri build
```

On Apple Silicon, artifacts are generated in:

```text
src-tauri/target/release/bundle/macos/Opencode Costs Viewer.app
src-tauri/target/release/bundle/dmg/Opencode Costs Viewer_<version>_aarch64.dmg
```

On an Intel Mac, the DMG name contains `x86_64` instead of `aarch64`.

### Windows

In PowerShell:

```powershell
npm run tauri build
```

Installers are generated in `src-tauri/target/release/bundle/`, including:

```text
nsis/*.exe
msi/*.msi
```

### Linux

```sh
npm run tauri build
```

Artifacts are generated in `src-tauri/target/release/bundle/`, including:

```text
appimage/*.AppImage
deb/*.deb
rpm/*.rpm
```

### Frontend-only build

To verify the frontend without compiling Tauri:

```sh
npm run build
```

## GitHub releases

The `.github/workflows/release.yml` workflow builds and publishes the following bundles for every `v*` tag:

- macOS Apple Silicon (`aarch64`)
- macOS Intel (`x86_64`)
- Windows x64 (`.exe` and `.msi`)
- Linux x64 (`.deb`, `.rpm`, and `.AppImage`)

To publish a new release from `main`:

```sh
git tag v1.1.0-beta.1
git push origin v1.1.0-beta.1
```

The release workflow runs for any `v*` tag and derives the release tag from the version in `package.json`, `Cargo.toml`, and `tauri.conf.json`. The current version is `v1.1.0-beta.1`, and the workflow publishes it as a pre-release. The workflow can also be started from GitHub's **Actions** tab. The `.github/workflows/windows-release.yml` workflow can additionally rebuild only the Windows installer and attach it to an existing release by specifying its tag, such as `v1.1.0-beta.1`.

Published bundles are currently unsigned. macOS and Windows may therefore display a security warning on first launch.

### Allow the application on macOS

After downloading the DMG:

1. Open the DMG and drag `Opencode Costs Viewer.app` to **Applications**.
2. Right-click the application, choose **Open**, then confirm **Open**.
3. If macOS still blocks the application, open **System Settings -> Privacy & Security** and click **Open Anyway**.

If macOS reports that “the application is damaged and cannot be opened”, remove only the quarantine attribute from the application copied to Applications:

```sh
xattr -dr com.apple.quarantine "/Applications/Opencode Costs Viewer.app"
```

Then relaunch the application. This command bypasses macOS download protection; use it only for a bundle from this repository or a trusted release. It does not repair a genuinely corrupted binary or sign the application.

To remove these warnings automatically for all users, the application must be signed with an Apple Developer ID certificate and notarized by Apple. This configuration is not enabled in the repository yet.

## Pricing catalog and releases

The embedded catalog contains official API rates collected on September 23, 2026. The declared source is `src-tauri/catalog/pricing-source.json`. `effectiveFrom` dates are the catalog adoption dates because providers do not publish historical effective dates. Rates use the standard short-context tier; the Google Gemini Pro rate uses the `<=200k` token tier because the application does not know prompt size, and DeepSeek rates intentionally use the peak tier. To prepare a release, the repository generates a temporary catalog, validates it with the same Rust validator used by the application, and replaces the existing catalog atomically only after validation:

```sh
npm run release:prepare
```

An alternative local source can be provided explicitly with `npm run release:prepare -- --source path/to/source.json`. A missing, unparsable, empty, ambiguous, or incomplete source makes the command fail without replacing the last valid catalog. CI runs this command before the Tauri bundle.

> A macOS bundle must be built **on a Mac**; a Windows bundle must be built **on Windows**.

## Configuration

On first launch, the application uses opencode's default paths (XDG convention, identical on all three operating systems):

| Item | Default path |
|---|---|
| Database | `~/.local/share/opencode/opencode.db` (or `$XDG_DATA_HOME/opencode/opencode.db`) |
| Configuration (rates) | `~/.config/opencode/opencode.jsonc` (or `$XDG_CONFIG_HOME/opencode/opencode.jsonc`) |

If your opencode installation uses different paths, change them in **Settings** (the header's gear icon) with the *Browse...* buttons. The choice is stored in `settings.json` (the application's configuration directory).

## Tests

```sh
# Backend tests (Rust): costs, JSONC, configuration, aggregation, settings
cd src-tauri && cargo test

# Frontend tests (TypeScript): filtering + aggregations
npm test

# Playwright E2E tests: isolated mock frontend, headless Chromium
npx playwright install chromium
npm run test:e2e

```

For the acceptance test, provide a database snapshot and a CSV generated by the legacy script.

POSIX shells (macOS/Linux):

```sh
cd src-tauri
ACCEPTANCE_DB="/path/to/opencode.db" \
ACCEPTANCE_CSV="/path/to/opencode-costs.csv" \
cargo test --test acceptance_test -- --nocapture
```

PowerShell (Windows):

```powershell
cd src-tauri
$env:ACCEPTANCE_DB = "C:\path\to\opencode.db"
$env:ACCEPTANCE_CSV = "C:\path\to\opencode-costs.csv"
cargo test --test acceptance_test -- --nocapture
```

E2E tests automatically start the mock frontend on a free `127.0.0.1` port with `VITE_E2E=true`. The launcher reads `e2e/fixtures/opencode-fixture.sql`, creates two isolated SQLite WASM copies with `sql.js`, generates JSON snapshots through SQLite queries, then explicitly passes the manifest, snapshots, paths, and hash to the server through environment variables; the mock loads the selected snapshot as its initial source. The live operation `window.__E2E__.mutateSql()` inserts a row into the primary copy, regenerates its snapshot, and triggers an application reload. Changing `dbPath` through `SettingsModal`/`save_settings` selects the snapshot from the second copy. No test reads or writes `opencode.db`. The mock browser cannot run the real Tauri backend, SQLite, or native watcher: these tests validate the SQLite WASM fixture and mock flow, while real SQLite/watcher execution is covered by Rust tests. Initial scenarios are selected through the query string; live and data changes go through `window.__E2E__`, which is unavailable outside this mode. The `?e2e=no-settings` scenario explicitly simulates missing configuration through the mock error, without starting a real Tauri backend.

`npm run test:e2e` automatically reserves a free HTTP port for each run; `E2E_PORT=4321 npm run test:e2e` can force a single port in CI or for diagnosis. The SQLite WASM control server also uses a system-assigned port, and reports/results are stored by port to allow concurrent runs.
The `1422` sometimes visible in historical examples is not reserved: the dynamic runner is the configuration used by `npm run test:e2e`.
The stable configuration uses `workers: 1` and `fullyParallel: false`, because scenarios share the mock server for one run. A direct `npx playwright test` invocation must provide `E2E_PORT` (`E2E_PORT=4321 npx playwright test`); no fixed fallback port is accepted. `E2E_WORKERS=2 npm run test:e2e` is possible only for fixtures explicitly isolated per test. Application port reservation happens before Playwright's `webServer` starts: a very small TOCTOU window remains between releasing the reservation and the actual bind, while the control port is chosen directly by the launcher at startup.

`defaultPeriodDays` is constrained to `1..3650` days. An invalid value falls back to 30 days in the mock E2E scenario; validation rules and real SQLite/Tauri behavior are covered in Rust. The `?e2e=no-settings` scenario represents a missing file: the mock returns `Settings::default()` without diagnostics or persistence. The `?e2e=settings-invalid` scenario remains dedicated to invalid JSON/configuration. Mock browser tests do not replace Rust watcher tests or real Tauri IPC tests; they cover only the frontend and its mock adapter.

## Structure

```
src-tauri/          Rust backend (Tauri 2)
  src/
    model.rs        Shared types (SessionRecord, Settings, ...)
    cost.rs         Per-message cost calculation
    jsonc.rs        Comment removal + trailing commas (JSONC)
    config.rs       Rate extraction from opencode.jsonc
    db.rs           opencode.db read access (rusqlite, read-only)
    aggregate.rs    Session aggregation
    settings.rs     settings.json loading/saving
    commands.rs     Tauri commands (get_data, get_settings, ...)
    watcher.rs      DB file monitoring (live mode)
src/                React + TypeScript + Vite frontend
  components/       Header, FilterBar, KpiCards, SessionTable, SettingsModal, charts/
  lib/aggregate.ts  Client-side filtering + aggregations
  theme.ts          OS-aware theme
  api.ts            Tauri API client
```
