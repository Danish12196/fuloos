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
  // Dates before the account's balance date are allowed.
  assert.equal(
    editTransaction(income, { date: "2025-12-31" }, ledger).date,
    "2025-12-31",
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

test("rebaseEdit keeps earlier queued changes to other fields", async () => {
  const { rebaseEdit } = await import("../src/bulk.ts");
  const original = { id: "t1", category_id: "a", notes: "", payee: "Shop" };
  const afterFirst = { ...original, category_id: "b" };
  const second = { ...original, notes: "lunch" };
  assert.deepEqual(rebaseEdit(original, second, afterFirst), {
    id: "t1",
    category_id: "b",
    notes: "lunch",
    payee: "Shop",
  });
});

test("sharedFields reports only values every row has in common", async () => {
  const { sharedFields } = await import("../src/bulk.ts");
  const other = { ...income, id: "two", amount: 900, notes: "Other" };
  const shared = sharedFields([income, other]);
  assert.equal(shared.type, "income");
  assert.equal(shared.account_id, "bank");
  assert.equal(shared.to_account_id, null);
  assert.ok("to_account_id" in shared);
  assert.ok(!("amount" in shared));
  assert.ok(!("notes" in shared));
  assert.deepEqual(sharedFields([]), {});
});

test("bulk edits can set one amount on every row", () => {
  assert.equal(editTransaction(income, { amount: 5000 }, ledger).amount, 5000);
  assert.throws(
    () => editTransaction(income, { amount: -1 }, ledger),
    /Amount must be/,
  );
});
