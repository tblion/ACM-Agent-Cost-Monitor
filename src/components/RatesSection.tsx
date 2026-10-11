// Displays usage pricing and lets users explicitly recalculate historical costs.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogStatus, CostSummary, RateEntry, RecalculationDiagnostics, RecalculationResult, SessionRecord } from "../types";
import type { AppDataSource } from "../data-source";
import { isConfiguredRate, rateKey } from "../lib/rates";
import { useTranslation } from "react-i18next";
import { formatCurrency, formatDate, formatNumber } from "../i18n/format";
import { resolveLanguage } from "../i18n/locale";
import { translateApiError } from "../api";
import { PricingComparison } from "./pricing/PricingComparison";

interface Props {
  dataSource: AppDataSource;
  currentSessions: SessionRecord[];
  onRecalculationStart: () => void;
  onDataRecalculated: (sessions: SessionRecord[]) => void;
  onRecalculationError: () => void;
}

export function RatesSection({ dataSource, currentSessions, onRecalculationStart, onDataRecalculated, onRecalculationError }: Props) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [search, setSearch] = useState("");
  const [expandedRate, setExpandedRate] = useState<string | null>(null);
  const [costSummary, setCostSummary] = useState<CostSummary[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RecalculationResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [recalculationLoading, setRecalculationLoading] = useState(false);
  const [recalculationError, setRecalculationError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<RecalculationDiagnostics | null>(null);
  const [loadedSource, setLoadedSource] = useState<AppDataSource | null>(null);
  const confirmationButtonRef = useRef<HTMLButtonElement>(null);
  const recalculationTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocusRef = useRef(false);
  useEffect(() => {
    let cancelled = false;

    setRates([]);
    setCostSummary([]);
    setRatesLoading(true);
    setSummaryLoading(true);
    setRatesError(null);
    setSummaryError(null);
    setCatalogStatus(null);
    setCatalogError(null);
    setPreview(null);
    setPreviewLoading(false);
    setRecalculationError(null);
    setDiagnostics(null);
    let pending = 3;
    const markLoaded = () => {
      pending -= 1;
      if (pending === 0 && !cancelled) setLoadedSource(dataSource);
    };

    // Both calls start together, but their states remain independent.
    dataSource.getRates()
      .then(value => { if (!cancelled) setRates(value); })
        .catch(error => { if (!cancelled) setRatesError(translateApiError(error, key => t(key as never), t("rates.configuredError"))); })
      .finally(() => { if (!cancelled) setRatesLoading(false); markLoaded(); });
    dataSource.getCostSummary()
      .then(value => { if (!cancelled) setCostSummary(value); })
        .catch(error => { if (!cancelled) setSummaryError(translateApiError(error, key => t(key as never), t("rates.historicalError"))); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); markLoaded(); });
    dataSource.getCatalogStatus()
      .then(value => { if (!cancelled) setCatalogStatus(value); })
      .catch(error => { if (!cancelled) setCatalogError(translateApiError(error, key => t(key as never), t("rates.catalogError"))); })
      .finally(markLoaded);

    return () => { cancelled = true; };
  }, [dataSource]);

  useEffect(() => {
    if (preview) {
      confirmationButtonRef.current?.focus();
    } else if (restoreTriggerFocusRef.current) {
      restoreTriggerFocusRef.current = false;
      recalculationTriggerRef.current?.focus();
    }
  }, [preview, diagnostics]);

  const fmtRate = (v: number) => v === 0 ? t("common.noValue") : `${formatNumber(v, language)} ${t("rates.rateUnit")}`;
  const sourceIsCurrent = loadedSource === dataSource;
  const configuredKeys = useMemo(() => new Set(rates.filter(r => r.source === "configured").map(r => rateKey(r.provider, r.model))), [rates]);
  const filteredRates = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(language);
    return query ? rates.filter(rate => `${rate.provider} ${rate.model}`.toLocaleLowerCase(language).includes(query)) : rates;
  }, [language, rates, search]);
  const previewCosts = useMemo(() => {
    const before = currentSessions.reduce((total, session) => total + session.cost, 0);
    if (!preview) return { before, after: 0, changedSessions: 0 };
    const after = preview.sessions.reduce((total, session) => total + session.cost, 0);
    const previousById = new Map(currentSessions.map(session => [session.id, session.cost]));
    const changedSessions = preview.sessions.filter(session => previousById.get(session.id) !== session.cost).length;
    return { before, after, changedSessions };
  }, [currentSessions, preview]);
  const requestRecalculation = async () => {
    if (recalculationLoading || previewLoading) return;
    if (!catalogStatus?.valid) {
      setRecalculationError(catalogError ? "rates.catalogError" : "rates.invalidCatalog");
      return;
    }
    recalculationTriggerRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    restoreTriggerFocusRef.current = true;
    setRecalculationError(null);
    setPreviewLoading(true);
    try {
      setPreview(await (dataSource.previewRecalculation?.() ?? dataSource.recalculate()));
    } catch (error) {
      setRecalculationError(translateApiError(error, key => t(key as never), t("rates.previewError")));
      onRecalculationError();
    } finally {
      setPreviewLoading(false);
    }
  };

  const cancelRecalculation = () => {
    if (recalculationLoading || previewLoading) return;
    setPreview(null);
    restoreTriggerFocusRef.current = true;
  };

  const confirmRecalculation = async () => {
    if (recalculationLoading || !preview) return;
    setRecalculationLoading(true);
    setRecalculationError(null);
    onRecalculationStart();
    try {
      await dataSource.applyRecalculation?.();
      setDiagnostics(preview.diagnostics);
      setPreview(null);
      restoreTriggerFocusRef.current = true;
      onDataRecalculated(preview.sessions);
    } catch (error) {
      setRecalculationError(translateApiError(error, key => t(key as never), t("rates.recalculationError")));
      onRecalculationError();
    } finally {
      setRecalculationLoading(false);
    }
  };

  const refreshRates = async () => setRates(await dataSource.getRates());

  return (
      <div className="pricing-rates-content">

        <section aria-labelledby="configured-rates-title">
           <h3 id="configured-rates-title" style={{ fontSize: 14, margin: "0 0 8px" }}>{t("rates.availableTitle")}</h3>
            <p id="usage-rate-help" style={{ color: "var(--muted)", fontSize: 12 }}>{t("rates.rateDetails")}</p>
           <label htmlFor="usage-rate-search" style={{ display: "block", marginBottom: 8 }}>{t("rates.searchLabel")}</label>
           <input id="usage-rate-search" type="search" value={search} onChange={event => setSearch(event.target.value)} aria-describedby="usage-rate-help" placeholder={t("rates.searchPlaceholder")} />
           {(ratesLoading || !sourceIsCurrent) && <p role="status" style={{ color: "var(--muted)", fontSize: 13 }}>{t("rates.configuredLoading")}</p>}
          {sourceIsCurrent && ratesError && <p role="alert" style={{ color: "var(--error)", fontSize: 13 }}>{t(ratesError, { defaultValue: ratesError })}</p>}
           {sourceIsCurrent && !ratesLoading && !ratesError && rates.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("rates.configuredEmpty")}</p>
           )}
           {sourceIsCurrent && !ratesLoading && !ratesError && search.trim().length > 0 && filteredRates.length === 0 && <p role="status">{t("rates.noSearchResults")}</p>}
           {sourceIsCurrent && !ratesLoading && !ratesError && filteredRates.length > 0 && (
             <div className="rates-table-scroll" role="region" tabIndex={0} aria-label={t("rates.ratesRegion")}>
              <table className="rates-table">
               <caption style={{ textAlign: "left", paddingBottom: 6 }}>{t("rates.availableCaption")}</caption>
             <thead>
               <tr>
                  <th scope="col">{t("rates.model")}</th>
                  <th scope="col" className="rates-number-heading">{t("rates.inputRate")}</th>
                  <th scope="col" className="rates-number-heading">{t("rates.outputRate")}</th>
                  <th scope="col" className="rates-number-heading"><span>{t("rates.cacheRates")}</span><small>{t("rates.cacheRead")} / {t("rates.cacheWrite")}</small></th>
                  <th scope="col">{t("rates.source")}</th>
                  <th scope="col"><span className="sr-only">{t("rates.rateActions")}</span></th>
               </tr>
             </thead>
             <tbody>
               {filteredRates.map((r, i) => (
                 (() => {
                   const rateId = `${r.provider}:${r.model}:${r.effectiveFrom ?? "unknown"}:${i}`;
                   const detailsId = `rate-details-${i}`;
                   const isExpanded = expandedRate === rateId;
                   return <Fragment key={rateId}>
                     <tr className="rates-data-row">
                       <td><div className="rate-model"><span className="rate-provider-icon" aria-hidden="true">{r.provider.slice(0, 1).toLocaleUpperCase(language)}</span><span><strong>{r.model}</strong><small>{r.provider}</small></span></div></td>
                       <td className="rates-number">{fmtRate(r.input)}</td>
                       <td className="rates-number">{fmtRate(r.output)}</td>
                       <td className="rates-number rates-cache-values"><span>{fmtRate(r.cacheRead)}</span><span aria-hidden="true">/</span><span>{fmtRate(r.cacheWrite)}</span></td>
                       <td><span className="badge">{t(r.source === "configured" ? "rates.configuredSource" : "rates.catalogSource")}</span></td>
                       <td className="rates-actions"><button type="button" className="rates-disclosure" aria-label={t(isExpanded ? "rates.hideDetails" : "rates.showDetails", { model: r.model })} aria-expanded={isExpanded} aria-controls={detailsId} onClick={() => setExpandedRate(isExpanded ? null : rateId)}>{isExpanded ? "⌃" : "⌄"}</button></td>
                     </tr>
                     {isExpanded && <tr id={detailsId} className="rates-details-row"><td colSpan={6}><span className="rates-details-label">{t("rates.effectiveFrom")}</span><span>{r.effectiveFrom ? formatDate(new Date(`${r.effectiveFrom}T12:00:00Z`).getTime(), language) : t("rates.currentRate")}</span><span className="rates-details-label">{t("rates.cacheRead")} / {t("rates.cacheWrite")}</span><span>{fmtRate(r.cacheRead)} / {fmtRate(r.cacheWrite)}</span></td></tr>}
                   </Fragment>;
                 })()
               ))}
            </tbody>
          </table>
            </div>
          )}
        </section>

        <PricingComparison rates={rates} onApplied={refreshRates} />

        <section aria-labelledby="historical-costs-title" style={{ marginTop: 24 }}>
           <h3 id="historical-costs-title" style={{ fontSize: 14, margin: "0 0 8px" }}>{t("rates.historicalTitle")}</h3>
           {(summaryLoading || !sourceIsCurrent) && <p role="status" style={{ color: "var(--muted)", fontSize: 13 }}>{t("rates.historicalLoading")}</p>}
           {sourceIsCurrent && summaryError && <p role="alert" style={{ color: "var(--error)", fontSize: 13 }}>{t(summaryError, { defaultValue: summaryError })}</p>}
          {sourceIsCurrent && !summaryLoading && !summaryError && costSummary.length === 0 && (
             <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("rates.historicalEmpty")}</p>
          )}
          {sourceIsCurrent && !summaryLoading && !summaryError && costSummary.length > 0 && (
             <div className="rates-table-scroll" role="region" tabIndex={0} aria-label={t("rates.historicalRegion")}>
            <table style={{ minWidth: 620, width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
               <caption style={{ textAlign: "left", paddingBottom: 6 }}>{t("rates.historicalCaption")}</caption>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                   <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500 }}>{t("rates.provider")}</th>
                   <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500 }}>{t("rates.model")}</th>
                   <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>{t("rates.messages")}</th>
                   <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>{t("rates.storedCost")}</th>
                   <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500 }}>{t("rates.source")}</th>
                </tr>
              </thead>
              <tbody>
                {costSummary.map((summary, i) => {
                  const configured = summary.configured || isConfiguredRate(configuredKeys, summary.provider, summary.model);
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "7px 10px" }}>{summary.provider}</td>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{summary.model}</td>
                       <td style={{ padding: "7px 10px", textAlign: "right" }}>{formatNumber(summary.messages, language)}</td>
                       <td style={{ padding: "7px 10px", textAlign: "right" }}>{formatCurrency(summary.storedCost, language)}</td>
                      <td style={{ padding: "7px 10px" }}>
                         <span className="badge">{t("rates.historicalSource")}</span>
                         {configured && <span style={{ display: "block", marginTop: 4, color: "var(--accent)" }}>{t("rates.configuredCostNote")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </section>

        <section aria-labelledby="recalculation-title" style={{ marginTop: 24 }}>
          <h3 id="recalculation-title" style={{ fontSize: 14, margin: "0 0 8px" }}>{t("rates.recalculationTitle")}</h3>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("rates.recalculationDescription")}</p>
           {catalogError && <p role="alert" style={{ color: "var(--error)", fontSize: 13 }}>{t(catalogError, { defaultValue: catalogError })}</p>}
           {recalculationError && <p role="alert" style={{ color: "var(--error)", fontSize: 13 }}>{t(recalculationError, { defaultValue: recalculationError })}</p>}
          {preview && (
            <section className="panel" aria-labelledby="recalculation-preview-title" style={{ marginTop: 12 }}>
              <h4 id="recalculation-preview-title" style={{ margin: "0 0 8px" }}>{t("rates.previewTitle")}</h4>
              <p role="status" aria-live="polite">{t("rates.previewSummary", { messages: formatNumber(preview.diagnostics.recalculableMessages, language), sessions: formatNumber(previewCosts.changedSessions, language) })}</p>
              <dl>
                <div><dt>{t("rates.costBefore")}</dt><dd>{formatCurrency(previewCosts.before, language)}</dd></div>
                <div><dt>{t("rates.costAfter")}</dt><dd>{formatCurrency(previewCosts.after, language)}</dd></div>
                <div><dt>{t("rates.costDifference")}</dt><dd>{formatCurrency(previewCosts.after - previewCosts.before, language)}</dd></div>
              </dl>
              <p>{t("rates.missingDates", { count: formatNumber(preview.diagnostics.missingDates, language) })}</p>
              <p>{t("rates.missingTokens", { count: formatNumber(preview.diagnostics.missingTokens, language) })}</p>
              <p>{t("rates.missingRates", { count: formatNumber(preview.diagnostics.missingRates, language) })}</p>
              <p>{t("rates.storedFallbacks")}</p>
              <div className="modal-actions">
                <button type="button" onClick={cancelRecalculation} disabled={recalculationLoading}>{t("rates.cancelPreview")}</button>
                <button ref={confirmationButtonRef} type="button" onClick={confirmRecalculation} disabled={recalculationLoading}>{recalculationLoading ? t("rates.recalculating") : t("rates.confirmRecalculation")}</button>
              </div>
            </section>
          )}
          {!preview && (
            <button ref={recalculationTriggerRef} type="button" onClick={() => void requestRecalculation()} disabled={recalculationLoading || previewLoading || !sourceIsCurrent || !catalogStatus}>
              {t("rates.previewRecalculation")}
            </button>
          )}
          {previewLoading && <p role="status">{t("rates.previewLoading")}</p>}
          {recalculationLoading && <p role="status" aria-live="polite">{t("rates.recalculating")}</p>}
          {diagnostics && (
            <div role="status" style={{ marginTop: 12 }}>
              <p>{t("rates.recalculationSuccess", { count: formatNumber(diagnostics.recalculableMessages, language) })}</p>
              <p>{t("rates.missingDates", { count: formatNumber(diagnostics.missingDates, language) })}</p>
              <p>{t("rates.missingTokens", { count: formatNumber(diagnostics.missingTokens, language) })}</p>
              <p>{t("rates.missingRates", { count: formatNumber(diagnostics.missingRates, language) })}</p>
              <p>{t("rates.storedFallbacks")}</p>
            </div>
          )}
        </section>

      </div>
  );
}
