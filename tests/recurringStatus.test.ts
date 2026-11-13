import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balance,
  emptyLedger,
  minor,
  today,
  totals,
  uaeToday,
  validateTransaction,
  type Account,
  type Category,
  type Ledger,
  type RecurringOccurrenceRecord,
  type RecurringSchedule,
  type Transaction,
} from "../src/domain.ts";
import {
  addDays,
  buildConfirmTransaction,
  dashboardRecurringSummary,
  daysBetween,
  daysInMonth,
  describeScheduleStatus,
  formatIsoDate,
  generateOccurrences,
  isScheduledOccurrence,
  isValidIsoDate,
  listOccurrences,
  monthRange,
  occurrenceAtStep,
  parseIsoDate,
  validateOccurrenceConfirmation,
  validateRecurringSchedule,
} from "../src/recurring.ts";
import { demoLedger } from "../src/demo.ts";

const testAccount: Account = {
  id: "acc-main",
  name: "Main Current",
  type: "current",
  opening_balance: 500000,
  opening_date: "2026-01-01",
  color: "#1d5b48",
};

const savingsAccount: Account = {
  id: "acc-savings",
  name: "Savings",
  type: "savings",
  opening_balance: 1000000,
  opening_date: "2026-01-01",
  color: "#b08448",
};

const billsCategory: Category = {
  id: "cat-bills",
  name: "Bills",
  description: "Utilities and subscriptions",
  color: "#9e8aba",
};

const salaryCategory: Category = {
  id: "cat-salary",
  name: "Salary",
  description: "Payroll income",
  color: "#1d5b48",
};

function baseLedger(): Ledger {
  return {
    accounts: [testAccount, savingsAccount],
    categories: [billsCategory, salaryCategory],
    transactions: [],
    recurring: [],
    recurring_occurrences: [],
  };
}

test("validateTransaction rejects changing type on transactions linked to recurring occurrences", () => {
  const ledger = baseLedger();
  const schedule: RecurringSchedule = {
    id: "r1",
    name: "Salary",
    type: "income",
    amount: 1500000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-salary",
    frequency: "monthly",
    start_date: "2026-01-25",
    end_date: null,
    status: "active",
    notes: "",
  };
  const linkedTx: Transaction = {
    id: "t-linked",
    type: "income",
    amount: 1500000,
    account_id: "acc-main",
    to_account_id: null,
    category_id: "cat-salary",
    date: "2026-01-25",
    payee: "Employer",
    notes: "January pay",
  };
  ledger.recurring = [schedule];
  ledger.transactions = [linkedTx];
  ledger.recurring_occurrences = [
    { id: "ro1", recurring_id: "r1", occurrence_date: "2026-01-25", transaction_id: "t-linked" },
  ];

  // Changing notes, amount, date, payee on linked transaction is allowed
  assert.doesNotThrow(() =>
    validateTransaction(
      { ...linkedTx, amount: 1550000, notes: "Includes bonus" },
      ledger,
    ),
  );

  // Changing type to expense on linked transaction is blocked
  assert.throws(
    () =>
      validateTransaction(
        { ...linkedTx, type: "expense", category_id: "cat-bills" },
        ledger,
      ),
    /Unlink recurring occurrence before changing transaction type/,
  );

  // Changing type to transfer on linked transaction is blocked
  assert.throws(
    () =>
      validateTransaction(
        { ...linkedTx, type: "transfer", to_account_id: "acc-savings", category_id: null },
        ledger,
      ),
    /Unlink recurring occurrence before changing transaction type/,
  );

  // An unlinked transaction can freely change type
  const unlinkedTx: Transaction = {
    id: "t-unlinked",
    type: "income",
    amount: 10000,
    account_id: "acc-main",
    to_account_id: null,
    category_id: "cat-salary",
    date: "2026-01-26",
    payee: "Refund",
    notes: "",
  };
  ledger.transactions.push(unlinkedTx);

  assert.doesNotThrow(() =>
    validateTransaction(
      { ...unlinkedTx, type: "expense", category_id: "cat-bills" },
      ledger,
    ),
  );
});

// ============================================================================
// 3. Ledger Balance Integrity & Dashboard Forecast Separation
// ============================================================================

test("schedules never alter balance() or totals() until real transactions exist", () => {
  const ledger = baseLedger();
  const initialBalance = balance(testAccount, ledger.transactions);
  assert.equal(initialBalance, 500000); // 5,000.00 AED opening balance
  assert.deepEqual(totals(ledger.transactions), { income: 0, expense: 0 });

  // Add huge active, overdue, and upcoming schedules
  ledger.recurring = [
    {
      id: "r-huge-expense",
      name: "Villa Rent",
      type: "expense",
      amount: 18000000, // 180,000.00 AED
      amount_type: "fixed",
      account_id: "acc-main",
      category_id: "cat-bills",
      frequency: "monthly",
      start_date: "2026-01-01",
      end_date: null,
      status: "active",
      notes: "Annual rent installments",
    },
    {
      id: "r-huge-income",
      name: "Business Contract",
      type: "income",
      amount: 50000000, // 500,000.00 AED
      amount_type: "fixed",
      account_id: "acc-main",
      category_id: "cat-salary",
      frequency: "monthly",
      start_date: "2026-01-01",
      end_date: null,
      status: "active",
      notes: "Client retainer",
    },
    {
      id: "r-paused",
      name: "Gym",
      type: "expense",
      amount: 30000,
      amount_type: "fixed",
      account_id: "acc-main",
      category_id: "cat-bills",
      frequency: "monthly",
      start_date: "2026-01-01",
      end_date: null,
      status: "paused",
      notes: "",
    },
  ];

  // Ledger balances and totals must remain completely untouched by recurring schedules alone
  assert.equal(balance(testAccount, ledger.transactions), 500000);
  assert.deepEqual(totals(ledger.transactions), { income: 0, expense: 0 });

  // Link an existing transaction to an occurrence
  const realTx: Transaction = {
    id: "tx-rent-q1",
    type: "expense",
    amount: 18000000,
    account_id: "acc-main",
    to_account_id: null,
    category_id: "cat-bills",
    date: "2026-01-01",
    payee: "Landlord",
    notes: "Q1 payment",
  };
  ledger.transactions.push(realTx);
  const balanceAfterTx = balance(testAccount, ledger.transactions);
  assert.equal(balanceAfterTx, 500000 - 18000000);

  // Confirming the occurrence by linking the existing transaction DOES NOT duplicate or change balance
  ledger.recurring_occurrences = [
    {
      id: "ro-rent-q1",
      recurring_id: "r-huge-expense",
      occurrence_date: "2026-01-01",
      transaction_id: "tx-rent-q1",
    },
  ];
  assert.equal(balance(testAccount, ledger.transactions), balanceAfterTx);
  assert.deepEqual(totals(ledger.transactions), { income: 0, expense: 18000000 });
});

test("describeScheduleStatus covers overdue, due_today, upcoming, paid, paused, and completed", () => {
  const ledger = baseLedger();
  const asOf = "2026-03-15";

  // 1. Paused
  const pausedSched: RecurringSchedule = {
    id: "r-paused",
    name: "Subscription",
    type: "expense",
    amount: 5000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-01-10",
    end_date: null,
    status: "paused",
    notes: "",
  };
  const pausedStatus = describeScheduleStatus(pausedSched, ledger, asOf);
  assert.equal(pausedStatus.paymentStatus, "paused");
  assert.equal(pausedStatus.nextDueDate, "2026-04-10"); // first unconfirmed on/after asOf
  assert.deepEqual(pausedStatus.overdueDates, []);

  // 2. Overdue: active schedule with past occurrence unconfirmed
  const overdueSched: RecurringSchedule = {
    id: "r-overdue",
    name: "Electricity",
    type: "expense",
    amount: 30000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-03-05",
    end_date: null,
    status: "active",
    notes: "",
  };
  const overdueStatus = describeScheduleStatus(overdueSched, ledger, asOf);
  assert.equal(overdueStatus.paymentStatus, "overdue");
  assert.equal(overdueStatus.nextDueDate, "2026-03-05");
  assert.deepEqual(overdueStatus.overdueDates, ["2026-03-05"]);

  // 3. Due today: active schedule with occurrence on asOfDate
  const dueTodaySched: RecurringSchedule = {
    id: "r-today",
    name: "Internet",
    type: "expense",
    amount: 35000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-03-15",
    end_date: null,
    status: "active",
    notes: "",
  };
  const dueTodayStatus = describeScheduleStatus(dueTodaySched, ledger, asOf);
  assert.equal(dueTodayStatus.paymentStatus, "due_today");
  assert.equal(dueTodayStatus.nextDueDate, "2026-03-15");
  assert.deepEqual(dueTodayStatus.overdueDates, []);

  // 4. Upcoming: future start date, never confirmed
  const upcomingSched: RecurringSchedule = {
    id: "r-upcoming",
    name: "Streaming",
    type: "expense",
    amount: 4000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-03-25",
    end_date: null,
    status: "active",
    notes: "",
  };
  const upcomingStatus = describeScheduleStatus(upcomingSched, ledger, asOf);
  assert.equal(upcomingStatus.paymentStatus, "upcoming");
  assert.equal(upcomingStatus.nextDueDate, "2026-03-25");
  assert.deepEqual(upcomingStatus.overdueDates, []);

  // 5. Paid: current period confirmed, next occurrence in future
  const paidSched: RecurringSchedule = {
    id: "r-paid",
    name: "Salary",
    type: "income",
    amount: 1500000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-salary",
    frequency: "monthly",
    start_date: "2026-03-01",
    end_date: null,
    status: "active",
    notes: "",
  };
  const ledgerWithPaid: Ledger = {
    ...ledger,
    recurring_occurrences: [
      { id: "ro1", recurring_id: "r-paid", occurrence_date: "2026-03-01", transaction_id: "t1" },
    ],
  };
  const paidStatus = describeScheduleStatus(paidSched, ledgerWithPaid, asOf);
  assert.equal(paidStatus.paymentStatus, "paid");
  assert.equal(paidStatus.nextDueDate, "2026-04-01");
  assert.deepEqual(paidStatus.overdueDates, []);
  assert.equal(paidStatus.confirmedCount, 1);

  // 6. Completed: schedule has end_date and all occurrences are confirmed
  const completedSched: RecurringSchedule = {
    id: "r-completed",
    name: "Loan Term",
    type: "expense",
    amount: 100000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-01-01",
    end_date: "2026-02-01",
    status: "active",
    notes: "",
  };
  const ledgerWithCompleted: Ledger = {
    ...ledger,
    recurring_occurrences: [
      { id: "ro-c1", recurring_id: "r-completed", occurrence_date: "2026-01-01", transaction_id: "t-c1" },
      { id: "ro-c2", recurring_id: "r-completed", occurrence_date: "2026-02-01", transaction_id: "t-c2" },
    ],
  };
  const completedStatus = describeScheduleStatus(completedSched, ledgerWithCompleted, asOf);
  assert.equal(completedStatus.paymentStatus, "completed");
  assert.equal(completedStatus.nextDueDate, null);
  assert.deepEqual(completedStatus.overdueDates, []);
});

test("dashboardRecurringSummary accurately calculates 30-day forecast and monthly breakdown with zero double-counting", () => {
  const ledger = baseLedger();
  const asOf = "2026-11-10";
  const month = "2026-11";

  // Setup schedules:
  // 1. Rent: expense 500000, monthly on 1st. On Nov 10, Nov 1 is overdue (unconfirmed).
  const rentSched: RecurringSchedule = {
    id: "r-rent",
    name: "Rent",
    type: "expense",
    amount: 500000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-11-01",
    end_date: null,
    status: "active",
    notes: "",
  };

  // 2. Internet: expense 35000, monthly on 5th. Paid via linked transaction t-net on Nov 5.
  const netSched: RecurringSchedule = {
    id: "r-net",
    name: "Internet",
    type: "expense",
    amount: 35000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-11-05",
    end_date: null,
    status: "active",
    notes: "",
  };

  // 3. Salary: income 2000000, monthly on 25th. Upcoming in November (within 30d).
  const salarySched: RecurringSchedule = {
    id: "r-salary",
    name: "Salary",
    type: "income",
    amount: 2000000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-salary",
    frequency: "monthly",
    start_date: "2026-11-25",
    end_date: null,
    status: "active",
    notes: "",
  };

  // 4. Paused gym membership: monthly on 15th
  const gymSched: RecurringSchedule = {
    id: "r-gym",
    name: "Gym",
    type: "expense",
    amount: 25000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-11-15",
    end_date: null,
    status: "paused",
    notes: "",
  };

  ledger.recurring = [rentSched, netSched, salarySched, gymSched];

  // Transactions:
  // t-net is the payment for Internet on Nov 5 (actual: 35000)
  // t-coffee is an unrelated non-recurring expense (actual: 2500)
  const txNet: Transaction = {
    id: "t-net",
    type: "expense",
    amount: 35000,
    account_id: "acc-main",
    to_account_id: null,
    category_id: "cat-bills",
    date: "2026-11-05",
    payee: "du",
    notes: "",
  };
  const txCoffee: Transaction = {
    id: "t-coffee",
    type: "expense",
    amount: 2500,
    account_id: "acc-main",
    to_account_id: null,
    category_id: null,
    date: "2026-11-08",
    payee: "Cafe",
    notes: "",
  };
  ledger.transactions = [txNet, txCoffee];

  // Recurring confirmation linking t-net to netSched
  ledger.recurring_occurrences = [
    {
      id: "ro-net",
      recurring_id: "r-net",
      occurrence_date: "2026-11-05",
      transaction_id: "t-net",
    },
  ];

  const summary = dashboardRecurringSummary(ledger, asOf, month);

  // 1. Overdue count: Rent Nov 1 is unconfirmed and overdue
  assert.equal(summary.overdueCount, 1);

  // 2. Horizon date is asOf + 30 days
  assert.equal(summary.horizonDate, "2026-12-10");

  // 3. Upcoming 30 days:
  // - Nov 25 Salary (income: 2,000,000)
  // - Dec 01 Rent (expense: 500,000)
  // - Dec 05 Internet (expense: 35,000)
  // - Paused Gym is excluded
  // - Already paid Nov 05 Internet is excluded
  assert.equal(summary.upcoming30Days.items.length, 3);
  assert.equal(summary.upcoming30Days.income, 2000000);
  assert.equal(summary.upcoming30Days.expense, 535000);

  // 4. Monthly breakdown for November 2026:
  // Actual transactions in November: t-net (35,000 expense) + t-coffee (2,500 expense)
  assert.deepEqual(summary.monthly.actual, { income: 0, expense: 37500 });

  // Confirmed recurring in November: netSched linked to t-net (35,000 expense)
  assert.deepEqual(summary.monthly.confirmed, { income: 0, expense: 35000 });

  // Unconfirmed recurring in November:
  // rentSched Nov 1 (500,000 expense) + salarySched Nov 25 (2,000,000 income)
  assert.deepEqual(summary.monthly.unconfirmed, { income: 2000000, expense: 500000 });

  // Estimated = Confirmed + Unconfirmed
  assert.deepEqual(summary.monthly.estimated, {
    income: 0 + 2000000,
    expense: 35000 + 500000, // 535,000
  });

  // Projected = Actual + Unconfirmed
  // Crucial invariant: t-net was already counted in actual, so it is NOT in unconfirmed!
  // No double counting of linked payments!
  assert.deepEqual(summary.monthly.projected, {
    income: 0 + 2000000,
    expense: 37500 + 500000, // 537,500 (37,500 actual + 500,000 unconfirmed)
  });
});

test("demoLedger has valid and consistent recurring schedules and occurrences", () => {
  const ledger = demoLedger();
  assert.ok(ledger.accounts.length >= 4);
  assert.ok(ledger.recurring && ledger.recurring.length >= 5);
  assert.ok(ledger.recurring_occurrences && ledger.recurring_occurrences.length >= 2);

  // Validate every recurring schedule in demoLedger
  for (const schedule of ledger.recurring) {
    assert.doesNotThrow(
      () => validateRecurringSchedule(schedule, ledger),
      `Schedule ${schedule.name} failed validation`,
    );
  }

  // Validate every occurrence confirmation in demoLedger
  for (const occ of ledger.recurring_occurrences) {
    // Check occurrence is valid on the schedule
    const schedule = ledger.recurring.find((r) => r.id === occ.recurring_id);
    assert.ok(schedule, `Schedule for occurrence ${occ.id} not found`);
    assert.ok(
      isScheduledOccurrence(schedule, occ.occurrence_date),
      `Occurrence date ${occ.occurrence_date} not on schedule ${schedule.name}`,
    );

    // Linked transaction must exist and have matching type
    const tx = ledger.transactions.find((t) => t.id === occ.transaction_id);
    assert.ok(tx, `Transaction for occurrence ${occ.id} not found`);
    assert.equal(tx.type, schedule.type);
  }

  // Validate every transaction in demoLedger
  for (const tx of ledger.transactions) {
    assert.doesNotThrow(
      () => validateTransaction(tx, ledger),
      `Transaction ${tx.id} (${tx.payee}) failed validation`,
    );
  }

  // Ensure dashboard recurring summary executes smoothly on demoLedger
  const summary = dashboardRecurringSummary(ledger);
  assert.ok(summary.horizonDate > summary.asOfDate);
  assert.ok(summary.monthly.projected.expense >= 0);
  assert.ok(summary.monthly.projected.income >= 0);
});

test("describeScheduleStatus transitions from paid back to upcoming within lead window and then due_today/overdue", () => {
  const ledger = baseLedger();
  const monthlySched: RecurringSchedule = {
    id: "r-monthly-cycle",
    name: "Broadband",
    type: "expense",
    amount: 37900,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-03-01",
    end_date: null,
    status: "active",
    notes: "",
  };
  const yearlySched: RecurringSchedule = {
    id: "r-yearly-cycle",
    name: "Domain Renewal",
    type: "expense",
    amount: 12000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "yearly",
    start_date: "2025-06-01",
    end_date: null,
    status: "active",
    notes: "",
  };
  ledger.recurring = [monthlySched, yearlySched];
  ledger.recurring_occurrences = [
    { id: "ro-m1", recurring_id: "r-monthly-cycle", occurrence_date: "2026-03-01", transaction_id: "t1" },
    { id: "ro-y1", recurring_id: "r-yearly-cycle", occurrence_date: "2025-06-01", transaction_id: "t2" },
  ];

  // Mid-month (17 days before Apr 1): settled cycle shows "paid"
  assert.equal(describeScheduleStatus(monthlySched, ledger, "2026-03-15").paymentStatus, "paid");
  // Within 7-day monthly lead window (Mar 25 -> 7 days until Apr 1): transitions back to "upcoming"
  assert.equal(describeScheduleStatus(monthlySched, ledger, "2026-03-25").paymentStatus, "upcoming");
  // On Apr 1: "due_today"
  assert.equal(describeScheduleStatus(monthlySched, ledger, "2026-04-01").paymentStatus, "due_today");
  // On Apr 2 (unpaid): "overdue"
  assert.equal(describeScheduleStatus(monthlySched, ledger, "2026-04-02").paymentStatus, "overdue");

  // Yearly schedule paid in 2025: 60 days before 2026-06-01 is still "paid", 30 days before is "upcoming"
  assert.equal(describeScheduleStatus(yearlySched, ledger, "2026-04-01").paymentStatus, "paid");
  assert.equal(describeScheduleStatus(yearlySched, ledger, "2026-05-02").paymentStatus, "upcoming");
});

test("validateRecurringSchedule enforces 1970..2100 bounds and prevents orphaning confirmed occurrences", () => {
  const ledger = baseLedger();
  const baseSched: RecurringSchedule = {
    id: "r-edit-guard",
    name: "Cloud Storage",
    type: "expense",
    amount: 3700,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-01-15",
    end_date: "2026-12-15",
    status: "active",
    notes: "",
  };
  ledger.recurring = [baseSched];
  ledger.recurring_occurrences = [
    { id: "ro-jan", recurring_id: "r-edit-guard", occurrence_date: "2026-01-15", transaction_id: "t1" },
    { id: "ro-feb", recurring_id: "r-edit-guard", occurrence_date: "2026-02-15", transaction_id: "t2" },
  ];

  // Year bounds prevent accidental 0026-01-01 daily loop hangs
  assert.throws(
    () => validateRecurringSchedule({ ...baseSched, id: undefined, start_date: "0026-01-01" }, ledger),
    /between 1970-01-01 and 2100-12-31/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...baseSched, id: undefined, start_date: "1969-12-31" }, ledger),
    /between 1970-01-01 and 2100-12-31/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...baseSched, id: undefined, end_date: "2101-01-01" }, ledger),
    /on or before 2100-12-31/,
  );

  // Changing start_date so 2026-01-15 is no longer on schedule is rejected
  assert.throws(
    () => validateRecurringSchedule({ ...baseSched, start_date: "2026-02-15" }, ledger),
    /Confirmed occurrence on 2026-01-15 would no longer match this schedule/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...baseSched, start_date: "2026-01-16" }, ledger),
    /Confirmed occurrence on 2026-01-15 would no longer match this schedule/,
  );

  // Changing frequency so 2026-02-15 no longer aligns is rejected
  assert.throws(
    () => validateRecurringSchedule({ ...baseSched, frequency: "yearly" }, ledger),
    /Confirmed occurrence on 2026-02-15 would no longer match this schedule/,
  );

  // Shrinking end_date before 2026-02-15 is rejected
  assert.throws(
    () => validateRecurringSchedule({ ...baseSched, end_date: "2026-01-31" }, ledger),
    /Confirmed occurrence on 2026-02-15 would no longer match this schedule/,
  );

  // Safe edits (amount, notes, pause, extending end_date to 2026-02-15 or later) succeed
  assert.doesNotThrow(() =>
    validateRecurringSchedule(
      { ...baseSched, amount: 4500, status: "paused", end_date: "2026-02-15" },
      ledger,
    ),
  );
});
