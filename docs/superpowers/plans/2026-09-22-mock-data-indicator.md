# Mock Data Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher clairement dans le navigateur mock que les données sont fictives.

**Architecture:** Ajouter un indicateur visuel statique au shell React utilisé par le frontend mock. Le composant ne dépend d'aucune commande Tauri et le build Tauri réel ne l'affiche pas.

**Tech Stack:** React, TypeScript, CSS, Vitest/build Vite.

---

### Task 1: Bandeau de démonstration

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [x] **Step 1: Ajouter le bandeau au shell de l'application mock**

Insérer avant le contenu principal un élément `aside` avec `role="status"`, un titre visible `MODE DÉMO · Données fictives` et une précision accessible indiquant que le mode réel utilise `opencode.db`. Le bandeau doit être rendu uniquement lorsque le mock est actif, en utilisant le mécanisme de détection déjà présent dans le bootstrap mock plutôt qu'un texte toujours affiché dans le build Tauri.

- [x] **Step 2: Ajouter le style responsive et accessible**

Créer une classe dédiée avec contraste élevé, largeur complète, espacement compatible avec l'en-tête et retour à la ligne sur mobile. Ne pas utiliser la couleur seule pour transmettre l'information.

- [x] **Step 3: Vérifier le frontend**

Run: `npm test`

Expected: tous les tests Vitest passent.

Run: `npm run build`

Expected: le typecheck TypeScript et le bundle Vite réussissent.

Run: `git diff --check`

Expected: aucune erreur de whitespace.
