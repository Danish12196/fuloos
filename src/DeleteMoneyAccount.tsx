import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { errorMessage, type Account } from "./domain";
import {
  confirmsAccountDeletion,
  deleteAccountPhrase,
  type AccountDeletionPlan,
} from "./accountDeletion";

const DELETE_COUNTDOWN_SECONDS = 5;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Confirms deleting a money account (and all its transactions) by typing its name. */
export function DeleteMoneyAccountDialog({
  account,
  plan,
  onClose,
  onDelete,
}: {
  account: Account;
  plan: AccountDeletionPlan;
  onClose: () => void;
  onDelete: (progress: (step: string) => void) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const phrase = deleteAccountPhrase(account.name);
  const confirmed = confirmsAccountDeletion(typed, account.name);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  // After confirming, deletion waits a few seconds so a mistaken click can still be stopped.
  const [countdown, setCountdown] = useState<number | null>(null);
  const counting = countdown !== null;
  const cancelButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    if (counting) setCountdown(null);
    else if (!busy) onClose();
  };
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      void runDelete();
      return;
    }
    const timer = setTimeout(
      () => setCountdown((c) => (c === null ? null : c - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [countdown]);
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmed || busy || counting) return;
    setError("");
    setCountdown(DELETE_COUNTDOWN_SECONDS);
    // The input is locked during the countdown, so put focus on the way out.
    setTimeout(() => cancelButton.current?.focus());
  }
  async function runDelete() {
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
  const count = plan.transactionIds.length;
  // Same shell and classes as the app's shared confirm dialog (ConfirmHost) so the styles match.
  return (
    <dialog
      ref={dialog}
      className="modal confirm-modal danger typed-confirm"
      role="alertdialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="delete-money-account-title"
      aria-describedby="delete-money-account-message"
    >
      <span className="confirm-icon" aria-hidden="true">
        <AlertTriangle size={24} />
      </span>
      <h2 id="delete-money-account-title">Delete {account.name}?</h2>
      <form onSubmit={submit}>
        <div id="delete-money-account-message">
          <p className="typed-confirm-warning">
            All transactions relating to this account will be deleted.
          </p>
          <p>This will permanently delete:</p>
          <ul className="typed-confirm-list">
            <li>
              The account <b>{account.name}</b>
            </li>
            <li>
              {count
                ? `${plural(count, "transaction")} on this account`
                : "No transactions (this account has none)"}
            </li>
            {plan.transferCount > 0 && (
              <li>
                Including {plural(plan.transferCount, "transfer")} to or from
                other accounts, which also disappear from those accounts and
                change their balances
              </li>
            )}
            {plan.recurringIds.length > 0 && (
              <li>
                {plural(plan.recurringIds.length, "recurring schedule")} on this
                account
              </li>
            )}
          </ul>
          <p>This can't be undone.</p>
        </div>
        <label>
          <span>
            Type <b className="confirm-phrase">{phrase}</b> to confirm
          </span>
          <input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder={phrase}
            value={typed}
            disabled={busy || counting}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        {counting && (
          <p className="typed-confirm-countdown" role="status">
            Deleting in {countdown}… Press Cancel to stop.
          </p>
        )}
        {step && <p className="form-hint">{step}</p>}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
            ref={cancelButton}
          >
            {counting ? `Cancel (${countdown})` : "Cancel"}
          </button>
          <button
            className="primary danger"
            disabled={busy || counting || !confirmed}
          >
            {busy
              ? "Deleting…"
              : counting
                ? `Deleting in ${countdown}…`
                : "Delete account"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
