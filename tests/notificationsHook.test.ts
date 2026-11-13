import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { budgetReport } from "../src/budgets.ts";
import {
  defaultNotificationPreferences,
  type Ledger,
  type NotificationPreferences,
} from "../src/domain.ts";
import { buildIntelligentForecast } from "../src/recurringForecast.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.resolve(
  __dirname,
  "../pocketbase/pb_hooks/notifications_lib.js",
);
const libCode = fs.readFileSync(libPath, "utf8");
const cjsModule = { exports: {} as Record<string, any> };
vm.runInNewContext(libCode, {
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
const lib = cjsModule.exports;

function makeFixtureLedger(): Ledger {
  return {
    accounts: [
      {
        id: "acc1",
        name: "Checking",
        type: "current",
        opening_balance: 1_000_000,
        opening_date: "2026-01-01",
        color: "#1d5b48",
      },
      {
        id: "acc2",
        name: "Savings",
        type: "savings",
        opening_balance: 500_000,
        opening_date: "2026-01-01",
        color: "#b08448",
      },
    ],
    categories: [
      {
        id: "cat_food",
        name: "Dining & <Cafés>",
        description: "",
        color: "#c79857",
      },
      {
        id: "cat_groc",
        name: "Groceries",
        description: "",
        color: "#6c9b77",
      },
      {
        id: "cat_bills",
        name: "Utilities",
        description: "",
        color: "#9e8aba",
      },
      {
        id: "cat_zero",
        name: "Shopping",
        description: "",
        color: "#b68aa0",
      },
    ],
    transactions: [
      // cat_food: 80% of 100,000 = 80,000 -> near
      {
        id: "tx1",
        type: "expense",
        amount: 80_000,
        account_id: "acc1",
        to_account_id: null,
        category_id: "cat_food",
        date: "2026-03-10",
        payee: "Cafe",
        notes: "",
      },
      // Income in cat_food should NOT consume budget
      {
        id: "tx2",
        type: "income",
        amount: 50_000,
        account_id: "acc1",
        to_account_id: null,
        category_id: "cat_food",
        date: "2026-03-11",
        payee: "Refund",
        notes: "",
      },
      // cat_groc: 120,000 > 100,000 -> over
      {
        id: "tx3",
        type: "expense",
        amount: 120_000,
        account_id: "acc1",
        to_account_id: null,
        category_id: "cat_groc",
        date: "2026-03-12",
        payee: "Spinneys",
        notes: "",
      },
      // cat_bills: 20,000 / 100,000 -> under
      {
        id: "tx4",
        type: "expense",
        amount: 20_000,
        account_id: "acc1",
        to_account_id: null,
        category_id: "cat_bills",
        date: "2026-03-01",
        payee: "DEWA",
        notes: "",
      },
      // Transfer should NOT consume any budget
      {
        id: "tx5",
        type: "transfer",
        amount: 300_000,
        account_id: "acc1",
        to_account_id: "acc2",
        category_id: null,
        date: "2026-03-14",
        payee: "Savings",
        notes: "",
      },
      // Zero budget with spending -> over
      {
        id: "tx6",
        type: "expense",
        amount: 5_000,
        account_id: "acc1",
        to_account_id: null,
        category_id: "cat_zero",
        date: "2026-03-14",
        payee: "Mall",
        notes: "",
      },
    ],
    budgets: [
      {
        id: "b_food",
        category_id: "cat_food",
        amount: 100_000,
        start_month: "2026-01",
        end_month: null,
      },
      {
        id: "b_groc",
        category_id: "cat_groc",
        amount: 100_000,
        start_month: "2026-01",
        end_month: "2026-06",
      },
      {
        id: "b_bills",
        category_id: "cat_bills",
        amount: 100_000,
        start_month: "2026-03",
        end_month: null,
      },
      {
        id: "b_zero",
        category_id: "cat_zero",
        amount: 0,
        start_month: "2026-03",
        end_month: null,
      },
    ],
    recurring: [
      // Month-end clamping: 31st -> Feb 28 (overdue on 2026-03-15), Mar 31 (outside 3d)
      {
        id: "rec_eom",
        name: "Rent <Villa>",
        type: "expense",
        amount: 500_000,
        amount_type: "fixed",
        account_id: "acc1",
        category_id: "cat_bills",
        frequency: "monthly",
        start_date: "2026-01-31",
        end_date: null,
        status: "active",
        notes: "",
      },
      // Due in 2 days (2026-03-17) from asOfDate 2026-03-15
      {
        id: "rec_soon",
        name: "DEWA Bill",
        type: "expense",
        amount: 45_000,
        amount_type: "fixed",
        account_id: "acc1",
        category_id: "cat_bills",
        frequency: "monthly",
        start_date: "2026-02-17",
        end_date: null,
        status: "active",
        notes: "",
      },
      // Paused schedule: must be ignored
      {
        id: "rec_paused",
        name: "Paused Gym",
        type: "expense",
        amount: 30_000,
        amount_type: "fixed",
        account_id: "acc1",
        category_id: null,
        frequency: "monthly",
        start_date: "2026-03-16",
        end_date: null,
        status: "paused",
        notes: "",
      },
    ],
    recurring_occurrences: [
      // Confirm Jan 31 and Feb 17 so only Feb 28 is overdue and Mar 17 is upcoming
      {
        id: "occ1",
        recurring_id: "rec_eom",
        occurrence_date: "2026-01-31",
        transaction_id: "tx4",
      },
      {
        id: "occ2",
        recurring_id: "rec_soon",
        occurrence_date: "2026-02-17",
        transaction_id: "tx4",
      },
    ],
  };
}

test("notifications_lib recurring alerts match buildIntelligentForecast parity", () => {
  const ledger = makeFixtureLedger();
  const asOfDate = "2026-03-15";
  const upcomingDays = 3;

  const tsForecast = buildIntelligentForecast(ledger, asOfDate);
  const tsOverdue = tsForecast.upcomingItems
    .filter((i) => i.status === "overdue")
    .map((i) => `${i.schedule.id}:${i.scheduledDate}`);
  const tsUpcoming = tsForecast.upcomingItems
    .filter(
      (i) =>
        !i.isConfirmed &&
        i.scheduledDate >= asOfDate &&
        i.scheduledDate <= "2026-03-18",
    )
    .map((i) => `${i.schedule.id}:${i.scheduledDate}`);

  const hookAlerts = lib.computeRecurringAlerts(ledger, asOfDate, upcomingDays);
  const hookOverdue = Array.from(hookAlerts.overdue, (i: { schedule: { id: string }; scheduledDate: string }) =>
    `${i.schedule.id}:${i.scheduledDate}`,
  );
  const hookUpcoming = Array.from(hookAlerts.upcoming, (i: { schedule: { id: string }; scheduledDate: string }) =>
    `${i.schedule.id}:${i.scheduledDate}`,
  );

  assert.deepEqual(hookOverdue, tsOverdue);
  assert.deepEqual(hookUpcoming, tsUpcoming);
  assert.deepEqual(hookOverdue, ["rec_eom:2026-02-28"]);
  assert.deepEqual(hookUpcoming, ["rec_soon:2026-03-17"]);
});

test("notifications_lib budget alerts match budgetReport parity", () => {
  const ledger = makeFixtureLedger();
  const month = "2026-03";

  const tsReport = budgetReport(ledger, month, month);
  const hookRows = lib.computeBudgetAlerts(ledger, month);

  assert.equal(hookRows.length, tsReport.rows.length);
  for (let i = 0; i < tsReport.rows.length; i++) {
    assert.equal(hookRows[i].category.id, tsReport.rows[i].category.id);
    assert.equal(hookRows[i].budget, tsReport.rows[i].budget);
    assert.equal(hookRows[i].actual, tsReport.rows[i].actual);
    assert.equal(hookRows[i].status, tsReport.rows[i].status);
  }
});

test("notifications_lib respects quiet defaults, opt-in flags, digest day, and dedup keys", () => {
  const ledger = makeFixtureLedger();
  const asOfDate = "2026-03-15"; // 2026-03-15 is a Sunday ("sun")

  // Quiet defaults: nothing sent
  assert.equal(
    lib.collectPendingNotifications(ledger, defaultNotificationPreferences, asOfDate).length,
    0,
  );

  // Master email on, all events off: nothing sent
  assert.equal(
    lib.collectPendingNotifications(
      ledger,
      { ...defaultNotificationPreferences, email_enabled: true },
      asOfDate,
    ).length,
    0,
  );

  // All events enabled on Sunday
  const allOn: NotificationPreferences = {
    email_enabled: true,
    upcoming_bill_enabled: true,
    upcoming_bill_days: 3,
    overdue_enabled: true,
    budget_80_enabled: true,
    budget_100_enabled: true,
    weekly_digest_enabled: true,
    digest_day: "sun",
    timezone: "Asia/Dubai",
    channels: { email: true },
  };
  const pending = lib.collectPendingNotifications(ledger, allOn, asOfDate);
  const keys = Array.from(pending, (e: { dedupKey: string }) => e.dedupKey);

  assert.deepEqual(keys, [
    "email:upcoming_bill:rec_soon:2026-03-17",
    "email:overdue_bill:rec_eom:2026-02-28",
    "email:budget_100:cat_zero:2026-03",
    "email:budget_100:cat_groc:2026-03",
    "email:budget_80:cat_food:2026-03",
    "email:weekly_digest:2026-W11",
  ]);

  // Different digest day skips weekly digest
  const mondayOnly = { ...allOn, digest_day: "mon" as const };
  const pendingMon = lib.collectPendingNotifications(ledger, mondayOnly, asOfDate);
  assert.ok(
    !pendingMon.some(
      (e: { eventType: string }) => e.eventType === "weekly_digest",
    ),
  );
});

test("notifications_lib escapes HTML, formats AED, includes APP_URL manage link, and supports pluggable channels", () => {
  const ledger = makeFixtureLedger();
  const msg = lib.buildEmailMessage(
    {
      channel: "email",
      eventType: "upcoming_bill",
      periodKey: "2026-03-17",
      dedupKey: "email:upcoming_bill:rec_eom:2026-03-17",
      payload: {
        scheduleName: 'Rent <script>alert("x")</script> & Villa',
        scheduleType: "expense",
        amount: 500_000,
        scheduledDate: "2026-03-17",
        daysUntil: 2,
      },
    },
    "https://fuloos.example.com/",
  );

  assert.match(msg.text, /AED 5,000\.00/);
  assert.match(msg.text, /https:\/\/fuloos\.example\.com\/\?settings=notifications/);
  assert.ok(!msg.html.includes("<script>"));
  assert.ok(msg.html.includes("&lt;script&gt;"));
  assert.ok(msg.html.includes("&amp; Villa"));
  assert.ok(msg.html.includes("https://fuloos.example.com/?settings=notifications"));
  // Privacy: unrelated transactions like Spinneys/Mall are not in this item's email
  assert.ok(!msg.text.includes("Spinneys"));

  // Pluggable channel dispatcher
  const sent: string[] = [];
  const dispatcher = lib.createChannelDispatcher({
    email: (to: string, m: { subject: string }) => {
      sent.push(`${to}:${m.subject}`);
    },
  });
  assert.equal(dispatcher.supports("email"), true);
  assert.equal(dispatcher.supports("push"), false);
  dispatcher.send("email", "user@example.com", msg);
  assert.equal(sent.length, 1);
  assert.throws(() => dispatcher.send("push", "user@example.com", msg));
  assert.ok(ledger.accounts.length > 0);
});
