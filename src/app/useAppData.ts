import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRuntimeMetrics, translateApiError } from "../api";
import { createDataSource, isMockBuild, resolveDataMode, writeDataMode, type AppDataSource, type DataMode } from "../data-source";
import type { RuntimeMetrics, SessionRecord } from "../types";
import type { Filters } from "../lib/aggregate";
import { defaultFilters } from "./defaultFilters";

interface UseAppDataOptions {
  defaultPeriodDaysRef: React.RefObject<number>;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  markAuditStale: () => void;
}

export function useAppData({ defaultPeriodDaysRef, setFilters, markAuditStale }: UseAppDataOptions) {
  const { t } = useTranslation();
  const [data, setData] = useState<SessionRecord[]>([]);
  const [dataMode, setDataMode] = useState<DataMode>(() => resolveDataMode());
  const [dataSource, setDataSource] = useState<AppDataSource>(() => createDataSource(resolveDataMode()));
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(null);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<number | null>(null);
  const dataRef = useRef<SessionRecord[]>([]);
  const dataRequestId = useRef(0);
  const modeRequestId = useRef(0);
  const blockingOperationId = useRef<number | null>(null);
  const recalculationOperationId = useRef<number | null>(null);
  const runtimeMetricsRequestId = useRef(0);
  const mountedRef = useRef(false);
  const modeChangeInProgress = useRef(false);
  const markAuditStaleRef = useRef(markAuditStale);
  markAuditStaleRef.current = markAuditStale;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshRuntimeMetrics = (mode: DataMode) => {
    const requestId = ++runtimeMetricsRequestId.current;
    getRuntimeMetrics(mode === "real").then(metrics => {
      if (mountedRef.current && requestId === runtimeMetricsRequestId.current) setRuntimeMetrics(metrics);
    }).catch(() => {
      if (mountedRef.current && requestId === runtimeMetricsRequestId.current) setRuntimeMetrics(null);
    });
  };

  const publishLoadedData = async (sessionsPromise: Promise<SessionRecord[]>, mode: DataMode, requestId: number, resetFilters: boolean) => {
    const sessions = await sessionsPromise;
    if (!mountedRef.current || requestId !== dataRequestId.current) return false;
    setData(sessions);
    dataRef.current = sessions;
    markAuditStaleRef.current();
    if (resetFilters) setFilters(defaultFilters(sessions, defaultPeriodDaysRef.current));
    setDataUpdatedAt(Date.now());
    refreshRuntimeMetrics(mode);
    return true;
  };

  const reloadData = async (resetFilters: boolean) => {
    if (!mountedRef.current) return false;
    const requestId = ++dataRequestId.current;
    setDataLoading(true);
    setDataError(null);
    try {
      return await publishLoadedData(dataSource.getData(), dataMode, requestId, resetFilters);
    } catch (error) {
      if (mountedRef.current && requestId === dataRequestId.current) setDataError(translateApiError(error, key => t(key as never), t(resetFilters ? "app.dataLoadError" : "app.dataReloadError")));
      return false;
    } finally {
      if (mountedRef.current && requestId === dataRequestId.current) setDataLoading(false);
    }
  };

  useEffect(() => {
    void reloadData(true);
    return () => {
      dataRequestId.current += 1;
      runtimeMetricsRequestId.current += 1;
    };
  }, []);

  const handleRecalculationStart = () => {
    const requestId = ++dataRequestId.current;
    ++runtimeMetricsRequestId.current;
    recalculationOperationId.current = requestId;
    blockingOperationId.current = requestId;
    modeChangeInProgress.current = true;
    setDataLoading(true);
    setDataError(null);
  };

  const handleDataRecalculated = (sessions: SessionRecord[]) => {
    const requestId = recalculationOperationId.current;
    if (requestId === null || requestId !== dataRequestId.current) return;
    setData(sessions);
    dataRef.current = sessions;
    markAuditStaleRef.current();
    setDataUpdatedAt(Date.now());
    setDataError(null);
    refreshRuntimeMetrics(dataMode);
    setDataLoading(false);
    recalculationOperationId.current = null;
    if (blockingOperationId.current === requestId) {
      blockingOperationId.current = null;
      modeChangeInProgress.current = false;
    }
  };

  const handleRecalculationError = () => {
    const requestId = recalculationOperationId.current;
    if (requestId === null || requestId !== dataRequestId.current) return;
    setDataLoading(false);
    setDataError("app.dataRecalculationError");
    recalculationOperationId.current = null;
    if (blockingOperationId.current === requestId) {
      blockingOperationId.current = null;
      modeChangeInProgress.current = false;
    }
  };

  const changeDataMode = async (mode: DataMode) => {
    if (mode === dataMode) return;
    const effectiveMode: DataMode = isMockBuild() && import.meta.env.VITE_E2E !== "true" ? "demo" : mode;
    const nextSource = createDataSource(effectiveMode);
    const requestId = ++dataRequestId.current;
    const currentModeRequestId = ++modeRequestId.current;
    modeChangeInProgress.current = true;
    markAuditStaleRef.current();
    blockingOperationId.current = requestId;
    setDataLoading(true);
    setDataError(null);
    ++runtimeMetricsRequestId.current;
    setRuntimeMetrics(null);
    setDataUpdatedAt(null);
    try {
      const sessions = await nextSource.getData();
      const accepted = await publishLoadedData(Promise.resolve(sessions), effectiveMode, requestId, true);
      if (!accepted || !mountedRef.current || requestId !== dataRequestId.current) return;
      writeDataMode(effectiveMode);
      setDataSource(nextSource);
      setDataMode(effectiveMode);
    } catch (error) {
      if (mountedRef.current && currentModeRequestId === modeRequestId.current && blockingOperationId.current === requestId) setDataError(translateApiError(error, key => t(key as never), t("app.dataModeLoadError")));
      throw error;
    } finally {
      if (mountedRef.current && currentModeRequestId === modeRequestId.current && blockingOperationId.current === requestId) setDataLoading(false);
      if (currentModeRequestId === modeRequestId.current && blockingOperationId.current === requestId) {
        blockingOperationId.current = null;
        modeChangeInProgress.current = false;
      }
    }
  };

  return {
    data,
    dataRef,
    dataMode,
    dataSource,
    dataLoading,
    dataError,
    runtimeMetrics,
    dataUpdatedAt,
    modeChangeInProgress,
    publishLoadedData,
    reloadData,
    changeDataMode,
    handleRecalculationStart,
    handleDataRecalculated,
    handleRecalculationError,
  };
}
