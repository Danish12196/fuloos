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

  // Account opening date boundary: occurrence before account opening date clamps to opening_date
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
  assert.equal(clampedTx.date, "2026-02-01"); // Clamped to account opening_date

  // Explicit override before opening_date fails validation
  assert.throws(
    () =>
      buildConfirmTransaction(earlySchedule, "2026-01-15", ledger, {
        date: "2026-01-20",
      }),
    /Transaction cannot be before the account opening date/,
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
