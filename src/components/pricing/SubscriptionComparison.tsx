// Shows public subscription prices as references without changing recorded spending.
import { useState, type MouseEvent } from "react";
import { getPricingCandidates } from "../../api";
import type { FixedSubscription, PricingComparisonResult } from "../../types";
import { formatNumber } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";
import { translateApiError } from "../../api";
import { useTranslation } from "react-i18next";

interface Props { subscriptions: FixedSubscription[]; }

export function SubscriptionComparison({ subscriptions }: Props) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const [result, setResult] = useState<PricingComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compare = async () => {
    const keys = subscriptions.filter(subscription => subscription.provider.trim() && subscription.name?.trim())
      .map(subscription => ({ kind: "subscription" as const, provider: subscription.provider, model: subscription.name!.trim() }));
    if (keys.length === 0) {
      setError(t("rates.subscriptionNameRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResult(await getPricingCandidates(keys));
    } catch (caught) {
      setError(translateApiError(caught, key => t(key as never), t("rates.comparisonError")));
    } finally {
      setLoading(false);
    }
  };

  const openSource = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    if (!window.desktopApi) return;
    event.preventDefault();
    void window.desktopApi.openExternalUrl(url).catch(caught =>
      setError(translateApiError(caught, key => t(key as never), t("rates.comparisonError"))));
  };

  return (
    <section className="subscription-comparison" aria-labelledby="subscription-comparison-title">
      <div className="pricing-comparison-heading">
        <div>
          <h3 id="subscription-comparison-title">{t("rates.subscriptionComparisonTitle")}</h3>
          <p>{t("rates.subscriptionComparisonDescription")}</p>
        </div>
        <button type="button" onClick={() => void compare()} disabled={loading}>
          {loading ? t("rates.comparisonLoading") : t("rates.compareSubscriptions")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {result && <div role="region" aria-label={t("rates.subscriptionComparisonRegion")} className="subscription-comparison-results">
        <p>{t("rates.subscriptionActualPaymentNote")}</p>
        {result.sources.map(source => <section key={source.sourceId} className="pricing-source">
          <header>
            <h4>{source.sourceName}</h4>
            <span className={`pricing-source-status is-${source.status}`}>
              {source.status === "available" ? t("rates.sourceAvailable") : t("rates.sourceUnavailable")}
            </span>
            <a href={source.sourceUrl} target="_blank" rel="noreferrer" onClick={event => openSource(event, source.sourceUrl)}>
              {t("rates.sourceLink", { source: source.sourceName })}
            </a>
          </header>
          {source.error && <p role="alert">{t("rates.sourceError", { error: source.error })}</p>}
          {source.candidates.length > 0 ? <ul className="subscription-candidate-list">
            {source.candidates.map(candidate => <li key={`${candidate.provider}:${candidate.model}`}>
              <strong>{candidate.provider} / {candidate.model}</strong>
              <span>{candidate.input === null ? t("rates.priceNotPublished") : `${formatNumber(candidate.input, language)} ${candidate.currency} / ${candidate.unit}`}</span>
              <span>{candidate.region ?? t("rates.regionUnknown")}</span>
              <span>{t("rates.subscriptionTaxesUnknown")}</span>
              <span>{t(`rates.match_${candidate.matchStatus}`)}</span>
              <ul>{candidate.confidenceReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            </li>)}
          </ul> : source.status === "available" ? <p>{t("rates.sourceNoCandidates")}</p> : null}
        </section>)}
      </div>}
    </section>
  );
}
