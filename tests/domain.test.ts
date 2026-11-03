import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balance,
  minor,
  totals,
  validateTransaction,
  type Account,
  type Ledger,
  type Transaction,
} from "../src/domain.ts";
const a: Account = {
  id: "a",
  name: "Current",
  type: "current",
  opening_balance: 100000,
  opening_date: "2026-01-01",
  color: "#000000",
};
const b: Account = {
  ...a,
  id: "b",
  name: "Card",
  type: "credit_card",
  opening_balance: -20000,
};
const t: Transaction = {
  id: "t",
  type: "transfer",
  amount: 10000,
  account_id: "a",
  to_account_id: "b",
  category_id: null,
  date: "2026-01-02",
  payee: "Repayment",
  notes: "",
};
const ledger: Ledger = { accounts: [a, b], categories: [], transactions: [] };
test("decimal entry uses exact fils, including negative opening balances", () => {
  assert.equal(minor("0.29"), 29);
  assert.equal(minor("-1240.99"), -124099);
  assert.equal(minor("1.1"), 110);
  for (const value of ["1.001", "NaN", "1e4", "", "Infinity"])
    assert.throws(() => minor(value));
});
test("credit repayment decreases cash and debt, conserving net balance", () => {
  assert.equal(balance(a, [t]), 90000);
  assert.equal(balance(b, [t]), -10000);
  assert.equal(balance(a, [t]) + balance(b, [t]), 80000);
  assert.deepEqual(totals([t]), { income: 0, expense: 0 });
});
test("opening balances are not income; expense and income affect only the selected account", () => {
  assert.deepEqual(totals([]), { income: 0, expense: 0 });
  const expense = {
    ...t,
    type: "expense" as const,
    to_account_id: null,
    amount: 29,
  };
  const income = { ...expense, type: "income" as const, amount: 110 };
  assert.equal(balance(a, [expense, income]), 100081);
  assert.equal(balance(b, [expense, income]), -20000);
  assert.deepEqual(totals([expense, income, t]), { income: 110, expense: 29 });
});
test("transfer validation rejects self transfers, missing destinations and categories", () => {
  assert.doesNotThrow(() => validateTransaction(t, ledger));
  assert.throws(() =>
    validateTransaction({ ...t, to_account_id: "a" }, ledger),
  );
  assert.throws(() =>
    validateTransaction({ ...t, to_account_id: null }, ledger),
  );
  assert.throws(() => validateTransaction({ ...t, category_id: "x" }, ledger));
});
test("pre-opening transactions and incompatible category types are rejected", () => {
  assert.throws(() =>
    validateTransaction({ ...t, date: "2025-12-31" }, ledger),
  );
  assert.throws(() =>
    validateTransaction(
      { ...t, type: "expense", to_account_id: null, category_id: "salary" },
      {
        ...ledger,
        categories: [
          {
            id: "salary",
            name: "Salary",
            type: "income",
            description: "",
            color: "#000000",
          },
        ],
      },
    ),
  );
  assert.throws(() => validateTransaction({ ...t, amount: 1.2 }, ledger));
});
