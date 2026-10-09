// @vitest-environment happy-dom
// Tests the about dialog content and accessible interactions.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/config";
import { AboutModal } from "./AboutModal";

const reactActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

async function renderModal(onClose = vi.fn()): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(AboutModal, { onClose })));
  });
  return { container, root };
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("fr");
});

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  const globalWithActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  if (reactActEnvironment === undefined) delete globalWithActEnvironment.IS_REACT_ACT_ENVIRONMENT;
  else globalWithActEnvironment.IS_REACT_ACT_ENVIRONMENT = reactActEnvironment;
});

describe("AboutModal", () => {
  it("renders the license information and project links", async () => {
    const { container } = await renderModal();
    const dialog = container.querySelector('[role="dialog"]');

    expect(dialog).not.toBeNull();
    expect(Array.from(container.querySelectorAll("a")).map(link => link.getAttribute("href"))).toEqual([
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

  it("opens both project links through the desktop bridge", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: { openExternalUrl },
    });
    const { container } = await renderModal();
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));

    await act(async () => {
      links.forEach(link => link.click());
    });

    expect(openExternalUrl).toHaveBeenCalledTimes(2);
    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/tblion/OpencodeCostsViewer");
    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/tblion/OpencodeCostsViewer/blob/main/LICENSE");
  });

  it("keeps the license text scrollable and closes from the button", async () => {
    const onClose = vi.fn();
    const { container } = await renderModal(onClose);
    const licenseText = container.querySelector<HTMLElement>(".about-license-text");

    expect(licenseText).not.toBeNull();
    expect(licenseText?.tabIndex).toBe(0);
    expect(licenseText?.classList.contains("about-license-text")).toBe(true);
    expect(container.querySelector(".about-author")).toBeNull();

    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Fermer À propos"]');
    await act(async () => { (close as HTMLButtonElement).click(); });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restores focus and removes Escape handling when unmounted", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { root } = await renderModal(onClose);

    await act(async () => { root.unmount(); });
    mounted.splice(mounted.indexOf(root), 1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.activeElement).toBe(trigger);
    expect(onClose).not.toHaveBeenCalled();
  });
});
