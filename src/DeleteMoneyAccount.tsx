import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { errorMessage, type Account } from "./domain";
import {
  confirmsAccountDeletion,
  deleteAccountPhrase,
  type AccountDeletionPlan,
} from "./accountDeletion";

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
  const close = () => {
    if (!busy) onClose();
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmed || busy) return;
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
          <p>
            {count
              ? `That is ${plural(count, "transaction")} on ${account.name}.`
              : `${account.name} has no transactions yet.`}
            {plan.transferCount > 0 &&
              ` This includes ${plural(plan.transferCount, "transfer")} to or from other accounts, which will disappear from those accounts too and change their balances.`}
            {plan.recurringIds.length > 0 &&
              ` ${plural(plan.recurringIds.length, "recurring schedule")} on this account will also be deleted.`}{" "}
            This can't be undone.
          </p>
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
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button className="primary danger" disabled={busy || !confirmed}>
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
