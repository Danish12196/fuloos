import test from "node:test";
import assert from "node:assert/strict";
import { previewCsv, type CsvOptions } from "../src/csv.ts";
import type { Ledger, Transaction } from "../src/domain.ts";
import {
  appliedMatches,
  findTransferMatches,
  nameScore,
  normalizeText,
  pairedTransfer,
} from "../src/transferMatch.ts";

// Made-up accounts and rows only.
const account = (id: string, name: string) => ({
  id,
  name,
  type: "current" as const,
  opening_balance: 0,
  opening_date: "1970-01-01",
  color: "",
});
const base = (): Ledger => ({
  accounts: [
    account("chk", "Everyday Bank"),
    account("sav", "Nest Saver"),
    account("card", "Rewards Card"),
  ],
  categories: [{ id: "food", name: "Food", description: "", color: "" }],
  transactions: [],
});
const tx = (t: Partial<Transaction> & { id: string }): Transaction => ({
  type: "expense",
  amount: 0,
  account_id: "chk",
  to_account_id: null,
  category_id: null,
  date: "2026-03-01",
  payee: "",
  notes: "",
  ...t,
});
const options = (account: string): CsvOptions => ({
  date: 0,
  payee: 1,
  notes: 2,
  amount: 3,
  category: -1,
  debit: -1,
  credit: -1,
  split: false,
  flip: false,
  decimal: ".",
  dateFormat: "YMD",
  account,
});
function match(ledger: Ledger, account: string, rows: string[][]) {
  const preview = previewCsv(rows, options(account), ledger);
  return findTransferMatches(preview, account, ledger);
}

test("a payee that is another account's name becomes a transfer", () => {
  const [m, ...rest] = match(base(), "chk", [
    ["2026-03-01", "Nest Saver", "", "-500"],
    ["2026-03-02", "Corner Cafe", "", "-12.50"],
  ]);
  assert.equal(rest.length, 0);
  assert.equal(m.index, 0);
  assert.equal(m.kind, "named");
  assert.equal(m.confidence, "sure");
  assert.equal(m.otherAccount, "sav");
});

test("the other statement then sees the transfer as already recorded", () => {
  const ledger = base();
  ledger.transactions.push(
    tx({
      id: "t1",
      type: "transfer",
      amount: 50000,
      account_id: "chk",
      to_account_id: "sav",
      payee: "Nest Saver",
    }),
  );
  const [m] = match(ledger, "sav", [
    ["2026-03-01", "Everyday Bank", "Incoming", "500"],
  ]);
  assert.equal(m.kind, "recorded");
  assert.equal(m.confidence, "sure");
  assert.equal(m.counterpart?.id, "t1");
  // Wrong direction is not the same transfer.
  assert.equal(
    match(ledger, "sav", [["2026-03-01", "Everyday Bank", "", "-500"]]).filter(
      (x) => x.kind === "recorded",
    ).length,
    0,
  );
});

test("an expense already in the ledger pairs with the incoming leg", () => {
  const ledger = base();
  ledger.transactions.push(
    tx({
      id: "paid",
      amount: 120000,
      category_id: "food",
      date: "2026-03-05",
      payee: "Card payment",
      notes: "Rewards Card",
    }),
  );
  const [m] = match(ledger, "card", [
    ["2026-03-06", "Payment received, thank you", "", "1200"],
  ]);
  assert.equal(m.kind, "pair");
  assert.equal(m.confidence, "sure");
  assert.equal(m.otherAccount, "chk");
  const merged = pairedTransfer(m.counterpart!, "card");
  assert.deepEqual(
    [
      merged.id,
      merged.type,
      merged.account_id,
      merged.to_account_id,
      merged.category_id,
    ],
    ["paid", "transfer", "chk", "card", null],
  );
});

test("an incoming entry already in the ledger pairs with the outgoing leg", () => {
  const ledger = base();
  ledger.transactions.push(
    tx({ id: "in", type: "income", amount: 2000, account_id: "sav" }),
  );
  const [m] = match(ledger, "chk", [
    ["2026-03-01", "Transfer to savings", "", "-20"],
  ]);
  assert.equal(m.kind, "pair");
  const merged = pairedTransfer(m.counterpart!, "chk");
  assert.equal(merged.account_id, "chk");
  assert.equal(merged.to_account_id, "sav");
});

test("amount and date alone are only a suggestion", () => {
  const ledger = base();
  ledger.transactions.push(
    tx({ id: "x", type: "income", amount: 4500, account_id: "sav" }),
  );
  const [m] = match(ledger, "chk", [["2026-03-01", "Bookshop", "", "-45"]]);
  assert.equal(m.kind, "pair");
  assert.equal(m.confidence, "likely");
  assert.deepEqual(appliedMatches([m], new Map()), []);
  assert.deepEqual(appliedMatches([m], new Map([[m.index, "accept"]])), [m]);
});

test("unhinted amounts days apart, same-direction entries and recurring links are ignored", () => {
  const ledger = base();
  ledger.transactions.push(
    tx({
      id: "far",
      type: "income",
      amount: 4500,
      account_id: "sav",
      date: "2026-03-04",
    }),
    tx({ id: "same", type: "expense", amount: 7000, account_id: "sav" }),
    tx({ id: "rec", type: "income", amount: 9900, account_id: "sav" }),
    tx({
      id: "old",
      type: "income",
      amount: 1500,
      account_id: "sav",
      date: "2026-02-01",
      payee: "Everyday Bank",
    }),
  );
  ledger.recurring_occurrences = [
    {
      id: "o",
      recurring_id: "r",
      occurrence_date: "2026-03-01",
      transaction_id: "rec",
    },
  ];
  const found = match(ledger, "chk", [
    ["2026-03-01", "Bookshop", "", "-45"],
    ["2026-03-01", "Shoes", "", "-70"],
    ["2026-03-01", "Gym", "", "-99"],
    ["2026-03-01", "Florist", "", "-15"],
  ]);
  assert.deepEqual(found, []);
});

test("each existing entry pairs with one row, nearest date first", () => {
  const ledger = base();
  ledger.transactions.push(
    tx({
      id: "in",
      type: "income",
      amount: 30000,
      account_id: "sav",
      date: "2026-03-02",
      payee: "From Everyday Bank",
    }),
  );
  const found = match(ledger, "chk", [
    ["2026-03-04", "Transfer", "", "-300"],
    ["2026-03-02", "Transfer", "", "-300"],
  ]);
  const pairs = found.filter((m) => m.kind === "pair");
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].index, 1);
});

test("rejecting a sure match keeps the row as income or expense", () => {
  const [m] = match(base(), "chk", [["2026-03-01", "Nest Saver", "", "-5"]]);
  assert.deepEqual(appliedMatches([m], new Map([[0, "reject"]])), []);
});

test("account names match on whole words, ignoring case and punctuation", () => {
  const card = account("c", "Rewards Card");
  assert.equal(nameScore(normalizeText("REWARDS-CARD payment"), card), 3);
  assert.equal(nameScore(normalizeText("rewards points"), card), 1);
  assert.equal(nameScore(normalizeText("card fee"), card), 0);
  assert.equal(nameScore(normalizeText("forewards"), card), 0);
});

test("a row naming its own account is not a transfer", () => {
  assert.deepEqual(
    match(base(), "chk", [["2026-03-01", "Everyday Bank", "fee", "-5"]]),
    [],
  );
});

test("credit card accounts are hinted by card payment wording", () => {
  const ledger = base();
  ledger.accounts[2] = {
    ...ledger.accounts[2],
    name: "Platinum",
    type: "credit_card",
  };
  const [m] = match(ledger, "chk", [
    ["2026-03-01", "Transfer to credit card", "", "-300"],
  ]);
  assert.equal(m.kind, "named");
  assert.equal(m.otherAccount, "card");
  assert.equal(m.confidence, "likely");
});

test("a row already imported as an expense is left a duplicate, not turned into a transfer", () => {
  const ledger = base();
  ledger.transactions.push(
    tx({ id: "old", amount: 50000, payee: "Nest Saver" }),
  );
  const rows = [["2026-03-01", "Nest Saver", "", "-500"]];
  const preview = previewCsv(rows, options("chk"), ledger);
  assert.equal(preview[0].duplicate, true);
  assert.deepEqual(findTransferMatches(preview, "chk", ledger), []);
});

test("competing CSV rows for the same ledger transaction downgrade sure to likely", () => {
  const ledger = base();
  ledger.transactions.push(
    tx({
      id: "in1",
      type: "income",
      amount: 50000,
      account_id: "sav",
      date: "2026-03-02",
      payee: "From Everyday Bank",
    }),
  );
  // Two non-duplicate CSV rows on consecutive days with the same amount and transfer
  // wording compete within 1 point for the single ledger transaction "in1".
  const found = match(ledger, "chk", [
    ["2026-03-02", "Nest Saver", "", "-500"],
    ["2026-03-03", "Nest Saver", "", "-500"],
  ]);
  const pairMatch = found.find((m) => m.kind === "pair");
  assert.ok(pairMatch);
  assert.equal(pairMatch.confidence, "likely");
});
