import { shiftMonth, totals, type Category, type Kind, type Transaction } from "./domain.ts";
import { transactionCategoryAmounts } from "./enrichment.ts";
import { periodMonths, type PeriodSpan } from "./period.ts";

export interface PeriodRange {
  /** First month "YYYY-MM" inclusive, or null for all time. */
  firstMonth: string | null;
  /** Last month "YYYY-MM" inclusive. */
  lastMonth: string;
}

export interface PeriodMetrics {
  income: number;
  expenses: number;
  net: number;
  savingsRatePct: number | null;
}

export interface MetricDelta {
  delta: number;
  pctChange: number | null;
}

export interface YoYComparison {
  available: boolean;
  currentRange: PeriodRange;
  priorRange: PeriodRange | null;
  hasPriorData: boolean;
  current: PeriodMetrics;
  prior: PeriodMetrics | null;
  delta: {
    income: MetricDelta;
    expenses: MetricDelta;
    net: MetricDelta;
    /** Percentage-point difference (current - prior), or null if either rate is null. */
    savingsRatePts: number | null;
  } | null;
}

export interface PayeeBreakdownItem {
  payee: string;
  count: number;
  totalFils: number;
  averageFils: number;
  sharePct: number;
}

export interface PayeeBreakdownResult {
  kind: Exclude<Kind, "transfer">;
  totalFils: number;
  totalPayees: number;
  items: PayeeBreakdownItem[];
}

export interface CategoryTrendSeries {
  categoryId: string;
  name: string;
  color: string;
  totalFils: number;
  averageFils: number;
  monthlyFils: number[];
}

export interface CategoryTrendsResult {
  months: string[];
  categories: CategoryTrendSeries[];
  monthTotals: number[];
  maxFils: number;
}

/**
 * Converts a PeriodSpan + anchor month (+ optional custom start) into a PeriodRange.
 */
export function periodRangeFromSpan(
  span: PeriodSpan,
  month: string,
  from?: string,
): PeriodRange {
  const months = periodMonths(span, month, from);
  if (!months) return { firstMonth: null, lastMonth: month };
  return { firstMonth: months.first, lastMonth: months.last };
}

/**
 * Computes savings rate as `(income - expenses) / income * 100`.
 * Returns `null` when `income <= 0`.
 */
export function computeSavingsRate(
  income: number,
  expenses: number,
): number | null {
  if (income <= 0) return null;
  return ((income - expenses) / income) * 100;
}

/**
 * Shifts a PeriodRange back by 12 months.
 * Returns `null` for all-time ranges (`firstMonth === null`).
 */
export function shiftRangeOneYearBack(range: PeriodRange): PeriodRange | null {
  if (range.firstMonth === null) return null;
  return {
    firstMonth: shiftMonth(range.firstMonth, -12),
    lastMonth: shiftMonth(range.lastMonth, -12),
  };
}

/**
 * Filters transactions falling inside a PeriodRange using half-open `[startIso, endIso)`.
 * For all-time ranges (`firstMonth === null`), returns all transactions.
 */
export function filterTransactionsInRange(
  transactions: ReadonlyArray<Transaction>,
  range: PeriodRange,
): Transaction[] {
  if (range.firstMonth === null) return [...transactions];
  const startIso = `${range.firstMonth}-01`;
  const endIso = `${shiftMonth(range.lastMonth, 1)}-01`;
  return transactions.filter((t) => t.date >= startIso && t.date < endIso);
}

/**
 * Computes absolute delta and percentage change safely when prior is 0.
 */
export function computeDeltaAndPct(
  current: number,
  prior: number,
): MetricDelta {
  const delta = current - prior;
  if (prior === 0) {
    return { delta, pctChange: null };
  }
  return {
    delta,
    pctChange: (delta / Math.abs(prior)) * 100,
  };
}

function metricsFor(transactions: Transaction[]): PeriodMetrics {
  const { income, expense } = totals(transactions);
  return {
    income,
    expenses: expense,
    net: income - expense,
    savingsRatePct: computeSavingsRate(income, expense),
  };
}

/**
 * Compares the selected period against the equivalent prior-year period.
 */
export function computeYoYComparison(
  transactions: ReadonlyArray<Transaction>,
  range: PeriodRange,
): YoYComparison {
  const currentTx = filterTransactionsInRange(transactions, range);
  const current = metricsFor(currentTx);
  const priorRange = shiftRangeOneYearBack(range);

  if (!priorRange) {
    return {
      available: false,
      currentRange: range,
      priorRange: null,
      hasPriorData: false,
      current,
      prior: null,
      delta: null,
    };
  }

  const priorTx = filterTransactionsInRange(transactions, priorRange);
  const prior = metricsFor(priorTx);

  return {
    available: true,
    currentRange: range,
    priorRange,
    hasPriorData: priorTx.length > 0,
    current,
    prior,
    delta: {
      income: computeDeltaAndPct(current.income, prior.income),
      expenses: computeDeltaAndPct(current.expenses, prior.expenses),
      net: computeDeltaAndPct(current.net, prior.net),
      savingsRatePts:
        current.savingsRatePct !== null && prior.savingsRatePct !== null
          ? current.savingsRatePct - prior.savingsRatePct
          : null,
    },
  };
}

/**
 * Breaks down spending or income by merchant/payee within the selected period.
 * Transfers are excluded; split transactions contribute their full non-transfer amount
 * to the transaction's payee.
 */
export function computePayeeBreakdown(
  transactions: ReadonlyArray<Transaction>,
  range: PeriodRange,
  options?: { kind?: Exclude<Kind, "transfer">; limit?: number },
): PayeeBreakdownResult {
  const kind = options?.kind ?? "expense";
  const limit = options?.limit ?? 10;
  const scoped = filterTransactionsInRange(transactions, range);

  const groups = new Map<
    string,
    { payee: string; count: number; totalFils: number }
  >();
  let totalFils = 0;

  for (const t of scoped) {
    if (t.type !== kind) continue;
    const trimmed = (t.payee ?? "").trim();
    const displayPayee = trimmed || "(No payee)";
    const key = displayPayee.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalFils += t.amount;
    } else {
      groups.set(key, {
        payee: displayPayee,
        count: 1,
        totalFils: t.amount,
      });
    }
    totalFils += t.amount;
  }

  const sorted = [...groups.values()].sort(
    (a, b) =>
      b.totalFils - a.totalFils ||
      b.count - a.count ||
      a.payee.localeCompare(b.payee),
  );

  const sliced = limit > 0 ? sorted.slice(0, limit) : sorted;
  const items: PayeeBreakdownItem[] = sliced.map((g) => ({
    payee: g.payee,
    count: g.count,
    totalFils: g.totalFils,
    averageFils: Math.round(g.totalFils / g.count),
    sharePct: totalFils > 0 ? (g.totalFils / totalFils) * 100 : 0,
  }));

  return {
    kind,
    totalFils,
    totalPayees: groups.size,
    items,
  };
}

const UNCATEGORIZED_ID = "__uncategorized__";

/**
 * Computes monthly spending trends for the top expense categories across
 * the last `monthsCount` months ending at `endMonth` (inclusive).
 * Respects split transactions via `transactionCategoryAmounts` and excludes transfers.
 */
export function computeCategoryTrends(
  transactions: ReadonlyArray<Transaction>,
  categories: ReadonlyArray<Category>,
  endMonth: string,
  options?: { monthsCount?: number; topCategories?: number },
): CategoryTrendsResult {
  const monthsCount = Math.max(1, options?.monthsCount ?? 6);
  const topCategories = Math.max(1, options?.topCategories ?? 5);

  const months: string[] = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    months.push(shiftMonth(endMonth, -i));
  }
  const monthIndex = new Map(months.map((m, idx) => [m, idx]));
  const catMeta = new Map(categories.map((c) => [c.id, c]));

  const monthTotals = new Array<number>(monthsCount).fill(0);
  const byCategory = new Map<string, number[]>();

  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const m = t.date.slice(0, 7);
    const idx = monthIndex.get(m);
    if (idx === undefined) continue;

    for (const part of transactionCategoryAmounts(t)) {
      const catId = part.category_id ?? UNCATEGORIZED_ID;
      let arr = byCategory.get(catId);
      if (!arr) {
        arr = new Array<number>(monthsCount).fill(0);
        byCategory.set(catId, arr);
      }
      arr[idx] += part.amount;
      monthTotals[idx] += part.amount;
    }
  }

  const series: CategoryTrendSeries[] = [];
  let maxFils = 0;

  for (const [catId, monthlyFils] of byCategory.entries()) {
    const totalFils = monthlyFils.reduce((s, v) => s + v, 0);
    if (totalFils <= 0) continue;
    const meta = catId === UNCATEGORIZED_ID ? undefined : catMeta.get(catId);
    series.push({
      categoryId: catId,
      name: meta?.name ?? "Uncategorized",
      color: meta?.color ?? "#8e8c84",
      totalFils,
      averageFils: Math.round(totalFils / monthsCount),
      monthlyFils,
    });
  }

  series.sort(
    (a, b) => b.totalFils - a.totalFils || a.name.localeCompare(b.name),
  );
  const top = series.slice(0, topCategories);
  for (const item of top) {
    for (const v of item.monthlyFils) {
      if (v > maxFils) maxFils = v;
    }
  }

  return {
    months,
    categories: top,
    monthTotals,
    maxFils,
  };
}
