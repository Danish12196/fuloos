import assert from "node:assert/strict";
import test from "node:test";
import { BackendError, PocketBaseBackend } from "../src/backend.ts";
import { checkSchemaStatus } from "../src/schemaStatus.ts";

const pbUrl = process.env.FULOOS_PB_URL;
if (!pbUrl) {
  throw new Error("FULOOS_PB_URL must be set when running pb-isolation.test.ts");
}

function makeBackend(): PocketBaseBackend {
  return new PocketBaseBackend(pbUrl!);
}

function isRejectedIsolation(err: unknown): boolean {
  return (
    err instanceof BackendError &&
    (err.status === 404 || err.status === 400 || err.status === 403)
  );
}

test("PocketBase migrations apply cleanly and enforce strict two-user isolation", async () => {
  const backendA = makeBackend();
  const backendB = makeBackend();

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emailA = `user-a-${suffix}@example.com`;
  const emailB = `user-b-${suffix}@example.com`;
  const password = "TestPassword123!";

  const signUpA = await backendA.signUp(emailA, password);
  const signUpB = await backendB.signUp(emailB, password);
  assert.ok(signUpA.session?.user.id);
  assert.ok(signUpB.session?.user.id);

  // 1. All expected fuloos_* collections exist after migrations run from empty.
  const schema = await checkSchemaStatus((table) => backendA.probeCollection(table));
  assert.equal(schema.checked, true);
  assert.equal(schema.ok, true);
  assert.deepEqual(schema.missing, []);

  // 2. User A populates every user-owned collection.
  const accountA = await backendA.save("accounts", {
    name: "User A Checking",
    type: "current",
    opening_balance: 100000,
    opening_date: "2026-01-01",
    color: "#1d5b48",
    emoji: "🏦",
  });
  const categoryA = await backendA.save("categories", {
    name: "User A Groceries",
    description: "Food",
    color: "#1d5b48",
    emoji: "🛒",
  });
  const txA = await backendA.save("transactions", {
    type: "expense",
    amount: 2500,
    account_id: accountA.id,
    to_account_id: "",
    category_id: categoryA.id,
    date: "2026-01-15",
    payee: "Carrefour",
    notes: "User A private note",
  });
  const recurringA = await backendA.save("recurring", {
    name: "User A Internet",
    type: "expense",
    amount: 35000,
    amount_type: "fixed",
    account_id: accountA.id,
    category_id: categoryA.id,
    frequency: "monthly",
    start_date: "2026-01-01",
    end_date: "",
    notes: "",
    status: "active",
  });
  const occurrenceA = await backendA.save("recurring_occurrences", {
    recurring_id: recurringA.id,
    occurrence_date: "2026-01-01",
    transaction_id: txA.id,
    match_source: "manual",
    match_reason: "test",
  });
  const prefsA = await backendA.save("recurring_prefs", {
    auto_detect: "on",
    auto_match: "auto",
    dismissed_keys: ["k1"],
  });
  const budgetA = await backendA.save("budgets", {
    category_id: categoryA.id,
    amount: 150000,
    start_month: "2026-01",
    end_month: "",
  });

  // 3. User B loads their ledger and sees zero records from User A.
  const ledgerB = await backendB.load();
  assert.equal(ledgerB.accounts.length, 0);
  assert.equal(ledgerB.categories.length, 0);
  assert.equal(ledgerB.transactions.length, 0);
  assert.equal(ledgerB.recurring?.length ?? 0, 0);
  assert.equal(ledgerB.recurring_occurrences?.length ?? 0, 0);
  assert.equal(ledgerB.budgets?.length ?? 0, 0);
  assert.deepEqual(ledgerB.recurring_prefs?.dismissed_keys, []);

  // 4. User B cannot mutate or delete any of User A's records by ID.
  const userARecords: Array<{
    table: Parameters<PocketBaseBackend["remove"]>[0];
    id: string;
  }> = [
    { table: "accounts", id: accountA.id },
    { table: "categories", id: categoryA.id },
    { table: "transactions", id: txA.id },
    { table: "recurring", id: recurringA.id },
    { table: "recurring_occurrences", id: occurrenceA.id },
    { table: "recurring_prefs", id: prefsA.id },
    { table: "budgets", id: budgetA.id },
  ];
  for (const { table, id } of userARecords) {
    await assert.rejects(
      () => backendB.remove(table, id),
      isRejectedIsolation,
      `User B should not be able to delete User A's ${table}`,
    );
  }

  // 5. User B creates their own account & category, then tries to reference User A's IDs.
  const accountB = await backendB.save("accounts", {
    name: "User B Checking",
    type: "current",
    opening_balance: 50000,
    opening_date: "2026-01-01",
    color: "#696198",
    emoji: "💳",
  });
  const categoryB = await backendB.save("categories", {
    name: "User B Dining",
    description: "",
    color: "#696198",
    emoji: "🍽️",
  });

  // Cross-user foreign key references must be rejected.
  await assert.rejects(
    () =>
      backendB.save("transactions", {
        type: "expense",
        amount: 1000,
        account_id: accountA.id,
        to_account_id: "",
        category_id: categoryB.id,
        date: "2026-01-16",
        payee: "Hijack",
        notes: "",
      }),
    isRejectedIsolation,
  );
  await assert.rejects(
    () =>
      backendB.save("transactions", {
        type: "expense",
        amount: 1000,
        account_id: accountB.id,
        to_account_id: "",
        category_id: categoryA.id,
        date: "2026-01-16",
        payee: "Hijack",
        notes: "",
      }),
    isRejectedIsolation,
  );
  await assert.rejects(
    () =>
      backendB.save("budgets", {
        category_id: categoryA.id,
        amount: 10000,
        start_month: "2026-01",
        end_month: "",
      }),
    isRejectedIsolation,
  );
  await assert.rejects(
    () =>
      backendB.save("recurring", {
        name: "Hijack",
        type: "expense",
        amount: 1000,
        amount_type: "fixed",
        account_id: accountA.id,
        category_id: categoryB.id,
        frequency: "monthly",
        start_date: "2026-01-01",
        end_date: "",
        notes: "",
        status: "active",
      }),
    isRejectedIsolation,
  );
  await assert.rejects(
    () =>
      backendB.save("recurring_occurrences", {
        recurring_id: recurringA.id,
        occurrence_date: "2026-02-01",
        transaction_id: txA.id,
        match_source: "manual",
        match_reason: "",
      }),
    isRejectedIsolation,
  );

  // 6. User A's load still only contains User A's own records.
  const ledgerA = await backendA.load();
  assert.equal(ledgerA.accounts.length, 1);
  assert.equal(ledgerA.accounts[0].id, accountA.id);
  assert.equal(ledgerA.categories.length, 1);
  assert.equal(ledgerA.transactions.length, 1);
  assert.equal(ledgerA.recurring?.length, 1);
  assert.equal(ledgerA.recurring_occurrences?.length, 1);
  assert.equal(ledgerA.budgets?.length, 1);
});
