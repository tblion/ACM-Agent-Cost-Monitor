# Design — Opencode Cost Viewer

**Date** : 2026-09-22
**Statut** : validé par l'utilisateur
**Stack** : Tauri 2 (Rust) + React/TypeScript/Vite

## 1. Objectif

Logiciel desktop **cross-platform (Windows / Linux / macOS)** qui calcule le coût en tokens et en $ de chaque session et de chaque projet opencode, avec **filtres**, **graphiques** et un **mode live**. Il remplace et généralise le script PowerShell `Get-OpencodeSessionCosts.ps1` (dossier `_old/`).

Contraintes clés exprimées par l'utilisateur :
- Outil **perso local** (lit la base opencode de la machine).
- **Analyse historique + mode live** (mise à jour pendant les sessions).
- **Vraiment de la gueule** + **sensation native** selon l'OS.
- **Config auto-détectée** au démarrage, **modifiable ensuite** (chemins, etc.).
- Coût = 0 n'est **pas** une erreur (modèles locaux/gratuits) → à **signaler**, pas à masquer.

## 2. Contexte & données vérifiées

### 2.1 Base SQLite opencode
Chemin : `~/.local/share/opencode/opencode.db` (identique sur les 3 OS).
Volume constaté : **978 sessions**, **35 156 messages**, **27 répertoires distincts**.

Tables utilisées :
- `session` : `id`, `project_id`, `parent_id`, `directory`, `title`, `agent`, `model` (JSON), `cost`, `tokens_input/output/reasoning/cache_read/cache_write`, `time_created`, `time_updated`.
  - `parent_id` non nul ⇒ session **sous-agent** (ex : `@general`, `@explore`).
  - La colonne `cost` vaut **0.0** pour les providers sans tarif (ex : `openrama`) → le coût réel vient du **recalcul par message**.
- `message` : `id`, `session_id`, `time_created`, `data` (JSON).
- `project` : `id`, `worktree`, `name` (optionnelle). **Non fiable** comme identifiant de projet (`worktree` souvent `/`) → on utilise `session.directory`.

Structure de `message.data` (rôle assistant) :
```json
{
  "role": "assistant",
  "modelID": "openai/gpt-4.1",
  "providerID": "llmproxy",
  "cost": 0,
  "tokens": { "total": 9533, "input": 9522, "output": 11, "reasoning": 0, "cache": { "read": 0, "write": 0 } }
}
```

### 2.2 Config opencode.jsonc
Chemin principal : `~/.config/opencode/opencode.jsonc` (+ fallbacks, ex : `~/.config/opencode-profiles/<profil>/opencode.jsonc`).
C'est du **JSONC** (commentaires `//` et `/* */`) → il faut les supprimer en respectant les chaînes (port de `Remove-JsonComments` du script).

Tarifs sous `provider.<providerID>.models.<modelID>.cost` :
```jsonc
"provider": {
  "llmproxy": { "models": { "openai/gpt-4.1": { "cost": { "input": 2.0, "output": 8.0 } } } },
  "openrama": { "models": { "qwen3.8-27b": { /* pas de cost */ } } }
}
```
- `cost` peut contenir `input`, `output`, `cache_read`, `cache_write` (absents ⇒ 0).
- Les modèles `openrama` et le provider `github-copilot` **n'ont pas de tarif** → coût 0 (attendu, à signaler).

### 2.3 Providers/modèles réellement utilisés (échantillon)
`llmproxy` (claude-sonnet-4-6, claude-opus-4-6, gpt-4.1-mini, o3…), `openrama` (qwen3.5/3.6/3.8, minimax, devstral…), `github-copilot` (gpt-5.6-luna, claude-sonnet-5, mai-code…). Seuls les modèles `llmproxy` avec `cost` explicite produisent un coût non nul.

## 3. Logique de calcul du coût (identique au script)

Pour chaque message assistant :
1. `rate = config.provider[providerID].models[modelID].cost`
2. Si `rate` existe :
   ```
   cost = input*rate.input/1e6
        + output*rate.output/1e6
        + cache.read*rate.cache_read/1e6
        + cache.write*rate.cache_write/1e6
        + reasoning*rate.output/1e6      // reasoning facturé au tarif output
   ```
   et `usedCustomRate = true`.
3. Sinon : `cost = message.cost` (coût stocké, souvent 0) et `usedCustomRate = false`.

Agrégation par session : somme des coûts + des tokens, détail par modèle, flag `usedCustomRate` (true si au moins un message a utilisé un tarif custom).

## 4. Architecture

### 4.1 Backend (Rust, Tauri 2)
- `db.rs` — résout le chemin de la base, l'ouvre **en lecture seule** (rusqlite, `SQLITE_OPEN_READONLY` + `busy_timeout`) pour coexister avec opencode en écriture (WAL). Requête : sessions ⋈ messages assistant, extraction des champs.
- `config.rs` — résout `opencode.jsonc` (chemin principal + fallbacks), supprime les commentaires JSONC, extrait les tarifs → `HashMap<(providerID, modelID), Cost>`.
- `cost.rs` — calcul du coût par message (section 3).
- `aggregate.rs` — construit les enregistrements **par session** avec détail par modèle.
- `watcher.rs` — watcher sur le fichier DB (crate `notify`) pour le **mode live** : au changement (debounce ~1 s), re-agrégation + émission d'événement `db-changed`.
- `settings.rs` — charge/sauvegarde `settings.json` (dossier de config de l'app, Tauri `app-config-dir`) : chemins surchargés, thème, période par défaut, mode live, groupes de projet custom.
- Commandes Tauri : `get_data` (jeu de données agrégé), `get_settings`, `save_settings`, `pick_path` (sélecteur de fichier natif).

### 4.2 Frontend (React + TypeScript + Vite)
- Charge le jeu de données agrégé une fois ; **filtrage + agrégations côté client** (978 sessions = trivial, réactif).
- Lib de graphiques : **Recharts** (ECharts en alternative si plus de punch visuel souhaité).
- **Thème OS-aware** : détection de la plateforme (plugin OS Tauri / `navigator`) → application du style visuel correspondant (type Fluent sur Windows, style macOS sur Mac, style GTK sur Linux) + dark/light selon l'OS. Fenêtre, menus et boîtes de dialogue **natifs** (fournis par Tauri/OS).

### 4.3 Objet « session » transmis au frontend
```ts
{
  id: string;
  project: string;            // session.directory
  title: string;
  date: number;               // time_created (ms)
  cost: number;               // coût recalculé (total)
  tokens: { input, output, cacheRead, cacheWrite, reasoning };
  isSubagent: boolean;        // parent_id != null
  parentId: string | null;
  usedCustomRate: boolean;    // au moins un message avec tarif custom
  models: [ { provider, model, cost, tokens } ]  // détail par modèle
}
```

## 5. Flux de données
1. Démarrage → backend résout DB + config (auto ou surcharge settings), ouvre DB en lecture seule, charge les tarifs.
2. Backend interroge messages assistant + sessions, calcule le coût par session (détail par modèle), renvoie au frontend.
3. Frontend applique les filtres par défaut, rend KPIs + graphiques + table.
4. Changement de filtre → re-filtrage + re-agrégation **côté client** (instantané).
5. **Live** : watcher DB → au changement (debounce), re-agrégation backend → événement `db-changed` → le frontend rafraîchit ; le bouton **LIVE** pulse.

## 6. Interface (layout validé via maquette)

- **Header** : titre + logo, **bouton toggle « LIVE »** (gris statique si éteint ; **pulse/clignotement** si allumé et en réception d'updates), accès **Réglages** (⚙).
- **Barre de filtres** : Projet, Modèle, Provider, Période (du/au) + Réinitialiser.
- **Cartes KPI** : Coût total, Tokens, Sessions (dont sous-agents), Projets (dont groupes).
- **Grille de graphiques** :
  - Coût dans le temps (courbe/aire, jour/semaine) — large
  - Coût par provider (donut)
  - Coût par projet (barres)
  - Coût par modèle (barres)
  - Décomposition des tokens (input/output/cache read/cache write/reasoning)
  - Top sessions coûteuses (liste/barres)
  - Coût par **groupe de projet** (auto par dossier parent + groupes custom)
- **Table de sessions** : titre (+ badge « tarif ✓ » / « coût 0 »), projet, modèle, tokens, coût ; triable.

### Groupes de projet
- **Auto** : le groupe d'une session est le **dossier parent immédiat** de son `directory`. Ex : `C:/git/Convivio/Convivio.MaestroV2.Onega.Backend` → groupe `C:/git/Convivio` ; `C:/git/Convivio` → groupe `C:/git`. (Les sessions dont le parent est la racine git se regroupent donc sous cette racine ; le raffinement se fait via les groupes custom.)
- **Custom** : groupes nommés créés/édités dans Réglages, avec assignment manuelle de projets (un projet peut appartenir à un groupe custom, qui prend le pas sur le groupe auto pour l'affichage « par groupe »).

## 7. Configurabilité / Réglages
- **Détection auto** au démarrage des chemins DB et config (par plateforme).
- **Écran Réglages** : chemin base (auto + surcharge), chemin config (auto + surcharge), mode live (on/off), thème (système/clair/sombre), période par défaut, gestion des groupes de projet custom.
- **Persistance** : `settings.json` dans le dossier de config de l'app.

## 8. Gestion des erreurs
- Base introuvable → message clair + sélecteur de chemin natif.
- Config introuvable → avertissement, usage du coût stocké (0), sélecteur de chemin.
- Base verrouillée (opencode en écriture) → lecture seule + `busy_timeout` (coexistence OK).
- Schéma inattendu (version d'opencode) → erreur explicite.
- `message.data` illisible → message ignoré + compteur d'erreurs affiché.
- Coût 0 (pas de tarif) → **signalé** via badge, jamais traité comme erreur.

## 9. Tests
- **Rust** : unit tests du calcul de coût (tokens + tarifs → coût attendu), du parsing JSONC (suppression commentaires, extraction tarifs), de l'agrégation.
- **Intégration** : contre une base SQLite fixture (échantillon représentatif).
- **Frontend** : unit tests du filtrage/agrégation (fonctions pures).
- **Test d'acceptation clé** : les coûts par session de l'app doivent **correspondre au CSV produit par le script** sur la même base → validation directe de la logique de calcul.

## 10. Hors périmètre (YAGNI)
- Pas de multi-utilisateurs / serveur central.
- Pas d'édition des tarifs dans l'app (lecture seule de `opencode.jsonc`).
- Pas de récupération de tarifs dynamiques via API provider.
- Pas d'export CSV dans la V1 (à réévaluer si demandé).
