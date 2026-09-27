# Tarifs versionnés et recalcul historique Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un catalogue de tarifs versionné pour tous les providers, calculer chaque message avec le tarif applicable à sa date et permettre un recalcul historique explicite sans jamais modifier `opencode.db`.

**Architecture:** Un catalogue JSON généré et validé avant release est embarqué dans le backend. Le backend charge les messages en lecture seule, résout le tarif versionné par `(providerID, modelID, messageDate)`, puis agrège les coûts uniquement en mémoire. Les tarifs explicitement présents dans la configuration OpenCode restent un override local ; le bouton de recalcul relance le chargement et l'agrégation après confirmation, sans persistance dans la base.

**Tech Stack:** Rust/Tauri 2, `serde_json`, SQLite via `rusqlite` en lecture seule, React 19/TypeScript strict, Vitest, tests Rust.

---

## Découpage des fichiers

- Create: `src-tauri/catalog/pricing.json` — catalogue versionné embarqué.
- Create: `src-tauri/src/pricing.rs` — types, chargement, sélection temporelle et validation du catalogue.
- Create: `src-tauri/tests/pricing_test.rs` — tests de catalogue, sélection historique et absence d'écriture SQLite.
- Modify: `src-tauri/src/lib.rs` — enregistrer le module et les commandes.
- Modify: `src-tauri/src/db.rs` — extraire la date du message et conserver les accès SQLite en lecture seule.
- Modify: `src-tauri/src/model.rs` — exposer la date/provenance du tarif et l'état du recalcul si nécessaire.
- Modify: `src-tauri/src/aggregate.rs` — agréger avec un résolveur temporel de tarifs.
- Modify: `src-tauri/src/commands.rs` — charger le catalogue, retourner les diagnostics et exposer le recalcul.
- Modify: `src-tauri/src/main.rs` or `src-tauri/src/lib.rs` — intégrer le catalogue au binaire avec `include_str!`.
- Create: `src-tauri/scripts/validate_pricing.rs` or a Cargo bin — valider le catalogue pendant la release.
- Modify: `src-tauri/Cargo.toml` — déclarer le binaire de validation si nécessaire.
- Modify: `src/api.ts` — wrappers Tauri pour le catalogue, les diagnostics et le recalcul.
- Modify: `src/data-source.ts` — ajouter une opération de refresh/recalcul au contrat réel et au mock demo.
- Modify: `src/types.ts` — types de diagnostics, provenance détaillée et résultat de recalcul.
- Modify: `src/App.tsx` and/or `src/components/RatesModal.tsx` — bouton, confirmation, garde-fous et rafraîchissement.
- Modify: `src/i18n/resources.ts` — traductions françaises et anglaises des explications/alertes.
- Create or modify: frontend tests near `src/lib/` and `src/components/` — tests de résolution d'état et interaction du bouton.
- Modify: `AGENTS.md` and `docs/superpowers/specs/2026-09-22-cost-provenance-design.md` only if implementation reveals a clarified invariant.

## Task 1: Définir et valider le catalogue embarqué

**Files:**
- Create: `src-tauri/catalog/pricing.json`
- Create: `src-tauri/src/pricing.rs`
- Create: `src-tauri/tests/pricing_test.rs`
- Create: `src-tauri/src/bin/validate_pricing.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Écrire les tests de validation qui échouent**

Tester au minimum :

```rust
#[test]
fn rejects_invalid_catalog_entries() {
    assert!(validate_catalog(r#"{"version":1,"rates":[{"provider":"","model":"gpt","effectiveFrom":"2026-01-01T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0}]}"#).is_err());
}

#[test]
fn rejects_overlapping_effective_dates() {
    let catalog = catalog_with_two_rates("openai", "gpt-5.4", ["2026-01-01T00:00:00Z", "2025-12-01T00:00:00Z"]);
    assert!(validate_catalog(&catalog).is_err());
}

#[test]
fn accepts_multiple_non_overlapping_versions() {
    let catalog = catalog_with_two_rates("openai", "gpt-5.4", ["2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
    assert!(validate_catalog(&catalog).is_ok());
}
```

- [ ] **Step 2: Exécuter les tests pour confirmer l'échec**

Run: `cd src-tauri && cargo test --test pricing_test -- --nocapture`

Expected: FAIL because the catalog types and validator do not exist yet.

- [ ] **Step 3: Implémenter le schéma et le validateur minimal**

Définir des types sérialisables avec les champs `version`, `generatedAt`, `sourceVersion` et `rates`. Chaque rate contient `provider`, `model`, `effectiveFrom`, `input`, `output`, `cacheRead`, `cacheWrite` et `source`. Rejeter les chaînes vides, les dates non-UTC/non-parseables, les valeurs non finies ou négatives, les doublons et les dates qui ne sont pas strictement croissantes pour une clé provider/modèle.

Utiliser `include_str!("../catalog/pricing.json")` depuis le module backend et exposer `load_embedded_catalog() -> Result<PricingCatalog, String>`.

- [ ] **Step 4: Ajouter un catalogue de fixture valide**

Créer des entrées représentatives pour OpenAI, Anthropic, Mistral et un provider local, avec au moins deux versions pour un modèle. Les tarifs doivent être des valeurs de fixture documentées et non présentés comme une source live dans le code.

- [ ] **Step 5: Ajouter le binaire de validation de release**

Créer `validate_pricing` qui lit le chemin fourni en premier argument, appelle le même validateur que l'application et retourne un code d'erreur non nul avec un message exploitable. Ne jamais accepter un fichier absent, vide ou invalide.

Run: `cd src-tauri && cargo run --bin validate_pricing -- catalog/pricing.json`

Expected: success for the checked-in catalog.

- [ ] **Step 6: Relancer les tests**

Run: `cd src-tauri && cargo test --test pricing_test -- --nocapture`

Expected: PASS.

## Task 2: Résoudre le tarif par date de message

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/aggregate.rs`
- Modify: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/pricing.rs`
- Modify: `src-tauri/tests/pricing_test.rs`
- Modify: `src-tauri/tests/aggregate_test.rs`

- [ ] **Step 1: Écrire un test de résolution temporelle qui échoue**

Ajouter une ligne assistant avec deux dates de message et vérifier que le message avant le changement utilise l'ancien tarif et celui après utilise le nouveau tarif. Vérifier aussi qu'un message avant le premier tarif retourne `None` et tombe sur `stored_cost`.

- [ ] **Step 2: Ajouter la date de message dans `RawRow`**

Lire le timestamp du message depuis `message.data` selon le champ réellement présent dans la base. Si le champ est absent ou invalide, retourner un diagnostic explicite et conserver un état permettant le fallback `Stored`; ne jamais inventer la date de session comme date du message sans la marquer comme approximation.

- [ ] **Step 3: Implémenter `PricingCatalog::rate_for(provider, model, message_date)`**

Sélectionner la dernière entrée dont `effective_from <= message_date`. Les entrées doivent être triées une fois au chargement ou parcourues dans un ordre déterministe. Ajouter un test pour les bornes exactes `effectiveFrom`.

- [ ] **Step 4: Adapter l'agrégation**

Remplacer la table `HashMap<(String, String), Rate>` par un résolveur capable d'utiliser la date de chaque `RawRow`. Garder la priorité exacte suivante : **override local explicite > catalogue versionné applicable à la date du message > `message.cost` Stored**. Conserver les provenances `Configured`/`Stored` et les agrégations parent/sous-session.

- [ ] **Step 5: Vérifier la non-écriture de la base**

Construire une base SQLite temporaire, ouvrir le fichier avec `SQLITE_OPEN_READ_ONLY`, exécuter le calcul, puis vérifier qu'aucune modification de taille, de mtime ou de contenu n'est produite. Le test doit échouer si le code tente une ouverture en écriture.

- [ ] **Step 6: Exécuter les tests backend**

Run: `cd src-tauri && cargo test`

Expected: PASS, avec le test d'acceptation ignoré si `ACCEPTANCE_DB` et `ACCEPTANCE_CSV` ne sont pas définis.

## Task 3: Exposer le catalogue et le recalcul via Tauri

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/model.rs`
- Modify: `src/api.ts`
- Modify: `src/types.ts`
- Modify: `src/data-source.ts`
- Modify: `src/mock/tauri-mock.ts`

- [ ] **Step 1: Définir le résultat et les diagnostics**

Ajouter des types sérialisables pour les diagnostics : nombre de messages recalculables, nombre de messages sans date, sans tokens, sans tarif applicable, et indication de catalogue valide. Le résultat doit distinguer une opération réussie avec fallback de l'échec du catalogue.

- [ ] **Step 2: Ajouter les commandes Tauri**

Exposer des commandes distinctes pour obtenir l'état du catalogue et recalculer les données. La commande de recalcul recharge la configuration et la base en lecture seule, reconstruit les sessions en mémoire et retourne les sessions ainsi que les diagnostics. Elle ne reçoit aucune permission d'écriture et ne persiste aucun résultat.

- [ ] **Step 3: Ajouter les wrappers frontend**

Ajouter les appels `invoke` dans `src/api.ts`, puis étendre `AppDataSource` avec une méthode de recalcul. Le data source demo doit retourner un résultat déterministe compatible, sans accès Tauri.

- [ ] **Step 4: Tester l'API et le data source**

Ajouter les tests Vitest vérifiant le contrat du résultat, le comportement demo et le fallback d'erreur. Exécuter `npm test -- --run` et vérifier que les tests existants restent verts.

## Task 4: Ajouter le bouton de recalcul avec garde-fous

**Files:**
- Modify: `src/components/RatesModal.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/resources.ts`
- Create or modify: `src/components/RatesModal.test.tsx`

- [ ] **Step 1: Écrire les tests d'interface qui échouent**

Tester que le bouton est accessible, que le premier clic ouvre une confirmation descriptive, qu'une annulation ne déclenche aucun recalcul et qu'une confirmation appelle exactement une fois le data source.

- [ ] **Step 2: Implémenter la confirmation**

Afficher explicitement que les coûts historiques peuvent changer, que la base OpenCode ne sera pas modifiée et combien de messages sont concernés. Désactiver le bouton pendant l'opération et annoncer le résultat via `role="status"` ou `role="alert"`.

- [ ] **Step 3: Afficher les garde-fous**

Refuser l'action si le catalogue est invalide. Après recalcul, afficher les compteurs de messages sans date, tokens ou tarif applicable et rappeler que ces lignes utilisent éventuellement `Stored`.

- [ ] **Step 4: Rafraîchir l'application**

Remplacer les données courantes par le résultat recalculé, rafraîchir les KPI, tableaux et graphiques, conserver les filtres si possible et réinitialiser proprement les états de chargement/erreur.

- [ ] **Step 5: Vérifier l'accessibilité et le build frontend**

Run: `npm test`

Run: `npm run build`

Expected: tests PASS and TypeScript/Vite build succeeds without unused variables or parameters.

## Task 5: Intégrer la génération et la validation dans la release

**Files:**
- Create: `scripts/generate-pricing.*` or an equivalent release command documented in the repository
- Modify: `package.json` and/or `src-tauri/Cargo.toml`
- Create: `src-tauri/tests/fixtures/pricing-invalid.json`
- Modify: `docs/superpowers/specs/2026-09-22-cost-provenance-design.md` only for verified implementation details

- [ ] **Step 1: Définir l'entrée du générateur**

Le générateur reçoit les sources provider, normalise les identifiants exacts utilisés par `providerID/modelID`, conserve `effectiveFrom`, ajoute la provenance et écrit un fichier temporaire avant remplacement atomique du catalogue final.

- [ ] **Step 2: Faire échouer la génération sur toute anomalie**

Une source indisponible, une réponse non parseable, un modèle sans tarif, une date ambiguë ou un catalogue vide doit retourner un code non nul. Le générateur ne doit jamais remplacer le dernier catalogue valide par une sortie partielle.

- [ ] **Step 3: Enchaîner génération et validation**

Le script de release doit appeler le générateur, puis `validate_pricing`, avant `npm run build` et `npm run tauri build`. Ajouter une fixture invalide et un test de commande qui vérifie l'échec.

- [ ] **Step 4: Vérifier la release localement**

Run: `cd src-tauri && cargo run --bin validate_pricing -- catalog/pricing.json`

Run: `npm run build`

Run: `npm run tauri build`

Expected: validation, build frontend et bundle Tauri réussissent avec le catalogue embarqué.

## Task 6: Validation finale et documentation

**Files:**
- Modify: `AGENTS.md` only if an implementation detail changes a documented invariant
- Modify: `docs/superpowers/specs/2026-09-22-cost-provenance-design.md` only if needed

- [ ] **Step 1: Exécuter la suite frontend**

Run: `npm test`

- [ ] **Step 2: Exécuter la suite backend**

Run: `cd src-tauri && cargo test`

- [ ] **Step 3: Exécuter le test d'acceptation si les variables sont disponibles**

Run: `cd src-tauri && ACCEPTANCE_DB=<snapshot> ACCEPTANCE_CSV=<csv> cargo test --test acceptance_test -- --nocapture`

Expected: coûts par session identiques au CSV legacy selon la tolérance existante.

- [ ] **Step 4: Auditer les accès en écriture**

Rechercher les appels d'écriture SQLite et vérifier qu'aucun chemin de recalcul ne peut appeler `Connection::open` sans `SQLITE_OPEN_READ_ONLY`, `execute`, `execute_batch`, `transaction` ou une migration sur `opencode.db`.

- [ ] **Step 5: Vérifier la documentation et l'état Git**

Run: `git diff --check`

Vérifier que `AGENTS.md` et la spécification décrivent toujours l'interdiction de modifier `opencode.db`, le catalogue versionné, la validation bloquante et le recalcul explicite.
