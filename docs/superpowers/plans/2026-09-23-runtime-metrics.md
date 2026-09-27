# Runtime Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher la taille de `opencode.db`, la mémoire RSS du processus Tauri et la date de dernière actualisation des données.

**Architecture:** Le backend Rust expose une commande `get_runtime_metrics(include_database_size)` qui mesure la mémoire du processus avec `sysinfo` et lit seulement la métadonnée de taille du fichier lorsque le mode réel le demande. Le frontend demande ces métriques après chaque chargement réussi, puis les affiche dans un composant de barre de statut accessible ; le mode démo demande uniquement la mémoire.

**Tech Stack:** Tauri 2, Rust, `sysinfo`, React, TypeScript strict, i18next, Vitest.

---

## Fichiers concernés

- Create: `src-tauri/src/runtime.rs` — modèle et collecte des métriques natives, avec tests Rust.
- Modify: `src-tauri/Cargo.toml` — dépendance `sysinfo`.
- Modify: `src-tauri/src/lib.rs` — déclaration du nouveau module.
- Modify: `src-tauri/src/model.rs` — type sérialisable partagé pour les métriques.
- Modify: `src-tauri/src/commands.rs` — commande Tauri `get_runtime_metrics`.
- Modify: `src/api.ts` — wrapper `getRuntimeMetrics`.
- Modify: `src/types.ts` — type frontend `RuntimeMetrics`.
- Create: `src/components/StatusBar.tsx` — rendu des indicateurs.
- Modify: `src/App.tsx` — état des métriques, date de mise à jour et chargements réel/démo/live.
- Modify: `src/i18n/resources.ts` — libellés français/anglais et états indisponibles.
- Modify: `src/App.css` — mise en page responsive de la barre.
- Modify: `src/components/StatusBar.test.tsx` — tests de rendu et formatage.
- Modify: `src/data-source.test.ts` ou le test App adapté — vérification que le mode démo n'inspecte pas la base.

### Task 1: Ajouter la collecte native des métriques

**Files:**
- Create: `src-tauri/src/runtime.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/model.rs`

- [ ] **Step 1: Ajouter la dépendance `sysinfo`**

Ajouter dans `[dependencies]` de `src-tauri/Cargo.toml` :

```toml
sysinfo = { version = "0.37", default-features = false }
```

Régénérer `src-tauri/Cargo.lock` avec Cargo, sans modifier les autres dépendances volontairement.

- [ ] **Step 2: Définir le modèle sérialisable**

Ajouter dans `src-tauri/src/model.rs` :

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMetrics {
    pub database_size_bytes: Option<u64>,
    pub process_memory_bytes: Option<u64>,
    pub measured_at: i64,
}
```

Le champ `database_size_bytes` est `None` en mode démo ou lorsque le fichier est inaccessible. `process_memory_bytes` est la mémoire RSS retournée par `sysinfo::Process::memory()`.

- [ ] **Step 3: Implémenter la collecte avec des fonctions testables**

Créer `src-tauri/src/runtime.rs` avec une fonction de collecte de cette forme :

```rust
use std::path::Path;
use chrono::Utc;
use sysinfo::{get_current_pid, ProcessesToUpdate, System};
use crate::model::RuntimeMetrics;

pub fn collect(database_path: Option<&Path>) -> RuntimeMetrics {
    let database_size_bytes = database_path
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|metadata| metadata.len());

    let process_memory_bytes = get_current_pid().ok().and_then(|pid| {
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
        system.process(pid).map(|process| process.memory())
    });

    RuntimeMetrics {
        database_size_bytes,
        process_memory_bytes,
        measured_at: Utc::now().timestamp_millis(),
    }
}
```

Adapter la construction de `System` si la version résolue de `sysinfo` impose une signature différente, en conservant la même sémantique : ne rafraîchir que le PID courant et utiliser `memory()` plutôt que `virtual_memory()`.

- [ ] **Step 4: Ajouter les tests Rust avant validation**

Tester au minimum :

Créer trois tests nommés `reads_database_size_without_requiring_a_database_connection`, `missing_database_returns_no_database_size` et `collects_current_process_memory`. Le premier crée un fichier temporaire de taille connue, appelle `collect(Some(path))`, vérifie la taille et relit le contenu pour confirmer qu'il n'a pas changé. Le deuxième appelle `collect(Some(path))` avec un chemin inexistant et vérifie `database_size_bytes.is_none()`. Le troisième appelle `collect(None)` et vérifie que `process_memory_bytes.is_some()`.

Le test de fichier doit vérifier que `metadata.len()` retourne la taille attendue et que le contenu du fichier n'est pas modifié.

- [ ] **Step 5: Déclarer le module et exécuter les tests backend**

Ajouter `pub mod runtime;` dans `src-tauri/src/lib.rs`, puis lancer :

```sh
cargo test --manifest-path src-tauri/Cargo.toml runtime
```

Résultat attendu : tous les tests du module `runtime` passent.

### Task 2: Exposer la commande Tauri et le client frontend

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Ajouter la commande Rust avec le garde du mode démo**

Ajouter dans `commands.rs` :

```rust
#[tauri::command]
pub fn get_runtime_metrics(
    state: State<AppState>,
    include_database_size: bool,
) -> RuntimeMetrics {
    let database_path = if include_database_size {
        let settings = settings::load(&state.config_dir);
        let (db, _) = resolve_paths(&settings);
        Some(std::path::PathBuf::from(db))
    } else {
        None
    };

    runtime::collect(database_path.as_deref())
}
```

Importer `RuntimeMetrics` et le module `runtime` comme les autres commandes. La commande doit toujours renvoyer une structure, même si une métrique individuelle est indisponible.

- [ ] **Step 2: Enregistrer la commande dans le handler Tauri**

Ajouter `commands::get_runtime_metrics` dans la liste `tauri::generate_handler![]` de `src-tauri/src/lib.rs`.

- [ ] **Step 3: Ajouter le type TypeScript et le wrapper**

Dans `src/types.ts` :

```ts
export interface RuntimeMetrics {
  databaseSizeBytes: number | null;
  processMemoryBytes: number | null;
  measuredAt: number;
}
```

Dans `src/api.ts` :

```ts
export const getRuntimeMetrics = (includeDatabaseSize: boolean) =>
  invoke<RuntimeMetrics>("get_runtime_metrics", { includeDatabaseSize });
```

- [ ] **Step 4: Vérifier la compilation des contrats**

Lancer :

```sh
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

Résultat attendu : aucune erreur Rust ou TypeScript.

### Task 3: Créer la barre de statut accessible

**Files:**
- Create: `src/components/StatusBar.tsx`
- Create: `src/components/StatusBar.test.tsx`
- Modify: `src/i18n/resources.ts`
- Modify: `src/index.css` ou `src/App.css`

- [ ] **Step 1: Écrire les tests de rendu**

Tester :

```tsx
it("formats database size, process memory and update time", () => {
  render(<StatusBar metrics={{ databaseSizeBytes: 14_000_000_000, processMemoryBytes: 82_000_000, measuredAt: 0 }} updatedAt={0} />);
  expect(screen.getByRole("contentinfo")).toHaveTextContent("BDD");
  expect(screen.getByRole("contentinfo")).toHaveTextContent("Mémoire");
  expect(screen.getByRole("contentinfo")).toHaveTextContent("Données mises à jour");
});

it("renders unavailable values without hiding available metrics", () => {
  render(<StatusBar metrics={{ databaseSizeBytes: null, processMemoryBytes: 82_000_000, measuredAt: 0 }} updatedAt={0} />);
  expect(screen.getByRole("contentinfo")).toHaveTextContent("indisponible");
  expect(screen.getByRole("contentinfo")).toHaveTextContent("Mémoire");
});
```

Utiliser les helpers de test déjà présents dans le projet et des valeurs de locale déterministes si le formatage de date dépend de l'environnement.

- [ ] **Step 2: Implémenter le composant**

Le composant reçoit `metrics: RuntimeMetrics | null`, `updatedAt: number | null` et la langue active via i18n. Il rend un `<footer role="contentinfo">` avec un nom accessible, formate les octets en unités lisibles et affiche un état indisponible pour les valeurs nulles. Il ne doit pas afficher `measuredAt` comme date de mise à jour des données : `updatedAt` est le timestamp du chargement réussi côté frontend.

- [ ] **Step 3: Ajouter les traductions**

Ajouter dans les ressources françaises et anglaises les clés pour :

```text
status.databaseSize
status.memory
status.lastUpdated
status.unavailable
```

Les traductions doivent permettre une phrase accessible complète, pas uniquement des symboles séparateurs.

- [ ] **Step 4: Ajouter le style responsive**

Créer une classe dédiée avec une séparation supérieure, une taille de texte secondaire, un retour à la ligne autorisé sur petite largeur et des couleurs compatibles avec les thèmes existants. Ne pas utiliser d'icônes comme seule information.

- [ ] **Step 5: Exécuter les tests frontend ciblés**

```sh
npm test -- --run src/components/StatusBar.test.tsx
```

Résultat attendu : tous les tests du composant passent.

### Task 4: Intégrer les métriques au cycle de chargement

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/StatusBar.tsx` seulement si l'interface d'intégration le nécessite.

- [ ] **Step 1: Ajouter l'état frontend**

Ajouter dans `App` :

```ts
const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(null);
const [dataUpdatedAt, setDataUpdatedAt] = useState<number | null>(null);
```

Importer `getRuntimeMetrics` et `RuntimeMetrics`.

- [ ] **Step 2: Centraliser le succès d'un chargement de données**

Créer une fonction locale qui reçoit les sessions et l'identifiant de requête, vérifie que la requête est encore courante, met à jour `data`, les filtres et `dataUpdatedAt` immédiatement après le succès des données, puis demande les métriques dans un bloc `try/catch` séparé :

```ts
setDataUpdatedAt(Date.now());
try {
  const metrics = await getRuntimeMetrics(dataMode === "real");
  if (requestId === dataRequestId.current) setRuntimeMetrics(metrics);
} catch {
  if (requestId === dataRequestId.current) setRuntimeMetrics(null);
}
```

Si la collecte des métriques échoue, conserver les sessions chargées, mettre les métriques à `null` ou à un état indisponible, et ne pas signaler un échec de chargement des données. La date ne doit être mise à jour qu'après un chargement de données réussi ; une erreur de métriques seule ne doit pas effacer cette date.

- [ ] **Step 3: Appliquer le même flux au chargement initial et au live**

Remplacer les deux blocs dupliqués de `App.tsx` qui font `dataSource.getData()` par le helper commun. Passer `dataMode` comme dépendance du helper ou utiliser la valeur du scope courant pour que le mode démo appelle `getRuntimeMetrics(false)`.

- [ ] **Step 4: Réinitialiser les métriques lors d'un changement de source**

Lors du changement réel/démo, invalider les requêtes précédentes avec le mécanisme existant, puis charger la nouvelle source. Une réponse obsolète ne doit pas remplacer `runtimeMetrics`, `data` ou `dataUpdatedAt` de la source active.

- [ ] **Step 5: Rendre la barre de statut dans le layout principal**

Rendre `<StatusBar metrics={runtimeMetrics} updatedAt={dataUpdatedAt} />` après le contenu principal, sans la rendre pendant l'écran de chargement initial si les réglages ne sont pas encore disponibles. La barre reste visible après une erreur de rechargement pour conserver la dernière date connue.

### Task 5: Tests et validation finale

**Files:**
- Modify: tests frontend concernés uniquement si les assertions existantes doivent intégrer le nouveau chargement.

- [ ] **Step 1: Tester les comportements de données**

Ajouter ou adapter les tests pour vérifier :

- le chargement réel demande `getRuntimeMetrics(true)` ;
- le chargement démo demande `getRuntimeMetrics(false)` ou n'inspecte jamais la base ;
- un rechargement live réussi change `dataUpdatedAt` ;
- un échec de `getData()` conserve la date précédente ;
- une réponse obsolète ne remplace pas les métriques courantes.

- [ ] **Step 2: Lancer toute la suite frontend et backend**

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Les tests C# ne s'appliquent pas à ce projet. Le test d'acceptation de coût n'est pas modifié par cette fonctionnalité, mais il doit rester inchangé si un jeu de données réel est disponible.

- [ ] **Step 3: Vérifier l'interface avec le navigateur mock**

Lancer :

```sh
npm run dev:mock
```

Vérifier avec MCP Chrome sur desktop et mobile : la barre est lisible, ne déborde pas horizontalement, expose un nom accessible, affiche la mémoire et indique la taille de base comme indisponible en démo.

- [ ] **Step 4: Vérifier le mode Tauri réel**

Lancer `npm run tauri dev`, charger les données réelles, puis vérifier que la barre affiche la taille de `opencode.db`, la mémoire RSS et une date. Activer LIVE, provoquer une modification de la base et vérifier que la date et les métriques sont rafraîchies.
