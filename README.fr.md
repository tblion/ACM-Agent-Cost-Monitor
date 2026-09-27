# Opencode Costs Viewer

[English](README.md)

Application desktop pour Windows, macOS et Linux qui calcule le coût en tokens et en dollars de chaque session et projet **opencode**, à partir de la base locale `opencode.db`. Elle remplace le script PowerShell legacy `Get-OpencodeSessionCosts.ps1` (conservé dans `_old/`).

Contrairement au script, elle offre une interface graphique : filtres, graphiques, tableau triable, mode live et réglages persistants.

## Fonctionnalités

- **KPIs** : coût total, tokens, nombre de sessions (dont sous-agents), nombre de projets sur la période filtrée.
- **Filtres** : par projet, modèle, provider et plage de dates.
- **Graphiques** : coût dans le temps, par projet, modèle et provider ; décomposition des tokens ; top sessions coûteuses ; coût par groupe de projet (dossier parent automatique et groupes personnalisés).
- **Tableau des sessions** : triable par date ou coût, avec badge `tarif ✓` (tarif custom appliqué) ou `coût 0` (modèle local/gratuit, signalé mais non masqué).
- **Mode live** : le bouton `LIVE` dans le header active la mise à jour automatique dès que la base opencode change (surveillance du fichier avec debounce).
- **Réglages persistants** : chemins de la base et de la configuration, thème (système/clair/sombre), période par défaut et groupes de projet personnalisés. Sauvegardés dans `settings.json`.

Le coût est recalculé avec les tarifs custom de `opencode.jsonc` (`provider.<id>.models.<model>.cost`) ; à défaut, le coût déjà stocké par opencode est utilisé. Les tokens de reasoning sont facturés au tarif `output`.

## Prérequis

### Tous les systèmes

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) `^20.19.0` ou `>=22.12.0` (Node.js 22 LTS recommandé)

### Windows

- **Microsoft C++ Build Tools** : téléchargez l'installateur depuis [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) et cochez **Desktop development with C++**.
- **WebView2** : préinstallé sur les systèmes Windows 10/11 récents. Sinon, installez le [runtime WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

### macOS

- **Xcode Command Line Tools** :
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

> Fedora : `sudo dnf install webkit2gtk4.1-devel` · Arch : `sudo pacman -S webkit2gtk-4.1`

## Installation

```sh
git clone https://github.com/tblion/OpencodeCostsViewer.git
cd OpencodeCostsViewer
npm ci
```

## Développement

### Mode développement

```sh
npm run tauri dev
```

Cette commande compile le backend Rust, démarre le serveur Vite et ouvre la fenêtre de l'application.

## Compilation locale

La compilation locale produit les installateurs de la plateforme sur laquelle la commande est exécutée. Tauri ne fabrique pas automatiquement les bundles des autres systèmes depuis macOS, Windows ou Linux.

### macOS

```sh
npm run tauri build
```

Sur Apple Silicon, les artefacts sont générés dans :

```text
src-tauri/target/release/bundle/macos/Opencode Costs Viewer.app
src-tauri/target/release/bundle/dmg/Opencode Costs Viewer_<version>_aarch64.dmg
```

Sur un Mac Intel, le nom du DMG contient `x86_64` au lieu de `aarch64`.

### Windows

Dans PowerShell :

```powershell
npm run tauri build
```

Les installateurs sont générés dans `src-tauri/target/release/bundle/`, notamment :

```text
nsis/*.exe
msi/*.msi
```

### Linux

```sh
npm run tauri build
```

Les artefacts sont générés dans `src-tauri/target/release/bundle/`, notamment :

```text
appimage/*.AppImage
deb/*.deb
rpm/*.rpm
```

### Build frontend uniquement

Pour vérifier le frontend sans compiler Tauri :

```sh
npm run build
```

## Releases GitHub

Le workflow `.github/workflows/release.yml` compile et publie les bundles suivants pour chaque tag `v*` :

- macOS Apple Silicon (`aarch64`)
- macOS Intel (`x86_64`)
- Windows x64 (`.exe` et `.msi`)
- Linux x64 (`.deb`, `.rpm` et `.AppImage`)

Pour publier une nouvelle release depuis `main` :

```sh
git tag v1.1.0-beta.1
git push origin v1.1.0-beta.1
```

Le workflow de release s'exécute pour tout tag `v*` et dérive le tag de release depuis la version de `package.json`, `Cargo.toml` et `tauri.conf.json`. La version actuelle est `v1.1.0-beta.1`, publiée comme pré-release. Le workflow peut aussi être lancé depuis l'onglet **Actions** de GitHub. Le workflow `.github/workflows/windows-release.yml` permet en plus de reconstruire uniquement l'installateur Windows et de le rattacher à une release existante en indiquant son tag, par exemple `v1.1.0-beta.1`.

Les bundles publiés actuellement ne sont pas signés. macOS et Windows peuvent donc afficher un avertissement de sécurité au premier lancement.

### Autoriser l'application sur macOS

Après téléchargement du DMG :

1. Ouvrir le DMG et glisser `Opencode Costs Viewer.app` dans **Applications**.
2. Faire un clic droit sur l'application, choisir **Ouvrir**, puis confirmer **Ouvrir**.
3. Si macOS bloque encore l'ouverture, aller dans **Réglages Système -> Confidentialité et sécurité** et cliquer sur **Ouvrir quand même**.

Si macOS affiche « l'application est endommagée et ne peut pas être ouverte », retirer uniquement l'attribut de quarantaine de l'application copiée dans Applications :

```sh
xattr -dr com.apple.quarantine "/Applications/Opencode Costs Viewer.app"
```

Relancer ensuite l'application. Cette commande contourne la protection de téléchargement macOS ; ne l'utiliser que pour un bundle provenant de ce dépôt ou d'une release de confiance. Elle ne répare pas un binaire réellement corrompu et ne signe pas l'application.

Pour supprimer ces avertissements automatiquement pour tous les utilisateurs, il faut signer l'application avec un certificat Apple Developer ID et la faire notarier par Apple. Cette configuration n'est pas encore activée dans le dépôt.

## Catalogue de tarifs et releases

Le catalogue embarqué contient les tarifs API officiels relevés le 23 septembre 2026. La source déclarée est `src-tauri/catalog/pricing-source.json`. Les dates `effectiveFrom` sont les dates d'adoption du catalogue, faute de dates d'effet historiques publiées par les fournisseurs. Les tarifs sont ceux du standard short-context ; le tarif Google Gemini Pro correspond au palier `<=200k` tokens, car l'application ne connaît pas la taille du prompt, et les tarifs DeepSeek utilisent volontairement le palier peak. Pour préparer une release, le dépôt génère un catalogue temporaire, le valide avec le même validateur Rust que l'application, puis le remplace atomiquement uniquement après validation :

```sh
npm run release:prepare
```

Une autre source locale peut être fournie explicitement avec `npm run release:prepare -- --source chemin/vers/source.json`. Une source absente, non parseable, vide, ambiguë ou incomplète fait échouer la commande sans remplacer le dernier catalogue valide. La CI exécute cette commande avant le bundle Tauri.

> Un bundle macOS doit être construit **sur un Mac** ; un bundle Windows, **sur Windows**.

## Configuration

Au premier lancement, l'application utilise les chemins par défaut d'opencode (convention XDG, identiques sur les trois systèmes) :

| Élément | Chemin par défaut |
|---|---|
| Base de données | `~/.local/share/opencode/opencode.db` (ou `$XDG_DATA_HOME/opencode/opencode.db`) |
| Configuration (tarifs) | `~/.config/opencode/opencode.jsonc` (ou `$XDG_CONFIG_HOME/opencode/opencode.jsonc`) |

Si votre installation opencode utilise d'autres chemins, modifiez-les dans **Réglages** (icône ⚙ du header) via les boutons *Parcourir...*. Le choix est mémorisé dans `settings.json` (dossier de configuration de l'application).

## Tests

```sh
# Tests backend (Rust) : coût, JSONC, configuration, agrégation, settings
cd src-tauri && cargo test

# Tests frontend (TypeScript) : filtrage + agrégations
npm test

# Tests E2E Playwright : frontend mock isolé, Chromium headless
npx playwright install chromium
npm run test:e2e

```

Pour le test d'acceptation, fournir un snapshot de la base et un CSV généré par le script legacy.

Shells POSIX (macOS/Linux) :

```sh
cd src-tauri
ACCEPTANCE_DB="/chemin/vers/opencode.db" \
ACCEPTANCE_CSV="/chemin/vers/opencode-costs.csv" \
cargo test --test acceptance_test -- --nocapture
```

PowerShell (Windows) :

```powershell
cd src-tauri
$env:ACCEPTANCE_DB = "C:\chemin\vers\opencode.db"
$env:ACCEPTANCE_CSV = "C:\chemin\vers\opencode-costs.csv"
cargo test --test acceptance_test -- --nocapture
```

Les tests E2E démarrent automatiquement le frontend mock sur un port `127.0.0.1` libre avec `VITE_E2E=true`. Le launcher lit `e2e/fixtures/opencode-fixture.sql`, crée deux copies SQLite WASM isolées avec `sql.js`, génère les snapshots JSON par requêtes SQLite, puis transmet explicitement au serveur le manifeste, les snapshots, leurs chemins et leur hash via des variables d'environnement ; le mock charge le snapshot sélectionné comme source initiale. L'opération live `window.__E2E__.mutateSql()` exécute un INSERT dans la copie primaire, régénère son snapshot et déclenche le rechargement applicatif. Le changement de `dbPath` via `SettingsModal`/`save_settings` sélectionne le snapshot de la seconde copie. Aucun test ne lit ni n'écrit `opencode.db`. Le navigateur mock ne peut pas exécuter le vrai backend Tauri, SQLite ou watcher natif : ces tests valident la fixture SQLite WASM et le flux mock, tandis que l'exécution SQLite/watcher réelle est couverte par les tests Rust. Les scénarios initiaux sont sélectionnés par query string ; les changements live et de données passent par `window.__E2E__`, indisponible hors de ce mode. Le scénario `?e2e=no-settings` simule explicitement l'absence de configuration via l'erreur du mock, sans démarrer un backend Tauri réel.

`npm run test:e2e` réserve automatiquement un port HTTP libre pour chaque exécution ; `E2E_PORT=4321 npm run test:e2e` permet d'imposer un port unique en CI ou pour le diagnostic. Le serveur de contrôle SQLite WASM utilise lui aussi un port attribué par le système, et les rapports/résultats sont rangés par port pour permettre deux exécutions concurrentes.
Le `1422` éventuellement visible dans les exemples historiques n'est pas réservé : le runner dynamique est la configuration utilisée par `npm run test:e2e`.
La configuration stable utilise `workers: 1` et `fullyParallel: false`, car les scénarios partagent le serveur mock d'une exécution. Une invocation directe `npx playwright test` doit fournir `E2E_PORT` (`E2E_PORT=4321 npx playwright test`) ; aucun port fixe de repli n'est accepté. `E2E_WORKERS=2 npm run test:e2e` est possible uniquement pour des fixtures explicitement isolées par test. La réservation du port applicatif précède le démarrage `webServer` de Playwright : une très petite fenêtre TOCTOU subsiste entre la fermeture de la réservation et le bind réel, tandis que le port de contrôle est choisi directement par le launcher au démarrage.

`defaultPeriodDays` est borné à `1..3650` jours. Une valeur invalide est repliée à 30 jours dans le scénario mock E2E ; les règles de validation et le comportement SQLite/Tauri réels sont couverts côté Rust. Le scénario `?e2e=no-settings` représente un fichier absent : le mock renvoie `Settings::default()` sans diagnostic et sans persistance. Le scénario `?e2e=settings-invalid` reste dédié au JSON/configuration invalide. Les tests browser mock ne remplacent pas les tests Rust du watcher ni les tests IPC Tauri réels ; ils couvrent uniquement le frontend et son adaptateur mock.

## Structure

```
src-tauri/          Backend Rust (Tauri 2)
  src/
    model.rs        Types partagés (SessionRecord, Settings, ...)
    cost.rs         Calcul du coût par message
    jsonc.rs        Suppression de commentaires + virgules finales (JSONC)
    config.rs       Extraction des tarifs depuis opencode.jsonc
    db.rs           Lecture de opencode.db (rusqlite, lecture seule)
    aggregate.rs    Agrégation par session
    settings.rs     Chargement/sauvegarde de settings.json
    commands.rs     Commandes Tauri (get_data, get_settings, ...)
    watcher.rs      Surveillance du fichier DB (mode live)
src/                Frontend React + TypeScript + Vite
  components/       Header, FilterBar, KpiCards, SessionTable, SettingsModal, charts/
  lib/aggregate.ts  Filtrage + agrégations côté client
  theme.ts          Thème adapté au système
  api.ts            Client de l'API Tauri
```
