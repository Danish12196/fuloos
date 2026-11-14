import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCategoryTrends,
  computeDeltaAndPct,
  computePayeeBreakdown,
  computeSavingsRate,
  computeYoYComparison,
  periodRangeFromSpan,
  shiftRangeOneYearBack,
} from "../src/reportsAnalytics.ts";
import type { Category, Transaction } from "../src/domain.ts";

const tx = (t: Partial<Transaction> & { id: string }): Transaction => ({
  type: "expense",
  amount: 0,
  account_id: "acc1",
  to_account_id: null,
  category_id: null,
  date: "2026-11-10",
  payee: "",
  notes: "",
  ...t,
});

const categories: Category[] = [
  { id: "groceries", name: "Groceries", description: "", color: "#2d6a4f" },
  { id: "dining", name: "Dining", description: "", color: "#e76f51" },
  { id: "transport", name: "Transport", description: "", color: "#264653" },
  { id: "utilities", name: "Utilities", description: "", color: "#457b9d" },
];

test("computeSavingsRate handles positive, negative, and zero/negative income", () => {
  assert.equal(computeSavingsRate(100_000, 75_000), 25);
  assert.equal(computeSavingsRate(100_000, 100_000), 0);
  assert.equal(computeSavingsRate(100_000, 125_000), -25);
  assert.equal(computeSavingsRate(0, 50_000), null);
  assert.equal(computeSavingsRate(-10_000, 0), null);
});

test("shiftRangeOneYearBack and periodRangeFromSpan handle all spans", () => {
  assert.deepEqual(
    shiftRangeOneYearBack({ firstMonth: "2026-11", lastMonth: "2026-11" }),
    { firstMonth: "2025-11", lastMonth: "2025-11" },
  );
  assert.deepEqual(
    shiftRangeOneYearBack({ firstMonth: "2025-12", lastMonth: "2026-11" }),
    { firstMonth: "2024-12", lastMonth: "2025-11" },
  );
  assert.equal(
    shiftRangeOneYearBack({ firstMonth: null, lastMonth: "2026-11" }),
    null,
  );

  assert.deepEqual(periodRangeFromSpan("month", "2026-11"), {
    firstMonth: "2026-11",
    lastMonth: "2026-11",
  });
  assert.deepEqual(periodRangeFromSpan("ytd", "2026-11"), {
    firstMonth: "2026-01",
    lastMonth: "2026-11",
  });
  assert.deepEqual(periodRangeFromSpan("12", "2026-11"), {
    firstMonth: "2025-12",
    lastMonth: "2026-11",
  });
  assert.deepEqual(periodRangeFromSpan("custom", "2026-11", "2026-08"), {
    firstMonth: "2026-08",
    lastMonth: "2026-11",
  });
  assert.deepEqual(periodRangeFromSpan("all", "2026-11"), {
    firstMonth: null,
    lastMonth: "2026-11",
  });
});

test("computeDeltaAndPct handles zero and negative priors safely", () => {
  assert.deepEqual(computeDeltaAndPct(150_000, 100_000), {
    delta: 50_000,
    pctChange: 50,
  });
  assert.deepEqual(computeDeltaAndPct(50_000, 0), {
    delta: 50_000,
    pctChange: null,
  });
  assert.deepEqual(computeDeltaAndPct(-50_000, -100_000), {
    delta: 50_000,
    pctChange: 50,
  });
});

test("computeYoYComparison compares current period to prior year and excludes transfers", () => {
  const transactions: Transaction[] = [
    // Current period: Nov 2026
    tx({ id: "c1", type: "income", amount: 200_000, date: "2026-11-01", payee: "Employer" }),
    tx({ id: "c2", type: "expense", amount: 120_000, date: "2026-11-05", payee: "Carrefour" }),
    tx({ id: "c3", type: "transfer", amount: 50_000, date: "2026-11-06", to_account_id: "acc2" }),
    // Prior year: Nov 2025
    tx({ id: "p1", type: "income", amount: 160_000, date: "2025-11-01", payee: "Employer" }),
    tx({ id: "p2", type: "expense", amount: 80_000, date: "2025-11-10", payee: "Carrefour" }),
    // Outside both periods
    tx({ id: "o1", type: "expense", amount: 99_999, date: "2026-10-31", payee: "Other" }),
  ];

  const yoy = computeYoYComparison(transactions, {
    firstMonth: "2026-11",
    lastMonth: "2026-11",
  });

  assert.equal(yoy.available, true);
  assert.equal(yoy.hasPriorData, true);
  assert.deepEqual(yoy.priorRange, { firstMonth: "2025-11", lastMonth: "2025-11" });
  assert.deepEqual(yoy.current, {
    income: 200_000,
    expenses: 120_000,
    net: 80_000,
    savingsRatePct: 40,
  });
  assert.deepEqual(yoy.prior, {
    income: 160_000,
    expenses: 80_000,
    net: 80_000,
    savingsRatePct: 50,
  });
  assert.deepEqual(yoy.delta?.income, { delta: 40_000, pctChange: 25 });
  assert.deepEqual(yoy.delta?.expenses, { delta: 40_000, pctChange: 50 });
  assert.deepEqual(yoy.delta?.net, { delta: 0, pctChange: 0 });
  assert.equal(yoy.delta?.savingsRatePts, -10);

  // Empty prior year
  const noPrior = computeYoYComparison(
    transactions.filter((t) => t.date.startsWith("2026")),
    { firstMonth: "2026-11", lastMonth: "2026-11" },
  );
  assert.equal(noPrior.available, true);
  assert.equal(noPrior.hasPriorData, false);
  assert.equal(noPrior.delta?.income.pctChange, null);
  assert.equal(noPrior.delta?.savingsRatePts, null);

  // All-time range
  const allTime = computeYoYComparison(transactions, {
    firstMonth: null,
    lastMonth: "2026-11",
  });
  assert.equal(allTime.available, false);
  assert.equal(allTime.prior, null);
});

test("computePayeeBreakdown aggregates expenses/income, respects splits, and excludes transfers", () => {
  const transactions: Transaction[] = [
    tx({ id: "1", type: "expense", amount: 30_000, payee: "Carrefour", date: "2026-11-02" }),
    tx({
      id: "2",
      type: "expense",
      amount: 20_000,
      payee: "carrefour",
      date: "2026-11-12",
      splits: [
        { category_id: "groceries", amount: 15_000 },
        { category_id: "dining", amount: 5_000 },
      ],
    }),
    tx({ id: "3", type: "expense", amount: 30_000, payee: "DEWA", date: "2026-11-15" }),
    tx({ id: "4", type: "expense", amount: 20_000, payee: "  ", date: "2026-11-18" }),
    tx({ id: "5", type: "transfer", amount: 100_000, payee: "Savings", to_account_id: "acc2", date: "2026-11-20" }),
    tx({ id: "6", type: "income", amount: 500_000, payee: "ACME Corp", date: "2026-11-01" }),
  ];

  const exp = computePayeeBreakdown(
    transactions,
    { firstMonth: "2026-11", lastMonth: "2026-11" },
    { kind: "expense", limit: 2 },
  );
  assert.equal(exp.totalFils, 100_000);
  assert.equal(exp.totalPayees, 3);
  assert.equal(exp.items.length, 2);
  assert.deepEqual(exp.items[0], {
    payee: "Carrefour",
    count: 2,
    totalFils: 50_000,
    averageFils: 25_000,
    sharePct: 50,
  });
  assert.deepEqual(exp.items[1], {
    payee: "DEWA",
    count: 1,
    totalFils: 30_000,
    averageFils: 30_000,
    sharePct: 30,
  });

  const inc = computePayeeBreakdown(
    transactions,
    { firstMonth: "2026-11", lastMonth: "2026-11" },
    { kind: "income" },
  );
  assert.equal(inc.totalFils, 500_000);
  assert.equal(inc.items[0].payee, "ACME Corp");
  assert.equal(inc.items[0].sharePct, 100);
});

test("computeCategoryTrends builds 6-month matrix respecting splits and uncategorized", () => {
  const transactions: Transaction[] = [
    tx({ id: "1", type: "expense", amount: 10_000, category_id: "groceries", date: "2026-06-10" }),
    tx({
      id: "2",
      type: "expense",
      amount: 25_000,
      category_id: null,
      date: "2026-09-10",
      splits: [
        { category_id: "groceries", amount: 15_000 },
        { category_id: "dining", amount: 10_000 },
      ],
    }),
    tx({ id: "3", type: "expense", amount: 12_000, category_id: null, date: "2026-11-05" }),
    tx({ id: "4", type: "income", amount: 90_000, category_id: "groceries", date: "2026-11-05" }),
    tx({ id: "5", type: "transfer", amount: 50_000, to_account_id: "acc2", date: "2026-11-05" }),
    // Outside 6-month window (May 2026)
    tx({ id: "6", type: "expense", amount: 99_000, category_id: "transport", date: "2026-05-20" }),
  ];

  const trends = computeCategoryTrends(transactions, categories, "2026-11", {
    monthsCount: 6,
    topCategories: 5,
  });

  assert.deepEqual(trends.months, [
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
    "2026-11",
  ]);
  assert.deepEqual(trends.monthTotals, [10_000, 0, 0, 25_000, 0, 12_000]);
  assert.equal(trends.maxFils, 15_000);
  assert.equal(trends.categories.length, 3);
  assert.equal(trends.categories[0].name, "Groceries");
  assert.deepEqual(trends.categories[0].monthlyFils, [10_000, 0, 0, 15_000, 0, 0]);
  assert.equal(trends.categories[0].totalFils, 25_000);
  assert.equal(trends.categories[1].name, "Uncategorized");
  assert.equal(trends.categories[1].totalFils, 12_000);
  assert.equal(trends.categories[2].name, "Dining");
  assert.equal(trends.categories[2].totalFils, 10_000);
});
