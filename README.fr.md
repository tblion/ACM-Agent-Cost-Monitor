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

- [Node.js](https://nodejs.org) 22 LTS (`^20.19.0` ou `>=22.12.0`).
- [.NET SDK](https://dotnet.microsoft.com/download/dotnet/10.0) 10.0 pour le développement et les builds locaux.
- Les bundles macOS nécessitent les Xcode Command Line Tools (`xcode-select --install`).

Pour le développement et les builds Electron sous Debian/Ubuntu, installer les bibliothèques desktop d'Electron et SQLite :

```sh
sudo apt update
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils \
  libatspi2.0-0 libuuid1 libsecret-1-0 libsqlite3-0
```

Les installateurs utilisateurs incluent un backend .NET autonome ; Node.js et .NET n'ont pas à être installés séparément.

## Installation

```sh
git clone https://github.com/tblion/OpencodeCostsViewer.git
cd OpencodeCostsViewer
npm ci
```

## Développement et builds locaux

```sh
npm run electron:dev
```

`electron:dev` démarre Vite, compile les processus main/preload Electron, compile le backend .NET et ouvre la fenêtre desktop. `npm run build` vérifie uniquement le renderer React. `npm run desktop:package` génère l'installateur de l'OS hôte.

Chaque système dispose de son installateur :

- **Windows x64 :** NSIS `.exe` pour une installation par utilisateur (sans droits administrateur), et MSI par machine destiné notamment aux déploiements DSI (droits administrateur requis). Chaque variante crée un seul raccourci dans le menu Démarrer, sans raccourci bureau. Ne pas installer les deux variantes sur le même poste.
- **macOS :** DMG Apple Silicon et Intel, contenant l'application et un alias vers `Applications` pour l'installation par glisser-déposer.
- **Linux x64 :** paquet `.deb` Debian/Ubuntu, avec une seule entrée de lancement et une dépendance vers la bibliothèque système `libsqlite3-0`.

## Releases GitHub

Le workflow `.github/workflows/release.yml` compile et publie les installateurs suivants pour chaque tag `v*` :

- macOS Apple Silicon (`aarch64`)
- macOS Intel (`x86_64`)
- Windows x64 (`.exe` et `.msi`)
- Linux x64 (`.deb`)

Après synchronisation de la version du projet en `1.2.3`, publier le tag correspondant depuis `main` :

```sh
git tag v1.2.3
git push origin v1.2.3
```

Le workflow vérifie que le tag SemVer `v...` correspond aux versions synchronisées du projet avant de construire les installateurs. Le workflow `.github/workflows/windows-release.yml`, lancé manuellement, peut reconstruire le `.exe` NSIS et le MSI pour une release existante ; il vérifie que les cinq installateurs multiplateformes sont présents. Les mises à jour MSI sont distribuées par la DSI ; le `.exe` NSIS est destiné aux installations par utilisateur.

La signature/notarisation macOS et la signature Windows sont activées en CI si les secrets de certificat et de notarisation Apple sont configurés. Sans ces secrets, les installateurs ne sont pas signés et le système peut afficher un avertissement de sécurité au premier lancement.

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

Le catalogue embarqué contient les tarifs API officiels relevés le 23 septembre 2026. La source déclarée est `src-tauri/catalog/pricing-source.json` pendant la transition du validateur Rust. Les dates `effectiveFrom` sont les dates d'adoption du catalogue, faute de dates d'effet historiques publiées par les fournisseurs. Les tarifs sont ceux du standard short-context ; le tarif Google Gemini Pro correspond au palier `<=200k` tokens, car l'application ne connaît pas la taille du prompt, et les tarifs DeepSeek utilisent volontairement le palier peak. Pour préparer une release, le dépôt génère un catalogue temporaire, le valide avec l'ancien CLI Rust, puis remplace le catalogue embarqué atomiquement uniquement après validation. L'application .NET valide aussi le catalogue lors de son chargement à l'exécution :

> Tant que le validateur historique du catalogue n'est pas porté en .NET, la préparation d'une release de tarifs nécessite aussi Rust stable. Rust n'est pas requis pour le développement ni les builds habituels de l'application.

```sh
npm run release:prepare
```

Une autre source locale peut être fournie explicitement avec `npm run release:prepare -- --source chemin/vers/source.json`. Une source absente, non parseable, vide, ambiguë ou incomplète fait échouer la commande sans remplacer le dernier catalogue valide. La CI exécute cette commande avant les bundles Electron.

> Un bundle macOS doit être construit **sur un Mac** ; un bundle Windows, **sur Windows**.

## Configuration

Au premier lancement, l'application utilise les chemins par défaut d'opencode (convention XDG, identiques sur les trois systèmes) :

| Élément | Chemin par défaut |
|---|---|
| Base de données | `~/.local/share/opencode/opencode.db` (ou `$XDG_DATA_HOME/opencode/opencode.db`) |
| Configuration (tarifs) | `~/.config/opencode/opencode.jsonc` (ou `$XDG_CONFIG_HOME/opencode/opencode.jsonc`) |

Si votre installation opencode utilise d'autres chemins, modifiez-les dans **Réglages** (icône ⚙ du header) via les boutons *Parcourir...*. Le choix est mémorisé dans `settings.json` (dossier de configuration de l'application).

## Validation E2E

```sh
npx playwright install chromium
npm run test:e2e
npm run test:e2e:electron
npm run test:e2e:packaged
```

`test:e2e` vérifie le renderer dans un navigateur avec des fixtures SQLite WASM isolées. `test:e2e:electron` lance l'application Electron de développement avec le vrai backend .NET. `test:e2e:packaged` construit l'installateur de l'OS hôte et exécute les mêmes scénarios sur son bundle installé. Les scénarios natifs couvrent la lecture seule SQLite, les coûts, l'audit, les réglages, les dialogues, l'export et le mode live ; aucun ne lit ni ne modifie la base `opencode.db` d'un utilisateur.

## Structure

```
electron/             Processus main Electron, preload sécurisé, IPC, backend enfant
src-dotnet/            Backend C# : SQLite, tarifs, coûts, audit, réglages, watcher
src/                   Frontend React 19 + TypeScript + Vite
  components/          Header, filtres, KPIs, tableau, modales, graphiques
  app/                 Hooks de données, réglages, audit et mode live
  api.ts               Adaptateur typé du preload Electron
```
