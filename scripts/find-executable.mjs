// Finds the first executable file from a list of package paths.
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

export async function findExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("Installed application executable was not found in the package file list.");
}
