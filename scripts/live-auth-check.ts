// Smoke test for the Fuloos auth flow against a running PocketBase server.
//
// Uses the app's own PocketBaseBackend, so it exercises the same requests the
// browser makes. Run it yourself with a throwaway test email:
//
//   FULOOS_PB_URL=https://pb.danishali.dev \
//   FULOOS_TEST_EMAIL=you+fuloos-test@example.com \
//   FULOOS_TEST_PASSWORD='a-long-random-password' \
//   npm run check:live -- --signup
//
// Without --signup it only signs in to an existing user. Without any
// credentials it only runs the read-only collection checks. The script never
// deletes users (fuloos_users has no delete rule); remove test users from the
// PocketBase dashboard. It creates and deletes one "Live check" account.
import { PocketBaseBackend } from "../src/backend.ts";

const url = process.env.FULOOS_PB_URL ?? "https://pb.danishali.dev";
const email = process.env.FULOOS_TEST_EMAIL;
const password = process.env.FULOOS_TEST_PASSWORD;
const signup = process.argv.includes("--signup");

const collections = [
  "fuloos_users",
  "fuloos_accounts",
  "fuloos_categories",
  "fuloos_transactions",
  "fuloos_recurring",
  "fuloos_recurring_occurrences",
  "fuloos_recurring_prefs",
];

let failures = 0;
async function step(name: string, run: () => Promise<string | void>) {
  try {
    const note = await run();
    console.log(`PASS  ${name}${note ? ` (${note})` : ""}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
  }
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

await step("server health", async () => {
  const res = await fetch(`${url}/api/health`);
  expect(res.ok, `HTTP ${res.status}`);
});

for (const name of collections) {
  await step(`collection ${name} exists`, async () => {
    const path =
      name === "fuloos_users"
        ? `/api/collections/${name}/auth-methods`
        : `/api/collections/${name}/records?perPage=1`;
    const res = await fetch(`${url}${path}`);
    expect(res.status !== 404, "missing: apply the PocketBase migrations");
    expect(res.ok, `HTTP ${res.status}`);
  });
}

if (!email || !password) {
  console.log(
    "\nSet FULOOS_TEST_EMAIL and FULOOS_TEST_PASSWORD to test sign-up and sign-in.",
  );
} else {
  const storage = memoryStorage();
  const backend = new PocketBaseBackend(url, storage);
  let userId = "";

  if (signup)
    await step("sign up", async () => {
      const result = await backend.signUp(email, password);
      expect(result.session?.user.id, "no session returned");
      userId = result.session.user.id;
    });

  await step("sign in", async () => {
    const session = await backend.signIn(email, password);
    expect(!userId || session.user.id === userId, "different user id");
    userId = session.user.id;
  });

  if (!userId) {
    console.log("\nSkipping the remaining checks because sign-in failed.");
  } else {
    await step("session saved to storage", async () => {
      const saved = JSON.parse(storage.map.get("fuloos.auth.v1") ?? "null");
      expect(saved?.token && saved.user?.id === userId, "not stored");
    });

    await step("session restores in a new app instance", async () => {
      const restored = await new PocketBaseBackend(url, storage).getSession();
      expect(restored?.user.id === userId, "refresh did not return the user");
    });

    await step("ledger loads", async () => {
      const ledger = await backend.load();
      return `${ledger.accounts.length} accounts, ${ledger.transactions.length} transactions`;
    });

    await step("create and delete an account", async () => {
      const account = await backend.save("accounts", {
        name: "Live check",
        type: "current",
        opening_balance: 0,
        opening_date: new Date().toISOString().slice(0, 10),
        color: "#2f7d6d",
        emoji: "",
      });
      expect(
        (await backend.load()).accounts.some((a) => a.id === account.id),
        "not listed",
      );
      await backend.remove("accounts", account.id);
      expect(
        !(await backend.load()).accounts.some((a) => a.id === account.id),
        "not deleted",
      );
    });

    await step("sign out clears storage", async () => {
      backend.signOut();
      expect(!storage.map.has("fuloos.auth.v1"), "still stored");
    });

    await step("wrong password is rejected", async () => {
      try {
        await backend.signIn(email, `${password}-wrong`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        expect(!message.startsWith("Could not reach"), message);
        return `shows "${message}"`;
      }
      throw new Error("signed in with a wrong password");
    });
  }
}

console.log(
  failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.",
);
process.exitCode = failures ? 1 : 0;
