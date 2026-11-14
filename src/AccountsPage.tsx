import { useState } from "react";
import {
  ArrowRight,
  Calculator,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { computeCardSummary, type CardSummary } from "./debtTools";
import { DebtToolsModal } from "./DebtToolsModal";
import { balance, today, type Account, type Ledger } from "./domain";
import { ACCOUNT_TYPES, type EditorModalState } from "./EditorModal";
import { Empty } from "./TransactionList";

function formatShortWindow(start: string, end: string): string {
  return `${start.slice(5)} – ${end.slice(5)}`;
}

function dueBadgeText(summary: CardSummary): string | null {
  if (!summary.nextDueDate || summary.daysUntilDue === null) return null;
  if (summary.daysUntilDue === 0) return "Due today";
  if (summary.daysUntilDue === 1) return "Due tomorrow";
  if (summary.daysUntilDue <= 14) return `Due in ${summary.daysUntilDue}d`;
  return `Due ${summary.nextDueDate.slice(5)}`;
}

function dueBadgeClass(summary: CardSummary): string {
  if (summary.daysUntilDue === null) return "cc-due-badge";
  if (summary.daysUntilDue <= 2) return "cc-due-badge is-urgent";
  if (summary.daysUntilDue <= 7) return "cc-due-badge is-soon";
  return "cc-due-badge";
}

function utilFillClass(pct: number): string {
  if (pct >= 70) return "cc-util-fill is-high";
  if (pct >= 30) return "cc-util-fill is-warn";
  return "cc-util-fill";
}

export function AccountsPage({
  ledger,
  net,
  density,
  busy,
  concealed,
  balanceNote,
  onSelectAccount,
  onOpenModal,
  onDeleteAccount,
}: {
  ledger: Ledger;
  net: number;
  density: "compact" | "relaxed";
  busy: boolean;
  concealed: (v: number) => string;
  balanceNote: (a: Account, short?: boolean) => string;
  onSelectAccount: (accountId: string) => void;
  onOpenModal: (modal: EditorModalState) => void;
  onDeleteAccount: (account: Account) => void;
}) {
  const [debtToolsOpen, setDebtToolsOpen] = useState(false);
  const todayIso = today();

  return (
    <>
      <div className="accounts-summary accounts-summary-bar">
        <div>
          <span>Total net balance</span>
          <strong>{concealed(net)}</strong>
          <small>
            Credit card debt is shown as a negative balance. Enter a negative
            balance for amounts you owe.
          </small>
        </div>
        <div className="accounts-summary-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => setDebtToolsOpen(true)}
          >
            <Calculator size={16} /> Debt payoff planner
          </button>
        </div>
      </div>
      {density === "compact" ? (
        <section className="panel compact-list">
          <div className="compact-head accounts" aria-hidden>
            <span>Account</span>
            <span>Type</span>
            <span>Balance set</span>
            <span className="num">Balance</span>
            <span />
          </div>
          {ledger.accounts.map((a) => {
            const value = balance(a, ledger.transactions);
            const cardSummary =
              a.type === "credit_card"
                ? computeCardSummary(a, value, ledger.transactions, todayIso)
                : null;
            const dueLabel = cardSummary ? dueBadgeText(cardSummary) : null;
            return (
              <div className="compact-row accounts" key={a.id}>
                <button
                  className="compact-name"
                  onClick={() => onSelectAccount(a.id)}
                  title={`View ${a.name} transactions`}
                >
                  <span
                    className="compact-symbol"
                    style={{
                      background: a.color + "18",
                      color: a.color,
                    }}
                  >
                    {a.emoji || <Wallet size={15} />}
                  </span>
                  <span>
                    <b>{a.name}</b>
                    {cardSummary &&
                      (cardSummary.creditLimitFils > 0 || dueLabel) && (
                        <span className="compact-cc-sub">
                          {cardSummary.creditLimitFils > 0 && (
                            <span>
                              {cardSummary.utilizationPct.toFixed(0)}% used ·{" "}
                              {concealed(cardSummary.availableCreditFils)} avail
                            </span>
                          )}
                          {dueLabel && (
                            <span className={dueBadgeClass(cardSummary)}>
                              {dueLabel}
                            </span>
                          )}
                        </span>
                      )}
                  </span>
                </button>
                <span className="muted">
                  {ACCOUNT_TYPES[a.type]}
                  {a.currency && a.currency !== "AED" ? ` · ${a.currency}` : ""}
                </span>
                <span className="muted">{balanceNote(a, true)}</span>
                <strong className={`num ${value < 0 ? "is-negative" : ""}`}>
                  {concealed(value)}
                </strong>
                <span className="compact-actions">
                  <button
                    className="icon-button"
                    aria-label={`Edit ${a.name}`}
                    onClick={() => onOpenModal({ kind: "account", item: a })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={`Delete ${a.name}`}
                    onClick={() => onDeleteAccount(a)}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            );
          })}
          {!ledger.accounts.length && (
            <Empty
              title="No accounts yet"
              text="Add a current, savings, credit card or cash account."
            />
          )}
        </section>
      ) : (
        <div className="account-grid full">
          {ledger.accounts.map((a) => {
            const value = balance(a, ledger.transactions);
            const cardSummary =
              a.type === "credit_card"
                ? computeCardSummary(a, value, ledger.transactions, todayIso)
                : null;
            const dueLabel = cardSummary ? dueBadgeText(cardSummary) : null;
            return (
              <article className="account-card" key={a.id}>
                <div className="account-top">
                  <span
                    className="account-symbol"
                    style={{ background: a.color + "18", color: a.color }}
                  >
                    {a.emoji || <Wallet size={22} />}
                  </span>
                  <span className="account-kind">
                    {ACCOUNT_TYPES[a.type]}
                    {a.currency && a.currency !== "AED" ? ` · ${a.currency}` : ""}
                  </span>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      aria-label={`Edit ${a.name}`}
                      onClick={() => onOpenModal({ kind: "account", item: a })}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={`Delete ${a.name}`}
                      onClick={() => onDeleteAccount(a)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <h3>{a.name}</h3>
                <strong className="large-amount">{concealed(value)}</strong>
                <p className="muted small">{balanceNote(a)}</p>
                {cardSummary && (
                  <div className="cc-meta">
                    {cardSummary.creditLimitFils > 0 && (
                      <>
                        <div className="cc-util-row">
                          <span>
                            Utilization{" "}
                            <b>{cardSummary.utilizationPct.toFixed(1)}%</b>
                          </span>
                          <span>
                            {concealed(cardSummary.availableCreditFils)}{" "}
                            available
                          </span>
                        </div>
                        <div
                          className="cc-util-bar"
                          role="progressbar"
                          aria-valuenow={Math.min(
                            100,
                            Math.round(cardSummary.utilizationPct),
                          )}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${a.name} credit utilization`}
                        >
                          <div
                            className={utilFillClass(cardSummary.utilizationPct)}
                            style={{
                              width: `${Math.min(100, cardSummary.utilizationPct)}%`,
                            }}
                          />
                        </div>
                      </>
                    )}
                    <div className="cc-details-row">
                      <span>
                        Cycle{" "}
                        {formatShortWindow(
                          cardSummary.statementWindow.start,
                          cardSummary.statementWindow.end,
                        )}
                        :{" "}
                        <b>{concealed(cardSummary.statementBalanceFils)}</b>
                      </span>
                      {dueLabel && (
                        <span className={dueBadgeClass(cardSummary)}>
                          {dueLabel}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <button
                  className="text-button"
                  onClick={() => onSelectAccount(a.id)}
                >
                  View transactions <ArrowRight size={15} />
                </button>
              </article>
            );
          })}
          <button
            className="add-account-card"
            onClick={() => onOpenModal({ kind: "account" })}
          >
            <span>
              <Plus size={22} />
            </span>
            <b>Add an account</b>
            <small>Current, savings, credit card or cash</small>
          </button>
        </div>
      )}
      {debtToolsOpen && (
        <DebtToolsModal
          ledger={ledger}
          concealed={concealed}
          onClose={() => setDebtToolsOpen(false)}
        />
      )}
    </>
  );
}
