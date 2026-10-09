// @vitest-environment happy-dom
// Checks loading placeholder variants and accessible status text.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n/config";
import { DeferredLoading } from "./DeferredLoading";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

async function renderLoading(variant: "dashboard" | "modal"): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(
      createElement(I18nextProvider, { i18n }, createElement(DeferredLoading, { variant })),
    );
  });
  return container.firstElementChild as HTMLElement;
}

beforeEach(async () => {
  await i18n.changeLanguage("fr");
});

afterEach(async () => {
  await act(async () => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  await i18n.changeLanguage("en");
});

describe("DeferredLoading", () => {
  it("renders the dashboard variant with accessible loading status", async () => {
    const loading = await renderLoading("dashboard");

    expect(loading.className).toBe("deferred-loading deferred-loading-dashboard");
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.getAttribute("aria-live")).toBe("polite");
    expect(loading.textContent).toContain("Chargement");
    expect(loading.querySelector(".deferred-loading-indicator")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the modal variant and translates its status", async () => {
    const loading = await renderLoading("modal");

    expect(loading.className).toBe("deferred-loading deferred-loading-modal");
    expect(loading.textContent).toContain("Chargement");

    await act(async () => {
      await i18n.changeLanguage("en");
    });

    expect(loading.textContent).toContain("Loading");
  });
});
