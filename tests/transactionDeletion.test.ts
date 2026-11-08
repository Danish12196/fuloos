import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTransactionDeletion,
  deletionTotals,
  planTransactionDeletion,
} from "../src/transactionDeletion.ts";
import { emptyLedger, type Ledger, type Transaction } from "../src/domain.ts";

const tx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  type: "expense",
  amount: 100,
  account_id: "cur",
  to_account_id: null,
  category_id: null,
  date: "2026-11-01",
  payee: "",
  notes: "",
  ...extra,
});

const ledger: Ledger = {
  ...emptyLedger,
  accounts: [
    { id: "cur", name: "Current", type: "bank", opening_balance: 0 } as never,
    { id: "card", name: "Card", type: "credit", opening_balance: 0 } as never,
    { id: "save", name: "Savings", type: "bank", opening_balance: 0 } as never,
  ],
  transactions: [
    tx("a"),
    tx("b", { type: "income", amount: 500, account_id: "save" }),
    tx("t", { type: "transfer", amount: 300, to_account_id: "card" }),
    tx("keep"),
  ],
  recurring_occurrences: [
    { id: "o1", recurring_id: "r", occurrence_date: "2026-11-01", transaction_id: "a" },
    { id: "o2", recurring_id: "r", occurrence_date: "2026-10-01", transaction_id: "keep" },
  ],
};

test("plans only transactions that still exist", () => {
  const plan = planTransactionDeletion(ledger, ["a", "t", "gone"]);
  assert.deepEqual(plan.transactionIds, ["a", "t"]);
  assert.deepEqual(plan.transferIds, ["t"]);
  assert.deepEqual(plan.occurrenceIds, ["o1"]);
});

test("a transfer touches both of its accounts", () => {
  const plan = planTransactionDeletion(ledger, ["t"]);
  assert.deepEqual(plan.accountIds.sort(), ["card", "cur"]);
});

test("applying removes the rows and their recurring links only", () => {
  const next = applyTransactionDeletion(ledger, ["a", "t"]);
  assert.deepEqual(
    next.transactions.map((t) => t.id),
    ["b", "keep"],
  );
  assert.deepEqual(
    next.recurring_occurrences?.map((o) => o.id),
    ["o2"],
  );
  assert.equal(ledger.transactions.length, 4, "input is not mutated");
});

test("totals split spending, income and transfers", () => {
  assert.deepEqual(deletionTotals(ledger.transactions), {
    income: 500,
    expense: 200,
    transfer: 300,
  });
});
