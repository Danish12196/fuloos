import { useMemo } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ReceiptText,
  Trash2,
} from "lucide-react";
import {
  startingBalance,
  type Ledger,
  type Transaction,
} from "./domain";

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <ReceiptText size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function TransactionList({
  items,
  ledger,
  concealed,
  onEdit,
  onDelete,
  busy,
  selected,
  onSelect,
}: {
  selected?: Set<string>;
  onSelect?: (id: string) => void;
  items: Transaction[];
  ledger: Ledger;
  concealed: (v: number) => string;
  onEdit: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
  busy?: boolean;
}) {
  const accountById = useMemo(
    () => new Map(ledger.accounts.map((a) => [a.id, a])),
    [ledger.accounts],
  );
  const categoryById = useMemo(
    () => new Map(ledger.categories.map((c) => [c.id, c])),
    [ledger.categories],
  );
  const balances = useMemo(() => {
    const result = new Map<string, { source: number; destination: number }>();
    const running = new Map(
      ledger.accounts.map((a) => [
        a.id,
        startingBalance(a, ledger.transactions),
      ]),
    );
    // IDs provide a consistent order where only a transaction date is available.
    for (const t of [...ledger.transactions].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    )) {
      running.set(
        t.account_id,
        (running.get(t.account_id) ?? 0) +
          (t.type === "income" ? t.amount : -t.amount),
      );
      if (t.to_account_id)
        running.set(
          t.to_account_id,
          (running.get(t.to_account_id) ?? 0) + t.amount,
        );
      result.set(t.id, {
        source: running.get(t.account_id) ?? 0,
        destination: t.to_account_id ? (running.get(t.to_account_id) ?? 0) : 0,
      });
    }
    return result;
  }, [ledger.accounts, ledger.transactions]);
  return items.length ? (
    <div className="transaction-list">
      {items.map((t) => {
        const category = t.category_id
          ? categoryById.get(t.category_id)
          : undefined;
        const account = accountById.get(t.account_id);
        const toAccount = t.to_account_id
          ? accountById.get(t.to_account_id)
          : undefined;
        return (
          <div
            className={`transaction-row ${selected?.has(t.id) ? "is-selected" : ""}`}
            key={t.id}
          >
            {onSelect && (
              <input
                className="transaction-select"
                type="checkbox"
                aria-label={`Select ${t.payee || "transaction"} on ${t.date}`}
                disabled={busy}
                checked={selected?.has(t.id) ?? false}
                onChange={() => onSelect(t.id)}
              />
            )}
            <button
              className="transaction-main"
              disabled={busy}
              onClick={() => onEdit(t)}
            >
              <span
                className={`transaction-icon ${t.type}`}
                style={
                  category
                    ? {
                        background: category.color + "15",
                        color: category.color,
                      }
                    : undefined
                }
              >
                {t.type === "transfer" ? (
                  <ArrowLeftRight size={19} />
                ) : t.type === "income" ? (
                  <ArrowDownLeft size={19} />
                ) : (
                  <ReceiptText size={19} />
                )}
              </span>
              <span className="transaction-description">
                <b>
                  {t.payee ||
                    (t.type === "transfer"
                      ? "Account transfer"
                      : "Transaction")}
                </b>
                <small>
                  {t.type === "transfer"
                    ? `${account?.name} → ${toAccount?.name}`
                    : `${category?.name ?? "Uncategorized"} · ${account?.name}`}
                </small>
              </span>
              <span className="transaction-value">
                <small>
                  {account?.name}: {concealed(balances.get(t.id)?.source ?? 0)}{" "}
                  balance
                </small>
                {t.to_account_id && (
                  <small>
                    {toAccount?.name}:{" "}
                    {concealed(balances.get(t.id)?.destination ?? 0)} balance
                  </small>
                )}
                <b className={t.type === "income" ? "green-text" : ""}>
                  {t.type === "income" ? "+" : t.type === "expense" ? "−" : ""}
                  {concealed(t.amount)}
                </b>
                <small>
                  {new Date(t.date + "T12:00:00Z").toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    timeZone: "Asia/Dubai",
                  })}
                </small>
              </span>
            </button>
            {onDelete && (
              <button
                disabled={busy}
                className="icon-button delete"
                aria-label={`Delete ${t.payee || "transaction"}`}
                onClick={() => onDelete(t)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  ) : (
    <Empty
      title="A fresh start"
      text="Add your first transaction, or try a different month or filter."
    />
  );
}
