import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import licenseText from "../../LICENSE?raw";
import { getFocusTrapTarget } from "../lib/rates";

export function AboutModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const handleExternalLink = (url: string) => {
    const fallback = () => {
      window.open(url, "_blank", "noopener,noreferrer");
    };

    try {
      if (typeof openUrl !== "function") {
        fallback();
        return;
      }
      void Promise.resolve(openUrl(url)).catch(fallback);
    } catch {
      fallback();
    }
  };

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => dialogRef.current
      ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(element => !element.hasAttribute("disabled"))
      : [];
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const target = getFocusTrapTarget(focusables(), document.activeElement, event.shiftKey);
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="modal-overlay"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="panel about-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div className="modal-heading">
          <h2 id="about-title">{t("about.title")}</h2>
          <button onClick={onClose} aria-label={t("about.close")} className="modal-close">×</button>
        </div>
        <p>{t("about.description")}</p>
        <div className="about-links">
          <a
            href="https://github.com/tblion/OpencodeCostsViewer"
            target="_blank"
            rel="noopener noreferrer"
            onClick={event => {
              event.preventDefault();
              handleExternalLink("https://github.com/tblion/OpencodeCostsViewer");
            }}
          >
            {t("about.repositoryLink")}
          </a>
          <a
            href="https://github.com/tblion/OpencodeCostsViewer/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            onClick={event => {
              event.preventDefault();
              handleExternalLink("https://github.com/tblion/OpencodeCostsViewer/blob/main/LICENSE");
            }}
          >
            {t("about.licenseLink")}
          </a>
        </div>
        <section className="about-license" aria-labelledby="about-license-title">
          <h3 id="about-license-title">{t("about.licenseTitle")}</h3>
          <pre tabIndex={0} className="about-license-text">{licenseText}</pre>
        </section>
        <div className="modal-actions">
          <button onClick={onClose}>{t("about.closeButton")}</button>
        </div>
      </div>
    </div>
  );
}
