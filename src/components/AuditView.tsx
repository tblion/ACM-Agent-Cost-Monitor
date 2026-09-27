import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { exportAudit, translateApiError } from "../api";
import { formatCurrency, formatDateTime, formatNumber } from "../i18n/format";
import { resolveLanguage } from "../i18n/locale";
import { serializeAuditReportCsv, serializeAuditReportJson } from "../lib/audit-export";
import type { AppDataSource } from "../data-source";
import { sortDisplayValues } from "../lib/sorting";
import type { AuditAnomaly, AuditCostSource, AuditMessage, AuditReport } from "../types";

type FilterValue = "all" | string;

interface AuditFilters {
  session: FilterValue;
  provider: FilterValue;
  model: FilterValue;
  costSource: "all" | AuditCostSource;
  anomaly: "all" | AuditAnomaly;
}

interface Props {
  dataSource: Pick<AppDataSource, "getAuditReport">;
  onBack: () => void;
  stale: boolean;
  auditGeneration: number;
  onSuccessfulReport?: (generation: number) => void;
}

const ANOMALIES: AuditAnomaly[] = ["missingTokens", "missingDate", "missingRate", "invalidRate", "storedCostFallback"];
const COST_SOURCES: AuditCostSource[] = ["configured", "catalog", "stored"];
const EMPTY_FILTERS: AuditFilters = { session: "all", provider: "all", model: "all", costSource: "all", anomaly: "all" };

function formatPath(path: string): string {
  return path || "—";
}

export function AuditView({ dataSource, onBack, stale, auditGeneration, onSuccessfulReport }: Props) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const auditRequestIdRef = useRef(0);
  const auditGenerationRef = useRef(auditGeneration);
  auditGenerationRef.current = auditGeneration;

  const filterOptions = useMemo(() => ({
    sessions: report ? sortDisplayValues([...new Set(report.messages.map(message => message.sessionId))]) : [],
    providers: report ? sortDisplayValues([...new Set(report.messages.map(message => message.provider))]) : [],
    models: report ? sortDisplayValues([...new Set(report.messages.map(message => message.model))]) : [],
  }), [report]);

  const filteredMessages = useMemo(() => {
    if (!report) return [];
    return report.messages.filter(message => (
      (filters.session === "all" || message.sessionId === filters.session)
      && (filters.provider === "all" || message.provider === filters.provider)
      && (filters.model === "all" || message.model === filters.model)
      && (filters.costSource === "all" || message.costSource === filters.costSource)
      && (filters.anomaly === "all" || message.anomalies.includes(filters.anomaly))
    ));
  }, [filters, report]);

  const refresh = async () => {
    const requestId = ++auditRequestIdRef.current;
    const generationAtStart = auditGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextReport = await dataSource.getAuditReport();
      if (requestId !== auditRequestIdRef.current || generationAtStart !== auditGenerationRef.current) return;
      setReport(nextReport);
      setFilters(EMPTY_FILTERS);
      setExpandedRow(null);
      onSuccessfulReport?.(generationAtStart);
    } catch (error) {
      if (requestId === auditRequestIdRef.current && generationAtStart === auditGenerationRef.current) {
        setError(translateApiError(error, key => t(key as never), t("audit.refreshError")));
      }
    } finally {
      if (requestId === auditRequestIdRef.current) setLoading(false);
    }
  };

  const save = async (format: "json" | "csv") => {
    if (!report || saving) return;
    setSaving(true);
    setError(null);
    try {
      const content = format === "json" ? serializeAuditReportJson(report) : serializeAuditReportCsv(report);
      await exportAudit(content, `audit-report.${format}`);
    } catch (error) {
      setError(translateApiError(error, key => t(key as never), t("audit.exportError")));
    } finally {
      setSaving(false);
    }
  };

  const number = (value: number) => formatNumber(value, language, { maximumFractionDigits: 2 });
  const cost = (value: number) => formatCurrency(value, language);
  const generatedAt = report ? formatDateTime(Date.parse(report.generatedAt), language) : null;
  const canExport = report?.valid === true && !saving;

  return (
    <main className="audit-view" aria-labelledby="audit-title">
      <div className="audit-heading">
        <div>
          <button className="audit-back" onClick={onBack}>{t("audit.back")}</button>
          <h1 id="audit-title">{t("audit.title")}</h1>
          {generatedAt && <p className="audit-last-updated">{t("audit.lastUpdated", { value: generatedAt })}</p>}
        </div>
        <div className="audit-actions">
          <button onClick={refresh} disabled={loading} aria-busy={loading}>
            {loading ? t("audit.refreshing") : t("audit.refresh")}
          </button>
          <button onClick={() => void save("json")} disabled={!canExport}>
            {t("audit.exportJson")}
          </button>
          <button onClick={() => void save("csv")} disabled={!canExport}>
            {t("audit.exportCsv")}
          </button>
        </div>
      </div>

      {(loading || saving) && (
        <div className="audit-live-status" role="status" aria-live="polite">
          {loading ? t("audit.refreshing") : t("audit.exporting")}
        </div>
      )}
      {error && <p className="audit-error" role="alert">{t(error, { defaultValue: error })}</p>}
      {report?.valid === false && (
        <div className="audit-invariant audit-invariant-invalid" role="alert">
          <strong>{t("audit.invariantInvalid")}</strong>
          <span>{t("audit.invariantFailure")}</span>
          <ul>{report.invariants.failed.map(failure => <li key={failure}>{failure}</li>)}</ul>
        </div>
      )}
      {report?.valid && (
        <p className="audit-invariant audit-invariant-valid" role="status">{t("audit.invariantValid")}</p>
      )}
      {report && stale && <p className="audit-stale" role="status">{t("audit.stale")}</p>}

      <section className="panel audit-guide" aria-labelledby="audit-guide-title">
        <h2 id="audit-guide-title">{t("audit.guideTitle")}</h2>
        <p>{t("audit.guidePurpose")}</p>
        <p>{t("audit.guideReadingOrder")}</p>
        <p>{t("audit.guideAnomalies")}</p>
      </section>

      {!report ? (
        <section className="panel audit-empty" aria-live="polite">
          <h2>{t("audit.emptyTitle")}</h2>
          <p>{t("audit.emptyDescription")}</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="audit-summary-title">
            <h2 id="audit-summary-title" className="audit-section-title">{t("audit.summary")} <InfoTip label={t("audit.helpSummaryLabel")} text={t("audit.helpSummary")} /></h2>
            <div className="audit-summary-grid">
              <AuditCard label={t("audit.allSessions")} value={number(report.summary.allSessions)} />
              <AuditCard label={t("audit.totalMessages")} value={number(report.summary.totalMessages)} />
              <AuditCard label={t("audit.sessionsWithAssistant")} value={number(report.summary.sessionsWithAssistant)} />
              <AuditCard label={t("audit.assistantMessages")} value={number(report.summary.assistantMessages)} />
              <AuditCard label={t("audit.ignoredMessages")} value={number(report.summary.ignoredMessages)} />
              <AuditCard label={t("audit.recalculableMessages")} value={number(report.summary.recalculableMessages)} />
              <AuditCard label={t("audit.customRateMessages")} value={number(report.summary.customRateMessages)} />
              <AuditCard label={t("audit.catalogRateMessages")} value={number(report.summary.catalogRateMessages)} />
              <AuditCard label={t("audit.storedFallbackMessages")} value={number(report.summary.storedFallbackMessages)} />
              <AuditCard label={t("audit.missingTokenMessages")} value={number(report.summary.missingTokenMessages)} />
              <AuditCard label={t("audit.missingDateMessages")} value={number(report.summary.missingDateMessages)} />
              <AuditCard label={t("audit.missingRateMessages")} value={number(report.summary.missingRateMessages)} />
              <AuditCard label={t("audit.anomalyMissingTokens")} value={number(report.summary.anomalyCounts.missingTokens)} />
              <AuditCard label={t("audit.anomalyMissingDate")} value={number(report.summary.anomalyCounts.missingDate)} />
              <AuditCard label={t("audit.anomalyMissingRate")} value={number(report.summary.anomalyCounts.missingRate)} />
              <AuditCard label={t("audit.anomalyInvalidRate")} value={number(report.summary.anomalyCounts.invalidRate)} />
              <AuditCard label={t("audit.anomalyStoredCostFallback")} value={number(report.summary.anomalyCounts.storedCostFallback)} />
              <AuditCard label={<>{t("audit.selectedCost")} <InfoTip label={t("audit.helpSelectedCostLabel")} text={t("audit.helpSelectedCost")} /></>} value={cost(report.summary.selectedCostTotal)} />
              <AuditCard label={<>{t("audit.storedCost")} <InfoTip label={t("audit.helpStoredCostLabel")} text={t("audit.helpStoredCost")} /></>} value={cost(report.summary.storedCostTotal)} />
              <AuditCard label={<>{t("audit.calculatedCost")} <InfoTip label={t("audit.helpCalculatedCostLabel")} text={t("audit.helpCalculatedCost")} /></>} value={cost(report.summary.calculatedCostTotal)} />
              <AuditCard label={<>{t("audit.anomalies")} <InfoTip label={t("audit.helpAnomaliesLabel")} text={t("audit.helpAnomalies")} /></>} value={number(Object.values(report.summary.anomalyCounts).reduce((total, count) => total + count, 0))} />
            </div>
          </section>

          <section className="panel audit-provenance" aria-labelledby="audit-provenance-title">
            <h2 id="audit-provenance-title">{t("audit.provenance")}</h2>
            <dl>
              <div><dt>{t("audit.databasePath")}</dt><dd>{formatPath(report.provenance.databasePath)}</dd></div>
              <div><dt>{t("audit.configPath")}</dt><dd>{formatPath(report.provenance.configPath)}</dd></div>
              <div><dt>{t("audit.catalogPath")}</dt><dd>{formatPath(report.provenance.catalogPath)}</dd></div>
              <div><dt>{t("audit.catalogVersion")}</dt><dd>{report.provenance.catalogVersion}</dd></div>
              <div><dt>{t("audit.catalogSourceVersion")}</dt><dd>{report.provenance.catalogSourceVersion}</dd></div>
              <div><dt>{t("audit.catalogGeneratedAt")}</dt><dd>{formatDateTime(Date.parse(report.provenance.catalogGeneratedAt), language)}</dd></div>
              <div><dt>{t("audit.catalogRateCount")}</dt><dd>{number(report.provenance.catalogRateCount)}</dd></div>
            </dl>
          </section>

          <section className="panel audit-messages" aria-labelledby="audit-messages-title">
            <div className="audit-section-heading">
              <h2 id="audit-messages-title">{t("audit.messages")} <InfoTip label={t("audit.helpMessageDetailsLabel")} text={t("audit.helpMessageDetails")} /></h2>
              <div className="audit-filters">
                <AuditFilterSelect id="audit-session-filter" label={t("audit.sessionFilter")} value={filters.session} options={filterOptions.sessions} allLabel={t("audit.allSessionsFilter")} onChange={value => setFilters(current => ({ ...current, session: value }))} />
                <AuditFilterSelect id="audit-provider-filter" label={t("audit.providerFilter")} value={filters.provider} options={filterOptions.providers} allLabel={t("audit.allProviders")} onChange={value => setFilters(current => ({ ...current, provider: value }))} />
                <AuditFilterSelect id="audit-model-filter" label={t("audit.modelFilter")} value={filters.model} options={filterOptions.models} allLabel={t("audit.allModels")} onChange={value => setFilters(current => ({ ...current, model: value }))} />
                <AuditFilterSelect id="audit-source-filter" label={t("audit.costSourceFilter")} value={filters.costSource} options={COST_SOURCES} allLabel={t("audit.allSources")} optionLabel={source => t(`audit.source.${source as AuditCostSource}`)} onChange={value => setFilters(current => ({ ...current, costSource: value as "all" | AuditCostSource }))} />
                <AuditFilterSelect id="audit-anomaly-filter" label={t("audit.anomalyFilter")} value={filters.anomaly} options={ANOMALIES} allLabel={t("audit.allAnomalies")} optionLabel={anomaly => t(`audit.anomaly.${anomaly as AuditAnomaly}`)} onChange={value => setFilters(current => ({ ...current, anomaly: value as "all" | AuditAnomaly }))} />
              </div>
            </div>
            <div
              className="audit-table-scroll"
              tabIndex={0}
              aria-label={t("audit.tableScrollLabel")}
              aria-describedby="audit-table-scroll-help"
            >
              <p id="audit-table-scroll-help" className="audit-table-scroll-help">{t("audit.tableScrollHelp")}</p>
              <table>
                <caption>{t("audit.messageTableCaption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("audit.message")}</th>
                    <th scope="col">{t("audit.session")}</th>
                    <th scope="col">{t("audit.provider")}</th>
                    <th scope="col">{t("audit.model")}</th>
                    <th scope="col">{t("audit.selectedCost")}</th>
                    <th scope="col">{t("audit.costSource")}</th>
                    <th scope="col">{t("audit.anomalies")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMessages.map(message => (
                    <AuditMessageRows
                      key={message.messageId}
                      message={message}
                      expanded={expandedRow === message.messageId}
                      onToggle={() => setExpandedRow(current => current === message.messageId ? null : message.messageId)}
                      cost={cost}
                       number={number}
                       language={language}
                       invariantFailures={report.invariants.failed.filter(failure => failure.endsWith(`:${message.messageId}`))}
                     />
                  ))}
                </tbody>
              </table>
              {filteredMessages.length === 0 && <p className="muted">{t("audit.noMessages")}</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function AuditFilterSelect({ id, label, value, options, allLabel, optionLabel = option => option, onChange }: {
  id: string;
  label: string;
  value: FilterValue;
  options: string[];
  allLabel: string;
  optionLabel?: (option: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id}>
      <span>{label}</span>
      <select id={id} aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
        <option value="all">{allLabel}</option>
        {options.map(option => <option key={option} value={option}>{optionLabel(option)}</option>)}
      </select>
    </label>
  );
}

function AuditCard({ label, value }: { label: ReactNode; value: string }) {
  return <article className="panel audit-card"><span>{label}</span><strong>{value}</strong></article>;
}

function InfoTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const tooltipId = `audit-help-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <span className="audit-info-tip">
      <button
        type="button"
        className="audit-info-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={tooltipId}
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}
      >
        i
      </button>
      {open && <span id={tooltipId} className="audit-info-tooltip" role="tooltip">{text}</span>}
    </span>
  );
}

function AuditMessageRows({
  message,
  expanded,
  onToggle,
  cost,
  number,
  language,
  invariantFailures,
}: {
  message: AuditMessage;
  expanded: boolean;
  onToggle: () => void;
  cost: (value: number) => string;
  number: (value: number) => string;
  language: "fr" | "en";
  invariantFailures: string[];
}) {
  const { t } = useTranslation();
  const detailsId = `audit-details-${message.messageId}`;
  const invariantStatusId = `${detailsId}-invariants`;
  return (
    <>
      <tr>
        <th scope="row">
          <button className="audit-row-toggle" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId}>
            {message.messageId}
          </button>
        </th>
        <td>{message.sessionId}</td>
        <td>{message.provider}</td>
        <td>{message.model}</td>
        <td>{cost(message.selectedCost)}</td>
        <td>{t(`audit.source.${message.costSource}`)}</td>
        <td>{message.anomalies.length ? message.anomalies.map(anomaly => t(`audit.anomaly.${anomaly}`)).join(", ") : t("common.noValue")}</td>
      </tr>
      {expanded && (
        <tr id={detailsId} className="audit-details-row">
          <td colSpan={7}>
            <div className="audit-details">
              <h3>{t("audit.details", { id: message.messageId })}</h3>
              <dl>
                <div><dt>{t("audit.storedCost")}</dt><dd>{cost(message.storedCost)}</dd></div>
                <div><dt>{t("audit.calculatedCost")}</dt><dd>{message.calculatedCost == null ? t("common.noValue") : cost(message.calculatedCost)}</dd></div>
                <div><dt>{t("audit.rateSource")}</dt><dd>{message.rateSource ? t(`audit.rateSourceValue.${message.rateSource}`) : t("common.noValue")}</dd></div>
                <div><dt>{t("audit.effectiveFrom")}</dt><dd>{message.effectiveFrom ?? t("common.noValue")}</dd></div>
              </dl>
              {message.tokens && (
                <div className="audit-detail-block">
                  <h4>{t("audit.tokens")}</h4>
                  <span>{t("audit.input")}: {number(message.tokens.input)}</span>
                  <span>{t("audit.output")}: {number(message.tokens.output)}</span>
                  <span>{t("audit.cacheRead")}: {number(message.tokens.cacheRead)}</span>
                  <span>{t("audit.cacheWrite")}: {number(message.tokens.cacheWrite)}</span>
                  <span>{t("audit.reasoning")}: {number(message.tokens.reasoning)}</span>
                </div>
              )}
              {message.breakdown && (
                <div className="audit-detail-block">
                  <h4>{t("audit.breakdown")} <InfoTip label={t("audit.helpBreakdownLabel")} text={t("audit.helpBreakdown")} /></h4>
                  <span>{t("audit.input")}: {cost(message.breakdown.input)}</span>
                  <span>{t("audit.output")}: {cost(message.breakdown.output)}</span>
                  <span>{t("audit.cacheRead")}: {cost(message.breakdown.cacheRead)}</span>
                  <span>{t("audit.cacheWrite")}: {cost(message.breakdown.cacheWrite)}</span>
                  <span>{t("audit.reasoning")}: {cost(message.breakdown.reasoning)}</span>
                  <strong>{t("audit.total")}: {cost(message.breakdown.total)}</strong>
                </div>
              )}
               {message.rate && (
                <div className="audit-detail-block">
                  <h4>{t("audit.rate")}</h4>
                  <span>{t("audit.input")}: {cost(message.rate.input)}</span>
                  <span>{t("audit.output")}: {cost(message.rate.output)}</span>
                  <span>{t("audit.cacheRead")}: {cost(message.rate.cacheRead)}</span>
                  <span>{t("audit.cacheWrite")}: {cost(message.rate.cacheWrite)}</span>
                 </div>
               )}
               <section className="audit-detail-block audit-message-invariants" aria-labelledby={invariantStatusId}>
                  <h4 id={invariantStatusId}>{t("audit.invariantStatus")} <InfoTip label={t("audit.helpInvariantLabel")} text={t("audit.helpInvariant")} /></h4>
                 {invariantFailures.length > 0 ? (
                   <div className="audit-invariant audit-invariant-invalid" role="alert">
                     <strong>{t("audit.invariantMessageInvalid")}</strong>
                     <ul>{invariantFailures.map(failure => <li key={failure}>{failure}</li>)}</ul>
                   </div>
                 ) : (
                   <p className="audit-invariant audit-invariant-valid" role="status">{t("audit.invariantMessageValid")}</p>
                 )}
               </section>
               {message.anomalies.length > 0 && <p className="audit-message-anomalies"><strong>{t("audit.anomalies")}:</strong> {message.anomalies.map(anomaly => t(`audit.anomaly.${anomaly}`)).join(", ")}</p>}
              <p className="audit-message-date">{t("audit.date")}: {message.messageDate == null ? t("common.noValue") : formatDateTime(message.messageDate, language)}</p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
