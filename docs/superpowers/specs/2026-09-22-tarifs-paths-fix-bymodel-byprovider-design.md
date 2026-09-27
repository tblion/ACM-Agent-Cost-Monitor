# Design — Bouton Tarifs + Chemins résolus + Fix byModel/byProvider

Date : 2026-09-22

## Périmètre

Trois évolutions indépendantes :

1. **Fix bug `byModel`/`byProvider`** — agrégation du coût par modèle/provider incorrecte
2. **Chemins résolus dans Réglages** — les inputs affichent le chemin par défaut en placeholder
3. **Bouton "Tarifs" + modale** — tableau des tarifs lus depuis `opencode.jsonc`

---

## 1. Fix bug `byModel` / `byProvider`

### Problème

`aggregate.ts` (frontend) calcule `byModel` et `byProvider` via une fonction `groupBy` générique qui attribue `s.cost` (coût total de la session) à chaque provider/modèle présent dans la session. Quand une session mélange plusieurs providers (ex. `llmproxy` + `openrama`), le coût total de la session est compté deux fois — une fois par provider — même si l'un d'eux a contribué 0$.

### Solution

Remplacer les deux fonctions par une agrégation directe sur `s.models` (qui contient le coût réel par modèle/provider) :

```ts
export const byProvider = (d: SessionRecord[]) => {
  const m = new Map<string, number>();
  for (const s of d) for (const mu of s.models)
    m.set(mu.provider, (m.get(mu.provider) ?? 0) + mu.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
};

export const byModel = (d: SessionRecord[]) => {
  const m = new Map<string, number>();
  for (const s of d) for (const mu of s.models)
    m.set(mu.model, (m.get(mu.model) ?? 0) + mu.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
};
```

La fonction `groupBy` générique devient inutilisée et peut être supprimée.

### Fichiers touchés

- `src/lib/aggregate.ts` — remplacement de `byModel` et `byProvider`, suppression de `groupBy`
- `src/lib/aggregate.test.ts` — ajout d'un test de non-régression : session multi-provider, vérifier que chaque provider ne reçoit que son coût propre

---

## 2. Chemins résolus dans Réglages

### Problème

Les inputs `dbPath`/`configPath` de `SettingsModal` affichent `""` quand la valeur est `null` (non configurée manuellement). L'utilisateur ne sait pas quel chemin est effectivement utilisé par l'app.

### Solution

#### Rust — nouvelle commande `get_resolved_paths`

Nouveau type dans `model.rs` :
```rust
#[derive(serde::Serialize)]
pub struct ResolvedPaths { pub db: String, pub config: String }
```

Nouvelle commande dans `commands.rs` :
```rust
#[tauri::command]
pub fn get_resolved_paths(state: State<AppState>) -> ResolvedPaths {
    let s = settings::load(&state.config_dir);
    let (db, config) = resolve_paths(&s);
    ResolvedPaths { db, config }
}
```

Enregistrement dans `lib.rs` au même endroit que les autres commandes.

#### Frontend

- `types.ts` : interface `ResolvedPaths { db: string; config: string }`
- `api.ts` : `getResolvedPaths = () => invoke<ResolvedPaths>("get_resolved_paths")`
- `SettingsModal.tsx` :
  - State local `resolvedPaths: ResolvedPaths | null`
  - `useEffect` au mount → appelle `getResolvedPaths()` → stocke dans state
  - Les inputs utilisent `placeholder={resolvedPaths?.db ?? "..."}` / `placeholder={resolvedPaths?.config ?? "..."}`
  - Comportement de sauvegarde inchangé
- `mock/tauri-mock.ts` : ajouter `get_resolved_paths` avec les chemins XDG mockés

### Fichiers touchés

- `src-tauri/src/model.rs` — ajout `ResolvedPaths`
- `src-tauri/src/commands.rs` — ajout `get_resolved_paths`
- `src-tauri/src/lib.rs` — enregistrement de la commande
- `src/types.ts` — ajout interface `ResolvedPaths`
- `src/api.ts` — ajout `getResolvedPaths`
- `src/components/SettingsModal.tsx` — useEffect + placeholder
- `src/mock/tauri-mock.ts` — mock `get_resolved_paths`

---

## 3. Bouton "Tarifs" + modale

### Comportement attendu

- Bouton `$ Tarifs` dans le header, entre LIVE et Réglages
- Clic → modale `RatesModal` (même style que `SettingsModal`)
- Contenu : tableau avec colonnes `Provider | Modèle | Input $/M | Output $/M | Cache read $/M | Cache write $/M`
- Les valeurs sont celles extraites du `opencode.jsonc` courant (chemin résolu)
- Si aucun tarif : message "Aucun tarif configuré dans opencode.jsonc"
- Fermeture : bouton ×, touche Échap, clic sur l'overlay

### Rust — nouvelle commande `get_rates`

Nouveau type dans `model.rs` :
```rust
#[derive(serde::Serialize)]
pub struct RateEntry {
    pub provider: String,
    pub model: String,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}
```

Nouvelle commande dans `commands.rs` :
```rust
#[tauri::command]
pub fn get_rates(state: State<AppState>) -> Vec<RateEntry> {
    let s = settings::load(&state.config_dir);
    let (_, cfg) = resolve_paths(&s);
    let text = std::fs::read_to_string(&cfg).unwrap_or_default();
    let rates = config::extract_rates(&text).unwrap_or_default();
    let mut out: Vec<RateEntry> = rates.into_iter().map(|((provider, model), r)| RateEntry {
        provider, model,
        input: r.input, output: r.output,
        cache_read: r.cache_read, cache_write: r.cache_write,
    }).collect();
    out.sort_by(|a, b| a.provider.cmp(&b.provider).then(a.model.cmp(&b.model)));
    out
}
```

#### Frontend

- `types.ts` : interface `RateEntry`
- `api.ts` : `getRates = () => invoke<RateEntry[]>("get_rates")`
- `Header.tsx` : ajout bouton `$ Tarifs` avec `onOpenRates` prop
- `App.tsx` : state `showRates: boolean` + `onOpenRates` handler + rendu conditionnel `<RatesModal>`
- `RatesModal.tsx` : nouveau composant (focus trap + Échap + overlay click, identique à `SettingsModal`)
- `mock/tauri-mock.ts` : ajouter `get_rates` retournant les tarifs du fixture

### Fichiers touchés

- `src-tauri/src/model.rs` — ajout `RateEntry`
- `src-tauri/src/commands.rs` — ajout `get_rates`
- `src-tauri/src/lib.rs` — enregistrement de la commande
- `src/types.ts` — ajout `RateEntry`
- `src/api.ts` — ajout `getRates`
- `src/components/Header.tsx` — ajout bouton + prop `onOpenRates`
- `src/App.tsx` — state `showRates` + handler + rendu
- `src/components/RatesModal.tsx` — nouveau composant
- `src/mock/tauri-mock.ts` — mock `get_rates`

---

## Accessibilité

- Bouton "Tarifs" : `aria-label="Tarifs"`
- `RatesModal` : `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap complet (identique à `SettingsModal`)
- Tableau tarifs : `<table>` sémantique avec `<thead>`, `<th scope="col">`
- Inputs avec placeholder : le placeholder n'est pas un label — les `<label>` existants sont conservés

## Tests

- `aggregate.test.ts` : test de non-régression `byModel`/`byProvider` avec session multi-provider
- Tests Rust existants : aucun changement attendu (les nouvelles commandes délèguent à du code déjà testé)
