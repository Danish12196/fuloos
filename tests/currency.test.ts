import assert from "node:assert/strict";
import test from "node:test";
import {
  convertToAedFils,
  formatCurrency,
  formatCurrencyInput,
  formatOriginalCurrencyPill,
  getCurrencyDecimals,
  getReferenceFxRate,
  isSupportedCurrency,
  normalizeCurrencyCode,
  parseCurrencyMinor,
  SUPPORTED_CURRENCIES,
  validateForeignCurrencyFields,
} from "../src/currency.ts";
import { validateTransaction, type Ledger } from "../src/domain.ts";
import { transactionsToCsv } from "../src/export.ts";
import {
  createBackup,
  executeRestore,
  parseAndValidateBackup,
  serializeBackup,
} from "../src/backup.ts";

test("supported currencies metadata covers 0, 2, and 3 decimal currencies and reference rates", () => {
  assert.ok(SUPPORTED_CURRENCIES.length >= 14);
  assert.equal(isSupportedCurrency("USD"), true);
  assert.equal(isSupportedCurrency("KWD"), true);
  assert.equal(isSupportedCurrency("JPY"), true);
  assert.equal(isSupportedCurrency("XYZ"), false);

  assert.equal(getCurrencyDecimals("AED"), 2);
  assert.equal(getCurrencyDecimals("USD"), 2);
  assert.equal(getCurrencyDecimals("KWD"), 3);
  assert.equal(getCurrencyDecimals("BHD"), 3);
  assert.equal(getCurrencyDecimals("OMR"), 3);
  assert.equal(getCurrencyDecimals("JPY"), 0);

  assert.equal(getReferenceFxRate("USD"), 3.6725);
  assert.equal(getReferenceFxRate("SAR"), 0.9793);
  assert.equal(normalizeCurrencyCode(undefined), "AED");
  assert.equal(normalizeCurrencyCode(" usd "), "USD");
});

test("parseCurrencyMinor and formatCurrencyInput handle 0, 2, and 3 decimals without float drift", () => {
  assert.equal(parseCurrencyMinor("100.00", "USD"), 10000);
  assert.equal(parseCurrencyMinor("12.345", "KWD"), 12345);
  assert.equal(parseCurrencyMinor("1500", "JPY"), 1500);

  assert.equal(formatCurrencyInput(10000, "USD"), "100.00");
  assert.equal(formatCurrencyInput(12345, "KWD"), "12.345");
  assert.equal(formatCurrencyInput(1500, "JPY"), "1500");

  assert.throws(() => parseCurrencyMinor("12.345", "USD"), /2 decimal/);
  assert.throws(() => parseCurrencyMinor("12.5", "JPY"), /whole number/);
  assert.throws(() => parseCurrencyMinor("10", "XYZ"), /Unsupported currency/);
});

test("convertToAedFils converts minor units across 0, 2, and 3 decimal currencies", () => {
  // 100.00 USD * 3.6725 = 367.25 AED -> 36725 fils
  assert.equal(convertToAedFils(10000, "USD", 3.6725), 36725);
  // 1.000 KWD * 11.95 = 11.95 AED -> 1195 fils
  assert.equal(convertToAedFils(1000, "KWD", 11.95), 1195);
  // 1000 JPY * 0.024 = 24.00 AED -> 2400 fils
  assert.equal(convertToAedFils(1000, "JPY", 0.024), 2400);
  // AED identity
  assert.equal(convertToAedFils(5000, "AED", 1), 5000);

  assert.throws(() => convertToAedFils(-100, "USD", 3.6725), /zero or greater/);
  assert.throws(() => convertToAedFils(100, "USD", 0), /greater than zero/);
  assert.throws(() => convertToAedFils(100, "USD", -1), /greater than zero/);
  assert.throws(() => convertToAedFils(100, "XYZ", 1), /Unsupported currency/);
});

test("formatCurrency and formatOriginalCurrencyPill render readable values", () => {
  const formatted = formatCurrency(36725, "AED");
  assert.ok(formatted.includes("367.25"));
  assert.equal(
    formatOriginalCurrencyPill(10000, "USD", 3.6725),
    "USD 100.00 @ 3.6725",
  );
  assert.equal(
    formatOriginalCurrencyPill(12345, "KWD", 11.95),
    "KWD 12.345 @ 11.95",
  );
  assert.equal(
    formatOriginalCurrencyPill(1500, "JPY", 0.024),
    "JPY 1500 @ 0.024",
  );
});

test("validateForeignCurrencyFields and validateTransaction enforce explicit FX invariants", () => {
  const ledger: Ledger = {
    accounts: [
      {
        id: "acc1",
        name: "USD Card",
        type: "credit_card",
        currency: "USD",
        opening_balance: 0,
        opening_date: "2026-01-01",
        color: "#1d5b48",
      },
    ],
    categories: [
      {
        id: "cat1",
        name: "Travel",
        description: "",
        color: "#696198",
      },
    ],
    transactions: [],
  };

  assert.doesNotThrow(() =>
    validateTransaction(
      {
        type: "expense",
        amount: 36725,
        account_id: "acc1",
        to_account_id: null,
        category_id: "cat1",
        date: "2026-03-10",
        payee: "AWS",
        notes: "",
        original_currency: "USD",
        original_amount: 10000,
        fx_rate: 3.6725,
      },
      ledger,
    ),
  );

  assert.throws(
    () =>
      validateForeignCurrencyFields({
        original_currency: "USD",
        original_amount: -5,
        fx_rate: 3.6725,
      }),
    /zero or greater/,
  );

  assert.throws(
    () =>
      validateForeignCurrencyFields({
        original_currency: "USD",
        original_amount: 10000,
        fx_rate: 0,
      }),
    /greater than zero/,
  );

  assert.throws(
    () =>
      validateForeignCurrencyFields({
        original_currency: "ZZZ",
        original_amount: 10000,
        fx_rate: 1,
      }),
    /Unsupported currency/,
  );
});

test("transactionsToCsv and backup/restore round-trip preserve multi-currency fields", async () => {
  const ledger: Ledger = {
    accounts: [
      {
        id: "acc1",
        name: "USD Travel Card",
        type: "credit_card",
        currency: "USD",
        opening_balance: 0,
        opening_date: "2026-01-01",
        color: "#1d5b48",
      },
    ],
    categories: [
      {
        id: "cat1",
        name: "Software",
        description: "",
        color: "#696198",
      },
    ],
    transactions: [
      {
        id: "tx1",
        type: "expense",
        amount: 36725,
        account_id: "acc1",
        to_account_id: null,
        category_id: "cat1",
        date: "2026-03-15",
        payee: "Cloud Hosting",
        notes: "",
        original_currency: "USD",
        original_amount: 10000,
        fx_rate: 3.6725,
      },
    ],
  };

  const csv = transactionsToCsv(ledger.transactions, ledger);
  const lines = csv.trim().split("\r\n");
  assert.equal(
    lines[0],
    "Date,Type,Amount (AED),Account,To Account,Category,Payee,Notes,Currency,Original Amount,Original Currency,FX Rate",
  );
  assert.equal(
    lines[1],
    "2026-03-15,expense,367.25,USD Travel Card,,Software,Cloud Hosting,,USD,100.00,USD,3.6725",
  );

  const rawBackup = serializeBackup(createBackup(ledger));
  const { backup } = parseAndValidateBackup(rawBackup);
  assert.equal(backup.data.accounts[0].currency, "USD");
  assert.equal(backup.data.transactions[0].original_currency, "USD");
  assert.equal(backup.data.transactions[0].original_amount, 10000);
  assert.equal(backup.data.transactions[0].fx_rate, 3.6725);

  let nextId = 1;
  const restored = await executeRestore({
    backup,
    mode: "empty",
    existingLedger: { accounts: [], categories: [], transactions: [] },
    existingPresets: [],
    presetStore: { save: async () => {} },
    demo: true,
    demoId: () => `id_${nextId++}`,
  });
  assert.equal(restored.ledger.accounts[0].currency, "USD");
  assert.equal(restored.ledger.transactions[0].original_currency, "USD");
  assert.equal(restored.ledger.transactions[0].original_amount, 10000);
  assert.equal(restored.ledger.transactions[0].fx_rate, 3.6725);
});
