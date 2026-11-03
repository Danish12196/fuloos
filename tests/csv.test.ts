import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  csvDate,
  csvAmount,
  previewCsv,
  type CsvOptions,
} from "../src/csv.ts";
const ledger = {
  accounts: [
    {
      id: "a",
      name: "Bank",
      type: "current" as const,
      opening_balance: 0,
      opening_date: "2020-01-01",
      color: "",
    },
  ],
  categories: [],
  transactions: [],
};
const options: CsvOptions = {
  date: 0,
  payee: 1,
  amount: 2,
  notes: -1,
  category: -1,
  debit: 2,
  credit: 3,
  split: false,
  flip: false,
  decimal: ".",
  dateFormat: "DMY",
  account: "a",
};
test("CSV handles BOM, escaped quotes, embedded newlines, delimiters and CRLF", () => {
  assert.deepEqual(
    parseCsv(
      '\uFEFFDate,Payee,Amount\r\n01/02/2026,"Shop, ""A""\nDubai",-20\r\n',
    ),
    [
      ["Date", "Payee", "Amount"],
      ["01/02/2026", 'Shop, "A"\nDubai', "-20"],
    ],
  );
  assert.deepEqual(parseCsv("a;b\n1;2", ";"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.throws(() => parseCsv('a,"unfinished'));
});
test("dates are explicit and impossible dates rejected", () => {
  assert.equal(csvDate("02/03/2026", "DMY"), "2026-03-02");
  assert.equal(csvDate("02/03/2026", "MDY"), "2026-02-03");
  assert.throws(() => csvDate("31/02/2026", "DMY"));
  assert.throws(() => csvDate("01/02/26", "DMY"));
});
test("amount parsing preserves fils and validates grouping", () => {
  assert.equal(csvAmount("(1,234.56)", "."), -123456);
  assert.equal(csvAmount("1.234,56", ","), 123456);
  assert.throws(() => csvAmount("1,23", "."));
  assert.throws(() => csvAmount("1.234", "."));
});
test("preview flags duplicates, invalid dates and pre-opening transactions", () => {
  const rows = [
    ["01/02/2026", "SHOP", "-20"],
    ["01/02/2026", "shop", "-20"],
    ["31/02/2026", "Shop", "-20"],
    ["01/01/2019", "Old", "-1"],
  ];
  const result = previewCsv(rows, options, ledger);
  assert.equal(result[0].transaction?.amount, 2000);
  assert.equal(result[1].duplicate, true);
  assert.ok(result[2].error);
  assert.ok(result[3].error);
  const existing = {
    ...ledger,
    transactions: [{ ...result[0].transaction!, id: "t" }],
  };
  assert.equal(previewCsv([rows[0]], options, existing)[0].duplicate, true);
});
test("split debit and credit, flipped signs, unknown categories", () => {
  const result = previewCsv(
    [
      ["01/02/2026", "Shop", "20", ""],
      ["01/02/2026", "Salary", "", "100"],
      ["01/02/2026", "Bad", "1", "2"],
    ],
    { ...options, split: true },
    ledger,
  );
  assert.equal(result[0].transaction?.type, "expense");
  assert.equal(result[1].transaction?.type, "income");
  assert.ok(result[2].error);
  assert.equal(
    previewCsv(
      [["01/02/2026", "Shop", "20"]],
      { ...options, flip: true },
      ledger,
    )[0].transaction?.type,
    "expense",
  );
  assert.ok(
    previewCsv(
      [["01/02/2026", "Missing", "20"]],
      { ...options, category: 1 },
      ledger,
    )[0].error,
  );
});
