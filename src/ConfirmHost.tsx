import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { currentConfirm, settleConfirm, subscribeConfirm } from "./dialogStore";

/** Renders queued confirmDialog() requests as a centred, themed modal. */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, currentConfirm);
  if (!request) return null;
  return <ConfirmModal key={request.id} request={request} />;
}

function ConfirmModal({
  request,
}: {
  request: NonNullable<ReturnType<typeof currentConfirm>>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const danger = request.tone === "danger";

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!el.open) el.showModal();
    // Destructive actions start on Cancel so a stray Enter can't delete.
    (danger ? cancelButton : confirmButton).current?.focus();
    return () => {
      if (el.open) el.close();
    };
  }, [danger]);

  const answer = (ok: boolean) => settleConfirm(request.id, ok);
  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <dialog
      ref={dialog}
      className={`modal confirm-modal${danger ? " danger" : ""}`}
      role="alertdialog"
      aria-labelledby={`confirm-title-${request.id}`}
      aria-describedby={
        request.message ? `confirm-message-${request.id}` : undefined
      }
      onCancel={(e) => {
        e.preventDefault();
        answer(false);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) answer(false);
      }}
    >
      <span className="confirm-icon" aria-hidden="true">
        <Icon size={24} />
      </span>
      <h2 id={`confirm-title-${request.id}`}>{request.title}</h2>
      {request.message && (
        <p id={`confirm-message-${request.id}`}>{request.message}</p>
      )}
      <div className="confirm-actions">
        <button
          ref={cancelButton}
          type="button"
          className="secondary"
          onClick={() => answer(false)}
        >
          {request.cancelLabel}
        </button>
        <button
          ref={confirmButton}
          type="button"
          className={`primary${danger ? " danger" : ""}`}
          onClick={() => answer(true)}
        >
          {request.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
