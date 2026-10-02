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

- [Node.js](https://nodejs.org) 22 LTS (`^20.19.0` or `>=22.12.0`).
- [.NET SDK](https://dotnet.microsoft.com/download/dotnet/10.0) 10.0 for development and local builds.
- macOS bundle builds require Xcode Command Line Tools (`xcode-select --install`).

For Electron development/builds on Debian or Ubuntu, install Electron's desktop libraries and SQLite:

```sh
sudo apt update
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils \
  libatspi2.0-0 libuuid1 libsecret-1-0 libsqlite3-0
```

End-user installers include a self-contained .NET backend; users do not need Node.js or .NET installed.

## Installation

```sh
git clone https://github.com/tblion/OpencodeCostsViewer.git
cd OpencodeCostsViewer
npm ci
```

## Development and local builds

```sh
npm run electron:dev
```

`electron:dev` starts Vite, builds the Electron main/preload processes, builds the .NET backend, and opens the desktop window. `npm run build` checks only the React renderer. `npm run desktop:package` builds the installer for the current host OS.

Each platform produces its own installer:

- **Windows x64:** NSIS `.exe` for a per-user install (no administrator rights), plus MSI for a per-machine install managed by IT (administrator rights required). Both create one Start Menu shortcut and no desktop shortcut. Do not install both variants on the same machine.
- **macOS:** Apple Silicon and Intel DMGs; each DMG contains the app and an `Applications` folder alias for drag-and-drop installation.
- **Linux x64:** Debian/Ubuntu `.deb`, which installs one desktop/menu launcher and depends on the system `libsqlite3-0` library.

## GitHub releases

The `.github/workflows/release.yml` workflow builds and publishes these installers for each `v*` tag:

- macOS Apple Silicon (`aarch64`)
- macOS Intel (`x86_64`)
- Windows x64 (`.exe` and `.msi`)
- Linux x64 (`.deb`)

After synchronizing the project version to `1.2.3`, publish the matching tag from `main`:

```sh
git tag v1.2.3
git push origin v1.2.3
```

The release workflow requires a `v`-prefixed SemVer tag and verifies synchronized project versions before packaging. A separate manual Windows workflow can rebuild the NSIS and MSI installers for an existing release; it verifies that all five platform installers are present before succeeding. MSI upgrades are distributed by the DSI; NSIS is the per-user consumer installer.

macOS signing/notarization and Windows signing are enabled in CI when their certificate and Apple notarization secrets are configured. Without those secrets, the installers are unsigned and the operating system may display a security warning on first launch.

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

The embedded catalog contains official API rates collected on September 23, 2026. The declared source is `src-tauri/catalog/pricing-source.json` during the Rust validator transition. `effectiveFrom` dates are the catalog adoption dates because providers do not publish historical effective dates. Rates use the standard short-context tier; the Google Gemini Pro rate uses the `<=200k` token tier because the application does not know prompt size, and DeepSeek rates intentionally use the peak tier. To prepare a release, the repository generates a temporary catalog, validates it with the legacy Rust CLI, and replaces the embedded catalog atomically only after validation. The .NET application validates the catalog again when loading it at runtime:

> Until the historical catalog validator is ported to .NET, preparing a pricing release also requires the stable Rust toolchain. Rust is not needed for normal development or application builds.

```sh
npm run release:prepare
```

An alternative local source can be provided explicitly with `npm run release:prepare -- --source path/to/source.json`. A missing, unparsable, empty, ambiguous, or incomplete source makes the command fail without replacing the last valid catalog. CI runs this command before the Electron bundles.

> A macOS bundle must be built **on a Mac**; a Windows bundle must be built **on Windows**.

## Configuration

On first launch, the application uses opencode's default paths (XDG convention, identical on all three operating systems):

| Item | Default path |
|---|---|
| Database | `~/.local/share/opencode/opencode.db` (or `$XDG_DATA_HOME/opencode/opencode.db`) |
| Configuration (rates) | `~/.config/opencode/opencode.jsonc` (or `$XDG_CONFIG_HOME/opencode/opencode.jsonc`) |

If your opencode installation uses different paths, change them in **Settings** (the header's gear icon) with the *Browse...* buttons. The choice is stored in `settings.json` (the application's configuration directory).

## End-to-end validation

```sh
npx playwright install chromium
npm run test:e2e
npm run test:e2e:electron
npm run test:e2e:packaged
```

`test:e2e` exercises the browser demo with isolated SQLite WASM fixtures. `test:e2e:electron` launches the development Electron app with the real .NET backend. `test:e2e:packaged` builds the host installer and runs the same scenarios against its packaged application bundle. The native scenarios cover read-only database behavior, costs, audit, settings, file dialogs, export, and live mode; none reads or modifies a user's `opencode.db`.

## Structure

```
electron/            Electron main, sandboxed preload, IPC, and backend process
src-dotnet/           C# backend: SQLite, pricing, costs, audit, settings, watcher
src/                  React 19 + TypeScript + Vite frontend
  components/         Header, filters, KPIs, session table, modals, charts
  app/                Data, settings, audit, and live-mode hooks
  api.ts              Typed Electron preload adapter
```
