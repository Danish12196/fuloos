import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAccountDeletion,
  confirmsAccountDeletion,
  deleteAccountPhrase,
  planAccountDeletion,
} from "../src/accountDeletion.ts";
import { PocketBaseBackend } from "../src/backend.ts";
import { emptyLedger, type Ledger, type Transaction } from "../src/domain.ts";

const tx = (id: string, patch: Partial<Transaction>): Transaction => ({
  id,
  type: "expense",
  amount: 100,
  account_id: "cur",
  to_account_id: null,
  category_id: null,
  date: "2026-11-01",
  payee: "",
  notes: "",
  ...patch,
});
const account = (id: string, name: string) => ({
  id,
  name,
  type: "current" as const,
  opening_balance: 0,
  opening_date: "2026-01-01",
  color: "#000000",
});

const ledger: Ledger = {
  ...emptyLedger,
  accounts: [account("cur", "Current"), account("sav", "Savings")],
  transactions: [
    tx("a", {}),
    tx("b", { type: "income" }),
    tx("c", { type: "transfer", account_id: "sav", to_account_id: "cur" }),
    tx("d", { type: "transfer", account_id: "cur", to_account_id: "sav" }),
    tx("e", { account_id: "sav" }),
  ],
  recurring: [
    { id: "r1", account_id: "cur" },
    { id: "r2", account_id: "sav" },
  ] as Ledger["recurring"],
  recurring_occurrences: [
    {
      id: "o1",
      recurring_id: "r1",
      occurrence_date: "2026-11-01",
      transaction_id: "a",
    },
    {
      id: "o2",
      recurring_id: "r2",
      occurrence_date: "2026-11-01",
      transaction_id: "e",
    },
  ],
};

test("only the exact typed phrase confirms deleting an account", () => {
  assert.equal(
    deleteAccountPhrase(" Emirates NBD "),
    "Delete account Emirates NBD",
  );
  assert.ok(confirmsAccountDeletion("Delete account Current", "Current"));
  assert.ok(confirmsAccountDeletion("  Delete account Current ", "Current"));
  assert.ok(!confirmsAccountDeletion("delete account current", "Current"));
  assert.ok(!confirmsAccountDeletion("Delete account", "Current"));
  assert.ok(!confirmsAccountDeletion("Delete account Savings", "Current"));
  assert.ok(!confirmsAccountDeletion("DELETE", "Current"));
});

test("the plan covers every transaction touching the account, transfers both ways, and its schedules", () => {
  const plan = planAccountDeletion(ledger, "cur");
  assert.deepEqual(plan.transactionIds, ["a", "b", "c", "d"]);
  assert.equal(plan.transferCount, 2);
  assert.deepEqual(plan.recurringIds, ["r1"]);
  const after = applyAccountDeletion(ledger, "cur", plan);
  assert.deepEqual(
    after.accounts.map((a) => a.id),
    ["sav"],
  );
  assert.deepEqual(
    after.transactions.map((t) => t.id),
    ["e"],
  );
  assert.deepEqual(
    after.recurring?.map((r) => r.id),
    ["r2"],
  );
  assert.deepEqual(
    after.recurring_occurrences?.map((o) => o.id),
    ["o2"],
  );
});

test("removeMany deletes in batches of 100 and reports confirmed ids", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue: Response[] = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const saved = new Map<string, string>();
  const backend = new PocketBaseBackend(
    "https://pb.example.test",
    {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
      removeItem: (k: string) => void saved.delete(k),
    },
    (async (url: unknown, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const r = queue.shift();
      if (!r) throw new Error("Unexpected request");
      return r;
    }) as typeof fetch,
  );
  queue.push(
    json({ token: "tok", record: { id: "user-a", email: "a@example.test" } }),
  );
  await backend.signIn("a@example.test", "pw-for-tests");
  calls.length = 0;
  const ids = Array.from({ length: 101 }, (_, i) => `t${i}`);
  const ok = (n: number) =>
    json(Array.from({ length: n }, () => ({ status: 204 })));
  queue.push(ok(100), ok(1));
  const confirmed: number[] = [];
  await backend.removeMany("transactions", ids, (d) =>
    confirmed.push(d.length),
  );
  assert.deepEqual(confirmed, [100, 1]);
  const first = JSON.parse(String(calls[0].init.body)).requests;
  assert.equal(first.length, 100);
  assert.equal(first[0].method, "DELETE");
  assert.equal(first[0].url, "/api/collections/fuloos_transactions/records/t0");

  // A failed batch stops and reports nothing for it.
  queue.push(json([{ status: 204 }, { status: 400 }]));
  const later: number[] = [];
  await assert.rejects(
    backend.removeMany("transactions", ["x", "y"], (d) => later.push(d.length)),
  );
  assert.deepEqual(later, []);
});
