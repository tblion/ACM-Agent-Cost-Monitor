// src/components/RatesModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogStatus, CostSummary, RateEntry, RecalculationDiagnostics, SessionRecord } from "../types";
import type { AppDataSource } from "../data-source";
import { getFocusTrapTarget, isConfiguredRate, rateKey } from "../lib/rates";
import { useTranslation } from "react-i18next";
import { formatCurrency, formatNumber } from "../i18n/format";
import { resolveLanguage } from "../i18n/locale";
import { translateApiError } from "../api";

interface Props {
  dataSource: AppDataSource;
  recalculableMessages: number;
  onClose: () => void;
  onRecalculationStart: () => void;
  onDataRecalculated: (sessions: SessionRecord[]) => void;
  onRecalculationError: () => void;
}

export function RatesModal({ dataSource, recalculableMessages, onClose, onRecalculationStart, onDataRecalculated, onRecalculationError }: Props) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [costSummary, setCostSummary] = useState<CostSummary[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [recalculationLoading, setRecalculationLoading] = useState(false);
  const [recalculationError, setRecalculationError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<RecalculationDiagnostics | null>(null);
  const [loadedSource, setLoadedSource] = useState<AppDataSource | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmationButtonRef = useRef<HTMLButtonElement>(null);
  const recalculationTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocusRef = useRef(false);
  const recalculationLoadingRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    recalculationLoadingRef.current = recalculationLoading;
  }, [recalculationLoading]);

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
    setConfirmationOpen(false);
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

  // Initial focus and its restoration depend only on the modal lifecycle.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => dialogRef.current
      ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter(el => !el.hasAttribute("disabled"))
      : [];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!recalculationLoadingRef.current) onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const f = focusables();
        const target = getFocusTrapTarget(f, document.activeElement, e.shiftKey);
        if (target) { e.preventDefault(); target.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, []);

  useEffect(() => {
    if (confirmationOpen) {
      confirmationButtonRef.current?.focus();
    } else if (restoreTriggerFocusRef.current) {
      restoreTriggerFocusRef.current = false;
      recalculationTriggerRef.current?.focus();
    }
  }, [confirmationOpen, diagnostics]);

  const fmtRate = (v: number) => v === 0 ? t("common.noValue") : `${formatNumber(v, language)} ${t("rates.rateUnit")}`;
  const sourceIsCurrent = loadedSource === dataSource;
  const configuredKeys = useMemo(() => new Set(rates.filter(r => r.source === "configured").map(r => rateKey(r.provider, r.model))), [rates]);
  const requestRecalculation = () => {
    if (recalculationLoading) return;
    if (!catalogStatus?.valid) {
      setRecalculationError(catalogError ? "rates.catalogError" : "rates.invalidCatalog");
      return;
    }
    recalculationTriggerRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    restoreTriggerFocusRef.current = true;
    setRecalculationError(null);
    setConfirmationOpen(true);
  };

  const cancelRecalculation = () => {
    if (recalculationLoading) return;
    setConfirmationOpen(false);
  };

  const confirmRecalculation = async () => {
    if (recalculationLoading) return;
    setRecalculationLoading(true);
    setRecalculationError(null);
    onRecalculationStart();
    try {
      const result = await dataSource.recalculate();
      setDiagnostics(result.diagnostics);
      setConfirmationOpen(false);
      restoreTriggerFocusRef.current = true;
      onDataRecalculated(result.sessions);
    } catch (error) {
      setRecalculationError(translateApiError(error, key => t(key as never), t("rates.recalculationError")));
      onRecalculationError();
    } finally {
      setRecalculationLoading(false);
    }
  };

  return (
       <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget && !recalculationLoading) onClose(); }}>
      <div className="panel" ref={dialogRef} style={{ width: 680, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby="rates-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 id="rates-title" style={{ margin: 0, fontSize: 16 }}>{t("rates.title")}</h2>
            <button onClick={onClose} disabled={recalculationLoading} aria-label={t("rates.close")} className="modal-close">×</button>
        </div>

        <section aria-labelledby="configured-rates-title">
           <h3 id="configured-rates-title" style={{ fontSize: 14, margin: "0 0 8px" }}>{t("rates.availableTitle")}</h3>
           {(ratesLoading || !sourceIsCurrent) && <p role="status" style={{ color: "var(--muted)", fontSize: 13 }}>{t("rates.configuredLoading")}</p>}
          {sourceIsCurrent && ratesError && <p role="alert" style={{ color: "var(--error)", fontSize: 13 }}>{t(ratesError, { defaultValue: ratesError })}</p>}
          {sourceIsCurrent && !ratesLoading && !ratesError && rates.length === 0 && (
             <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("rates.configuredEmpty")}</p>
          )}
          {sourceIsCurrent && !ratesLoading && !ratesError && rates.length > 0 && (
             <div className="rates-table-scroll" role="region" tabIndex={0} aria-label={t("rates.ratesRegion")}>
            <table style={{ minWidth: 760, width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <caption style={{ textAlign: "left", paddingBottom: 6 }}>{t("rates.availableCaption")}</caption>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                 <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500 }}>{t("rates.provider")}</th>
                 <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500 }}>{t("rates.model")}</th>
                 <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>{t("rates.inputRate")}</th>
                 <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>{t("rates.outputRate")}</th>
                 <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>{t("rates.cacheRead")}</th>
                 <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500, textAlign: "right" }}>{t("rates.cacheWrite")}</th>
                 <th scope="col" style={{ padding: "6px 10px", color: "var(--muted)", fontWeight: 500 }}>{t("rates.source")}</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "7px 10px" }}>{r.provider}</td>
                  <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{r.model}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtRate(r.input)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtRate(r.output)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtRate(r.cacheRead)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtRate(r.cacheWrite)}</td>
                    <td style={{ padding: "7px 10px" }}><span className="badge">{t(r.source === "configured" ? "rates.configuredSource" : "rates.catalogSource")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          )}
        </section>

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
          {confirmationOpen && (
            <div className="panel" aria-labelledby="recalculation-confirmation-title" style={{ marginTop: 12 }}>
              <h4 id="recalculation-confirmation-title" style={{ margin: "0 0 8px" }}>{t("rates.confirmationTitle")}</h4>
              <p role="status" aria-live="polite">{t("rates.confirmationTitle")}</p>
              <p>{t("rates.confirmationDescription", { count: formatNumber(recalculableMessages, language) })}</p>
              <div className="modal-actions">
                <button type="button" onClick={cancelRecalculation} disabled={recalculationLoading}>{t("rates.cancelRecalculation")}</button>
                <button ref={confirmationButtonRef} type="button" onClick={confirmRecalculation} disabled={recalculationLoading}>{recalculationLoading ? t("rates.recalculating") : t("rates.confirmRecalculation")}</button>
              </div>
            </div>
          )}
          {!confirmationOpen && (
            <button ref={recalculationTriggerRef} type="button" onClick={requestRecalculation} disabled={recalculationLoading || !sourceIsCurrent || !catalogStatus}>
              {t("rates.recalculate")}
            </button>
          )}
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

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
           <button onClick={onClose} disabled={recalculationLoading} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: recalculationLoading ? "var(--disabled-text)" : "var(--control-text)", cursor: recalculationLoading ? "not-allowed" : "pointer" }}>{t("rates.closeButton")}</button>
        </div>
      </div>
    </div>
  );
}
