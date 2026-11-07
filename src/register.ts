import { startingBalance } from "./domain.ts";
import type { Kind, Ledger, Transaction } from "./domain.ts";

/**
 * One line of the transactions register. Most transactions produce one entry.
 * A transfer produces one entry per account it touches, so each side can show
 * its own payment or deposit and running balance.
 */
export interface RegisterEntry {
  key: string;
  tx: Transaction;
  accountId: string;
  /** For transfers: the account on the other side. */
  counterpartyId: string | null;
  /** For transfers: "out" leaves accountId, "in" arrives in accountId. */
  direction: "in" | "out" | null;
  payment: number;
  deposit: number;
  /** Running balance after this entry, in fils. */
  balance: number;
  /** Chronological position, used as the date tie-breaker. */
  seq: number;
}

/**
 * Builds register entries for every transaction in the ledger, with running
 * balances computed over the full history (not just what is filtered).
 * With an account id, only that account's entries are returned and the balance
 * is that account's balance. Without one, the balance is the combined balance
 * of all accounts, and both sides of each transfer are listed.
 */
export function buildRegister(ledger: Ledger, accountId = ""): RegisterEntry[] {
  const inScope = (id: string) => !accountId || id === accountId;
  let running = ledger.accounts
    .filter((a) => inScope(a.id))
    .reduce((sum, a) => sum + startingBalance(a, ledger.transactions), 0);
  const ordered = [...ledger.transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const entries: RegisterEntry[] = [];
  const push = (
    entry: Omit<RegisterEntry, "balance" | "seq" | "key">,
    key: string,
  ) => {
    running += entry.deposit - entry.payment;
    entries.push({ ...entry, key, balance: running, seq: entries.length });
  };
  for (const t of ordered) {
    if (t.type === "transfer" && t.to_account_id) {
      if (inScope(t.account_id))
        push(
          {
            tx: t,
            accountId: t.account_id,
            counterpartyId: t.to_account_id,
            direction: "out",
            payment: t.amount,
            deposit: 0,
          },
          `${t.id}:out`,
        );
      if (inScope(t.to_account_id))
        push(
          {
            tx: t,
            accountId: t.to_account_id,
            counterpartyId: t.account_id,
            direction: "in",
            payment: 0,
            deposit: t.amount,
          },
          `${t.id}:in`,
        );
    } else if (inScope(t.account_id)) {
      push(
        {
          tx: t,
          accountId: t.account_id,
          counterpartyId: null,
          direction: null,
          payment: t.type === "income" ? 0 : t.amount,
          deposit: t.type === "income" ? t.amount : 0,
        },
        t.id,
      );
    }
  }
  return entries;
}

export type SortKey =
  | "date"
  | "payee"
  | "notes"
  | "category"
  | "account"
  | "payment"
  | "deposit"
  | "balance";
export type SortDir = "asc" | "desc";

/** Text shown in the payee column. Transfers show the other account. */
export function entryPayee(entry: RegisterEntry, ledger: Ledger): string {
  if (entry.direction) {
    const other = ledger.accounts.find((a) => a.id === entry.counterpartyId);
    return `${entry.direction === "in" ? "←" : "→"} ${other?.name ?? "Unknown account"}`;
  }
  return entry.tx.payee;
}

/** Text shown in the notes column. A transfer's description lives in payee. */
export function entryNotes(entry: RegisterEntry): string {
  if (entry.direction)
    return [entry.tx.payee, entry.tx.notes].filter(Boolean).join(" · ");
  return entry.tx.notes;
}

export function entryCategory(entry: RegisterEntry, ledger: Ledger): string {
  if (entry.direction) return "Transfer";
  return (
    ledger.categories.find((c) => c.id === entry.tx.category_id)?.name ?? ""
  );
}

export interface RegisterFilters {
  from?: string;
  to?: string;
  search?: string;
  kind?: Kind | "";
  /** A category id, "uncategorized", or "" for all. */
  category?: string;
}

export function filterRegister(
  entries: RegisterEntry[],
  ledger: Ledger,
  { from, to, search = "", kind = "", category = "" }: RegisterFilters,
): RegisterEntry[] {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const accountName = (id: string | null) =>
    ledger.accounts.find((a) => a.id === id)?.name ?? "";
  return entries.filter((e) => {
    const t = e.tx;
    if (from && t.date < from) return false;
    if (to && t.date >= to) return false;
    if (kind && t.type !== kind) return false;
    if (category === "uncategorized") {
      if (t.type === "transfer" || t.category_id) return false;
    } else if (category && t.category_id !== category) return false;
    if (!terms.length) return true;
    const amount = (e.payment || e.deposit) / 100;
    const haystack = [
      t.payee,
      t.notes,
      entryPayee(e, ledger),
      entryCategory(e, ledger),
      accountName(e.accountId),
      accountName(e.counterpartyId),
      amount.toFixed(2),
      t.date,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function sortRegister(
  entries: RegisterEntry[],
  ledger: Ledger,
  key: SortKey,
  dir: SortDir,
): RegisterEntry[] {
  const sign = dir === "asc" ? 1 : -1;
  const accountName = (id: string) =>
    ledger.accounts.find((a) => a.id === id)?.name ?? "";
  const text = (e: RegisterEntry): string =>
    key === "payee"
      ? entryPayee(e, ledger)
      : key === "notes"
        ? entryNotes(e)
        : key === "category"
          ? entryCategory(e, ledger)
          : accountName(e.accountId);
  const compare = (a: RegisterEntry, b: RegisterEntry): number => {
    switch (key) {
      case "date":
      case "balance":
        return 0;
      case "payment":
        return a.payment - b.payment;
      case "deposit":
        return a.deposit - b.deposit;
      default: {
        const ta = text(a),
          tb = text(b);
        // Blank values always sit at the bottom, whichever way you sort.
        if (!ta !== !tb) return (ta ? -1 : 1) * sign;
        return ta.localeCompare(tb, undefined, { sensitivity: "base" });
      }
    }
  };
  return [...entries].sort(
    (a, b) =>
      compare(a, b) * sign ||
      (key === "date" || key === "balance" ? (a.seq - b.seq) * sign : 0) ||
      // Ties fall back to newest first so the list stays predictable.
      b.seq - a.seq,
  );
}
