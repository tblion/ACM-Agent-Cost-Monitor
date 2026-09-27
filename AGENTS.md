# AGENTS.md

Application desktop Tauri 2 : backend Rust dans `src-tauri/`, frontend React 19/TypeScript/Vite dans `src/`. Elle lit `opencode.db`, calcule les coûts de sessions et expose l'API Rust via des commandes Tauri.

## Commandes

- `npm ci` installe exactement `package-lock.json`.
- `npm run tauri dev` lance Vite et le backend Rust. `npm run dev` ne lance que Vite.
- `npm run dev:mock` lance le frontend dans un navigateur avec l'API Tauri simulée, en mode démo (`VITE_OPENCODE_MOCK=true`), sur le port 1421.
- `npm run build` exécute `tsc && vite build` pour le frontend.
- `npm test` exécute les tests Vitest ; un fichier ciblé peut être passé à Vitest, par exemple `npm test -- src/lib/rates.test.ts`.
- `cd src-tauri && cargo test` exécute les tests Rust ; pour un test d'intégration ciblé : `cargo test --test pricing_test`.
- `npm run tauri build` construit les bundles natifs dans `src-tauri/target/release/bundle/`.
- `npm run test:release` teste le générateur de catalogue sans remplacer le catalogue embarqué.
- `npm run release:prepare` génère un catalogue temporaire, le valide via le binaire Rust `validate_pricing`, puis le remplace atomiquement. Une source alternative se passe avec `-- --source chemin/vers/source.json`.

## Architecture et contraintes

- `src-tauri/src/db.rs` ouvre `opencode.db` en lecture seule ; aucune migration, écriture ou réécriture de cette base n'est permise.
- Les chemins OpenCode suivent XDG sur tous les OS : `$XDG_DATA_HOME/opencode/opencode.db` ou `~/.local/share/opencode/opencode.db`, et `$XDG_CONFIG_HOME/opencode/opencode.jsonc` ou `~/.config/opencode/opencode.jsonc`. Ne pas remplacer cela par `dirs::data_dir()` ou `dirs::config_dir()`.
- `opencode.jsonc` accepte commentaires et virgules finales ; `src-tauri/src/jsonc.rs` les retire avant le parsing `serde_json`.
- Le catalogue `src-tauri/catalog/pricing.json` est versionné par provider, modèle et `effectiveFrom`; le calcul historique prend le dernier tarif applicable à la date du message.
- Le raisonnement est facturé au tarif `output` dans `src-tauri/src/cost.rs`.
- Le nom de bibliothèque Rust est `opencode_costs_viewer_lib`; le suffixe `_lib` évite un conflit Windows avec le binaire.
- Le mode live surveille les changements de la base et déclenche un rafraîchissement ; les recalculs restent en mémoire.

## Validation des coûts

Le script legacy `_old/Get-OpencodeSessionCosts.ps1` est la référence. Après toute modification de la logique de coût, lancer `src-tauri/tests/acceptance_test.rs` avec une copie de la base dans `ACCEPTANCE_DB` et le CSV legacy dans `ACCEPTANCE_CSV` :

```powershell
$env:ACCEPTANCE_DB = "C:\chemin\snapshot.db"
$env:ACCEPTANCE_CSV = "C:\chemin\opencode-costs.csv"
cd src-tauri
cargo test --test acceptance_test -- --nocapture
```

Sans ces deux variables, le test d'acceptation se termine volontairement sans comparaison.

## Conventions

- TypeScript est strict (`noUnusedLocals`, `noUnusedParameters`) ; aucun ESLint/Prettier n'est configuré.
- Le code est en anglais et les commentaires ajoutés sont en français.
- Tout changement frontend doit conserver l'accessibilité WCAG 2.2 / RGAA 4.1.2.
- `used_custom_rate` signifie « au moins un message avec tarif custom » dans l'app ; le champ legacy `TarifCustomUtil` signifie « tous les messages ». Cela ne change pas le coût.
