import type { Ledger } from "./domain";

/** The exact text a person must type to delete a money account. */
export function deleteAccountPhrase(name: string): string {
  return `Delete account ${name.trim()}`;
}

/** Only an exact match (ignoring spaces around it) counts; case matters. */
export function confirmsAccountDeletion(typed: string, name: string): boolean {
  return typed.trim() === deleteAccountPhrase(name);
}

export interface AccountDeletionPlan {
  /** Every transaction on this account, including transfers in or out of it. */
  transactionIds: string[];
  /** How many of those are transfers, which also disappear from the other account. */
  transferCount: number;
  /** Recurring schedules that charge this account; they can't outlive it. */
  recurringIds: string[];
}

export function planAccountDeletion(
  ledger: Ledger,
  accountId: string,
): AccountDeletionPlan {
  const transactions = ledger.transactions.filter(
    (t) => t.account_id === accountId || t.to_account_id === accountId,
  );
  return {
    transactionIds: transactions.map((t) => t.id),
    transferCount: transactions.filter((t) => t.type === "transfer").length,
    recurringIds: (ledger.recurring ?? [])
      .filter((r) => r.account_id === accountId)
      .map((r) => r.id),
  };
}

/** Removes the account and everything planned for deletion from local state. */
export function applyAccountDeletion(
  ledger: Ledger,
  accountId: string,
  plan: AccountDeletionPlan,
): Ledger {
  const transactions = new Set(plan.transactionIds);
  const recurring = new Set(plan.recurringIds);
  return {
    ...ledger,
    accounts: ledger.accounts.filter((a) => a.id !== accountId),
    transactions: ledger.transactions.filter((t) => !transactions.has(t.id)),
    recurring: (ledger.recurring ?? []).filter((r) => !recurring.has(r.id)),
    recurring_occurrences: (ledger.recurring_occurrences ?? []).filter(
      (o) =>
        !transactions.has(o.transaction_id) && !recurring.has(o.recurring_id),
    ),
  };
}
