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

