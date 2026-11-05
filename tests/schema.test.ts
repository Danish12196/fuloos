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

    // ========================================================================
    // Upgrade 3: 1793881800_recurring.js
    // ========================================================================
    db.exec(`CREATE TABLE fuloos_recurring(
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      type TEXT,
      amount INTEGER,
      amount_type TEXT,
      account_id TEXT,
      category_id TEXT DEFAULT '',
      frequency TEXT,
      start_date TEXT,
      end_date TEXT DEFAULT '',
      status TEXT,
      notes TEXT DEFAULT ''
    );
    CREATE TABLE fuloos_recurring_occurrences(
      id TEXT PRIMARY KEY,
      user_id TEXT,
      recurring_id TEXT,
      occurrence_date TEXT,
      transaction_id TEXT
    );`);

    let recurringDown: ((app: unknown) => void) | undefined;
    runInNewContext(
      await readFile(
        new URL(
          "../pocketbase/pb_migrations/1793881800_recurring.js",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        migrate: (
          up: (app: unknown) => void,
          down?: (app: unknown) => void,
        ) => {
          recurringDown = down;
          up({
            ...app,
            save: (c: Record<string, unknown>) => {
              collections.push(c);
              upgraded.set(String(c.name), c);
              for (const idx of (c.indexes as string[]) || []) {
                db.exec(idx);
              }
            },
            findCollectionByNameOrId: (name: string) => {
              if (name === "fuloos_users")
                return { id: "users_id", name: "fuloos_users" };
              return upgraded.get(name);
            },
          });
        },
        Collection: function (value: Record<string, unknown>) {
          return value;
        },
      },
    );

    // 1. Inspect per-user API ownership rules on recurring collections
    const recurringCol = upgraded.get("fuloos_recurring")!;
    const occurrencesCol = upgraded.get("fuloos_recurring_occurrences")!;
    assert.ok(recurringCol);
    assert.ok(occurrencesCol);

    for (const c of [recurringCol, occurrencesCol]) {
      assert.match(String(c.listRule), /user_id = @request.auth.id/);
      assert.match(String(c.viewRule), /user_id = @request.auth.id/);
      assert.match(
        String(c.createRule),
        /@request.body.user_id = @request.auth.id/,
      );
      assert.match(
        String(c.updateRule),
        /user_id = @request.auth.id && \(@request.body.user_id:isset = false \|\| @request.body.user_id = @request.auth.id\)/,
      );
      assert.match(String(c.deleteRule), /user_id = @request.auth.id/);
    }

    // 2. Validate fuloos_recurring SQLite triggers
    const insertRecurring = (fields: string) =>
      db.exec(
        `INSERT INTO fuloos_recurring(id,user_id,name,type,amount,amount_type,account_id,category_id,frequency,start_date,end_date,status,notes) VALUES(${fields})`,
      );

    // Valid schedule
    insertRecurring(
      "'r1','user-a','Internet','expense',37900,'fixed','a','salary','monthly','2026-01-01','2026-12-31','active','Home broadband'",
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM fuloos_recurring").get()?.n,
      1,
    );

    // Name validations (empty or > 160 characters)
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','   ','expense',1000,'fixed','a','','monthly','2026-01-01','','active',''",
        ),
      /Recurring name must contain 1-160 characters/,
    );
    assert.throws(
      () =>
        insertRecurring(
          `'r2','user-a','${"x".repeat(161)}','expense',1000,'fixed','a','','monthly','2026-01-01','','active',''`,
        ),
      /Recurring name must contain 1-160 characters/,
    );

    // Type must be expense or income
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Transfer Schedule','transfer',1000,'fixed','a','','monthly','2026-01-01','','active',''",
        ),
      /Recurring type must be expense or income/,
    );

    // Amount validations: negative, non-integer, > 100000000000
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',-1,'fixed','a','','monthly','2026-01-01','','active',''",
        ),
      /Amount must be nonnegative integer fils/,
    );
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',10.5,'fixed','a','','monthly','2026-01-01','','active',''",
        ),
      /Amount must be nonnegative integer fils/,
    );
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',100000000001,'fixed','a','','monthly','2026-01-01','','active',''",
        ),
      /Amount must be nonnegative integer fils/,
    );

    // Amount type, frequency and status validations
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',1000,'invalid','a','','monthly','2026-01-01','','active',''",
        ),
      /Amount type must be fixed or variable/,
    );
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',1000,'fixed','a','','biweekly','2026-01-01','','active',''",
        ),
      /Invalid recurring frequency/,
    );
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',1000,'fixed','a','','monthly','2026-01-01','','closed',''",
        ),
      /Invalid recurring status/,
    );

    // Cross-user account and category isolation
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',1000,'fixed','foreign','','monthly','2026-01-01','','active',''",
        ),
      /Account must belong to the same user/,
    );
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',1000,'fixed','a','foreign-cat','monthly','2026-01-01','','active',''",
        ),
      /Category must belong to the same user/,
    );

    // Start date and end date validations
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',1000,'fixed','a','','monthly','2026-02-29','','active',''",
        ),
      /Start date must be a valid YYYY-MM-DD date/,
    );
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',1000,'fixed','a','','monthly','2026-01-01','2026-02-29','active',''",
        ),
      /End date must be valid and on or after start date/,
    );
    assert.throws(
      () =>
        insertRecurring(
          "'r2','user-a','Sub','expense',1000,'fixed','a','','monthly','2026-05-01','2026-04-30','active',''",
        ),
      /End date must be valid and on or after start date/,
    );

    // Recurring ownership immutability
    assert.throws(
      () =>
        db.exec("UPDATE fuloos_recurring SET user_id='user-b' WHERE id='r1'"),
      /Recurring ownership cannot be changed/,
    );

    // Referenced accounts and categories cannot be deleted while referenced by recurring
    assert.throws(
      () => db.exec("DELETE FROM fuloos_accounts WHERE id='a'"),
      /Delete or reassign recurring schedules for this account first/,
    );
    assert.throws(
      () => db.exec("DELETE FROM fuloos_categories WHERE id='salary'"),
      /Reassign recurring schedules for this category first/,
    );

    // 3. Validate fuloos_recurring_occurrences SQLite triggers & Unique indexes
    const insertOccurrence = (fields: string) =>
      db.exec(
        `INSERT INTO fuloos_recurring_occurrences(id,user_id,recurring_id,occurrence_date,transaction_id) VALUES(${fields})`,
      );

    // Valid occurrence: schedule r1 (expense, user-a) linked to t8 (expense, user-a)
    insertOccurrence("'ro1','user-a','r1','2026-01-01','t8'");
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM fuloos_recurring_occurrences")
        .get()?.n,
      1,
    );

    // Occurrence date format
    assert.throws(
      () => insertOccurrence("'ro2','user-a','r1','2026-02-29','t7'"),
      /Occurrence date must be a valid YYYY-MM-DD date/,
    );

    // Foreign user recurring schedule isolation
    insertRecurring(
      "'r-b','user-b','Foreign Rent','expense',1000,'fixed','foreign','','monthly','2026-01-01','','active',''",
    );
    assert.throws(
      () => insertOccurrence("'ro2','user-a','r-b','2026-02-01','t8'"),
      /Recurring schedule must belong to the same user/,
    );

    // Foreign user transaction isolation
    db.exec(
      "INSERT INTO fuloos_transactions(id,user_id,type,amount,account_id,to_account_id,category_id,date) VALUES('t-foreign','user-b','expense',100,'foreign','','','2026-01-02')",
    );
    assert.throws(
      () => insertOccurrence("'ro2','user-a','r1','2026-02-01','t-foreign'"),
      /Linked transaction must belong to the same user/,
    );

    // Transaction type mismatch: r1 is expense, t7 is income, t1 is transfer
    assert.throws(
      () => insertOccurrence("'ro2','user-a','r1','2026-02-01','t7'"),
      /Linked transaction type must match recurring schedule type/,
    );
    assert.throws(
      () => insertOccurrence("'ro2','user-a','r1','2026-02-01','t1'"),
      /Linked transaction type must match recurring schedule type/,
    );

    // Unique index & trigger: same occurrence date already confirmed on schedule
    insert(
      "'t-extra','user-a','expense',50,'a','','salary','2026-01-02'",
    );
    assert.throws(
      () => insertOccurrence("'ro-dup','user-a','r1','2026-01-01','t-extra'"),
      /Occurrence is already confirmed|UNIQUE constraint failed/,
    );

    // Unique index & trigger: transaction already linked to another occurrence
    assert.throws(
      () => insertOccurrence("'ro-dup-tx','user-a','r1','2026-02-01','t8'"),
      /Transaction is already linked to a recurring occurrence|UNIQUE constraint failed/,
    );

    // Occurrence ownership immutability
    assert.throws(
      () =>
        db.exec(
          "UPDATE fuloos_recurring_occurrences SET user_id='user-b' WHERE id='ro1'",
        ),
      /Recurring occurrence ownership cannot be changed/,
    );

    // 4. Guard against changing type on linked recurring schedules or transactions
    assert.throws(
      () => db.exec("UPDATE fuloos_recurring SET type='income' WHERE id='r1'"),
      /Cannot change recurring type after occurrences are confirmed/,
    );
    assert.throws(
      () =>
        db.exec("UPDATE fuloos_transactions SET type='income' WHERE id='t8'"),
      /Unlink recurring occurrence before changing transaction type/,
    );

    // Non-type updates on linked records succeed
    db.exec("UPDATE fuloos_recurring SET amount=40000 WHERE id='r1'");
    db.exec("UPDATE fuloos_transactions SET notes='Updated note' WHERE id='t8'");

    // 4b. Year bounds (1970..2100) and occurrence/schedule date-range alignment triggers
    assert.throws(
      () =>
        insertRecurring(
          "'r-ancient','user-a','Ancient','expense',1000,'fixed','a','','daily','0026-01-01','','active',''",
        ),
      /between 1970-01-01 and 2100-12-31/,
    );
    assert.throws(
      () =>
        insertRecurring(
          "'r-far','user-a','Far Future','expense',1000,'fixed','a','','monthly','2026-01-01','2101-01-01','active',''",
        ),
      /End date must be valid and on or after start date/,
    );
    // Occurrence before schedule start_date or after end_date is rejected by SQLite trigger
    db.exec("UPDATE fuloos_recurring SET end_date='2026-06-01' WHERE id='r1'");
    assert.throws(
      () => insertOccurrence("'ro-before','user-a','r1','2025-12-01','t-extra'"),
      /Occurrence date is outside schedule date range/,
    );
    assert.throws(
      () => insertOccurrence("'ro-after','user-a','r1','2026-07-01','t-extra'"),
      /Occurrence date is outside schedule date range/,
    );
    // Updating schedule start_date/end_date to strand existing confirmed occurrence ro1 ('2026-01-01') is rejected
    assert.throws(
      () => db.exec("UPDATE fuloos_recurring SET start_date='2026-02-01' WHERE id='r1'"),
      /Confirmed occurrences fall outside updated schedule dates/,
    );
    insertOccurrence("'ro-mar','user-a','r1','2026-03-01','t-extra'");
    assert.throws(
      () => db.exec("UPDATE fuloos_recurring SET end_date='2026-02-01' WHERE id='r1'"),
      /Confirmed occurrences fall outside updated schedule dates/,
    );
    db.exec("DELETE FROM fuloos_recurring_occurrences WHERE id='ro-mar'");
    db.exec("UPDATE fuloos_recurring SET end_date='' WHERE id='r1'");

    // 5. Safe deletion triggers:
    // Deleting a linked transaction deletes its occurrence record and leaves recurring schedule intact
    db.exec("DELETE FROM fuloos_transactions WHERE id='t8'");
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM fuloos_recurring_occurrences WHERE id='ro1'",
        )
        .get()?.n,
      0,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM fuloos_recurring WHERE id='r1'")
        .get()?.n,
      1,
    );

    // Link a new occurrence, then delete recurring schedule
    insertOccurrence("'ro1_new','user-a','r1','2026-01-01','t-extra'");
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM fuloos_recurring_occurrences WHERE id='ro1_new'",
        )
        .get()?.n,
      1,
    );

    // Deleting recurring schedule removes its occurrences but keeps historical transactions intact
    db.exec("DELETE FROM fuloos_recurring WHERE id='r1'");
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM fuloos_recurring_occurrences WHERE id='ro1_new'",
        )
        .get()?.n,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM fuloos_transactions WHERE id='t-extra'",
        )
        .get()?.n,
      1,
    );

    // 6. Test down migration cleans up triggers and drops collections
    assert.ok(recurringDown);
    const deletedCollections: string[] = [];
    recurringDown!({
      ...app,
      delete: (col: { name: string }) => deletedCollections.push(col.name),
      findCollectionByNameOrId: (name: string) => ({ name }),
    });
    assert.deepEqual(deletedCollections, [
      "fuloos_recurring_occurrences",
      "fuloos_recurring",
    ]);
  } finally {
    db.close();
  }
});
