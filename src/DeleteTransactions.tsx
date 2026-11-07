import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import {
  errorMessage,
  money,
  type Account,
  type Category,
  type Transaction,
} from "./domain";
import { deletionTotals, type TransactionDeletionPlan } from "./transactionDeletion";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

const SHOWN_ROWS = 5;

/**
 * Confirms deleting one or more transactions. Built on the shared confirm
 * dialog's shell and classes, like the bulk category delete.
 */
export function DeleteTransactionsDialog({
  transactions,
  plan,
  accounts,
  categories,
  hidden,
  onClose,
  onDelete,
}: {
  /** The transactions being deleted, newest first. */
  transactions: Transaction[];
  plan: TransactionDeletionPlan;
  accounts: Account[];
  categories: Category[];
  /** Hide amounts, as the rest of the app does. */
  hidden: boolean;
  onClose: () => void;
  /** Starts the deletion; it runs in the background queue and the dialog closes. */
  onDelete: () => Promise<void> | void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  const count = plan.transactionIds.length;
  const single = count === 1;
  const transferCount = plan.transferIds.length;
  const occurrenceCount = plan.occurrenceIds.length;
  const accountName = (id: string | null) =>
    accounts.find((a) => a.id === id)?.name ?? "Unknown account";
  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "Uncategorized";
  const show = (fils: number) => (hidden ? "••••" : money(fils));
  const totals = deletionTotals(transactions);
  const affectedAccounts = plan.accountIds.map((id) => accountName(id));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !count) return;
    setBusy(true);
    setError("");
    try {
      await onDelete();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const rows = transactions.slice(0, SHOWN_ROWS);
  const moneyParts = [
    totals.expense && `${show(totals.expense)} spent`,
    totals.income && `${show(totals.income)} received`,
    totals.transfer && `${show(totals.transfer)} moved between accounts`,
  ].filter(Boolean);

  return (
    <dialog
      ref={dialog}
      className="modal confirm-modal danger typed-confirm delete-categories delete-transactions"
      role="alertdialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="delete-transactions-title"
      aria-describedby="delete-transactions-message"
    >
      <span className="confirm-icon" aria-hidden="true">
        <AlertTriangle size={24} />
      </span>
      <h2 id="delete-transactions-title">
        {single
          ? "Delete this transaction?"
          : `Delete ${count.toLocaleString()} transactions?`}
      </h2>
      <form onSubmit={submit}>
        <div id="delete-transactions-message">
          <ul className="delete-transactions-rows" aria-label="Transactions">
            {rows.map((t) => (
              <li key={t.id}>
                <span className="when">{t.date}</span>
                <span className="what">
                  <b>{t.payee || categoryName(t.category_id)}</b>
                  <small>
                    {t.type === "transfer" ? (
                      <>
                        {accountName(t.account_id)}{" "}
                        <ArrowRight size={11} aria-label="to" />{" "}
                        {accountName(t.to_account_id)}
                      </>
                    ) : (
                      accountName(t.account_id)
                    )}
                  </small>
                </span>
                <span className={`amount ${t.type}`}>
                  {t.type === "expense" ? "−" : t.type === "income" ? "+" : ""}
                  {show(t.amount)}
                </span>
              </li>
            ))}
            {count > rows.length && (
              <li className="more">
                +{(count - rows.length).toLocaleString()} more
              </li>
            )}
          </ul>
          <ul className="typed-confirm-list">
            {moneyParts.length > 0 && (
              <li>
                {single ? "It covers " : "Together they cover "}
                {moneyParts.join(", ")}.
              </li>
            )}
            {transferCount > 0 && (
              <li>
                {single
                  ? "This is a transfer. It shows in both accounts but is one record, so both sides go."
                  : transferCount === 1
                    ? "1 is a transfer. It shows in both of its accounts but is one record, so both sides go together."
                    : `${transferCount.toLocaleString()} are transfers. Each shows in both of its accounts but is one record, so both sides go together.`}
              </li>
            )}
            {occurrenceCount > 0 && (
              <li>
                {plural(
                  occurrenceCount,
                  "was recorded for a recurring schedule",
                  "were recorded for recurring schedules",
                )}
                . Those payments will show as not recorded yet; the schedules
                stay.
              </li>
            )}
            {affectedAccounts.length > 0 && (
              <li className="danger-text">
                Balances will change for {affectedAccounts.join(", ")}.
              </li>
            )}
          </ul>
          <p className="delete-categories-final">This can't be undone.</p>
        </div>
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
          <button className="primary danger" disabled={busy || !count}>
            {busy
              ? "Deleting…"
              : single
                ? "Delete transaction"
                : `Delete ${count.toLocaleString()} transactions`}
          </button>
        </div>
      </form>
    </dialog>
  );
}
