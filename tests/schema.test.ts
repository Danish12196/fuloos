import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";
test("PocketBase migration defines neutral categories and tenant rules; SQLite guards ledger invariants", async () => {
  const db = new DatabaseSync(":memory:");
  const collections: Record<string, unknown>[] = [];
  try {
    db.exec(`CREATE TABLE fuloos_accounts(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,type TEXT,color TEXT,opening_balance INTEGER,opening_date TEXT);
 CREATE TABLE fuloos_categories(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,color TEXT,description TEXT);
 CREATE TABLE fuloos_transactions(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,amount INTEGER,account_id TEXT,to_account_id TEXT DEFAULT '',category_id TEXT DEFAULT '',date TEXT,payee TEXT,notes TEXT);`);
    const app = {
      save: (c: Record<string, unknown>) => collections.push(c),
      db: () => ({
        newQuery: (sql: string) => ({ execute: () => db.exec(sql) }),
      }),
    };
    runInNewContext(
      await readFile(
        new URL(
          "../pocketbase/pb_migrations/1793709000_fuloos.js",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        migrate: (up: (app: unknown) => void) => up(app),
        Collection: function (value: Record<string, unknown>) {
          return value;
        },
      },
    );
    assert.equal(collections.length, 4);
    const category = collections.find((c) => c.name === "fuloos_categories")!;
    assert.ok(
      !(category.fields as { name: string }[]).some((f) => f.name === "type"),
    );
    for (const c of collections.filter((c) => c.type === "base")) {
      assert.match(String(c.listRule), /user_id = @request.auth.id/);
      assert.match(
        String(c.createRule),
        /@request.body.user_id = @request.auth.id/,
      );
      assert.match(String(c.updateRule), /@request.body.user_id:isset = false/);
    }
    db.exec(
      `INSERT INTO fuloos_accounts VALUES('a','user-a','Bank','current','#000000',10000,'2026-01-01'),('b','user-a','Card','credit_card','#000000',-1000,'2026-01-01'),('foreign','user-b','Other','cash','#000000',0,'2026-01-01');INSERT INTO fuloos_categories VALUES('salary','user-a','Salary','#000000','Income or expense'),('foreign-cat','user-b','Private','#000000','');`,
    );
    const insert = (fields: string) =>
      db.exec(
        `INSERT INTO fuloos_transactions(id,user_id,type,amount,account_id,to_account_id,category_id,date) VALUES(${fields})`,
      );
    insert("'t1','user-a','transfer',100,'a','b','','2026-01-02'");
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM fuloos_transactions").get()?.n,
      1,
    );
    assert.throws(
      () => insert("'t2','user-a','transfer',100,'a','a','','2026-01-02'"),
      /two different accounts/,
    );
    assert.throws(
      () => insert("'t3','user-a','expense',100,'foreign','','','2026-01-02'"),
      /same user/,
    );
    assert.throws(
      () =>
        insert("'t4','user-a','expense',100,'a','','foreign-cat','2026-01-02'"),
      /same user/,
    );
    assert.throws(
      () => insert("'t5','user-a','expense',0.29,'a','','','2026-01-02'"),
      /integer fils/,
    );
    assert.throws(
      () => insert("'t6','user-a','expense',100,'a','','','2025-12-31'"),
      /opening dates/,
    );
    insert("'t7','user-a','income',100,'a','','salary','2026-01-02'");
    insert("'t8','user-a','expense',100,'a','','salary','2026-01-02'");
    assert.throws(
      () =>
        db.exec(
          "UPDATE fuloos_accounts SET opening_date='2026-01-03' WHERE id='b'",
        ),
      /existing transactions/,
    );
    assert.throws(
      () => db.exec("DELETE FROM fuloos_accounts WHERE id='a'"),
      /transactions first/,
    );
    assert.throws(
      () => db.exec("DELETE FROM fuloos_categories WHERE id='salary'"),
      /Reassign/,
    );
    assert.throws(
      () => db.exec("UPDATE fuloos_accounts SET user_id='user-b' WHERE id='a'"),
      /ownership cannot be changed/,
    );
    // Run the upgrade over an existing ledger, then exercise the replacement triggers.
    const upgraded = new Map(collections.map((c) => [c.name, c]));
    for (const c of upgraded.values()) {
      const fields = c.fields as { name: string }[];
      if (!fields) continue;
      Object.assign(fields, {
        add: (field: { name: string }) => fields.push(field),
        getByName: (name: string) => fields.find((f) => f.name === name),
      });
    }
    runInNewContext(
      await readFile(
        new URL(
          "../pocketbase/pb_migrations/1793795400_import_appearance.js",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        migrate: (up: (app: unknown) => void) =>
          up({
            ...app,
            findCollectionByNameOrId: (name: string) => upgraded.get(name),
          }),
        TextField: function (value: Record<string, unknown>) {
          return value;
        },
      },
    );
    insert("'zero','user-a','expense',0,'a','','','2026-01-02'");
    db.exec("UPDATE fuloos_transactions SET amount=0 WHERE id='t1'");
    assert.throws(
      () => insert("'negative','user-a','expense',-1,'a','','','2026-01-02'"),
      /nonnegative/,
    );
    assert.throws(
      () => insert("'cross','user-a','expense',0,'foreign','','','2026-01-02'"),
      /same user/,
    );
    assert.throws(
      () => insert("'self','user-a','transfer',0,'a','a','','2026-01-02'"),
      /two different/,
    );
    assert.ok(
      (upgraded.get("fuloos_accounts")!.fields as { name: string }[]).some(
        (f) => f.name === "emoji",
      ),
    );
  } finally {
    db.close();
  }
});

