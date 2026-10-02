import type { DesktopApi } from "../electron/renderer-api";

declare global {
  interface Window {
    desktopApi: DesktopApi;
    __E2E__: {
      changeData: (options: { variant: string }) => void;
      emitDbChanged: () => void;
      markRecalculated: () => void;
      fixtureId: string;
      fixtureSha256: string;
      fixtureSqlPath: string;
      fixtureManifestPath: string;
      fixtureSnapshotPath: string;
      fixtureAlternateSnapshotPath: string;
      fixtureSnapshotSessionCount: number;
      fixtureSnapshotBoundaryDate: number;
      fixtureSnapshotBoundaryCost: number;
      dbPath: string;
      reloadCount: number;
      changeDbPath: (path: string) => void;
      mutateSql: () => Promise<void>;
    };
  }
}

export {};
