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
  globalThis.fetch = async function(this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return json(auth);
  } as typeof fetch;
  try {
    const backend = new PocketBaseBackend("https://pb.example.test");
    assert.equal((await backend.signIn("test@example.test", "test-only-password")).user.id, "user-a");
  } finally { globalThis.fetch = original; }
});
