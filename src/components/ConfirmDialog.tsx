import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { getFocusTrapTarget } from "../lib/rates";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  returnFocusRef,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  const focusables = () => dialogRef.current
    ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(element => !element.hasAttribute("disabled"))
    : [];

  const canRestoreFocus = (element: HTMLElement | null) => Boolean(
    element?.isConnected && !element.hasAttribute("disabled") && element.tabIndex >= 0,
  );

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('[role="dialog"]') !== dialogRef.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancelRef.current();
      return;
    }
    if (event.key === "Tab") {
      const target = getFocusTrapTarget(focusables(), document.activeElement, event.shiftKey);
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        target.focus();
      }
    }
  };

  useEffect(() => {
    previousFocusRef.current = returnFocusRef?.current ?? document.activeElement as HTMLElement | null;
    focusables()[0]?.focus();
    return () => {
      if (canRestoreFocus(previousFocusRef.current)) previousFocusRef.current?.focus();
    };
  }, [returnFocusRef]);

  return (
    <div className="modal-overlay">
      <div
        className="panel"
        style={{ maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto" }}
        ref={dialogRef}
        onKeyDownCapture={handleKeyDownCapture}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
        </div>
        <p id={descriptionId}>{description}</p>
        <div className="modal-actions" style={{ gap: 8 }}>
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
