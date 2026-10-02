# ACM Agent Cost Monitor

[English](README.md)

Application desktop pour Windows, macOS et Linux, conçue pour suivre le coût et l'utilisation de tokens des agents de développement IA. **La version actuelle prend uniquement OpenCode en charge** : elle lit ses sessions dans la base locale `opencode.db`. Claude Code, Cline, Kilo Code et les autres agents ne sont pas encore pris en charge.

Contrairement au script, elle offre une interface graphique : filtres, graphiques, tableau triable, mode live et réglages persistants.

## Fonctionnalités

- **KPIs** : coût total, tokens, nombre de sessions (dont sous-agents), nombre de projets sur la période filtrée.
- **Filtres** : par projet, modèle, provider et plage de dates.
- **Graphiques** : coût dans le temps, par projet, modèle et provider ; décomposition des tokens ; top sessions coûteuses ; coût par groupe de projet (dossier parent automatique et groupes personnalisés).
- **Audit** : retracer les lignes de base, tarifs et compteurs de tokens à l'origine des totaux affichés.
- **Tableau des sessions** : triable par date ou coût, avec badge `tarif ✓` (tarif custom appliqué) ou `coût 0` (modèle local/gratuit, signalé mais non masqué).
- **Mode live** : le bouton `LIVE` dans le header active la mise à jour automatique dès que la base opencode change (surveillance du fichier avec debounce).
- **Réglages persistants** : chemins de la base et de la configuration des tarifs, thème (système/clair/sombre), langue de l'interface, période par défaut et groupes personnalisés. Enregistrés séparément de la base OpenCode.

## Calcul des coûts et traitement des données

Pour chaque message assistant, le tarif est choisi dans cet ordre :

1. Le tarif custom défini dans `opencode.jsonc` (`provider.<id>.models.<model>.cost`).
2. Le catalogue de tarifs embarqué, selon le tarif applicable à la date du message.
3. Le coût déjà enregistré par OpenCode lorsqu'aucun tarif ne peut être résolu.

Les tokens d'entrée, de sortie, de lecture du cache et d'écriture du cache sont tarifés séparément. Les tokens de reasoning utilisent le tarif `output`. Les calculs sont locaux : aucune clé API ni requête aux API des modèles n'est nécessaire. La base OpenCode est ouverte en lecture seule ; elle n'est ni migrée ni réécrite. L'application écrit uniquement ses propres réglages et les exports demandés par l'utilisateur.

## Téléchargement

Choisir l'installateur correspondant à votre système dans les [releases GitHub](https://github.com/tblion/OpencodeCostsViewer/releases). Les installateurs incluent le backend .NET : les utilisateurs finaux n'ont besoin ni de Node.js ni de .NET. Les paquets disponibles ciblent Windows x64 (NSIS `.exe` et MSI), macOS Apple Silicon/Intel (DMG) et Linux x64 (`.deb`).

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

## Préparation du développement

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

Pour développer uniquement dans un navigateur avec des données de démonstration, lancer `npm run dev:mock` (port 1421). Autres commandes utiles :

| Commande | Utilité |
|---|---|
| `npm run build` | Vérifier les types et compiler le renderer React. |
| `npm run electron:build:desktop` | Compiler le renderer et les processus Electron, puis vérifier leur typage. |
| `npm run desktop:package` | Empaqueter l'application pour le système hôte. |
| `npm run release:prepare` | Générer et valider le catalogue de tarifs embarqué. |

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

1. Ouvrir le DMG et glisser `ACM Agent Cost Monitor.app` dans **Applications**.
2. Faire un clic droit sur l'application, choisir **Ouvrir**, puis confirmer **Ouvrir**.
3. Si macOS bloque encore l'ouverture, aller dans **Réglages Système -> Confidentialité et sécurité** et cliquer sur **Ouvrir quand même**.

Si macOS affiche « l'application est endommagée et ne peut pas être ouverte », retirer uniquement l'attribut de quarantaine de l'application copiée dans Applications :

```sh
xattr -dr com.apple.quarantine "/Applications/ACM Agent Cost Monitor.app"
```

Relancer ensuite l'application. Cette commande contourne la protection de téléchargement macOS ; ne l'utiliser que pour un bundle provenant de ce dépôt ou d'une release de confiance. Elle ne répare pas un binaire réellement corrompu et ne signe pas l'application.

Pour supprimer ces avertissements automatiquement pour tous les utilisateurs, il faut signer l'application avec un certificat Apple Developer ID et la faire notarier par Apple. Cette configuration n'est pas encore activée dans le dépôt.

## Catalogue de tarifs et releases

Le catalogue embarqué contient les tarifs API officiels relevés le 23 septembre 2026. Sa source et sa version générée se trouvent dans `src-dotnet/Resources/`. Les dates `effectiveFrom` sont les dates d'adoption du catalogue, faute de dates d'effet historiques publiées par les fournisseurs. Les tarifs sont ceux du standard short-context ; le tarif Google Gemini Pro correspond au palier `<=200k` tokens, car l'application ne connaît pas la taille du prompt, et les tarifs DeepSeek utilisent volontairement le palier peak. Pour préparer une release, le dépôt génère un catalogue temporaire, le valide avec le backend .NET, puis ne remplace le catalogue embarqué atomiquement qu'après validation. L'application valide aussi le catalogue lors de son chargement à l'exécution :

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
npm run test:release
```

`test:e2e` vérifie le renderer dans un navigateur avec des fixtures SQLite WASM isolées. `test:e2e:electron` lance l'application Electron de développement avec le vrai backend .NET. `test:e2e:packaged` construit l'installateur de l'OS hôte et exécute les mêmes scénarios sur son bundle installé. Les scénarios natifs couvrent la lecture seule SQLite, les coûts, l'audit, les réglages, les dialogues, l'export et le mode live ; aucun ne lit ni ne modifie la base `opencode.db` d'un utilisateur.

## Stack technique et architecture

- **Interface :** React 19, TypeScript, Vite, Recharts et i18next (français/anglais).
- **Application desktop :** Electron avec isolation des contextes, preload sandboxé et aucun accès direct à Node.js depuis le renderer.
- **Backend :** .NET 10 / C#, lancé et supervisé par Electron main. Les requêtes et réponses utilisent JSON Lines sur l'entrée/sortie standard.
- **Stockage :** SQLite via la bibliothèque fournie par le système (`winsqlite3` sous Windows, `sqlite3` sous macOS/Linux). La base OpenCode est en lecture seule ; les réglages de l'application sont séparés.
- **Validation :** scénarios E2E Playwright sur le mock navigateur, l'application Electron/.NET réelle et le bundle desktop empaqueté.

```text
Renderer React -> API typée du preload -> IPC Electron -> backend .NET
                                                         -> SQLite OpenCode (lecture seule)
                                                         -> tarifs OpenCode JSONC
                                                         -> catalogue historique embarqué
```

## Structure du dépôt

```
electron/              Processus main, preload sandboxé, IPC, cycle de vie du backend
src-dotnet/            Backend .NET : SQLite, tarifs, coûts, audit, réglages, watcher
src/                   Renderer React, composants UI, hooks applicatifs et API typée
e2e/                   Scénarios Playwright et fixtures isolées de bases
scripts/               Empaquetage, releases et validation des installateurs
```
