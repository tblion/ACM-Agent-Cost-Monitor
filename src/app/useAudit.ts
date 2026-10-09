// Tracks audit visibility, freshness, and report generations.
import { useEffect, useRef, useState } from "react";

export function useAudit() {
  const [showAudit, setShowAudit] = useState(false);
  const [auditStale, setAuditStale] = useState(false);
  const [auditGeneration, setAuditGeneration] = useState(0);
  const auditButtonRef = useRef<HTMLButtonElement>(null);
  const dashboardMainRef = useRef<HTMLElement>(null);
  const auditContentRef = useRef<HTMLDivElement>(null);
  const auditWasOpenRef = useRef(false);
  const auditGenerationRef = useRef(0);

  const markAuditStale = () => {
    auditGenerationRef.current += 1;
    setAuditGeneration(auditGenerationRef.current);
    setAuditStale(true);
  };

  useEffect(() => {
    if (showAudit) {
      auditContentRef.current?.focus();
    } else if (auditWasOpenRef.current) {
      if (auditButtonRef.current) auditButtonRef.current.focus();
      else dashboardMainRef.current?.focus();
    }
    auditWasOpenRef.current = showAudit;
  }, [showAudit]);

  return {
    showAudit,
    setShowAudit,
    auditStale,
    setAuditStale,
    auditGeneration,
    auditGenerationRef,
    markAuditStale,
    auditButtonRef,
    dashboardMainRef,
    auditContentRef,
  };
}
