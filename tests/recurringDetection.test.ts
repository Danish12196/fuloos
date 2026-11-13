import { test } from "node:test";
import assert from "node:assert/strict";
import { transactionLabel } from "../src/recurringMerchant.ts";
import { detectRecurringPatterns } from "../src/recurringDetection.ts";
import { reconcileTransactions } from "../src/recurringReconcile.ts";
import { buildIntelligentForecast } from "../src/recurringForecast.ts";
import {
  buildChains,
  cyclesForGap,
  seriesHasEnded,
} from "../src/recurringSeries.ts";
import { describeScheduleStatus } from "../src/recurring.ts";
import type {
  Ledger,
  RecurringOccurrenceRecord,
  RecurringSchedule,
  Transaction,
} from "../src/domain.ts";

// All fixtures are made up.

function ledgerWith(transactions: Transaction[]): Ledger {
  return {
    accounts: [
      {
        id: "acc_main",
        name: "Main",
        type: "current",
        opening_balance: 0,
        opening_date: "2023-01-01",
        color: "#1d5b48",
      },
      {
        id: "acc_card",
        name: "Card",
        type: "credit_card",
        opening_balance: 0,
        opening_date: "2023-01-01",
        color: "#696198",
      },
    ],
    categories: [],
    transactions,
    recurring: [],
    recurring_occurrences: [],
    recurring_prefs: {
      auto_detect: "on",
      auto_match: "auto",
      dismissed_keys: [],
    },
  };
}

let seq = 0;
function tx(
  date: string,
  amount: number,
  payee: string,
  notes = "",
  extra: Partial<Transaction> = {},
): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    type: "expense",
    amount,
    account_id: "acc_card",
    to_account_id: null,
    category_id: null,
    date,
    payee,
    notes,
    ...extra,
  };
}

function monthDate(year: number, month: number, day: number): string {
  const total = year * 12 + (month - 1);
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A filler purchase so an account has data up to `date`. */
function filler(date: string, account = "acc_card"): Transaction {
  return tx(date, 1234, `Corner Shop ${date}`, "", { account_id: account });
}

test("cyclesForGap tolerates late and early bills and spots skipped cycles", () => {
  assert.equal(cyclesForGap(30, "monthly"), 1);
  assert.equal(cyclesForGap(18, "monthly"), 1);
  assert.equal(cyclesForGap(44, "monthly"), 1);
  assert.equal(cyclesForGap(61, "monthly"), 2);
  assert.equal(cyclesForGap(5, "monthly"), 0);
  assert.equal(cyclesForGap(7, "weekly"), 1);
  assert.equal(cyclesForGap(10, "weekly"), 0);
  assert.equal(cyclesForGap(365, "yearly"), 1);
});

test("buildChains keeps two bills from one provider apart by amount", () => {
  const items = [];
  for (let i = 0; i < 6; i++) {
    items.push({
      id: `a${i}`,
      date: monthDate(2025, 1 + i, 3 + (i % 3) * 5),
      amount: 25000 + i * 700,
    });
    items.push({
      id: `b${i}`,
      date: monthDate(2025, 1 + i, 20),
      amount: 61000,
    });
  }
  const chains = buildChains(items, "monthly").filter(
    (c) => c.members.length > 1,
  );
  assert.equal(chains.length, 2);
  assert.ok(chains.every((c) => c.members.length === 6));
});

test("detects a monthly phone bill paid on a different day each month", () => {
  const days = [2, 17, 4, 15, 9, 1, 14, 5, 16, 3, 12, 7];
  const amounts = [
    23100, 24500, 21900, 26800, 22000, 25400, 23000, 24900, 21000, 27500, 22600,
    23800,
  ];
  const txs = days.map((d, i) =>
    tx(monthDate(2025, 11 + i, d), amounts[i], "du", "Mobile bill"),
  );
  // Home internet from the same provider, a separate bill.
  for (let i = 0; i < 8; i++) {
    txs.push(tx(monthDate(2026, 3 + i, 12), 38900, "du", "Home fibre"));
  }
  // Prepaid top-ups for someone else, not part of either bill.
  txs.push(tx("2026-02-05", 1000, "du", "Prepaid top up"));
  txs.push(tx("2026-05-19", 3000, "du", "Prepaid top up"));
  const ledger = ledgerWith(txs);

  const patterns = detectRecurringPatterns(ledger, { asOfDate: "2026-11-05" });
  const bills = patterns.filter((p) => p.merchantKey === "du");
  assert.equal(
    bills.length,
    2,
    "phone bill and fibre bill are separate series",
  );
  const mobile = bills.find((p) => p.estimatedAmount < 30000)!;
  const fibre = bills.find((p) => p.estimatedAmount > 30000)!;
  assert.equal(mobile.status, "active");
  assert.equal(mobile.frequency, "monthly");
  assert.equal(mobile.amountType, "variable");
  assert.equal(mobile.supportingTransactions.length, 12);
  assert.ok(mobile.supportingTransactions.every((t) => t.amount > 20000));
  assert.equal(fibre.supportingTransactions.length, 8);
  assert.equal(fibre.amountType, "fixed");
  assert.notEqual(mobile.patternKey, fibre.patternKey);
  // Each linked payment maps to its own month.
  const months = new Set(
    mobile.historicalLinks.map((l) => l.occurrence_date.slice(0, 7)),
  );
  assert.equal(months.size, mobile.historicalLinks.length);
});

test("reports a finished car instalment as an ended series", () => {
  const txs: Transaction[] = [];
  for (let i = 0; i < 24; i++) {
    txs.push(
      tx(
        monthDate(2023, 3 + i, 3 + (i % 2)),
        145000,
        "Acme Motors - Car Instalment",
        "",
        {
          account_id: "acc_main",
        },
      ),
    );
  }
  txs.push(filler("2026-10-30", "acc_main"));
  const ledger = ledgerWith(txs);

  const patterns = detectRecurringPatterns(ledger, { asOfDate: "2026-11-05" });
  const loan = patterns.find((p) => p.displayName.startsWith("Acme Motors"));
  assert.ok(loan, "instalment detected");
  assert.equal(loan.status, "ended");
  assert.equal(loan.categoryHint, "loan");
  assert.equal(loan.lastDate, "2025-02-04");
  assert.equal(loan.supportingTransactions.length, 24);
  assert.ok(loan.draftSchedule.end_date);
  assert.ok(loan.draftSchedule.end_date! >= loan.draftSchedule.start_date);
  assert.equal(loan.historicalLinks.length, 24);
  assert.match(loan.patternKey, /:ended:2025-02$/);

  // Ended series stay out when only active ones are wanted.
  const activeOnly = detectRecurringPatterns(ledger, {
    asOfDate: "2026-11-05",
    includeEnded: false,
  });
  assert.equal(
    activeOnly.some((p) => p.patternKey === loan.patternKey),
    false,
  );

  // Accepting it gives an ended schedule with no overdue cycles and no
  // ongoing monthly commitment.
  const schedule: RecurringSchedule = { id: "rec_loan", ...loan.draftSchedule };
  const occurrences: RecurringOccurrenceRecord[] = loan.historicalLinks.map(
    (l, i) => ({
      id: `occ${i}`,
      recurring_id: schedule.id,
      occurrence_date: l.occurrence_date,
      transaction_id: l.transaction_id,
    }),
  );
  const accepted: Ledger = {
    ...ledger,
    recurring: [schedule],
    recurring_occurrences: occurrences,
  };
  const status = describeScheduleStatus(schedule, accepted, "2026-11-05");
  assert.equal(status.paymentStatus, "completed");
  assert.equal(status.overdueDates.length, 0);
  const forecast = buildIntelligentForecast(accepted, "2026-11-05");
  assert.equal(forecast.monthlyCommitment.totalExpense, 0);
  assert.equal(
    detectRecurringPatterns(accepted, { asOfDate: "2026-11-05" }).some((p) =>
      p.displayName.startsWith("Acme Motors"),
    ),
    false,
    "accepted series is not suggested again",
  );
});

test("does not call a series ended when its account simply has no newer data", () => {
  const txs: Transaction[] = [];
  for (let i = 0; i < 6; i++) {
    txs.push(tx(monthDate(2026, 1 + i, 8), 4200, "Streamly", "Monthly plan"));
  }
  // The card statement was last imported in June; the other account is current.
  txs.push(filler("2026-10-30", "acc_main"));
  const patterns = detectRecurringPatterns(ledgerWith(txs), {
    asOfDate: "2026-11-05",
  });
  const sub = patterns.find((p) => p.merchantKey === "streamly");
  assert.ok(sub);
  assert.equal(sub.status, "active");
});

test("uses the notes when the payee is empty, and follows a renamed subscription", () => {
  const txs: Transaction[] = [];
  // Billed under the creator's name first...
  for (let i = 0; i < 8; i++) {
    txs.push(
      tx(
        monthDate(2025, 9 + i, 1),
        2450,
        "Garden Talk Podcast",
        "Supporter tier",
      ),
    );
  }
  // ...then the statement switched to a generic description with no payee.
  for (let i = 0; i < 4; i++) {
    txs.push(tx(monthDate(2026, 5 + i, 1), 2475, "", "Supporter Membership"));
  }
  txs.push(filler("2026-10-30"));
  const patterns = detectRecurringPatterns(ledgerWith(txs), {
    asOfDate: "2026-09-20",
  });
  assert.equal(patterns.length, 1);
  const sub = patterns[0];
  assert.equal(sub.supportingTransactions.length, 12);
  assert.equal(sub.status, "active");
  assert.equal(sub.aliases.length, 1);
  assert.match(sub.explanation, /also billed as/);
  assert.match(sub.draftSchedule.notes, /also billed as "/);
  assert.equal(transactionLabel(txs[10]), "Supporter Membership");
});

test("an extra purchase from a subscription merchant stays out of the series", () => {
  const txs: Transaction[] = [];
  for (let i = 0; i < 10; i++) {
    txs.push(
      tx(monthDate(2026, 1 + i, 1), 6120, "Readmore Audio", "Monthly credit"),
    );
  }
  txs.push(tx("2026-04-27", 9480, "Readmore Audio", "Extra book purchase"));
  txs.push(filler("2026-10-30"));
  const patterns = detectRecurringPatterns(ledgerWith(txs), {
    asOfDate: "2026-10-31",
  });
  const sub = patterns.find((p) => p.merchantKey.startsWith("readmore"));
  assert.ok(sub);
  assert.equal(sub.status, "active");
  assert.equal(sub.supportingTransactions.length, 10);
  assert.ok(sub.supportingTransactions.every((t) => t.amount === 6120));
});

test("a pay rise does not split a salary into two series", () => {
  const txs: Transaction[] = [];
  const amounts = [
    700000, 700000, 700000, 880000, 990000, 990000, 990000, 990000,
  ];
  amounts.forEach((amount, i) =>
    txs.push(
      tx(monthDate(2026, 1 + i, 1), amount, "Widget Works LLC", "Salary", {
        type: "income",
        account_id: "acc_main",
      }),
    ),
  );
  txs.push(filler("2026-10-30", "acc_main"));
  const patterns = detectRecurringPatterns(ledgerWith(txs), {
    asOfDate: "2026-09-10",
  });
  const salary = patterns.filter((p) => p.type === "income");
  assert.equal(salary.length, 1);
  assert.equal(salary[0].supportingTransactions.length, 8);
  assert.equal(salary[0].categoryHint, "salary");
});

test("frequent shopping at one place is not a recurring payment", () => {
  const txs: Transaction[] = [];
  let day = 0;
  for (let i = 0; i < 60; i++) {
    day += 3 + (i % 5) * 2;
    const d = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10);
    txs.push(tx(d, 1500 + ((i * 731) % 4000), "Burger Barn", "Lunch"));
  }
  const patterns = detectRecurringPatterns(ledgerWith(txs), {
    asOfDate: "2026-06-01",
  });
  assert.equal(patterns.length, 0);
});

test("seriesHasEnded waits past one missed cycle", () => {
  assert.equal(seriesHasEnded("2026-09-01", "monthly", "2026-10-20"), false);
  assert.equal(seriesHasEnded("2026-07-01", "monthly", "2026-10-20"), true);
  assert.equal(seriesHasEnded("2026-01-01", "yearly", "2026-12-20"), false);
});

test("reconcile matches a payment that only has notes", () => {
  const schedule: RecurringSchedule = {
    id: "rec_sub",
    name: "Streamly",
    type: "expense",
    amount: 4200,
    amount_type: "fixed",
    account_id: "acc_card",
    category_id: null,
    frequency: "monthly",
    start_date: "2026-08-08",
    end_date: null,
    status: "active",
    notes: "",
  };
  const ledger = ledgerWith([
    tx("2026-08-08", 4200, "", "STREAMLY.COM monthly"),
  ]);
  ledger.recurring = [schedule];
  const result = reconcileTransactions(ledger, { asOfDate: "2026-08-20" });
  assert.equal(result.autoLinks.length + result.reviewCandidates.length, 1);
});

test("leaving ended series out does not turn their payments into other suggestions", () => {
  const txs: Transaction[] = [];
  for (let i = 0; i < 12; i++) {
    txs.push(tx(monthDate(2025, 1 + i, 10), 3900, "Streamly", "Monthly plan"));
  }
  txs.push(filler("2026-03-15"));
  const ledger = ledgerWith(txs);
  const all = detectRecurringPatterns(ledger, { asOfDate: "2026-03-20" });
  assert.equal(all.length, 1);
  assert.equal(all[0].status, "ended");
  const activeOnly = detectRecurringPatterns(ledger, {
    asOfDate: "2026-03-20",
    includeEnded: false,
  });
  assert.equal(activeOnly.length, 0);
});

test("keeps a month-end billing day when the latest run starts in February", () => {
  const txs = [
    tx("2025-10-31", 4500, "Streamly", "Monthly plan"),
    tx("2025-11-30", 4500, "Streamly", "Monthly plan"),
    tx("2025-12-31", 4500, "Streamly", "Monthly plan"),
    tx("2026-02-28", 4500, "Streamly", "Monthly plan"),
  ];
  const patterns = detectRecurringPatterns(ledgerWith(txs), {
    asOfDate: "2026-03-05",
  });
  assert.equal(patterns.length, 1);
  const p = patterns[0];
  assert.equal(p.draftSchedule.start_date, "2026-03-31");
  assert.equal(p.nextExpectedDate, "2026-03-31");
});
