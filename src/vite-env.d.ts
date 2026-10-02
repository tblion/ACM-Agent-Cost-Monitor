/// <reference types="vite/client" />
import type { DesktopApi } from "../electron/renderer-api";

declare global {
  interface ImportMetaEnv {
    readonly VITE_OPENCODE_MOCK?: string;
    readonly VITE_E2E?: string;
    readonly VITE_E2E_FIXTURE_ID?: string;
    readonly VITE_E2E_FIXTURE_SHA256?: string;
    readonly VITE_E2E_FIXTURE_SQL_PATH?: string;
    readonly VITE_E2E_FIXTURE_MANIFEST_PATH?: string;
    readonly VITE_E2E_FIXTURE_SNAPSHOT_PATH?: string;
    readonly VITE_E2E_FIXTURE_ALTERNATE_SNAPSHOT_PATH?: string;
    readonly VITE_E2E_FIXTURE_SNAPSHOT?: string;
  }

  interface Window {
    desktopApi?: DesktopApi;
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
