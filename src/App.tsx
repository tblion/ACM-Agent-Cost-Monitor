// Composes the dashboard, shared state hooks, and application dialogs.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CustomGroup } from "./types";
import { filterSessions, type Filters } from "./lib/aggregate";
import { sortDisplayValues } from "./lib/sorting";
import { Header } from "./components/Header";
import { FilterBar } from "./components/FilterBar";
import { KpiCards } from "./components/KpiCards";
import { DeferredLoading } from "./components/DeferredLoading";
import { SessionTable } from "./components/SessionTable";
import { buildProjectFilterOptions, reconcileProjectSelection, selectedGroupValue, resolveProjectSelection, type ProjectFilterOptions } from "./lib/projectFilters";
import { isLiveAvailable } from "./lib/app-state";
import { useAppData } from "./app/useAppData";
import { useAudit } from "./app/useAudit";
import { useLiveMode } from "./app/useLiveMode";
import { useSettings } from "./app/useSettings";
import { defaultFilters } from "./app/defaultFilters";
import "./App.css";

const CostOverTime = lazy(() => import("./components/charts/CostOverTime").then(module => ({ default: module.CostOverTime })));
const CostByProject = lazy(() => import("./components/charts/CostByProject").then(module => ({ default: module.CostByProject })));
const CostByModel = lazy(() => import("./components/charts/CostByModel").then(module => ({ default: module.CostByModel })));
const CostByProvider = lazy(() => import("./components/charts/CostByProvider").then(module => ({ default: module.CostByProvider })));
const TokenBreakdown = lazy(() => import("./components/charts/TokenBreakdown").then(module => ({ default: module.TokenBreakdown })));
const TopSessions = lazy(() => import("./components/charts/TopSessions").then(module => ({ default: module.TopSessions })));
const CostByGroup = lazy(() => import("./components/charts/CostByGroup").then(module => ({ default: module.CostByGroup })));
const UsageByBilling = lazy(() => import("./components/charts/UsageByBilling").then(module => ({ default: module.UsageByBilling })));
const SettingsModal = lazy(() => import("./components/SettingsModal").then(module => ({ default: module.SettingsModal })));
const RatesModal = lazy(() => import("./components/RatesModal").then(module => ({ default: module.RatesModal })));
const AboutModal = lazy(() => import("./components/AboutModal").then(module => ({ default: module.AboutModal })));
const AuditView = lazy(() => import("./components/AuditView").then(module => ({ default: module.AuditView })));

export { defaultFilters } from "./app/defaultFilters";

function reconcileFilters(filters: Filters, previous: ProjectFilterOptions, next: ProjectFilterOptions): Filters {
  if (filters.projects === undefined) return filters;
  const projects = reconcileProjectSelection(filters.projects, previous, next);
  const hasGroup = selectedGroupValue(projects, next) !== undefined;
  const projectValues = new Set(next.projects.map(option => option.value));
  const allProjectsSelected = !hasGroup && projectValues.size > 0 && projects.length === projectValues.size && projects.every(value => projectValues.has(value));
  return { ...filters, projects: allProjectsSelected ? undefined : projects };
}

export default function App() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>({});
  const [showSettings, setShowSettings] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const projectFilterOptionsRef = useRef<ProjectFilterOptions | null>(null);
  const filtersDirtyRef = useRef(false);
  const defaultPeriodDaysRef = useRef(30);

  const audit = useAudit();
  const appData = useAppData({ defaultPeriodDaysRef, setFilters, markAuditStale: audit.markAuditStale });
  const settingsState = useSettings({
    dataRef: appData.dataRef,
    filtersDirtyRef,
    setFilters,
    markAuditStale: audit.markAuditStale,
    defaultPeriodDaysRef,
    onSettingsSaved: () => {
      audit.markAuditStale();
      void appData.reloadData(false);
    },
  });
  const liveState = useLiveMode({
    dataMode: appData.dataMode,
    liveActive: settingsState.liveActive,
    settings: settingsState.settings,
    settingsRef: settingsState.settingsRef,
    onLiveActiveChange: settingsState.setLiveActive,
    enqueueSettingsSave: settingsState.enqueueSettingsSave,
    reloadData: appData.reloadData,
    modeChangeInProgress: appData.modeChangeInProgress,
  });

  const {
    data, dataMode, dataSource, dataLoading, dataError, runtimeMetrics, dataUpdatedAt,
    changeDataMode, handleRecalculationStart, handleDataRecalculated, handleRecalculationError,
  } = appData;
  const { settings, settingsError, saveSettingsAndClose: saveSettingsAndCloseState } = settingsState;
  const { showAudit, setShowAudit, auditStale, setAuditStale, auditGeneration, auditGenerationRef, auditButtonRef, dashboardMainRef, auditContentRef } = audit;
  const { live, liveError, liveSaving, toggleLive, disableLive } = liveState;
  const saveSettingsAndClose = (nextSettings: Parameters<typeof saveSettingsAndCloseState>[0]) => saveSettingsAndCloseState(nextSettings, () => setShowSettings(false));
  const changeDataModeAndCloseSettings = async (mode: Parameters<typeof changeDataMode>[0]) => {
    await changeDataMode(mode);
    setShowSettings(false);
  };

  const projects = useMemo(() => sortDisplayValues([...new Set(data.map(s => s.project))]), [data]);
  const models = useMemo(() => sortDisplayValues([...new Set(data.flatMap(s => s.models.map(m => m.model)))]), [data]);
  const providers = useMemo(() => sortDisplayValues([...new Set(data.flatMap(s => s.models.map(m => m.provider)))]), [data]);
  const projectFilterOptions = useMemo(
    () => buildProjectFilterOptions(projects, settings?.customGroups ?? [], {
      groupAriaLabel: name => t("filters.groupAriaLabel", { name }),
    }),
    [projects, settings?.customGroups, t],
  );
  const previousProjectFilterOptions = projectFilterOptionsRef.current ?? projectFilterOptions;
  const reconciledFilters = useMemo(
    () => reconcileFilters(filters, previousProjectFilterOptions, projectFilterOptions),
    [filters, previousProjectFilterOptions, projectFilterOptions],
  );
  useEffect(() => {
    setFilters(current => {
      const next = reconcileFilters(current, previousProjectFilterOptions, projectFilterOptions);
      return next.projects === current.projects || (next.projects?.join("\u0001") ?? "") === (current.projects?.join("\u0001") ?? "")
        ? current
        : next;
    });
    projectFilterOptionsRef.current = projectFilterOptions;
  }, [previousProjectFilterOptions, projectFilterOptions]);
  const effectiveFilters = useMemo(() => ({
    ...reconciledFilters,
    projects: reconciledFilters.projects === undefined ? undefined : resolveProjectSelection(reconciledFilters.projects, projectFilterOptions),
  }), [reconciledFilters, projectFilterOptions]);
  const filtered = useMemo(() => filterSessions(data, effectiveFilters), [data, effectiveFilters]);
  const activeGroup = useMemo<CustomGroup | undefined>(() => {
    const value = selectedGroupValue(reconciledFilters.projects ?? [], projectFilterOptions);
    const option = projectFilterOptions.groups.find(group => group.value === value);
    return option ? { name: option.label, projects: option.members ?? [] } : undefined;
  }, [projectFilterOptions, reconciledFilters.projects]);

  if (!settings) return (
    <div style={{ padding: 40, textAlign: "center" }} className="muted">
       {settingsError ? <p role="alert">{t(settingsError.key, { defaultValue: settingsError.key, details: settingsError.details ?? "" })}</p> : t("app.loading")}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {dataMode === "demo" && (
        <div className="mock-banner" role="status">
          <strong>{t("app.demoBannerTitle")}</strong>
          <span>{t("app.demoBannerText")}</span>
        </div>
      )}
      {settingsError && <p role="alert" style={{ margin: "12px 20px 0", color: "var(--error)" }}>{t(settingsError.key, { defaultValue: settingsError.key, details: settingsError.details ?? "" })}</p>}
      {liveError && <p role="alert" style={{ margin: "12px 20px 0", color: "var(--error)" }}>{t(liveError, { defaultValue: liveError })}</p>}
      <Header
        live={isLiveAvailable(dataMode) && live}
        liveConfigured={settings.live}
        liveActive={settingsState.liveActive}
        liveAvailable={isLiveAvailable(dataMode)}
        liveSaving={liveSaving}
        metrics={runtimeMetrics}
        updatedAt={dataUpdatedAt}
        onToggleLive={toggleLive}
        onDisableLive={disableLive}
        onOpenSettings={() => setShowSettings(true)}
        onOpenRates={() => setShowRates(true)}
        onOpenAbout={() => setShowAbout(true)}
        onOpenAudit={() => setShowAudit(current => !current)}
        auditButtonRef={auditButtonRef}
        showAudit={showAudit}
      />
      <main ref={dashboardMainRef} hidden={showAudit} tabIndex={-1} style={{ flex: 1, display: showAudit ? "none" : "flex", flexDirection: "column" }}>
        {dataError && <p role="alert" style={{ margin: "12px 20px 0", color: "var(--error)" }}>{t(dataError, { defaultValue: dataError })}</p>}
       <FilterBar filters={reconciledFilters} projects={projects} models={models} providers={providers} projectFilterOptions={projectFilterOptions} onChange={next => { filtersDirtyRef.current = true; setFilters(next); }} onReset={() => setFilters(defaultFilters(data, defaultPeriodDaysRef.current))} />
        <KpiCards data={filtered} />
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, padding: "0 20px 16px", minHeight: 300 }}>
          <Suspense fallback={<DeferredLoading variant="dashboard" />}>
            <CostOverTime data={filtered} />
            <CostByProject data={filtered} activeGroup={activeGroup} />
            <CostByModel data={filtered} />
            <CostByProvider data={filtered} />
            <UsageByBilling data={filtered} />
            <TokenBreakdown data={filtered} />
            <TopSessions data={filtered} />
            <CostByGroup data={filtered} groups={settings.customGroups} />
          </Suspense>
        </div>
        <div style={{ padding: "0 20px 20px" }}>
          <SessionTable data={filtered} />
        </div>
      </main>
      <div ref={auditContentRef} className="audit-content" data-testid="audit-content" hidden={!showAudit} tabIndex={-1}>
        <Suspense fallback={<DeferredLoading variant="dashboard" />}>
          <AuditView
            dataSource={dataSource}
            stale={auditStale}
            auditGeneration={auditGeneration}
            onBack={() => setShowAudit(false)}
            onSuccessfulReport={generation => {
              if (generation === auditGenerationRef.current) setAuditStale(false);
            }}
          />
        </Suspense>
      </div>
        {showSettings && (
          <Suspense fallback={<div className="modal-overlay"><DeferredLoading variant="modal" /></div>}>
             <SettingsModal settings={settings} projects={projects} dataMode={dataMode} onDataModeChange={changeDataModeAndCloseSettings} onClose={() => setShowSettings(false)} onSave={saveSettingsAndClose} />
          </Suspense>
        )}
      {showRates && (
        <Suspense fallback={<div className="modal-overlay"><DeferredLoading variant="modal" /></div>}>
          <RatesModal
            dataSource={dataSource}
            recalculableMessages={data.flatMap(session => session.models).filter(model => model.source === "configured").length}
            onClose={() => setShowRates(false)}
            onRecalculationStart={handleRecalculationStart}
            onDataRecalculated={handleDataRecalculated}
            onRecalculationError={handleRecalculationError}
          />
        </Suspense>
      )}
      {showAbout && (
        <Suspense fallback={<div className="modal-overlay"><DeferredLoading variant="modal" /></div>}>
          <AboutModal onClose={() => setShowAbout(false)} />
        </Suspense>
      )}
      {dataLoading && <span className="sr-only" role="status">{t("app.dataLoading")}</span>}
    </div>
  );
}
