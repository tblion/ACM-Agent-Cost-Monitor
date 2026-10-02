# Architecture Improvements Implementation Plan

> Archive historique : ce plan décrit l'ancienne architecture Tauri/Rust et est conservé uniquement comme trace des changements passés. L'architecture actuelle est Electron + React + .NET ; ne pas exécuter les anciennes commandes Tauri/Cargo ci-dessous.

**Goal:** Corriger les problèmes identifiés et rendre l’application plus fiable, lisible et maintenable sans réécriture complète.

**Architecture:** Conserver Tauri, React et Rust, mais déplacer progressivement les responsabilités vers des services dédiés. Chaque évolution doit être testée avant implémentation et rester indépendante autant que possible.

**Contraintes:**

- Ne jamais écrire dans `opencode.db`.
- Conserver les conventions XDG.
- Ne pas casser le mode démo.
- Préserver l’accessibilité et l’internationalisation.
- Les commentaires ajoutés doivent être en français.
- Valider avec `npm test`, `npm run build` et `cd src-tauri && cargo test`.
- Ne pas créer de worktree.

## Task 1 : Corriger le cycle de vie du mode live

**Objectif :** Le watcher doit démarrer, s’arrêter et changer de fichier lorsque les réglages évoluent.

**Fichiers concernés :**

- Modifier `src-tauri/src/commands.rs`
- Modifier `src-tauri/src/lib.rs`
- Modifier `src-tauri/src/watcher.rs`
- Modifier ou créer les tests dans `src-tauri/tests/`

**Étapes :**

- Tester l’activation du mode live.
- Tester sa désactivation.
- Tester le changement de chemin de base.
- Remplacer le watcher lancé uniquement au démarrage par un service conservé dans `AppState`.
- Ajouter `start_or_restart` et `stop`.
- Garantir qu’un seul watcher est actif.
- Ajouter un arrêt explicite du thread.
- Modifier `save_settings` pour gérer les changements de `live` et `dbPath`.
- Tester le démarrage avec `live: true` et le fichier absent.

**Validation :**

```sh
cd src-tauri
cargo test
```

## Task 2 : Corriger la période par défaut et les dates inclusives

**Objectif :** Utiliser réellement `defaultPeriodDays` et inclure toute la journée de fin.

**Fichiers concernés :**

- Modifier `src/App.tsx`
- Modifier `src/components/FilterBar.tsx`
- Modifier `src/lib/aggregate.ts`
- Modifier les tests frontend associés

**Étapes :**

- Tester l’application d’une période de 7 jours.
- Tester l’inclusion d’une session à `23:59:59`.
- Modifier `defaultFilters` pour recevoir `defaultPeriodDays`.
- Normaliser le début à `00:00:00.000`.
- Normaliser la fin à `23:59:59.999`.
- Éviter les conversions UTC ambiguës pour les dates saisies localement.
- Remplacer une valeur de période invalide par `30`.
- Faire utiliser la période configurée au bouton de réinitialisation.

**Validation :**

```sh
npm test -- src/App.test.tsx src/components/FilterBar.test.tsx src/lib/aggregate.test.ts
npm run build
```

## Task 3 : Extraire l’orchestration de `App.tsx`

**Objectif :** Réduire la complexité de `App.tsx` et rendre les flux d’état lisibles.

**Fichiers concernés :**

- Créer `src/app/useAppData.ts`
- Créer `src/app/useLiveMode.ts`
- Créer `src/app/useSettings.ts`
- Créer `src/app/useAudit.ts`
- Modifier `src/App.tsx`
- Ajouter les tests associés

**Étapes :**

- Extraire le chargement, le rafraîchissement et les erreurs dans `useAppData`.
- Extraire l’abonnement et le cycle de vie live dans `useLiveMode`.
- Extraire le chargement et la file de sauvegarde dans `useSettings`.
- Extraire l’état de l’audit dans `useAudit`.
- Garder dans `App.tsx` la composition des hooks, les filtres et le rendu.
- Conserver les protections contre les réponses asynchrones obsolètes.
- Vérifier que le mode démo et le recalcul fonctionnent toujours.

**Validation :**

```sh
npm test
npm run build
```

## Task 4 : Introduire des erreurs Rust typées

**Objectif :** Remplacer progressivement `Result<T, String>` par des erreurs structurées.

**Fichiers concernés :**

- Créer `src-tauri/src/error.rs`
- Modifier `src-tauri/src/lib.rs`
- Modifier `src-tauri/src/commands.rs`
- Modifier `src-tauri/src/db.rs`
- Modifier `src-tauri/src/config.rs`
- Modifier `src-tauri/src/settings.rs`
- Modifier `src/api.ts`
- Modifier `src/types.ts`

**Étapes :**

- Créer `AppError` avec les catégories `Database`, `Configuration`, `Settings`, `Pricing`, `Watcher`, `Export` et `InvalidInput`.
- Sérialiser un code stable et un message technique.
- Convertir d’abord `get_data`, `save_settings`, `recalculate_data` et `get_audit_report`.
- Ajouter le type TypeScript `ApiError`.
- Traduire les codes connus dans le frontend.
- Ajouter des tests de sérialisation et de propagation.

**Validation :**

```sh
cd src-tauri
cargo test
cd ..
npm test
npm run build
```

## Task 5 : Séparer les commandes Tauri des services applicatifs

**Objectif :** Faire des commandes Tauri de simples adaptateurs.

**Fichiers concernés :**

- Créer `src-tauri/src/application/mod.rs`
- Créer `src-tauri/src/application/data_service.rs`
- Créer `src-tauri/src/application/audit_service.rs`
- Créer `src-tauri/src/application/settings_service.rs`
- Créer `src-tauri/src/application/pricing_service.rs`
- Modifier `src-tauri/src/commands.rs`
- Modifier `src-tauri/src/lib.rs`

**Étapes :**

- Déplacer la résolution des chemins vers `settings_service`.
- Déplacer `compute` et `recalculate` vers `data_service`.
- Déplacer la génération de l’audit vers `audit_service`.
- Déplacer `rates_for_rows` vers `pricing_service`.
- Garder dans `commands.rs` uniquement l’adaptation Tauri.
- Faire dépendre les services de types métier, pas de `AppHandle`.
- Tester directement les services sans démarrer Tauri.
- Conserver les noms publics des commandes existantes.

**Validation :**

```sh
cd src-tauri
cargo test
```

## Task 6 : Simplifier et optimiser les opérations coûteuses

**Objectif :** Éviter les appels et allocations inutiles.

**Fichiers concernés :**

- Modifier `src/App.tsx`
- Modifier `src-tauri/src/commands.rs`
- Modifier `src-tauri/src/db.rs`
- Modifier `src-tauri/src/aggregate.rs`
- Modifier les tests associés

**Étapes :**

- Supprimer les appels inutilisés à `getRates` et `getCostSummary` lors du changement de mode.
- Remplacer la déduplication avec `Vec::iter().any(...)` par un `HashSet`.
- Vérifier l’utilisation de `AppState.rates`.
- Supprimer cet état s’il reste inutilisé.
- Ne pas introduire de cache global sans mesure préalable.
- Ajouter un test avec plusieurs milliers de lignes.
- Vérifier que les résultats restent identiques.

**Validation :**

```sh
npm test
cd src-tauri
cargo test
```

## Task 7 : Fiabiliser le contrat Rust/TypeScript

**Objectif :** Réduire les risques de divergence entre `model.rs` et `types.ts`.

**Fichiers concernés :**

- Modifier `src-tauri/src/model.rs`
- Modifier `src/types.ts`
- Modifier `src/api.ts`
- Créer `src/api.contract.test.ts`
- Ajouter des tests Rust de sérialisation

**Étapes :**

- Lister tous les payloads Tauri publics.
- Vérifier les noms JSON réellement produits par Rust.
- Tester `SessionRecord`, `Settings`, `AuditReport` et `RecalculationResult`.
- Ajouter des fixtures JSON représentatives.
- Tester les enums `configured`, `stored` et `catalog`.
- Tester les champs optionnels et nullable.
- Documenter le contrat dans `src/api.ts`.
- N’introduire une génération automatique des types que si elle réduit réellement la maintenance.

**Validation :**

```sh
npm test
npm run build
cd src-tauri
cargo test
```

## Task 8 : Ajouter des tests E2E et de cycle de vie

**Objectif :** Tester les comportements que les tests unitaires ne couvrent pas.

**Fichiers concernés :**

- Créer `e2e/live-mode.spec.ts`
- Créer `e2e/settings.spec.ts`
- Créer `e2e/filter-dates.spec.ts`
- Modifier `package.json`
- Modifier la documentation

**Scénarios obligatoires :**

- Démarrage avec des réglages absents.
- Activation du mode live.
- Rafraîchissement après modification de la base.
- Désactivation du mode live.
- Changement du chemin de base.
- Application de `defaultPeriodDays`.
- Inclusion de toute la date de fin.
- Diagnostic d’un fichier de réglages invalide.
- Fonctionnement du mode démo.
- Mise à jour du dashboard après recalcul.
- Invalidité de l’audit après modification des données.
- Traduction correcte des erreurs backend.

**Étapes :**

- Utiliser une base SQLite fixture dédiée.
- Ne jamais utiliser la base OpenCode réelle.
- Ajouter une commande `npm run test:e2e`.
- Ajouter l’exécution E2E dans la CI.
- Documenter le lancement local.

**Validation :**

```sh
npm test
npm run build
npm run test:e2e
cd src-tauri
cargo test
```

## Ordre d’exécution recommandé

1. Task 1 : cycle de vie du watcher.
2. Task 2 : dates et période par défaut.
3. Task 3 : extraction de `App.tsx`.
4. Task 4 : erreurs typées.
5. Task 5 : services applicatifs Rust.
6. Task 6 : optimisations.
7. Task 7 : contrats Rust/TypeScript.
8. Task 8 : tests E2E.

Chaque tâche doit être validée avant de commencer la suivante. Les tâches 1 et 2 corrigent des bugs fonctionnels ; les tâches 3 à 7 réduisent la dette d’architecture ; la tâche 8 sécurise l’ensemble contre les régressions.
