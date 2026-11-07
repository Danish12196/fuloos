import type { Ledger, Transaction } from "./domain";

/** What deleting a set of transactions touches. */
export interface TransactionDeletionPlan {
  /** Transactions that still exist, in ledger order. */
  transactionIds: string[];
  /**
   * Transfers among them. A transfer is one record that shows in both of its
   * accounts, so deleting it removes both sides at once.
   */
  transferIds: string[];
  /** Recurring occurrences recorded with these transactions; the server unlinks them. */
  occurrenceIds: string[];
  /** Accounts whose balance changes. */
  accountIds: string[];
}

export function planTransactionDeletion(
  ledger: Ledger,
  transactionIds: Iterable<string>,
): TransactionDeletionPlan {
  const wanted = new Set(transactionIds);
  const doomed = ledger.transactions.filter((t) => wanted.has(t.id));
  const ids = new Set(doomed.map((t) => t.id));
  const accounts = new Set<string>();
  for (const t of doomed) {
    accounts.add(t.account_id);
    if (t.type === "transfer" && t.to_account_id) accounts.add(t.to_account_id);
  }
  return {
    transactionIds: doomed.map((t) => t.id),
    transferIds: doomed.filter((t) => t.type === "transfer").map((t) => t.id),
    occurrenceIds: (ledger.recurring_occurrences ?? [])
      .filter((o) => ids.has(o.transaction_id))
      .map((o) => o.id),
    accountIds: [...accounts].filter((id) =>
      ledger.accounts.some((a) => a.id === id),
    ),
  };
}

/** Removes the transactions and their recurring links from local state. */
export function applyTransactionDeletion(
  ledger: Ledger,
  ids: Iterable<string>,
): Ledger {
  const gone = new Set(ids);
  return {
    ...ledger,
    transactions: ledger.transactions.filter((t) => !gone.has(t.id)),
    recurring_occurrences: (ledger.recurring_occurrences ?? []).filter(
      (o) => !gone.has(o.transaction_id),
    ),
  };
}

/** Money in, money out and transfers among the transactions, in fils. */
export function deletionTotals(transactions: Transaction[]) {
  let income = 0;
  let expense = 0;
  let transfer = 0;
  for (const t of transactions) {
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") expense += t.amount;
    else transfer += t.amount;
  }
  return { income, expense, transfer };
}
