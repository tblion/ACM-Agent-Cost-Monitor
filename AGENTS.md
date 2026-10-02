# AGENTS.md

Application desktop Electron/React 19 avec un backend .NET 10/C#. Electron main expose les API natives par preload/IPC et supervise le backend via JSON Lines sur stdin/stdout. Le backend lit `opencode.db` en lecture seule, calcule les coûts, produit l'audit et surveille la base.

## Commandes

- `npm ci` installe exactement `package-lock.json`.
- `npm run electron:dev` lance le renderer Vite, compile Electron main/preload et le backend .NET, puis ouvre l'application desktop.
- `npm run dev:mock` lance le renderer dans un navigateur avec des données de démonstration (`VITE_OPENCODE_MOCK=true`), sur le port 1421.
- `npm run build` exécute `tsc && vite build` pour le frontend.
- `npm run electron:build:desktop` compile le frontend, Electron main/preload et vérifie leur typage.
- `npm run desktop:package` construit l'installateur de l'OS hôte avec un backend .NET autonome.
- `dotnet build src-dotnet/OpencodeCostsViewer.Backend.csproj -c Release` compile le backend.
- `npm run test:e2e` valide les scénarios navigateur mockés ; `npm run test:e2e:electron` lance Electron avec le vrai backend et une base fixture isolée ; `npm run test:e2e:packaged` construit le bundle de l'OS hôte et le teste.
- `npm run test:release` teste le générateur de catalogue sans remplacer le catalogue embarqué.
- `npm run release:prepare` génère un catalogue temporaire, le valide avec le backend .NET, puis le remplace atomiquement. Une source alternative se passe avec `-- --source chemin/vers/source.json`.

## Releases multiplateformes

Chaque version publiée doit fournir des installateurs pour les trois familles de systèmes avant d'être considérée comme complète :

- Windows x64 : NSIS `.exe` par utilisateur et MSI par machine pour la DSI.
- macOS : DMG Apple Silicon et Intel, avec alias vers `/Applications`.
- Linux x64 : paquet Debian/Ubuntu `.deb`.

Checklist obligatoire pour chaque release :

1. Utiliser une version SemVer sans préfixe dans `package.json` et `package-lock.json` (`1.0.0`) et un tag Git conventionnel avec préfixe (`v1.0.0`).
2. Pousser le tag et attendre la fin du workflow `Release desktop bundles`.
3. Vérifier sur GitHub les cinq installateurs : NSIS `.exe`, MSI, DMG Apple Silicon, DMG Intel et Linux `.deb`.
4. Ne pas annoncer la release comme complète tant que les quatre jobs de bundles (Windows, macOS Apple Silicon, macOS Intel et Linux) ne sont pas verts et que les cinq assets sont présents. Le workflow échoue si un format/architecture manque.

Commande de contrôle : `gh release view vX.Y.Z --repo tblion/OpencodeCostsViewer --json isDraft,isPrerelease,assets`.

## Architecture et contraintes

- `src-dotnet/Infrastructure/OpencodeDatabase.cs` ouvre `opencode.db` en lecture seule (`Microsoft.Data.Sqlite.Core`, `Mode=ReadOnly`) ; aucune migration, écriture ou réécriture de cette base n'est permise.
- Les chemins OpenCode suivent XDG sur tous les OS : `$XDG_DATA_HOME/opencode/opencode.db` ou `~/.local/share/opencode/opencode.db`, et `$XDG_CONFIG_HOME/opencode/opencode.jsonc` ou `~/.config/opencode/opencode.jsonc`. Ne pas remplacer cela par `dirs::data_dir()` ou `dirs::config_dir()`.
- `opencode.jsonc` accepte commentaires et virgules finales ; `src-dotnet/Infrastructure/JsoncReader.cs` les retire avant le parsing JSON.
- Le catalogue `src-dotnet/Resources/pricing.json` est versionné par provider, modèle et `effectiveFrom`; le calcul historique prend le dernier tarif applicable à la date du message.
- Le raisonnement est facturé au tarif `output` dans `src-dotnet/Application/CostCalculator.cs`.
- SQLite utilise le provider système (`winsqlite3` sous Windows, `sqlite3` sous macOS/Linux), sans bundle natif `e_sqlite3`; le `.deb` dépend de `libsqlite3-0`.
- Le renderer n'a aucun accès direct à Node.js : toutes les capacités desktop passent par l'API nommée du preload Electron.
- Le mode live surveille les changements du fichier DB, débounce une seconde et déclenche un rafraîchissement ; les recalculs restent en mémoire.

## Validation

- Tests C# : désactivés temporairement ; à réactiver une fois la migration stable.
- Validation : uniquement Playwright E2E sur le vrai backend/Electron ou sur le mode navigateur mock, et scénarios MCP Chrome/API externes autorisés.
- Tout changement de coût ou de SQLite doit conserver un test E2E avec une base fixture isolée ; ne jamais pointer un scénario de test vers la base réelle de l'utilisateur.

## Conventions

- TypeScript est strict (`noUnusedLocals`, `noUnusedParameters`) ; aucun ESLint/Prettier n'est configuré.
- Le code est en anglais et les commentaires ajoutés sont en anglais.
- Tout changement frontend doit conserver l'accessibilité WCAG 2.2 / RGAA 4.1.2.
- `used_custom_rate` signifie « au moins un message avec tarif custom » dans l'app ; le champ legacy `TarifCustomUtil` signifie « tous les messages ». Cela ne change pas le coût.
