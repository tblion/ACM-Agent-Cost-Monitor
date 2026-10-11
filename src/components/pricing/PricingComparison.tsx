// Compares public pricing candidates without changing active rates until confirmation.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { getCatalogRates, getPricingCandidates, getSettings, saveSettings } from "../../api";
import type { PricingCandidate, PricingComparisonResult, RateEntry } from "../../types";
import { formatNumber } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";
import { translateApiError } from "../../api";
import { useTranslation } from "react-i18next";

interface Props {
  rates: RateEntry[];
  onApplied: () => Promise<void>;
}

function selectionKey(candidate: PricingCandidate): string {
  return `${candidate.sourceId}\u0000${candidate.provider}\u0000${candidate.model}`;
}

function money(value: number | null, language: "fr" | "en"): string {
  return value === null ? "—" : `${formatNumber(value, language)} USD`;
}

export function PricingComparison({ rates, onApplied }: Props) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const [result, setResult] = useState<PricingComparisonResult | null>(null);
  const [comparisonRates, setComparisonRates] = useState<RateEntry[]>(rates);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const applyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmationOpen && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (!confirmationOpen && dialog.open) {
      dialog.close();
      applyButtonRef.current?.focus();
    }
  }, [confirmationOpen]);

  const exactCandidates = useMemo(
    () => result?.sources.flatMap(source => source.candidates.filter(candidate => candidate.matchStatus === "exact")) ?? [],
    [result],
  );
  const selected = exactCandidates.find(candidate => selectionKey(candidate) === selectedKey) ?? null;
  const activeRate = selected && comparisonRates.find(rate => rate.provider.toLocaleLowerCase() === selected.provider.toLocaleLowerCase()
    && rate.model.toLocaleLowerCase() === selected.model.toLocaleLowerCase());
  const hasDisagreement = selected && exactCandidates.some(candidate => candidate.provider === selected.provider
    && candidate.model === selected.model
    && (candidate.input !== selected.input || candidate.output !== selected.output
      || candidate.cacheRead !== selected.cacheRead || candidate.cacheWrite !== selected.cacheWrite));
  const canApply = selected && selected.input !== null && selected.output !== null
    && (selected.cacheRead !== null || activeRate)
    && (selected.cacheWrite !== null || activeRate);

  const compare = async () => {
    setLoading(true);
    setError(null);
    setStatus("");
    setSelectedKey(null);
    try {
      const catalogRates = await getCatalogRates();
      const allRates = [...catalogRates.filter(catalogRate => !rates.some(rate => rate.provider === catalogRate.provider && rate.model === catalogRate.model)), ...rates];
      setComparisonRates(allRates);
      const keys = [...new Map(allRates.map(rate => [`${rate.provider}\u0000${rate.model}`, {
        kind: "usage" as const, provider: rate.provider, model: rate.model,
      }])).values()];
      const comparison = await getPricingCandidates(keys);
      setResult(comparison);
      setEffectiveFrom(new Date().toISOString().slice(0, 10));
    } catch (caught) {
      setError(translateApiError(caught, key => t(key as never), t("rates.comparisonError")));
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!selected || !canApply || applying) return;
    setApplying(true);
    setError(null);
    try {
      const settings = await getSettings();
      const rate = {
        id: `online-${crypto.randomUUID()}`,
        provider: selected.provider,
        model: selected.model,
        input: selected.input!,
        output: selected.output!,
        cacheRead: selected.cacheRead ?? activeRate!.cacheRead,
        cacheWrite: selected.cacheWrite ?? activeRate!.cacheWrite,
        effectiveFrom: `${effectiveFrom}T00:00:00Z`,
        source: `online:${selected.sourceId}:${selected.sourceUrl} (verified ${selected.retrievedAt})`,
      };
      await saveSettings({ ...settings, customRates: [...settings.customRates, rate] });
      await onApplied();
      setConfirmationOpen(false);
      setSelectedKey(null);
      setStatus(t("rates.candidateApplied", { model: selected.model }));
    } catch (caught) {
      setError(translateApiError(caught, key => t(key as never), t("rates.applyCandidateError")));
    } finally {
      setApplying(false);
    }
  };

  const openSource = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    if (!window.desktopApi) return;
    event.preventDefault();
    void window.desktopApi.openExternalUrl(url).catch(caught =>
      setError(translateApiError(caught, key => t(key as never), t("rates.comparisonError"))));
  };

  return (
    <section className="pricing-comparison" aria-labelledby="pricing-comparison-title">
      <div className="pricing-comparison-heading">
        <div>
          <h3 id="pricing-comparison-title">{t("rates.comparisonTitle")}</h3>
          <p>{t("rates.comparisonDescription")}</p>
        </div>
        <button type="button" onClick={() => void compare()} disabled={loading}>
          {loading ? t("rates.comparisonLoading") : t("rates.compareSources")}
        </button>
      </div>
      {error && <p role="alert" className="pricing-comparison-error">{error}</p>}
      <p role="status" aria-live="polite">{status}</p>
      {result && (
        <>
          <p className="pricing-comparison-checked">{t("rates.lastChecked", { value: new Date(result.retrievedAt).toLocaleString(language === "fr" ? "fr-FR" : "en-US") })}</p>
          {result.sources.map(source => (
            <section className="pricing-source" key={source.sourceId} aria-labelledby={`pricing-source-${source.sourceId}`}>
              <header>
                <h4 id={`pricing-source-${source.sourceId}`}>{source.sourceName}</h4>
                <span className={`pricing-source-status is-${source.status}`}>
                  {source.status === "available" ? t("rates.sourceAvailable") : t("rates.sourceUnavailable")}
                </span>
                <a href={source.sourceUrl} target="_blank" rel="noreferrer" onClick={event => openSource(event, source.sourceUrl)}>
                  {t("rates.sourceLink", { source: source.sourceName })}
                </a>
              </header>
              {source.error && <p role="alert">{t("rates.sourceError", { error: source.error })}</p>}
              {source.candidates.length > 0 ? (
                <div className="rates-table-scroll" role="region" tabIndex={0} aria-label={t("rates.comparisonRegion", { source: source.sourceName })}>
                  <table>
                    <caption>{t("rates.comparisonCaption", { source: source.sourceName })}</caption>
                    <thead><tr>
                      <th scope="col">{t("rates.model")}</th>
                      <th scope="col">{t("rates.match")}</th>
                      <th scope="col">{t("rates.inputRate")}</th>
                      <th scope="col">{t("rates.outputRate")}</th>
                      <th scope="col">{t("rates.cacheRead")}</th>
                      <th scope="col">{t("rates.cacheWrite")}</th>
                      <th scope="col">{t("rates.currentRate")}</th>
                      <th scope="col">{t("rates.confidenceReasons")}</th>
                      <th scope="col">{t("rates.selectCandidate")}</th>
                    </tr></thead>
                    <tbody>{source.candidates.map(candidate => {
                      const current = comparisonRates.find(rate => rate.provider.toLocaleLowerCase() === candidate.provider.toLocaleLowerCase()
                        && rate.model.toLocaleLowerCase() === candidate.model.toLocaleLowerCase());
                      const selectKey = selectionKey(candidate);
                      return <tr key={selectKey}>
                        <th scope="row">{candidate.provider}/{candidate.model}<small>{candidate.currency} · {candidate.unit} · {candidate.region ?? t("rates.regionUnknown")}</small></th>
                        <td>{t(`rates.match_${candidate.matchStatus}`)}</td>
                        <td>{money(candidate.input, language)}</td>
                        <td>{money(candidate.output, language)}</td>
                        <td>{money(candidate.cacheRead, language)}</td>
                        <td>{money(candidate.cacheWrite, language)}</td>
                        <td>{current ? `${money(current.input, language)} / ${money(current.output, language)}` : t("rates.noCurrentRate")}</td>
                        <td><ul>{candidate.confidenceReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></td>
                        <td><label>
                          <input type="checkbox" checked={selectedKey === selectKey}
                            disabled={candidate.matchStatus !== "exact"}
                            onChange={() => {
                              setSelectedKey(selectedKey === selectKey ? null : selectKey);
                              setEffectiveFrom(candidate.effectiveFrom?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
                            }}
                            aria-label={t("rates.selectCandidateLabel", { source: candidate.sourceName, provider: candidate.provider, model: candidate.model })} />
                          {candidate.matchStatus === "exact" ? t("rates.select") : t("rates.manualVerification")}
                        </label></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              ) : source.status === "available" ? <p>{t("rates.sourceNoCandidates")}</p> : null}
            </section>
          ))}
          {selected && (
            <div className="pricing-selection">
              <label htmlFor="pricing-effective-date">{t("rates.candidateEffectiveFrom")}</label>
              <input id="pricing-effective-date" type="date" value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)} />
              {hasDisagreement && <p role="note">{t("rates.disagreementWarning")}</p>}
              {!canApply && <p role="note">{t("rates.candidateIncomplete")}</p>}
              <button ref={applyButtonRef} type="button" onClick={() => setConfirmationOpen(true)} disabled={!canApply}>
                {t("rates.applySelection")}
              </button>
            </div>
          )}
        </>
      )}
      <dialog ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="pricing-candidate-confirmation-title"
        onCancel={event => { event.preventDefault(); setConfirmationOpen(false); }}
        onClose={() => setConfirmationOpen(false)}>
        <h3 id="pricing-candidate-confirmation-title">{t("rates.candidateConfirmationTitle")}</h3>
        {selected && <>
          <p>{t("rates.candidateConfirmationDescription", { provider: selected.provider, model: selected.model, effectiveFrom })}</p>
          <div className="pricing-confirmation-rates">
            {(["input", "output", "cacheRead", "cacheWrite"] as const).map(field => {
              const proposed = selected[field] ?? activeRate?.[field] ?? null;
              return <p key={field}><strong>{t(`rates.${field === "input" ? "inputRate" : field === "output" ? "outputRate" : field}` as never)}</strong>
                <span>{t("rates.currentLabel")}: {money(activeRate?.[field] ?? null, language)}</span>
                <span>{t("rates.proposedLabel")}: {money(proposed, language)}</span>
              </p>;
            })}
          </div>
          <p>{t("rates.candidateUnitNote", { currency: selected.currency, unit: selected.unit, region: selected.region ?? t("rates.regionUnknown") })}</p>
        </>}
        <div className="pricing-confirmation-actions">
          <button type="button" onClick={() => setConfirmationOpen(false)} disabled={applying}>{t("rates.cancelCandidate")}</button>
          <button type="button" onClick={() => void apply()} disabled={applying || !canApply}>
            {applying ? t("rates.applyingCandidate") : t("rates.confirmCandidate")}
          </button>
        </div>
      </dialog>
    </section>
  );
}
