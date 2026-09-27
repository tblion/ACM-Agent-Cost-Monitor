# Bouton Tarifs + Chemins résolus + Fix byModel/byProvider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger l'agrégation byModel/byProvider, afficher les chemins résolus en placeholder dans Réglages, et ajouter un bouton "Tarifs" avec une modale listant les tarifs du opencode.jsonc.

**Architecture:** Trois tâches indépendantes. Task 1 (fix frontend pur, TDD). Task 2 (commande Rust + mise à jour SettingsModal). Task 3 (commande Rust + nouveau composant RatesModal). Chaque tâche se termine par un commit et une vérification de build.

**Tech Stack:** Rust (Tauri 2), React 18, TypeScript strict, Vitest, Vite

---

## Fichiers touchés

| Fichier | Action |
|---|---|
| `src/lib/aggregate.ts` | Modifier : remplacer `byModel`, `byProvider`, supprimer `groupBy` |
| `src/lib/aggregate.test.ts` | Modifier : ajouter test multi-provider |
| `src-tauri/src/model.rs` | Modifier : ajouter `ResolvedPaths`, `RateEntry` |
| `src-tauri/src/commands.rs` | Modifier : ajouter `get_resolved_paths`, `get_rates` |
| `src-tauri/src/lib.rs` | Modifier : enregistrer les deux nouvelles commandes |
| `src/types.ts` | Modifier : ajouter `ResolvedPaths`, `RateEntry` |
| `src/api.ts` | Modifier : ajouter `getResolvedPaths`, `getRates` |
| `src/components/SettingsModal.tsx` | Modifier : useEffect + placeholder chemins résolus |
| `src/mock/tauri-mock.ts` | Modifier : ajouter mock `get_resolved_paths`, `get_rates` |
| `src/components/Header.tsx` | Modifier : ajout bouton Tarifs + prop `onOpenRates` |
| `src/App.tsx` | Modifier : state `showRates` + handler + rendu `RatesModal` |
| `src/components/RatesModal.tsx` | Créer : modale avec tableau tarifs |

---

## Task 1 — Fix bug `byModel` / `byProvider`

**Files:**
- Modify: `src/lib/aggregate.ts`
- Modify: `src/lib/aggregate.test.ts`

### Contexte du bug

`groupBy` attribue `s.cost` (coût total de la session) à chaque provider/modèle présent dans la session. Une session qui mélange `llmproxy` (2.75$) + `openrama` (0$) comptabilise 2.75$ pour openrama aussi. La correction : agréger `mu.cost` depuis `s.models`.

- [ ] **Step 1 : Ajouter le test de non-régression multi-provider**

Dans `src/lib/aggregate.test.ts`, ajouter dans le bloc `describe("agrégations")` après le test `byProvider` existant :

```typescript
  it("byProvider : session multi-provider ne double pas le coût", () => {
    const mixed = S({
      id: "mix", cost: 2.75,
      models: [
        { provider: "llmproxy", model: "claude", cost: 2.75, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
        { provider: "openrama", model: "qwen", cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
      ],
    });
    const r = byProvider([mixed]);
    expect(r.find(x => x.key === "llmproxy")!.value).toBeCloseTo(2.75);
    expect(r.find(x => x.key === "openrama")!.value).toBeCloseTo(0);
  });
  it("byModel : session multi-provider ne double pas le coût", () => {
    const mixed = S({
      id: "mix2", cost: 2.75,
      models: [
        { provider: "llmproxy", model: "claude", cost: 2.75, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
        { provider: "openrama", model: "qwen", cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
      ],
    });
    const r = byModel([mixed]);
    expect(r.find(x => x.key === "claude")!.value).toBeCloseTo(2.75);
    expect(r.find(x => x.key === "qwen")!.value).toBeCloseTo(0);
  });
```

- [ ] **Step 2 : Vérifier que les nouveaux tests échouent**

```
npm test
```

Expected : les deux nouveaux tests FAIL (`byProvider` et `byModel` retournent 2.75 pour openrama/qwen au lieu de 0).

- [ ] **Step 3 : Corriger `byModel` et `byProvider` dans `aggregate.ts`**

Remplacer dans `src/lib/aggregate.ts` le bloc :

```typescript
function groupBy(data: SessionRecord[], keyFn: (s: SessionRecord) => Iterable<string>): KV[] {
  const m = new Map<string, number>();
  for (const s of data) for (const k of keyFn(s)) m.set(k, (m.get(k) ?? 0) + s.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

export const byProject = (d: SessionRecord[]) => groupBy(d, s => [s.project]);
export const byModel = (d: SessionRecord[]) => groupBy(d, s => s.models.map(m => m.model));
export const byProvider = (d: SessionRecord[]) => groupBy(d, s => s.models.map(m => m.provider));
```

Par :

```typescript
function groupBy(data: SessionRecord[], keyFn: (s: SessionRecord) => Iterable<string>): KV[] {
  const m = new Map<string, number>();
  for (const s of data) for (const k of keyFn(s)) m.set(k, (m.get(k) ?? 0) + s.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

export const byProject = (d: SessionRecord[]) => groupBy(d, s => [s.project]);

export const byModel = (d: SessionRecord[]): KV[] => {
  const m = new Map<string, number>();
  for (const s of d) for (const mu of s.models)
    m.set(mu.model, (m.get(mu.model) ?? 0) + mu.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
};

export const byProvider = (d: SessionRecord[]): KV[] => {
  const m = new Map<string, number>();
  for (const s of d) for (const mu of s.models)
    m.set(mu.provider, (m.get(mu.provider) ?? 0) + mu.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
};
```

- [ ] **Step 4 : Vérifier que tous les tests passent**

```
npm test
```

Expected : tous les tests PASS (anciens + nouveaux).

- [ ] **Step 5 : Vérifier le build TypeScript**

```
npm run build
```

Expected : aucune erreur TypeScript.

- [ ] **Step 6 : Commit**

```
git add src/lib/aggregate.ts src/lib/aggregate.test.ts
git commit -m "fix: byModel/byProvider aggregent mu.cost au lieu de s.cost"
```

---

## Task 2 — Chemins résolus en placeholder dans Réglages

**Files:**
- Modify: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types.ts`
- Modify: `src/api.ts`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/mock/tauri-mock.ts`

- [ ] **Step 1 : Ajouter `ResolvedPaths` dans `model.rs`**

Ajouter à la fin de `src-tauri/src/model.rs` (avant la fin du fichier) :

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPaths {
    pub db: String,
    pub config: String,
}
```

- [ ] **Step 2 : Ajouter la commande `get_resolved_paths` dans `commands.rs`**

Ajouter l'import de `ResolvedPaths` dans la ligne `use crate::model::{SessionRecord, Settings};` :

```rust
use crate::model::{ResolvedPaths, SessionRecord, Settings};
```

Puis ajouter la fonction à la fin de `src-tauri/src/commands.rs` :

```rust
#[tauri::command]
pub fn get_resolved_paths(state: State<AppState>) -> ResolvedPaths {
    let s = settings::load(&state.config_dir);
    let (db, config) = resolve_paths(&s);
    ResolvedPaths { db, config }
}
```

- [ ] **Step 3 : Enregistrer la commande dans `lib.rs`**

Remplacer dans `src-tauri/src/lib.rs` :

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_data,
            commands::get_settings,
            commands::save_settings,
            commands::pick_path,
        ])
```

Par :

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_data,
            commands::get_settings,
            commands::save_settings,
            commands::pick_path,
            commands::get_resolved_paths,
        ])
```

- [ ] **Step 4 : Compiler le backend Rust**

```
cd src-tauri && cargo build 2>&1
```

Expected : compilation réussie, aucune erreur.

- [ ] **Step 5 : Ajouter `ResolvedPaths` dans `types.ts`**

Ajouter à la fin de `src/types.ts` :

```typescript
export interface ResolvedPaths { db: string; config: string; }
```

- [ ] **Step 6 : Ajouter `getResolvedPaths` dans `api.ts`**

Ajouter à la fin de `src/api.ts` :

```typescript
export const getResolvedPaths = () => invoke<ResolvedPaths>("get_resolved_paths");
```

Ajouter `ResolvedPaths` à l'import depuis `./types` :

```typescript
import type { SessionRecord, Settings, ResolvedPaths } from "./types";
```

- [ ] **Step 7 : Mettre à jour `SettingsModal.tsx`**

Remplacer le contenu complet de `src/components/SettingsModal.tsx` par :

```typescript
// src/components/SettingsModal.tsx
import { useState, useEffect, useRef } from "react";
import type { Settings, CustomGroup, ResolvedPaths } from "../types";
import { pickPath, getResolvedPaths } from "../api";

interface Props { settings: Settings; onClose: () => void; onSave: (s: Settings) => void; }

export function SettingsModal({ settings, onClose, onSave }: Props) {
  const [s, setS] = useState<Settings>({ ...settings, customGroups: settings.customGroups.map(g => ({ ...g })) });
  const [groups, setGroups] = useState<CustomGroup[]>(s.customGroups);
  const [resolved, setResolved] = useState<ResolvedPaths | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Charge les chemins résolus au montage
  useEffect(() => {
    getResolvedPaths().then(setResolved).catch(() => {});
  }, []);

  // Focus trap + fermeture Échap + restauration du focus à la fermeture
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => dialogRef.current
      ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter(el => !el.hasAttribute("disabled"))
      : [];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);

  const set = (patch: Partial<Settings>) => setS(prev => ({ ...prev, ...patch }));

  const pick = async (field: "dbPath" | "configPath") => {
    const p = await pickPath();
    if (p) set({ [field]: p });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel" ref={dialogRef} style={{ width: 520, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 id="settings-title" style={{ margin: 0, fontSize: 16 }}>Réglages</h2>
          <button onClick={onClose} aria-label="Fermer les réglages" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        <label htmlFor="db-path" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Chemin de la base opencode.db</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input id="db-path" value={s.dbPath ?? ""} onChange={e => set({ dbPath: e.target.value || null })}
            placeholder={resolved?.db ?? "Chemin par défaut…"}
            style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }}
            aria-label="Chemin base de données" />
          <button onClick={() => pick("dbPath")} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>Parcourir…</button>
        </div>

        <label htmlFor="config-path" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Chemin de la config opencode.jsonc</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input id="config-path" value={s.configPath ?? ""} onChange={e => set({ configPath: e.target.value || null })}
            placeholder={resolved?.config ?? "Chemin par défaut…"}
            style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }}
            aria-label="Chemin configuration opencode" />
          <button onClick={() => pick("configPath")} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>Parcourir…</button>
        </div>

        <label htmlFor="theme-select" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Thème</label>
        <select id="theme-select" value={s.theme} onChange={e => set({ theme: e.target.value as Settings["theme"] })} style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)", marginBottom: 14 }} aria-label="Thème">
          <option value="system">Système</option><option value="light">Clair</option><option value="dark">Sombre</option>
        </select>

        <label htmlFor="period-days" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Période par défaut (jours)</label>
        <input id="period-days" type="number" min={1} value={s.defaultPeriodDays} onChange={e => set({ defaultPeriodDays: Number(e.target.value) })} style={{ width: 120, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)", marginBottom: 18 }} aria-label="Période par défaut en jours" />

        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Groupes de projet custom</div>
        {groups.map((g, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={g.name} placeholder="Nom du groupe" onChange={e => { const ng = [...groups]; ng[i] = { ...g, name: e.target.value }; setGroups(ng); }} style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }} aria-label={`Nom groupe ${i + 1}`} />
            <input value={g.projects.join(", ")} placeholder="projets (séparés par ,)" onChange={e => { const ng = [...groups]; ng[i] = { ...g, projects: e.target.value.split(",").map(x => x.trim()).filter(Boolean) }; setGroups(ng); }} style={{ flex: 2, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }} aria-label={`Projets groupe ${i + 1}`} />
            <button onClick={() => setGroups(groups.filter((_, j) => j !== i))} aria-label={`Supprimer groupe ${i + 1}`} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>×</button>
          </div>
        ))}
        <button onClick={() => setGroups([...groups, { name: "", projects: [] }])} style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "var(--muted)", cursor: "pointer", marginBottom: 20 }}>+ Ajouter un groupe</button>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Annuler</button>
          <button onClick={() => onSave({ ...s, customGroups: groups })} style={{ background: "var(--accent)", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#fff", cursor: "pointer" }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8 : Ajouter le mock `get_resolved_paths` dans `tauri-mock.ts`**

Dans `src/mock/tauri-mock.ts`, ajouter l'import de `ResolvedPaths` :

```typescript
import type { SessionRecord, Settings, ResolvedPaths } from "../types";
```

Ajouter après la constante `settings` :

```typescript
const resolvedPaths: ResolvedPaths = {
  db: "C:/Users/fcpb6403/.local/share/opencode/opencode.db",
  config: "C:/Users/fcpb6403/.config/opencode/opencode.jsonc",
};
```

Dans le switch du `invoke`, ajouter avant `default` :

```typescript
    case "get_resolved_paths": return resolvedPaths as unknown as T;
```

- [ ] **Step 9 : Vérifier le build TypeScript**

```
npm run build
```

Expected : aucune erreur.

- [ ] **Step 10 : Commit**

```
git add src-tauri/src/model.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/types.ts src/api.ts src/components/SettingsModal.tsx src/mock/tauri-mock.ts
git commit -m "feat: afficher les chemins résolus en placeholder dans Réglages"
```

---

## Task 3 — Bouton "Tarifs" + modale

**Files:**
- Modify: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types.ts`
- Modify: `src/api.ts`
- Modify: `src/components/Header.tsx`
- Modify: `src/App.tsx`
- Create: `src/components/RatesModal.tsx`
- Modify: `src/mock/tauri-mock.ts`

- [ ] **Step 1 : Ajouter `RateEntry` dans `model.rs`**

Ajouter à la fin de `src-tauri/src/model.rs` (après `ResolvedPaths`) :

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateEntry {
    pub provider: String,
    pub model: String,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}
```

- [ ] **Step 2 : Ajouter la commande `get_rates` dans `commands.rs`**

Mettre à jour l'import dans `commands.rs` :

```rust
use crate::model::{ResolvedPaths, RateEntry, SessionRecord, Settings};
```

Ajouter à la fin de `src-tauri/src/commands.rs` :

```rust
#[tauri::command]
pub fn get_rates(state: State<AppState>) -> Vec<RateEntry> {
    let s = settings::load(&state.config_dir);
    let (_, cfg) = resolve_paths(&s);
    let text = std::fs::read_to_string(&cfg).unwrap_or_default();
    let rates = config::extract_rates(&text).unwrap_or_default();
    let mut out: Vec<RateEntry> = rates.into_iter().map(|((provider, model), r)| RateEntry {
        provider,
        model,
        input: r.input,
        output: r.output,
        cache_read: r.cache_read,
        cache_write: r.cache_write,
    }).collect();
    out.sort_by(|a, b| a.provider.cmp(&b.provider).then(a.model.cmp(&b.model)));
    out
}
```

- [ ] **Step 3 : Enregistrer `get_rates` dans `lib.rs`**

Remplacer dans `src-tauri/src/lib.rs` :

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_data,
            commands::get_settings,
            commands::save_settings,
            commands::pick_path,
            commands::get_resolved_paths,
        ])
```

Par :

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_data,
            commands::get_settings,
            commands::save_settings,
            commands::pick_path,
            commands::get_resolved_paths,
            commands::get_rates,
        ])
```

- [ ] **Step 4 : Compiler le backend Rust**

```
cd src-tauri && cargo build 2>&1
```

Expected : aucune erreur.

- [ ] **Step 5 : Ajouter `RateEntry` dans `types.ts`**

Ajouter à la fin de `src/types.ts` :

```typescript
export interface RateEntry { provider: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; }
```

- [ ] **Step 6 : Ajouter `getRates` dans `api.ts`**

Ajouter l'import de `RateEntry` dans la ligne d'import existante :

```typescript
import type { SessionRecord, Settings, ResolvedPaths, RateEntry } from "./types";
```

Ajouter à la fin de `src/api.ts` :

```typescript
export const getRates = () => invoke<RateEntry[]>("get_rates");
```

- [ ] **Step 7 : Mettre à jour `Header.tsx`**

Remplacer le contenu complet de `src/components/Header.tsx` par :

```typescript
// src/components/Header.tsx
interface Props { live: boolean; onToggleLive: () => void; onOpenSettings: () => void; onOpenRates: () => void; }

export function Header({ live, onToggleLive, onOpenSettings, onOpenRates }: Props) {
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg,var(--accent),#22d3ee)" }} aria-hidden />
        <span style={{ fontWeight: 600, fontSize: 15 }}>Opencode Costs Viewer</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button className={`live-btn${live ? " on" : ""}`} onClick={onToggleLive} aria-pressed={live} aria-label="Mode live">
          <span className="dot" aria-hidden /> LIVE
        </button>
        <button onClick={onOpenRates} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12 }} aria-label="Tarifs des modèles">
          $ Tarifs
        </button>
        <button onClick={onOpenSettings} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12 }} aria-label="Réglages">
          ⚙ Réglages
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 8 : Créer `RatesModal.tsx`**

Créer `src/components/RatesModal.tsx` avec le contenu suivant :

```typescript
// src/components/RatesModal.tsx
import { useEffect, useRef, useState } from "react";
import type { RateEntry } from "../types";
import { getRates } from "../api";

interface Props { onClose: () => void; }

export function RatesModal({ onClose }: Props) {
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getRates().then(r => { setRates(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  // Focus trap + fermeture Échap
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => dialogRef.current
      ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter(el => !el.hasAttribute("disabled"))
      : [];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);

  const fmt = (v: number) => v === 0 ? "—" : `$${v.toFixed(2)}`;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel" ref={dialogRef} style={{ width: 680, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby="rates-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 id="rates-title" style={{ margin: 0, fontSize: 16 }}>Tarifs (opencode.jsonc)</h2>
          <button onClick={onClose} aria-label="Fermer les tarifs" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        {loading && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}
        {!loading && rates.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun tarif configuré dans opencode.jsonc.</p>
        )}
        {!loading && rates.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500 }}>Provider</th>
                <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500 }}>Modèle</th>
                <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>Input $/M</th>
                <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>Output $/M</th>
                <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>Cache read</th>
                <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>Cache write</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "7px 10px" }}>{r.provider}</td>
                  <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{r.model}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(r.input)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(r.output)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(r.cacheRead)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(r.cacheWrite)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9 : Mettre à jour `App.tsx`**

Remplacer le contenu complet de `src/App.tsx` par :

```typescript
// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import { getData, getSettings, saveSettings, onDbChanged } from "./api";
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
import { RatesModal } from "./components/RatesModal";

export default function App() {
  const [data, setData] = useState<SessionRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [showSettings, setShowSettings] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const [live, setLive] = useState(false);

  // Chargement initial + thème
  useEffect(() => {
    (async () => {
      const [d, s] = await Promise.all([getData(), getSettings()]);
      setData(d);
      setSettings(s);
      applyTheme(detectOS(), s.theme);
      if (s.live) setLive(true);
    })();
  }, []);

  // Mode live : ré-écoute les changements de la base
  useEffect(() => {
    if (!live) return;
    const un = onDbChanged(() => getData().then(setData));
    return () => { un.then(f => f()); };
  }, [live]);

  // Applique le thème quand il change
  useEffect(() => {
    if (settings) applyTheme(detectOS(), settings.theme);
  }, [settings?.theme]);

  const filtered = useMemo(() => filterSessions(data, filters), [data, filters]);

  const projects = useMemo(() => [...new Set(data.map(s => s.project))].sort(), [data]);
  const models = useMemo(() => [...new Set(data.flatMap(s => s.models.map(m => m.model)))].sort(), [data]);
  const providers = useMemo(() => [...new Set(data.flatMap(s => s.models.map(m => m.provider)))].sort(), [data]);

  if (!settings) return <div style={{ padding: 40, textAlign: "center" }} className="muted">Chargement…</div>;

  const toggleLive = async () => {
    const next = !live;
    setLive(next);
    await saveSettings({ ...settings, live: next });
  };

  const saveSettingsAndClose = async (s: Settings) => {
    setSettings(s);
    await saveSettings(s);
    setShowSettings(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header live={live} onToggleLive={toggleLive} onOpenSettings={() => setShowSettings(true)} onOpenRates={() => setShowRates(true)} />
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <FilterBar filters={filters} projects={projects} models={models} providers={providers} onChange={setFilters} />
        <KpiCards data={filtered} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, padding: "0 20px 16px" }}>
          <CostOverTime data={filtered} />
          <CostByProject data={filtered} />
          <CostByModel data={filtered} />
          <CostByProvider data={filtered} />
          <TokenBreakdown data={filtered} />
          <TopSessions data={filtered} />
          <CostByGroup data={filtered} groups={settings.customGroups} />
        </div>
        <div style={{ padding: "0 20px 20px" }}>
          <SessionTable data={filtered} />
        </div>
      </main>
      {showSettings && <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onSave={saveSettingsAndClose} />}
      {showRates && <RatesModal onClose={() => setShowRates(false)} />}
    </div>
  );
}
```

- [ ] **Step 10 : Ajouter le mock `get_rates` dans `tauri-mock.ts`**

Ajouter l'import de `RateEntry` dans la ligne d'import :

```typescript
import type { SessionRecord, Settings, ResolvedPaths, RateEntry } from "../types";
```

Ajouter après `resolvedPaths` :

```typescript
const rates: RateEntry[] = [
  { provider: "llmproxy", model: "vertex_ai/claude-sonnet-4-6", input: 3.3, output: 16.5, cacheRead: 0.33, cacheWrite: 1.65 },
  { provider: "llmproxy", model: "vertex_ai/claude-opus-4-6", input: 15, output: 75, cacheRead: 1.5, cacheWrite: 7.5 },
  { provider: "llmproxy", model: "openai/gpt-4.1", input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
];
```

Dans le switch, ajouter :

```typescript
    case "get_rates": return rates as unknown as T;
```

- [ ] **Step 11 : Vérifier le build TypeScript**

```
npm run build
```

Expected : aucune erreur TypeScript.

- [ ] **Step 12 : Commit**

```
git add src-tauri/src/model.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/types.ts src/api.ts src/components/Header.tsx src/App.tsx src/components/RatesModal.tsx src/mock/tauri-mock.ts
git commit -m "feat: bouton Tarifs + modale tableau tarifs depuis opencode.jsonc"
```

---

## Task 4 — Lancement en mode dev sur la vraie DB

- [ ] **Step 1 : Lancer l'app en mode dev**

```
npm run tauri dev
```

Expected : la fenêtre Tauri s'ouvre avec les données réelles de `~/.local/share/opencode/opencode.db`.

- [ ] **Step 2 : Vérifier le fix byProvider**

Dans l'app, aller sur le graphique "Coût par provider". Vérifier que openrama affiche 0$ (ou n'apparaît pas si coût = 0).

- [ ] **Step 3 : Vérifier les chemins dans Réglages**

Ouvrir la modale Réglages. Les inputs doivent afficher en placeholder grisé les chemins XDG réels (ex. `C:\Users\fcpb6403\.local\share\opencode\opencode.db`).

- [ ] **Step 4 : Vérifier la modale Tarifs**

Cliquer sur "$ Tarifs". Le tableau doit lister les modèles configurés dans `opencode.jsonc` avec leurs prix.
