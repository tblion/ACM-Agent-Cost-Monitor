import { readFile } from "node:fs/promises";

export const FIXTURE_ID = "e2e-sql-v1";
export const FIXTURE_SHA256 = "1d13c18eea6954042b94b859a65a41d5ff4d42fb569ddcb419f1fad75bd8f74e";

export interface FixtureManifest {
  fixtureId: string;
  sourcePath: string;
  isolatedSqlPath: string;
  sourceSha256: string;
  manifestPath: string;
  snapshotPath: string;
  boundaryTitle: string;
  outsideTitle: string;
  boundaryDate: string;
  boundaryCost: number;
}

export async function readFixtureManifest(manifestPath: string): Promise<FixtureManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as FixtureManifest;
}
