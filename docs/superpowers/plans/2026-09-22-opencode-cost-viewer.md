# Opencode Cost Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal** : Construire une app desktop cross-platform (Tauri 2) qui calcule le coût en tokens/$ de chaque session et projet opencode, avec filtres, graphiques, mode live et réglages.

**Architecture** : Backend Rust (Tauri 2) lit la base SQLite opencode en lecture seule, parse `opencode.jsonc` (JSONC), recalcule les coûts par message (logique du script legacy), agrège par session, et expose les données au frontend via des commandes Tauri. Un watcher sur le fichier DB alimente le mode live. Frontend React/TypeScript/Vite fait le filtrage + les agrégations côté client et rend KPIs, graphiques (Recharts), table de sessions, écran de réglages, avec un thème OS-aware.

**Tech Stack** : Rust (tauri 2, rusqlite, serde, serde_json, notify, dirs), TypeScript/React 18, Vite, Recharts, Vitest (tests frontend).

**Spec** : `docs/superpowers/specs/2026-09-22-opencode-cost-viewer-design.md`

---

## Structure des fichiers

**Backend Rust** (`src-tauri/`)
- `src-tauri/Cargo.toml` — dépendances
- `src-tauri/tauri.conf.json` — config Tauri (fenêtre, bundle)
- `src-tauri/src/main.rs` — point d'entrée
- `src-tauri/src/lib.rs` — setup Tauri, enregistrement des commandes, état global
- `src-tauri/src/model.rs` — types de données partagés (Tokens, ModelUsage, SessionRecord, Settings)
- `src-tauri/src/cost.rs` — calcul du coût par message (pur)
- `src-tauri/src/jsonc.rs` — suppression des commentaires JSONC (pur)
- `src-tauri/src/config.rs` — résolution du chemin config + extraction des tarifs
- `src-tauri/src/db.rs` — résolution du chemin DB + requête sessions/messages
- `src-tauri/src/aggregate.rs` — agrégation par session (pur, sur données brutes)
- `src-tauri/src/settings.rs` — charge/sauvegarde `settings.json`
- `src-tauri/src/watcher.rs` — watcher DB (mode live)
- `src-tauri/src/commands.rs` — commandes Tauri (get_data, get_settings, save_settings, pick_path)
- `src-tauri/tests/` — tests d'intégration
- `src-tauri/fixtures/` — base SQLite fixture + config JSONC fixture

**Frontend** (`src/`)
- `src/main.tsx`, `src/App.tsx`, `src/index.css`
- `src/types.ts` — types TS (miroir de model.rs)
- `src/api.ts` — wrappers `invoke` Tauri
- `src/lib/aggregate.ts` — filtrage + agrégations (pur) + `src/lib/aggregate.test.ts`
- `src/theme.ts` — thème OS-aware
- `src/components/Header.tsx` (titre + bouton LIVE + Réglages)
- `src/components/FilterBar.tsx`
- `src/components/KpiCards.tsx`
- `src/components/charts/CostOverTime.tsx`, `CostByProject.tsx`, `CostByModel.tsx`, `CostByProvider.tsx`, `TokenBreakdown.tsx`, `TopSessions.tsx`, `CostByGroup.tsx`
- `src/components/SessionTable.tsx`
- `src/components/SettingsModal.tsx`

**Racine** : `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore` (déjà présent).

**Conventions** : code en anglais, commentaires en français. TDD (test d'abord, puis implémentation). Commit après chaque tâche.

---

## PHASE 0 — Scaffolding

### Task 1: Scaffold Tauri 2 + React/TS/Vite dans le repo existant

Le repo contient déjà `_old/`, `docs/`, `.git`, `.gitignore`. On scaffold dans un dossier temporaire puis on copie les fichiers générés à la racine (sans écraser `_old/`, `docs/`, `.git`).

**Files:**
- Create: `src-tauri/`, `src/`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `public/`

- [ ] **Step 1: Générer le template dans un dossier temporaire**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm create tauri-app@latest ocv-tmp -- --template react-ts --manager npm --yes
```
Expected : un dossier `ocv-tmp/` avec `src-tauri/`, `src/`, `package.json`, etc. (si un prompt interactif apparaît, choisir : TypeScript, React, Vite, npm).

- [ ] **Step 2: Copier les fichiers générés à la racine du projet**

Run:
```bash
cd C:\git\OpencodeCostViewer
Copy-Item -Path ocv-tmp\src-tauri -Destination .\src-tauri -Recurse
Copy-Item -Path ocv-tmp\src -Destination .\src -Recurse
Copy-Item -Path ocv-tmp\public -Destination .\public -Recurse -ErrorAction SilentlyContinue
Copy-Item -Path ocv-tmp\package.json,ocv-tmp\vite.config.ts,ocv-tmp\tsconfig.json,ocv-tmp\tsconfig.node.json,ocv-tmp\index.html -Destination . -ErrorAction SilentlyContinue
Remove-Item -Path ocv-tmp -Recurse -Force
```
Expected : les fichiers sont à la racine ; `_old/`, `docs/`, `.git` intacts.

- [ ] **Step 3: Installer les dépendances**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm install
```
Expected : `node_modules/` créé, sans erreur.

- [ ] **Step 4: Vérifier que le build frontend passe**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run build
```
Expected : build Vite réussi (dossier `dist/`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri 2 + React/TS/Vite"
```

---

## PHASE 1 — Backend Rust (TDD)

### Task 2: Types de données partagés (model.rs)

**Files:**
- Create: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/lib.rs` (ajouter `pub mod model;`)

- [ ] **Step 1: Écrire model.rs**

```rust
// src-tauri/src/model.rs
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub reasoning: f64,
}

impl Tokens {
    pub fn add(&mut self, o: &Tokens) {
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
        self.reasoning += o.reasoning;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub provider: String,
    pub model: String,
    pub cost: f64,
    pub tokens: Tokens,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub project: String,
    pub title: String,
    pub date: i64,
    pub cost: f64,
    pub tokens: Tokens,
    pub is_subagent: bool,
    pub parent_id: Option<String>,
    pub used_custom_rate: bool,
    pub models: Vec<ModelUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub db_path: Option<String>,
    pub config_path: Option<String>,
    pub live: bool,
    pub theme: String, // "system" | "light" | "dark"
    pub default_period_days: i64,
    pub custom_groups: Vec<CustomGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomGroup {
    pub name: String,
    pub projects: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { db_path: None, config_path: None, live: false, theme: "system".into(), default_period_days: 30, custom_groups: vec![] }
    }
}
```

- [ ] **Step 2: Déclarer le module dans lib.rs**

Dans `src-tauri/src/lib.rs`, ajouter `pub mod model;` (et les autres modules au fur et à mesure des tâches).

- [ ] **Step 3: Vérifier la compilation**

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo build
```
Expected : compile OK.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/lib.rs
git commit -m "feat(backend): add shared data model"
```

### Task 3: Calcul du coût par message (cost.rs) — TDD

**Files:**
- Create: `src-tauri/src/cost.rs`

- [ ] **Step 1: Écrire le test (d'abord)**

Créer `src-tauri/src/cost.rs` avec uniquement le module de test + une signature qui ne compile pas encore :

```rust
// src-tauri/src/cost.rs
use crate::model::Tokens;

#[derive(Debug, Clone, Copy, Default)]
pub struct Rate {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

pub fn message_cost(tokens: &Tokens, rate: &Rate) -> f64 {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_rate() {
        let t = Tokens { input: 1e6, output: 1e6, cache_read: 1e6, cache_write: 1e6, reasoning: 1e6 };
        let r = Rate { input: 2.0, output: 8.0, cache_read: 0.2, cache_write: 2.5 };
        // 2 + 8 + 0.2 + 2.5 + 8 (reasoning@output) = 20.7
        assert!((message_cost(&t, &r) - 20.7).abs() < 1e-9);
    }
    #[test]
    fn zero_tokens_zero_cost() {
        assert_eq!(message_cost(&Tokens::default(), &Rate::default()), 0.0);
    }
}
```

- [ ] **Step 2: Déclarer le module + faire échouer le test**

Dans `lib.rs` ajouter `pub mod cost;`. Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test cost
```
Expected : FAIL (panique `unimplemented!`).

- [ ] **Step 3: Implémenter**

Remplacer le corps de `message_cost` :
```rust
pub fn message_cost(tokens: &Tokens, rate: &Rate) -> f64 {
    tokens.input * rate.input / 1_000_000.0
        + tokens.output * rate.output / 1_000_000.0
        + tokens.cache_read * rate.cache_read / 1_000_000.0
        + tokens.cache_write * rate.cache_write / 1_000_000.0
        + tokens.reasoning * rate.output / 1_000_000.0
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test cost
```
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cost.rs src-tauri/src/lib.rs
git commit -m "feat(backend): per-message cost calculation"
```

### Task 4: Suppression des commentaires JSONC (jsonc.rs) — TDD

**Files:**
- Create: `src-tauri/src/jsonc.rs`

- [ ] **Step 1: Écrire le test (d'abord)**

```rust
// src-tauri/src/jsonc.rs
pub fn strip_comments(text: &str) -> String {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_line_and_block() {
        let out = strip_comments("{ // ligne\n\"a\": 1 /* bloc */ }");
        assert!(out.contains("\"a\": 1"));
        assert!(!out.contains("ligne"));
        assert!(!out.contains("bloc"));
    }
    #[test]
    fn keeps_slash_in_string() {
        let out = strip_comments("{ \"url\": \"https://x.com\" }");
        assert!(out.contains("https://x.com"));
    }
    #[test]
    fn keeps_escaped_quote() {
        let out = strip_comments("{ \"s\": \"a\\\"b\" } // c");
        assert!(out.contains("a\\\"b"));
        assert!(!out.contains("// c"));
    }
}
```

- [ ] **Step 2: Déclarer le module + faire échouer**

Dans `lib.rs` ajouter `pub mod jsonc;`. Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test jsonc
```
Expected : FAIL (`unimplemented!`).

- [ ] **Step 3: Implémenter**

```rust
pub fn strip_comments(text: &str) -> String {
    let c: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let (mut in_str, mut in_line, mut in_block) = (false, false, false);
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        let next = c.get(i + 1).copied().unwrap_or('\0');
        if in_line {
            if ch == '\n' { in_line = false; out.push(ch); }
            i += 1;
        } else if in_block {
            if ch == '*' && next == '/' { in_block = false; i += 2; } else { i += 1; }
        } else if in_str {
            out.push(ch);
            if ch == '\\' && i + 1 < c.len() { out.push(c[i + 1]); i += 2; }
            else { if ch == '"' { in_str = false; } i += 1; }
        } else {
            match (ch, next) {
                ('"', _) => { in_str = true; out.push(ch); i += 1; }
                ('/', '/') => { in_line = true; i += 2; }
                ('/', '*') => { in_block = true; i += 2; }
                _ => { out.push(ch); i += 1; }
            }
        }
    }
    out
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test jsonc
```
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/jsonc.rs src-tauri/src/lib.rs
git commit -m "feat(backend): JSONC comment stripping"
```

### Task 5: Extraction des tarifs depuis la config (config.rs) — TDD

**Files:**
- Create: `src-tauri/src/config.rs`
- Create: `src-tauri/fixtures/config.jsonc`

- [ ] **Step 1: Créer le fixture config**

```jsonc
// src-tauri/fixtures/config.jsonc
{
  // commentaire de test
  "provider": {
    "llmproxy": {
      "models": {
        "openai/gpt-4.1": { "cost": { "input": 2.0, "output": 8.0 } },
        "vertex_ai/claude-sonnet-4-6": { "cost": { "input": 3.3, "output": 16.5, "cache_read": 0.33 } }
      }
    },
    "openrama": {
      "models": { "qwen3.8-27b": { /* pas de cost */ } }
    }
  }
}
```

- [ ] **Step 2: Écrire le test (d'abord)**

```rust
// src-tauri/src/config.rs
use std::collections::HashMap;
use std::path::PathBuf;
use serde_json::Value;
use crate::cost::Rate;
use crate::jsonc::strip_comments;

pub fn default_config_path() -> PathBuf {
    dirs::config_dir().unwrap().join("opencode").join("opencode.jsonc")
}

pub fn extract_rates(config_text: &str) -> Result<HashMap<(String, String), Rate>, String> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_rates_and_skips_missing() {
        let text = std::fs::read_to_string("fixtures/config.jsonc").unwrap();
        let rates = extract_rates(&text).unwrap();
        assert!(rates.contains_key(&("llmproxy".into(), "openai/gpt-4.1".into())));
        assert!((rates[&("llmproxy".into(), "openai/gpt-4.1".into())].input - 2.0).abs() < 1e-9);
        assert!((rates[&("llmproxy".into(), "vertex_ai/claude-sonnet-4-6".into())].cache_read - 0.33).abs() < 1e-9);
        assert!(!rates.contains_key(&("openrama".into(), "qwen3.8-27b".into())));
    }
}
```

- [ ] **Step 3: Déclarer le module + faire échouer**

Dans `lib.rs` ajouter `pub mod config;`. Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test config
```
Expected : FAIL (`unimplemented!`).

- [ ] **Step 4: Implémenter**

```rust
pub fn extract_rates(config_text: &str) -> Result<HashMap<(String, String), Rate>, String> {
    let json = strip_comments(config_text);
    let v: Value = serde_json::from_str(&json).map_err(|e| format!("JSON invalide: {e}"))?;
    let mut rates = HashMap::new();
    if let Some(providers) = v.get("provider").and_then(|p| p.as_object()) {
        for (pid, pval) in providers {
            if let Some(models) = pval.get("models").and_then(|m| m.as_object()) {
                for (mid, mval) in models {
                    if let Some(cost) = mval.get("cost").and_then(|c| c.as_object()) {
                        let rate = Rate {
                            input: cost.get("input").and_then(|x| x.as_f64()).unwrap_or(0.0),
                            output: cost.get("output").and_then(|x| x.as_f64()).unwrap_or(0.0),
                            cache_read: cost.get("cache_read").and_then(|x| x.as_f64()).unwrap_or(0.0),
                            cache_write: cost.get("cache_write").and_then(|x| x.as_f64()).unwrap_or(0.0),
                        };
                        rates.insert((pid.clone(), mid.clone()), rate);
                    }
                }
            }
        }
    }
    Ok(rates)
}
```

- [ ] **Step 5: Vérifier que le test passe**

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test config
```
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/fixtures/config.jsonc src-tauri/src/lib.rs
git commit -m "feat(backend): extract rates from opencode.jsonc"
```

### Task 6: Requête DB + agrégation par session (db.rs + aggregate.rs) — TDD

**Files:**
- Create: `src-tauri/src/aggregate.rs`
- Create: `src-tauri/src/db.rs`
- Create: `src-tauri/fixtures/make_fixture.py`
- Test: `src-tauri/tests/aggregate_test.rs`

- [ ] **Step 1: Créer le script de fixture (base SQLite d'échantillon)**

```python
# src-tauri/fixtures/make_fixture.py
import sqlite3, json, os
db = os.path.join(os.path.dirname(__file__), "fixture.db")
if os.path.exists(db): os.remove(db)
conn = sqlite3.connect(db)
c = conn.cursor()
c.execute("CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER)")
c.execute("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)")
c.execute("INSERT INTO session VALUES ('s1','p1',NULL,'C:/git/demo','Session demo',1700000000000)")
c.execute("INSERT INTO message VALUES ('m1','s1',1700000000000,?)", (json.dumps({
    "role":"assistant","providerID":"llmproxy","modelID":"openai/gpt-4.1","cost":0,
    "tokens":{"input":1000000,"output":100000,"reasoning":0,"cache":{"read":0,"write":0}}}),))
c.execute("INSERT INTO message VALUES ('m2','s1',1700000001000,?)", (json.dumps({
    "role":"assistant","providerID":"llmproxy","modelID":"openai/gpt-4.1","cost":0,
    "tokens":{"input":500000,"output":50000,"reasoning":10000,"cache":{"read":200000,"write":0}}}),))
c.execute("INSERT INTO session VALUES ('s2','p1','s1','C:/git/demo','Subagent demo',1700000002000)")
c.execute("INSERT INTO message VALUES ('m3','s2',1700000002000,?)", (json.dumps({
    "role":"assistant","providerID":"openrama","modelID":"qwen3.8-27b","cost":0,
    "tokens":{"input":999999,"output":1,"reasoning":0,"cache":{"read":0,"write":0}}}),))
c.execute("INSERT INTO message VALUES ('m4','s1',1700000003000,?)", (json.dumps({"role":"user","content":"hi"}),))
conn.commit(); conn.close()
print("fixture.db cree")
```

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
python fixtures/make_fixture.py
```
Expected : `fixtures/fixture.db` créé.

- [ ] **Step 2: Écrire aggregate.rs (test d'abord)**

```rust
// src-tauri/src/aggregate.rs
use std::collections::HashMap;
use crate::cost::{Rate, message_cost};
use crate::model::{ModelUsage, SessionRecord, Tokens};

pub struct RawRow {
    pub project: String,
    pub session_id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub date: i64,
    pub provider: String,
    pub model: String,
    pub stored_cost: f64,
    pub tokens: Tokens,
}

pub fn aggregate(rows: &[RawRow], rates: &HashMap<(String, String), Rate>) -> Vec<SessionRecord> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(provider: &str, model: &str, input: f64, output: f64, sid: &str, parent: Option<&str>) -> RawRow {
        RawRow { project: "C:/git/demo".into(), session_id: sid.into(), title: "t".into(),
            parent_id: parent.map(|s| s.into()), date: 1700000000000,
            provider: provider.into(), model: model.into(), stored_cost: 0.0,
            tokens: Tokens { input, output, cache_read: 0.0, cache_write: 0.0, reasoning: 0.0 } }
    }
    #[test]
    fn aggregates_and_applies_rate() {
        let mut rates = HashMap::new();
        rates.insert(("llmproxy".into(), "openai/gpt-4.1".into()), Rate { input: 2.0, output: 8.0, cache_read: 0.0, cache_write: 0.0 });
        let rows = vec![ row("llmproxy","openai/gpt-4.1",1000000.0,100000.0,"s1",None),
                         row("llmproxy","openai/gpt-4.1",500000.0,50000.0,"s1",None) ];
        let out = aggregate(&rows, &rates);
        assert_eq!(out.len(), 1);
        // (1e6*2 + 1e5*8)/1e6 + (5e5*2 + 5e4*8)/1e6 = 2.8 + 1.4 = 4.2
        assert!((out[0].cost - 4.2).abs() < 1e-6);
        assert!(out[0].used_custom_rate);
        assert_eq!(out[0].models.len(), 1);
    }
    #[test]
    fn no_rate_uses_stored_cost_and_flag_false() {
        let rates = HashMap::new();
        let rows = vec![ row("openrama","qwen3.8-27b",999999.0,1.0,"s2",Some("s1")) ];
        let out = aggregate(&rows, &rates);
        assert_eq!(out[0].cost, 0.0);
        assert!(!out[0].used_custom_rate);
        assert!(out[0].is_subagent);
    }
}
```

- [ ] **Step 3: Déclarer le module + faire échouer**

Dans `lib.rs` ajouter `pub mod aggregate;`. Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test aggregate
```
Expected : FAIL (`unimplemented!`).

- [ ] **Step 4: Implémenter aggregate**

```rust
pub fn aggregate(rows: &[RawRow], rates: &HashMap<(String, String), Rate>) -> Vec<SessionRecord> {
    let mut map: HashMap<String, SessionRecord> = HashMap::new();
    for r in rows {
        let key = (r.provider.clone(), r.model.clone());
        let (cost, used) = match rates.get(&key) {
            Some(rate) => (message_cost(&r.tokens, rate), true),
            None => (r.stored_cost, false),
        };
        let rec = map.entry(r.session_id.clone()).or_insert_with(|| SessionRecord {
            id: r.session_id.clone(),
            project: r.project.clone(),
            title: r.title.clone(),
            date: r.date,
            cost: 0.0,
            tokens: Tokens::default(),
            is_subagent: r.parent_id.is_some(),
            parent_id: r.parent_id.clone(),
            used_custom_rate: false,
            models: vec![],
        });
        rec.cost += cost;
        rec.tokens.add(&r.tokens);
        if used { rec.used_custom_rate = true; }
        if let Some(mu) = rec.models.iter_mut().find(|m| m.provider == r.provider && m.model == r.model) {
            mu.cost += cost;
            mu.tokens.add(&r.tokens);
        } else {
            rec.models.push(ModelUsage { provider: r.provider.clone(), model: r.model.clone(), cost, tokens: r.tokens });
        }
    }
    let mut out: Vec<SessionRecord> = map.into_values().collect();
    out.sort_by(|a, b| b.date.cmp(&a.date));
    out
}
```

- [ ] **Step 5: Vérifier que les tests passent**

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test aggregate
```
Expected : PASS.

- [ ] **Step 6: Écrire db.rs (requête)**

```rust
// src-tauri/src/db.rs
use std::path::PathBuf;
use rusqlite::{Connection, OpenFlags};
use crate::aggregate::RawRow;
use crate::model::Tokens;

pub fn default_db_path() -> PathBuf {
    dirs::data_dir().unwrap().join("opencode").join("opencode.db")
}

pub fn load_rows(db_path: &str) -> Result<Vec<RawRow>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Impossible d'ouvrir la base: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT s.directory, s.id, s.title, s.parent_id, s.time_created, m.data \
         FROM session s JOIN message m ON m.session_id = s.id \
         WHERE json_extract(m.data, '$.role') = 'assistant'")
        .map_err(|e| format!("Requete impossible (schema inattendu?): {e}"))?;
    let rows = stmt.query_map([], |r| {
        let data: String = r.get(5)?;
        let v: serde_json::Value = serde_json::from_str(&data)
            .map_err(|e| rusqlite::Error::InvalidData(format!("JSON message.data illisible: {e}").into()))?;
        let tokens = v.get("tokens").map(|t| Tokens {
            input: t.get("input").and_then(|x| x.as_f64()).unwrap_or(0.0),
            output: t.get("output").and_then(|x| x.as_f64()).unwrap_or(0.0),
            cache_read: t.get("cache").and_then(|c| c.get("read")).and_then(|x| x.as_f64()).unwrap_or(0.0),
            cache_write: t.get("cache").and_then(|c| c.get("write")).and_then(|x| x.as_f64()).unwrap_or(0.0),
            reasoning: t.get("reasoning").and_then(|x| x.as_f64()).unwrap_or(0.0),
        }).unwrap_or_default();
        Ok(RawRow {
            project: r.get(0)?,
            session_id: r.get(1)?,
            title: r.get(2)?,
            parent_id: r.get(3)?,
            date: r.get(4)?,
            provider: v.get("providerID").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            model: v.get("modelID").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            stored_cost: v.get("cost").and_then(|x| x.as_f64()).unwrap_or(0.0),
            tokens,
        })
    }).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| format!("Ligne illisible: {e}"))?; }
    Ok(out)
}
```

Dans `lib.rs` ajouter `pub mod db;`.

- [ ] **Step 7: Test d'intégration contre la fixture**

```rust
// src-tauri/tests/aggregate_test.rs
use std::collections::HashMap;

#[test]
fn pipeline_on_fixture() {
    let db = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/fixture.db");
    let rows = opencode_costs_viewer_lib::db::load_rows(db).expect("load_rows");
    let mut rates = HashMap::new();
    rates.insert(("llmproxy".into(), "openai/gpt-4.1".into()),
        opencode_costs_viewer_lib::cost::Rate { input: 2.0, output: 8.0, cache_read: 0.0, cache_write: 0.0 });
    let sessions = opencode_costs_viewer_lib::aggregate::aggregate(&rows, &rates);
    assert_eq!(sessions.len(), 2); // s1 et s2 (m4 ignoré)
    let s1 = sessions.iter().find(|s| s.id == "s1").unwrap();
    // m1: (1e6*2 + 1e5*8)/1e6 = 2.8 ; m2: (5e5*2 + 5e4*8 + 1e4*8)/1e6 = 1.48 ; total 4.28
    assert!((s1.cost - 4.28).abs() < 1e-6);
    let s2 = sessions.iter().find(|s| s.id == "s2").unwrap();
    assert_eq!(s2.cost, 0.0);
    assert!(s2.is_subagent);
}
```

> Note : le nom de crate lib est défini par `name` dans `src-tauri/Cargo.toml` (souvent `opencode_cost_viewer_lib` ou similaire, avec des `_`). Si `opencode_costs_viewer_lib` ne correspond pas, remplacer `opencode_costs_viewer_lib::` par le vrai nom de crate (vérifier `[lib] name` ou `name` dans Cargo.toml).

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test --test aggregate_test
```
Expected : PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/aggregate.rs src-tauri/fixtures/ src-tauri/tests/aggregate_test.rs src-tauri/src/lib.rs
git commit -m "feat(backend): DB query + per-session aggregation"
```

### Task 7: Settings (settings.rs) — TDD

**Files:**
- Create: `src-tauri/src/settings.rs`

- [ ] **Step 1: Écrire le test (d'abord)**

```rust
// src-tauri/src/settings.rs
use std::fs;
use std::path::PathBuf;
use crate::model::Settings;

pub fn load(config_dir: &PathBuf) -> Settings { unimplemented!() }
pub fn save(config_dir: &PathBuf, s: &Settings) -> Result<(), String> { unimplemented!() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        let dir = std::env::temp_dir().join("ocv_settings_test");
        let _ = fs::remove_dir_all(&dir);
        let mut s = Settings::default();
        s.live = true;
        s.db_path = Some("C:/x.db".into());
        save(&dir, &s).unwrap();
        let loaded = load(&dir);
        assert!(loaded.live);
        assert_eq!(loaded.db_path.as_deref(), Some("C:/x.db"));
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn missing_returns_default() {
        let dir = std::env::temp_dir().join("ocv_settings_none");
        let _ = fs::remove_dir_all(&dir);
        let s = load(&dir);
        assert!(!s.live);
        assert!(s.db_path.is_none());
    }
}
```

- [ ] **Step 2: Déclarer le module + faire échouer**

Dans `lib.rs` ajouter `pub mod settings;`. Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test settings
```
Expected : FAIL (`unimplemented!`).

- [ ] **Step 3: Implémenter**

```rust
pub fn load(config_dir: &PathBuf) -> Settings {
    let p = config_dir.join("settings.json");
    fs::read_to_string(p).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
pub fn save(config_dir: &PathBuf, s: &Settings) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let p = config_dir.join("settings.json");
    fs::write(p, serde_json::to_string_pretty(s).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test settings
```
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/lib.rs
git commit -m "feat(backend): settings load/save"
```

### Task 8: Commandes Tauri + état global (commands.rs, lib.rs)

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Ajouter les dépendances**

Dans `src-tauri/Cargo.toml`, ajouter dans `[dependencies]` :
```toml
rusqlite = { version = "0.31", features = ["bundled"] }
notify = "6"
dirs = "5"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri-plugin-dialog = "2"
tokio = { version = "1", features = ["sync"] }
```
(Vérifier les versions compatibles avec Tauri 2 ; ajuster si `cargo` signale un conflit.)

- [ ] **Step 2: Écrire commands.rs**

```rust
// src-tauri/src/commands.rs
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use crate::model::{SessionRecord, Settings};
use crate::{db, config, aggregate, settings};

pub struct AppState {
    pub config_dir: std::path::PathBuf,
    pub rates: Mutex<HashMap<(String, String), crate::cost::Rate>>,
}

pub fn resolve_paths(s: &Settings) -> (String, String) {
    let db = s.db_path.clone().unwrap_or_else(|| db::default_db_path().to_string_lossy().into_owned());
    let cfg = s.config_path.clone().unwrap_or_else(|| config::default_config_path().to_string_lossy().into_owned());
    (db, cfg)
}

pub fn compute(db: &str, cfg: &str) -> Result<Vec<SessionRecord>, String> {
    let cfg_text = std::fs::read_to_string(cfg)
        .map_err(|_| format!("Config introuvable: {cfg} (coût stocké utilisé)"))
        .unwrap_or_default();
    let rates = config::extract_rates(&cfg_text).unwrap_or_default();
    let rows = db::load_rows(db)?;
    Ok(aggregate::aggregate(&rows, &rates))
}

#[tauri::command]
pub fn get_data(state: State<AppState>) -> Result<Vec<SessionRecord>, String> {
    let s = settings::load(&state.config_dir);
    let (db, cfg) = resolve_paths(&s);
    compute(&db, &cfg)
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    settings::load(&state.config_dir)
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, s: Settings) -> Result<(), String> {
    settings::save(&state.config_dir, &s)
}

#[tauri::command]
pub async fn pick_path(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick(move |res| { let _ = tx.send(res); });
    rx.await.map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Câbler lib.rs (état + commandes + plugin dialog)**

Remplacer le corps de `run()` dans `src-tauri/src/lib.rs` :
```rust
pub mod model; pub mod cost; pub mod jsonc; pub mod config;
pub mod db; pub mod aggregate; pub mod settings; pub mod commands;

use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir().expect("config dir");
            app.manage(commands::AppState {
                config_dir,
                rates: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_data,
            commands::get_settings,
            commands::save_settings,
            commands::pick_path,
        ])
        .run(tauri::generate_context!())
        .expect("erreur lors du lancement de Tauri");
}
```
(Ajouter `use std::collections::HashMap;` en tête de lib.rs si nécessaire.)

- [ ] **Step 4: Vérifier la compilation**

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo build
```
Expected : compile OK.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(backend): Tauri commands + app state"
```

### Task 9: Mode live — watcher DB (watcher.rs)

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Écrire watcher.rs**

```rust
// src-tauri/src/watcher.rs
use std::path::Path;
use std::sync::mpsc;
use notify::{Watcher, RecursiveMode, Config as NotifyConfig};
use tauri::{AppHandle, Emitter};

/// Démarre un watcher sur le fichier DB. À chaque modification (debounce ~1 s),
/// émet l'événement "db-changed" vers le frontend.
pub fn start(app: AppHandle, db_path: &str) -> Result<(), String> {
    let path = Path::new(db_path).to_path_buf();
    if !path.exists() { return Err(format!("DB introuvable pour le watcher: {db_path}")); }
    let (tx, rx) = mpsc::channel::<notify::Result<Path>>();
    let mut watcher = notify::recommended_watcher(move |res| { let _ = tx.send(res.map(|e| e.path)); })
        .map_err(|e| e.to_string())?;
    watcher.watcher().configure(NotifyConfig { debounce: Some(1000), ..Default::default() }).ok();
    watcher.watch(&path, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let _ = watcher; // maintenu en vie tant que le thread vit
        for _ in rx {
            let _ = app.emit("db-changed", ());
        }
    });
    Ok(())
}
```

- [ ] **Step 2: Déclarer le module + démarrage conditionnel**

Dans `lib.rs` : `pub mod watcher;`. Dans `.setup`, après `app.manage(...)`, ajouter :
```rust
let s = settings::load(&config_dir);
if s.live {
    let (db, _) = commands::resolve_paths(&s);
    let handle = app.handle().clone();
    if let Err(e) = watcher::start(handle, &db) {
        eprintln!("watcher: {e}");
    }
}
```

- [ ] **Step 3: Vérifier la compilation**

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo build
```
Expected : compile OK.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/watcher.rs src-tauri/src/lib.rs
git commit -m "feat(backend): DB file watcher for live mode"
```

---

## PHASE 2 — Frontend React/TS

### Task 10: Types + client API (types.ts, api.ts)

**Files:**
- Create: `src/types.ts`
- Create: `src/api.ts`

- [ ] **Step 1: Écrire types.ts (miroir de model.rs, camelCase)**

```ts
// src/types.ts
export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; }
export interface ModelUsage { provider: string; model: string; cost: number; tokens: Tokens; }
export interface SessionRecord {
  id: string; project: string; title: string; date: number; cost: number;
  tokens: Tokens; isSubagent: boolean; parentId: string | null;
  usedCustomRate: boolean; models: ModelUsage[];
}
export interface CustomGroup { name: string; projects: string[]; }
export interface Settings {
  dbPath: string | null; configPath: string | null; live: boolean;
  theme: "system" | "light" | "dark"; defaultPeriodDays: number; customGroups: CustomGroup[];
}
```

- [ ] **Step 2: Écrire api.ts**

```ts
// src/api.ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SessionRecord, Settings } from "./types";

export const getData = () => invoke<SessionRecord[]>("get_data");
export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (s: Settings) => invoke<void>("save_settings", { s });
export const pickPath = () => invoke<string | null>("pick_path");
export const onDbChanged = (cb: () => void) => listen("db-changed", cb);
```

- [ ] **Step 3: Vérifier le build frontend**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run build
```
Expected : build OK (les types sont utilisés plus tard ; pas d'erreur TS bloquante).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/api.ts
git commit -m "feat(frontend): types + Tauri API client"
```

### Task 11: Filtrage + agrégations côté client (lib/aggregate.ts) — TDD

**Files:**
- Create: `src/lib/aggregate.ts`
- Test: `src/lib/aggregate.test.ts`
- Modify: `package.json` (ajouter vitest + script test)

- [ ] **Step 1: Installer vitest**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm install -D vitest
```
Puis dans `package.json`, ajouter au bloc `scripts` : `"test": "vitest run"`.

- [ ] **Step 2: Écrire le test (d'abord)**

```ts
// src/lib/aggregate.test.ts
import { describe, it, expect } from "vitest";
import { filterSessions, sumCost, byProject, byModel, byProvider, tokenTotals, topSessions, byGroup } from "./aggregate";
import type { SessionRecord } from "../types";

const S = (o: Partial<SessionRecord>): SessionRecord => ({
  id: "s", project: "C:/git/a", title: "t", date: 1700000000000, cost: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  isSubagent: false, parentId: null, usedCustomRate: false, models: [], ...o,
});

describe("filterSessions", () => {
  it("filtre par projet", () => {
    const data = [S({ id: "1", project: "C:/git/a" }), S({ id: "2", project: "C:/git/b" })];
    expect(filterSessions(data, { project: "C:/git/a" }).map(s => s.id)).toEqual(["1"]);
  });
  it("filtre par plage de dates", () => {
    const data = [S({ id: "1", date: 1000 }), S({ id: "2", date: 5000 })];
    expect(filterSessions(data, { from: 2000, to: 4000 }).map(s => s.id)).toEqual([]);
    expect(filterSessions(data, { from: 0, to: 4000 }).map(s => s.id)).toEqual(["1"]);
  });
});

describe("agrégations", () => {
  const data = [
    S({ id: "1", project: "C:/git/a", cost: 10, models: [{ provider: "p", model: "m1", cost: 10, tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }] }),
    S({ id: "2", project: "C:/git/a", cost: 5, models: [{ provider: "p", model: "m2", cost: 5, tokens: { input: 0, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }] }),
    S({ id: "3", project: "C:/git/b", cost: 7, models: [{ provider: "q", model: "m1", cost: 7, tokens: { input: 0, output: 0, cacheRead: 3, cacheWrite: 0, reasoning: 0 } }] }),
  ];
  it("sumCost", () => expect(sumCost(data)).toBeCloseTo(22));
  it("byProject", () => {
    const r = byProject(data);
    expect(r.find(x => x.key === "C:/git/a")!.value).toBeCloseTo(15);
    expect(r.find(x => x.key === "C:/git/b")!.value).toBeCloseTo(7);
  });
  it("byModel", () => {
    const r = byModel(data);
    expect(r.find(x => x.key === "m1")!.value).toBeCloseTo(17); // 10 + 7
  });
  it("byProvider", () => {
    const r = byProvider(data);
    expect(r.find(x => x.key === "p")!.value).toBeCloseTo(15);
  });
  it("tokenTotals", () => {
    const t = tokenTotals(data);
    expect(t.input).toBe(1); expect(t.output).toBe(2); expect(t.cacheRead).toBe(3);
  });
  it("topSessions", () => {
    const r = topSessions(data, 2);
    expect(r.map(s => s.id)).toEqual(["1", "3"]); // tri coût décroissant
  });
  it("byGroup (dossier parent)", () => {
    const r = byGroup(data, []);
    // C:/git/a -> parent C:/git ; C:/git/b -> parent C:/git
    expect(r.find(x => x.key === "C:/git")!.value).toBeCloseTo(22);
  });
});
```

- [ ] **Step 3: Faire échouer le test**

Créer `src/lib/aggregate.ts` avec les signatures (corps `throw new Error("todo")`) :
```ts
// src/lib/aggregate.ts
import type { SessionRecord, Tokens, CustomGroup } from "../types";

export interface Filters { project?: string; model?: string; provider?: string; from?: number; to?: number; }
export interface KV { key: string; value: number; }

export function filterSessions(data: SessionRecord[], f: Filters): SessionRecord { throw new Error("todo"); }
export function sumCost(data: SessionRecord[]): number { throw new Error("todo"); }
export function byProject(data: SessionRecord[]): KV[] { throw new Error("todo"); }
export function byModel(data: SessionRecord[]): KV[] { throw new Error("todo"); }
export function byProvider(data: SessionRecord[]): KV[] { throw new Error("todo"); }
export function tokenTotals(data: SessionRecord[]): Tokens { throw new Error("todo"); }
export function topSessions(data: SessionRecord[], n: number): SessionRecord[] { throw new Error("todo"); }
export function byGroup(data: SessionRecord[], custom: CustomGroup[]): KV[] { throw new Error("todo"); }
```
Run:
```bash
cd C:\git\OpencodeCostViewer
npm test
```
Expected : FAIL (tous les tests, `todo`).

- [ ] **Step 4: Implémenter**

```ts
// src/lib/aggregate.ts
import type { SessionRecord, Tokens, CustomGroup } from "../types";

export interface Filters { project?: string; model?: string; provider?: string; from?: number; to?: number; }
export interface KV { key: string; value: number; }

export function filterSessions(data: SessionRecord[], f: Filters): SessionRecord[] {
  return data.filter(s => {
    if (f.project && s.project !== f.project) return false;
    if (f.from && s.date < f.from) return false;
    if (f.to && s.date > f.to) return false;
    if (f.model && !s.models.some(m => m.model === f.model)) return false;
    if (f.provider && !s.models.some(m => m.provider === f.provider)) return false;
    return true;
  });
}

export function sumCost(data: SessionRecord[]): number {
  return data.reduce((a, s) => a + s.cost, 0);
}

function groupBy(data: SessionRecord[], keyFn: (s: SessionRecord) => Iterable<string>): KV[] {
  const m = new Map<string, number>();
  for (const s of data) for (const k of keyFn(s)) m.set(k, (m.get(k) ?? 0) + s.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

export const byProject = (d: SessionRecord[]) => groupBy(d, s => [s.project]);
export const byModel = (d: SessionRecord[]) => groupBy(d, s => s.models.map(m => m.model));
export const byProvider = (d: SessionRecord[]) => groupBy(d, s => s.models.map(m => m.provider));

export function tokenTotals(data: SessionRecord[]): Tokens {
  const t: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  for (const s of data) {
    t.input += s.tokens.input; t.output += s.tokens.output;
    t.cacheRead += s.tokens.cacheRead; t.cacheWrite += s.tokens.cacheWrite;
    t.reasoning += s.tokens.reasoning;
  }
  return t;
}

export function topSessions(data: SessionRecord[], n: number): SessionRecord[] {
  return [...data].sort((a, b) => b.cost - a.cost).slice(0, n);
}

function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

export function byGroup(data: SessionRecord[], custom: CustomGroup[]): KV[] {
  const m = new Map<string, number>();
  for (const s of data) {
    // un groupe custom prend le pas sur le groupe auto
    const cg = custom.find(g => g.projects.includes(s.project));
    const key = cg ? cg.name : parentDir(s.project);
    m.set(key, (m.get(key) ?? 0) + s.cost);
  }
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}
```

- [ ] **Step 5: Vérifier que les tests passent**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm test
```
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/aggregate.ts src/lib/aggregate.test.ts package.json
git commit -m "feat(frontend): client-side filtering + aggregation"
```

### Task 12: Thème OS-aware (theme.ts + index.css)

**Files:**
- Create: `src/theme.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Écrire theme.ts**

```ts
// src/theme.ts
export type OS = "windows" | "macos" | "linux" | "unknown";

export function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

/// Applique la classe de thème (os + light/dark) sur <html>.
export function applyTheme(os: OS, mode: "system" | "light" | "dark") {
  const root = document.documentElement;
  root.classList.remove("os-windows", "os-macos", "os-linux");
  root.classList.add(`os-${os}`);
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}
```

- [ ] **Step 2: Écrire index.css (variables + style natif OS-aware + pulse LIVE)**

```css
/* src/index.css */
:root {
  --bg: #f5f6f8; --panel: #ffffff; --border: #e3e6ea; --text: #1a1d21; --muted: #6b7280;
  --accent: #2563eb; --live: #16a34a;
  --radius: 8px; --font: system-ui, "Segoe UI", sans-serif;
}
:root.dark {
  --bg: #0f1117; --panel: #161a23; --border: #262c3a; --text: #e5e7eb; --muted: #9ca3af;
  --accent: #6366f1; --live: #34d399;
}
/* Ajustements typographiques par OS (sensation native) */
:root.os-windows { --font: "Segoe UI", system-ui, sans-serif; --radius: 4px; }
:root.os-macos { --font: -apple-system, "SF Pro Text", system-ui, sans-serif; --radius: 10px; }
:root.os-linux { --font: "Cantarell", "Ubuntu", system-ui, sans-serif; --radius: 6px; }

* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font); background: var(--bg); color: var(--text); }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
.muted { color: var(--muted); }
button { font-family: inherit; }

/* Bouton LIVE : pulse quand actif */
.live-btn { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px;
  border-radius: 20px; border: 1px solid var(--border); background: var(--panel);
  color: var(--muted); cursor: pointer; font-size: 12px; }
.live-btn .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.live-btn.on { color: var(--live); border-color: var(--live); }
.live-btn.on .dot { background: var(--live); animation: pulse 1.2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
```

- [ ] **Step 3: Vérifier le build**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run build
```
Expected : build OK.

- [ ] **Step 4: Commit**

```bash
git add src/theme.ts src/index.css
git commit -m "feat(frontend): OS-aware theme + LIVE pulse style"
```

### Task 13: Header avec bouton LIVE + accès Réglages (Header.tsx)

**Files:**
- Create: `src/components/Header.tsx`

- [ ] **Step 1: Écrire Header.tsx**

```tsx
// src/components/Header.tsx
interface Props { live: boolean; onToggleLive: () => void; onOpenSettings: () => void; }

export function Header({ live, onToggleLive, onOpenSettings }: Props) {
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg,var(--accent),#22d3ee)" }} aria-hidden />
        <span style={{ fontWeight: 600, fontSize: 15 }}>Opencode Cost Viewer</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button className={`live-btn${live ? " on" : ""}`} onClick={onToggleLive} aria-pressed={live} aria-label="Mode live">
          <span className="dot" aria-hidden /> LIVE
        </button>
        <button onClick={onOpenSettings} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12 }} aria-label="Réglages">
          ⚙ Réglages
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Vérifier le build**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run build
```
Expected : build OK.

- [ ] **Step 3: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat(frontend): header with LIVE toggle"
```

### Task 14: Barre de filtres + cartes KPI (FilterBar.tsx, KpiCards.tsx)

**Files:**
- Create: `src/components/FilterBar.tsx`
- Create: `src/components/KpiCards.tsx`

- [ ] **Step 1: Écrire FilterBar.tsx**

```tsx
// src/components/FilterBar.tsx
import type { Filters } from "../lib/aggregate";

interface Props {
  filters: Filters;
  projects: string[]; models: string[]; providers: string[];
  onChange: (f: Filters) => void;
}

const sel = "flex:1;min-width:130px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--text)";

export function FilterBar({ filters, projects, models, providers, onChange }: Props) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "14px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
      <select style={sel} value={filters.project ?? ""} onChange={e => onChange({ ...filters, project: e.target.value || undefined })} aria-label="Filtre projet">
        <option value="">Projet : Tous</option>
        {projects.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <select style={sel} value={filters.model ?? ""} onChange={e => onChange({ ...filters, model: e.target.value || undefined })} aria-label="Filtre modèle">
        <option value="">Modèle : Tous</option>
        {models.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select style={sel} value={filters.provider ?? ""} onChange={e => onChange({ ...filters, provider: e.target.value || undefined })} aria-label="Filtre provider">
        <option value="">Provider : Tous</option>
        {providers.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <input type="date" style={sel} value={filters.from ? new Date(filters.from).toISOString().slice(0, 10) : ""}
        onChange={e => onChange({ ...filters, from: e.target.value ? new Date(e.target.value).getTime() : undefined })} aria-label="Date début" />
      <input type="date" style={sel} value={filters.to ? new Date(filters.to).toISOString().slice(0, 10) : ""}
        onChange={e => onChange({ ...filters, to: e.target.value ? new Date(e.target.value).getTime() : undefined })} aria-label="Date fin" />
      <button onClick={() => onChange({})} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
        Réinitialiser
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Écrire KpiCards.tsx**

```tsx
// src/components/KpiCards.tsx
import type { SessionRecord } from "../types";
import { sumCost, tokenTotals } from "../lib/aggregate";

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export function KpiCards({ data }: { data: SessionRecord[] }) {
  const cost = sumCost(data);
  const t = tokenTotals(data);
  const tokens = t.input + t.output + t.cacheRead + t.cacheWrite + t.reasoning;
  const sub = data.filter(s => s.isSubagent).length;
  const projects = new Set(data.map(s => s.project)).size;
  const cards = [
    { label: "Coût total", value: `${fmt(cost)} $`, color: "#22d3ee", sub: "sur la période filtrée" },
    { label: "Tokens", value: `${fmt(tokens / 1e6)} M`, color: "#a78bfa", sub: "in / out / cache" },
    { label: "Sessions", value: fmt(data.length), color: "#f472b6", sub: `dont ${sub} sous-agents` },
    { label: "Projets", value: fmt(projects), color: "#fbbf24", sub: "distincts" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, padding: "16px 20px" }}>
      {cards.map(c => (
        <div key={c.label} className="panel">
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{c.label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: c.color }}>{c.value}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Vérifier le build**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run build
```
Expected : build OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/FilterBar.tsx src/components/KpiCards.tsx
git commit -m "feat(frontend): filter bar + KPI cards"
```

### Task 15: Graphiques (Recharts) — 7 composants

**Files:**
- Create: `src/components/charts/CostOverTime.tsx`, `CostByProject.tsx`, `CostByModel.tsx`, `CostByProvider.tsx`, `TokenBreakdown.tsx`, `TopSessions.tsx`, `CostByGroup.tsx`
- Modify: `package.json` (ajouter recharts)

- [ ] **Step 1: Installer recharts**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm install recharts
```

- [ ] **Step 2: Écrire CostOverTime.tsx (courbe/aire, groupée par jour)**

```tsx
// src/components/charts/CostOverTime.tsx
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { SessionRecord } from "../../types";

export function CostOverTime({ data }: { data: SessionRecord[] }) {
  const byDay = new Map<string, number>();
  for (const s of data) {
    const d = new Date(s.date).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + s.cost);
  }
  const rows = [...byDay.entries()].map(([day, cost]) => ({ day, cost })).sort((a, b) => a.day.localeCompare(b.day));
  return (
    <div className="panel" style={{ gridColumn: "span 2" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Coût dans le temps</div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={rows}>
          <defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <Tooltip />
          <Area type="monotone" dataKey="cost" stroke="#22d3ee" fill="url(#c)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Écrire CostByProject.tsx (barres horizontales)**

```tsx
// src/components/charts/CostByProject.tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { byProject } from "../../lib/aggregate";
import type { SessionRecord } from "../../types";

export function CostByProject({ data }: { data: SessionRecord[] }) {
  const rows = byProject(data).slice(0, 8).map(r => ({ name: r.key.split(/[\\/]/).pop() ?? r.key, cost: r.value }));
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Coût par projet</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={rows} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <Tooltip />
          <Bar dataKey="cost" fill="#6366f1" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Écrire CostByModel.tsx (barres verticales)**

```tsx
// src/components/charts/CostByModel.tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { byModel } from "../../lib/aggregate";
import type { SessionRecord } from "../../types";

export function CostByModel({ data }: { data: SessionRecord[] }) {
  const rows = byModel(data).slice(0, 8).map(r => ({ name: r.key.split("/").pop() ?? r.key, cost: r.value }));
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Coût par modèle</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={rows}>
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--muted)" }} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <Tooltip />
          <Bar dataKey="cost" fill="#22d3ee" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 5: Écrire CostByProvider.tsx (donut)**

```tsx
// src/components/charts/CostByProvider.tsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { byProvider } from "../../lib/aggregate";
import type { SessionRecord } from "../../types";

const COLORS = ["#6366f1", "#22d3ee", "#f472b6", "#fbbf24", "#a78bfa", "#6b7280"];

export function CostByProvider({ data }: { data: SessionRecord[] }) {
  const rows = byProvider(data).map(r => ({ name: r.key, value: r.value }));
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Coût par provider</div>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
            {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 6: Écrire TokenBreakdown.tsx (barres par type de token)**

```tsx
// src/components/charts/TokenBreakdown.tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { tokenTotals } from "../../lib/aggregate";
import type { SessionRecord } from "../../types";

export function TokenBreakdown({ data }: { data: SessionRecord[] }) {
  const t = tokenTotals(data);
  const rows = [
    { name: "Input", v: t.input }, { name: "Output", v: t.output },
    { name: "Cache R", v: t.cacheRead }, { name: "Cache W", v: t.cacheWrite }, { name: "Reason", v: t.reasoning },
  ];
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Décomposition tokens</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={rows} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <Tooltip />
          <Bar dataKey="v" fill="#a78bfa" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 7: Écrire TopSessions.tsx (liste des plus coûteuses)**

```tsx
// src/components/charts/TopSessions.tsx
import { topSessions } from "../../lib/aggregate";
import type { SessionRecord } from "../../types";

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export function TopSessions({ data }: { data: SessionRecord[] }) {
  const rows = topSessions(data, 6);
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Top sessions coûteuses</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}>
        {rows.map(s => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
            <b style={{ color: "var(--text)" }}>{fmt(s.cost)} $</b>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Écrire CostByGroup.tsx (barres par groupe)**

```tsx
// src/components/charts/CostByGroup.tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { byGroup } from "../../lib/aggregate";
import type { SessionRecord, CustomGroup } from "../../types";

export function CostByGroup({ data, groups }: { data: SessionRecord[]; groups: CustomGroup[] }) {
  const rows = byGroup(data, groups).slice(0, 8).map(r => ({ name: r.key.split(/[\\/]/).pop() ?? r.key, cost: r.value }));
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Coût par groupe de projet</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={rows} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <Tooltip />
          <Bar dataKey="cost" fill="#f472b6" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 9: Vérifier le build**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run build
```
Expected : build OK.

- [ ] **Step 10: Commit**

```bash
git add src/components/charts/ package.json
git commit -m "feat(frontend): 7 chart components (Recharts)"
```

### Task 16: Table de sessions (SessionTable.tsx)

**Files:**
- Create: `src/components/SessionTable.tsx`

- [ ] **Step 1: Écrire SessionTable.tsx**

```tsx
// src/components/SessionTable.tsx
import { useMemo, useState } from "react";
import type { SessionRecord } from "../types";

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : `${Math.round(n / 1e3)} K`;

type SortKey = "cost" | "date" | "title";

export function SessionTable({ data }: { data: SessionRecord[] }) {
  const [sort, setSort] = useState<SortKey>("cost");
  const [asc, setAsc] = useState(false);
  const rows = useMemo(() => {
    const r = [...data];
    r.sort((a, b) => {
      const v = sort === "cost" ? a.cost - b.cost : sort === "date" ? a.date - b.date : a.title.localeCompare(b.title);
      return asc ? v : -v;
    });
    return r.slice(0, 200); // limite d'affichage
  }, [data, sort, asc]);

  const th = (label: string, key: SortKey, right = false) => (
    <th style={{ textAlign: right ? "right" : "left", cursor: "pointer" }} onClick={() => { if (sort === key) setAsc(!asc); else { setSort(key); setAsc(false); } }}>
      {label}{sort === key ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
            {th("Session", "title")}
            <th style={{ textAlign: "left" }}>Projet</th>
            <th style={{ textAlign: "left" }}>Modèle</th>
            <th style={{ textAlign: "right" }}>Tokens</th>
            {th("Coût", "cost", true)}
          </tr>
        </thead>
        <tbody>
          {rows.map(s => {
            const tok = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite + s.tokens.reasoning;
            const mainModel = s.models.slice().sort((a, b) => b.cost - a.cost)[0];
            return (
              <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    {s.title}
                    {s.usedCustomRate
                      ? <span style={{ fontSize: 9, color: "#34d399", background: "rgba(52,211,153,.12)", padding: "1px 6px", borderRadius: 10 }}>tarif ✓</span>
                      : <span style={{ fontSize: 9, color: "var(--muted)", background: "var(--border)", padding: "1px 6px", borderRadius: 10 }}>coût 0</span>}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{s.project.split(/[\\/]/).pop()}</td>
                <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{mainModel ? mainModel.model.split("/").pop() : "—"}</td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>{fmtTok(tok)}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: s.cost > 0 ? "#22d3ee" : "var(--muted)" }}>{fmt(s.cost)} $</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier le build**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run build
```
Expected : build OK.

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionTable.tsx
git commit -m "feat(frontend): sortable session table with rate badges"
```

### Task 17: Écran de réglages (SettingsModal.tsx)

**Files:**
- Create: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Écrire SettingsModal.tsx**

```tsx
// src/components/SettingsModal.tsx
import { useState } from "react";
import type { Settings } from "../types";
import { saveSettings, pickPath } from "../api";

interface Props { open: boolean; settings: Settings; onClose: () => void; onSaved: (s: Settings) => void; }

export function SettingsModal({ open, settings, onClose, onSaved }: Props) {
  const [s, setS] = useState<Settings>(settings);
  if (!open) return null;

  const pick = async (field: "dbPath" | "configPath") => {
    const p = await pickPath();
    if (p) setS(prev => ({ ...prev, [field]: p }));
  };

  const save = async () => {
    await saveSettings(s);
    onSaved(s);
    onClose();
  };

  const row = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)";
  const btn = "background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--text)";

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="settings-title"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div className="panel" style={{ width: 480, maxWidth: "90vw" }}>
        <h2 id="settings-title" style={{ marginTop: 0, fontSize: 16 }}>Réglages</h2>

        <div style={row}>
          <span>Base opencode.db</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.dbPath ?? "auto"}</span>
            <button className={btn} onClick={() => pick("dbPath")}>Parcourir…</button>
          </span>
        </div>
        <div style={row}>
          <span>Config opencode.jsonc</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.configPath ?? "auto"}</span>
            <button className={btn} onClick={() => pick("configPath")}>Parcourir…</button>
          </span>
        </div>
        <div style={row}>
          <label htmlFor="set-live">Mode live</label>
          <input id="set-live" type="checkbox" checked={s.live} onChange={e => setS({ ...s, live: e.target.checked })} />
        </div>
        <div style={row}>
          <label htmlFor="set-theme">Thème</label>
          <select id="set-theme" className={btn} value={s.theme} onChange={e => setS({ ...s, theme: e.target.value as Settings["theme"] })}>
            <option value="system">Système</option><option value="light">Clair</option><option value="dark">Sombre</option>
          </select>
        </div>
        <div style={row}>
          <label htmlFor="set-period">Période par défaut (jours)</label>
          <input id="set-period" type="number" className={btn} value={s.defaultPeriodDays} onChange={e => setS({ ...s, defaultPeriodDays: Number(e.target.value) })} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button className={btn} onClick={onClose}>Annuler</button>
          <button className={btn} style={{ background: "var(--accent)", color: "#fff", border: "none" }} onClick={save}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier le build**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run build
```
Expected : build OK.

- [ ] **Step 3: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat(frontend): settings modal (paths, live, theme, period)"
```

### Task 18: Assemblage App.tsx + mode live

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/main.tsx` (si nécessaire pour le thème)

- [ ] **Step 1: Écrire App.tsx**

```tsx
// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import { getData, getSettings, onDbChanged } from "./api";
import type { SessionRecord, Settings } from "./types";
import { detectOS, applyTheme } from "./theme";
import { filterSessions, type Filters } from "./lib/aggregate";
import { Header } from "./components/Header";
import { FilterBar } from "./components/FilterBar";
import { KpiCards } from "./components/KpiCards";
import { CostOverTime } from "./components/charts/CostOverTime";
import { CostByProject } from "./components/charts/CostByProject";
import { CostByModel } from "./components/charts/CostByModel";
import { CostByProvider } from "./components/charts/CostByProvider";
import { TokenBreakdown } from "./components/charts/TokenBreakdown";
import { TopSessions } from "./components/charts/TopSessions";
import { CostByGroup } from "./components/charts/CostByGroup";
import { SessionTable } from "./components/SessionTable";
import { SettingsModal } from "./components/SettingsModal";

export default function App() {
  const [data, setData] = useState<SessionRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [showSettings, setShowSettings] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    applyTheme(detectOS(), settings?.theme ?? "system");
  }, [settings?.theme]);

  const load = () => getData().then(setData).catch(e => console.error("get_data", e));

  useEffect(() => {
    getSettings().then(setSettings);
    load();
    const un = onDbChanged(() => { setLive(true); load(); });
    return () => { un.then(f => f()); };
  }, []);

  const filtered = useMemo(() => filterSessions(data, filters), [data, filters]);
  const projects = useMemo(() => [...new Set(data.map(s => s.project))].sort(), [data]);
  const models = useMemo(() => [...new Set(data.flatMap(s => s.models.map(m => m.model)))].sort(), [data]);
  const providers = useMemo(() => [...new Set(data.flatMap(s => s.models.map(m => m.provider)))].sort(), [data]);

  if (!settings) return <div className="muted" style={{ padding: 20 }}>Chargement…</div>;

  return (
    <div>
      <Header live={live} onToggleLive={() => setLive(v => !v)} onOpenSettings={() => setShowSettings(true)} />
      <FilterBar filters={filters} projects={projects} models={models} providers={providers} onChange={setFilters} />
      <KpiCards data={filtered} />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, padding: "0 20px 12px" }}>
        <CostOverTime data={filtered} />
        <CostByProvider data={filtered} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, padding: "0 20px 12px" }}>
        <CostByProject data={filtered} />
        <CostByModel data={filtered} />
        <TokenBreakdown data={filtered} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 20px 16px" }}>
        <TopSessions data={filtered} />
        <CostByGroup data={filtered} groups={settings.customGroups} />
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <SessionTable data={filtered} />
      </div>
      <SettingsModal open={showSettings} settings={settings} onClose={() => setShowSettings(false)} onSaved={setSettings} />
    </div>
  );
}
```

> Note : le bouton LIVE du header est un toggle d'affichage ; le rafraîchissement réel est piloté par l'événement `db-changed` (émis par le watcher backend quand `settings.live` est vrai). Le `setLive(true)` au `db-changed` allume le pulse.

- [ ] **Step 2: Vérifier le build**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run build
```
Expected : build OK.

- [ ] **Step 3: Lancer l'app en dev pour vérifier visuellement**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run tauri dev
```
Expected : la fenêtre s'ouvre, affiche les KPIs + graphiques + table avec les données réelles de `opencode.db`. (Si la DB/config n'est pas trouvée, un message d'erreur s'affiche — voir Task 19.)

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/main.tsx
git commit -m "feat(frontend): assemble dashboard + live refresh"
```

---

## PHASE 3 — Intégration & acceptation

### Task 19: Test d'acceptation — correspondance avec le CSV du script

**Files:**
- Create: `src-tauri/tests/acceptance_test.rs`

L'objectif : vérifier que le calcul de l'app reproduit les coûts du script legacy `_old/Get-OpencodeSessionCosts.ps1` (exporté dans `_old/opencode-costs.csv`) sur la même base.

- [ ] **Step 1: Écrire le test d'acceptation**

```rust
// src-tauri/tests/acceptance_test.rs
// Compare le coût par session calculé par l'app avec le CSV du script legacy.
// Le CSV _old/opencode-costs.csv a les colonnes: Project, SessionId, Title, Cost, TarifCustomUtil
use std::collections::HashMap;

#[test]
fn matches_legacy_csv() {
    // 1) Chemins réels (sur la machine de dev). Ignorer le test si absents.
    let db = dirs::data_dir().unwrap().join("opencode").join("opencode.db");
    let cfg = dirs::config_dir().unwrap().join("opencode").join("opencode.jsonc");
    let csv = concat!(env!("CARGO_MANIFEST_DIR"), "/../_old/opencode-costs.csv");
    if !db.exists() || !cfg.exists() || !std::path::Path::new(csv).exists() {
        eprintln!("acceptance: ignoré (fichiers réels absents)");
        return;
    }
    // 2) Calculer les sessions via l'app
    let cfg_text = std::fs::read_to_string(cfg).unwrap();
    let rates = opencode_costs_viewer_lib::config::extract_rates(&cfg_text).unwrap();
    let rows = opencode_costs_viewer_lib::db::load_rows(db.to_str().unwrap()).unwrap();
    let sessions = opencode_costs_viewer_lib::aggregate::aggregate(&rows, &rates);
    let app_cost: HashMap<&str, f64> = sessions.iter().map(|s| (s.id.as_str(), s.cost)).collect();

    // 3) Lire le CSV legacy (parser simple : colonnes séparées par ; ou , avec guillemets)
    let content = std::fs::read_to_string(csv).unwrap();
    let mut csv_cost: HashMap<String, f64> = HashMap::new();
    for line in content.lines().skip(1) {
        // format attendu: "Project","SessionId","Title","Cost","TarifCustomUtil"
        let fields: Vec<&str> = line.split('"').collect();
        if fields.len() < 8 { continue; }
        let session_id = fields[2].to_string();
        let cost_str = fields[6].replace(',', ".");
        if let Ok(cost) = cost_str.parse::<f64>() {
            csv_cost.insert(session_id, cost);
        }
    }
    // 4) Comparer sur les sessions présentes dans les deux (tolérance 1%)
    let mut compared = 0;
    for (sid, csv_c) in &csv_cost {
        if let Some(app_c) = app_cost.get(sid.as_str()) {
            compared += 1;
            if *csv_c > 0.0 || *app_c > 0.0 {
                let diff = (app_c - csv_c).abs();
                let tol = 0.01 * csv_c.max(*app_c).max(1e-9);
                assert!(diff <= tol, "session {sid}: app={app_c} csv={csv_c}");
            }
        }
    }
    assert!(compared > 0, "aucune session commune comparée");
}
```

> Note : le CSV legacy utilise la virgule comme séparateur décimal (ex : `1,1628973999999999`) et le `;`/`,` comme séparateur de colonnes selon l'export. Ajuster le parsing du Step 4 si le format réel diffère (vérifier `_old/opencode-costs.csv`). Le nom de crate `opencode_costs_viewer_lib` est à remplacer par le vrai nom (voir note Task 6).

Run:
```bash
cd C:\git\OpencodeCostViewer\src-tauri
cargo test --test acceptance_test
```
Expected : PASS (ou ignoré si les fichiers réels sont absents). Si des écarts > 1% apparaissent, c'est un bug de logique de calcul à corriger dans `cost.rs`/`aggregate.rs`.

- [ ] **Step 2: Commit**

```bash
git add src-tauri/tests/acceptance_test.rs
git commit -m "test: acceptance test vs legacy script CSV"
```

### Task 20: Build final + polish

**Files:**
- Modify: `src-tauri/tauri.conf.json` (titre, icône, bundle)

- [ ] **Step 1: Ajuster tauri.conf.json**

Dans `src-tauri/tauri.conf.json`, vérifier/poser :
- `productName` : `Opencode Cost Viewer`
- `app.window.title` : `Opencode Cost Viewer`
- `app.window.width` : `1280`, `height` : `800`
- `bundle.active` : `true`, `bundle.targets` : `all`

- [ ] **Step 2: Build de production**

Run:
```bash
cd C:\git\OpencodeCostViewer
npm run tauri build
```
Expected : binaire généré dans `src-tauri/target/release/bundle/` (msi/exe sur Windows, app/dmg sur macOS, AppImage/deb sur Linux).

- [ ] **Step 3: Lancer le binaire et vérifier**

Ouvrir le binaire généré. Vérifier : KPIs, graphiques, table, filtres, bouton LIVE (pulse si live), Réglages (changer un chemin, thème).

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "chore: final build config + polish"
```

---

## Self-Review (à faire après rédaction)

- [ ] **Couverture spec** : chaque section du design doc a une tâche (coût, JSONC, config, DB, agrégation, settings, watcher, UI, filtres, graphiques, table, groupes, live, thème, erreurs, tests, acceptation).
- [ ] **Pas de placeholder** : chaque step a du code/une commande concrète.
- [ ] **Cohérence des types** : `Tokens`/`SessionRecord`/`Settings` alignés entre Rust (camelCase via serde) et TS.
- [ ] **Nom de crate** : `opencode_costs_viewer_lib` est un placeholder à remplacer par le vrai `name` de `src-tauri/Cargo.toml` (signalé dans les notes des Tasks 6 et 19).
