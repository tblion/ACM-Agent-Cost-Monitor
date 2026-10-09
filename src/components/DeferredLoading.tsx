// Renders localized loading placeholders for deferred content.
import { useTranslation } from "react-i18next";

type DeferredLoadingProps = {
  variant: "dashboard" | "modal";
};

export function DeferredLoading({ variant }: DeferredLoadingProps) {
  const { t } = useTranslation();

  return (
    <div className={`deferred-loading deferred-loading-${variant}`} role="status" aria-live="polite">
      <span className="deferred-loading-indicator" aria-hidden="true" />
      <span>{t("app.deferredLoading")}</span>
    </div>
  );
}
