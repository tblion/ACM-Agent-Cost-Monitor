// Tests pricing keys and rate comparison behavior.
import { describe, expect, it } from "vitest";
import { getFocusTrapTarget, rateKey, isConfiguredRate } from "./rates";

describe("rates provenance", () => {
  it("identifies a historical model that also has a configured rate", () => {
    const configured = new Set([rateKey("llmproxy", "vertex_ai/claude-sonnet-4-6")]);

    expect(isConfiguredRate(configured, "llmproxy", "vertex_ai/claude-sonnet-4-6")).toBe(true);
    expect(isConfiguredRate(configured, "openrama", "qwen3.8-27b")).toBe(false);
  });

  it("returns focus inside the dialog when tab starts outside it", () => {
    const first = {} as HTMLElement;
    const last = {} as HTMLElement;
    const focusables = [first, last];

    expect(getFocusTrapTarget(focusables, null, false)).toBe(first);
    expect(getFocusTrapTarget(focusables, null, true)).toBe(last);
  });

  it("wraps focus at both ends of the dialog", () => {
    const first = {} as HTMLElement;
    const middle = {} as HTMLElement;
    const last = {} as HTMLElement;
    const focusables = [first, middle, last];

    expect(getFocusTrapTarget(focusables, first, true)).toBe(last);
    expect(getFocusTrapTarget(focusables, last, false)).toBe(first);
    expect(getFocusTrapTarget(focusables, middle, false)).toBeNull();
  });
});
