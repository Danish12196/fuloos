import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMerchant,
  merchantSimilarity,
  inferCategoryHint,
  detectRecurringPatterns,
  reconcileTransactions,
  analyzeScheduleHistory,
  buildIntelligentForecast,
  buildMatchDismissKey,
  AUTO_LINK_THRESHOLD,
} from "../src/recurringAutomation.ts";
import {
  type Ledger,
  type RecurringSchedule,
  type Transaction,
  type Account,
  type Category,
} from "../src/domain.ts";

function createTestLedger(): Ledger {
  const accounts: Account[] = [
    {
      id: "acc_current",
      name: "Current Account",
      type: "current",
      opening_balance: 1_000_000, // 10,000.00 AED
      opening_date: "2025-01-01",
      color: "#1d5b48",
    },
    {
      id: "acc_card",
      name: "Credit Card",
      type: "credit_card",
      opening_balance: -50_000, // -500.00 AED
      opening_date: "2025-01-01",
      color: "#696198",
    },
  ];

  const categories: Category[] = [
    {
      id: "cat_bills",
      name: "Bills & Utilities",
      description: "DEWA, telecom, etc.",
      color: "#9e8aba",
    },
    {
      id: "cat_sub",
      name: "Subscriptions",
      description: "Streaming, music, software",
      color: "#b68aa0",
    },
    {
      id: "cat_sal",
      name: "Salary",
      description: "Monthly payroll",
      color: "#1d5b48",
    },
    {
      id: "cat_groceries",
      name: "Groceries",
      description: "Supermarket purchases",
      color: "#6c9b77",
    },
  ];

  return {
    accounts,
    categories,
    transactions: [],
    recurring: [],
    recurring_occurrences: [],
    recurring_prefs: {
      auto_detect: "on",
      auto_match: "auto",
      dismissed_keys: [],
    },
  };
}

test("normalizeMerchant strips bank noise, store IDs and maps UAE aliases", () => {
  // Common bank terminal noise and store branches
  const n1 = normalizeMerchant("POS PURCHASE 9843 SPINNEYS DUBAI MARINA AE");
  assert.equal(n1.key, "spinneys");
  assert.equal(n1.displayName, "Spinneys");

  const n2 = normalizeMerchant("TRX-102948 NETFLIX.COM INTERNET");
  assert.equal(n2.key, "netflix");
  assert.equal(n2.displayName, "Netflix");

  // UAE Aliases
  const nEtisalat = normalizeMerchant("ETISALAT BY E& TELECOM PAYMENT");
  assert.equal(nEtisalat.key, "etisalat");

  const nDu = normalizeMerchant("DU EMIRATES INTEGRATED TELECOMM");
  assert.equal(nDu.key, "du");

  const nDewa = normalizeMerchant("DEWA BILL PYMT DEPT 104");
  assert.equal(nDewa.key, "dewa");

  const nSalik = normalizeMerchant("SALIK AUTO RECHARGE DUBAI");
  assert.equal(nSalik.key, "salik");
});

test("merchantSimilarity correctly identifies identical, alias, and mismatched merchants", () => {
  assert.equal(
    merchantSimilarity(
      normalizeMerchant("Netflix"),
      normalizeMerchant("NETFLIX.COM"),
    ),
    1.0,
  );
  assert.equal(
    merchantSimilarity(
      normalizeMerchant("du"),
      normalizeMerchant("DU Telecom Dubai"),
    ),
    1.0,
  );
  assert.equal(
    merchantSimilarity(
      normalizeMerchant("DEWA Utilities"),
      normalizeMerchant("DEWA Bill Payment"),
    ),
    1.0,
  );

  // Partial / token overlap
  const simAmazon = merchantSimilarity(
    normalizeMerchant("Amazon Prime"),
    normalizeMerchant("Amazon Prime Video"),
  );
  assert.ok(simAmazon >= 0.7);

  // Totally unrelated
  const simMismatched = merchantSimilarity(
    normalizeMerchant("Spinneys"),
    normalizeMerchant("DEWA"),
  );
  assert.ok(simMismatched < 0.3);
});

test("inferCategoryHint maps recurring keywords to category types", () => {
  assert.equal(
    inferCategoryHint(normalizeMerchant("du"), "expense", "Bills & utilities"),
    "telecom",
  );
  assert.equal(
    inferCategoryHint(normalizeMerchant("dewa"), "expense", "Bills & utilities"),
    "utilities",
  );
  assert.equal(
    inferCategoryHint(normalizeMerchant("netflix"), "expense", "Subscriptions"),
    "subscription",
  );
  assert.equal(
    inferCategoryHint(normalizeMerchant("salik"), "expense", "Transport"),
    "other_recurring",
  );
  assert.equal(
    inferCategoryHint(normalizeMerchant("Monthly salary"), "income", "Salary"),
    "salary",
  );
  assert.equal(
    inferCategoryHint(normalizeMerchant("Dubai Marina Rent"), "expense", "Housing"),
    "rent",
  );
  assert.equal(
    inferCategoryHint(normalizeMerchant("Random Coffee Shop"), "expense", "Dining"),
    "other_recurring",
  );
});

test("detectRecurringPatterns detects monthly fixed subscriptions (Netflix)", () => {
  const ledger = createTestLedger();
  const txs: Transaction[] = [
    {
      id: "tx_net_1",
      type: "expense",
      amount: 6500, // 65.00 AED
      account_id: "acc_card",
      to_account_id: null,
      category_id: "cat_sub",
      date: "2026-08-15",
      payee: "Netflix Dubai",
      notes: "Standard plan",
    },
    {
      id: "tx_net_2",
      type: "expense",
      amount: 6500,
      account_id: "acc_card",
      to_account_id: null,
      category_id: "cat_sub",
      date: "2026-09-15",
      payee: "NETFLIX.COM",
      notes: "Standard plan",
    },
    {
      id: "tx_net_3",
      type: "expense",
      amount: 6500,
      account_id: "acc_card",
      to_account_id: null,
      category_id: "cat_sub",
      date: "2026-10-15",
      payee: "Netflix Subscription",
      notes: "Standard plan",
    },
  ];
  ledger.transactions = txs;

  const patterns = detectRecurringPatterns(ledger, { asOfDate: "2026-11-01" });
  assert.equal(patterns.length, 1);
  const p = patterns[0];
  assert.equal(p.displayName, "Netflix");
  assert.equal(p.frequency, "monthly");
  assert.equal(p.amountType, "fixed");
  assert.equal(p.estimatedAmount, 6500);
  assert.ok(p.confidence >= AUTO_LINK_THRESHOLD);
  assert.equal(p.supportingTransactions.length, 3);
  assert.equal(p.historicalLinks.length, 3);
  assert.equal(p.draftSchedule.name, "Netflix");
  assert.equal(p.draftSchedule.amount, 6500);
  assert.equal(p.draftSchedule.frequency, "monthly");
});

test("detectRecurringPatterns detects quarterly recurring payments", () => {
  const ledger = createTestLedger();
  const txs: Transaction[] = [
    {
      id: "tx_q1",
      type: "expense",
      amount: 150000, // 1,500.00 AED
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-01-10",
      payee: "GEMS Wellington School Fees",
      notes: "Term 1",
    },
    {
      id: "tx_q2",
      type: "expense",
      amount: 150000,
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-04-10",
      payee: "GEMS Wellington School Fees",
      notes: "Term 2",
    },
    {
      id: "tx_q3",
      type: "expense",
      amount: 150000,
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-07-10",
      payee: "GEMS Wellington School Fees",
      notes: "Term 3",
    },
  ];
  ledger.transactions = txs;

  const patterns = detectRecurringPatterns(ledger, { asOfDate: "2026-08-01" });
  assert.ok(patterns.length >= 1);
  const qPattern = patterns.find((p) => p.frequency === "quarterly");
  assert.ok(qPattern);
  assert.equal(qPattern.frequency, "quarterly");
  assert.equal(qPattern.estimatedAmount, 150000);
});

test("detectRecurringPatterns detects variable amount utilities (DEWA) with jittered dates", () => {
  const ledger = createTestLedger();
  const txs: Transaction[] = [
    {
      id: "tx_dewa_1",
      type: "expense",
      amount: 41200, // 412.00 AED
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-07-28", // jitter ±2 days
      payee: "DEWA Electricity & Water",
      notes: "July bill",
    },
    {
      id: "tx_dewa_2",
      type: "expense",
      amount: 44500, // 445.00 AED
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-08-27",
      payee: "DEWA Bill Payment",
      notes: "August bill",
    },
    {
      id: "tx_dewa_3",
      type: "expense",
      amount: 42100, // 421.00 AED
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-09-28",
      payee: "DEWA Bill Payment",
      notes: "September bill",
    },
  ];
  ledger.transactions = txs;

  const patterns = detectRecurringPatterns(ledger, { asOfDate: "2026-10-05" });
  assert.equal(patterns.length, 1);
  const p = patterns[0];
  assert.equal(p.displayName, "DEWA");
  assert.equal(p.frequency, "monthly");
  assert.equal(p.amountType, "variable");
  assert.equal(p.draftSchedule.amount_type, "variable");
  assert.ok(p.minAmount <= 42100);
  assert.ok(p.maxAmount >= 44500);
});

test("detectRecurringPatterns respects dismissed pattern keys", () => {
  const ledger = createTestLedger();
  ledger.transactions = [
    {
      id: "tx_net_1",
      type: "expense",
      amount: 6500,
      account_id: "acc_card",
      to_account_id: null,
      category_id: "cat_sub",
      date: "2026-07-15",
      payee: "Netflix",
      notes: "",
    },
    {
      id: "tx_net_2",
      type: "expense",
      amount: 6500,
      account_id: "acc_card",
      to_account_id: null,
      category_id: "cat_sub",
      date: "2026-08-15",
      payee: "Netflix",
      notes: "",
    },
    {
      id: "tx_net_3",
      type: "expense",
      amount: 6500,
      account_id: "acc_card",
      to_account_id: null,
      category_id: "cat_sub",
      date: "2026-09-15",
      payee: "Netflix",
      notes: "",
    },
  ];

  // Without dismissal
  let patterns = detectRecurringPatterns(ledger, { asOfDate: "2026-10-01" });
  assert.equal(patterns.length, 1);
  const patternKey = patterns[0].patternKey;

  // Add patternKey to dismissed_keys
  ledger.recurring_prefs = {
    auto_detect: "on",
    auto_match: "auto",
    dismissed_keys: [patternKey],
  };

  patterns = detectRecurringPatterns(ledger, { asOfDate: "2026-10-01" });
  assert.equal(patterns.length, 0, "Dismissed pattern must not be suggested again");
});

test("reconcileTransactions safely auto-links high confidence matches", () => {
  const ledger = createTestLedger();
  const schedule: RecurringSchedule = {
    id: "rec_internet",
    name: "du Home Internet",
    type: "expense",
    amount: 37900,
    amount_type: "fixed",
    account_id: "acc_current",
    category_id: "cat_bills",
    frequency: "monthly",
    start_date: "2026-10-01",
    end_date: null,
    status: "active",
    notes: "",
  };
  ledger.recurring = [schedule];

  // An exact recorded transaction on the due date
  const tx: Transaction = {
    id: "tx_du_oct",
    type: "expense",
    amount: 37900,
    account_id: "acc_current",
    to_account_id: null,
    category_id: "cat_bills",
    date: "2026-10-01",
    payee: "du telecom payment",
    notes: "",
  };
  ledger.transactions = [tx];

  const recon = reconcileTransactions(ledger, { asOfDate: "2026-10-10" });
  assert.equal(recon.autoLinks.length, 1);
  assert.equal(recon.reviewCandidates.length, 0);

  const match = recon.autoLinks[0];
  assert.equal(match.schedule.id, "rec_internet");
  assert.equal(match.occurrenceDate, "2026-10-01");
  assert.equal(match.transaction.id, "tx_du_oct");
  assert.ok(match.confidence >= AUTO_LINK_THRESHOLD);
});

test("reconcileTransactions routes ambiguous or tied matches to review candidates", () => {
  const ledger = createTestLedger();
  const schedule: RecurringSchedule = {
    id: "rec_sub",
    name: "Spotify",
    type: "expense",
    amount: 2199,
    amount_type: "fixed",
    account_id: "acc_card",
    category_id: "cat_sub",
    frequency: "monthly",
    start_date: "2026-10-05",
    end_date: null,
    status: "active",
    notes: "",
  };
  ledger.recurring = [schedule];

  // Two identical amount transactions 1 day apart (ambiguity tie)
  const tx1: Transaction = {
    id: "tx_sp_1",
    type: "expense",
    amount: 2199,
    account_id: "acc_card",
    to_account_id: null,
    category_id: "cat_sub",
    date: "2026-10-04",
    payee: "Spotify AB",
    notes: "Card 1",
  };
  const tx2: Transaction = {
    id: "tx_sp_2",
    type: "expense",
    amount: 2199,
    account_id: "acc_card",
    to_account_id: null,
    category_id: "cat_sub",
    date: "2026-10-06",
    payee: "Spotify AB",
    notes: "Card 2",
  };
  ledger.transactions = [tx1, tx2];

  const recon = reconcileTransactions(ledger, { asOfDate: "2026-10-10" });
  // Because two transactions are tied for the same occurrence, it must not auto-link blindly!
  assert.equal(recon.autoLinks.length, 0);
  assert.ok(recon.reviewCandidates.length >= 1);
});

test("reconcileTransactions respects sticky unlinked dismissal key", () => {
  const ledger = createTestLedger();
  const schedule: RecurringSchedule = {
    id: "rec_net",
    name: "Netflix",
    type: "expense",
    amount: 6500,
    amount_type: "fixed",
    account_id: "acc_card",
    category_id: "cat_sub",
    frequency: "monthly",
    start_date: "2026-10-01",
    end_date: null,
    status: "active",
    notes: "",
  };
  ledger.recurring = [schedule];

  const tx: Transaction = {
    id: "tx_net_oct",
    type: "expense",
    amount: 6500,
    account_id: "acc_card",
    to_account_id: null,
    category_id: "cat_sub",
    date: "2026-10-01",
    payee: "Netflix",
    notes: "",
  };
  ledger.transactions = [tx];

  // Without dismissal, it auto-links
  let recon = reconcileTransactions(ledger, { asOfDate: "2026-10-10" });
  assert.equal(recon.autoLinks.length, 1);

  // User unlinks it -> dismissal key is added to recurring_prefs
  const dismissKey = buildMatchDismissKey("rec_net", "2026-10-01", "tx_net_oct");
  ledger.recurring_prefs = {
    auto_detect: "on",
    auto_match: "auto",
    dismissed_keys: [dismissKey],
  };

  // On next reconciliation pass, it MUST NOT auto-link or review that specific pairing
  recon = reconcileTransactions(ledger, { asOfDate: "2026-10-10" });
  assert.equal(recon.autoLinks.length, 0);
  assert.equal(recon.reviewCandidates.length, 0);
});

test("analyzeScheduleHistory derives observed day jitter and variable amount bounds", () => {
  const ledger = createTestLedger();
  const schedule: RecurringSchedule = {
    id: "rec_dewa",
    name: "DEWA",
    type: "expense",
    amount: 40000,
    amount_type: "variable",
    account_id: "acc_current",
    category_id: "cat_bills",
    frequency: "monthly",
    start_date: "2026-06-25",
    end_date: null,
    status: "active",
    notes: "",
  };
  ledger.recurring = [schedule];

  // 3 confirmed occurrences with actual transactions
  ledger.transactions = [
    {
      id: "tx_d1",
      type: "expense",
      amount: 42000,
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-06-27", // +2 days
      payee: "DEWA",
      notes: "",
    },
    {
      id: "tx_d2",
      type: "expense",
      amount: 46000,
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-07-27", // +2 days
      payee: "DEWA",
      notes: "",
    },
    {
      id: "tx_d3",
      type: "expense",
      amount: 44000,
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-08-27", // +2 days
      payee: "DEWA",
      notes: "",
    },
  ];

  ledger.recurring_occurrences = [
    { id: "ro1", recurring_id: "rec_dewa", occurrence_date: "2026-06-25", transaction_id: "tx_d1" },
    { id: "ro2", recurring_id: "rec_dewa", occurrence_date: "2026-07-25", transaction_id: "tx_d2" },
    { id: "ro3", recurring_id: "rec_dewa", occurrence_date: "2026-08-25", transaction_id: "tx_d3" },
  ];

  const profile = analyzeScheduleHistory(schedule, ledger);
  assert.equal(profile.sampleCount, 3);
  assert.equal(profile.hasRange, true);
  assert.equal(profile.lowAmount, 42000);
  assert.equal(profile.highAmount, 46000);
  assert.equal(profile.medianOffsetDays, 2, "Consistently paid +2 days after scheduled date");
});

test("buildIntelligentForecast computes 30, 60, and 90-day cash flow horizons and per-account projections", () => {
  const ledger = createTestLedger();
  const asOf = "2026-10-01";

  // Monthly salary on 1st of month: 18,000 AED income
  const salary: RecurringSchedule = {
    id: "rec_sal",
    name: "Salary",
    type: "income",
    amount: 1800000,
    amount_type: "fixed",
    account_id: "acc_current",
    category_id: "cat_sal",
    frequency: "monthly",
    start_date: "2026-10-01",
    end_date: null,
    status: "active",
    notes: "",
  };

  // Monthly rent on 5th of month: 5,000 AED expense
  const rent: RecurringSchedule = {
    id: "rec_rent",
    name: "Apartment Rent",
    type: "expense",
    amount: 500000,
    amount_type: "fixed",
    account_id: "acc_current",
    category_id: "cat_bills",
    frequency: "monthly",
    start_date: "2026-10-05",
    end_date: null,
    status: "active",
    notes: "",
  };

  ledger.recurring = [salary, rent];

  const forecast = buildIntelligentForecast(ledger, asOf);

  // 30-day horizon (covers Oct 1 to Oct 31): 1 salary, 1 rent
  assert.equal(forecast.horizons[30].income.expected, 1800000);
  assert.equal(forecast.horizons[30].expense.expected, 500000);
  assert.equal(forecast.horizons[30].net.expected, 1300000);

  // 60-day horizon (covers ~2 months): 2 salaries, 2 rents
  assert.equal(forecast.horizons[60].income.expected, 3600000);
  assert.equal(forecast.horizons[60].expense.expected, 1000000);
  assert.equal(forecast.horizons[60].net.expected, 2600000);

  // 90-day horizon (covers ~3 months): 3 salaries, 3 rents
  assert.equal(forecast.horizons[90].income.expected, 5400000);
  assert.equal(forecast.horizons[90].expense.expected, 1500000);
  assert.equal(forecast.horizons[90].net.expected, 3900000);

  // Per-account balance projections
  const currentProj = forecast.accountProjections.find((p) => p.account.id === "acc_current");
  assert.ok(currentProj);
  // Current opening balance = 1,000,000. 30-day net = +1,300,000 -> 2,300,000
  assert.equal(currentProj.currentBalance, 1000000);
  assert.equal(currentProj.horizons[30].projectedBalance, 2300000);
  assert.equal(currentProj.horizons[90].projectedBalance, 4900000);
});

test("buildIntelligentForecast never double counts confirmed occurrences", () => {
  const ledger = createTestLedger();
  const asOf = "2026-10-01";

  const bill: RecurringSchedule = {
    id: "rec_bill",
    name: "Internet",
    type: "expense",
    amount: 37900,
    amount_type: "fixed",
    account_id: "acc_current",
    category_id: "cat_bills",
    frequency: "monthly",
    start_date: "2026-10-05",
    end_date: null,
    status: "active",
    notes: "",
  };
  ledger.recurring = [bill];

  // Before confirmation: 379.00 expected in 30 days
  let forecast = buildIntelligentForecast(ledger, asOf);
  assert.equal(forecast.horizons[30].expense.expected, 37900);

  // Confirm the 2026-10-05 occurrence with a real transaction
  const tx: Transaction = {
    id: "tx_paid",
    type: "expense",
    amount: 37900,
    account_id: "acc_current",
    to_account_id: null,
    category_id: "cat_bills",
    date: "2026-10-04",
    payee: "Internet",
    notes: "",
  };
  ledger.transactions = [tx];
  ledger.recurring_occurrences = [
    {
      id: "ro_paid",
      recurring_id: "rec_bill",
      occurrence_date: "2026-10-05",
      transaction_id: "tx_paid",
    },
  ];

  // After confirmation: 2026-10-05 is confirmed and already recorded in actual transactions.
  // Forecast must NOT count it again as an upcoming commitment in the 30-day forecast!
  forecast = buildIntelligentForecast(ledger, asOf);
  assert.equal(forecast.horizons[30].expense.expected, 0);
});

test("buildIntelligentForecast propagates variable schedule low/high ranges into horizons", () => {
  const ledger = createTestLedger();
  const schedule: RecurringSchedule = {
    id: "rec_dewa_var",
    name: "DEWA",
    type: "expense",
    amount: 44000,
    amount_type: "variable",
    account_id: "acc_current",
    category_id: "cat_bills",
    frequency: "monthly",
    start_date: "2026-06-15",
    end_date: null,
    status: "active",
    notes: "",
  };
  ledger.recurring = [schedule];
  ledger.transactions = [
    {
      id: "d1",
      type: "expense",
      amount: 40000,
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-06-15",
      payee: "DEWA",
      notes: "",
    },
    {
      id: "d2",
      type: "expense",
      amount: 50000,
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_bills",
      date: "2026-07-15",
      payee: "DEWA",
      notes: "",
    },
  ];
  ledger.recurring_occurrences = [
    { id: "o1", recurring_id: "rec_dewa_var", occurrence_date: "2026-06-15", transaction_id: "d1" },
    { id: "o2", recurring_id: "rec_dewa_var", occurrence_date: "2026-07-15", transaction_id: "d2" },
  ];

  const forecast = buildIntelligentForecast(ledger, "2026-08-01");
  assert.equal(forecast.horizons[30].expense.low, 40000);
  assert.equal(forecast.horizons[30].expense.high, 50000);
  assert.equal(forecast.horizons[30].expense.expected, 46667);
});

test("reconcileTransactions respects auto_match=off and skips already-linked transactions", () => {
  const ledger = createTestLedger();
  ledger.recurring = [
    {
      id: "rec_nf",
      name: "Netflix",
      type: "expense",
      amount: 5500,
      amount_type: "fixed",
      account_id: "acc_current",
      category_id: "cat_sub",
      frequency: "monthly",
      start_date: "2026-08-10",
      end_date: null,
      status: "active",
      notes: "",
    },
  ];
  ledger.transactions = [
    {
      id: "tx_nf",
      type: "expense",
      amount: 5500,
      account_id: "acc_current",
      to_account_id: null,
      category_id: "cat_sub",
      date: "2026-08-10",
      payee: "NETFLIX.COM",
      notes: "",
    },
  ];
  ledger.recurring_prefs = {
    auto_detect: "on",
    auto_match: "off",
    dismissed_keys: [],
  };

  const offResult = reconcileTransactions(ledger, { asOfDate: "2026-08-12" });
  assert.equal(offResult.autoLinks.length, 0);
  assert.equal(offResult.reviewCandidates.length, 0);
});
