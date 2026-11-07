import type { Ledger, RecurringSchedule, Transaction } from "./domain";

/** What deleting a set of categories touches. */
export interface CategoryDeletionPlan {
  categoryIds: string[];
  /** Transactions in those categories; they are moved, never deleted. */
  transactionIds: string[];
  /** Recurring schedules in those categories; they are moved too. */
  recurringIds: string[];
  /** Budgets for those categories; the server deletes these with the category. */
  budgetIds: string[];
}

export function planCategoryDeletion(
  ledger: Ledger,
  categoryIds: Iterable<string>,
): CategoryDeletionPlan {
  const known = new Set(ledger.categories.map((c) => c.id));
  const ids = [...new Set(categoryIds)].filter((id) => known.has(id));
  const doomed = new Set(ids);
  const inSet = (id: string | null | undefined) => !!id && doomed.has(id);
  return {
    categoryIds: ids,
    transactionIds: ledger.transactions
      .filter((t) => inSet(t.category_id))
      .map((t) => t.id),
    recurringIds: (ledger.recurring ?? [])
      .filter((r) => inSet(r.category_id))
      .map((r) => r.id),
    budgetIds: (ledger.budgets ?? [])
      .filter((b) => inSet(b.category_id))
      .map((b) => b.id),
  };
}

/**
 * Where moved transactions go: another category's id, or null to leave them
 * uncategorized. The target can't be one of the categories being deleted.
 */
export function validateMoveTarget(
  ledger: Ledger,
  plan: CategoryDeletionPlan,
  target: string | null,
) {
  if (target === null) return;
  if (plan.categoryIds.includes(target))
    throw new Error("Pick a category that isn't being deleted.");
  if (!ledger.categories.some((c) => c.id === target))
    throw new Error("That category no longer exists.");
}

export function movedTransactions(
  ledger: Ledger,
  plan: CategoryDeletionPlan,
  target: string | null,
): Transaction[] {
  const ids = new Set(plan.transactionIds);
  return ledger.transactions
    .filter((t) => ids.has(t.id))
    .map((t) => ({ ...t, category_id: target }));
}

export function movedRecurring(
  ledger: Ledger,
  plan: CategoryDeletionPlan,
  target: string | null,
): RecurringSchedule[] {
  const ids = new Set(plan.recurringIds);
  return (ledger.recurring ?? [])
    .filter((r) => ids.has(r.id))
    .map((r) => ({ ...r, category_id: target }));
}

/** Applies the whole deletion to local state (used in demo mode and after saving). */
export function applyCategoryDeletion(
  ledger: Ledger,
  plan: CategoryDeletionPlan,
  target: string | null,
): Ledger {
  const doomed = new Set(plan.categoryIds);
  const move = <T extends { category_id: string | null }>(row: T): T =>
    row.category_id && doomed.has(row.category_id)
      ? { ...row, category_id: target }
      : row;
  return {
    ...ledger,
    categories: ledger.categories.filter((c) => !doomed.has(c.id)),
    transactions: ledger.transactions.map(move),
    recurring: (ledger.recurring ?? []).map(move),
    budgets: (ledger.budgets ?? []).filter((b) => !doomed.has(b.category_id)),
  };
}
