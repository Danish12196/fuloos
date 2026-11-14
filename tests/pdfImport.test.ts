import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, type Ledger } from "../src/domain.ts";
import {
  detectPdfBank,
  extractLeadingDate,
  groupTextItemsIntoLines,
  markPdfDuplicates,
  parsePdfStatement,
  type PdfLine,
  type PdfTextItem,
} from "../src/pdfImport.ts";
import { findTransferMatches } from "../src/transferMatch.ts";

function makeLedger(): Ledger {
  return {
    ...emptyLedger,
    accounts: [
      {
        id: "acc_enbd",
        name: "ENBD Current",
        type: "bank",
        opening_balance: 1000000,
        opening_date: "2025-01-01",
      },
      {
        id: "acc_liv",
        name: "Liv Savings",
        type: "bank",
        opening_balance: 500000,
        opening_date: "2025-01-01",
      },
    ],
    categories: [
      { id: "cat_groc", name: "Groceries", description: "", color: "#2e7d32" },
      { id: "cat_food", name: "Food & Dining", description: "", color: "#e65100" },
      { id: "cat_util", name: "Utilities & Bills", description: "", color: "#1565c0" },
    ],
    transactions: [
      {
        id: "tx_existing",
        date: "2026-03-10",
        account_id: "acc_enbd",
        to_account_id: null,
        category_id: "cat_groc",
        type: "expense",
        amount: 24550,
        payee: "Carrefour Hypermarket",
        notes: "",
      },
      {
        id: "tx_liv_in",
        date: "2026-03-14",
        account_id: "acc_liv",
        to_account_id: null,
        category_id: null,
        type: "income",
        amount: 200000,
        payee: "Transfer from ENBD",
        notes: "",
      },
    ],
    rules: [
      {
        id: "rule_dewa",
        name: "DEWA",
        enabled: true,
        priority: 1,
        match_field: "payee",
        match_type: "contains",
        pattern: "dewa",
        set_category_id: "cat_util",
        add_tags: ["bills"],
      },
    ],
  };
}

function linesFromStrings(strings: string[], page = 1): PdfLine[] {
  return strings.map((text, idx) => ({
    page,
    y: 700 - idx * 14,
    text,
    items: [{ str: text, x: 40, y: 700 - idx * 14 }],
  }));
}

test("groupTextItemsIntoLines sorts top-to-bottom by Y and left-to-right by X", () => {
  const items: PdfTextItem[] = [
    { str: "245.50", x: 400, y: 600.5, width: 35 },
    { str: "10/03/2026", x: 40, y: 600, width: 55 },
    { str: "CARREFOUR", x: 120, y: 601, width: 65 },
    { str: "Header Line", x: 40, y: 720, width: 70 },
    { str: "Next Row", x: 40, y: 580, width: 50 },
  ];

  const lines = groupTextItemsIntoLines(items, 1, 3);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, "Header Line");
  assert.equal(lines[1].text, "10/03/2026 CARREFOUR 245.50");
  assert.equal(lines[2].text, "Next Row");
  assert.deepEqual(
    lines[1].items.map((i) => i.str),
    ["10/03/2026", "CARREFOUR", "245.50"],
  );
});

test("detectPdfBank identifies UAE banks and falls back to Generic", () => {
  assert.equal(
    detectPdfBank(linesFromStrings(["Emirates NBD Bank PJSC", "Account Statement"])),
    "ENBD",
  );
  assert.equal(
    detectPdfBank(linesFromStrings(["Liv. Bank Statement", "Emirates NBD"])),
    "Liv",
  );
  assert.equal(
    detectPdfBank(linesFromStrings(["Abu Dhabi Commercial Bank (ADCB)"])),
    "ADCB",
  );
  assert.equal(
    detectPdfBank(linesFromStrings(["First Abu Dhabi Bank PJSC - FAB"])),
    "FAB",
  );
  assert.equal(
    detectPdfBank(linesFromStrings(["Mashreq Neo Statement"])),
    "Mashreq",
  );
  assert.equal(
    detectPdfBank(linesFromStrings(["Abu Dhabi Islamic Bank (ADIB)"])),
    "ADIB",
  );
  assert.equal(
    detectPdfBank(linesFromStrings(["Some Credit Union Statement"])),
    "Generic",
  );
});

test("extractLeadingDate parses DD/MM/YYYY, DD-MMM-YYYY, and ISO dates strictly", () => {
  assert.deepEqual(extractLeadingDate("15/03/2026 POS PURCHASE", "DMY"), {
    date: "2026-03-15",
    rest: "POS PURCHASE",
  });
  assert.deepEqual(extractLeadingDate("05-Mar-2026 DEWA BILL", "DMY"), {
    date: "2026-03-05",
    rest: "DEWA BILL",
  });
  assert.deepEqual(extractLeadingDate("2026-03-01 SALARY", "DMY"), {
    date: "2026-03-01",
    rest: "SALARY",
  });
  assert.equal(extractLeadingDate("31/02/2026 INVALID DATE", "DMY"), null);
});

test("parsePdfStatement parses ENBD fixture with multi-line descriptions, rules, and duplicates", () => {
  const ledger = makeLedger();
  const page1 = linesFromStrings([
    "Emirates NBD Bank PJSC",
    "Account Statement",
    "Date Value Date Description Debit Credit Balance",
    "10/03/2026 10/03/2026 POS PURCHASE CARREFOUR HYPERMARKET 245.50 0.00 10,000.00",
    "11/03/2026 11/03/2026 DEWA BILL PAYMENT 410.00 0.00 9,590.00",
    "ELECTRICITY AND WATER DUBAI AE",
    "12/03/2026 12/03/2026 SALARY TRANSFER ACME LLC 0.00 15,000.00 24,590.00",
    "Page 1 of 1",
  ]);

  const result = parsePdfStatement([page1], { account: "acc_enbd" }, ledger);
  assert.equal(result.bank, "ENBD");
  assert.equal(result.warnings.length, 0);
  assert.equal(result.rows.length, 3);

  // Row 0: Carrefour matches existing ledger transaction -> duplicate
  assert.equal(result.rows[0].date, "2026-03-10");
  assert.equal(result.rows[0].amount, 24550);
  assert.equal(result.rows[0].kind, "expense");
  assert.equal(result.rows[0].duplicate, true);

  // Row 1: DEWA matches rule -> Utilities & Bills + #bills tag + multi-line notes
  assert.equal(result.rows[1].date, "2026-03-11");
  assert.equal(result.rows[1].amount, 41000);
  assert.equal(result.rows[1].kind, "expense");
  assert.equal(result.rows[1].duplicate, false);
  assert.equal(result.rows[1].transaction?.category_id, "cat_util");
  assert.deepEqual(result.rows[1].transaction?.tags, ["bills"]);
  assert.match(
    result.rows[1].transaction?.notes ?? "",
    /ELECTRICITY AND WATER DUBAI AE/,
  );

  // Row 2: Salary -> income
  assert.equal(result.rows[2].date, "2026-03-12");
  assert.equal(result.rows[2].amount, 1500000);
  assert.equal(result.rows[2].kind, "income");
  assert.equal(result.rows[2].transaction?.category_id, null);
});

test("parsePdfStatement uses column X-coordinates for ADCB debit vs credit disambiguation", () => {
  const ledger = makeLedger();
  const makeRow = (
    y: number,
    cols: Array<{ str: string; x: number }>,
  ): PdfLine => ({
    page: 1,
    y,
    text: cols.map((c) => c.str).join(" "),
    items: cols.map((c) => ({ str: c.str, x: c.x, y })),
  });

  const page1: PdfLine[] = [
    makeRow(760, [{ str: "Abu Dhabi Commercial Bank (ADCB)", x: 40 }]),
    makeRow(720, [
      { str: "Date", x: 40 },
      { str: "Description", x: 120 },
      { str: "Debit", x: 350 },
      { str: "Credit", x: 430 },
      { str: "Balance", x: 510 },
    ]),
    makeRow(700, [
      { str: "13-Mar-2026", x: 40 },
      { str: "TALABAT DUBAI", x: 120 },
      { str: "52.75", x: 350 },
      { str: "4,947.25", x: 510 },
    ]),
    makeRow(680, [
      { str: "14-Mar-2026", x: 40 },
      { str: "INWARD TRANSFER", x: 120 },
      { str: "1,250.00", x: 430 },
      { str: "6,197.25", x: 510 },
    ]),
  ];

  const result = parsePdfStatement([page1], { account: "acc_enbd" }, ledger);
  assert.equal(result.bank, "ADCB");
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].kind, "expense");
  assert.equal(result.rows[0].amount, 5275);
  assert.equal(result.rows[0].transaction?.category_id, "cat_food");
  assert.equal(result.rows[1].kind, "income");
  assert.equal(result.rows[1].amount, 125000);
});

test("parsePdfStatement handles FAB CR/DR/parentheses signs and generic unparsed warnings", () => {
  const ledger = makeLedger();
  const page1 = linesFromStrings([
    "First Abu Dhabi Bank (FAB)",
    "15/03/2026 NOON.COM DUBAI (125.00)",
    "16/03/2026 CASHBACK REWARD 25.00 CR",
    "UNPARSEABLE LINE WITH AMOUNT 99.99",
  ]);

  const result = parsePdfStatement([page1], { account: "acc_enbd" }, ledger);
  assert.equal(result.bank, "FAB");
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].kind, "expense");
  assert.equal(result.rows[0].amount, 12500);
  assert.equal(result.rows[1].kind, "income");
  assert.equal(result.rows[1].amount, 2500);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].reason, /without a valid transaction date/i);
});

test("parsePdfStatement integrates with markPdfDuplicates and findTransferMatches", () => {
  const ledger = makeLedger();
  const page1 = linesFromStrings([
    "Generic Bank",
    "14/03/2026 IPP TRANSFER TO LIV SAVINGS 2,000.00",
    "14/03/2026 IPP TRANSFER TO LIV SAVINGS 2,000.00",
  ]);

  const result = parsePdfStatement([page1], { account: "acc_enbd" }, ledger);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].duplicate, false);
  assert.equal(result.rows[1].duplicate, true);

  const matches = findTransferMatches(result.rows, "acc_enbd", ledger);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, "pair");
  assert.equal(matches[0].otherAccount, "acc_liv");

  const rechecked = markPdfDuplicates(result.rows, ledger);
  assert.equal(rechecked[1].duplicate, true);
});
