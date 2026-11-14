import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Download,
  Paperclip,
  Plus,
  Split,
  Trash2,
  Unlink,
  Wand2,
  X,
} from "lucide-react";
import { ColorPicker, EmojiField } from "./Appearance";
import {
  convertToAedFils,
  DEFAULT_CURRENCY,
  formatCurrencyInput,
  getReferenceFxRate,
  normalizeCurrencyCode,
  parseCurrencyMinor,
  REFERENCE_RATES_NOTE,
  SUPPORTED_CURRENCIES,
} from "./currency";
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
  type TransactionSplit,
} from "./domain";
import {
  collectLedgerTags,
  isReceiptPdf,
  splitRemainder,
  validateReceiptFile,
} from "./enrichment";
import { applyRules } from "./rules";
import { TagInput } from "./TagInput";

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

interface SplitDraftRow {
  category_id: string;
  amountText: string;
  notes: string;
}

export function Editor({
  modal,
  ledger,
  busy,
  demo = false,
  onLoadReceiptUrl,
  onClose,
  save,
  onUnlinkOccurrence,
}: {
  modal: NonNullable<EditorModalState>;
  ledger: Ledger;
  busy: boolean;
  demo?: boolean;
  onLoadReceiptUrl?: (txId: string, filename: string) => Promise<string>;
  onClose: () => void;
  save: (
    table: "accounts" | "categories" | "transactions",
    value: Record<string, unknown>,
    id?: string,
    options?: { receiptFile?: File | null; removeReceipt?: boolean },
  ) => Promise<void>;
  onUnlinkOccurrence: (occurrenceId: string) => void;
}) {
  const item = modal.item;
  const txItem = modal.kind === "transaction" ? modal.item : undefined;
  const accItem = modal.kind === "account" ? modal.item : undefined;
  const [accountType, setAccountType] = useState<AccountType>(
    accItem?.type ?? "current",
  );
  const [kind, setKind] = useState<Kind>(txItem ? txItem.type : "expense"),
    [error, setError] = useState("");
  const [amountText, setAmountText] = useState(
    txItem ? (txItem.amount / 100).toFixed(2) : "",
  );
  const [accountId, setAccountId] = useState(
    () => txItem?.account_id ?? ledger.accounts[0]?.id ?? "",
  );
  const initialAccountCurrency = normalizeCurrencyCode(
    ledger.accounts.find((a) => a.id === (txItem?.account_id ?? ledger.accounts[0]?.id))
      ?.currency,
  );
  const [foreignEnabled, setForeignEnabled] = useState(() =>
    txItem
      ? Boolean(txItem.original_currency && txItem.original_currency !== DEFAULT_CURRENCY)
      : initialAccountCurrency !== DEFAULT_CURRENCY,
  );
  const [originalCurrency, setOriginalCurrency] = useState(() => {
    if (txItem?.original_currency && txItem.original_currency !== DEFAULT_CURRENCY) {
      return txItem.original_currency;
    }
    return initialAccountCurrency !== DEFAULT_CURRENCY
      ? initialAccountCurrency
      : "USD";
  });
  const [originalAmountText, setOriginalAmountText] = useState(() =>
    txItem?.original_currency &&
    txItem.original_currency !== DEFAULT_CURRENCY &&
    txItem.original_amount !== undefined
      ? formatCurrencyInput(txItem.original_amount, txItem.original_currency)
      : "",
  );
  const [fxRateText, setFxRateText] = useState(() => {
    if (txItem?.fx_rate && txItem.fx_rate > 0) return String(txItem.fx_rate);
    const curr =
      txItem?.original_currency && txItem.original_currency !== DEFAULT_CURRENCY
        ? txItem.original_currency
        : initialAccountCurrency !== DEFAULT_CURRENCY
          ? initialAccountCurrency
          : "USD";
    return String(getReferenceFxRate(curr));
  });
  const [categoryId, setCategoryId] = useState(
    txItem?.type !== "transfer" ? (txItem?.category_id ?? "") : "",
  );
  const [payee, setPayee] = useState(txItem?.payee ?? "");
  const [notes, setNotes] = useState(txItem?.notes ?? "");
  const [tags, setTags] = useState<string[]>(txItem?.tags ?? []);
  const [splits, setSplits] = useState<SplitDraftRow[]>(() =>
    (txItem?.splits ?? []).map((s) => ({
      category_id: s.category_id ?? "",
      amountText: (s.amount / 100).toFixed(2),
      notes: s.notes ?? "",
    })),
  );
  const [ruleNotice, setRuleNotice] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string>("");
  const [receiptLoading, setReceiptLoading] = useState(false);

  const dialog = useRef<HTMLDialogElement>(null);
  const tagSuggestions = useMemo(() => collectLedgerTags(ledger), [ledger]);
  const linkedOccurrence = useMemo(
    () =>
      txItem
        ? (ledger.recurring_occurrences ?? []).find(
            (o) => o.transaction_id === txItem.id,
          )
        : undefined,
    [txItem, ledger.recurring_occurrences],
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

  useEffect(() => {
    if (receiptFile) {
      const url = URL.createObjectURL(receiptFile);
      setReceiptPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (!removeReceipt && txItem?.receipt) {
      if (txItem.receipt.startsWith("blob:")) {
        setReceiptPreviewUrl(txItem.receipt);
        return;
      }
      if (onLoadReceiptUrl && !demo) {
        let active = true;
        let createdUrl = "";
        setReceiptLoading(true);
        onLoadReceiptUrl(txItem.id, txItem.receipt)
          .then((url) => {
            if (!active) {
              URL.revokeObjectURL(url);
              return;
            }
            createdUrl = url;
            setReceiptPreviewUrl(url);
          })
          .catch(() => {
            if (active) setReceiptPreviewUrl("");
          })
          .finally(() => {
            if (active) setReceiptLoading(false);
          });
        return () => {
          active = false;
          if (createdUrl) URL.revokeObjectURL(createdUrl);
        };
      }
    }
    setReceiptPreviewUrl("");
  }, [receiptFile, removeReceipt, txItem?.id, txItem?.receipt, onLoadReceiptUrl, demo]);

  const parsedParentAmount = useMemo(() => {
    try {
      return amountText.trim() ? minor(amountText) : 0;
    } catch {
      return 0;
    }
  }, [amountText]);

  const parsedSplits = useMemo<TransactionSplit[]>(() => {
    return splits.map((row) => {
      let amt = 0;
      try {
        amt = row.amountText.trim() ? minor(row.amountText) : 0;
      } catch {
        amt = -1;
      }
      return {
        category_id: row.category_id || null,
        amount: amt,
        ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
      };
    });
  }, [splits]);

  const remainingFils = useMemo(
    () => splitRemainder(parsedParentAmount, parsedSplits),
    [parsedParentAmount, parsedSplits],
  );

  function handleApplyRules() {
    setRuleNotice("");
    const rules = ledger.rules ?? [];
    if (!rules.length) {
      setRuleNotice("No rules configured yet.");
      return;
    }
    const result = applyRules(
      rules,
      {
        type: kind,
        payee,
        notes,
        amount: parsedParentAmount,
        category_id: categoryId || null,
        tags,
      },
      { overwriteCategory: !categoryId, overwritePayee: !payee.trim() },
    );
    if (!result.matchedRules.length) {
      setRuleNotice("No enabled rules matched.");
      return;
    }
    if (result.category_id && !categoryId) setCategoryId(result.category_id);
    if (result.payee && result.payee !== payee) setPayee(result.payee);
    setTags(result.tags);
    setRuleNotice(
      `Applied ${result.matchedRules.length} ${result.matchedRules.length === 1 ? "rule" : "rules"}: ${result.matchedRules.map((r) => r.name).join(", ")}`,
    );
  }

  function syncAedFromForeign(
    nextOrigText: string,
    nextCurr: string,
    nextRateText: string,
  ) {
    try {
      if (!nextOrigText.trim()) return;
      const origMinor = parseCurrencyMinor(nextOrigText, nextCurr);
      const rate = Number(nextRateText);
      if (origMinor >= 0 && Number.isFinite(rate) && rate > 0) {
        const aedFils = convertToAedFils(origMinor, nextCurr, rate);
        setAmountText((aedFils / 100).toFixed(2));
      }
    } catch {
      // Allow incomplete typing while editing.
    }
  }

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
        const accType = s("type") as AccountType;
        let creditCardFields: Record<string, number> = {
          credit_limit: 0,
          statement_day: 0,
          payment_due_day: 0,
          apr_bps: 0,
          minimum_payment: 0,
        };
        if (accType === "credit_card") {
          const limitText = s("credit_limit");
          const minPayText = s("minimum_payment");
          const stmtText = s("statement_day");
          const dueText = s("payment_due_day");
          const aprText = s("apr_pct");

          const creditLimit = limitText ? minor(limitText) : 0;
          if (creditLimit < 0)
            throw new Error("Credit limit must be zero or greater.");
          const minPayment = minPayText ? minor(minPayText) : 0;
          if (minPayment < 0)
            throw new Error("Minimum payment must be zero or greater.");

          let statementDay = 0;
          if (stmtText) {
            const parsed = Number(stmtText);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31)
              throw new Error("Statement day must be between 1 and 31.");
            statementDay = parsed;
          }

          let paymentDueDay = 0;
          if (dueText) {
            const parsed = Number(dueText);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31)
              throw new Error("Payment due day must be between 1 and 31.");
            paymentDueDay = parsed;
          }

          let aprBps = 0;
          if (aprText) {
            const parsed = Number(aprText);
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000)
              throw new Error("APR must be between 0% and 1000%.");
            aprBps = Math.round(parsed * 100);
          }

          creditCardFields = {
            credit_limit: creditLimit,
            statement_day: statementDay,
            payment_due_day: paymentDueDay,
            apr_bps: aprBps,
            minimum_payment: minPayment,
          };
        }
        const value = {
          name: s("name"),
          type: accType,
          currency: normalizeCurrencyCode(s("currency")),
          // No balance given: the balance is just the sum of transactions.
          opening_balance: balanceText ? minor(balanceText) : 0,
          opening_date: balanceText ? openingDateFor(asOf) : NO_BALANCE_DATE,
          color: s("color"),
          emoji: s("emoji"),
          ...creditCardFields,
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
        let foreignFields: Record<string, unknown> = { original_currency: "" };
        if (foreignEnabled) {
          if (!originalAmountText.trim()) {
            throw new Error("Enter the original currency amount.");
          }
          const origMinor = parseCurrencyMinor(originalAmountText, originalCurrency);
          const fxRate = Number(fxRateText);
          if (!Number.isFinite(fxRate) || fxRate <= 0) {
            throw new Error("Enter an exchange rate greater than zero.");
          }
          foreignFields = {
            original_currency: originalCurrency,
            original_amount: origMinor,
            fx_rate: fxRate,
          };
        }
        const txAmount = minor(amountText);
        const activeSplits =
          kind !== "transfer" && splits.length > 0 ? parsedSplits : [];
        const value: Record<string, unknown> = {
          type: kind,
          amount: txAmount,
          account_id: accountId || s("account_id"),
          to_account_id: kind === "transfer" ? s("to_account_id") : null,
          category_id: kind === "transfer" ? null : categoryId || null,
          date: s("date"),
          payee: payee.trim(),
          notes: notes.trim(),
          tags,
          splits: activeSplits,
          ...foreignFields,
        };
        validateTransaction(
          { ...(value as Omit<Transaction, "id">), id: item?.id },
          ledger,
        );
        await save("transactions", value, item?.id, {
          receiptFile,
          removeReceipt,
        });
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
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
            </label>
            <div className="enrichment-section">
              <div className="enrichment-section-head">
                <label className="selection-label">
                  <input
                    type="checkbox"
                    checked={foreignEnabled}
                    disabled={busy}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setForeignEnabled(checked);
                      if (checked) {
                        syncAedFromForeign(
                          originalAmountText,
                          originalCurrency,
                          fxRateText,
                        );
                      }
                    }}
                  />
                  <span>Foreign currency</span>
                </label>
                {foreignEnabled && (
                  <span className="muted small">Explicit FX to AED</span>
                )}
              </div>
              {foreignEnabled && (
                <>
                  <div className="form-row">
                    <label>
                      Currency
                      <select
                        name="original_currency"
                        value={originalCurrency}
                        disabled={busy}
                        onChange={(e) => {
                          const nextCurr = e.target.value;
                          const nextRate = String(getReferenceFxRate(nextCurr));
                          setOriginalCurrency(nextCurr);
                          setFxRateText(nextRate);
                          syncAedFromForeign(
                            originalAmountText,
                            nextCurr,
                            nextRate,
                          );
                        }}
                      >
                        {SUPPORTED_CURRENCIES.filter(
                          (c) => c.code !== DEFAULT_CURRENCY,
                        ).map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} — {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Original amount ({originalCurrency})
                      <input
                        name="original_amount"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={originalAmountText}
                        disabled={busy}
                        onChange={(e) => {
                          const nextOrig = e.target.value;
                          setOriginalAmountText(nextOrig);
                          syncAedFromForeign(
                            nextOrig,
                            originalCurrency,
                            fxRateText,
                          );
                        }}
                      />
                    </label>
                    <label>
                      Rate (1 {originalCurrency} = AED)
                      <input
                        name="fx_rate"
                        inputMode="decimal"
                        placeholder="3.6725"
                        value={fxRateText}
                        disabled={busy}
                        onChange={(e) => {
                          const nextRate = e.target.value;
                          setFxRateText(nextRate);
                          syncAedFromForeign(
                            originalAmountText,
                            originalCurrency,
                            nextRate,
                          );
                        }}
                      />
                    </label>
                  </div>
                  <p className="form-hint">{REFERENCE_RATES_NOTE}</p>
                </>
              )}
            </div>
            <div className="form-row">
              <label>
                {kind === "transfer" ? "From account" : "Account"}
                <select
                  name="account_id"
                  required
                  value={accountId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setAccountId(nextId);
                    if (!txItem) {
                      const acc = ledger.accounts.find((a) => a.id === nextId);
                      const accCurr = normalizeCurrencyCode(acc?.currency);
                      if (accCurr !== DEFAULT_CURRENCY) {
                        const nextRate = String(getReferenceFxRate(accCurr));
                        setForeignEnabled(true);
                        setOriginalCurrency(accCurr);
                        setFxRateText(nextRate);
                        syncAedFromForeign(
                          originalAmountText,
                          accCurr,
                          nextRate,
                        );
                      }
                    }
                  }}
                >
                  {ledger.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                      {a.currency && a.currency !== "AED"
                        ? ` (${a.currency})`
                        : ""}
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
                    value={categoryId}
                    disabled={splits.length > 0}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">
                      {splits.length > 0 ? "Split across categories" : "Uncategorized"}
                    </option>
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
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
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
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything you’d like to remember"
              />
            </label>
            {kind !== "transfer" && (ledger.rules?.length ?? 0) > 0 && (
              <div className="enrichment-rule-bar">
                <button
                  type="button"
                  className="secondary compact-btn"
                  disabled={busy}
                  onClick={handleApplyRules}
                >
                  <Wand2 size={14} /> Apply rules
                </button>
                {ruleNotice && (
                  <span className="muted small">{ruleNotice}</span>
                )}
              </div>
            )}
            <div className="field-block">
              <span className="field-label">
                Tags <span className="muted">Optional</span>
              </span>
              <TagInput
                tags={tags}
                onChange={setTags}
                suggestions={tagSuggestions}
                disabled={busy}
              />
            </div>
            {kind !== "transfer" && (
              <div className="enrichment-section">
                <div className="enrichment-section-head">
                  <span className="field-label">
                    <Split size={14} /> Split transaction
                  </span>
                  <button
                    type="button"
                    className="secondary compact-btn"
                    disabled={busy}
                    onClick={() => {
                      if (splits.length === 0) {
                        const half = Math.floor(parsedParentAmount / 2);
                        const rem = parsedParentAmount - half;
                        setSplits([
                          {
                            category_id: categoryId,
                            amountText:
                              parsedParentAmount > 0
                                ? (half / 100).toFixed(2)
                                : "",
                            notes: "",
                          },
                          {
                            category_id: "",
                            amountText:
                              parsedParentAmount > 0
                                ? (rem / 100).toFixed(2)
                                : "",
                            notes: "",
                          },
                        ]);
                      } else {
                        setSplits((rows) => [
                          ...rows,
                          {
                            category_id: "",
                            amountText:
                              remainingFils > 0
                                ? (remainingFils / 100).toFixed(2)
                                : "",
                            notes: "",
                          },
                        ]);
                      }
                    }}
                  >
                    <Plus size={13} />{" "}
                    {splits.length === 0 ? "Split across categories" : "Add split"}
                  </button>
                </div>
                {splits.length > 0 && (
                  <div className="splits-list">
                    {splits.map((row, idx) => (
                      <div className="split-row" key={idx}>
                        <select
                          aria-label={`Split ${idx + 1} category`}
                          value={row.category_id}
                          onChange={(e) =>
                            setSplits((rows) =>
                              rows.map((r, i) =>
                                i === idx
                                  ? { ...r, category_id: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        >
                          <option value="">Uncategorized</option>
                          {ledger.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={`Split ${idx + 1} amount`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={row.amountText}
                          onChange={(e) =>
                            setSplits((rows) =>
                              rows.map((r, i) =>
                                i === idx
                                  ? { ...r, amountText: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                        <input
                          aria-label={`Split ${idx + 1} notes`}
                          maxLength={200}
                          placeholder="Note"
                          value={row.notes}
                          onChange={(e) =>
                            setSplits((rows) =>
                              rows.map((r, i) =>
                                i === idx ? { ...r, notes: e.target.value } : r,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          className="icon-button delete"
                          aria-label={`Remove split ${idx + 1}`}
                          onClick={() =>
                            setSplits((rows) => rows.filter((_, i) => i !== idx))
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <div className="splits-footer">
                      <span
                        className={`small ${remainingFils === 0 ? "muted" : "error-text"}`}
                      >
                        {remainingFils === 0
                          ? "Splits balanced"
                          : `Remaining: ${money(remainingFils)}`}
                      </span>
                      {remainingFils !== 0 && splits.length > 0 && (
                        <button
                          type="button"
                          className="text-button small"
                          onClick={() => {
                            const lastIdx = splits.length - 1;
                            const currentLast =
                              parsedSplits[lastIdx]?.amount > 0
                                ? parsedSplits[lastIdx].amount
                                : 0;
                            const nextLast = currentLast + remainingFils;
                            if (nextLast > 0) {
                              setSplits((rows) =>
                                rows.map((r, i) =>
                                  i === lastIdx
                                    ? {
                                        ...r,
                                        amountText: (nextLast / 100).toFixed(2),
                                      }
                                    : r,
                                ),
                              );
                            }
                          }}
                        >
                          Fill remainder on last line
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="enrichment-section">
              <div className="enrichment-section-head">
                <span className="field-label">
                  <Paperclip size={14} /> Receipt{" "}
                  <span className="muted">JPEG, PNG, WebP, PDF · max 5 MB</span>
                </span>
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    validateReceiptFile(file);
                    setError("");
                    setReceiptFile(file);
                    setRemoveReceipt(false);
                  } catch (err) {
                    setError(errorMessage(err));
                    e.target.value = "";
                  }
                }}
              />
              {receiptLoading && (
                <p className="muted small">Loading receipt preview…</p>
              )}
              {(receiptFile || (!removeReceipt && txItem?.receipt)) && (
                <div className="receipt-preview-box">
                  {receiptPreviewUrl &&
                  !isReceiptPdf(receiptFile?.name ?? txItem?.receipt ?? "") ? (
                    <img
                      src={receiptPreviewUrl}
                      alt="Receipt preview"
                      className="receipt-thumb"
                    />
                  ) : (
                    <span className="muted small">
                      {receiptFile?.name ?? txItem?.receipt}
                    </span>
                  )}
                  <div className="receipt-actions">
                    {receiptPreviewUrl && (
                      <a
                        href={receiptPreviewUrl}
                        download={receiptFile?.name ?? txItem?.receipt ?? "receipt"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="secondary compact-btn"
                      >
                        <Download size={13} /> Open / Download
                      </a>
                    )}
                    <button
                      type="button"
                      className="secondary compact-btn danger-outline"
                      disabled={busy}
                      onClick={() => {
                        setReceiptFile(null);
                        setRemoveReceipt(true);
                        setReceiptPreviewUrl("");
                      }}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                  {demo && (
                    <small className="muted">
                      Demo mode: receipt stays in browser memory for this session.
                    </small>
                  )}
                </div>
              )}
            </div>
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
            <div className="form-row">
              <label>
                Account type
                <select
                  name="type"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                >
                  {Object.entries(ACCOUNT_TYPES).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Currency <span className="muted">Optional</span>
                <select
                  name="currency"
                  defaultValue={normalizeCurrencyCode(modal.item?.currency)}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option value={c.code} key={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
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
            {accountType === "credit_card" && (
              <div className="enrichment-section">
                <div className="enrichment-section-head">
                  <span className="field-label">
                    Credit card details <span className="muted">Optional</span>
                  </span>
                </div>
                <div className="form-row">
                  <label>
                    Credit limit (AED)
                    <input
                      inputMode="decimal"
                      name="credit_limit"
                      placeholder="e.g. 25000.00"
                      defaultValue={
                        modal.item?.credit_limit
                          ? (modal.item.credit_limit / 100).toFixed(2)
                          : ""
                      }
                    />
                  </label>
                  <label>
                    Minimum payment (AED)
                    <input
                      inputMode="decimal"
                      name="minimum_payment"
                      placeholder="e.g. 500.00"
                      defaultValue={
                        modal.item?.minimum_payment
                          ? (modal.item.minimum_payment / 100).toFixed(2)
                          : ""
                      }
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Statement day (1–31)
                    <input
                      type="number"
                      min={1}
                      max={31}
                      name="statement_day"
                      placeholder="e.g. 20"
                      defaultValue={modal.item?.statement_day || ""}
                    />
                  </label>
                  <label>
                    Payment due day (1–31)
                    <input
                      type="number"
                      min={1}
                      max={31}
                      name="payment_due_day"
                      placeholder="e.g. 10"
                      defaultValue={modal.item?.payment_due_day || ""}
                    />
                  </label>
                  <label>
                    APR (%)
                    <input
                      inputMode="decimal"
                      name="apr_pct"
                      placeholder="e.g. 29.99"
                      defaultValue={
                        modal.item?.apr_bps
                          ? (modal.item.apr_bps / 100).toFixed(2)
                          : ""
                      }
                    />
                  </label>
                </div>
              </div>
            )}
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
