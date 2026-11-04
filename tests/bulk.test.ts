import { test } from "node:test";
import assert from "node:assert/strict";
import { editTransaction } from "../src/bulk.ts";
import type { Ledger, Transaction } from "../src/domain.ts";
const ledger: Ledger = {
  accounts: ["bank", "card"].map((id) => ({
    id,
    name: id,
    type: "current",
    opening_balance: 0,
    opening_date: "2026-01-01",
    color: "#000000",
  })),
  categories: [{ id: "food", name: "Food", description: "", color: "#000000" }],
  transactions: [],
};
const income: Transaction = {
  id: "one",
  type: "income",
  amount: 1200,
  account_id: "bank",
  to_account_id: null,
  category_id: "food",
  date: "2026-11-04",
  payee: "Payment",
  notes: "Original",
};
test("bulk income-to-transfer conversion clears category and preserves amount", () => {
  const result = editTransaction(
    income,
    { type: "transfer", to_account_id: "card" },
    ledger,
  );
  assert.equal(result.category_id, null);
  assert.equal(result.to_account_id, "card");
  assert.equal(result.amount, 1200);
  assert.equal(income.type, "income");
  assert.throws(
    () => editTransaction(income, { type: "transfer" }, ledger),
    /different accounts/,
  );
  assert.throws(
    () =>
      editTransaction(
        income,
        { type: "transfer", to_account_id: "bank" },
        ledger,
      ),
    /different accounts/,
  );
  assert.throws(
    () =>
      editTransaction(
        income,
        { type: "transfer", to_account_id: "card", category_id: "food" },
        ledger,
      ),
    /cannot have a category/,
  );
});
test("bulk edits preserve untouched fields, support clearing and appending notes, and validate every row", () => {
  assert.deepEqual(
    editTransaction(
      income,
      {
        type: undefined,
        category_id: undefined,
        account_id: undefined,
        date: undefined,
        payee: undefined,
      },
      ledger,
    ),
    income,
  );
  assert.deepEqual(
    editTransaction(
      income,
      { notes: { mode: "append", text: "Reviewed" } },
      ledger,
    ),
    { ...income, notes: "Original\nReviewed" },
  );
  assert.equal(
    editTransaction(
      income,
      { notes: { mode: "replace", text: "" }, category_id: null },
      ledger,
    ).notes,
    "",
  );
  assert.throws(
    () => editTransaction(income, { category_id: "missing" }, ledger),
    /existing category/,
  );
  assert.throws(
    () => editTransaction(income, { date: "2025-12-31" }, ledger),
    /opening date/,
  );
  assert.throws(
    () =>
      editTransaction(
        income,
        { notes: { mode: "append", text: "a".repeat(1000) } },
        ledger,
      ),
    /1,000/,
  );
  assert.throws(
    () => editTransaction(income, { to_account_id: "card" }, ledger),
    /only to transfers/,
  );
  const transfer = editTransaction(
    income,
    { type: "transfer", to_account_id: "card" },
    ledger,
  );
  assert.equal(
    editTransaction(transfer, { type: "expense", category_id: "food" }, ledger)
      .to_account_id,
    null,
  );
});

