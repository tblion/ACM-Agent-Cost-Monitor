// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/config";
import { ConfirmDialog } from "./ConfirmDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

async function renderDialog(returnFocusRef?: { current: HTMLElement | null }): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(createElement(
      I18nextProvider,
      { i18n },
      createElement(ConfirmDialog, {
        title: "Remove missing project?",
        description: "This project has no remaining sessions.",
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        returnFocusRef,
      }),
    ));
  });
  return { container, root };
}

beforeEach(async () => { await i18n.changeLanguage("en"); });

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  await i18n.changeLanguage("en");
});

describe("ConfirmDialog", () => {
  it("exposes dialog semantics and labels its title and description", async () => {
    const { container } = await renderDialog();
    const dialog = container.querySelector('[role="dialog"]');

    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog?.getAttribute("aria-describedby")).toBeTruthy();
    expect((dialog as HTMLElement).style.maxWidth).toBe("92vw");
    expect((dialog as HTMLElement).style.maxHeight).toBe("85vh");
    expect((dialog as HTMLElement).style.overflowY).toBe("auto");
    expect(document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Remove missing project?");
    expect(document.getElementById(dialog?.getAttribute("aria-describedby") ?? "")?.textContent).toBe("This project has no remaining sessions.");
  });

  it("calls the corresponding callback for confirm and cancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push(root);

    await act(async () => {
      root.render(createElement(I18nextProvider, { i18n }, createElement(ConfirmDialog, {
        title: "Remove missing project?",
        description: "This project has no remaining sessions.",
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
        onConfirm,
        onCancel,
      })));
    });

    const buttons = container.querySelectorAll("button");
    await act(async () => { (buttons[0] as HTMLButtonElement).click(); (buttons[1] as HTMLButtonElement).click(); });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancels on Escape without closing when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const parentEscape = vi.fn();
    document.addEventListener("keydown", parentEscape);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push(root);

    await act(async () => {
      root.render(createElement(I18nextProvider, { i18n }, createElement(ConfirmDialog, {
        title: "Remove missing project?",
        description: "This project has no remaining sessions.",
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
        onConfirm: vi.fn(),
        onCancel,
      })));
    });

    const cancel = container.querySelector("button") as HTMLButtonElement;
    await act(async () => { cancel.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })); });
    await act(async () => { (container.firstElementChild as HTMLElement).click(); });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(parentEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", parentEscape);
  });

  it("wraps focus from the last button to the first with Tab", async () => {
    const { container } = await renderDialog();
    const buttons = Array.from(container.querySelectorAll("button"));
    buttons[1].focus();

    await act(async () => { buttons[1].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })); });

    expect(document.activeElement).toBe(buttons[0]);
  });

  it("wraps focus from the first button to the last with Shift+Tab", async () => {
    const { container } = await renderDialog();
    const buttons = Array.from(container.querySelectorAll("button"));
    buttons[0].focus();

    await act(async () => { buttons[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true })); });

    expect(document.activeElement).toBe(buttons[1]);
  });

  it("focuses the cancel button initially and restores focus to the trigger", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const returnFocusRef = { current: trigger };
    const { container, root } = await renderDialog(returnFocusRef);
    const cancel = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Cancel");

    expect(document.activeElement).toBe(cancel);
    await act(async () => { (cancel as HTMLButtonElement).click(); root.unmount(); });
    expect(document.activeElement).toBe(trigger);
  });

  it("does not restore focus to a removed or disabled trigger", async () => {
    const removedTrigger = document.createElement("button");
    document.body.appendChild(removedTrigger);
    const removedFocus = vi.spyOn(removedTrigger, "focus");
    const removed = await renderDialog({ current: removedTrigger });
    removedFocus.mockClear();
    removedTrigger.remove();
    await act(async () => { removed.root.unmount(); });
    expect(removedFocus).not.toHaveBeenCalled();

    const disabledTrigger = document.createElement("button");
    document.body.appendChild(disabledTrigger);
    const disabledFocus = vi.spyOn(disabledTrigger, "focus");
    const disabled = await renderDialog({ current: disabledTrigger });
    disabledFocus.mockClear();
    disabledTrigger.disabled = true;
    await act(async () => { disabled.root.unmount(); });
    expect(disabledFocus).not.toHaveBeenCalled();
  });

  it("removes keyboard handling on unmount", async () => {
    const onCancel = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push(root);

    await act(async () => {
      root.render(createElement(I18nextProvider, { i18n }, createElement(ConfirmDialog, {
        title: "Remove missing project?",
        description: "This project has no remaining sessions.",
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
        onConfirm: vi.fn(),
        onCancel,
      })));
    });
    await act(async () => { root.unmount(); });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps Escape scoped to the innermost nested dialog", async () => {
    const outerCancel = vi.fn();
    const innerCancel = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const outerRoot = createRoot(container);
    mounted.push(outerRoot);

    await act(async () => {
      outerRoot.render(createElement(I18nextProvider, { i18n }, createElement(ConfirmDialog, {
        title: "Outer dialog",
        description: "Outer description",
        confirmLabel: "Outer confirm",
        cancelLabel: "Outer cancel",
        onConfirm: vi.fn(),
        onCancel: outerCancel,
      })));
    });
    const innerContainer = document.createElement("div");
    (container.querySelector('[role="dialog"]') as HTMLElement).appendChild(innerContainer);
    const innerRoot = createRoot(innerContainer);
    await act(async () => {
      innerRoot.render(createElement(I18nextProvider, { i18n }, createElement(ConfirmDialog, {
        title: "Inner dialog",
        description: "Inner description",
        confirmLabel: "Inner confirm",
        cancelLabel: "Inner cancel",
        onConfirm: vi.fn(),
        onCancel: innerCancel,
      })));
    });

    const innerCancelButton = Array.from(innerContainer.querySelectorAll("button")).find(button => button.textContent === "Inner cancel") as HTMLButtonElement;
    await act(async () => { innerCancelButton.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })); });

    expect(innerCancel).toHaveBeenCalledOnce();
    expect(outerCancel).not.toHaveBeenCalled();
    await act(async () => { innerRoot.unmount(); });
  });
});
