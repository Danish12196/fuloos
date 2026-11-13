import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Unlink,
  X,
} from "lucide-react";
import { ColorPicker, EmojiField } from "./Appearance";
import {
  balance,
  balanceAsOfDate,
  errorMessage,
  hasBalanceAnchor,
  isIsoCalendarDate,
  minor,
  money,
  NO_BALANCE_DATE,
  openingDateFor,
  today,
  validateTransaction,
  type Account,
  type AccountType,
  type Category,
  type Kind,
  type Ledger,
  type Transaction,
} from "./domain";

export const ACCOUNT_TYPES: Record<AccountType, string> = {
  current: "Current",
  savings: "Savings",
  credit_card: "Credit card",
  cash: "Cash",
  other: "Other",
};

const COLORS = [
  "#1d5b48",
  "#b08448",
  "#696198",
  "#619a92",
  "#b86e69",
  "#768db1",
];

export type EditorModalState =
  | { kind: "account"; item?: Account }
  | { kind: "category"; item?: Category }
  | { kind: "transaction"; item?: Transaction }
  | null;

export function Editor({
  modal,
  ledger,
  busy,
  onClose,
  save,
  onUnlinkOccurrence,
}: {
  modal: NonNullable<EditorModalState>;
  ledger: Ledger;
  busy: boolean;
  onClose: () => void;
  save: (
    table: "accounts" | "categories" | "transactions",
    value: Record<string, unknown>,
    id?: string,
  ) => Promise<void>;
  onUnlinkOccurrence: (occurrenceId: string) => void;
}) {
  const item = modal.item;
  const [kind, setKind] = useState<Kind>(
      modal.kind === "transaction" && modal.item ? modal.item.type : "expense",
    ),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const linkedOccurrence = useMemo(
    () =>
      modal.kind === "transaction" && modal.item
        ? (ledger.recurring_occurrences ?? []).find(
            (o) => o.transaction_id === modal.item!.id,
          )
        : undefined,
    [modal, ledger.recurring_occurrences],
  );
  const linkedSchedule = useMemo(
    () =>
      linkedOccurrence
        ? (ledger.recurring ?? []).find(
            (r) => r.id === linkedOccurrence.recurring_id,
          )
        : undefined,
    [linkedOccurrence, ledger.recurring],
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget),
      s = (key: string) => String(f.get(key) ?? "").trim();
    try {
      if (modal.kind === "account") {
        const balanceText = s("balance");
        const asOf = s("balance_as_of") || today();
        if (balanceText && !isIsoCalendarDate(asOf))
          throw new Error("Choose a valid date for the balance.");
        const value = {
          name: s("name"),
          type: s("type"),
          // No balance given: the balance is just the sum of transactions.
          opening_balance: balanceText ? minor(balanceText) : 0,
          opening_date: balanceText ? openingDateFor(asOf) : NO_BALANCE_DATE,
          color: s("color"),
          emoji: s("emoji"),
        };
        if (!value.name) throw new Error("Enter an account name.");
        await save("accounts", value, item?.id);
      } else if (modal.kind === "category") {
        const value = {
          name: s("name"),
          description: s("description"),
          color: s("color"),
          emoji: s("emoji"),
        };
        if (!value.name) throw new Error("Enter a category name.");
        await save("categories", value, item?.id);
      } else {
        const value = {
          type: kind,
          amount: minor(s("amount")),
          account_id: s("account_id"),
          to_account_id: kind === "transfer" ? s("to_account_id") : null,
          category_id: kind === "transfer" ? null : s("category_id") || null,
          date: s("date"),
          payee: s("payee"),
          notes: s("notes"),
        };
        validateTransaction({ ...value, id: item?.id }, ledger);
        await save("transactions", value, item?.id);
      }
    } catch (e) {
      setError(errorMessage(e));
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
      aria-labelledby="modal-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2 id="modal-title">
            {item ? "Edit" : "Add"} {modal.kind}
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
      <form onSubmit={submit}>
        {modal.kind === "transaction" ? (
          <>
            {ledger.accounts.length === 0 && (
              <div className="notice">
                Create an account first to start adding transactions.
              </div>
            )}
            {linkedOccurrence && (
              <div className="notice linked-banner">
                <span>
                  Linked to{" "}
                  <b>{linkedSchedule?.name ?? "recurring schedule"}</b> (
                  {linkedOccurrence.occurrence_date})
                </span>
                <button
                  type="button"
                  className="secondary compact-btn"
                  disabled={busy}
                  onClick={() => onUnlinkOccurrence(linkedOccurrence.id)}
                >
                  <Unlink size={13} /> Unlink
                </button>
              </div>
            )}
            <div className="type-switch">
              {(["expense", "income", "transfer"] as const).map((k) => (
                <button
                  type="button"
                  disabled={Boolean(
                    linkedSchedule && k !== linkedSchedule.type,
                  )}
                  className={kind === k ? "selected" : ""}
                  key={k}
                  onClick={() => setKind(k)}
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
            </div>
            <label>
              Amount <span className="muted">AED</span>
              <input
                name="amount"
                autoFocus
                required
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={
                  modal.item ? (modal.item.amount / 100).toFixed(2) : ""
                }
              />
            </label>
            <div className="form-row">
              <label>
                {kind === "transfer" ? "From account" : "Account"}
                <select
                  name="account_id"
                  required
                  defaultValue={
                    modal.item?.account_id ?? ledger.accounts[0]?.id
                  }
                >
                  {ledger.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "transfer" ? (
                <label>
                  To account
                  <select
                    name="to_account_id"
                    required
                    defaultValue={modal.item?.to_account_id ?? ""}
                  >
                    <option value="" disabled>
                      Choose account
                    </option>
                    {ledger.accounts.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Category
                  <select
                    key={kind}
                    name="category_id"
                    defaultValue={
                      modal.item?.type === kind
                        ? (modal.item.category_id ?? "")
                        : ""
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
              )}
            </div>
            <label>
              Date
              <input
                required
                name="date"
                type="date"
                defaultValue={modal.item?.date ?? today()}
              />
            </label>
            <label>
              {kind === "transfer" ? "Description" : "Payee / description"}
              <input
                name="payee"
                maxLength={160}
                defaultValue={modal.item?.payee}
                placeholder={
                  kind === "income"
                    ? "e.g. Monthly salary"
                    : kind === "transfer"
                      ? "e.g. Moving to savings"
                      : "e.g. Spinneys"
                }
              />
            </label>
            <label>
              Notes <span className="muted">Optional</span>
              <textarea
                name="notes"
                maxLength={1000}
                defaultValue={modal.item?.notes}
                placeholder="Anything you’d like to remember"
              />
            </label>
            {kind === "transfer" && (
              <p className="form-hint">
                Both accounts update together. Transfers are excluded from
                income and expenses.
              </p>
            )}
          </>
        ) : modal.kind === "account" ? (
          <>
            <label>
              Account name
              <input
                required
                autoFocus
                name="name"
                maxLength={80}
                defaultValue={modal.item?.name}
                placeholder="e.g. My everyday account"
              />
            </label>
            <label>
              Account type
              <select name="type" defaultValue={modal.item?.type ?? "current"}>
                {Object.entries(ACCOUNT_TYPES).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                Balance (AED) <span className="muted">Optional</span>
                <input
                  inputMode="decimal"
                  name="balance"
                  placeholder="e.g. 12500.00"
                  defaultValue={
                    modal.item && hasBalanceAnchor(modal.item)
                      ? (modal.item.opening_balance / 100).toFixed(2)
                      : ""
                  }
                />
              </label>
              <label>
                As of end of
                <input
                  name="balance_as_of"
                  type="date"
                  defaultValue={
                    modal.item && hasBalanceAnchor(modal.item)
                      ? balanceAsOfDate(modal.item)
                      : today()
                  }
                />
              </label>
            </div>
            <p className="form-hint">
              Enter what your bank shows at the end of a day. Transactions after
              that day are added to it. Earlier ones are already part of it, so
              you can add past transactions at any time without changing this
              balance. Leave it blank to just add up your transactions. Use a
              negative balance for credit card debt or an overdraft.
              {modal.item && (
                <>
                  {" "}
                  The app currently shows{" "}
                  {money(balance(modal.item, ledger.transactions))} for this
                  account.
                </>
              )}
            </p>
            <EmojiField defaultValue={modal.item?.emoji} />
            <ColorPicker
              defaultValue={
                modal.item?.color ??
                COLORS[ledger.accounts.length % COLORS.length]
              }
            />
          </>
        ) : (
          <>
            <label>
              Category name
              <input
                autoFocus
                required
                name="name"
                maxLength={80}
                defaultValue={modal.item?.name}
                placeholder="e.g. Coffee & cafés"
              />
            </label>
            <p className="form-hint">
              Use this category for both income and expenses.
            </p>
            <label>
              Description <span className="muted">Optional</span>
              <textarea
                name="description"
                maxLength={500}
                defaultValue={modal.item?.description}
                placeholder="What belongs in this category?"
              />
            </label>
            <EmojiField defaultValue={modal.item?.emoji} />
            <ColorPicker
              defaultValue={
                modal.item?.color ??
                COLORS[ledger.categories.length % COLORS.length]
              }
            />
          </>
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
            disabled={
              busy || (modal.kind === "transaction" && !ledger.accounts.length)
            }
          >
            {busy ? "Saving…" : item ? "Save changes" : `Add ${modal.kind}`}
            <Check size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
