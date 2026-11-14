import { test } from "node:test";
import assert from "node:assert/strict";
import { PocketBaseBackend } from "../src/backend.ts";
function fixture() {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue: Response[] = [];
  const saved = new Map<string, string>();
  const storage = {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => {
      saved.set(k, v);
    },
    removeItem: (k: string) => {
      saved.delete(k);
    },
  };
  const fetcher = (async (url: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = queue.shift();
    if (!r) throw new Error("Unexpected request");
    return r;
  }) as typeof fetch;
  return {
    backend: new PocketBaseBackend("https://pb.example.test", storage, fetcher),
    calls,
    queue,
    saved,
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const auth = {
  token: "user-token",
  record: { id: "user-a", email: "test@example.test" },
};
test("PocketBase auth persists only the user token and clears it on signout", async () => {
  const f = fixture();
  const events: unknown[] = [];
  f.backend.subscribe((s) => events.push(s));
  f.queue.push(json({ id: "user-a" }), json(auth));
  const result = await f.backend.signUp(
    " test@example.test ",
    "test-only-password",
  );
  assert.equal(result.session?.user.id, "user-a");
  assert.equal(result.verificationRequired, false);
  assert.ok(f.saved.size);
  assert.equal(
    JSON.parse(String(f.calls[0].init.body)).passwordConfirm,
    "test-only-password",
  );
  f.backend.signOut();
  assert.equal(f.saved.size, 0);
  assert.equal(events.at(-1), null);
  await assert.rejects(f.backend.load(), /sign in/);
});
test("PocketBase transfers save one record and use current session ownership", async () => {
  const f = fixture();
  f.queue.push(json(auth), json({ id: "transaction" }));
  await f.backend.signIn("test@example.test", "test-only-password");
  await f.backend.save("transactions", {
    amount: 29,
    type: "transfer",
    account_id: "from",
    to_account_id: "to",
    category_id: null,
    user_id: "spoof",
  });
  const write = f.calls[1];
  assert.equal(
    write.url,
    "https://pb.example.test/api/collections/fuloos_transactions/records",
  );
  assert.equal(
    new Headers(write.init.headers).get("Authorization"),
    "user-token",
  );
  assert.deepEqual(JSON.parse(String(write.init.body)), {
    amount: 29,
    type: "transfer",
    account_id: "from",
    to_account_id: "to",
    category_id: "",
    user_id: "user-a",
  });
});
test("missing PocketBase collections produce an actionable setup error", async () => {
  const f = fixture();
  f.queue.push(json({ message: "Missing" }, 404));
  await assert.rejects(
    f.backend.signIn("test@example.test", "test-only-password"),
    /Install the PocketBase migration/,
  );
});
test("PocketBase rejects insecure remote origins", () => {
  assert.throws(() => new PocketBaseBackend("http://example.test"), /HTTPS/);
  assert.doesNotThrow(() => new PocketBaseBackend("http://localhost:8090"));
});

test("Google sign-in availability follows the configured Fuloos provider", async () => {
  const f = fixture();
  f.queue.push(json({ oauth2: { enabled: false, providers: [] } }));
  assert.equal(await f.backend.googleEnabled(), false);
  f.queue.push(
    json({ oauth2: { enabled: true, providers: [{ name: "github" }] } }),
  );
  assert.equal(await f.backend.googleEnabled(), false);
  f.queue.push(
    json({ oauth2: { enabled: true, providers: [{ name: "google" }] } }),
  );
  assert.equal(await f.backend.googleEnabled(), true);
  assert.ok(
    f.calls.every((call) => call.url.endsWith("/fuloos_users/auth-methods")),
  );
});

test("default browser fetch is not invoked with the backend as its receiver", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function (this: unknown) {
    if (this !== undefined && this !== globalThis)
      throw new TypeError("Illegal invocation");
    return json(auth);
  } as typeof fetch;
  try {
    const backend = new PocketBaseBackend("https://pb.example.test");
    assert.equal(
      (await backend.signIn("test@example.test", "test-only-password")).user.id,
      "user-a",
    );
  } finally {
    globalThis.fetch = original;
  }
});

const bulkTransaction = {
  type: "transfer" as const,
  amount: 0,
  account_id: "from",
  to_account_id: "to",
  category_id: null,
  date: "2026-11-04",
  payee: "Payment",
  notes: "",
};
const batchResults = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({
    status: 200,
    body: { ...bulkTransaction, id: `record${offset + i}` },
  }));

test("single saves return server records with normalized relations without reloading the ledger", async () => {
  const f = fixture();
  f.queue.push(
    json(auth),
    json({
      ...bulkTransaction,
      id: "saved",
      category_id: "",
      to_account_id: "",
    }),
  );
  await f.backend.signIn("test@example.test", "test-only-password");
  const result = await f.backend.save("transactions", bulkTransaction, "saved");
  assert.equal(result.id, "saved");
  assert.equal(result.category_id, null);
  assert.equal(result.to_account_id, null);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].init.method, "PATCH");
});

test("bulk updates use 100 PATCH operations per request, normalize relations and report confirmed progress", async () => {
  const f = fixture();
  const rows = Array.from({ length: 201 }, (_, i) => ({
    ...bulkTransaction,
    id: `record${i}`,
  }));
  f.queue.push(
    json(auth),
    json(batchResults(100)),
    json(batchResults(100, 100)),
    json(batchResults(1, 200)),
  );
  await f.backend.signIn("test@example.test", "test-only-password");
  const progress: number[] = [];
  await f.backend.updateTransactions(rows, (n, records) => {
    progress.push(n);
    assert.equal(records[0].category_id, null);
  });
  assert.deepEqual(progress, [100, 200, 201]);
  assert.equal(f.calls.length, 4);
  const requests = JSON.parse(String(f.calls[1].init.body)).requests;
  assert.equal(requests.length, 100);
  assert.equal(requests[0].method, "PATCH");
  assert.equal(
    requests[0].url,
    "/api/collections/fuloos_transactions/records/record0",
  );
  assert.equal(requests[0].body.user_id, "user-a");
  assert.equal(requests[0].body.category_id, "");
  assert.equal(requests[0].body.id, undefined);
});

test("bulk update failures retain earlier progress and stop; uncertain results and session changes never advance progress", async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({
    ...bulkTransaction,
    id: `record${i}`,
  }));
  const f = fixture();
  f.queue.push(
    json(auth),
    json(batchResults(100)),
    json({ message: "Invalid update" }, 400),
  );
  await f.backend.signIn("test@example.test", "test-only-password");
  const progress: number[] = [];
  await assert.rejects(
    f.backend.updateTransactions(rows, (n) => progress.push(n)),
    /Invalid update/,
  );
  assert.deepEqual(progress, [100]);
  f.queue.push(json(batchResults(100)));
  await assert.rejects(
    f.backend.updateTransactions(rows, () => f.backend.signOut()),
    /Session changed/,
  );
  f.queue.push(json(auth));
  await f.backend.signIn("test@example.test", "test-only-password");
  await assert.rejects(
    f.backend.updateTransactions(rows, () =>
      assert.fail("Unconfirmed results"),
    ),
    /may have been saved/,
  );
  f.queue.push(
    json([{ status: 200, body: { ...bulkTransaction, id: "wrong" } }]),
  );
  await assert.rejects(
    f.backend.updateTransactions(rows.slice(0, 1), () =>
      assert.fail("Wrong record"),
    ),
    /unexpected batch result/,
  );
});
test("1001 transactions use 11 batch writes, preserve ownership and report committed progress", async () => {
  const f = fixture();
  f.queue.push(json(auth));
  await f.backend.signIn("test@example.test", "test-only-password");
  for (let offset = 0; offset < 1001; offset += 100)
    f.queue.push(json(batchResults(Math.min(100, 1001 - offset), offset)));
  const progress: number[] = [];
  await f.backend.createMany(
    "transactions",
    Array.from({ length: 1001 }, () => ({
      ...bulkTransaction,
      user_id: "spoof",
    })),
    (n) => progress.push(n),
  );
  assert.equal(f.calls.length, 12); // one auth request plus 11 batch writes
  assert.deepEqual(progress, [
    ...Array.from({ length: 10 }, (_, i) => (i + 1) * 100),
    1001,
  ]);
  const requests = JSON.parse(String(f.calls[1].init.body)).requests;
  assert.equal(requests.length, 100);
  assert.equal(f.calls[1].url, "https://pb.example.test/api/batch");
  assert.equal(
    new Headers(f.calls[1].init.headers).get("Authorization"),
    "user-token",
  );
  assert.equal(requests[0].url, "/api/collections/fuloos_transactions/records");
  assert.equal(requests[0].body.user_id, "user-a");
  assert.equal(requests[0].body.category_id, "");
  assert.equal(requests[0].body.to_account_id, "to");
  assert.equal(requests[0].body.amount, 0);
});
test("failed batches stop writes and advance progress only for successful batches", async () => {
  const f = fixture();
  f.queue.push(
    json(auth),
    json(batchResults(100)),
    json(
      {
        message: "Batch transaction failed.",
        data: {
          requests: {
            0: {
              response: {
                message: "Failed to create record.",
                data: { amount: { message: "Invalid amount." } },
              },
            },
          },
        },
      },
      400,
    ),
  );
  await f.backend.signIn("test@example.test", "test-only-password");
  const progress: number[] = [];
  await assert.rejects(
    f.backend.createMany(
      "transactions",
      Array.from({ length: 120 }, () => bulkTransaction),
      (n) => progress.push(n),
    ),
    /Invalid amount.*No records in this batch were saved/,
  );
  assert.deepEqual(progress, [100]);
  assert.equal(f.calls.length, 3);
});
test("20 categories use one batch and disabled batching never falls back to individual writes", async () => {
  const f = fixture();
  const categories = Array.from({ length: 20 }, (_, i) => ({
    name: `Category ${i}`,
    description: "",
    emoji: "",
    color: "#123456",
  }));
  f.queue.push(
    json(auth),
    json(
      categories.map((c, i) => ({
        status: 200,
        body: { ...c, id: `cat${i}` },
      })),
    ),
  );
  await f.backend.signIn("test@example.test", "test-only-password");
  let saved = 0;
  await f.backend.createMany("categories", categories, (n) => {
    saved = n;
  });
  assert.equal(saved, 20);
  assert.equal(f.calls.length, 2);
  assert.equal(JSON.parse(String(f.calls[1].init.body)).requests.length, 20);
  f.queue.push(
    json({ message: "Batch requests are not allowed.", data: {} }, 403),
  );
  await assert.rejects(
    f.backend.createMany("categories", categories, () => {}),
    /Enable Batch requests/,
  );
  assert.equal(f.calls.length, 3);
});
test("batch imports stop when the session changes and warn on uncertain network results", async () => {
  const f = fixture();
  f.queue.push(json(auth), json(batchResults(100)));
  await f.backend.signIn("test@example.test", "test-only-password");
  await assert.rejects(
    f.backend.createMany(
      "transactions",
      Array.from({ length: 160 }, () => bulkTransaction),
      () => f.backend.signOut(),
    ),
    /Session changed/,
  );
  assert.equal(f.calls.length, 2);
  f.queue.push(json(auth));
  await f.backend.signIn("test@example.test", "test-only-password");
  await assert.rejects(
    f.backend.createMany("transactions", [bulkTransaction], () =>
      assert.fail("Unconfirmed write must not advance progress"),
    ),
    /may have been saved.*Reload/,
  );
});

test("PocketBase load fetches all 7 collections, normalizes relations, recurring prefs, budgets and empty strings to null", async () => {
  const f = fixture();
  f.queue.push(
    json(auth),
    json({
      items: [
        {
          id: "acc1",
          name: "Everyday",
          type: "current",
          opening_balance: 100000,
          opening_date: "2026-01-01",
          color: "#1d5b48",
        },
      ],
      totalPages: 1,
    }),
    json({
      items: [
        {
          id: "cat1",
          name: "Bills",
          description: "Utilities",
          color: "#9e8aba",
        },
      ],
      totalPages: 1,
    }),
    json({
      items: [
        {
          id: "tx1",
          type: "expense",
          amount: 5000,
          account_id: "acc1",
          to_account_id: "",
          category_id: "",
          date: "2026-01-05",
          payee: "Grocery",
          notes: "",
        },
      ],
      totalPages: 1,
    }),
    json({
      items: [
        {
          id: "rec1",
          name: "Fibre Internet",
          type: "expense",
          amount: 37900,
          amount_type: "fixed",
          account_id: "acc1",
          category_id: "",
          frequency: "monthly",
          start_date: "2026-01-01",
          end_date: "",
          status: "active",
          notes: "Broadband",
        },
      ],
      totalPages: 1,
    }),
    json({
      items: [
        {
          id: "occ1",
          recurring_id: "rec1",
          occurrence_date: "2026-01-01",
          transaction_id: "tx1",
          match_source: "manual",
          match_reason: "Manual link",
        },
      ],
      totalPages: 1,
    }),
    json({
      items: [
        {
          id: "pref1",
          auto_detect: "on",
          auto_match: "auto",
          dismissed_keys: JSON.stringify(["rec1:2026-01-01:tx1"]),
        },
      ],
      totalPages: 1,
    }),
    json({
      items: [
        {
          id: "bud1",
          category_id: "cat1",
          amount: 90000,
          start_month: "2026-01",
          end_month: "",
          user_id: "user-a",
          collectionName: "fuloos_budgets",
        },
      ],
      totalPages: 1,
    }),
    json({
      items: [
        {
          id: "goal1",
          name: "Emergency",
          target_amount: 500000,
          current_amount: 100000,
          target_date: "",
          account_id: "",
          color: "#1d5b48",
          kind: "savings",
          status: "active",
          notes: "",
        },
      ],
      totalPages: 1,
    }),
    json({
      items: [
        {
          id: "gc1",
          goal_id: "goal1",
          amount: 100000,
          date: "2026-01-05",
          transaction_id: "",
          notes: "",
        },
      ],
      totalPages: 1,
    }),
    json({ items: [], totalPages: 1 }), // rules
  );

  await f.backend.signIn("test@example.test", "test-only-password");
  const ledger = await f.backend.load();

  assert.equal(ledger.accounts.length, 1);
  assert.equal(ledger.categories.length, 1);
  assert.equal(ledger.transactions.length, 1);
  assert.equal(ledger.recurring?.length, 1);
  assert.equal(ledger.recurring_occurrences?.length, 1);
  assert.equal(ledger.recurring_prefs?.id, "pref1");
  assert.equal(ledger.recurring_prefs?.auto_detect, "on");
  assert.equal(ledger.recurring_prefs?.auto_match, "auto");
  assert.deepEqual(ledger.recurring_prefs?.dismissed_keys, [
    "rec1:2026-01-01:tx1",
  ]);

  // Transactions normalization: "" -> null
  assert.equal(ledger.transactions[0].to_account_id, null);
  assert.equal(ledger.transactions[0].category_id, null);

  // Recurring schedules normalization: "" -> null for category_id and end_date
  const rec = ledger.recurring![0];
  assert.equal(rec.id, "rec1");
  assert.equal(rec.category_id, null);
  assert.equal(rec.end_date, null);

  // Occurrences preserved
  assert.equal(ledger.recurring_occurrences![0].id, "occ1");
  assert.equal(ledger.recurring_occurrences![0].recurring_id, "rec1");
  assert.equal(ledger.recurring_occurrences![0].transaction_id, "tx1");
  assert.equal(ledger.recurring_occurrences![0].match_source, "manual");
  assert.equal(ledger.recurring_occurrences![0].match_reason, "Manual link");

  // Budgets normalization: "" end_month -> null, PocketBase metadata dropped
  assert.deepEqual(ledger.budgets, [
    {
      id: "bud1",
      category_id: "cat1",
      amount: 90000,
      start_month: "2026-01",
      end_month: null,
    },
  ]);

  // Verify that all 7 collections were requested
  const paths = f.calls.slice(1).map((c) => c.url);
  assert.ok(paths.some((p) => p.includes("/fuloos_accounts/records")));
  assert.ok(paths.some((p) => p.includes("/fuloos_categories/records")));
  assert.ok(paths.some((p) => p.includes("/fuloos_transactions/records")));
  assert.ok(paths.some((p) => p.includes("/fuloos_recurring/records")));
  assert.ok(
    paths.some((p) => p.includes("/fuloos_recurring_occurrences/records")),
  );
  assert.ok(paths.some((p) => p.includes("/fuloos_recurring_prefs/records")));
  assert.ok(paths.some((p) => p.includes("/fuloos_budgets/records")));
});

test("PocketBase recurring saves normalize null category_id and end_date on write and restore nulls on read", async () => {
  const f = fixture();
  f.queue.push(
    json(auth),
    // Response for recurring insert (POST)
    json({
      id: "rec-new",
      name: "Internet",
      type: "expense",
      amount: 35000,
      amount_type: "fixed",
      account_id: "acc1",
      category_id: "",
      frequency: "monthly",
      start_date: "2026-02-01",
      end_date: "",
      status: "active",
      notes: "",
    }),
    // Response for recurring update (PATCH)
    json({
      id: "rec-new",
      name: "Internet Upgraded",
      type: "expense",
      amount: 40000,
      amount_type: "fixed",
      account_id: "acc1",
      category_id: "cat1",
      frequency: "monthly",
      start_date: "2026-02-01",
      end_date: "2026-12-31",
      status: "active",
      notes: "Faster",
    }),
  );

  await f.backend.signIn("test@example.test", "test-only-password");

  // Create new recurring schedule with nulls
  const created = await f.backend.save("recurring", {
    name: "Internet",
    type: "expense",
    amount: 35000,
    amount_type: "fixed",
    account_id: "acc1",
    category_id: null,
    frequency: "monthly",
    start_date: "2026-02-01",
    end_date: null,
    status: "active",
    notes: "",
  });

  // Verify POST payload normalized null -> ""
  const createCall = f.calls[1];
  assert.equal(createCall.init.method, "POST");
  assert.equal(
    createCall.url,
    "https://pb.example.test/api/collections/fuloos_recurring/records",
  );
  const createBody = JSON.parse(String(createCall.init.body));
  assert.equal(createBody.user_id, "user-a");
  assert.equal(createBody.category_id, "");
  assert.equal(createBody.end_date, "");

  // Verify returned object normalized "" -> null
  assert.equal(created.id, "rec-new");
  assert.equal(created.category_id, null);
  assert.equal(created.end_date, null);

  // Update existing recurring schedule with explicit category and end_date
  const updated = await f.backend.save(
    "recurring",
    {
      name: "Internet Upgraded",
      type: "expense",
      amount: 40000,
      amount_type: "fixed",
      account_id: "acc1",
      category_id: "cat1",
      frequency: "monthly",
      start_date: "2026-02-01",
      end_date: "2026-12-31",
      status: "active",
      notes: "Faster",
    },
    "rec-new",
  );

  // Verify PATCH url and body
  const updateCall = f.calls[2];
  assert.equal(updateCall.init.method, "PATCH");
  assert.equal(
    updateCall.url,
    "https://pb.example.test/api/collections/fuloos_recurring/records/rec-new",
  );
  assert.equal(updated.category_id, "cat1");
  assert.equal(updated.end_date, "2026-12-31");
});

test("PocketBase recurring_occurrences saves link and remove deletes records on both recurring collections", async () => {
  const f = fixture();
  f.queue.push(
    json(auth),
    // save occurrence
    json({
      id: "ro-123",
      recurring_id: "rec-1",
      occurrence_date: "2026-03-01",
      transaction_id: "tx-1",
      match_source: "auto",
      match_reason: "High similarity",
    }),
    // remove recurring (204)
    new Response(null, { status: 204 }),
    // remove occurrence (204)
    new Response(null, { status: 204 }),
  );

  await f.backend.signIn("test@example.test", "test-only-password");

  const occ = await f.backend.save("recurring_occurrences", {
    recurring_id: "rec-1",
    occurrence_date: "2026-03-01",
    transaction_id: "tx-1",
    match_source: "auto",
    match_reason: "High similarity",
  });

  const occCall = f.calls[1];
  assert.equal(occCall.init.method, "POST");
  assert.equal(
    occCall.url,
    "https://pb.example.test/api/collections/fuloos_recurring_occurrences/records",
  );
  const occBody = JSON.parse(String(occCall.init.body));
  assert.equal(occBody.user_id, "user-a");
  assert.equal(occBody.recurring_id, "rec-1");
  assert.equal(occBody.match_source, "auto");
  assert.equal(occBody.match_reason, "High similarity");
  assert.equal(occ.id, "ro-123");

  // Remove recurring schedule
  await f.backend.remove("recurring", "rec-1");
  const delRecCall = f.calls[2];
  assert.equal(delRecCall.init.method, "DELETE");
  assert.equal(
    delRecCall.url,
    "https://pb.example.test/api/collections/fuloos_recurring/records/rec-1",
  );

  // Remove occurrence link
  await f.backend.remove("recurring_occurrences", "ro-123");
  const delOccCall = f.calls[3];
  assert.equal(delOccCall.init.method, "DELETE");
  assert.equal(
    delOccCall.url,
    "https://pb.example.test/api/collections/fuloos_recurring_occurrences/records/ro-123",
  );
});

test("PocketBase recurring_prefs saves serialize dismissed_keys and normalize fields", async () => {
  const f = fixture();
  f.queue.push(
    json(auth),
    json({
      id: "pref-new",
      auto_detect: "off",
      auto_match: "manual",
      dismissed_keys: '["k1","k2"]',
    }),
    json({
      id: "pref-new",
      auto_detect: "on",
      auto_match: "auto",
      dismissed_keys: '["k1"]',
    }),
  );

  await f.backend.signIn("test@example.test", "test-only-password");

  const created = await f.backend.save("recurring_prefs", {
    auto_detect: "off",
    auto_match: "manual",
    dismissed_keys: ["k1", "k2"],
  });

  const createCall = f.calls[1];
  assert.equal(createCall.init.method, "POST");
  assert.equal(
    createCall.url,
    "https://pb.example.test/api/collections/fuloos_recurring_prefs/records",
  );
  const createBody = JSON.parse(String(createCall.init.body));
  assert.equal(createBody.user_id, "user-a");
  assert.equal(createBody.auto_detect, "off");
  assert.equal(createBody.auto_match, "manual");
  assert.equal(createBody.dismissed_keys, '["k1","k2"]');
  assert.deepEqual(created.dismissed_keys, ["k1", "k2"]);

  const updated = await f.backend.save(
    "recurring_prefs",
    {
      auto_detect: "on",
      auto_match: "auto",
      dismissed_keys: ["k1"],
    },
    "pref-new",
  );
  assert.equal(f.calls[2].init.method, "PATCH");
  assert.deepEqual(updated.dismissed_keys, ["k1"]);
});

test("PocketBase load degrades recurring collections to empty arrays on 404 pre-migration while keeping core collections strict", async () => {
  const f = fixture();
  f.queue.push(
    json(auth),
    json({ items: [], totalPages: 1 }), // accounts
    json({ items: [], totalPages: 1 }), // categories
    json({ items: [], totalPages: 1 }), // transactions
    json({ message: "Missing collection context.", data: {} }, 404), // fuloos_recurring not migrated yet
    json({ message: "Missing collection context.", data: {} }, 404), // fuloos_recurring_occurrences not migrated yet
    json({ message: "Missing collection context.", data: {} }, 404), // fuloos_recurring_prefs not migrated yet
    json({ message: "Missing collection context.", data: {} }, 404), // fuloos_budgets not migrated yet
    json({ message: "Missing collection context.", data: {} }, 404), // fuloos_goals not migrated yet
    json({ message: "Missing collection context.", data: {} }, 404), // fuloos_goal_contributions not migrated yet
    json({ message: "Missing collection context.", data: {} }, 404), // fuloos_rules not migrated yet
  );

  await f.backend.signIn("test@example.test", "test-only-password");
  const ledger = await f.backend.load();
  assert.deepEqual(ledger.accounts, []);
  assert.deepEqual(ledger.categories, []);
  assert.deepEqual(ledger.transactions, []);
  assert.deepEqual(ledger.recurring, []);
  assert.deepEqual(ledger.recurring_occurrences, []);
  assert.deepEqual(ledger.budgets, []);
  assert.deepEqual(ledger.goals, []);
  assert.deepEqual(ledger.goal_contributions, []);
  assert.deepEqual(ledger.recurring_prefs, {
    auto_detect: "on",
    auto_match: "auto",
    dismissed_keys: [],
  });

  // Core collection 404 still rejects loudly
  f.queue.push(
    json({ message: "Missing collection context.", data: {} }, 404),
    json({ items: [], totalPages: 1 }),
    json({ items: [], totalPages: 1 }),
    json({ items: [], totalPages: 1 }),
    json({ items: [], totalPages: 1 }),
    json({ items: [], totalPages: 1 }),
    json({ items: [], totalPages: 1 }),
    json({ items: [], totalPages: 1 }),
    json({ items: [], totalPages: 1 }),
    json({ items: [], totalPages: 1 }),
  );
  await assert.rejects(
    () => f.backend.load(),
    /Install the PocketBase migration/,
  );
});
test("sign-in and sign-up show user-friendly messages for live PocketBase auth errors", async () => {
  const f = fixture();
  // Responses captured from PocketBase v0.40.6 with the Fuloos migrations.
  f.queue.push(
    json({ data: {}, message: "Failed to authenticate.", status: 400 }, 400),
  );
  await assert.rejects(
    f.backend.signIn("test@example.test", "wrong-password"),
    { message: "Incorrect email or password." },
  );
  f.queue.push(
    json(
      {
        data: {
          email: {
            code: "validation_not_unique",
            message: "Value must be unique.",
          },
        },
        message: "Failed to create record.",
        status: 400,
      },
      400,
    ),
  );
  await assert.rejects(
    f.backend.signUp("test@example.test", "test-only-password"),
    { message: "An account with this email already exists. Sign in instead." },
  );
  f.queue.push(
    json(
      {
        data: {
          passwordConfirm: {
            code: "validation_values_mismatch",
            message: "Values don't match.",
          },
        },
        message: "Failed to create record.",
        status: 400,
      },
      400,
    ),
  );
  await assert.rejects(
    f.backend.signUp("test@example.test", "test-only-password"),
    { message: "Values don't match." },
  );
  assert.equal(f.saved.size, 0);
});
test("saving recurring data before its migrations explains what is missing", async () => {
  const f = fixture();
  f.queue.push(json(auth));
  await f.backend.signIn("test@example.test", "test-only-password");
  f.queue.push(
    json(
      { data: {}, message: "Missing collection context.", status: 404 },
      404,
    ),
  );
  await assert.rejects(
    f.backend.save("recurring_prefs", {
      auto_detect: "on",
      auto_match: "review",
      dismissed_keys: [],
    }),
    /Recurring features aren't installed on the server yet/,
  );
});

test("PocketBase budget saves send empty end_month and return normalized budgets", async () => {
  const f = fixture();
  f.queue.push(
    json(auth),
    json({
      id: "bud1",
      category_id: "cat1",
      amount: 50000,
      start_month: "2026-02",
      end_month: "",
      user_id: "user-a",
    }),
  );
  await f.backend.signIn("test@example.test", "test-only-password");
  const saved = await f.backend.save("budgets", {
    category_id: "cat1",
    amount: 50000,
    start_month: "2026-02",
    end_month: null,
  });
  assert.equal(
    f.calls[1].url,
    "https://pb.example.test/api/collections/fuloos_budgets/records",
  );
  assert.deepEqual(JSON.parse(String(f.calls[1].init.body)), {
    category_id: "cat1",
    amount: 50000,
    start_month: "2026-02",
    end_month: "",
    user_id: "user-a",
  });
  assert.deepEqual(saved, {
    id: "bud1",
    category_id: "cat1",
    amount: 50000,
    start_month: "2026-02",
    end_month: null,
  });
});

test("CSV presets are listed and saved in the per-user presets collection", async () => {
  const f = fixture();
  await assert.rejects(f.backend.listCsvPresets(), /sign in/);
  f.queue.push(
    json(auth),
    json({
      items: [{ id: "p1", name: "ADCB", name_key: "adcb", config: {} }],
      totalPages: 1,
    }),
    json({ id: "p2", name: "FAB", name_key: "fab", config: {} }),
  );
  await f.backend.signIn("test@example.test", "test-only-password");
  const list = await f.backend.listCsvPresets();
  assert.equal(list[0].id, "p1");
  assert.match(
    f.calls[1].url,
    /\/api\/collections\/fuloos_csv_presets\/records\?page=1/,
  );
  await f.backend.save("csv_presets", {
    name: "FAB",
    name_key: "fab",
    config: { delimiter: "," },
    user_id: "spoof",
  });
  assert.equal(
    f.calls[2].url,
    "https://pb.example.test/api/collections/fuloos_csv_presets/records",
  );
  assert.equal(JSON.parse(String(f.calls[2].init.body)).user_id, "user-a");
});
