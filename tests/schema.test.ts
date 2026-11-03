import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("Postgres schema enforces ownership, transfer and category invariants", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
    );
    await db.exec(
      await readFile(
        new URL("../supabase/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    const userA = "00000000-0000-0000-0000-000000000001",
      userB = "00000000-0000-0000-0000-000000000002",
      accA = "10000000-0000-0000-0000-000000000001",
      accB = "10000000-0000-0000-0000-000000000002",
      card = "10000000-0000-0000-0000-000000000003",
      cat = "20000000-0000-0000-0000-000000000001";
    await db.exec(
      `insert into auth.users values('${userA}'),('${userB}'); insert into accounts(id,user_id,name,type,opening_date) values('${accA}','${userA}','Bank','current','2026-01-01'),('${accB}','${userB}','Other user','cash','2026-01-01'),('${card}','${userA}','Card','credit_card','2026-01-01'); insert into categories(id,user_id,name,type) values('${cat}','${userA}','Salary','income'); set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);`,
    );
    const result = await db.query("select id from accounts");
    assert.equal(result.rows.length, 2);
    await assert.rejects(
      db.exec(
        `insert into accounts(user_id,name,type,opening_date) values('${userB}','Spoof','cash','2026-01-01')`,
      ),
      /row-level security/,
    );
    await assert.rejects(
      db.exec(
        `insert into transactions(user_id,type,amount,account_id,date) values('${userA}','expense',100,'${accB}','2026-01-02')`,
      ),
      /foreign key/,
    );
    await assert.rejects(
      db.exec(
        `insert into transactions(user_id,type,amount,account_id,category_id,date) values('${userA}','expense',100,'${accA}','${cat}','2026-01-02')`,
      ),
      /foreign key/,
    );
    await assert.rejects(
      db.exec(
        `insert into transactions(user_id,type,amount,account_id,to_account_id,date) values('${userA}','transfer',100,'${accA}','${accA}','2026-01-02')`,
      ),
      /check constraint/,
    );
    await assert.rejects(
      db.exec(
        `insert into transactions(user_id,type,amount,account_id,date) values('${userA}','expense',100,'${accA}','2025-12-31')`,
      ),
      /before the account opening date/,
    );
    await db.exec(
      `insert into transactions(user_id,type,amount,account_id,to_account_id,date) values('${userA}','transfer',100,'${accA}','${card}','2026-01-02')`,
    );
    assert.equal((await db.query("select * from transactions")).rows.length, 1);
    await assert.rejects(
      db.exec(
        `update accounts set opening_date='2026-01-03' where id='${card}'`,
      ),
      /after an existing transaction/,
    );
    await assert.rejects(
      db.exec(`delete from accounts where id='${accA}'`),
      /foreign key/,
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','${userB}',false)`,
    );
    assert.equal((await db.query("select * from transactions")).rows.length, 0);
    assert.equal((await db.query("select * from categories")).rows.length, 0);
    await db.exec(`update accounts set name='Not allowed' where id='${accA}'`);
    await db.exec(
      `select set_config('request.jwt.claim.sub','${userA}',false)`,
    );
    assert.equal(
      (
        await db.query<{ name: string }>(
          `select name from accounts where id='${accA}'`,
        )
      ).rows[0].name,
      "Bank",
    );
  } finally {
    await db.close();
  }
});
