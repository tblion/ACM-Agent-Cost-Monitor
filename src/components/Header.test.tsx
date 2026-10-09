// @vitest-environment happy-dom
// Tests header status indicators and action controls.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n/config";
import { Header } from "./Header";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

async function renderHeader(live: boolean, liveConfigured: boolean, onToggleLive = vi.fn(), onDisableLive = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(Header, {
      live,
      liveConfigured,
      liveActive: live,
      liveAvailable: true,
      liveSaving: false,
      metrics: null,
      updatedAt: null,
      onToggleLive,
      onDisableLive,
      onOpenSettings: vi.fn(),
      onOpenRates: vi.fn(),
      onOpenAbout: vi.fn(),
      onOpenAudit: vi.fn(),
      auditButtonRef: { current: null },
      showAudit: false,
    })));
  });
  return container;
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

describe("Header live action", () => {
  it("exposes a translated reactivation action when persisted live is inactive", async () => {
    const container = await renderHeader(false, true);
    const button = container.querySelector("button.live-btn") as HTMLButtonElement;

    expect(button.getAttribute("aria-label")).toBe("Réactiver le mode live");
    expect(button.textContent).toContain("Réactiver le mode live");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the normal live toggle when the watcher is active", async () => {
    const onToggleLive = vi.fn();
    const container = await renderHeader(true, true, onToggleLive);
    const button = container.querySelector("button.live-btn") as HTMLButtonElement;

    expect(button.getAttribute("aria-label")).toBe("Mode live");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    button.click();
    expect(onToggleLive).toHaveBeenCalledOnce();
  });

  it("exposes a distinct accessible disable action when persisted live is inactive", async () => {
    const onDisableLive = vi.fn();
    const container = await renderHeader(false, true, vi.fn(), onDisableLive);
    const button = container.querySelector("button.live-disable") as HTMLButtonElement;

    expect(button.getAttribute("aria-label")).toBe("Désactiver le mode live");
    expect(button.textContent).toContain("Désactiver le mode live");
    button.click();
    expect(onDisableLive).toHaveBeenCalledOnce();
    expect(container.querySelector("button.live-btn")).not.toBe(button);
  });
});
