import { describe, expect, it } from "vitest";
import { compareDisplayNames, displayName, sortDisplayValues } from "./sorting";

describe("displayName", () => {
  it("returns the last segment of Unix and Windows paths", () => {
    expect(displayName("/workspace/appli-PTI-dev-2")).toBe("appli-PTI-dev-2");
    expect(displayName("C:\\workspace\\Atelio")).toBe("Atelio");
    expect(displayName("has")).toBe("has");
  });

  it("ignores trailing Unix, Windows, and mixed separators", () => {
    expect(displayName("/workspace/appli-PTI-dev-2/")).toBe("appli-PTI-dev-2");
    expect(displayName("C:\\workspace\\Atelio\\\\")).toBe("Atelio");
    expect(displayName("/workspace\\has\\/")).toBe("has");
  });

  it("preserves Unix and Windows root paths", () => {
    expect(displayName("/")).toBe("/");
    expect(displayName("C:/")).toBe("C:/");
    expect(displayName("C:\\")).toBe("C:\\");
  });
});

describe("sortDisplayValues", () => {
  it("sorts values by their displayed names without mutating the input", () => {
    const values = [
      "/workspace/OpencodeCostsViewer",
      "C:\\workspace\\l_application-pti-PROD",
      "has",
      "/workspace/appli-PTI-dev-2",
      "Atelio",
    ];

    expect(sortDisplayValues(values)).toEqual([
      "/workspace/appli-PTI-dev-2",
      "Atelio",
      "has",
      "C:\\workspace\\l_application-pti-PROD",
      "/workspace/OpencodeCostsViewer",
    ]);
    expect(values).toEqual([
      "/workspace/OpencodeCostsViewer",
      "C:\\workspace\\l_application-pti-PROD",
      "has",
      "/workspace/appli-PTI-dev-2",
      "Atelio",
    ]);
  });
});

describe("compareDisplayNames", () => {
  it("compares names without distinguishing case", () => {
    expect(compareDisplayNames("Atelio", "atelio")).toBe(0);
  });

  it("returns equality when displayed names are identical", () => {
    expect(compareDisplayNames("/one/project", "C:\\two\\project")).toBe(0);
  });
});
