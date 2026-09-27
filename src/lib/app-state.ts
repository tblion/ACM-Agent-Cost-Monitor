import type { DataMode } from "../data-source";

export const isLiveAvailable = (dataMode: DataMode) => dataMode === "real";
