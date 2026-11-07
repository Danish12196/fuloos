import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balance,
  balanceAsOfDate,
  hasBalanceAnchor,
  minor,
  NO_BALANCE_DATE,
  openingDateFor,
  startingBalance,
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
test("dates before the balance date are allowed and categories work for both income and expenses", () => {
  assert.doesNotThrow(() =>
    validateTransaction({ ...t, date: "2025-12-31" }, ledger),
  );
  const withCategory = {
    ...ledger,
    categories: [
      { id: "shared", name: "Family", description: "", color: "#000000" },
    ],
  };
  for (const type of ["income", "expense"] as const) {
    assert.doesNotThrow(() =>
      validateTransaction(
        { ...t, type, to_account_id: null, category_id: "shared" },
        withCategory,
      ),
    );
    assert.throws(() =>
      validateTransaction(
        { ...t, type, to_account_id: null, category_id: "missing" },
        withCategory,
      ),
    );
  }
  assert.throws(() => validateTransaction({ ...t, amount: 1.2 }, ledger));
});

test("a balance as of a date ignores earlier transactions for today's balance and back-fills history", () => {
  // Bank showed 1,000.00 at the end of 2026-03-31.
  const acct: Account = {
    ...a,
    opening_balance: 100000,
    opening_date: openingDateFor("2026-03-31"),
  };
  assert.equal(acct.opening_date, "2026-04-01");
  assert.equal(balanceAsOfDate(acct), "2026-03-31");
  const tx = (date: string, type: "income" | "expense", amount: number) => ({
    ...t,
    id: date + type,
    type,
    amount,
    to_account_id: null,
    date,
  });
  const before = [
    tx("2026-03-31", "expense", 5000),
    tx("2026-02-10", "income", 20000),
  ];
  const after = [tx("2026-04-01", "expense", 2500)];
  // Past transactions are already part of the stated balance.
  assert.equal(balance(acct, before), 100000);
  assert.equal(balance(acct, [...before, ...after]), 97500);
  // History before the date is worked backwards from it.
  assert.equal(startingBalance(acct, before), 100000 + 5000 - 20000);
  // A transfer from another account before the date only shifts history too.
  const transfer = {
    ...t,
    account_id: "b",
    to_account_id: "a",
    date: "2026-01-05",
  };
  assert.equal(balance(acct, [transfer]), 100000);
  assert.equal(startingBalance(acct, [transfer]), 100000 - 10000);
  assert.equal(hasBalanceAnchor(acct), true);
});
test("an account with no balance set is just the sum of its transactions", () => {
  const acct: Account = {
    ...a,
    opening_balance: 0,
    opening_date: NO_BALANCE_DATE,
  };
  assert.equal(hasBalanceAnchor(acct), false);
  const income = {
    ...t,
    type: "income" as const,
    to_account_id: null,
    date: "1999-05-01",
  };
  assert.equal(balance(acct, [income]), 10000);
  assert.equal(startingBalance(acct, [income]), 0);
});
