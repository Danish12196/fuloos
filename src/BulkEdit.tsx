import { useMemo, useRef, useState, useEffect, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Shuffle,
  X,
} from "lucide-react";
import { editTransaction, sharedFields, type BulkChanges } from "./bulk";
import { minor, type Kind, type Ledger, type Transaction } from "./domain";
import { ImportProgress } from "./ImportProgress";

/**
 * What the form holds for each field. `undefined` means "keep each row's own
 * value"; it is only possible for fields the selected rows disagree on, since
 * shared fields start prefilled with the common value.
 */
interface BulkForm {
  type?: Kind;
  amount?: string;
  account_id?: string;
  to_account_id?: string;
  category_id?: string; // "" is Uncategorized
  date?: string;
  payee?: string;
  notes?: string;
}

const KEEP = "__keep__";
const LABELS: Record<keyof BulkChanges, string> = {
  type: "type",
  amount: "amount",
  account_id: "account",
  to_account_id: "destination",
  category_id: "category",
  date: "date",
  payee: "description",
  notes: "notes",
};

function list(words: string[]) {
  return words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

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
  const shared = useMemo(() => sharedFields(items), [items]);
  const mixed = (key: keyof typeof shared) => !(key in shared);
  const [form, setForm] = useState<BulkForm>(() => ({
    type: shared.type,
    amount:
      shared.amount !== undefined
        ? (shared.amount / 100).toFixed(2)
        : undefined,
    account_id: shared.account_id,
    to_account_id: shared.to_account_id ?? undefined,
    category_id:
      "category_id" in shared ? (shared.category_id ?? "") : undefined,
    date: shared.date,
    payee: shared.payee,
    notes: shared.notes,
  }));
  const [appendNotes, setAppendNotes] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function set(next: Partial<BulkForm>) {
    setForm((old) => ({ ...old, ...next }));
    setError("");
  }

  // The type every row ends up with, or undefined when they stay mixed.
  const kind = form.type;
  const showCategory = kind
    ? kind !== "transfer"
    : items.every((t) => t.type !== "transfer");
  const showDestination = kind === "transfer";

  // Turn the form into the smallest set of changes: a field is only sent
  // when it differs from what all the rows already share.
  const { changes, amountError } = useMemo(() => {
    const next: BulkChanges = {};
    let amountError = "";
    if (form.type !== undefined && form.type !== shared.type)
      next.type = form.type;
    if (form.amount !== undefined && form.amount.trim() !== "") {
      try {
        const value = minor(form.amount);
        if (value !== shared.amount) next.amount = value;
      } catch (e) {
        amountError = e instanceof Error ? e.message : "Invalid amount";
      }
    }
    if (form.account_id !== undefined && form.account_id !== shared.account_id)
      next.account_id = form.account_id;
    if (
      showDestination &&
      form.to_account_id !== undefined &&
      form.to_account_id !== shared.to_account_id
    )
      next.to_account_id = form.to_account_id;
    if (showCategory && form.category_id !== undefined) {
      const value = form.category_id || null;
      // Converting a transfer to income/expense always resets its category,
      // so a chosen category is sent even if it matches the old (empty) one.
      if (value !== shared.category_id || (next.type && value))
        next.category_id = value;
    }
    if (form.date && form.date !== shared.date) next.date = form.date;
    if (form.payee !== undefined && form.payee.trim() !== shared.payee)
      next.payee = form.payee.trim();
    if (form.notes !== undefined) {
      const text = form.notes.trim();
      if (appendNotes && mixed("notes")) {
        if (text) next.notes = { mode: "append", text };
      } else if (text !== shared.notes) next.notes = { mode: "replace", text };
    }
    return { changes: next, amountError };
  }, [form, shared, showCategory, showDestination, appendNotes]);

  const preview = useMemo(
    () =>
      items
        .filter((t) => !completed.has(t.id))
        .map((t) => {
          try {
            return { after: editTransaction(t, changes, ledger), error: "" };
          } catch (e) {
            return {
              after: null,
              error: e instanceof Error ? e.message : "Invalid transaction",
            };
          }
        }),
    [items, completed, changes, ledger],
  );
  const invalid = preview.filter((p) => p.error);
  const changed = (Object.keys(changes) as (keyof BulkChanges)[]).map(
    (key) => LABELS[key],
  );
  const hasChanges = changed.length > 0;
  const locked = busy || completed.size > 0 || uncertain;

  async function apply(e: FormEvent) {
    e.preventDefault();
    if (!hasChanges || invalid.length || amountError || locked) return;
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

  // Small "Keep each" link beside a mixed text field the user has typed in.
  const keepLink = (key: "amount" | "date" | "payee" | "notes") =>
    mixed(key) && form[key] !== undefined && !locked ? (
      <button
        type="button"
        className="bulk-keep"
        onClick={() => set({ [key]: undefined })}
      >
        Keep each
      </button>
    ) : null;

  return (
    <dialog
      ref={dialog}
      className="modal bulk-modal"
      aria-labelledby="bulk-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2 id="bulk-title">
            Edit {items.length}{" "}
            {items.length === 1 ? "transaction" : "transactions"}
          </h2>
        </div>
        <button
          disabled={busy}
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <form onSubmit={apply}>
        <fieldset disabled={locked} className="bulk-fields">
          <div className="type-switch">
            {(["expense", "income", "transfer"] as const).map((k) => (
              <button
                type="button"
                className={kind === k ? "selected" : ""}
                key={k}
                onClick={() => set({ type: k })}
              >
                {k === "expense" ? (
                  <ArrowUpRight size={16} />
                ) : k === "income" ? (
                  <ArrowDownLeft size={16} />
                ) : (
                  <ArrowLeftRight size={16} />
                )}{" "}
                {k}
              </button>
            ))}
            {mixed("type") && (
              <button
                type="button"
                className={kind === undefined ? "selected" : ""}
                onClick={() => set({ type: undefined })}
              >
                <Shuffle size={16} /> Keep each
              </button>
            )}
          </div>
          <label>
            <span className="bulk-label">
              <span>
                Amount <span className="muted">AED</span>
              </span>
              {keepLink("amount")}
            </span>
            <input
              inputMode="decimal"
              placeholder={mixed("amount") ? "Keep each amount" : "0.00"}
              value={form.amount ?? ""}
              onChange={(e) =>
                set({
                  amount:
                    mixed("amount") && e.target.value === ""
                      ? undefined
                      : e.target.value,
                })
              }
            />
          </label>
          <div className="form-row">
            <label>
              {kind === "transfer" ? "From account" : "Account"}
              <select
                value={form.account_id ?? KEEP}
                onChange={(e) =>
                  set({
                    account_id:
                      e.target.value === KEEP ? undefined : e.target.value,
                  })
                }
              >
                {mixed("account_id") && (
                  <option value={KEEP}>Keep each account</option>
                )}
                {ledger.accounts.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {showDestination ? (
              <label>
                To account
                <select
                  value={form.to_account_id ?? KEEP}
                  onChange={(e) =>
                    set({
                      to_account_id:
                        e.target.value === KEEP ? undefined : e.target.value,
                    })
                  }
                >
                  {shared.type === "transfer" && mixed("to_account_id") ? (
                    <option value={KEEP}>Keep each destination</option>
                  ) : (
                    <option value={KEEP} disabled>
                      Choose account
                    </option>
                  )}
                  {ledger.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : showCategory ? (
              <label>
                Category
                <select
                  value={form.category_id ?? KEEP}
                  onChange={(e) =>
                    set({
                      category_id:
                        e.target.value === KEEP ? undefined : e.target.value,
                    })
                  }
                >
                  {mixed("category_id") && (
                    <option value={KEEP}>Keep each category</option>
                  )}
                  <option value="">Uncategorized</option>
                  {ledger.categories.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Category / to account
                <select disabled value={KEEP}>
                  <option value={KEEP}>Keep each</option>
                </select>
              </label>
            )}
          </div>
          {!showCategory && !showDestination && (
            <p className="form-hint">
              These include both transfers and income or expenses. Pick one type
              above to change the category or the destination account.
            </p>
          )}
          <label>
            <span className="bulk-label">
              Date
              {keepLink("date")}
            </span>
            <input
              type="date"
              value={form.date ?? ""}
              onChange={(e) =>
                set({
                  date:
                    mixed("date") && !e.target.value
                      ? undefined
                      : e.target.value,
                })
              }
            />
            {mixed("date") && form.date === undefined && (
              <small className="muted">Keep each date</small>
            )}
          </label>
          <label>
            <span className="bulk-label">
              {kind === "transfer" ? "Description" : "Payee / description"}
              {keepLink("payee")}
            </span>
            <input
              maxLength={160}
              value={form.payee ?? ""}
              placeholder={
                mixed("payee")
                  ? form.payee === undefined
                    ? "Keep each description"
                    : "Left empty, this clears every description"
                  : kind === "income"
                    ? "e.g. Monthly salary"
                    : kind === "transfer"
                      ? "e.g. Moving to savings"
                      : "e.g. Spinneys"
              }
              onChange={(e) => set({ payee: e.target.value })}
            />
          </label>
          <label>
            <span className="bulk-label">
              <span>
                Notes <span className="muted">Optional</span>
              </span>
              {keepLink("notes")}
            </span>
            <textarea
              maxLength={1000}
              value={form.notes ?? ""}
              placeholder={
                mixed("notes")
                  ? form.notes === undefined
                    ? "Keep each note"
                    : "Left empty, this clears every note"
                  : "Anything you’d like to remember"
              }
              onChange={(e) => set({ notes: e.target.value })}
            />
          </label>
          {mixed("notes") && form.notes !== undefined && (
            <label className="csv-check">
              <input
                type="checkbox"
                checked={appendNotes}
                onChange={(e) => setAppendNotes(e.target.checked)}
              />
              Add to the end of each note instead of replacing it
            </label>
          )}
        </fieldset>
        <p className="form-hint" aria-live="polite">
          {amountError ||
            (invalid.length
              ? `${invalid.length} of ${preview.length} can’t be saved like this: ${invalid[0].error}`
              : hasChanges
                ? `Changes the ${list(changed)} on ${preview.length} ${preview.length === 1 ? "transaction" : "transactions"}. Everything else stays as it is.`
                : "Fields the selected transactions share are filled in. Change any field to update them all.")}
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {uncertain && (
          <p className="form-hint">
            Close this editor and reload your workspace before making more
            changes.
          </p>
        )}
        {(busy || completed.size > 0) && (
          <ImportProgress
            label="Updating transactions"
            value={completed.size}
            total={items.length}
          />
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              locked ||
              !hasChanges ||
              !!invalid.length ||
              !!amountError ||
              !preview.length
            }
          >
            {busy ? "Saving…" : "Save changes"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
