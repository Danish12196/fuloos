import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Download,
  Plus,
  RefreshCw,
  WifiOff,
  X,
} from "lucide-react";
import { errorMessage, today, type Ledger } from "./domain";
import { collectLedgerTags } from "./enrichment";
import { TagInput } from "./TagInput";
import {
  buildQuickAddTransaction,
  pickDefaultAccountId,
  readRememberedAccount,
  saveRememberedAccount,
  type QuickAddDraft,
  type QuickAddKind,
} from "./quickAdd";

export function QuickAddModal({
  ledger,
  initialDraft,
  busy,
  online,
  demo,
  onClose,
  onSave,
  onAddAccount,
}: {
  ledger: Ledger;
  initialDraft?: Partial<QuickAddDraft>;
  busy: boolean;
  online: boolean;
  demo: boolean;
  onClose: () => void;
  onSave: (
    table: "transactions",
    value: Record<string, unknown>,
  ) => Promise<void>;
  onAddAccount: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<QuickAddKind>(
    initialDraft?.type ?? "expense",
  );
  const [amount, setAmount] = useState(initialDraft?.amount ?? "");
  const [accountId, setAccountId] = useState(() =>
    pickDefaultAccountId(
      ledger.accounts,
      initialDraft?.accountId ?? readRememberedAccount(),
    ),
  );
  const [categoryId, setCategoryId] = useState(initialDraft?.categoryId ?? "");
  const [payee, setPayee] = useState(initialDraft?.payee ?? "");
  const [date, setDate] = useState(initialDraft?.date ?? today());
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState("");
  const tagSuggestions = collectLedgerTags(ledger);

  useEffect(() => {
    dialog.current?.showModal();
    amountRef.current?.focus();
  }, []);

  // Keep selected account valid if ledger finishes loading while modal is open.
  useEffect(() => {
    if (!accountId && ledger.accounts.length > 0) {
      setAccountId(
        pickDefaultAccountId(ledger.accounts, readRememberedAccount()),
      );
    }
  }, [accountId, ledger.accounts]);

  const offlineLocked = !online && !demo;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (offlineLocked) {
      setError("You're offline. Reconnect to save this transaction.");
      return;
    }
    try {
      const record = buildQuickAddTransaction(
        { type, amount, accountId, categoryId, payee, date },
        ledger,
      );
      saveRememberedAccount(accountId);
      await onSave("transactions", {
        ...record,
        ...(tags.length > 0 ? { tags } : {}),
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal quick-add-modal"
      aria-labelledby="quick-add-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">QUICK ADD · AED</span>
          <h2 id="quick-add-title">Add transaction</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>

      {offlineLocked && (
        <div className="pwa-inline-notice" role="status">
          <WifiOff size={15} />
          <span>You're offline — reconnect to save changes.</span>
        </div>
      )}

      {ledger.accounts.length === 0 ? (
        <div className="quick-add-empty">
          <p className="muted">
            Create an account first so Fuloos knows where this transaction
            belongs.
          </p>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={offlineLocked}
              onClick={() => {
                onClose();
                onAddAccount();
              }}
            >
              Add account
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="quick-add-form">
          <div className="quick-add-kinds" role="group" aria-label="Type">
            <button
              type="button"
              className={type === "expense" ? "active" : ""}
              onClick={() => setType("expense")}
            >
              <ArrowUpRight size={15} />
              Expense
            </button>
            <button
              type="button"
              className={type === "income" ? "active" : ""}
              onClick={() => setType("income")}
            >
              <ArrowDownLeft size={15} />
              Income
            </button>
          </div>

          <label>
            Amount (AED)
            <input
              ref={amountRef}
              required
              inputMode="decimal"
              name="amount"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          <div className="form-row">
            <label>
              Account
              <select
                name="account_id"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {ledger.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emoji ? `${a.emoji} ` : ""}
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                name="category_id"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Uncategorized</option>
                {ledger.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji ? `${c.emoji} ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-row">
            <label>
              Payee <span className="muted">Optional</span>
              <input
                name="payee"
                maxLength={120}
                placeholder="e.g. Carrefour, DEWA"
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
              />
            </label>
            <label>
              Date
              <input
                required
                type="date"
                name="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>

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
              type="submit"
              className="primary"
              disabled={busy || offlineLocked}
            >
              {busy
                ? "Saving…"
                : offlineLocked
                  ? "Offline"
                  : type === "income"
                    ? "Add income"
                    : "Add expense"}
              <Check size={16} />
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export function QuickAddFab({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="quick-add-fab"
      aria-label="Quick add transaction"
      title="Quick add transaction (N)"
      disabled={disabled}
      onClick={onClick}
    >
      <Plus size={22} />
    </button>
  );
}

export function PwaBanners({
  online,
  demo,
  updateAvailable,
  onApplyUpdate,
  canInstall,
  onInstall,
}: {
  online: boolean;
  demo: boolean;
  updateAvailable: boolean;
  onApplyUpdate: () => void;
  canInstall: boolean;
  onInstall: () => void;
}) {
  if (online && !updateAvailable && !canInstall) return null;

  return (
    <div className="pwa-banners">
      {!online && (
        <div className="pwa-banner pwa-banner-offline" role="status">
          <span>
            <WifiOff size={15} />
            {demo
              ? "You're offline. Demo workspace changes stay in memory."
              : "You're offline. Viewing cached app shell — saving changes is paused until you reconnect."}
          </span>
        </div>
      )}
      {updateAvailable && (
        <div className="pwa-banner pwa-banner-update" role="status">
          <span>
            <RefreshCw size={15} />
            A new version of Fuloos is ready.
          </span>
          <button type="button" onClick={onApplyUpdate}>
            Update now
          </button>
        </div>
      )}
      {canInstall && online && !updateAvailable && (
        <div className="pwa-banner pwa-banner-install">
          <span>
            <Download size={15} />
            Install Fuloos for faster access and quick-add shortcuts.
          </span>
          <button type="button" onClick={onInstall}>
            Install app
          </button>
        </div>
      )}
    </div>
  );
}
