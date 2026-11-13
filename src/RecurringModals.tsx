import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Link2,
  Plus,
  Search,
  Unlink,
  X,
} from "lucide-react";
import {
  errorMessage,
  minor,
  money,
  today,
  type Ledger,
  type RecurringAmountType,
  type RecurringFrequency,
  type RecurringKind,
  type RecurringOccurrenceRecord,
  type RecurringSchedule,
  type RecurringStatus,
  type Transaction,
} from "./domain.ts";
import {
  MAX_RECURRING_DATE,
  MIN_RECURRING_DATE,
  buildConfirmTransaction,
  validateOccurrenceConfirmation,
  validateRecurringSchedule,
} from "./recurring.ts";
import { formatFullDate } from "./RecurringView";

export function RecurringEditorModal({
  item,
  initialDraft,
  ledger,
  concealed,
  busy,
  onClose,
  onSave,
  onUnlinkOccurrence,
}: {
  item?: RecurringSchedule;
  initialDraft?: Partial<Omit<RecurringSchedule, "id">>;
  ledger: Ledger;
  concealed: (v: number) => string;
  busy: boolean;
  onClose: () => void;
  onSave: (
    value: Omit<RecurringSchedule, "id">,
    id?: string,
  ) => Promise<void>;
  onUnlinkOccurrence: (occurrenceId: string) => void;
}) {
  const [kind, setKind] = useState<RecurringKind>(
    item?.type ?? initialDraft?.type ?? "expense",
  );
  const [amountType, setAmountType] = useState<RecurringAmountType>(
    item?.amount_type ?? initialDraft?.amount_type ?? "fixed",
  );
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  const confirmedLinks = useMemo(
    () =>
      item
        ? (ledger.recurring_occurrences ?? [])
            .filter((o) => o.recurring_id === item.id)
            .slice()
            .sort((a, b) => b.occurrence_date.localeCompare(a.occurrence_date))
        : [],
    [item, ledger.recurring_occurrences],
  );
  const hasConfirmed = confirmedLinks.length > 0;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    try {
      const value: Omit<RecurringSchedule, "id"> = {
        name: s("name"),
        type: kind,
        amount: minor(s("amount")),
        amount_type: amountType,
        account_id: s("account_id"),
        category_id: s("category_id") || null,
        frequency: s("frequency") as RecurringFrequency,
        start_date: s("start_date"),
        end_date: s("end_date") || null,
        status: (s("status") ||
          item?.status ||
          initialDraft?.status ||
          "active") as RecurringStatus,
        notes: s("notes"),
      };
      validateRecurringSchedule({ ...value, id: item?.id }, ledger);
      await onSave(value, item?.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="recurring-modal-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">RECURRING SCHEDULE</span>
          <h2 id="recurring-modal-title">
            {item ? "Edit" : "Add"} recurring
          </h2>
        </div>
        <button
          type="button"
          disabled={busy}
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <form onSubmit={submit}>
        {ledger.accounts.length === 0 && (
          <div className="notice">
            Create an account first before adding a recurring schedule.
          </div>
        )}
        <div className="type-switch">
          {(["expense", "income"] as const).map((k) => (
            <button
              type="button"
              key={k}
              disabled={hasConfirmed && k !== item?.type}
              className={kind === k ? "selected" : ""}
              onClick={() => setKind(k)}
            >
              {k === "expense" ? (
                <ArrowUpRight size={16} />
              ) : (
                <ArrowDownLeft size={16} />
              )}{" "}
              {k}
            </button>
          ))}
        </div>

        <label>
          Name
          <input
            name="name"
            required
            autoFocus
            maxLength={160}
            defaultValue={item?.name ?? initialDraft?.name ?? ""}
            placeholder={
              kind === "income"
                ? "e.g. Monthly salary, Rental income"
                : "e.g. DEWA, du Fibre, Netflix, Rent"
            }
          />
        </label>

        <div className="form-row">
          <label>
            {amountType === "variable" ? "Expected amount" : "Amount"}{" "}
            <span className="muted">AED</span>
            <input
              name="amount"
              required
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={
                item
                  ? (item.amount / 100).toFixed(2)
                  : initialDraft?.amount !== undefined
                    ? (initialDraft.amount / 100).toFixed(2)
                    : ""
              }
            />
          </label>
          <label>
            Amount behaviour
            <select
              name="amount_type"
              value={amountType}
              onChange={(e) =>
                setAmountType(e.target.value as RecurringAmountType)
              }
            >
              <option value="fixed">Fixed amount</option>
              <option value="variable">Variable (prompt when paid)</option>
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Account
            <select
              name="account_id"
              required
              defaultValue={
                item?.account_id ??
                initialDraft?.account_id ??
                ledger.accounts[0]?.id
              }
            >
              {ledger.accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              name="category_id"
              defaultValue={
                item?.category_id ?? initialDraft?.category_id ?? ""
              }
            >
              <option value="">Uncategorized</option>
              {ledger.categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Frequency
            <select
              name="frequency"
              defaultValue={
                item?.frequency ?? initialDraft?.frequency ?? "monthly"
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <label>
            Status
            <select
              name="status"
              defaultValue={item?.status ?? initialDraft?.status ?? "active"}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Start date
            <input
              name="start_date"
              type="date"
              required
              min={MIN_RECURRING_DATE}
              max={MAX_RECURRING_DATE}
              defaultValue={
                item?.start_date ?? initialDraft?.start_date ?? today()
              }
            />
          </label>
          <label>
            End date <span className="muted">Optional</span>
            <input
              name="end_date"
              type="date"
              min={MIN_RECURRING_DATE}
              max={MAX_RECURRING_DATE}
              defaultValue={item?.end_date ?? initialDraft?.end_date ?? ""}
            />
          </label>
        </div>

        <label>
          Notes <span className="muted">Optional</span>
          <textarea
            name="notes"
            maxLength={1000}
            defaultValue={item?.notes ?? initialDraft?.notes ?? ""}
            placeholder="Contract details, billing day or reminders"
          />
        </label>

        {hasConfirmed && (
          <div className="link-existing-box">
            <span className="eyebrow">
              CONFIRMED OCCURRENCES ({confirmedLinks.length})
            </span>
            <div className="candidate-list">
              {confirmedLinks.map((occ) => {
                const tx = ledger.transactions.find(
                  (t) => t.id === occ.transaction_id,
                );
                return (
                  <div className="candidate-item as-row" key={occ.id}>
                    <span className="candidate-meta">
                      <b>{formatFullDate(occ.occurrence_date)}</b>
                      <small>
                        {tx
                          ? `${tx.payee || "Transaction"} · ${concealed(tx.amount)}`
                          : "Linked transaction"}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="secondary compact-btn"
                      disabled={busy}
                      onClick={() => onUnlinkOccurrence(occ.id)}
                    >
                      <Unlink size={13} /> Unlink
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="form-hint">
          Month-end, quarterly and leap-day schedules adjust automatically.
          Account balances only change when you mark an occurrence paid.
        </p>

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
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !ledger.accounts.length}
          >
            {busy ? "Saving…" : item ? "Save changes" : "Add recurring"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function ConfirmOccurrenceModal({
  schedule,
  occurrenceDate,
  ledger,
  busy,
  existingConfirmation,
  onClose,
  onConfirmCreate,
  onConfirmLink,
}: {
  schedule: RecurringSchedule;
  occurrenceDate: string;
  ledger: Ledger;
  busy: boolean;
  existingConfirmation?: RecurringOccurrenceRecord;
  onClose: () => void;
  onConfirmCreate: (
    schedule: RecurringSchedule,
    occurrenceDate: string,
    tx: Omit<Transaction, "id">,
  ) => Promise<void>;
  onConfirmLink: (
    schedule: RecurringSchedule,
    occurrenceDate: string,
    transactionId: string,
    existingConfirmationId?: string,
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<"create" | "link">(
    existingConfirmation ? "link" : "create",
  );
  const [selectedTxId, setSelectedTxId] = useState(
    existingConfirmation?.transaction_id ?? "",
  );
  const [linkSearch, setLinkSearch] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const accountById = useMemo(
    () => new Map(ledger.accounts.map((a) => [a.id, a])),
    [ledger.accounts],
  );

  const linkedIds = useMemo(
    () =>
      new Set(
        (ledger.recurring_occurrences ?? [])
          .filter((o) => o.id !== existingConfirmation?.id)
          .map((o) => o.transaction_id),
      ),
    [ledger.recurring_occurrences, existingConfirmation],
  );

  const candidates = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    const targetMs = Date.parse(occurrenceDate + "T00:00:00Z");
    return ledger.transactions
      .filter((t) => {
        if (t.type !== schedule.type) return false;
        if (linkedIds.has(t.id)) return false;
        if (q) {
          const acc = accountById.get(t.account_id)?.name ?? "";
          if (
            !`${t.payee} ${t.notes} ${t.date} ${acc}`
              .toLowerCase()
              .includes(q)
          )
            return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = Math.abs(Date.parse(a.date + "T00:00:00Z") - targetMs);
        const db = Math.abs(Date.parse(b.date + "T00:00:00Z") - targetMs);
        return da - db || b.date.localeCompare(a.date);
      });
  }, [
    ledger.transactions,
    accountById,
    schedule.type,
    linkedIds,
    linkSearch,
    occurrenceDate,
  ]);

  const defaultTxDate = occurrenceDate;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      if (mode === "link") {
        validateOccurrenceConfirmation(
          {
            id: existingConfirmation?.id,
            recurring_id: schedule.id,
            occurrence_date: occurrenceDate,
            transaction_id: selectedTxId,
          },
          ledger,
        );
        await onConfirmLink(
          schedule,
          occurrenceDate,
          selectedTxId,
          existingConfirmation?.id,
        );
      } else {
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "").trim();
        const rawAmount = s("amount");
        if (!rawAmount)
          throw new Error(
            schedule.amount_type === "variable"
              ? "Enter the actual amount paid for this variable payment."
              : "Enter the amount paid.",
          );
        const tx = buildConfirmTransaction(schedule, occurrenceDate, ledger, {
          amount: minor(rawAmount),
          account_id: s("account_id"),
          category_id: s("category_id") || null,
          date: s("date"),
          payee: s("payee") || schedule.name,
          notes: s("notes"),
        });
        await onConfirmCreate(schedule, occurrenceDate, tx);
      }
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.includes("Link existing")) {
        setMode("link");
      }
      setError(msg);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="confirm-recurring-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">
            {existingConfirmation
              ? "CHANGE LINKED TRANSACTION"
              : `CONFIRM PAYMENT · ${formatFullDate(occurrenceDate).toUpperCase()}`}
          </span>
          <h2 id="confirm-recurring-title">{schedule.name}</h2>
        </div>
        <button
          type="button"
          disabled={busy}
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>

      <form onSubmit={submit}>
        <div className="type-switch">
          {!existingConfirmation && (
            <button
              type="button"
              className={mode === "create" ? "selected" : ""}
              onClick={() => {
                setMode("create");
                setError("");
              }}
            >
              <Plus size={16} /> Record new transaction
            </button>
          )}
          <button
            type="button"
            className={mode === "link" ? "selected" : ""}
            onClick={() => {
              setMode("link");
              setError("");
            }}
          >
            <Link2 size={16} /> Link existing ({candidates.length})
          </button>
        </div>

        {mode === "create" ? (
          <>
            {schedule.amount_type === "variable" && (
              <div className="notice">
                Variable payment (expected {money(schedule.amount)}). Enter the
                actual {schedule.type === "income" ? "received" : "paid"} amount
                in AED below.
              </div>
            )}
            <label>
              Actual amount <span className="muted">AED</span>
              <input
                name="amount"
                required
                autoFocus
                inputMode="decimal"
                placeholder={
                  schedule.amount_type === "variable"
                    ? `Expected ${(schedule.amount / 100).toFixed(2)}`
                    : "0.00"
                }
                defaultValue={
                  schedule.amount_type === "fixed"
                    ? (schedule.amount / 100).toFixed(2)
                    : ""
                }
              />
            </label>
            <div className="form-row">
              <label>
                Account
                <select
                  name="account_id"
                  required
                  defaultValue={schedule.account_id}
                >
                  {ledger.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  name="category_id"
                  defaultValue={schedule.category_id ?? ""}
                >
                  <option value="">Uncategorized</option>
                  {ledger.categories.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Transaction date
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={defaultTxDate}
                />
              </label>
              <label>
                Payee / description
                <input
                  name="payee"
                  maxLength={160}
                  defaultValue={schedule.name}
                />
              </label>
            </div>
            <label>
              Notes <span className="muted">Optional</span>
              <textarea
                name="notes"
                maxLength={1000}
                defaultValue={schedule.notes}
              />
            </label>
          </>
        ) : (
          <div className="link-existing-box">
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Search existing transactions to link"
                placeholder="Filter unlinked transactions…"
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
              />
            </label>
            {candidates.length ? (
              <div className="candidate-list">
                {candidates.slice(0, 30).map((t) => {
                  const account = accountById.get(t.account_id);
                  return (
                    <label className="candidate-item" key={t.id}>
                      <input
                        type="radio"
                        name="transaction_id"
                        value={t.id}
                        checked={selectedTxId === t.id}
                        onChange={() => setSelectedTxId(t.id)}
                      />
                      <span className="candidate-meta">
                        <b>{t.payee || "Transaction"}</b>
                        <small>
                          {formatFullDate(t.date)} ·{" "}
                          {account?.name ?? "Account"}
                        </small>
                      </span>
                      <strong
                        className={t.type === "income" ? "green-text" : ""}
                      >
                        {t.type === "income" ? "+" : "−"}
                        {money(t.amount)}
                      </strong>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="form-hint">
                No unlinked {schedule.type} transactions found.
              </p>
            )}
            <p className="form-hint">
              Linking attaches this occurrence to an existing ledger record
              without creating a duplicate transaction or changing account
              balances.
            </p>
          </div>
        )}

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
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || (mode === "link" && !selectedTxId)}
          >
            {busy
              ? "Saving…"
              : mode === "link"
                ? existingConfirmation
                  ? "Update link"
                  : "Link transaction"
                : "Confirm & record"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
