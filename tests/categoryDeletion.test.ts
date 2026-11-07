import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCategoryDeletion,
  movedRecurring,
  movedTransactions,
  planCategoryDeletion,
  validateMoveTarget,
} from "../src/categoryDeletion.ts";
import {
  emptyLedger,
  type Ledger,
  type RecurringSchedule,
  type Transaction,
} from "../src/domain.ts";

const tx = (id: string, category_id: string | null): Transaction => ({
  id,
  type: "expense",
  amount: 100,
  account_id: "cur",
  to_account_id: null,
  category_id,
  date: "2026-11-01",
  payee: "",
  notes: "",
});
const schedule = (
  id: string,
  category_id: string | null,
): RecurringSchedule => ({
  id,
  name: id,
  type: "expense",
  amount: 100,
  amount_type: "fixed",
  account_id: "cur",
  category_id,
  frequency: "monthly",
  start_date: "2026-01-01",
  end_date: null,
  status: "active",
  notes: "",
});
const cat = (id: string) => ({ id, name: id, description: "", color: "#000" });

const ledger: Ledger = {
  ...emptyLedger,
  categories: [cat("food"), cat("fun"), cat("rent")],
  transactions: [
    tx("t1", "food"),
    tx("t2", "fun"),
    tx("t3", "rent"),
    tx("t4", null),
    { ...tx("t5", null), type: "transfer", to_account_id: "sav" },
  ],
  recurring: [schedule("r1", "fun"), schedule("r2", "rent")],
  budgets: [
    {
      id: "b1",
      category_id: "food",
      amount: 1,
      start_month: "2026-01",
      end_month: null,
    },
    {
      id: "b2",
      category_id: "rent",
      amount: 1,
      start_month: "2026-01",
      end_month: null,
    },
  ],
};

test("plans every transaction, schedule and budget in the chosen categories", () => {
  const plan = planCategoryDeletion(ledger, ["food", "fun", "food", "gone"]);
  assert.deepEqual(plan, {
    categoryIds: ["food", "fun"],
    transactionIds: ["t1", "t2"],
    recurringIds: ["r1"],
    budgetIds: ["b1"],
  });
});

test("moves transactions and schedules to the target and drops budgets", () => {
  const plan = planCategoryDeletion(ledger, ["food", "fun"]);
  const next = applyCategoryDeletion(ledger, plan, "rent");
  assert.deepEqual(
    next.categories.map((c) => c.id),
    ["rent"],
  );
  assert.deepEqual(
    next.transactions.map((t) => [t.id, t.category_id]),
    [
      ["t1", "rent"],
      ["t2", "rent"],
      ["t3", "rent"],
      ["t4", null],
      ["t5", null],
    ],
  );
  assert.deepEqual(
    next.recurring?.map((r) => r.category_id),
    ["rent", "rent"],
  );
  assert.deepEqual(
    next.budgets?.map((b) => b.id),
    ["b2"],
  );
  assert.equal(next.transactions.length, ledger.transactions.length);
});

test("can leave moved records uncategorized", () => {
  const plan = planCategoryDeletion(ledger, ["rent"]);
  assert.deepEqual(
    movedTransactions(ledger, plan, null).map((t) => [t.id, t.category_id]),
    [["t3", null]],
  );
  assert.deepEqual(
    movedRecurring(ledger, plan, null).map((r) => [r.id, r.category_id]),
    [["r2", null]],
  );
});

test("refuses a target that is being deleted or no longer exists", () => {
  const plan = planCategoryDeletion(ledger, ["food", "fun"]);
  assert.throws(
    () => validateMoveTarget(ledger, plan, "fun"),
    /isn't being deleted/,
  );
  assert.throws(
    () => validateMoveTarget(ledger, plan, "nope"),
    /no longer exists/,
  );
  assert.doesNotThrow(() => validateMoveTarget(ledger, plan, "rent"));
  assert.doesNotThrow(() => validateMoveTarget(ledger, plan, null));
});
