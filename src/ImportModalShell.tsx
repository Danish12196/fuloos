import type { ReactNode, RefObject } from "react";

export function ImportModalShell({
  dialogRef,
  className,
  titleId,
  eyebrow,
  title,
  closeLabel,
  busy,
  onClose,
  children,
  actions,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  className: string;
  titleId: string;
  eyebrow: string;
  title: string;
  closeLabel: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      className={className}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          onClick={onClose}
          aria-label={closeLabel}
        >
          ×
        </button>
      </div>
      <div className="csv-body">{children}</div>
      <div className="modal-actions">{actions}</div>
    </dialog>
  );
}
