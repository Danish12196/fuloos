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

// ============================================================================
// 1. Schedule Generation & Calendar Edge Cases
// ============================================================================

test("daysInMonth handles regular months and leap years correctly", () => {
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29); // Leap year
  assert.equal(daysInMonth(2000, 2), 29); // Century leap year
  assert.equal(daysInMonth(1900, 2), 28); // Non-leap century
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test("parseIsoDate and isValidIsoDate validate strict calendar validity", () => {
  assert.deepEqual(parseIsoDate("2026-01-31"), { year: 2026, month: 1, day: 31 });
  assert.equal(isValidIsoDate("2026-01-31"), true);
  assert.equal(isValidIsoDate("2024-02-29"), true); // Leap day in leap year

  // Invalid calendar dates must be rejected
  assert.equal(isValidIsoDate("2026-02-29"), false); // Non-leap year Feb 29
  assert.equal(isValidIsoDate("2026-04-31"), false); // April only has 30 days
  assert.equal(isValidIsoDate("2026-13-01"), false); // Month 13
  assert.equal(isValidIsoDate("2026-00-10"), false); // Month 0
  assert.equal(isValidIsoDate("2026-05-00"), false); // Day 0
  assert.equal(isValidIsoDate("not-a-date"), false);
  assert.equal(isValidIsoDate("2026/01/01"), false);
});

test("date helper calculations: addDays, daysBetween, monthRange", () => {
  assert.equal(addDays("2026-01-30", 2), "2026-02-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-02-28", 2), "2024-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.throws(() => addDays("invalid", 1), /valid date/);

  assert.equal(daysBetween("2026-01-01", "2026-01-10"), 9);
  assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2); // Includes leap day
  assert.throws(() => daysBetween("bad", "2026-01-01"), /valid date/);

  assert.deepEqual(monthRange("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(monthRange("2024-02"), { start: "2024-02-01", end: "2024-02-29" });
  assert.deepEqual(monthRange("2026-12"), { start: "2026-12-01", end: "2026-12-31" });
  assert.throws(() => monthRange("2026-13"), /valid month/);
  assert.throws(() => monthRange("bad-month"), /valid month/);
});

test("daily, weekly, monthly, and yearly occurrence generation", () => {
  const dailySched = {
    start_date: "2026-03-01",
    end_date: null,
    frequency: "daily" as const,
  };
  assert.equal(occurrenceAtStep(dailySched.start_date, dailySched.frequency, 0), "2026-03-01");
  assert.equal(occurrenceAtStep(dailySched.start_date, dailySched.frequency, 5), "2026-03-06");
  assert.equal(isScheduledOccurrence(dailySched, "2026-03-06"), true);
  assert.deepEqual(
    generateOccurrences(dailySched, "2026-03-01", "2026-03-05"),
    ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"],
  );

  const weeklySched = {
    start_date: "2026-03-01",
    end_date: null,
    frequency: "weekly" as const,
  };
  assert.equal(occurrenceAtStep(weeklySched.start_date, weeklySched.frequency, 0), "2026-03-01");
  assert.equal(occurrenceAtStep(weeklySched.start_date, weeklySched.frequency, 1), "2026-03-08");
  assert.equal(occurrenceAtStep(weeklySched.start_date, weeklySched.frequency, 2), "2026-03-15");
  assert.equal(isScheduledOccurrence(weeklySched, "2026-03-08"), true);
  assert.equal(isScheduledOccurrence(weeklySched, "2026-03-09"), false);
  assert.deepEqual(
    generateOccurrences(weeklySched, "2026-03-01", "2026-03-22"),
    ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22"],
  );
});

test("monthly occurrence generation clamps to month-end without anchor drift", () => {
  const sched31 = {
    start_date: "2026-01-31",
    end_date: null,
    frequency: "monthly" as const,
  };

  assert.equal(occurrenceAtStep(sched31.start_date, sched31.frequency, 0), "2026-01-31");
  assert.equal(occurrenceAtStep(sched31.start_date, sched31.frequency, 1), "2026-02-28"); // Clamped in Feb
  assert.equal(occurrenceAtStep(sched31.start_date, sched31.frequency, 2), "2026-03-31"); // Restores to 31 in Mar!
  assert.equal(occurrenceAtStep(sched31.start_date, sched31.frequency, 3), "2026-04-30"); // Clamped in Apr
  assert.equal(occurrenceAtStep(sched31.start_date, sched31.frequency, 4), "2026-05-31"); // Restores to 31 in May!

  assert.deepEqual(
    generateOccurrences(sched31, "2026-01-01", "2026-05-31"),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"],
  );

  for (const validDate of ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]) {
    assert.equal(isScheduledOccurrence(sched31, validDate), true);
  }
  assert.equal(isScheduledOccurrence(sched31, "2026-03-28"), false); // Anchor did not drift to 28th

  // Leap February leap test
  const leapSched = {
    start_date: "2024-01-31",
    end_date: null,
    frequency: "monthly" as const,
  };
  assert.equal(occurrenceAtStep(leapSched.start_date, leapSched.frequency, 0), "2024-01-31");
  assert.equal(occurrenceAtStep(leapSched.start_date, leapSched.frequency, 1), "2024-02-29"); // Leap day!
  assert.equal(occurrenceAtStep(leapSched.start_date, leapSched.frequency, 2), "2024-03-31");
  assert.deepEqual(
    generateOccurrences(leapSched, "2024-01-01", "2024-03-31"),
    ["2024-01-31", "2024-02-29", "2024-03-31"],
  );
});

test("yearly occurrence generation clamps leap year without anchor drift", () => {
  const leapYearly = {
    start_date: "2024-02-29",
    end_date: null,
    frequency: "yearly" as const,
  };

  assert.equal(occurrenceAtStep(leapYearly.start_date, leapYearly.frequency, 0), "2024-02-29");
  assert.equal(occurrenceAtStep(leapYearly.start_date, leapYearly.frequency, 1), "2025-02-28"); // Clamped
  assert.equal(occurrenceAtStep(leapYearly.start_date, leapYearly.frequency, 2), "2026-02-28"); // Clamped
  assert.equal(occurrenceAtStep(leapYearly.start_date, leapYearly.frequency, 3), "2027-02-28"); // Clamped
  assert.equal(occurrenceAtStep(leapYearly.start_date, leapYearly.frequency, 4), "2028-02-29"); // Restores to 29 in leap year!

  assert.deepEqual(
    generateOccurrences(leapYearly, "2024-01-01", "2028-12-31"),
    ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"],
  );

  assert.equal(isScheduledOccurrence(leapYearly, "2024-02-29"), true);
  assert.equal(isScheduledOccurrence(leapYearly, "2025-02-28"), true);
  assert.equal(isScheduledOccurrence(leapYearly, "2028-02-29"), true);
  assert.equal(isScheduledOccurrence(leapYearly, "2028-02-28"), false);
});

test("occurrence generation respects start_date, end_date, empty ranges and invalid inputs", () => {
  const boundedSched = {
    start_date: "2026-02-15",
    end_date: "2026-04-15",
    frequency: "monthly" as const,
  };

  // Queries starting before start_date start at start_date
  assert.deepEqual(
    generateOccurrences(boundedSched, "2026-01-01", "2026-05-01"),
    ["2026-02-15", "2026-03-15", "2026-04-15"],
  );

  // Queries ending after end_date stop at end_date
  assert.deepEqual(
    generateOccurrences(boundedSched, "2026-03-01", "2026-12-31"),
    ["2026-03-15", "2026-04-15"],
  );

  // Empty range when from > to
  assert.deepEqual(generateOccurrences(boundedSched, "2026-04-01", "2026-03-01"), []);

  // Empty range when end_date < from
  assert.deepEqual(generateOccurrences(boundedSched, "2026-05-01", "2026-06-01"), []);

  // Before start_date or after end_date is not scheduled
  assert.equal(isScheduledOccurrence(boundedSched, "2026-01-15"), false);
  assert.equal(isScheduledOccurrence(boundedSched, "2026-05-15"), false);

  // Invalid date inputs throw
  assert.throws(() => generateOccurrences(boundedSched, "invalid", "2026-04-01"), /valid dates/);
  assert.throws(() => generateOccurrences(boundedSched, "2026-01-01", "invalid"), /valid dates/);
  assert.throws(
    () => generateOccurrences({ ...boundedSched, start_date: "bad" }, "2026-01-01", "2026-04-01"),
    /valid dates/,
  );
  assert.throws(
    () => generateOccurrences({ ...boundedSched, end_date: "bad" }, "2026-01-01", "2026-04-01"),
    /valid end date/,
  );
});

test("uaeToday respects Asia/Dubai (UTC+4) midnight boundaries", () => {
  // 19:59:59 UTC on 2026-11-04 is 23:59:59 in Dubai -> 2026-11-04
  const beforeMidnight = new Date("2026-11-04T19:59:59Z");
  assert.equal(uaeToday(beforeMidnight), "2026-11-04");

  // 20:00:00 UTC on 2026-11-04 is 00:00:00 in Dubai -> 2026-11-05
  const atMidnight = new Date("2026-11-04T20:00:00Z");
  assert.equal(uaeToday(atMidnight), "2026-11-05");

  // Leap boundary: 2026-02-28T20:00:00Z is 2026-03-01 in Dubai
  const monthEndBoundary = new Date("2026-02-28T20:00:00Z");
  assert.equal(uaeToday(monthEndBoundary), "2026-03-01");

  // today() returns a valid ISO date string
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test("validateRecurringSchedule enforces all bounds, constraints and immutability", () => {
  const ledger = baseLedger();
  const validSchedule: RecurringSchedule = {
    id: "r1",
    name: "Internet Fibre",
    type: "expense",
    amount: 37900,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-01-15",
    end_date: "2026-12-15",
    status: "active",
    notes: "Home internet",
  };

  assert.doesNotThrow(() => validateRecurringSchedule(validSchedule, ledger));

  // Name length & whitespace
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, name: "" }, ledger),
    /between 1 and 160 characters/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, name: "   " }, ledger),
    /between 1 and 160 characters/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, name: "a".repeat(161) }, ledger),
    /between 1 and 160 characters/,
  );

  // Type constraint
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, type: "transfer" as any }, ledger),
    /expense or income/,
  );

  // Amount limits and safe integer check
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, amount: -1 }, ledger),
    /Amount must be zero or greater/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, amount: 100_000_000_001 }, ledger),
    /Amount must be zero or greater/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, amount: 10.5 }, ledger),
    /Amount must be zero or greater/,
  );
  assert.doesNotThrow(() => validateRecurringSchedule({ ...validSchedule, amount: 0 }, ledger));

  // Amount type, frequency, status enums
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, amount_type: "tiered" as any }, ledger),
    /Choose fixed or variable/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, frequency: "hourly" as any }, ledger),
    /valid frequency/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, status: "archived" as any }, ledger),
    /active or paused/,
  );

  // Account and Category relations
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, account_id: "unknown-acc" }, ledger),
    /Select an account/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, category_id: "unknown-cat" }, ledger),
    /existing category/,
  );
  assert.doesNotThrow(
    () => validateRecurringSchedule({ ...validSchedule, category_id: null }, ledger),
  );

  // Start date and end date
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, start_date: "2026-02-29" }, ledger),
    /valid start date/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, start_date: "2026-04-31" }, ledger),
    /valid start date/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, end_date: "2026-02-29" }, ledger),
    /valid end date/,
  );
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, start_date: "2026-05-01", end_date: "2026-04-30" }, ledger),
    /End date cannot be before start date/,
  );
  assert.doesNotThrow(
    () => validateRecurringSchedule({ ...validSchedule, end_date: null }, ledger),
  );

  // Notes length
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, notes: "x".repeat(1001) }, ledger),
    /1,000 characters or fewer/,
  );

  // Guard: Type change blocked when confirmed occurrences exist
  const ledgerWithOccurrences: Ledger = {
    ...ledger,
    recurring: [validSchedule],
    recurring_occurrences: [
      { id: "ro1", recurring_id: "r1", occurrence_date: "2026-01-15", transaction_id: "t1" },
    ],
  };

  // Changing type from expense to income must throw
  assert.throws(
    () => validateRecurringSchedule({ ...validSchedule, type: "income" }, ledgerWithOccurrences),
    /Cannot change schedule type after occurrences have been confirmed/,
  );

  // Changing other fields on the same schedule with confirmed occurrences must succeed
  assert.doesNotThrow(() =>
    validateRecurringSchedule(
      { ...validSchedule, amount: 45000, name: "Upgraded Fibre" },
      ledgerWithOccurrences,
    ),
  );

  // Changing type when NO occurrences exist must succeed
  const ledgerWithoutOccurrences: Ledger = {
    ...ledger,
    recurring: [validSchedule],
    recurring_occurrences: [],
  };
  assert.doesNotThrow(() =>
    validateRecurringSchedule({ ...validSchedule, type: "income" }, ledgerWithoutOccurrences),
  );
});

// ============================================================================
// 2. Payment Confirmation, Variable Amounts & Duplicate Prevention
// ============================================================================

test("buildConfirmTransaction sets defaults, enforces variable amounts and validates opening date", () => {
  const ledger = baseLedger();
  const fixedSchedule: RecurringSchedule = {
    id: "r-fixed",
    name: "Fibre Internet",
    type: "expense",
    amount: 35000,
    amount_type: "fixed",
    account_id: "acc-main",
    category_id: "cat-bills",
    frequency: "monthly",
    start_date: "2026-01-10",
    end_date: null,
    status: "active",
    notes: "Home wifi",
  };
  ledger.recurring = [fixedSchedule];

  // Fixed schedule confirmation defaults to schedule amount, payee, and notes
  const txFixed = buildConfirmTransaction(fixedSchedule, "2026-01-10", ledger);
  assert.deepEqual(txFixed, {
    type: "expense",
    amount: 35000,
    account_id: "acc-main",
    to_account_id: null,
    category_id: "cat-bills",
    date: "2026-01-10",
    payee: "Fibre Internet",
    notes: "Home wifi",
  });

  // Variable schedule requires explicit amount override
  const variableSchedule: RecurringSchedule = {
    ...fixedSchedule,
    id: "r-variable",
    name: "DEWA Utilities",
    amount: 40000, // estimated amount
    amount_type: "variable",
    start_date: "2026-01-15",
  };
  ledger.recurring.push(variableSchedule);

  assert.throws(
    () => buildConfirmTransaction(variableSchedule, "2026-01-15", ledger),
    /Enter the actual amount paid for this variable payment/,
  );

  const txVariable = buildConfirmTransaction(variableSchedule, "2026-01-15", ledger, {
    amount: 46250,
  });
  assert.equal(txVariable.amount, 46250);

  // Overrides apply properly
  const txOverridden = buildConfirmTransaction(fixedSchedule, "2026-01-10", ledger, {
    amount: 36000,
    payee: "Etisalat e&",
    notes: "Plan renewed",
    category_id: null,
    account_id: "acc-savings",
  });
  assert.equal(txOverridden.amount, 36000);
  assert.equal(txOverridden.payee, "Etisalat e&");
  assert.equal(txOverridden.notes, "Plan renewed");
  assert.equal(txOverridden.category_id, null);
  assert.equal(txOverridden.account_id, "acc-savings");

  // An occurrence before the account's balance date keeps its own date
  const lateAccount: Account = {
    id: "acc-late",
    name: "New Account",
    type: "current",
    opening_balance: 0,
    opening_date: "2026-02-01",
    color: "#000",
  };
  ledger.accounts.push(lateAccount);
  const earlySchedule: RecurringSchedule = {
    ...fixedSchedule,
    id: "r-early",
    account_id: "acc-late",
    start_date: "2026-01-15",
  };
  ledger.recurring.push(earlySchedule);

  const clampedTx = buildConfirmTransaction(earlySchedule, "2026-01-15", ledger);
  assert.equal(clampedTx.date, "2026-01-15");
  assert.equal(
    buildConfirmTransaction(earlySchedule, "2026-01-15", ledger, {
      date: "2026-01-20",
    }).date,
    "2026-01-20",
  );
});

test("validateOccurrenceConfirmation enforces schedule alignment, duplicates and link validity", () => {
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
  ledger.recurring = [schedule];

  // Rejects dates that do not fall on schedule
  assert.throws(
    () =>
      validateOccurrenceConfirmation(
        { recurring_id: "r1", occurrence_date: "2026-01-24" },
        ledger,
      ),
    /Occurrence date does not match this recurring schedule/,
  );

  // Rejects unknown schedule
  assert.throws(
    () =>
      validateOccurrenceConfirmation(
        { recurring_id: "r-missing", occurrence_date: "2026-01-25" },
        ledger,
      ),
    /Recurring schedule not found/,
  );

  // Valid confirmation without linking existing transaction
  assert.doesNotThrow(() =>
    validateOccurrenceConfirmation(
      { recurring_id: "r1", occurrence_date: "2026-01-25" },
      ledger,
    ),
  );

  // Record an occurrence confirmation
  ledger.recurring_occurrences = [
    { id: "ro1", recurring_id: "r1", occurrence_date: "2026-01-25", transaction_id: "t1" },
  ];

  // Rejects duplicate confirmation of the same (recurring_id, occurrence_date)
  assert.throws(
    () =>
      validateOccurrenceConfirmation(
        { recurring_id: "r1", occurrence_date: "2026-01-25" },
        ledger,
      ),
    /This occurrence has already been confirmed/,
  );

  // Next month occurrence confirmation is allowed
  assert.doesNotThrow(() =>
    validateOccurrenceConfirmation(
      { recurring_id: "r1", occurrence_date: "2026-02-25" },
      ledger,
    ),
  );

  // Existing transaction linking validation
  const existingIncomeTx: Transaction = {
    id: "t-inc",
    type: "income",
    amount: 1500000,
    account_id: "acc-main",
    to_account_id: null,
    category_id: "cat-salary",
    date: "2026-02-25",
    payee: "Employer",
    notes: "",
  };
  const existingExpenseTx: Transaction = {
    id: "t-exp",
    type: "expense",
    amount: 5000,
    account_id: "acc-main",
    to_account_id: null,
    category_id: "cat-bills",
    date: "2026-02-25",
    payee: "Store",
    notes: "",
  };
  const existingTransferTx: Transaction = {
    id: "t-xfer",
    type: "transfer",
    amount: 50000,
    account_id: "acc-main",
    to_account_id: "acc-savings",
    category_id: null,
    date: "2026-02-25",
    payee: "Save",
    notes: "",
  };
  ledger.transactions = [existingIncomeTx, existingExpenseTx, existingTransferTx];

  // Linking missing transaction throws
  assert.throws(
    () =>
      validateOccurrenceConfirmation(
        { recurring_id: "r1", occurrence_date: "2026-02-25", transaction_id: "t-missing" },
        ledger,
      ),
    /Select an existing transaction to link/,
  );

  // Linking mismatched transaction type (expense to income schedule) throws
  assert.throws(
    () =>
      validateOccurrenceConfirmation(
        { recurring_id: "r1", occurrence_date: "2026-02-25", transaction_id: "t-exp" },
        ledger,
      ),
    /Linked transaction type must match the recurring schedule type/,
  );

  // Linking transfer to income schedule throws
  assert.throws(
    () =>
      validateOccurrenceConfirmation(
        { recurring_id: "r1", occurrence_date: "2026-02-25", transaction_id: "t-xfer" },
        ledger,
      ),
    /Linked transaction type must match the recurring schedule type/,
  );

  // Linking matching transaction succeeds
  assert.doesNotThrow(() =>
    validateOccurrenceConfirmation(
      { recurring_id: "r1", occurrence_date: "2026-02-25", transaction_id: "t-inc" },
      ledger,
    ),
  );

  // Once linked, linking the same transaction to another occurrence throws
  ledger.recurring_occurrences.push({
    id: "ro2",
    recurring_id: "r1",
    occurrence_date: "2026-02-25",
    transaction_id: "t-inc",
  });

  assert.throws(
    () =>
      validateOccurrenceConfirmation(
        { recurring_id: "r1", occurrence_date: "2026-03-25", transaction_id: "t-inc" },
        ledger,
      ),
    /That transaction is already linked to a recurring occurrence/,
  );
});

