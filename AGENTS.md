# Instructions pour les agents

## Commandes utiles

- `npm ci` installe les dépendances selon `package-lock.json` (Node.js 22 LTS et .NET SDK 10 requis pour le développement desktop).
- `npm run dev:mock` lance le renderer dans le navigateur avec données de démonstration, sur le port 1421.
- `npm run electron:dev` compile le backend .NET, lance Vite et Electron en mode développement.
- `npm run build` typechecke et construit uniquement le renderer React. Pour vérifier les processus Electron : `npm run electron:build:desktop`.
- `npm test -- --run src/chemin/du-test.test.ts` exécute un test Vitest ciblé.
- `npm run test:e2e -- e2e/nom-du-scenario.spec.ts` exécute un scénario Playwright navigateur mocké ciblé. `npm run test:e2e:electron` teste Electron avec le vrai backend; `npm run test:e2e:packaged` construit puis teste le bundle de l'OS hôte.
- `npm run test:release` teste le générateur de catalogue; `npm run release:prepare` génère et valide le catalogue embarqué avant son remplacement atomique. Source facultative : `npm run release:prepare -- --source chemin/vers/source.json`.
- `dotnet build src-dotnet/OpencodeCostsViewer.Backend.csproj -c Release` compile le backend seul.

## Architecture et points sensibles

- L'application desktop est composée d'un renderer React/TypeScript (`src/`), d'Electron main/preload (`electron/`) et d'un backend .NET 10 (`src-dotnet/`). Les échanges backend utilisent JSON Lines sur stdin/stdout; le renderer accède aux fonctions desktop uniquement via l'API du preload et IPC.
- La version actuelle prend en charge OpenCode seulement. La base `opencode.db` est ouverte en lecture seule : ne jamais la migrer, modifier ni utiliser la base réelle dans les tests.
- Les E2E navigateur utilisent des fixtures isolées (`e2e/fixtures/isolated-fixture.ts`); les scénarios Electron isolent aussi les chemins XDG. Toute modification des coûts ou de SQLite doit être vérifiée avec ces scénarios et une base fixture.
- Les chemins de base et de configuration OpenCode suivent XDG (`$XDG_DATA_HOME` / `~/.local/share`, `$XDG_CONFIG_HOME` / `~/.config`) sur les trois OS. Ne pas remplacer cette résolution par les répertoires de données/config spécifiques à l'OS.
- `opencode.jsonc` peut contenir commentaires et virgules finales. Respecter ce format lors de son parsing.
- Le tarif du catalogue est historisé par provider, modèle et `effectiveFrom`; les messages utilisent le tarif applicable à leur date. Les tokens de raisonnement sont facturés au tarif `output`.
- SQLite utilise les bibliothèques système (`winsqlite3` Windows, `sqlite3` macOS/Linux); le paquet Linux dépend de `libsqlite3-0`.

## Validation et conventions

- Les tests C# sont temporairement désactivés. La validation attendue est Playwright E2E (mock ou application Electron réelle) et scénarios MCP Chrome/API externes autorisés.
- TypeScript est strict; aucun ESLint ou Prettier n'est configuré. Le code et tous les commentaires sont en anglais.
- Ajouter un bref en-tête décrivant le rôle aux fichiers source et de configuration maintenus lorsque leur format prend en charge les commentaires. Les commentaires internes expliquent uniquement les intentions, contraintes ou comportements non évidents; ils ne paraphrasent pas le code.
- Ne pas ajouter de commentaires aux formats de données stricts, aux fichiers générés, dépendances, lockfiles, binaires ou artefacts de build.
- Préserver l'accessibilité WCAG 2.2 / RGAA 4.1.2 dans les changements frontend.
