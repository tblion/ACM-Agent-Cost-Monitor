# Réduction du bundle initial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire le bundle JavaScript initial en chargeant les graphiques et les modales à la demande, avec un état accessible « Chargement » animé pendant les suspensions.

**Architecture:** `App` remplacera les imports statiques des graphiques et modales par `React.lazy`. Un composant de fallback partagé affichera le dashboard déjà rendu sous un voile flouté pour les graphiques, et un état compact pour les modales. Les composants différés conserveront leurs interfaces et leur logique existantes.

**Tech Stack:** React 19, TypeScript strict, Vite 8/Rolldown, Vitest, CSS existant, i18next/react-i18next.

---

### Task 1: Créer le fallback de chargement accessible

**Files:**
- Create: `src/components/DeferredLoading.tsx`
- Test: `src/components/DeferredLoading.test.tsx`
- Modify: `src/index.css`
- Modify: `src/i18n/resources.ts`

- [ ] **Step 1: Écrire les tests du composant de chargement**

Tester deux variantes contrôlées par une prop `variant: "dashboard" | "modal"` :

```tsx
render(<DeferredLoading variant="dashboard" />);
expect(screen.getByRole("status")).toHaveTextContent("Chargement");
expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
expect(screen.getByRole("status")).toHaveClass("deferred-loading", "deferred-loading-dashboard");

render(<DeferredLoading variant="modal" />);
expect(screen.getByRole("status")).toHaveClass("deferred-loading-modal");
expect(screen.getByText("Chargement")).toBeVisible();
```

Le test doit aussi vérifier que le texte anglais devient `Loading` après `i18n.changeLanguage("en")` et que l'élément animé porte `aria-hidden="true"`.

- [ ] **Step 2: Exécuter les tests pour confirmer l'échec initial**

Run: `npm test -- src/components/DeferredLoading.test.tsx`

Expected: échec car `DeferredLoading` et ses classes n'existent pas encore.

- [ ] **Step 3: Implémenter le composant et les styles**

Créer un composant sans état :

```tsx
type DeferredLoadingProps = {
  variant: "dashboard" | "modal";
};

export function DeferredLoading({ variant }: DeferredLoadingProps) {
  const { t } = useTranslation();
  return (
    <div className={`deferred-loading deferred-loading-${variant}`} role="status" aria-live="polite">
      <span className="deferred-loading-label">{t("app.deferredLoading")}</span>
      <span className="deferred-loading-indicator" aria-hidden="true" />
    </div>
  );
}
```

Ajouter les traductions `app.deferredLoading: "Chargement"` et `app.deferredLoading: "Loading"`.

Ajouter dans `src/index.css` :

```css
.deferred-loading-dashboard {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 300px;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  backdrop-filter: blur(4px);
}
.deferred-loading-modal {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 140px;
  padding: 24px;
}
.deferred-loading-indicator {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: deferred-loading-spin .8s linear infinite;
}
@keyframes deferred-loading-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .deferred-loading-indicator { animation: none; }
}
```

Le conteneur de la grille devra être `position: relative` pour que le voile couvre uniquement sa zone.

- [ ] **Step 4: Exécuter les tests du composant**

Run: `npm test -- src/components/DeferredLoading.test.tsx`

Expected: les tests du composant passent.

### Task 2: Charger les graphiques à la demande

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Ajouter les tests de suspension du dashboard**

Dans `App.test.tsx`, conserver les mocks existants mais ajouter un test qui contrôle un import différé avec un composant suspendu, puis vérifie :

```tsx
expect(container.querySelector('[role="status"]')?.textContent).toContain("Chargement");
await act(async () => { await Promise.resolve(); });
expect(container.querySelector('[role="status"]')).toBeNull();
```

Le test doit aussi vérifier que les props `data={filtered}` et `groups={settings.customGroups}` continuent d’être transmises aux composants graphiques après résolution.

- [ ] **Step 2: Exécuter le test ciblé pour confirmer l’échec**

Run: `npm test -- src/App.test.tsx`

Expected: le nouveau scénario échoue tant que `App` utilise les imports synchrones.

- [ ] **Step 3: Remplacer les imports statiques par des imports lazy**

Dans `src/App.tsx`, remplacer les huit imports de graphiques par :

```tsx
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
const CostOverTime = lazy(() => import("./components/charts/CostOverTime").then(module => ({ default: module.CostOverTime })));
const CostByProject = lazy(() => import("./components/charts/CostByProject").then(module => ({ default: module.CostByProject })));
const CostByModel = lazy(() => import("./components/charts/CostByModel").then(module => ({ default: module.CostByModel })));
const CostByProvider = lazy(() => import("./components/charts/CostByProvider").then(module => ({ default: module.CostByProvider })));
const TokenBreakdown = lazy(() => import("./components/charts/TokenBreakdown").then(module => ({ default: module.TokenBreakdown })));
const TopSessions = lazy(() => import("./components/charts/TopSessions").then(module => ({ default: module.TopSessions })));
const CostByGroup = lazy(() => import("./components/charts/CostByGroup").then(module => ({ default: module.CostByGroup })));
const UsageByBilling = lazy(() => import("./components/charts/UsageByBilling").then(module => ({ default: module.UsageByBilling })));
```

Remplacer la grille actuelle par un conteneur `position: relative` enveloppant un `Suspense` :

```tsx
<div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, padding: "0 20px 16px" }}>
  <Suspense fallback={<DeferredLoading variant="dashboard" />}>
    {/* mêmes huit composants et mêmes props qu'avant */}
  </Suspense>
</div>
```

Importer `DeferredLoading` de façon statique, car il doit être disponible immédiatement pour le fallback.

- [ ] **Step 4: Exécuter les tests ciblés**

Run: `npm test -- src/App.test.tsx`

Expected: tous les tests `App` passent, y compris les scénarios de recalcul et l’état de chargement existant.

### Task 3: Charger les modales à la demande

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Ajouter les assertions d’ouverture différée**

Tester séparément les boutons Settings, Rates et About : après activation, le fallback compact doit apparaître puis la modale mockée doit être rendue après résolution de la promesse dynamique. Les callbacks et props spécifiques à Rates doivent rester vérifiés.

- [ ] **Step 2: Remplacer les imports statiques des modales**

Utiliser le même adaptateur named-export/default-export :

```tsx
const SettingsModal = lazy(() => import("./components/SettingsModal").then(module => ({ default: module.SettingsModal })));
const RatesModal = lazy(() => import("./components/RatesModal").then(module => ({ default: module.RatesModal })));
const AboutModal = lazy(() => import("./components/AboutModal").then(module => ({ default: module.AboutModal })));
```

Envelopper chaque rendu conditionnel dans son propre `Suspense` :

```tsx
{showSettings && (
  <Suspense fallback={<div className="modal-overlay"><DeferredLoading variant="modal" /></div>}>
    <SettingsModal {...settingsProps} />
  </Suspense>
)}
```

Appliquer le même comportement à Rates et About, sans déplacer la logique d’état existante dans les modales.

- [ ] **Step 3: Exécuter les tests de modales et d’intégration**

Run: `npm test -- src/App.test.tsx src/components/SettingsModal.test.tsx src/components/RatesModal.test.tsx`

Expected: tous les tests ciblés passent et aucune modale ne perd son comportement de focus ou de fermeture.

### Task 4: Valider le découpage et la non-régression

**Files:**
- Modify: aucun fichier supplémentaire attendu.

- [ ] **Step 1: Exécuter la suite frontend complète**

Run: `npm test`

Expected: tous les tests Vitest passent sans erreur.

- [ ] **Step 2: Construire le frontend et inspecter les chunks**

Run: `npm run build`

Expected: le build TypeScript/Vite réussit ; les graphiques et modales apparaissent dans des chunks séparés ; le warning Vite sur le chunk initial de plus de 500 kB n’apparaît plus.

- [ ] **Step 3: Vérifier le diff**

Run: `git diff --check`

Expected: aucune erreur de whitespace.

- [ ] **Step 4: Vérifier les fichiers modifiés**

Run: `git status --short`

Expected: uniquement les fichiers prévus par ce plan, ainsi que les changements préexistants laissés intacts ; aucun commit n’est créé.
