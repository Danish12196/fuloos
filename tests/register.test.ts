import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRegister,
  entryCategory,
  entryNotes,
  entryPayee,
  filterRegister,
  sortRegister,
} from "../src/register.ts";
import type { Ledger, Transaction } from "../src/domain.ts";

const tx = (t: Partial<Transaction> & { id: string }): Transaction => ({
  type: "expense",
  amount: 0,
  account_id: "card",
  to_account_id: null,
  category_id: null,
  date: "2026-11-01",
  payee: "",
  notes: "",
  ...t,
});

const ledger: Ledger = {
  accounts: [
    {
      id: "card",
      name: "Credit card",
      type: "credit_card",
      opening_balance: -100000,
      opening_date: "2026-01-01",
      color: "#000",
    },
    {
      id: "joint",
      name: "Joint Bank Account",
      type: "current",
      opening_balance: 500000,
      opening_date: "2026-01-01",
      color: "#000",
    },
  ],
  categories: [
    { id: "food", name: "Food", description: "", color: "#000" },
    { id: "health", name: "Healthcare", description: "", color: "#000" },
  ],
  transactions: [
    tx({
      id: "a",
      amount: 4200,
      category_id: "health",
      payee: "American Hospital",
      notes: "AMERICAN HOSPITAL DUBAI",
      date: "2026-11-02",
    }),
    tx({
      id: "b",
      type: "transfer",
      amount: 50000,
      account_id: "joint",
      to_account_id: "card",
      payee: "Credit Card Bill Payment",
      date: "2026-11-03",
    }),
    tx({ id: "c", amount: 1800, notes: "Noon 800", date: "2026-11-04" }),
    tx({
      id: "d",
      type: "income",
      amount: 900,
      account_id: "joint",
      category_id: "food",
      payee: "Refund",
      date: "2026-11-01",
    }),
  ],
};

test("account register shows the account's running balance and one side of each transfer", () => {
  const entries = buildRegister(ledger, "card");
  assert.deepEqual(
    entries.map((e) => [e.key, e.payment, e.deposit, e.balance]),
    [
      ["a", 4200, 0, -104200],
      ["b:in", 0, 50000, -54200],
      ["c", 1800, 0, -56000],
    ],
  );
  const transfer = entries[1];
  assert.equal(entryPayee(transfer, ledger), "← Joint Bank Account");
  assert.equal(entryNotes(transfer), "Credit Card Bill Payment");
  assert.equal(entryCategory(transfer, ledger), "Transfer");
});

test("all-accounts register lists both transfer sides and a combined balance", () => {
  const entries = buildRegister(ledger);
  assert.deepEqual(
    entries.map((e) => [e.key, e.balance]),
    [
      ["d", 400900],
      ["a", 396700],
      ["b:out", 346700],
      ["b:in", 396700],
      ["c", 394900],
    ],
  );
  assert.equal(entryPayee(entries[2], ledger), "→ Credit card");
});

test("filters by period, kind, category, uncategorized and search terms", () => {
  const entries = buildRegister(ledger);
  const keys = (f: Parameters<typeof filterRegister>[2]) =>
    filterRegister(entries, ledger, f).map((e) => e.key);
  assert.deepEqual(keys({ from: "2026-11-03", to: "2026-11-04" }), [
    "b:out",
    "b:in",
  ]);
  assert.deepEqual(keys({ kind: "income" }), ["d"]);
  assert.deepEqual(keys({ category: "health" }), ["a"]);
  assert.deepEqual(keys({ category: "uncategorized" }), ["c"]);
  assert.deepEqual(keys({ search: "joint bill" }), ["b:out", "b:in"]);
  assert.deepEqual(keys({ search: "42.00" }), ["a"]);
});

test("sorts by columns with blanks last and newest-first ties", () => {
  const entries = buildRegister(ledger, "card");
  const keys = (k: Parameters<typeof sortRegister>[2], d: "asc" | "desc") =>
    sortRegister(entries, ledger, k, d).map((e) => e.key);
  assert.deepEqual(keys("date", "desc"), ["c", "b:in", "a"]);
  assert.deepEqual(keys("date", "asc"), ["a", "b:in", "c"]);
  assert.deepEqual(keys("payment", "desc"), ["a", "c", "b:in"]);
  assert.deepEqual(keys("payee", "asc"), ["b:in", "a", "c"]);
  assert.deepEqual(keys("payee", "desc"), ["a", "b:in", "c"]);
});
