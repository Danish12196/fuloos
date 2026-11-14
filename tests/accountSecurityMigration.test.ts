import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("account security migration configures opt-in MFA and Email OTP on fuloos_users", async () => {
  const fields: Record<string, unknown>[] = [];
  const users: {
    name: string;
    otp: Record<string, unknown>;
    mfa: Record<string, unknown>;
    fields: {
      getByName: (name: string) => unknown;
      add: (f: Record<string, unknown>) => void;
      removeByName: (name: string) => void;
    };
  } = {
    name: "fuloos_users",
    otp: { enabled: false },
    mfa: { enabled: false, rule: "" },
    fields: {
      getByName: (name) => fields.find((f) => f.name === name) ?? null,
      add: (f) => fields.push(f),
      removeByName: (name) => {
        const idx = fields.findIndex((f) => f.name === name);
        if (idx >= 0) fields.splice(idx, 1);
      },
    },
  };

  let saved: unknown = null;
  let upFn!: (app: unknown) => void;
  let downFn!: (app: unknown) => void;
  const app = {
    findCollectionByNameOrId: (name: string) => {
      assert.equal(name, "fuloos_users");
      return users;
    },
    save: (c: unknown) => {
      saved = c;
    },
  };

  runInNewContext(
    await readFile(
      new URL(
        "../pocketbase/pb_migrations/1794520000_account_security.js",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      migrate: (up: (app: unknown) => void, down: (app: unknown) => void) => {
        upFn = up;
        downFn = down;
      },
      Field: function (value: Record<string, unknown>) {
        return value;
      },
    },
  );

  upFn(app);
  assert.equal(saved, users);
  assert.ok(fields.some((f) => f.name === "mfa_enabled" && f.type === "bool"));
  assert.equal(users.otp.enabled, true);
  assert.equal(users.mfa.enabled, true);
  assert.equal(users.mfa.rule, "mfa_enabled = true");

  downFn(app);
  assert.equal(users.mfa.enabled, false);
  assert.equal(users.otp.enabled, false);
  assert.equal(fields.length, 0);
});

test("vercel.json defines strict CSP (with PWA worker/manifest), HSTS, and frame-ancestors none", async () => {
  const raw = await readFile(
    new URL("../vercel.json", import.meta.url),
    "utf8",
  );
  const config = JSON.parse(raw) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const globalRule = config.headers.find((h) => h.source === "/(.*)");
  assert.ok(globalRule);
  const byKey = new Map(globalRule.headers.map((h) => [h.key, h.value]));
  assert.match(byKey.get("Strict-Transport-Security") ?? "", /max-age=/);
  assert.equal(byKey.get("X-Content-Type-Options"), "nosniff");
  assert.equal(
    byKey.get("Referrer-Policy"),
    "strict-origin-when-cross-origin",
  );
  assert.ok(byKey.get("Permissions-Policy"));
  const csp = byKey.get("Content-Security-Policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /worker-src 'self'/);
  assert.match(csp, /manifest-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /https:\/\/pb\.danishali\.dev/);
});
