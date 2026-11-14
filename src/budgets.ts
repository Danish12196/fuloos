import type { Budget, Category, Ledger, Transaction } from "./domain.ts";
import { transactionCategoryAmounts } from "./enrichment.ts";

export const MAX_BUDGET_AMOUNT = 100_000_000_000;
/** Share of a budget spent before a category is flagged as close to its limit. */
export const NEAR_LIMIT_RATIO = 0.8;

export type BudgetStatus = "under" | "near" | "over";

export interface BudgetProgress {
  category: Category;
  /** Total budget across every month in the range, in fils. */
  budget: number;
  /** Expenses recorded against the category in the range, in fils. */
  actual: number;
  remaining: number;
  /** actual / budget, or Infinity when spending exists against a zero budget. */
  ratio: number;
  status: BudgetStatus;
  /** Months in the range that have an effective budget for this category. */
  budgetedMonths: number;
}

export interface BudgetReport {
  rows: BudgetProgress[];
  totalBudget: number;
  totalActual: number;
  /** Expenses in the range that no budget covers (uncategorised, unbudgeted category or month). */
  unbudgeted: number;
  months: string[];
}

export function isMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const m = Number(value.slice(5));
  return m >= 1 && m <= 12 && value >= "1970-01" && value <= "2100-12";
}

/** Inclusive list of YYYY-MM months between two months. */
export function monthsBetween(start: string, end: string): string[] {
  if (!isMonth(start) || !isMonth(end) || end < start) return [];
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function budgetCovers(budget: Budget, month: string): boolean {
  return (
    budget.start_month <= month &&
    (!budget.end_month || budget.end_month >= month)
  );
}

export function budgetForMonth(
  budgets: Budget[],
  categoryId: string,
  month: string,
): Budget | undefined {
  return budgets.find(
    (b) => b.category_id === categoryId && budgetCovers(b, month),
  );
}

export function budgetsOverlap(
  a: Pick<Budget, "start_month" | "end_month">,
  b: Pick<Budget, "start_month" | "end_month">,
): boolean {
  const aEnd = a.end_month || "9999-12";
  const bEnd = b.end_month || "9999-12";
  return a.start_month <= bEnd && b.start_month <= aEnd;
}

export function validateBudget(
  budget: Omit<Budget, "id"> & { id?: string },
  ledger: Ledger,
): void {
  if (!ledger.categories.some((c) => c.id === budget.category_id))
    throw new Error("Choose an existing category.");
  if (
    !Number.isSafeInteger(budget.amount) ||
    budget.amount < 0 ||
    budget.amount > MAX_BUDGET_AMOUNT
  )
    throw new Error(
      "Budget must be zero or greater and within the supported limit.",
    );
  if (!isMonth(budget.start_month))
    throw new Error("Choose a valid start month.");
  if (budget.end_month !== null) {
    if (!isMonth(budget.end_month))
      throw new Error("Choose a valid end month.");
    if (budget.end_month < budget.start_month)
      throw new Error("End month must be on or after the start month.");
  }
  const clash = (ledger.budgets ?? []).find(
    (b) =>
      b.id !== budget.id &&
      b.category_id === budget.category_id &&
      budgetsOverlap(b, budget),
  );
  if (clash)
    throw new Error(
      `This category already has a budget from ${clash.start_month}${clash.end_month ? ` to ${clash.end_month}` : " onward"}. End that budget first or choose different months.`,
    );
}

/** Status thresholds shared by the budget page and reports. */
export function budgetStatus(budget: number, actual: number): BudgetStatus {
  if (actual > budget) return "over";
  if (budget > 0 && actual * 5 >= budget * 4) return "near";
  return "under";
}

/**
 * Compares budgets with actual expense spending for every month in [startMonth, endMonth].
 * Only expenses count; income and transfers never consume a budget. A category only
 * counts spending from months where it has an effective budget, so budgets added part
 * way through a range are not penalised for earlier months.
 */
export function budgetReport(
  ledger: Ledger,
  startMonth: string,
  endMonth: string,
): BudgetReport {
  const months = monthsBetween(startMonth, endMonth);
  const budgets = ledger.budgets ?? [];
  const monthSet = new Set(months);
  const expenses = ledger.transactions.filter(
    (t): t is Transaction =>
      t.type === "expense" && monthSet.has(t.date.slice(0, 7)),
  );
  const spentByKey = new Map<string, number>();
  for (const t of expenses) {
    const monthKey = t.date.slice(0, 7);
    for (const part of transactionCategoryAmounts(t)) {
      const key = `${part.category_id ?? ""}|${monthKey}`;
      spentByKey.set(key, (spentByKey.get(key) ?? 0) + part.amount);
    }
  }
  const budgetsByCat = new Map<string, Budget[]>();
  for (const b of budgets) {
    const list = budgetsByCat.get(b.category_id);
    if (list) list.push(b);
    else budgetsByCat.set(b.category_id, [b]);
  }
  const rows: BudgetProgress[] = [];
  let covered = 0;
  for (const category of ledger.categories) {
    const catBudgets = budgetsByCat.get(category.id) ?? [];
    if (!catBudgets.length) continue;
    let budget = 0;
    let actual = 0;
    let budgetedMonths = 0;
    for (const month of months) {
      const b = catBudgets.find((item) => budgetCovers(item, month));
      if (!b) continue;
      budgetedMonths++;
      budget += b.amount;
      actual += spentByKey.get(`${category.id}|${month}`) ?? 0;
    }
    if (!budgetedMonths) continue;
    covered += actual;
    rows.push({
      category,
      budget,
      actual,
      remaining: budget - actual,
      ratio: budget > 0 ? actual / budget : actual > 0 ? Infinity : 0,
      status: budgetStatus(budget, actual),
      budgetedMonths,
    });
  }
  const order: Record<BudgetStatus, number> = { over: 0, near: 1, under: 2 };
  rows.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      b.ratio - a.ratio ||
      a.category.name.localeCompare(b.category.name),
  );
  const totalSpent = expenses.reduce((s, t) => s + t.amount, 0);
  return {
    rows,
    totalBudget: rows.reduce((s, r) => s + r.budget, 0),
    totalActual: covered,
    unbudgeted: totalSpent - covered,
    months,
  };
}

/** Categories with expenses in the month but no budget covering it, largest first. */
export function unbudgetedCategories(
  ledger: Ledger,
  month: string,
): { category: Category; actual: number }[] {
  const budgetedCats = new Set<string>();
  for (const b of ledger.budgets ?? []) {
    if (budgetCovers(b, month)) budgetedCats.add(b.category_id);
  }
  const spentByCat = new Map<string, number>();
  for (const t of ledger.transactions) {
    if (t.type === "expense" && t.date.slice(0, 7) === month) {
      for (const part of transactionCategoryAmounts(t)) {
        if (part.category_id && !budgetedCats.has(part.category_id)) {
          spentByCat.set(
            part.category_id,
            (spentByCat.get(part.category_id) ?? 0) + part.amount,
          );
        }
      }
    }
  }
  return ledger.categories
    .filter((c) => !budgetedCats.has(c.id))
    .map((category) => ({
      category,
      actual: spentByCat.get(category.id) ?? 0,
    }))
    .filter((r) => r.actual > 0)
    .sort((a, b) => b.actual - a.actual);
}
