import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { errorMessage, type Category } from "./domain";
import type { CategoryDeletionPlan } from "./categoryDeletion";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

const UNCATEGORISED = "";
const SHOWN_NAMES = 6;

/**
 * Confirms deleting one or more categories. Their transactions and recurring
 * schedules are moved (to another category or to uncategorized), and their
 * budgets are deleted. Built on the shared confirm dialog's shell and classes.
 */
export function DeleteCategoriesDialog({
  categories,
  plan,
  remaining,
  onClose,
  onDelete,
}: {
  categories: Category[];
  plan: CategoryDeletionPlan;
  /** Categories that are not being deleted, offered as the move target. */
  remaining: Category[];
  onClose: () => void;
  onDelete: (target: string | null) => Promise<void> | void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState(UNCATEGORISED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  // If the chosen target disappears (e.g. a reload), fall back to uncategorized.
  useEffect(() => {
    if (target && !remaining.some((c) => c.id === target))
      setTarget(UNCATEGORISED);
  }, [remaining, target]);
  const close = () => {
    if (!busy) onClose();
  };
  const count = categories.length;
  const txCount = plan.transactionIds.length;
  const recurringCount = plan.recurringIds.length;
  const budgetCount = plan.budgetIds.length;
  const single = count === 1 ? categories[0] : null;
  const targetName =
    remaining.find((c) => c.id === target)?.name ?? "Uncategorized";
  const these = single ? "this category" : "these categories";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !count) return;
    setBusy(true);
    setError("");
    try {
      await onDelete(target || null);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  const names = categories.slice(0, SHOWN_NAMES);
  return (
    <dialog
      ref={dialog}
      className="modal confirm-modal danger typed-confirm delete-categories"
      role="alertdialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="delete-categories-title"
      aria-describedby="delete-categories-message"
    >
      <span className="confirm-icon" aria-hidden="true">
        <AlertTriangle size={24} />
      </span>
      <h2 id="delete-categories-title">
        {single ? `Delete ${single.name}?` : `Delete ${count} categories?`}
      </h2>
      <form onSubmit={submit}>
        <div id="delete-categories-message">
          {!single && (
            <ul className="delete-categories-names" aria-label="Categories">
              {names.map((c) => (
                <li key={c.id}>
                  <span aria-hidden="true">{c.emoji || "•"}</span> {c.name}
                </li>
              ))}
              {count > names.length && (
                <li className="more">+{count - names.length} more</li>
              )}
            </ul>
          )}
          <ul className="typed-confirm-list">
            <li>
              {txCount
                ? `${plural(txCount, "transaction")} use ${these}. They won't be deleted; they'll move to ${targetName}.`
                : `No transactions use ${these}.`}
            </li>
            {recurringCount > 0 && (
              <li>
                {plural(recurringCount, "recurring schedule")} will also move to{" "}
                {targetName}.
              </li>
            )}
            <li className={budgetCount ? "danger-text" : undefined}>
              {budgetCount
                ? `${plural(budgetCount, "budget")} for ${these} will be deleted.`
                : `No budgets are set for ${these}.`}
            </li>
          </ul>
          {(txCount > 0 || recurringCount > 0) && (
            <label>
              <span>Move transactions and schedules to</span>
              <select
                value={target}
                disabled={busy}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value={UNCATEGORISED}>Uncategorized</option>
                {remaining.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji ? `${c.emoji} ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
                ? "Delete category"
                : `Delete ${count} categories`}
          </button>
        </div>
      </form>
    </dialog>
  );
}
