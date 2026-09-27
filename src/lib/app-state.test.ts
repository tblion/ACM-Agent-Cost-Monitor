import { describe, expect, it } from "vitest";
import { isLiveAvailable } from "./app-state";

describe("application state decisions", () => {
  it("only enables live data updates in real mode", () => {
    expect(isLiveAvailable("real")).toBe(true);
    expect(isLiveAvailable("demo")).toBe(false);
  });

});
