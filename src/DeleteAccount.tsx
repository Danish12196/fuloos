import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { errorMessage } from "./domain";

const CONFIRM_WORD = "DELETE";

export function DeleteAccountDialog({
  email,
  onClose,
  onDelete,
}: {
  email: string;
  onClose: () => void;
  onDelete: (progress: (step: string) => void) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (typed.trim() !== CONFIRM_WORD) return;
    setBusy(true);
    setError("");
    try {
      await onDelete(setStep);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      setStep("");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="delete-account-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">ACCOUNT</span>
          <h2 id="delete-account-title">Delete my account</h2>
        </div>
        <button
          disabled={busy}
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={21} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="error">
          This permanently deletes <b>{email}</b> and everything in it:
          accounts, categories, transactions, recurring schedules, budgets, CSV
          presets and AI suggestion data. It can't be undone.
        </div>
        <label>
          Type {CONFIRM_WORD} to confirm
          <input
            autoFocus
            autoComplete="off"
            value={typed}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        {step && <p className="form-hint">{step}</p>}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="primary danger"
            disabled={busy || typed.trim() !== CONFIRM_WORD}
          >
            {busy ? "Deleting…" : "Delete everything"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
