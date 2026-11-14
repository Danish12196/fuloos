import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { computeCardSummary, simulateDebtPayoff } from "../src/debtTools.ts";
import type { Account, Transaction } from "../src/domain.ts";

function makeCard(overrides: Partial<Account> = {}): Account {
  return {
    id: "card-1",
    name: "Everyday Credit Card",
    type: "credit_card",
    opening_balance: -100000,
    opening_date: "2026-01-01",
    color: "#696198",
    credit_limit: 1000000,
    statement_day: 20,
    payment_due_day: 10,
    apr_bps: 2400,
    minimum_payment: 25000,
    ...overrides,
  };
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    type: "expense",
    amount: 10000,
    account_id: "card-1",
    to_account_id: null,
    category_id: null,
    date: "2026-03-05",
    payee: "Merchant",
    notes: "",
    ...overrides,
  };
}

test("computeCardSummary calculates debt, utilization, available credit, and statement window", () => {
  const card = makeCard({ credit_limit: 1000000, statement_day: 20, payment_due_day: 10 });
  const txs: Transaction[] = [
    makeTx({ id: "t1", date: "2026-02-19", amount: 50000 }), // prior cycle
    makeTx({ id: "t2", date: "2026-02-21", amount: 30000 }), // in cycle
    makeTx({ id: "t3", date: "2026-03-05", amount: 20000 }), // in cycle
    makeTx({
      id: "t4",
      type: "transfer",
      account_id: "checking",
      to_account_id: "card-1",
      date: "2026-03-06",
      amount: 10000,
    }), // payment in cycle
  ];

  const summary = computeCardSummary(card, -250000, txs, "2026-03-07");
  assert.equal(summary.debtFils, 250000);
  assert.equal(summary.creditLimitFils, 1000000);
  assert.equal(summary.availableCreditFils, 750000);
  assert.equal(summary.utilizationPct, 25);
  assert.deepEqual(summary.statementWindow, {
    start: "2026-02-21",
    end: "2026-03-20",
  });
  assert.equal(summary.statementBalanceFils, 40000);
  assert.equal(summary.nextDueDate, "2026-03-10");
  assert.equal(summary.daysUntilDue, 3);
});

test("computeCardSummary handles positive balance, over-limit, and rolled due dates", () => {
  const card = makeCard({ credit_limit: 500000, statement_day: 31, payment_due_day: 10 });
  const positive = computeCardSummary(card, 15000, [], "2026-02-15");
  assert.equal(positive.debtFils, 0);
  assert.equal(positive.availableCreditFils, 500000);
  assert.equal(positive.utilizationPct, 0);
  assert.deepEqual(positive.statementWindow, {
    start: "2026-02-01",
    end: "2026-02-28",
  });
  assert.equal(positive.nextDueDate, "2026-03-10");
  assert.equal(positive.daysUntilDue, 23);

  const overLimit = computeCardSummary(card, -600000, [], "2026-03-10");
  assert.equal(overLimit.availableCreditFils, 0);
  assert.equal(overLimit.utilizationPct, 120);
  assert.equal(overLimit.daysUntilDue, 0);
});

test("computeCardSummary handles cards without limit or due day configured", () => {
  const bare = makeCard({
    credit_limit: undefined,
    statement_day: undefined,
    payment_due_day: undefined,
  });
  const summary = computeCardSummary(bare, -45000, [], "2026-04-12");
  assert.equal(summary.debtFils, 45000);
  assert.equal(summary.creditLimitFils, 0);
  assert.equal(summary.availableCreditFils, 0);
  assert.equal(summary.utilizationPct, 0);
  assert.deepEqual(summary.statementWindow, {
    start: "2026-04-01",
    end: "2026-04-30",
  });
  assert.equal(summary.nextDueDate, null);
  assert.equal(summary.daysUntilDue, null);
});

test("simulateDebtPayoff handles empty debts and zero-APR payoff", () => {
  const empty = simulateDebtPayoff([], 50000, "avalanche");
  assert.equal(empty.months, 0);
  assert.equal(empty.paidOff, true);
  assert.equal(empty.totalInterestFils, 0);

  const zeroApr = simulateDebtPayoff(
    [
      {
        id: "d1",
        name: "Zero APR",
        balanceFils: 100000,
        aprBps: 0,
        minimumPaymentFils: 20000,
      },
    ],
    5000,
    "snowball",
  );
  assert.equal(zeroApr.paidOff, true);
  assert.equal(zeroApr.months, 4);
  assert.equal(zeroApr.totalInterestFils, 0);
  assert.equal(zeroApr.totalPaidFils, 100000);
});

test("simulateDebtPayoff compares avalanche vs snowball payoff order and interest", () => {
  const debts = [
    {
      id: "small-low",
      name: "Small Low APR",
      balanceFils: 200000, // 2,000 AED
      aprBps: 600, // 6%
      minimumPaymentFils: 5000, // 50 AED
    },
    {
      id: "large-high",
      name: "Large High APR",
      balanceFils: 400000, // 4,000 AED
      aprBps: 2999, // 29.99%
      minimumPaymentFils: 10000, // 100 AED
    },
  ];

  const avalanche = simulateDebtPayoff(debts, 80000, "avalanche");
  const snowball = simulateDebtPayoff(debts, 80000, "snowball");

  assert.equal(avalanche.paidOff, true);
  assert.equal(snowball.paidOff, true);
  assert.equal(snowball.payoffOrder[0].id, "small-low");
  assert.equal(avalanche.payoffOrder[0].id, "large-high");
  assert.ok(avalanche.totalInterestFils < snowball.totalInterestFils);
  assert.ok(avalanche.schedulePreview.length === avalanche.months);
  assert.equal(
    avalanche.schedulePreview[avalanche.schedulePreview.length - 1]
      .totalBalanceFils,
    0,
  );
});

test("simulateDebtPayoff stops at maxMonths when payments cannot cover debt", () => {
  const result = simulateDebtPayoff(
    [
      {
        id: "stuck",
        name: "Unpaid",
        balanceFils: 500000,
        aprBps: 2400,
        minimumPaymentFils: 5000, // less than 10,000 monthly interest
      },
    ],
    0,
    "avalanche",
    12,
  );
  assert.equal(result.paidOff, false);
  assert.equal(result.months, 12);
  assert.ok(result.remainingDebtFils > 500000);
});

test("1794660000_credit_card_tools migration enforces integer and range invariants in SQLite", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      `CREATE TABLE fuloos_accounts(
        id TEXT PRIMARY KEY,
        user_id TEXT,
        name TEXT,
        type TEXT,
        color TEXT,
        opening_balance INTEGER,
        opening_date TEXT,
        credit_limit INTEGER DEFAULT 0,
        statement_day INTEGER DEFAULT 0,
        payment_due_day INTEGER DEFAULT 0,
        apr_bps INTEGER DEFAULT 0,
        minimum_payment INTEGER DEFAULT 0
      );`,
    );

    const fieldsAdded: string[] = [];
    const accountsCollection = {
      fields: {
        add: (f: { name: string }) => fieldsAdded.push(f.name),
        removeByName: () => {},
      },
    };
    const app = {
      findCollectionByNameOrId: (name: string) => {
        assert.equal(name, "fuloos_accounts");
        return accountsCollection;
      },
      save: () => {},
      db: () => ({
        newQuery: (sql: string) => ({ execute: () => db.exec(sql) }),
      }),
    };

    runInNewContext(
      await readFile(
        new URL(
          "../pocketbase/pb_migrations/1794660000_credit_card_tools.js",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        migrate: (up: (app: unknown) => void) => up(app),
        NumberField: function (opts: Record<string, unknown>) {
          return { type: "number", ...opts };
        },
      },
    );

    assert.deepEqual(fieldsAdded, [
      "credit_limit",
      "statement_day",
      "payment_due_day",
      "apr_bps",
      "minimum_payment",
    ]);

    db.exec(
      `INSERT INTO fuloos_accounts VALUES('c1','u1','Card','credit_card','#696198',-50000,'2026-01-01',2500000,20,10,2499,50000);`,
    );
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO fuloos_accounts VALUES('c2','u1','Bad Day','credit_card','#696198',0,'2026-01-01',0,32,10,0,0);`,
        ),
      /statement_day/,
    );
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO fuloos_accounts VALUES('c3','u1','Bad Due','credit_card','#696198',0,'2026-01-01',0,15,-1,0,0);`,
        ),
      /payment_due_day/,
    );
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO fuloos_accounts VALUES('c4','u1','Bad APR','credit_card','#696198',0,'2026-01-01',0,15,5,100001,0);`,
        ),
      /apr_bps/,
    );
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO fuloos_accounts VALUES('c5','u1','Bad Limit','credit_card','#696198',0,'2026-01-01',12.5,15,5,0,0);`,
        ),
      /credit_limit/,
    );
  } finally {
    db.close();
  }
});
