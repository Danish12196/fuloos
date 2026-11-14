import assert from "node:assert/strict";
import test from "node:test";
import { demoLedger } from "../src/demo.ts";
import type { Account, Transaction } from "../src/domain.ts";
import {
  accountBalanceAsOf,
  buildNetWorthSeries,
  computeNetWorthSummary,
  validateNetWorthItem,
  validateNetWorthSnapshot,
  type NetWorthItem,
  type NetWorthSnapshot,
} from "../src/netWorth.ts";

const checking: Account = {
  id: "acc-chk",
  name: "Checking",
  type: "current",
  opening_balance: 100000, // 1,000.00 AED on 2026-02-01
  opening_date: "2026-02-01",
  color: "#1d5b48",
};

const card: Account = {
  id: "acc-cc",
  name: "Credit Card",
  type: "credit_card",
  opening_balance: -20000, // -200.00 AED on 2026-02-01
  opening_date: "2026-02-01",
  color: "#b3543b",
};

const txns: Transaction[] = [
  {
    id: "t-pre",
    type: "income",
    amount: 40000,
    account_id: "acc-chk",
    to_account_id: null,
    category_id: null,
    date: "2026-01-20",
    payee: "Bonus",
    notes: "",
  },
  {
    id: "t-post-in",
    type: "income",
    amount: 50000,
    account_id: "acc-chk",
    to_account_id: null,
    category_id: null,
    date: "2026-02-10",
    payee: "Salary",
    notes: "",
  },
  {
    id: "t-cc-spend",
    type: "expense",
    amount: 30000,
    account_id: "acc-cc",
    to_account_id: null,
    category_id: null,
    date: "2026-02-12",
    payee: "Groceries",
    notes: "",
  },
  {
    id: "t-future",
    type: "expense",
    amount: 10000,
    account_id: "acc-chk",
    to_account_id: null,
    category_id: null,
    date: "2026-03-05",
    payee: "Future",
    notes: "",
  },
];

test("accountBalanceAsOf computes exact closing balance before, on, and after opening_date", () => {
  // Before t-pre (2026-01-20): opening_balance (100000) - t-pre (40000) = 60000
  assert.equal(accountBalanceAsOf(checking, txns, "2026-01-19"), 60000);
  // After t-pre, before opening_date: 100000
  assert.equal(accountBalanceAsOf(checking, txns, "2026-01-31"), 100000);
  // On opening_date: 100000
  assert.equal(accountBalanceAsOf(checking, txns, "2026-02-01"), 100000);
  // After t-post-in (2026-02-10): 150000
  assert.equal(accountBalanceAsOf(checking, txns, "2026-02-28"), 150000);
  // Future transaction excluded when asOfDate is 2026-02-28, included on 2026-03-05
  assert.equal(accountBalanceAsOf(checking, txns, "2026-03-05"), 140000);
});

test("computeNetWorthSummary splits cash assets, credit card liabilities, and tracked items", () => {
  const items: NetWorthItem[] = [
    {
      id: "nw-1",
      name: "ETF Portfolio",
      kind: "asset",
      category: "investment",
      current_value: 500000,
      as_of_date: "2026-02-20",
      notes: "",
      color: "#1d5b48",
    },
    {
      id: "nw-2",
      name: "Gold",
      kind: "asset",
      category: "gold",
      current_value: 150000,
      as_of_date: "2026-02-20",
      notes: "",
      color: "#b08448",
    },
    {
      id: "nw-3",
      name: "Auto Loan",
      kind: "liability",
      category: "auto_loan",
      current_value: 200000,
      as_of_date: "2026-02-20",
      notes: "",
      color: "#c06c4c",
    },
  ];

  const summary = computeNetWorthSummary(
    [checking, card],
    txns,
    items,
    "2026-02-28",
  );
  assert.equal(summary.cashAssets, 150000);
  assert.equal(summary.accountLiabilities, 50000); // -20000 - 30000 = -50000
  assert.equal(summary.trackedAssets, 650000);
  assert.equal(summary.trackedLiabilities, 200000);
  assert.equal(summary.totalAssets, 800000);
  assert.equal(summary.totalLiabilities, 250000);
  assert.equal(summary.netWorth, 550000);
});

test("buildNetWorthSeries builds monthly trend using snapshot history and account balances", () => {
  const items: NetWorthItem[] = [
    {
      id: "nw-1",
      name: "ETF Portfolio",
      kind: "asset",
      category: "investment",
      current_value: 500000,
      as_of_date: "2026-02-20",
      notes: "",
      color: "#1d5b48",
    },
    {
      id: "nw-2",
      name: "Auto Loan",
      kind: "liability",
      category: "auto_loan",
      current_value: 200000,
      as_of_date: "2026-02-20",
      notes: "",
      color: "#c06c4c",
    },
  ];
  const snapshots: NetWorthSnapshot[] = [
    {
      id: "s1",
      item_id: "nw-1",
      value: 400000,
      date: "2025-12-15",
      notes: "",
    },
    {
      id: "s2",
      item_id: "nw-1",
      value: 450000,
      date: "2026-01-15",
      notes: "",
    },
    {
      id: "s3",
      item_id: "nw-1",
      value: 500000,
      date: "2026-02-20",
      notes: "",
    },
    {
      id: "s4",
      item_id: "nw-2",
      value: 240000,
      date: "2026-01-10",
      notes: "",
    },
    {
      id: "s5",
      item_id: "nw-2",
      value: 200000,
      date: "2026-02-20",
      notes: "",
    },
  ];

  const series = buildNetWorthSeries(
    [checking, card],
    txns,
    items,
    snapshots,
    6,
    "2026-02-28",
  );
  assert.equal(series.length, 6);
  assert.equal(series[0].month, "2025-09");
  assert.equal(series[5].month, "2026-02");

  // 2025-12: checking = 60000, card = -20000, etf = 400000, loan = 0 -> 440000
  const dec = series.find((p) => p.month === "2025-12")!;
  assert.equal(dec.trackedAssets, 400000);
  assert.equal(dec.trackedLiabilities, 0);
  assert.equal(dec.netWorth, 440000);

  // 2026-01: checking = 100000, card = -20000, etf = 450000, loan = 240000 -> 290000
  const jan = series.find((p) => p.month === "2026-01")!;
  assert.equal(jan.cashAssets, 100000);
  assert.equal(jan.accountLiabilities, 20000);
  assert.equal(jan.trackedAssets, 450000);
  assert.equal(jan.trackedLiabilities, 240000);
  assert.equal(jan.netWorth, 290000);

  // 2026-02 matches computeNetWorthSummary
  const feb = series[5];
  const summary = computeNetWorthSummary(
    [checking, card],
    txns,
    items,
    "2026-02-28",
  );
  assert.equal(feb.netWorth, summary.netWorth);
  assert.equal(feb.totalAssets, summary.totalAssets);
  assert.equal(feb.totalLiabilities, summary.totalLiabilities);
});

test("validateNetWorthItem and validateNetWorthSnapshot enforce domain invariants", () => {
  validateNetWorthItem({
    name: "Gold Bars",
    kind: "asset",
    category: "gold",
    current_value: 0,
    as_of_date: "2026-02-20",
    notes: "",
    color: "#b08448",
  });

  assert.throws(() =>
    validateNetWorthItem({
      name: "   ",
      kind: "asset",
      category: "gold",
      current_value: 100,
      as_of_date: "2026-02-20",
      notes: "",
      color: "#b08448",
    }),
  );

  assert.throws(() =>
    validateNetWorthItem({
      name: "Mismatch",
      kind: "asset",
      category: "mortgage",
      current_value: 100,
      as_of_date: "2026-02-20",
      notes: "",
      color: "#b08448",
    }),
  );

  assert.throws(() =>
    validateNetWorthItem({
      name: "Negative",
      kind: "liability",
      category: "auto_loan",
      current_value: -1,
      as_of_date: "2026-02-20",
      notes: "",
      color: "#b08448",
    }),
  );

  validateNetWorthSnapshot({
    item_id: "nw-1",
    value: 12345,
    date: "2026-02-20",
    notes: "Monthly check",
  });

  assert.throws(() =>
    validateNetWorthSnapshot({
      item_id: "",
      value: 100,
      date: "2026-02-20",
      notes: "",
    }),
  );

  assert.throws(() =>
    validateNetWorthSnapshot({
      item_id: "nw-1",
      value: 100.5,
      date: "2026-02-20",
      notes: "",
    }),
  );

  assert.throws(() =>
    validateNetWorthSnapshot({
      item_id: "nw-1",
      value: 100,
      date: "2026-02-30",
      notes: "",
    }),
  );
});

test("demoLedger contains valid net worth items and snapshots", () => {
  const ledger = demoLedger();
  assert.ok((ledger.net_worth_items?.length ?? 0) >= 3);
  assert.ok((ledger.net_worth_snapshots?.length ?? 0) >= 3);
  for (const item of ledger.net_worth_items ?? []) {
    validateNetWorthItem(item);
  }
  for (const snap of ledger.net_worth_snapshots ?? []) {
    validateNetWorthSnapshot(snap);
  }
});
