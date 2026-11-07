import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";
import {
  budgetForMonth,
  budgetReport,
  budgetStatus,
  isMonth,
  monthsBetween,
  unbudgetedCategories,
  validateBudget,
} from "../src/budgets.ts";
import type { Budget, Ledger, Transaction } from "../src/domain.ts";
import { demoLedger } from "../src/demo.ts";

const tx = (
  id: string,
  type: Transaction["type"],
  amount: number,
  category_id: string | null,
  date: string,
): Transaction => ({
  id,
  type,
  amount,
  account_id: "a",
  to_account_id: type === "transfer" ? "b" : null,
  category_id: type === "transfer" ? null : category_id,
  date,
  payee: "",
  notes: "",
});

function ledger(budgets: Budget[], transactions: Transaction[] = []): Ledger {
  return {
    accounts: [],
    categories: [
      { id: "food", name: "Food", description: "", color: "#000" },
      { id: "fun", name: "Fun", description: "", color: "#000" },
      { id: "rent", name: "Rent", description: "", color: "#000" },
    ],
    transactions,
    budgets,
  };
}

test("month helpers validate and enumerate inclusive month ranges", () => {
  assert.ok(isMonth("2026-01"));
  assert.ok(!isMonth("2026-13"));
  assert.ok(!isMonth("2026-1"));
  assert.ok(!isMonth("1969-12"));
  assert.deepEqual(monthsBetween("2025-11", "2026-02"), [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
  assert.deepEqual(monthsBetween("2026-03", "2026-02"), []);
});

test("budgetForMonth honours open-ended and bounded ranges", () => {
  const budgets: Budget[] = [
    {
      id: "b1",
      category_id: "food",
      amount: 100,
      start_month: "2026-01",
      end_month: "2026-03",
    },
    {
      id: "b2",
      category_id: "food",
      amount: 200,
      start_month: "2026-04",
      end_month: null,
    },
  ];
  assert.equal(budgetForMonth(budgets, "food", "2025-12"), undefined);
  assert.equal(budgetForMonth(budgets, "food", "2026-03")?.id, "b1");
  assert.equal(budgetForMonth(budgets, "food", "2026-04")?.id, "b2");
  assert.equal(budgetForMonth(budgets, "food", "2031-08")?.id, "b2");
  assert.equal(budgetForMonth(budgets, "fun", "2026-04"), undefined);
});

test("validateBudget rejects bad amounts, months, unknown categories and overlaps", () => {
  const l = ledger([
    {
      id: "b1",
      category_id: "food",
      amount: 100,
      start_month: "2026-01",
      end_month: "2026-03",
    },
  ]);
  const ok = {
    category_id: "food",
    amount: 5000,
    start_month: "2026-04",
    end_month: null,
  };
  validateBudget(ok, l);
  validateBudget({ ...ok, amount: 0 }, l);
  assert.throws(
    () => validateBudget({ ...ok, category_id: "nope" }, l),
    /existing category/,
  );
  assert.throws(
    () => validateBudget({ ...ok, amount: -1 }, l),
    /zero or greater/,
  );
  assert.throws(
    () => validateBudget({ ...ok, amount: 1.5 }, l),
    /zero or greater/,
  );
  assert.throws(
    () => validateBudget({ ...ok, start_month: "2026-00" }, l),
    /start month/,
  );
  assert.throws(
    () => validateBudget({ ...ok, end_month: "2026-02" }, l),
    /on or after the start month/,
  );
  assert.throws(
    () => validateBudget({ ...ok, start_month: "2026-03" }, l),
    /already has a budget from 2026-01 to 2026-03/,
  );
  assert.throws(
    () =>
      validateBudget(
        { ...ok, start_month: "2025-01", end_month: "2026-01" },
        l,
      ),
    /already has a budget/,
  );
  // Editing the same budget does not clash with itself.
  validateBudget(
    { ...ok, id: "b1", start_month: "2026-02", end_month: "2026-02" },
    l,
  );
  // Other categories are independent.
  validateBudget({ ...ok, category_id: "fun", start_month: "2026-01" }, l);
});

test("budgetReport sums budgets per month and counts only expenses in budgeted months", () => {
  const l = ledger(
    [
      {
        id: "b1",
        category_id: "food",
        amount: 100000,
        start_month: "2026-01",
        end_month: null,
      },
      {
        id: "b2",
        category_id: "fun",
        amount: 20000,
        start_month: "2026-02",
        end_month: "2026-02",
      },
      {
        id: "b3",
        category_id: "rent",
        amount: 0,
        start_month: "2026-01",
        end_month: null,
      },
    ],
    [
      tx("t1", "expense", 60000, "food", "2026-01-10"),
      tx("t2", "expense", 50000, "food", "2026-02-03"),
      tx("t3", "income", 999999, "food", "2026-02-04"),
      tx("t4", "transfer", 999999, null, "2026-02-05"),
      tx("t5", "expense", 10000, "fun", "2026-01-20"), // fun has no budget in January
      tx("t6", "expense", 17000, "fun", "2026-02-20"),
      tx("t7", "expense", 3000, null, "2026-02-21"),
      tx("t8", "expense", 70000, "food", "2026-03-01"), // outside range
    ],
  );
  const report = budgetReport(l, "2026-01", "2026-02");
  assert.deepEqual(report.months, ["2026-01", "2026-02"]);
  const byId = Object.fromEntries(report.rows.map((r) => [r.category.id, r]));
  assert.equal(byId.food.budget, 200000);
  assert.equal(byId.food.actual, 110000);
  assert.equal(byId.food.remaining, 90000);
  assert.equal(byId.food.status, "under");
  assert.equal(byId.fun.budget, 20000);
  assert.equal(byId.fun.actual, 17000);
  assert.equal(byId.fun.budgetedMonths, 1);
  assert.equal(byId.fun.status, "near");
  assert.equal(byId.rent.budget, 0);
  assert.equal(byId.rent.status, "under");
  assert.equal(report.totalBudget, 220000);
  assert.equal(report.totalActual, 127000);
  // January fun spend + uncategorised expense are not covered by any budget.
  assert.equal(report.unbudgeted, 13000);

  const jan = budgetReport(l, "2026-01", "2026-01");
  assert.equal(
    jan.rows.find((r) => r.category.id === "fun"),
    undefined,
  );

  const over = budgetReport(
    ledger(
      [
        {
          id: "b",
          category_id: "fun",
          amount: 100,
          start_month: "2026-01",
          end_month: null,
        },
      ],
      [tx("t", "expense", 101, "fun", "2026-01-01")],
    ),
    "2026-01",
    "2026-01",
  );
  assert.equal(over.rows[0].status, "over");
  assert.equal(over.rows[0].remaining, -1);
});

test("budgetStatus thresholds and unbudgeted categories", () => {
  assert.equal(budgetStatus(1000, 799), "under");
  assert.equal(budgetStatus(1000, 800), "near");
  assert.equal(budgetStatus(1000, 1000), "near");
  assert.equal(budgetStatus(1000, 1001), "over");
  assert.equal(budgetStatus(0, 0), "under");
  assert.equal(budgetStatus(0, 1), "over");
  const l = ledger(
    [
      {
        id: "b1",
        category_id: "food",
        amount: 100,
        start_month: "2026-01",
        end_month: null,
      },
    ],
    [
      tx("t1", "expense", 50, "food", "2026-01-02"),
      tx("t2", "expense", 70, "fun", "2026-01-02"),
      tx("t3", "expense", 90, "rent", "2026-01-02"),
      tx("t4", "income", 500, "fun", "2026-01-02"),
    ],
  );
  assert.deepEqual(
    unbudgetedCategories(l, "2026-01").map((r) => [r.category.id, r.actual]),
    [
      ["rent", 90],
      ["fun", 70],
    ],
  );
});

test("demo ledger ships valid, non-overlapping budgets with this month's progress", () => {
  const demo = demoLedger();
  assert.ok((demo.budgets ?? []).length >= 4);
  for (const b of demo.budgets ?? []) validateBudget(b, demo);
  const month = demo.transactions.find((t) => t.id === "t1")!.date.slice(0, 7);
  const report = budgetReport(demo, month, month);
  assert.ok(report.rows.length >= 4);
  assert.ok(report.totalActual > 0);
});

test("budgets migration enforces ownership rules, fils, valid months and no overlaps", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE fuloos_categories(id TEXT PRIMARY KEY,user_id TEXT,name TEXT);
      CREATE TABLE fuloos_budgets(id TEXT PRIMARY KEY,user_id TEXT,category_id TEXT,amount NUMERIC,start_month TEXT,end_month TEXT DEFAULT '');
      INSERT INTO fuloos_categories VALUES('food','user-a','Food'),('fun','user-a','Fun'),('foreign','user-b','Private');`);
    const saved: Record<string, unknown>[] = [];
    let down: ((app: unknown) => void) | undefined;
    const app = {
      save: (c: Record<string, unknown>) => {
        saved.push(c);
        for (const idx of (c.indexes as string[]) ?? []) db.exec(idx);
      },
      findCollectionByNameOrId: (name: string) => ({ id: `${name}_id`, name }),
      db: () => ({
        newQuery: (sql: string) => ({ execute: () => db.exec(sql) }),
      }),
    };
    runInNewContext(
      await readFile(
        new URL(
          "../pocketbase/pb_migrations/1794141000_budgets.js",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        migrate: (up: (app: unknown) => void, d?: (app: unknown) => void) => {
          down = d;
          up(app);
        },
        Collection: function (value: Record<string, unknown>) {
          return value;
        },
      },
    );
    assert.equal(saved.length, 1);
    const c = saved[0];
    assert.equal(c.name, "fuloos_budgets");
    assert.match(String(c.listRule), /user_id = @request.auth.id/);
    assert.match(String(c.viewRule), /user_id = @request.auth.id/);
    assert.match(String(c.deleteRule), /user_id = @request.auth.id/);
    assert.match(
      String(c.createRule),
      /@request.body.user_id = @request.auth.id/,
    );
    assert.match(String(c.updateRule), /@request.body.user_id:isset = false/);
    const fields = c.fields as { name: string; collectionId?: string }[];
    assert.equal(
      fields.find((f) => f.name === "category_id")?.collectionId,
      "fuloos_categories_id",
    );

    const insert = (values: string) =>
      db.exec(
        `INSERT INTO fuloos_budgets(id,user_id,category_id,amount,start_month,end_month) VALUES(${values})`,
      );
    insert("'b1','user-a','food',120000,'2026-01','2026-03'");
    insert("'b2','user-a','food',150000,'2026-04',''");
    insert("'b3','user-a','fun',0,'2026-01',''");
    assert.throws(
      () => insert("'x','user-a','foreign',1,'2026-01',''"),
      /same user/,
    );
    assert.throws(
      () => insert("'x','user-a','missing',1,'2026-01',''"),
      /same user/,
    );
    assert.throws(
      () => insert("'x','user-a','fun',-1,'2030-01',''"),
      /nonnegative integer fils/,
    );
    assert.throws(
      () => insert("'x','user-a','fun',1.5,'2030-01',''"),
      /nonnegative integer fils/,
    );
    assert.throws(
      () => insert("'x','user-a','fun',100000000001,'2030-01',''"),
      /nonnegative integer fils/,
    );
    assert.throws(
      () => insert("'x','user-a','fun',NULL,'2030-01',''"),
      /nonnegative integer fils/,
    );
    assert.throws(
      () => insert("'x','user-b','foreign',1,'2026-13',''"),
      /Start month/,
    );
    assert.throws(
      () => insert("'x','user-b','foreign',1,'1969-12',''"),
      /Start month/,
    );
    assert.throws(
      () => insert("'x','user-b','foreign',1,'2026-05','2026-04'"),
      /End month/,
    );
    assert.throws(
      () => insert("'x','user-b','foreign',1,'2026-05','2101-01'"),
      /End month/,
    );
    // Overlaps with bounded and open-ended budgets in the same category.
    assert.throws(
      () => insert("'x','user-a','food',1,'2026-03','2026-03'"),
      /overlap/,
    );
    assert.throws(
      () => insert("'x','user-a','food',1,'2027-01',''"),
      /overlap/,
    );
    assert.throws(
      () => insert("'x','user-a','food',1,'2025-01',''"),
      /overlap/,
    );
    assert.throws(
      () => insert("'x','user-a','fun',1,'2020-01','2026-01'"),
      /overlap/,
    );
    insert("'b4','user-a','fun',5,'2020-01','2025-12'");
    // Another user's budgets never clash.
    insert("'b5','user-b','foreign',1,'2026-01',''");

    // Updates are validated too, excluding the row itself.
    db.exec(
      "UPDATE fuloos_budgets SET amount=130000, end_month='2026-02' WHERE id='b1'",
    );
    assert.throws(
      () => db.exec("UPDATE fuloos_budgets SET end_month='' WHERE id='b1'"),
      /overlap/,
    );
    assert.throws(
      () => db.exec("UPDATE fuloos_budgets SET user_id='user-b' WHERE id='b1'"),
      /ownership cannot be changed|same user/,
    );

    // Deleting a category removes its budgets.
    db.exec("DELETE FROM fuloos_categories WHERE id='food'");
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM fuloos_budgets WHERE category_id='food'",
        )
        .get()?.n,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM fuloos_budgets WHERE category_id='fun'",
        )
        .get()?.n,
      2,
    );

    assert.ok(down);
    const deleted: string[] = [];
    down!({
      ...app,
      delete: (col: { name: string }) => deleted.push(col.name),
    });
    assert.deepEqual(deleted, ["fuloos_budgets"]);
    const triggers = db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE '%budget%'",
      )
      .get()?.n;
    assert.equal(triggers, 0);
  } finally {
    db.close();
  }
});
