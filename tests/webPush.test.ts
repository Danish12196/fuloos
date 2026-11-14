import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  deriveWebPushStatus,
  extractPushSubscriptionPayload,
  isWebPushSupported,
  urlBase64ToUint8Array,
} from "../src/webPush.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadHookLib(filename: string) {
  const libPath = path.resolve(__dirname, "../pocketbase/pb_hooks", filename);
  const code = fs.readFileSync(libPath, "utf8");
  const cjsModule = { exports: {} as Record<string, any> };
  vm.runInNewContext(code, {
    module: cjsModule,
    exports: cjsModule.exports,
    Intl,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    RegExp,
    JSON,
  });
  return cjsModule.exports;
}

const notifLib = loadHookLib("notifications_lib.js");
const webPushLib = loadHookLib("web_push_lib.js");

test("urlBase64ToUint8Array decodes URL-safe base64 VAPID keys and rejects empty input", () => {
  const bytes = urlBase64ToUint8Array("SGVsbG8td29ybGRfIQ");
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(Buffer.from(bytes).toString("utf8"), "Hello-world_!");
  assert.throws(() => urlBase64ToUint8Array("   "), /empty/i);
});

test("extractPushSubscriptionPayload extracts keys from toJSON or getKey", () => {
  const fromJson = extractPushSubscriptionPayload(
    {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        keys: { p256dh: "p256dh-key-val", auth: "auth-secret-val" },
      }),
    },
    "Mozilla/5.0 Test",
    "2026-04-01T10:00:00.000Z",
  );
  assert.equal(fromJson.endpoint, "https://fcm.googleapis.com/fcm/send/abc123");
  assert.equal(fromJson.p256dh, "p256dh-key-val");
  assert.equal(fromJson.auth, "auth-secret-val");
  assert.equal(fromJson.user_agent, "Mozilla/5.0 Test");
  assert.equal(fromJson.created_at_iso, "2026-04-01T10:00:00.000Z");

  const rawKey = new Uint8Array([1, 2, 3, 4]).buffer;
  const fromGetKey = extractPushSubscriptionPayload(
    {
      endpoint: "https://push.example.com/1",
      getKey: () => rawKey,
    },
    "TestAgent",
    "2026-04-01T10:00:00.000Z",
  );
  assert.equal(fromGetKey.p256dh, "AQIDBA");
  assert.equal(fromGetKey.auth, "AQIDBA");

  assert.throws(
    () => extractPushSubscriptionPayload({ endpoint: "" }),
    /missing an endpoint/i,
  );
  assert.throws(
    () =>
      extractPushSubscriptionPayload({
        endpoint: "https://push.example.com/1",
      }),
    /missing encryption keys/i,
  );
});

test("isWebPushSupported and deriveWebPushStatus reflect browser & VAPID state", () => {
  assert.equal(
    isWebPushSupported({
      hasWindow: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasNotification: true,
    }),
    true,
  );
  assert.equal(
    isWebPushSupported({
      hasWindow: true,
      hasServiceWorker: true,
      hasPushManager: false,
      hasNotification: true,
    }),
    false,
  );

  assert.equal(
    deriveWebPushStatus({
      supported: true,
      vapidConfigured: false,
      permission: "default",
      subscribed: false,
    }),
    "not_configured",
  );
  assert.equal(
    deriveWebPushStatus({
      supported: true,
      vapidConfigured: true,
      permission: "denied",
      subscribed: false,
    }),
    "denied",
  );
  assert.equal(
    deriveWebPushStatus({
      supported: true,
      vapidConfigured: true,
      permission: "granted",
      subscribed: true,
    }),
    "subscribed",
  );
  assert.equal(
    deriveWebPushStatus({
      supported: true,
      vapidConfigured: true,
      permission: "default",
      subscribed: false,
    }),
    "unsubscribed",
  );
});

test("notifications_lib collects push events and builds concise push messages", () => {
  const ledger = {
    recurring: [
      {
        id: "rec1",
        name: "DEWA",
        type: "expense",
        amount: 45000,
        amount_type: "variable",
        account_id: "acc1",
        category_id: "cat1",
        frequency: "monthly",
        start_date: "2026-01-05",
        end_date: null,
        status: "active",
      },
    ],
    recurring_occurrences: [],
    budgets: [
      {
        id: "b1",
        category_id: "cat1",
        amount: 100000,
        start_month: "2026-01",
        end_month: null,
      },
    ],
    categories: [{ id: "cat1", name: "Utilities" }],
    transactions: [
      {
        id: "t1",
        type: "expense",
        amount: 85000,
        category_id: "cat1",
        date: "2026-04-02",
      },
    ],
  };

  const pushOnly = notifLib.collectPendingNotifications(
    ledger,
    {
      email_enabled: false,
      upcoming_bill_enabled: true,
      upcoming_bill_days: 3,
      budget_80_enabled: true,
      channels: { email: false, push: true },
    },
    "2026-04-03",
  );
  assert.equal(pushOnly.length, 2);
  assert.ok(pushOnly.every((e: any) => e.channel === "push"));
  assert.ok(pushOnly.some((e: any) => e.dedupKey === "push:upcoming_bill:rec1:2026-04-05"));
  assert.ok(pushOnly.some((e: any) => e.dedupKey === "push:budget_80:cat1:2026-04"));

  const both = notifLib.collectPendingNotifications(
    ledger,
    {
      email_enabled: true,
      upcoming_bill_enabled: true,
      upcoming_bill_days: 3,
      budget_80_enabled: true,
      channels: { email: true, push: true },
    },
    "2026-04-03",
  );
  assert.equal(both.length, 4);

  const msg = notifLib.buildPushMessage(pushOnly[0]);
  assert.equal(msg.title, "Upcoming bill due");
  assert.match(msg.body, /DEWA/);
  assert.equal(msg.url, "/");
  assert.equal(msg.tag, "fuloos-upcoming_bill");

  const testMsg = notifLib.buildPushMessage({ eventType: "test", payload: {} });
  assert.equal(testMsg.url, "/?settings=notifications");
});

test("web_push_lib builds relay requests and handles 200/410/error responses", () => {
  const env = {
    PUSH_RELAY_URL: "https://relay.example.com/push",
    PUSH_RELAY_SECRET: "super-secret",
    VAPID_PUBLIC_KEY: "pub-key",
    VAPID_PRIVATE_KEY: "priv-key",
    VAPID_SUBJECT: "mailto:admin@example.com",
  };
  assert.equal(webPushLib.isPushRelayConfigured(env), true);
  assert.equal(webPushLib.isVapidConfigured(env), true);
  assert.equal(webPushLib.isPushRelayConfigured({}), false);

  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/xyz",
    p256dh: "p256dh-val",
    auth: "auth-val",
  };
  const msg = {
    title: "Fuloos",
    body: "Test alert",
    url: "/?settings=notifications",
    tag: "fuloos-test",
  };

  let capturedReq: any = null;
  const okRes = JSON.parse(
    JSON.stringify(
      webPushLib.dispatchPushToSubscription(
        (req: any) => {
          capturedReq = req;
          return { statusCode: 201 };
        },
        sub,
        msg,
        env,
      ),
    ),
  );
  assert.deepEqual(okRes, { ok: true, status: 201, gone: false });
  assert.equal(capturedReq.url, "https://relay.example.com/push");
  assert.equal(capturedReq.headers.Authorization, "Bearer super-secret");
  const parsedBody = JSON.parse(capturedReq.body);
  assert.equal(parsedBody.subscription.endpoint, sub.endpoint);
  assert.equal(parsedBody.subscription.keys.p256dh, sub.p256dh);
  assert.equal(parsedBody.vapid.subject, "mailto:admin@example.com");

  const goneRes = JSON.parse(
    JSON.stringify(
      webPushLib.dispatchPushToSubscription(
        () => ({ statusCode: 410 }),
        sub,
        msg,
        env,
      ),
    ),
  );
  assert.deepEqual(goneRes, { ok: false, status: 410, gone: true });

  assert.throws(
    () =>
      webPushLib.dispatchPushToSubscription(
        () => ({ statusCode: 500 }),
        sub,
        msg,
        env,
      ),
    /HTTP 500/,
  );

  assert.throws(
    () =>
      webPushLib.dispatchPushToSubscription(
        () => ({ statusCode: 200 }),
        sub,
        msg,
        {},
      ),
    /PUSH_RELAY_URL is not configured/,
  );
});

test("1794700000_web_push migration enforces owner-only rules, triggers, and push log channel", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE fuloos_users(id TEXT PRIMARY KEY, email TEXT);
      CREATE TABLE fuloos_push_subscriptions(
        id TEXT PRIMARY KEY,
        user_id TEXT,
        endpoint TEXT,
        p256dh TEXT,
        auth TEXT,
        user_agent TEXT,
        created_at_iso TEXT
      );
      CREATE TABLE fuloos_notification_log(
        id TEXT PRIMARY KEY,
        user_id TEXT,
        dedup_key TEXT,
        channel TEXT,
        event_type TEXT,
        period_key TEXT,
        subject TEXT
      );
    `);

    const savedCollections: Record<string, any>[] = [];
    const logFields = new Map<string, any>([
      ["channel", { name: "channel", values: ["email"] }],
    ]);
    const logCollection = {
      name: "fuloos_notification_log",
      fields: { getByName: (n: string) => logFields.get(n) },
    };

    const app = {
      findCollectionByNameOrId: (name: string) => {
        if (name === "fuloos_users") return { id: "users_col_id", name };
        if (name === "fuloos_notification_log") return logCollection;
        return null;
      },
      save: (col: Record<string, any>) => savedCollections.push(col),
      db: () => ({
        newQuery: (sql: string) => ({ execute: () => db.exec(sql) }),
      }),
    };

    const migCode = fs.readFileSync(
      path.resolve(
        __dirname,
        "../pocketbase/pb_migrations/1794700000_web_push.js",
      ),
      "utf8",
    );
    vm.runInNewContext(migCode, {
      migrate: (up: (a: unknown) => void) => up(app),
      Collection: function (val: Record<string, unknown>) {
        return val;
      },
    });

    const pushCol = savedCollections.find(
      (c) => c.name === "fuloos_push_subscriptions",
    );
    assert.ok(pushCol);
    assert.match(String(pushCol.listRule), /user_id = @request\.auth\.id/);
    assert.match(
      String(pushCol.createRule),
      /@request\.body\.user_id = @request\.auth\.id/,
    );
    assert.match(
      String(pushCol.updateRule),
      /@request\.body\.user_id:isset = false/,
    );
    assert.deepEqual(Array.from(logFields.get("channel").values), ["email", "push"]);

    // Valid insert succeeds
    db.exec(
      `INSERT INTO fuloos_push_subscriptions VALUES('s1','u1','https://push.example.com/1','p256dh_1234567890','auth_1234567890','UA','2026-04-01T00:00:00Z')`,
    );
    // Rejects non-HTTPS endpoint
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO fuloos_push_subscriptions VALUES('s2','u1','http://evil.example.com/1','p256dh_1234567890','auth_1234567890','UA','2026-04-01T00:00:00Z')`,
        ),
      /valid HTTPS/,
    );
    // Rejects ownership change
    assert.throws(
      () =>
        db.exec(
          `UPDATE fuloos_push_subscriptions SET user_id='u2' WHERE id='s1'`,
        ),
      /Ownership cannot be changed/,
    );
    // Notification log now allows 'push'
    db.exec(
      `INSERT INTO fuloos_notification_log VALUES('l1','u1','push:test:1','push','test','1','Test')`,
    );
  } finally {
    db.close();
  }
});
