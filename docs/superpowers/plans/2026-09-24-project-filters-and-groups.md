# Tri des filtres et sélection des groupes de projets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trier correctement les options visibles et remplacer la saisie des projets de groupes par une sélection accessible avec conservation et suppression confirmée des projets absents.

**Architecture:** Ajouter un helper de tri partagé basé sur le nom affiché, puis un `ProjectGroupPicker` dédié aux règles des groupes. Ajouter une boîte de dialogue de confirmation réutilisable, transmettre les projets actifs depuis `App` vers `SettingsModal`, et conserver le format `CustomGroup.projects` existant.

**Tech Stack:** React, TypeScript strict, i18next, Vitest, happy-dom, Vite.

---

## Cartographie des fichiers

- Create: `src/lib/sorting.ts` — nom court des chemins et comparateur alphabétique insensible à la casse.
- Test: `src/lib/sorting.test.ts` — tri des projets, modèles et providers.
- Create: `src/components/ConfirmDialog.tsx` — confirmation modale accessible et traduite.
- Test: `src/components/ConfirmDialog.test.tsx` — confirmation, annulation, Échap et focus.
- Create: `src/components/ProjectGroupPicker.tsx` — cases à cocher, projets absents et demande de suppression.
- Test: `src/components/ProjectGroupPicker.test.tsx` — fusion, états, sélection et confirmation.
- Modify: `src/App.tsx:182-184,350` — trier les options et transmettre les projets à la modale.
- Modify: `src/components/FilterBar.tsx:19-39` — recevoir des options déjà triées sans changer le contrat de sélection.
- Modify: `src/components/SettingsModal.tsx:10-22,163-171` — accepter les projets et remplacer le champ séparé par des virgules.
- Modify: `src/i18n/resources.ts:128-138,353-363` — libellés du picker et de la confirmation en français et anglais.
- Modify: `src/components/SettingsModal.test.tsx` — intégration du picker, sauvegarde et suppression confirmée.

### Task 1: Ajouter le tri partagé

**Files:**
- Create: `src/lib/sorting.ts`
- Test: `src/lib/sorting.test.ts`
- Modify: `src/App.tsx:182-184`

- [ ] **Step 1: Écrire les tests échouants du comparateur et du nom affiché**

```ts
import { describe, expect, it } from "vitest";
import { compareDisplayNames, displayName, sortDisplayValues } from "./sorting";

describe("project display sorting", () => {
  it("uses the last path segment", () => {
    expect(displayName("/work/OpencodeCostsViewer")).toBe("OpencodeCostsViewer");
    expect(displayName("C:\\work\\appli-PTI-dev-2")).toBe("appli-PTI-dev-2");
  });

  it("sorts case-insensitively by displayed name", () => {
    expect(sortDisplayValues([
      "/work/OpencodeCostsViewer",
      "/work/appli-PTI-dev-2",
      "/work/Atelio",
      "/work/has",
      "/work/l_application-pti-PROD",
    ])).toEqual([
      "/work/appli-PTI-dev-2",
      "/work/Atelio",
      "/work/has",
      "/work/l_application-pti-PROD",
      "/work/OpencodeCostsViewer",
    ]);
  });

  it("returns a stable equality result for identical display names", () => {
    expect(compareDisplayNames("/a/demo", "/b/demo")).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer le test ciblé et vérifier l'échec**

Run: `npm test -- src/lib/sorting.test.ts`
Expected: FAIL because `src/lib/sorting.ts` does not exist.

- [ ] **Step 3: Implémenter le helper minimal**

```ts
export function displayName(value: string): string {
  const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return index >= 0 ? value.slice(index + 1) : value;
}

export function compareDisplayNames(left: string, right: string): number {
  return displayName(left).localeCompare(displayName(right), undefined, { sensitivity: "base" });
}

export function sortDisplayValues(values: string[]): string[] {
  return [...values].sort(compareDisplayNames);
}
```

- [ ] **Step 4: Utiliser le tri dans `App`**

Remplacer les trois appels `.sort()` de `projects`, `models` et `providers` par `sortDisplayValues(...)`. Les valeurs complètes restent les clés de sélection.

- [ ] **Step 5: Relancer les tests ciblés**

Run: `npm test -- src/lib/sorting.test.ts src/lib/aggregate.test.ts`
Expected: PASS.

### Task 2: Créer la boîte de dialogue de confirmation

**Files:**
- Create: `src/components/ConfirmDialog.tsx`
- Test: `src/components/ConfirmDialog.test.tsx`
- Modify: `src/i18n/resources.ts:138,363`

- [ ] **Step 1: Écrire les tests de comportement et d'accessibilité**

Tester avec `I18nextProvider` et `createRoot` que le composant expose `role="dialog"`, `aria-modal="true"`, le titre et la description, appelle `onConfirm` ou `onCancel`, ferme avec Échap et rend le focus au bouton déclencheur fourni par le parent.

- [ ] **Step 2: Vérifier l'échec du test ciblé**

Run: `npm test -- src/components/ConfirmDialog.test.tsx`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implémenter le composant contrôlé**

Créer un composant avec les props `title`, `description`, `confirmLabel`, `cancelLabel`, `onConfirm` et `onCancel`. Utiliser une `div` `role="dialog"`, un `aria-labelledby` et un `aria-describedby`. Ajouter un effet clavier pour Échap et un focus initial sur Annuler ou Supprimer, sans utiliser `window.confirm`.

- [ ] **Step 4: Ajouter les traductions**

Ajouter dans `settings` les clés françaises et anglaises : `removeMissingProjectTitle`, `removeMissingProjectDescription`, `cancelRemoval`, `confirmRemoval`, et le libellé d'état `missingProject`.

- [ ] **Step 5: Valider le composant**

Run: `npm test -- src/components/ConfirmDialog.test.tsx src/i18n/resources.test.ts`
Expected: PASS.

### Task 3: Créer le sélecteur de projets d'un groupe

**Files:**
- Create: `src/components/ProjectGroupPicker.tsx`
- Test: `src/components/ProjectGroupPicker.test.tsx`
- Modify: `src/components/SettingsModal.tsx:163-171`

- [ ] **Step 1: Écrire les tests de fusion et de sélection**

Le test doit rendre `ProjectGroupPicker` avec `availableProjects={["/work/Atelio", "/work/appli"]}` et `selectedProjects={["/old/Removed", "/work/Atelio"]}` puis vérifier que la liste contient les trois projets dans l'ordre `appli`, `Atelio`, `Removed`, que `Removed` est barré et identifié comme absent, et que les deux projets actifs sont sélectionnés selon leur valeur complète.

- [ ] **Step 2: Écrire les tests de confirmation**

Vérifier qu'un clic ou la touche Espace sur le projet absent ouvre `ConfirmDialog`, qu'Annuler le laisse sélectionné, et que Supprimer appelle `onChange` sans ce projet. Vérifier également qu'un projet actif est désélectionné immédiatement sans ouvrir de confirmation.

- [ ] **Step 3: Vérifier l'échec des tests ciblés**

Run: `npm test -- src/components/ProjectGroupPicker.test.tsx`
Expected: FAIL because the picker does not exist.

- [ ] **Step 4: Implémenter la liste contrôlée**

Définir les props :

```ts
interface Props {
  availableProjects: string[];
  selectedProjects: string[];
  onChange: (projects: string[]) => void;
  ariaLabel: string;
}
```

Construire l'union dédupliquée de `availableProjects` et `selectedProjects`, trier avec `sortDisplayValues`, déterminer `isMissing = !availableProjects.includes(project)`, afficher `displayName(project)`, et conserver la valeur complète dans `onChange`.

- [ ] **Step 5: Ajouter la confirmation intégrée**

Pour une désélection manuelle d'un projet absent, conserver temporairement sa sélection, ouvrir `ConfirmDialog`, puis retirer uniquement après `onConfirm`. Pour Annuler, fermer le dialogue sans modifier la sélection. Utiliser une description accessible indiquant qu'il n'est plus présent dans les données actuelles.

- [ ] **Step 6: Valider le picker**

Run: `npm test -- src/components/ProjectGroupPicker.test.tsx src/components/ConfirmDialog.test.tsx`
Expected: PASS.

### Task 4: Intégrer le picker aux réglages et à l'application

**Files:**
- Modify: `src/App.tsx:350`
- Modify: `src/components/SettingsModal.tsx:10-22,163-171`
- Create/Modify: `src/components/SettingsModal.test.tsx`
- Modify: `src/components/FilterBar.tsx:19-39`

- [ ] **Step 1: Étendre les props de `SettingsModal`**

Ajouter `projects: string[]` à `Props`, transmettre `projects={projects}` depuis `App`, et garder `groups` local afin que les changements ne soient persistés qu'au bouton Enregistrer.

- [ ] **Step 2: Remplacer l'input CSV**

Supprimer `g.projects.join(", ")` et le parsing `split(",")`. Rendre `ProjectGroupPicker` avec `availableProjects={projects}`, `selectedProjects={g.projects}`, et mettre à jour uniquement `groups[i].projects` dans son `onChange`.

- [ ] **Step 3: Écrire le test d'intégration des réglages**

Vérifier qu'un groupe initial contenant un projet absent affiche ce projet, qu'une désélection confirmée le retire du payload passé à `onSave`, et qu'Annuler conserve le projet dans le payload. Vérifier qu'un projet sélectionné dans deux groupes reste présent dans les deux payloads.

- [ ] **Step 4: Mettre à jour les tests d'`App`**

Adapter le mock de `SettingsModal` pour accepter la nouvelle prop sans changer le scénario de changement de mode. Ajouter une assertion que l'instance reçoit les projets présents si le test expose les props du mock.

- [ ] **Step 5: Vérifier l'intégration frontend**

Run: `npm test -- src/components/SettingsModal.test.tsx src/App.test.tsx src/components/ProjectGroupPicker.test.tsx`
Expected: PASS.

### Task 5: Ajouter les tests de régression et valider le build

**Files:**
- Modify: `src/components/MultiSelect.test.ts`
- Modify: `src/lib/aggregate.test.ts`
- Modify: `src/i18n/resources.test.ts` si nécessaire pour les nouvelles clés.

- [ ] **Step 1: Ajouter la régression du tri visible**

Tester que les options rendues dans `MultiSelect` suivent l'ordre transmis par `App`, avec un cas mélangeant majuscules, minuscules, chemins Unix et chemins Windows.

- [ ] **Step 2: Vérifier que l'agrégation n'a pas changé**

Lancer les tests existants de `filterSessions` et `byGroup`; vérifier que les chemins complets sont toujours comparés dans les groupes et qu'un nom court identique ne fusionne pas deux projets distincts.

- [ ] **Step 3: Exécuter toute la validation frontend**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: typecheck et build Vite terminés avec succès.

- [ ] **Step 4: Vérifier le parcours visuel et clavier**

Run: `npm run dev:mock`

Contrôler le filtre Projet et les Réglages dans le navigateur : ordre alphabétique visible, projet absent barré et annoncé, dialogue avec Annuler/Supprimer, focus récupéré après fermeture, et sélection d'un même projet possible dans plusieurs groupes.

Run également les scénarios Chrome MCP ou Playwright disponibles si le serveur de mock est déjà lancé.
