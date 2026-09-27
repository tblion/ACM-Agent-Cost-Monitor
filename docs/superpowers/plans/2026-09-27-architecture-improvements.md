# Architecture Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter les huit tâches d'amélioration d'architecture, avec validation JSON des réglages utilisateur au démarrage, sans casser le mode démo ni les contrats Tauri publics.

**Architecture:** Le travail est séquentiel. Le watcher sera possédé par `AppState`, l'orchestration React sera extraite dans quatre hooks, puis les erreurs et services Rust seront structurés avant d'ajouter les contrats et les tests E2E. Chaque tâche conserve les interfaces existantes et doit passer sa validation avant la suivante.

**Tech Stack:** Rust, Tauri 2, React 19, TypeScript, Vite, Vitest, SQLite, notify, Playwright.

---

## Cartographie des fichiers

- `src-tauri/src/watcher.rs` : service de cycle de vie du watcher et signal d'arrêt.
- `src-tauri/src/settings.rs` : lecture, validation et sauvegarde de `settings.json`.
- `src-tauri/src/commands.rs` : adaptateurs Tauri et compatibilité des commandes publiques.
- `src-tauri/src/error.rs` : erreur sérialisable avec code stable.
- `src-tauri/src/application/*.rs` : services métier indépendants de Tauri.
- `src/app/*.ts` : hooks React d'orchestration.
- `src/App.tsx` : composition des hooks, filtres et rendu.
- `src/lib/aggregate.ts` et `src/components/FilterBar.tsx` : dates et filtres.
- `src/api.ts` et `src/types.ts` : contrat frontend/backend.
- `e2e/*.spec.ts` : scénarios Playwright sur fixtures isolées.

## Task 1 : Watcher et validation initiale des réglages

**Files:**
- Modify: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/watcher.rs` tests unitaires et `src-tauri/tests/runtime_test.rs`
- Test: `src-tauri/src/settings.rs` tests unitaires

- [ ] **Step 1: Ajouter les tests de validation des réglages**

Tester les quatre cas suivants : fichier absent retourne `Settings::default()`, JSON mal formé retourne une erreur, JSON valide avec un mauvais type retourne une erreur, et JSON conforme est chargé. Ajouter aussi les cas `defaultPeriodDays <= 0` et période supérieure à la limite retenue, qui retournent une erreur de conformité plutôt qu'une correction silencieuse au chargement.

- [ ] **Step 2: Ajouter le modèle de validation interne**

Dans `settings.rs`, lire le texte avec `read_to_string`, désérialiser dans `serde_json::Value` pour distinguer JSON invalide et schéma invalide, puis désérialiser dans `Settings`. Retourner une erreur structurée interne contenant le chemin, la catégorie et la cause. Le fichier absent reste le seul cas qui retourne silencieusement la valeur par défaut.

- [ ] **Step 3: Écrire les tests du cycle de vie du watcher**

Vérifier qu'un service peut démarrer sur un fichier existant, recevoir un événement, s'arrêter, puis redémarrer sur un autre chemin. Vérifier également qu'un chemin absent ne laisse aucun thread actif et retourne une erreur contrôlée.

- [ ] **Step 4: Implémenter `WatcherService`**

Remplacer `start` par une structure possédant le handle de thread, le sender d'arrêt et le chemin surveillé. Implémenter :

```rust
pub struct WatcherService { /* état synchronisé et handle */ }

impl WatcherService {
    pub fn start_or_restart(&mut self, app: AppHandle, db_path: &Path) -> Result<(), WatcherError>;
    pub fn stop(&mut self);
}
```

Le thread doit sortir sur le signal d'arrêt ou la déconnexion du canal. Le debounce d'une seconde et l'événement `db-changed` sont conservés.

- [ ] **Step 5: Intégrer le service à `AppState` et `save_settings`**

Ajouter le service à l'état géré par Tauri. Charger les réglages au démarrage, initialiser le service sans échouer si la base est absente, puis synchroniser le watcher dans `save_settings` après sauvegarde réussie. Garantir qu'un second démarrage arrête l'ancien watcher avant d'en créer un nouveau.

- [ ] **Step 6: Valider la tâche**

Run: `cd src-tauri && cargo test`

Expected: tous les tests Rust passent, y compris les tests de réglages invalides, du fichier absent et du redémarrage du watcher.

## Task 2 : Période par défaut et dates inclusives

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/FilterBar.tsx`
- Modify: `src/lib/aggregate.ts`
- Test: `src/App.test.tsx`
- Test: `src/components/FilterBar.test.tsx`
- Test: `src/lib/aggregate.test.ts`

- [ ] **Step 1: Écrire les tests de période**

Ajouter un test vérifiant qu'une configuration `defaultPeriodDays: 7` est utilisée lors du chargement et de la réinitialisation. Ajouter un test avec une session à `23:59:59.999` le jour de fin et une session à minuit le jour suivant.

- [ ] **Step 2: Introduire les helpers de bornes locales**

Créer dans `aggregate.ts` des fonctions exportées qui prennent une valeur `YYYY-MM-DD` et construisent une date locale à `00:00:00.000` ou `23:59:59.999`. Ne pas utiliser `toISOString()` pour interpréter une date saisie par l'utilisateur.

- [ ] **Step 3: Modifier `defaultFilters`**

Faire recevoir `defaultFilters(sessions, defaultPeriodDays)`. Si la période est absente, nulle ou invalide, utiliser `30`. Calculer le début à partir d'aujourd'hui moins `period - 1` jours, avec l'heure locale à minuit, et la fin à aujourd'hui `23:59:59.999`.

- [ ] **Step 4: Modifier `FilterBar`**

Afficher les valeurs de date avec une conversion locale `YYYY-MM-DD`. Utiliser les helpers de bornes pour les événements `change`. Le bouton de reset reste fourni par `App`, mais réutilise la période configurée.

- [ ] **Step 5: Valider la tâche**

Run: `npm test -- src/App.test.tsx src/components/FilterBar.test.tsx src/lib/aggregate.test.ts`

Run: `npm run build`

Expected: tests ciblés et build TypeScript passent.

## Task 3 : Extraction de l'orchestration React

**Files:**
- Create: `src/app/useAppData.ts`
- Create: `src/app/useLiveMode.ts`
- Create: `src/app/useSettings.ts`
- Create: `src/app/useAudit.ts`
- Modify: `src/App.tsx`
- Test: `src/app/*.test.ts`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Capturer les comportements actuels dans les tests**

Ajouter des tests pour le chargement initial, le rejet d'une réponse obsolète, le rafraîchissement live, la file de sauvegarde et l'invalidation de l'audit après données ou réglages modifiés.

- [ ] **Step 2: Implémenter `useAppData`**

Déplacer les états `data`, `dataLoading`, `dataError`, `dataUpdatedAt`, les identifiants de requêtes et `publishLoadedData`. Le hook expose `load`, `reload`, `beginBlockingOperation`, `completeBlockingOperation` et `failBlockingOperation`.

- [ ] **Step 3: Implémenter `useSettings`**

Déplacer le chargement de `getSettings`, la synchronisation i18n/thème, `settingsRef` et la file `settingsSaveQueue`. Exposer `settings`, `settingsError`, `saveSettings`, et une mise à jour sérialisée.

- [ ] **Step 4: Implémenter `useLiveMode`**

Déplacer l'abonnement `onDbChanged`, le nettoyage, le toggle live et les garde-fous de sauvegarde. Le hook ne s'abonne jamais en mode démo et annule toujours l'abonnement précédent lors d'un changement de source.

- [ ] **Step 5: Implémenter `useAudit` et réduire `App.tsx`**

Déplacer la génération, l'état stale et les refs d'accessibilité de l'audit. `App.tsx` conserve uniquement la composition, les filtres, les modales et le JSX.

- [ ] **Step 6: Valider la tâche**

Run: `npm test`

Run: `npm run build`

Expected: suite Vitest et build passent sans changement de comportement visible.

## Task 4 : Erreurs Rust typées et validation exposée

**Files:**
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/api.ts`
- Modify: `src/types.ts`
- Modify: `src/i18n/resources.ts`
- Test: tests Rust de sérialisation et de propagation
- Test: `src/api.contract.test.ts`

- [ ] **Step 1: Tester la forme JSON d'une erreur**

Vérifier qu'une erreur sérialise au minimum `code` et `message`, que les codes sont stables, et qu'une erreur de réglages invalides arrive au frontend sous cette forme.

- [ ] **Step 2: Créer `AppError`**

Définir les catégories `Database`, `Configuration`, `Settings`, `Pricing`, `Watcher`, `Export` et `InvalidInput`, avec conversions depuis les erreurs internes. Implémenter `Serialize` ou `Into<tauri::ipc::InvokeError>` selon le mécanisme Tauri présent dans la version utilisée.

- [ ] **Step 3: Convertir les commandes prioritaires**

Faire retourner `Result<T, AppError>` à `get_data`, `save_settings`, `recalculate_data` et `get_audit_report`. Convertir les erreurs de lecture SQLite, configuration, catalogue, validation et watcher sans perdre le contexte technique dans `message`.

- [ ] **Step 4: Ajouter `ApiError` côté TypeScript**

Définir `ApiError { code: string; message: string }`, un garde de type et une fonction de traduction des codes connus. Les appels API doivent conserver leurs types de succès actuels.

- [ ] **Step 5: Valider la tâche**

Run: `cd src-tauri && cargo test`

Run: `npm test`

Run: `npm run build`

Expected: erreurs sérialisées, traductions connues et suite complète passent.

## Task 5 : Services applicatifs Rust

**Files:**
- Create: `src-tauri/src/application/mod.rs`
- Create: `src-tauri/src/application/data_service.rs`
- Create: `src-tauri/src/application/audit_service.rs`
- Create: `src-tauri/src/application/settings_service.rs`
- Create: `src-tauri/src/application/pricing_service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: tests unitaires des quatre services

- [ ] **Step 1: Définir les interfaces des services**

Les services reçoivent des chemins, des réglages et des types métier. Ils ne prennent ni `AppHandle` ni `State`. Les commandes restent responsables uniquement de récupérer l'état Tauri, appeler un service et retourner son résultat.

- [ ] **Step 2: Déplacer les chemins et réglages**

Mettre `resolve_paths` et la synchronisation des réglages dans `settings_service`, en conservant les conventions XDG et les chemins personnalisés.

- [ ] **Step 3: Déplacer les calculs**

Mettre `compute`, `recalculate` et `diagnostics` dans `data_service`. Vérifier que l'agrégation ne modifie jamais la base.

- [ ] **Step 4: Déplacer audit et tarifs**

Mettre `build_audit_report_for_paths` dans `audit_service` et `rates_for_rows` dans `pricing_service`. Ajouter des tests directs avec les fixtures existantes.

- [ ] **Step 5: Simplifier les commandes et valider**

Run: `cd src-tauri && cargo test`

Expected: commandes publiques inchangées et services testables sans démarrer Tauri.

## Task 6 : Optimisations ciblées

**Files:**
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/aggregate.rs`
- Test: tests frontend et Rust associés

- [ ] **Step 1: Ajouter une régression de non-appels inutiles**

Dans les tests de `App`, espionner `getRates` et `getCostSummary` et vérifier qu'un changement de mode ne les appelle pas lorsque seul `getData` est nécessaire.

- [ ] **Step 2: Remplacer la déduplication linéaire**

Dans `pricing_service.rs`, ou le fichier qui porte alors `rates_for_rows`, utiliser un `HashSet` d'une clé dérivée des champs de `RateEntry`. Conserver le tri final et l'égalité complète des résultats.

- [ ] **Step 3: Mesurer et nettoyer `AppState.rates`**

Rechercher toutes les utilisations de `AppState.rates`. Le supprimer seulement si aucune commande ne l'utilise après les tâches précédentes ; sinon le conserver sans ajouter de cache global.

- [ ] **Step 4: Ajouter un test de volume**

Construire plusieurs milliers de lignes synthétiques, comparer les résultats avant/après déduplication et vérifier le nombre de tarifs et l'ordre de sortie.

- [ ] **Step 5: Valider la tâche**

Run: `npm test`

Run: `cd src-tauri && cargo test`

Expected: résultats identiques et tests de volume passent.

## Task 7 : Contrat Rust/TypeScript

**Files:**
- Modify: `src-tauri/src/model.rs`
- Modify: `src/types.ts`
- Modify: `src/api.ts`
- Create: `src/api.contract.test.ts`
- Test: tests Rust de sérialisation

- [ ] **Step 1: Lister les payloads publics**

Documenter dans `api.ts` les payloads de `SessionRecord`, `Settings`, `AuditReport`, `RecalculationResult`, `RateEntry`, `CostSummary`, `CatalogStatus` et `ResolvedPaths`.

- [ ] **Step 2: Créer des fixtures JSON**

Ajouter des fixtures représentatives avec champs nullable, champs optionnels, modèles configurés et stockés, et sources `configured`, `stored` et `catalog`.

- [ ] **Step 3: Tester la sérialisation Rust**

Utiliser `serde_json::to_value` sur chaque payload et vérifier les noms camelCase attendus, notamment `dbPath`, `defaultPeriodDays`, `effectiveFrom`, `catalogueValid` et `parentId`.

- [ ] **Step 4: Tester la compatibilité TypeScript**

Charger les fixtures dans `api.contract.test.ts`, vérifier la forme des données et la présence des `null` attendus. Tester également les erreurs `ApiError`.

- [ ] **Step 5: Valider la tâche**

Run: `npm test`

Run: `npm run build`

Run: `cd src-tauri && cargo test`

Expected: aucun écart de nommage ou de nullabilité.

## Task 8 : Tests E2E et cycle de vie

**Files:**
- Create: `e2e/live-mode.spec.ts`
- Create: `e2e/settings.spec.ts`
- Create: `e2e/filter-dates.spec.ts`
- Create: `e2e/fixtures/*.db` et configurations de test isolées
- Modify: `package.json`
- Modify: documentation de lancement et CI

- [ ] **Step 1: Configurer Playwright**

Ajouter Playwright, un script `npm run test:e2e`, une configuration qui démarre le frontend mock sur le port dédié et des fixtures locales. Ne jamais pointer vers les chemins OpenCode réels.

- [ ] **Step 2: Tester le mode démo et les réglages**

Vérifier le démarrage sans réglages, le mode démo, la sauvegarde des réglages, le diagnostic d'un JSON invalide et la traduction d'une erreur backend.

- [ ] **Step 3: Tester le live**

Avec une fixture SQLite dédiée, vérifier l'activation, le rafraîchissement après modification, la désactivation et le changement de chemin de base.

- [ ] **Step 4: Tester filtres, recalcul et audit**

Vérifier `defaultPeriodDays`, l'inclusion de toute la date de fin, la mise à jour du dashboard après recalcul et l'invalidation de l'audit après changement des données.

- [ ] **Step 5: Ajouter la CI et documenter**

Ajouter l'installation des navigateurs Playwright dans la CI, publier les artefacts d'échec utiles et documenter `npm run test:e2e` dans `README.md`.

- [ ] **Step 6: Validation finale**

Run: `npm test`

Run: `npm run build`

Run: `npm run test:e2e`

Run: `cd src-tauri && cargo test`

Expected: toutes les validations passent sans accès à la base OpenCode réelle.

## Revue finale du plan

- La validation JSON au démarrage est couverte par la Task 1, puis propagée proprement par la Task 4.
- Les huit tâches du document source sont couvertes dans le même ordre.
- Les chemins XDG, le mode démo, l'accessibilité, l'internationalisation et l'absence d'écriture dans `opencode.db` sont explicitement conservés.
- Aucun placeholder, cache global ou changement de commande publique n'est requis.
