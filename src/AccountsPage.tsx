import { ArrowRight, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { balance, type Account, type Ledger } from "./domain";
import { ACCOUNT_TYPES, type EditorModalState } from "./EditorModal";
import { Empty } from "./TransactionList";

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
  return (
    <>
      <div className="accounts-summary">
        <span>Total net balance</span>
        <strong>{concealed(net)}</strong>
        <small>
          Credit card debt is shown as a negative balance. Enter a negative
          balance for amounts you owe.
        </small>
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
                  <b>{a.name}</b>
                </button>
                <span className="muted">{ACCOUNT_TYPES[a.type]}</span>
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
          {ledger.accounts.map((a) => (
            <article className="account-card" key={a.id}>
              <div className="account-top">
                <span
                  className="account-symbol"
                  style={{ background: a.color + "18", color: a.color }}
                >
                  {a.emoji || <Wallet size={22} />}
                </span>
                <span className="account-kind">{ACCOUNT_TYPES[a.type]}</span>
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
              <strong className="large-amount">
                {concealed(balance(a, ledger.transactions))}
              </strong>
              <p className="muted small">{balanceNote(a)}</p>
              <button
                className="text-button"
                onClick={() => onSelectAccount(a.id)}
              >
                View transactions <ArrowRight size={15} />
              </button>
            </article>
          ))}
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
    </>
  );
}
