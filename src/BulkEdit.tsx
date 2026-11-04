import { useMemo, useRef, useState, useEffect } from "react";
import { X } from "lucide-react";
import { editTransaction, type BulkChanges } from "./bulk";
import type { Kind, Ledger, Transaction } from "./domain";
import { ImportProgress } from "./ImportProgress";

export function BulkEdit({
  items,
  ledger,
  onClose,
  onApply,
}: {
  items: Transaction[];
  ledger: Ledger;
  onClose: () => void;
  onApply: (
    rows: Transaction[],
    progress: (records: Transaction[]) => void,
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [changes, setChanges] = useState<BulkChanges>({});
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function change(next: BulkChanges) {
    setChanges(next);
    setReview(false);
    setError("");
  }
  const preview = useMemo(
    () =>
      items
        .filter((t) => !completed.has(t.id))
        .map((t) => {
          try {
            return {
              before: t,
              after: editTransaction(t, changes, ledger),
              error: "",
            };
          } catch (e) {
            return {
              before: t,
              after: null,
              error: e instanceof Error ? e.message : "Invalid transaction",
            };
          }
        }),
    [items, completed, changes, ledger],
  );
  const invalid = preview.filter((p) => p.error).length;
  const hasChanges = Object.values(changes).some(
    (value) => value !== undefined,
  );
  async function apply() {
    if (!review || invalid || !hasChanges || busy || uncertain) return;
    setBusy(true);
    setError("");
    try {
      await onApply(
        preview.map((p) => p.after!),
        (records) =>
          setCompleted((old) => new Set([...old, ...records.map((t) => t.id)])),
      );
      onClose();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not update transactions.";
      setError(message);
      if (/Reload the ledger|may have been saved/i.test(message))
        setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  const accountName = (id: string | null) =>
    ledger.accounts.find((a) => a.id === id)?.name ?? "Choose account";
  const categoryName = (id: string | null) =>
    ledger.categories.find((c) => c.id === id)?.name ?? "Uncategorized";
  function describe(t: Transaction) {
    return `${t.type} · ${accountName(t.account_id)}${t.type === "transfer" ? ` → ${accountName(t.to_account_id)}` : ` · ${categoryName(t.category_id)}`} · ${t.date} · ${t.payee || "No description"} · Notes: ${t.notes || "None"}`;
  }
  return (
    <dialog
      ref={dialog}
      className="modal csv-modal bulk-modal"
      aria-labelledby="bulk-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id="bulk-title">Edit {items.length} transactions</h2>
          <p>Choose the fields to update. Amounts stay as they are.</p>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          aria-label="Close bulk editor"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="csv-body">
        <fieldset
          disabled={busy || completed.size > 0 || uncertain}
          className="bulk-fields"
        >
          <label>
            Transaction type
            <select
              value={changes.type ?? ""}
              onChange={(e) =>
                change({
                  ...changes,
                  type: (e.target.value as Kind) || undefined,
                })
              }
            >
              <option value="">Keep each type</option>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
            </select>
          </label>
          <label>
            Account / transfer source
            <select
              value={changes.account_id ?? ""}
              onChange={(e) =>
                change({ ...changes, account_id: e.target.value || undefined })
              }
            >
              <option value="">Keep each account</option>
              {ledger.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Transfer destination
            <select
              value={changes.to_account_id ?? ""}
              onChange={(e) =>
                change({
                  ...changes,
                  to_account_id: e.target.value || undefined,
                })
              }
            >
              <option value="">Keep each destination</option>
              {ledger.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={
                changes.category_id === null
                  ? "clear"
                  : (changes.category_id ?? "")
              }
              onChange={(e) =>
                change({
                  ...changes,
                  category_id:
                    e.target.value === "clear"
                      ? null
                      : e.target.value || undefined,
                })
              }
            >
              <option value="">Keep each category</option>
              <option value="clear">Uncategorized</option>
              {ledger.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={changes.date ?? ""}
              onChange={(e) =>
                change({ ...changes, date: e.target.value || undefined })
              }
            />
            <small>Leave blank to keep each date.</small>
          </label>
          <label className="csv-check">
            <input
              type="checkbox"
              checked={changes.payee !== undefined}
              onChange={(e) =>
                change({ ...changes, payee: e.target.checked ? "" : undefined })
              }
            />
            Update description
          </label>
          {changes.payee !== undefined && (
            <label>
              Description
              <input
                maxLength={160}
                value={changes.payee}
                onChange={(e) => change({ ...changes, payee: e.target.value })}
              />
              <small>An empty value clears descriptions.</small>
            </label>
          )}
          <label>
            Notes
            <select
              value={changes.notes?.mode ?? ""}
              onChange={(e) =>
                change({
                  ...changes,
                  notes: e.target.value
                    ? {
                        mode: e.target.value as "replace" | "append",
                        text: changes.notes?.text ?? "",
                      }
                    : undefined,
                })
              }
            >
              <option value="">Keep each note</option>
              <option value="replace">Replace notes (blank clears)</option>
              <option value="append">Append to notes</option>
            </select>
          </label>
          {changes.notes && (
            <label>
              Note text
              <textarea
                maxLength={1000}
                value={changes.notes.text}
                onChange={(e) =>
                  change({
                    ...changes,
                    notes: { ...changes.notes!, text: e.target.value },
                  })
                }
              />
            </label>
          )}
        </fieldset>
        <p className="form-hint">
          Transfers need different source and destination accounts. Converting
          to a transfer clears its category; converting away from a transfer
          clears its destination. Changes save in batches of up to 100; earlier
          completed batches stay saved if a later batch fails.
        </p>
        {review && (
          <section aria-label="Bulk edit preview">
            <h3>
              Review changes · {preview.length} remaining
              {invalid ? ` · ${invalid} need attention` : ""}
            </h3>
            {preview.map((p) => (
              <div className="bulk-preview-row" key={p.before.id}>
                <b>{p.before.payee || "Transaction"}</b>
                <p>Before: {describe(p.before)}</p>
                {p.after ? (
                  <p>After: {describe(p.after)}</p>
                ) : (
                  <p className="error">{p.error}</p>
                )}
              </div>
            ))}
          </section>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {uncertain && (
          <p>
            Close this editor and reload your workspace before making more
            changes.
          </p>
        )}
      </div>
      <div className="modal-actions">
        {(busy || completed.size > 0) && (
          <ImportProgress
            label="Updating transactions"
            value={completed.size}
            total={items.length}
          />
        )}
        <button className="secondary" disabled={busy} onClick={onClose}>
          Close
        </button>
        {!review ? (
          <button
            className="primary"
            disabled={busy || !hasChanges || uncertain}
            onClick={() => setReview(true)}
          >
            Review changes
          </button>
        ) : (
          <button
            className="primary"
            disabled={
              busy || !!invalid || !preview.length || !hasChanges || uncertain
            }
            onClick={() => void apply()}
          >
            {busy ? "Updating…" : `Apply to ${preview.length} transactions`}
          </button>
        )}
      </div>
    </dialog>
  );
}

