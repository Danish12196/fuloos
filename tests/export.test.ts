import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeCsvCell,
  formatFils,
  reportToCsv,
  transactionsToCsv,
} from "../src/export.ts";
import type { BudgetReport } from "../src/budgets.ts";
import type { Ledger } from "../src/domain.ts";

test("formatFils formats integer fils as exact AED decimals", () => {
  assert.equal(formatFils(0), "0.00");
  assert.equal(formatFils(5), "0.05");
  assert.equal(formatFils(12345), "123.45");
  assert.equal(formatFils(-500), "-5.00");
  assert.equal(formatFils(-7), "-0.07");
});

test("escapeCsvCell guards against CSV formula injection and quotes RFC 4180 characters", () => {
  assert.equal(escapeCsvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(escapeCsvCell("+971501234567"), "'+971501234567");
  assert.equal(escapeCsvCell("-10% off"), "'-10% off");
  assert.equal(escapeCsvCell("@evil"), "'@evil");
  assert.equal(escapeCsvCell("\tcmd"), "'\tcmd");
  assert.equal(escapeCsvCell("  =1+1"), "'  =1+1");
  assert.equal(escapeCsvCell("Carrefour, Dubai"), '"Carrefour, Dubai"');
  assert.equal(escapeCsvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(escapeCsvCell("=1+1,2"), `"'=1+1,2"`);
  assert.equal(escapeCsvCell("-123.45", { numeric: true }), "-123.45");
  assert.equal(escapeCsvCell("-1+1", { numeric: true }), "'-1+1");
});

test("transactionsToCsv exports filtered transactions with account/category names and formula protection", () => {
  const ledger: Ledger = {
    accounts: [
      {
        id: "acc1",
        name: "ADCB Current",
        type: "current",
        opening_balance: 0,
        opening_date: "2026-01-01",
        color: "#2d6a4f",
      },
      {
        id: "acc2",
        name: "Liv Savings",
        type: "savings",
        opening_balance: 0,
        opening_date: "2026-01-01",
        color: "#1b4332",
      },
    ],
    categories: [
      {
        id: "cat1",
        name: "Groceries",
        description: "",
        color: "#40916c",
      },
    ],
    transactions: [
      {
        id: "tx1",
        type: "expense",
        amount: 4599,
        account_id: "acc1",
        to_account_id: null,
        category_id: "cat1",
        date: "2026-03-01",
        payee: "=HYPERLINK(\"http://evil.test\")",
        notes: "Weekly shop, line 1\nline 2",
      },
      {
        id: "tx2",
        type: "transfer",
        amount: 100000,
        account_id: "acc1",
        to_account_id: "acc2",
        category_id: null,
        date: "2026-03-02",
        payee: "@transfer",
        notes: "",
      },
    ],
  };

  const csv = transactionsToCsv(ledger.transactions, ledger);
  const lines = csv.split("\r\n");
  assert.equal(
    lines[0],
    "Date,Type,Amount (AED),Account,To Account,Category,Payee,Notes,Currency,Original Amount,Original Currency,FX Rate",
  );
  assert.ok(lines[1].includes("2026-03-01,expense,45.99,ADCB Current,,Groceries,"));
  assert.ok(lines[1].includes("'=HYPERLINK("));
  assert.ok(lines[1].includes('"Weekly shop, line 1\nline 2"'));
  assert.equal(
    lines[2],
    "2026-03-02,transfer,1000.00,ADCB Current,Liv Savings,,'@transfer,,AED,,,",
  );

  const subsetCsv = transactionsToCsv([ledger.transactions[1]], ledger);
  assert.equal(subsetCsv.trim().split("\r\n").length, 2);
});

test("reportToCsv exports summary, category spending, and budget vs actual", () => {
  const budgetRep: BudgetReport = {
    months: ["2026-03"],
    totalBudget: 100000,
    totalActual: 120000,
    unbudgeted: 5000,
    rows: [
      {
        category: {
          id: "cat1",
          name: "=Dining",
          description: "",
          color: "#40916c",
        },
        budget: 100000,
        actual: 120000,
        remaining: -20000,
        ratio: 1.2,
        status: "over",
        budgetedMonths: 1,
      },
    ],
  };

  const csv = reportToCsv({
    rangeLabel: "March 2026",
    summary: { income: 500000, expense: 125000 },
    spending: [{ name: "=Dining", total: 120000 }],
    budgetReport: budgetRep,
  });

  assert.ok(csv.includes("Income,5000.00"));
  assert.ok(csv.includes("Expenses,1250.00"));
  assert.ok(csv.includes("Net cash flow,3750.00"));
  assert.ok(csv.includes("'=Dining,1200.00,96.0"));
  assert.ok(csv.includes("'=Dining,1000.00,1200.00,-200.00,120.0,over,1"));
  assert.ok(csv.includes("Unbudgeted Spending,,50.00"));
});
