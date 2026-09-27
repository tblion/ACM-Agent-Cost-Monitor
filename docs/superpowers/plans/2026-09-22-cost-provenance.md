# Cost Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguer dans l'application les coûts recalculés avec un tarif local des coûts historiques enregistrés par OpenCode, sans modifier les totaux existants.

**Architecture:** Le backend remplace le booléen `used_custom_rate` par une provenance sérialisée (`configured` ou `stored`) au niveau des usages de modèle et des sessions. Il expose aussi un récapitulatif provider/modèle regroupant les tarifs configurés et les coûts stockés. Le frontend affiche ces deux sources dans la fenêtre Tarifs et ventile le KPI Coût total, tandis que le calcul reste strictement identique.

**Tech Stack:** Rust/Tauri 2, `serde`, SQLite via `rusqlite`, React 19, TypeScript strict, Vitest.

---

## Fichiers concernés

- Modifier `src-tauri/src/model.rs` pour définir les types de provenance et les DTO sérialisés.
- Modifier `src-tauri/src/config.rs` et `src-tauri/src/commands.rs` pour résoudre `.jsonc` puis `.json` et exposer le récapitulatif.
- Modifier `src-tauri/src/aggregate.rs` pour propager la provenance sans changer le calcul.
- Modifier `src/types.ts` et `src/api.ts` pour refléter les DTO Tauri.
- Modifier `src/components/RatesModal.tsx` pour afficher les deux sources.
- Modifier `src/components/KpiCards.tsx` et `src/components/SessionTable.tsx` pour les badges et la ventilation.
- Ajouter les tests Rust dans `src-tauri/src/aggregate.rs`, `src-tauri/src/config.rs` et `src-tauri/src/commands.rs` selon les fonctions testées.
- Ajouter ou modifier les tests frontend dans `src/lib/aggregate.test.ts` pour les totaux filtrés et les nouvelles propriétés.

### Task 1: Introduire le modèle de provenance

**Files:**
- Modify: `src-tauri/src/model.rs:23-45`
- Modify: `src/types.ts:1-7`

- [ ] **Step 1: Écrire les types Rust et TypeScript attendus**

Ajouter côté Rust :

```rust
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CostSource {
    Configured,
    Stored,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub provider: String,
    pub model: String,
    pub cost: f64,
    pub tokens: Tokens,
    pub source: CostSource,
}
```

Ajouter `source: CostSource` à `SessionRecord`, en conservant `used_custom_rate` uniquement pendant la transition si nécessaire au frontend existant. Le plan de migration doit ensuite remplacer toutes ses utilisations par `source == CostSource::Configured`.

Ajouter côté TypeScript :

```ts
export type CostSource = "configured" | "stored";
export interface ModelUsage {
  provider: string; model: string; cost: number; tokens: Tokens; source: CostSource;
}
export interface SessionRecord {
  id: string; project: string; title: string; date: number; cost: number;
  tokens: Tokens; isSubagent: boolean; parentId: string | null;
  source: CostSource; models: ModelUsage[];
}
```

- [ ] **Step 2: Ajouter les invariants de provenance**

Dans les tests Rust d'agrégation, vérifier qu'une ligne avec un tarif retourne `CostSource::Configured` et qu'une ligne sans tarif retourne `CostSource::Stored`, sans changer les assertions numériques existantes.

Dans le frontend, mettre à jour les fixtures et les tests qui construisent `SessionRecord` pour fournir `source` et `ModelUsage.source`.

- [ ] **Step 3: Lancer les tests ciblés**

Run: `cd src-tauri && cargo test aggregate`

Expected: les tests d'agrégation passent ; avant l'implémentation de la propagation, les nouvelles assertions doivent échouer avec une provenance absente ou incorrecte.

### Task 2: Résoudre les configurations JSONC et JSON

**Files:**
- Modify: `src-tauri/src/config.rs:10-16`
- Modify: `src-tauri/src/commands.rs:12-24,52-66`
- Test: `src-tauri/src/config.rs`

- [ ] **Step 1: Écrire les tests de chemin de configuration**

Extraire une fonction testable qui reçoit un chemin optionnel et un répertoire de base temporaire. Les tests doivent vérifier cet ordre : chemin personnalisé, `opencode.jsonc`, puis `opencode.json`.

Le cas `.json` doit utiliser le même parseur `strip_comments` et `strip_trailing_commas`, et le cas d'absence doit retourner un chemin candidat `.jsonc` sans erreur fatale.

- [ ] **Step 2: Implémenter la résolution**

Faire évoluer `config::default_config_path` ou introduire une fonction `resolve_config_path(custom: Option<&str>) -> PathBuf` qui retourne le premier fichier existant. Le chemin personnalisé reste prioritaire et son absence doit produire une erreur lisible ou un fallback vide, conformément au comportement actuel des réglages.

La commande `get_rates` doit utiliser le chemin résolu et le titre de la fenêtre ne doit plus supposer que le fichier est forcément `.jsonc`.

- [ ] **Step 3: Vérifier les tests de configuration**

Run: `cd src-tauri && cargo test config`

Expected: les variantes `.jsonc`, `.json`, absente et JSONC avec commentaires/virgules finales passent.

### Task 3: Exposer le récapitulatif des coûts stockés

**Files:**
- Modify: `src-tauri/src/db.rs:18-53`
- Modify: `src-tauri/src/commands.rs:18-66`
- Modify: `src-tauri/src/model.rs:71-87`
- Modify: `src/api.ts:1-11`
- Modify: `src/types.ts:8-18`

- [ ] **Step 1: Définir le DTO du récapitulatif**

Ajouter côté Rust et TypeScript :

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostSummary {
    pub provider: String,
    pub model: String,
    pub messages: u64,
    pub stored_cost: f64,
    pub configured: bool,
}
```

Le DTO doit être sérialisé en `storedCost` et `configured` côté frontend.

- [ ] **Step 2: Ajouter une lecture SQLite en lecture seule**

Créer une fonction `db::load_cost_summary(db_path: &str) -> Result<Vec<CostSummary>, String>` qui regroupe les messages assistant par `providerID` et `modelID`, compte les messages dont `cost` est strictement positif, et somme uniquement ces `cost`. Elle ne doit pas recalculer un coût à partir des tokens.

- [ ] **Step 3: Ajouter la commande Tauri et son appel frontend**

Ajouter `get_cost_summary`, résoudre le même couple base/config que `get_data`, puis marquer `configured` en comparant les couples au résultat de `config::extract_rates`. Exposer `getCostSummary()` dans `src/api.ts`.

- [ ] **Step 4: Tester le regroupement**

Ajouter un test avec deux modèles, coûts positifs et nuls, et vérifier que le résultat contient le nombre de messages et la somme attendue, sans inclure les messages utilisateur.

Run: `cd src-tauri && cargo test cost_summary`

Expected: le récapitulatif contient les modèles historiques et ignore les coûts nuls dans son total.

### Task 4: Propager la provenance dans l’agrégation

**Files:**
- Modify: `src-tauri/src/aggregate.rs:17-49`
- Modify: `src-tauri/src/model.rs:23-45`
- Modify: `src/types.ts:1-7`

- [ ] **Step 1: Écrire les cas configured/stored/mixte**

Étendre les tests existants :

```rust
assert_eq!(out[0].source, CostSource::Configured);
assert_eq!(out[1].source, CostSource::Stored);
```

Pour une session mixte contenant deux modèles, définir la source de session comme `Configured` seulement si tous les messages de la session ont été recalculés ; sinon `Stored`. Chaque `ModelUsage` conserve sa source individuelle.

- [ ] **Step 2: Implémenter la règle de session**

Initialiser la source de session à `Configured`, puis la passer à `Stored` dès qu'une ligne sans tarif est rencontrée. Une session dont les `ModelUsage` mélangent les deux sources reste sérialisée `stored` côté backend ; le frontend dérive le libellé `Mixte` en constatant la présence des deux sources dans `models`. Ne toucher ni à `message_cost`, ni à l'addition des coûts, ni au regroupement parent/sous-session.

- [ ] **Step 3: Supprimer la dépendance frontend à `usedCustomRate`**

Après compilation des consommateurs, retirer `used_custom_rate` des DTO si aucun appel ne l'utilise encore. Le frontend doit lire `source` partout.

- [ ] **Step 4: Vérifier le backend**

Run: `cd src-tauri && cargo test aggregate`

Expected: les montants existants et les règles parent/sous-session restent identiques, avec une provenance correcte.

### Task 5: Mettre à jour la fenêtre Tarifs

**Files:**
- Modify: `src/components/RatesModal.tsx:8-84`
- Modify: `src/components/Header.tsx` uniquement si le libellé du bouton doit changer
- Modify: `src/types.ts` et `src/api.ts` pour les DTO de la Task 3

- [ ] **Step 1: Charger les deux sources**

Au montage, charger en parallèle `getRates()` et `getCostSummary()`. Conserver des états séparés pour le chargement et l'erreur afin qu'une source vide ne masque pas l'autre.

- [ ] **Step 2: Afficher les sections accessibles**

Conserver le `role="dialog"`, le focus trap et la fermeture Échap. Remplacer le titre `Tarifs (opencode.jsonc)` par `Tarifs et coûts détectés`.

Afficher :

- section `Tarifs configurés`, table actuelle avec badge `Configuré` ;
- section `Coûts historiques détectés`, provider, modèle, nombre de messages, coût stocké et badge `Historique OpenCode` ;
- message explicatif si la première section est vide : `Aucun tarif configuré. Les coûts affichés proviennent des coûts historiques enregistrés par OpenCode.`

Si le même couple existe dans les deux sources, le rendre visuellement explicite et afficher `Le coût des sessions utilise le tarif configuré`.

- [ ] **Step 3: Vérifier le frontend**

Run: `npm test -- src/lib/aggregate.test.ts`

Expected: les tests frontend existants passent ; ajouter les tests de rendu uniquement si le projet dispose déjà d'un environnement de test DOM.

### Task 6: Mettre à jour KPI et sessions

**Files:**
- Modify: `src/components/KpiCards.tsx:8-25`
- Modify: `src/components/SessionTable.tsx:101-135`
- Modify: `src/lib/aggregate.ts` uniquement pour exposer une fonction de somme par provenance si nécessaire

- [ ] **Step 1: Calculer la ventilation sur les données filtrées**

À partir des `SessionRecord` filtrées, sommer séparément les sessions `configured` et `stored`. Pour une session mixte, utiliser les `ModelUsage` afin d'éviter de classer tout son coût dans une seule catégorie.

- [ ] **Step 2: Afficher la ventilation du KPI**

Garder la valeur `Coût total` inchangée et remplacer le sous-texte générique par une ventilation courte, par exemple `Configuré : X $ · Historique : Y $`. Mettre à jour le tooltip pour dire que le total combine les deux sources.

- [ ] **Step 3: Remplacer le badge ambigu des sessions**

Afficher `Configuré` pour une session entièrement recalculée et `Historique` pour une session utilisant au moins un `message.cost`. Pour une session mixte, détectée lorsque `models` contient les deux sources, afficher `Mixte` et détailler les montants par modèle dans l'information accessible.

- [ ] **Step 4: Vérifier les filtres et sous-sessions**

Run: `npm test`

Expected: les totaux, filtres, graphiques et agrégation parent/sous-session restent inchangés numériquement.

### Task 7: Validation finale

**Files:**
- No new files.

- [ ] **Step 1: Compiler le frontend**

Run: `npm run build`

Expected: `tsc` et `vite build` réussissent sans erreur TypeScript strict.

- [ ] **Step 2: Tester le backend**

Run: `cd src-tauri && cargo test`

Expected: tous les tests Rust passent.

- [ ] **Step 3: Vérifier l’interface dans le navigateur mock**

Run: `npm run dev:mock`

Vérifier avec le scénario MCP/Playwright : ouvrir Tarifs, constater les deux sections, vérifier le message de configuration vide, puis vérifier les badges et la ventilation du dashboard.

- [ ] **Step 4: Vérifier le build Tauri Apple Silicon**

Run: `source "$HOME/.cargo/env" && npm run tauri build -- --target aarch64-apple-darwin`

Expected: le bundle `.app` est généré sous `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/` et son exécutable est `Mach-O 64-bit executable arm64`.
