import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { PocketBaseBackend } from "../src/backend.ts";

type Field = Record<string, unknown> & { name: string; type?: string };
type Coll = Record<string, unknown> & {
  name: string;
  id: string;
  fields: Field[] & {
    add: (f: Field) => void;
    getByName: (n: string) => Field | undefined;
  };
  indexes?: string[];
};

const migrationsDir = new URL("../pocketbase/pb_migrations/", import.meta.url);

/** Runs every repo migration, in order, against SQLite with a minimal PocketBase stand-in. */
async function migrateAll() {
  const db = new DatabaseSync(":memory:");
  const collections = new Map<string, Coll>();
  const columnType = (f: Field) =>
    f.type === "number" || f.type === "bool"
      ? "NUMERIC DEFAULT 0"
      : f.type === "json"
        ? "TEXT DEFAULT 'null'"
        : "TEXT DEFAULT ''";
  const wrapFields = (list: Field[]) =>
    Object.assign(list, {
      add: (f: Field) => list.push(f),
      getByName: (n: string) => list.find((f) => f.name === n),
    });
  const app = {
    findCollectionByNameOrId: (name: string) => {
      const c = collections.get(name);
      if (!c) throw new Error(`missing collection ${name}`);
      return c;
    },
    save: (c: Coll) => {
      if (!collections.has(c.name)) {
        if (c.type !== "auth" && !(c.fields as Field[]).length)
          throw new Error("empty collection");
        c.fields = wrapFields((c.fields as Field[] | undefined) ?? []);
        if (c.type === "auth") c.fields.add({ name: "email", type: "text" });
        collections.set(c.name, c);
        db.exec(
          `CREATE TABLE ${c.name}(id TEXT PRIMARY KEY${c.fields.map((f) => `,${f.name} ${columnType(f)}`).join("")})`,
        );
        for (const idx of c.indexes ?? []) db.exec(idx);
        return;
      }
      const existing = new Set(
        (
          db.prepare(`PRAGMA table_info(${c.name})`).all() as { name: string }[]
        ).map((r) => r.name),
      );
      for (const f of c.fields)
        if (!existing.has(f.name))
          db.exec(
            `ALTER TABLE ${c.name} ADD COLUMN ${f.name} ${columnType(f)}`,
          );
    },
    delete: (c: Coll) => {
      collections.delete(c.name);
      db.exec(`DROP TABLE ${c.name}`);
    },
    db: () => ({
      newQuery: (sql: string) => ({ execute: () => db.exec(sql) }),
    }),
  };
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".js"))
    .sort();
  const downs: Record<string, (app: unknown) => void> = {};
  for (const file of files)
    runInNewContext(await readFile(new URL(file, migrationsDir), "utf8"), {
      migrate: (up: (a: unknown) => void, down: (a: unknown) => void) => {
        downs[file] = down;
        up(app);
      },
      Collection: function (value: Record<string, unknown>) {
        return { ...value, fields: value.fields ?? [] };
      },
      TextField: function (v: Field) {
        return { ...v, type: "text" };
      },
      SelectField: function (v: Field) {
        return { ...v, type: "select" };
      },
    });
  return { db, collections, app, downs, files };
}

function seed(db: DatabaseSync, user: string) {
  db.exec(`INSERT INTO fuloos_users(id,email) VALUES('${user}','${user}@example.test');
    INSERT INTO fuloos_accounts(id,user_id,name,type,color,opening_balance,opening_date) VALUES('${user}-acc','${user}','Bank','current','#000000',0,'2026-01-01'),('${user}-card','${user}','Card','credit_card','#000000',0,'2026-01-01');
    INSERT INTO fuloos_categories(id,user_id,name,color) VALUES('${user}-food','${user}','Food','#000000');
    INSERT INTO fuloos_transactions(id,user_id,type,amount,account_id,to_account_id,category_id,date) VALUES('${user}-t1','${user}','expense',500,'${user}-acc','','${user}-food','2026-02-01'),('${user}-t2','${user}','transfer',100,'${user}-acc','${user}-card','','2026-02-02');
    INSERT INTO fuloos_recurring(id,user_id,name,type,amount,amount_type,account_id,category_id,frequency,start_date,end_date,status) VALUES('${user}-r1','${user}','Rent','expense',500,'fixed','${user}-acc','${user}-food','monthly','2026-01-01','','active');
    INSERT INTO fuloos_recurring_occurrences(id,user_id,recurring_id,occurrence_date,transaction_id) VALUES('${user}-o1','${user}','${user}-r1','2026-02-01','${user}-t1');
    INSERT INTO fuloos_budgets(id,user_id,category_id,amount,start_month,end_month) VALUES('${user}-b1','${user}','${user}-food',1000,'2026-01','');
    INSERT INTO fuloos_ml_settings(id,user_id,learn_consent,category_map) VALUES('${user}-s','${user}',1,'{"groceries":["${user}-food"]}');
    INSERT INTO fuloos_ml_examples(id,user_id,merchant_text,payee,amount,category_id,source) VALUES('${user}-e1','${user}','CARREFOUR','Carrefour',500,'${user}-food','sms');`);
}

const ownedTables = [
  "fuloos_recurring_occurrences",
  "fuloos_recurring_prefs",
  "fuloos_budgets",
  "fuloos_csv_presets",
  "fuloos_ml_examples",
  "fuloos_ml_settings",
  "fuloos_recurring",
  "fuloos_transactions",
  "fuloos_categories",
  "fuloos_accounts",
];
const count = (db: DatabaseSync, table: string, user: string) =>
  Number(
    db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`).get(user)
      ?.n,
  );

test("lockdown migration: owner-only AI collections, self-delete rule, and guards", async () => {
  const { db, collections, downs } = await migrateAll();
  try {
    assert.match(
      String(collections.get("fuloos_users")!.deleteRule),
      /^@request.auth.collectionName = 'fuloos_users' && id = @request.auth.id$/,
    );
    for (const name of ["fuloos_ml_settings", "fuloos_ml_examples"]) {
      const c = collections.get(name)!;
      for (const rule of ["listRule", "viewRule", "deleteRule"])
        assert.match(String(c[rule]), /user_id = @request.auth.id/);
      assert.match(
        String(c.createRule),
        /@request.body.user_id = @request.auth.id/,
      );
      assert.match(String(c.updateRule), /@request.body.user_id:isset = false/);
      assert.ok(!c.fields.some((f) => /sms_text|raw/i.test(f.name)));
    }
    seed(db, "user-a");
    seed(db, "user-b");
    const example = (values: string) =>
      db.exec(
        `INSERT INTO fuloos_ml_examples(id,user_id,merchant_text,amount,category_id,source) VALUES(${values})`,
      );
    example("'ok','user-a','LULU',0,'','manual'");
    assert.throws(
      () => example("'x','user-a','LULU',1,'user-b-food','sms'"),
      /same user/,
    );
    assert.throws(
      () => example("'x','user-a','LULU',1.5,'','sms'"),
      /integer fils/,
    );
    assert.throws(
      () => example("'x','user-a','LULU',-1,'','sms'"),
      /integer fils/,
    );
    assert.throws(
      () => example("'x','user-a','  ','1','','sms'"),
      /Merchant text/,
    );
    assert.throws(
      () => example(`'x','user-a','${"m".repeat(121)}',1,'','sms'`),
      /Merchant text/,
    );
    assert.throws(() => example("'x','user-a','LULU',1,'','email'"), /source/);
    assert.throws(
      () =>
        db.exec("UPDATE fuloos_ml_examples SET user_id='user-b' WHERE id='ok'"),
      /Ownership cannot be changed|same user/,
    );
    assert.throws(
      () =>
        db.exec(
          "INSERT INTO fuloos_ml_settings(id,user_id) VALUES('dup','user-a')",
        ),
      /UNIQUE/,
    );
    assert.throws(
      () =>
        db.exec(
          "UPDATE fuloos_ml_settings SET category_map='[1]' WHERE id='user-a-s'",
        ),
      /JSON object/,
    );
    assert.throws(
      () =>
        db.exec(
          "UPDATE fuloos_ml_settings SET user_id='user-b' WHERE id='user-a-s'",
        ),
      /Ownership cannot be changed/,
    );
    db.exec(
      "UPDATE fuloos_ml_settings SET category_map='null' WHERE id='user-a-s'",
    );

    // Down migration removes only the new collections and restores the rule.
    const app = {
      findCollectionByNameOrId: (n: string) => collections.get(n)!,
      delete: (c: Coll) => {
        collections.delete(c.name);
        db.exec(`DROP TABLE ${c.name}`);
      },
      save: () => {},
      db: () => ({
        newQuery: (sql: string) => ({ execute: () => db.exec(sql) }),
      }),
    };
    downs["1794227400_lockdown.js"](app);
    assert.equal(collections.has("fuloos_ml_examples"), false);
    assert.equal(collections.get("fuloos_users")!.deleteRule, null);
    assert.equal(count(db, "fuloos_transactions", "user-a"), 2);
  } finally {
    db.close();
  }
});

test("after recurring schedules and transactions are gone, the user cascade succeeds in any order", async () => {
  const { db } = await migrateAll();
  try {
    seed(db, "user-a");
    seed(db, "user-b");
    // Without the app's first step, PocketBase's cascade can hit the account guard.
    assert.throws(
      () => db.exec("DELETE FROM fuloos_accounts WHERE user_id='user-a'"),
      /Move or delete account transactions first|recurring schedules/,
    );
    // The app's first step: recurring schedules, then transactions.
    db.exec("DELETE FROM fuloos_recurring WHERE user_id='user-a'");
    db.exec("DELETE FROM fuloos_transactions WHERE user_id='user-a'");
    // PocketBase visits referencing collections in no fixed order; try several.
    const orders = [
      ownedTables,
      [...ownedTables].reverse(),
      [
        "fuloos_accounts",
        "fuloos_categories",
        "fuloos_budgets",
        "fuloos_ml_examples",
        "fuloos_ml_settings",
        "fuloos_recurring_prefs",
        "fuloos_csv_presets",
        "fuloos_recurring_occurrences",
      ],
    ];
    for (const order of orders) {
      db.exec("SAVEPOINT attempt");
      for (const table of order)
        db.exec(`DELETE FROM ${table} WHERE user_id='user-a'`);
      db.exec("DELETE FROM fuloos_users WHERE id='user-a'");
      for (const table of ownedTables)
        assert.equal(count(db, table, "user-a"), 0, table);
      db.exec("ROLLBACK TO attempt");
      db.exec("RELEASE attempt");
    }
    // The other user is untouched.
    for (const table of ownedTables.filter(
      (t) => !["fuloos_recurring_prefs", "fuloos_csv_presets"].includes(t),
    ))
      assert.ok(count(db, table, "user-b") > 0, table);
  } finally {
    db.close();
  }
});

test("deleteAccount removes recurring schedules and transactions in batches before the user", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue: Response[] = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const storage = new Map<string, string>();
  const store = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };
  const fetcher = (async (url: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = queue.shift();
    if (!r) throw new Error("Unexpected request");
    return r;
  }) as typeof fetch;
  const backend = new PocketBaseBackend(
    "https://pb.example.test",
    store,
    fetcher,
  );
  queue.push(
    json({ token: "tok", record: { id: "user-a", email: "a@example.test" } }),
  );
  await backend.signIn("a@example.test", "pw-for-tests");
  calls.length = 0;
  const txIds = Array.from({ length: 150 }, (_, i) => ({ id: `t${i}` }));
  queue.push(
    json({ message: "Failed to delete record." }, 400), // guard blocked the cascade
    json({ message: "Missing collection." }, 404), // recurring not installed
    json({ items: txIds, totalPages: 1 }),
    json([]),
    json([]),
    new Response(null, { status: 204 }),
  );
  const steps: string[] = [];
  await backend.deleteAccount((s) => steps.push(s));
  assert.match(calls[0].url, /fuloos_users\/records\/user-a$/);
  assert.match(calls[1].url, /fuloos_recurring\/records\?.*fields=id/);
  assert.match(calls[2].url, /fuloos_transactions\/records/);
  const batches = calls
    .slice(3, 5)
    .map((c) => JSON.parse(String(c.init.body)).requests);
  assert.deepEqual(
    batches.map((b) => b.length),
    [100, 50],
  );
  assert.equal(batches[0][0].method, "DELETE");
  assert.equal(
    batches[1][49].url,
    "/api/collections/fuloos_transactions/records/t149",
  );
  assert.equal(calls[5].init.method, "DELETE");
  assert.match(calls[5].url, /fuloos_users\/records\/user-a$/);
  assert.equal(await backend.getSession(), null);
  assert.ok(steps.at(-1)?.includes("account"));

  // An empty account goes in one request.
  queue.push(
    json({ token: "tok", record: { id: "user-a", email: "a@example.test" } }),
  );
  await backend.signIn("a@example.test", "pw-for-tests");
  calls.length = 0;
  queue.push(new Response(null, { status: 204 }));
  await backend.deleteAccount();
  assert.equal(calls.length, 1);

  // Without the lockdown migration the user delete is refused before anything is removed.
  queue.push(
    json({ token: "tok", record: { id: "user-a", email: "a@example.test" } }),
  );
  await backend.signIn("a@example.test", "pw-for-tests");
  calls.length = 0;
  queue.push(
    json({ message: "Only superusers can perform this action." }, 403),
  );
  await assert.rejects(
    backend.deleteAccount(),
    /isn't enabled on the server.*Nothing was deleted/,
  );
  assert.equal(calls.length, 1);
});
