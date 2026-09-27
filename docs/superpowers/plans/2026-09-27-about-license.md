# Fenêtre À propos et licence MIT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refaire la fenêtre « À propos » pour supprimer l'auteur et l'email, afficher deux liens GitHub fonctionnels et présenter la licence MIT complète dans un conteneur compact et scrollable.

**Architecture:** Conserver `AboutModal` comme dialogue accessible et déplacer son contenu légal vers une importation Vite `?raw` du fichier racine `LICENSE`, afin d'éviter une copie divergente. Utiliser `openUrl` du plugin Tauri Opener pour les URLs externes, avec un appel mockable dans les tests. Ajouter les libellés dans les ressources i18n et limiter la modale ainsi que la zone de licence par CSS responsive.

**Tech Stack:** React 19, TypeScript strict, react-i18next, Vite, `@tauri-apps/plugin-opener`, Vitest avec happy-dom.

---

## Fichiers concernés

- Modifier `src/components/AboutModal.tsx` : contenu, URLs et ouverture externe.
- Créer `src/components/AboutModal.test.tsx` : tests de rendu, liens, licence et accessibilité du dialogue.
- Modifier `src/index.css` : dimensions responsive et zone de texte scrollable.
- Modifier `src/i18n/resources.ts` : libellés français et anglais de la modale.
- Modifier `src/vite-env.d.ts` uniquement si TypeScript ne reconnaît pas l'import `?raw` du fichier `LICENSE`.

### Task 1: Écrire les tests de la nouvelle modale

**Files:**
- Create: `src/components/AboutModal.test.tsx`
- Test: `src/components/AboutModal.test.tsx`

- [ ] **Step 1: Créer le test happy-dom avec le même montage i18n que les autres modales**

Utiliser `createRoot`, `act`, `I18nextProvider` et le `i18n` partagé. Définir `IS_REACT_ACT_ENVIRONMENT`, conserver les roots montés et restaurer la langue/document dans `afterEach`.

```tsx
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/config";
import { AboutModal } from "./AboutModal";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

async function renderModal(onClose = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(AboutModal, { onClose })));
  });
  return container;
}

beforeEach(async () => { await i18n.changeLanguage("fr"); });

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});
```

- [ ] **Step 2: Ajouter le test de contenu et de URLs**

Rendre la modale en français, vérifier le rôle `dialog`, les deux ancres avec leurs URLs exactes, l'absence de `mailto:`, de `Thomas Blion` et de `thomasblion.com`, ainsi que la présence du texte `MIT License`, `Copyright (c) 2026 Thomas Blion` et `Permission is hereby granted`.

```tsx
it("affiche les liens du projet et la licence sans email ni auteur", async () => {
  const container = await renderModal();
  const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));

  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(links.map(link => link.href)).toEqual([
    "https://github.com/tblion/OpencodeCostsViewer",
    "https://github.com/tblion/OpencodeCostsViewer/blob/main/LICENSE",
  ]);
  expect(container.textContent).toContain("MIT License");
  expect(container.textContent).toContain("Copyright (c) 2026 Thomas Blion");
  expect(container.textContent).toContain("Permission is hereby granted");
  expect(container.textContent).not.toContain("Développé par Thomas Blion");
  expect(container.textContent).not.toContain("thomasblion.com");
  expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
});
```

- [ ] **Step 3: Ajouter le test des ouvertures externes**

Récupérer `openUrl` du mock, cliquer les deux liens dans `act` et vérifier que chaque URL exacte est envoyée au plugin. Le composant peut conserver `target="_blank"` comme fallback navigateur, mais le clic doit appeler `openUrl`.

```tsx
it("ouvre le dépôt et la licence dans le navigateur externe", async () => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  const container = await renderModal();
  const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));

  await act(async () => { links[0].click(); links[1].click(); });

  expect(openUrl).toHaveBeenNthCalledWith(1, "https://github.com/tblion/OpencodeCostsViewer");
  expect(openUrl).toHaveBeenNthCalledWith(2, "https://github.com/tblion/OpencodeCostsViewer/blob/main/LICENSE");
});
```

- [ ] **Step 4: Ajouter le test de fermeture et de scroll**

Vérifier que la zone de licence possède une classe dédiée, un `tabIndex={0}` pour être atteignable au clavier et une hauteur contrôlée par le style. Vérifier que le bouton de fermeture appelle `onClose` et que le nom de l'auteur n'apparaît pas dans le bloc d'identité :

```tsx
it("garde une licence navigable et ferme la modale", async () => {
  const onClose = vi.fn();
  const container = await renderModal(onClose);
  const license = container.querySelector(".about-license-text") as HTMLElement;
  const close = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Fermer") as HTMLButtonElement;

  expect(license.tabIndex).toBe(0);
  expect(license.className).toContain("about-license-text");
  expect(container.querySelector(".about-author")).toBeNull();
  await act(async () => { close.click(); });
  expect(onClose).toHaveBeenCalledOnce();
});
```

- [ ] **Step 5: Exécuter les tests pour confirmer l'échec attendu**

Run: `npm test -- src/components/AboutModal.test.tsx`

Expected: FAIL because the current component does not yet render the new links, license block, or `openUrl` behavior.

### Task 2: Implémenter le contenu et l'ouverture externe

**Files:**
- Modify: `src/components/AboutModal.tsx`

- [ ] **Step 1: Importer le texte racine et le plugin Opener**

Ajouter :

```tsx
import { openUrl } from "@tauri-apps/plugin-opener";
import licenseText from "../../LICENSE?raw";
```

Créer dans le composant un gestionnaire `handleExternalLink(url: string)` qui appelle `void openUrl(url)`. Ne pas ajouter de copie manuelle du contenu de `LICENSE`.

- [ ] **Step 2: Remplacer le contenu auteur/email par les quatre blocs de la spécification**

Conserver le wrapper `modal-overlay`, le `role="dialog"`, les attributs ARIA, le bouton de fermeture et les hooks de focus. Remplacer le contenu entre le titre et les actions par :

```tsx
<p>{t("about.description")}</p>
<div className="about-links">
  <a href="https://github.com/tblion/OpencodeCostsViewer" target="_blank" rel="noopener noreferrer" onClick={event => { event.preventDefault(); handleExternalLink("https://github.com/tblion/OpencodeCostsViewer"); }}>
    {t("about.repositoryLink")}
  </a>
  <a href="https://github.com/tblion/OpencodeCostsViewer/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" onClick={event => { event.preventDefault(); handleExternalLink("https://github.com/tblion/OpencodeCostsViewer/blob/main/LICENSE"); }}>
    {t("about.licenseLink")}
  </a>
</div>
<section className="about-license" aria-labelledby="about-license-title">
  <h3 id="about-license-title">{t("about.licenseTitle")}</h3>
  <pre tabIndex={0} className="about-license-text">{licenseText}</pre>
</section>
```

Le `preventDefault` évite que le webview navigue dans l'application ; `target` et `rel` restent le fallback du mode navigateur. Ajouter un `aria-label` seulement si les textes traduits ne décrivent pas suffisamment les liens.

- [ ] **Step 3: Ajouter les libellés i18n français et anglais**

Dans les deux blocs `about`, conserver `title`, `close` et `closeButton`, remplacer la description par une phrase sans auteur et ajouter :

```ts
repositoryLink: "GitHub du projet",
licenseLink: "Licence MIT · LICENSE",
licenseTitle: "Licence MIT",
```

Valeurs anglaises correspondantes : `"Project GitHub"`, `"MIT License · LICENSE"` et `"MIT License"`. Vérifier que les tests de ressources i18n continuent de valider les deux langues.

- [ ] **Step 4: Relancer le test ciblé**

Run: `npm test -- src/components/AboutModal.test.tsx`

Expected: PASS.

### Task 3: Rendre la modale compacte et la licence scrollable

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Remplacer les règles de dimensionnement de la modale**

Conserver les styles existants et ajuster les règles comme suit :

```css
.about-modal { width: min(420px, 100%); max-height: calc(100dvh - 40px); overflow: hidden; }
.about-links { display: grid; gap: 8px; }
.about-license { min-width: 0; margin-top: 16px; }
.about-license h3 { margin: 0 0 8px; font-size: 13px; }
.about-license-text { max-height: min(220px, 32dvh); margin: 0; padding: 12px; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); background: var(--panel); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.about-license-text:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
```

Ces règles limitent la hauteur globale sur petit écran, rendent le texte légal navigable au clavier et évitent les débordements horizontaux.

- [ ] **Step 2: Vérifier visuellement le mode desktop et mobile**

Run: `npm run dev:mock`

Open the About dialog in the mock application at desktop width and a mobile viewport. Expected: the dialog remains contained, the license area scrolls independently, and all links/buttons keep visible focus styles.

- [ ] **Step 3: Exécuter les tests frontend ciblés et le build**

Run: `npm test -- src/components/AboutModal.test.tsx src/i18n/resources.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: TypeScript and Vite build complete successfully.

### Task 4: Revue finale et commit fonctionnel

**Files:**
- Modify: `src/components/AboutModal.tsx`
- Create: `src/components/AboutModal.test.tsx`
- Modify: `src/index.css`
- Modify: `src/i18n/resources.ts`

- [ ] **Step 1: Vérifier le diff et les chaînes interdites**

Run: `git diff --check`

Run: `git diff -- src/components/AboutModal.tsx src/components/AboutModal.test.tsx src/index.css src/i18n/resources.ts`

Confirm that no email, `mailto:`, author display, or old personal website link remains in the About modal.

- [ ] **Step 2: Exécuter toute la suite frontend**

Run: `npm test`

Expected: all frontend tests pass. C# tests are not applicable; no Rust test is required for this frontend-only change.

- [ ] **Step 3: Committer uniquement les fichiers fonctionnels**

```bash
git add src/components/AboutModal.tsx src/components/AboutModal.test.tsx src/index.css src/i18n/resources.ts
git commit -m "feat: improve about modal licensing links"
```
