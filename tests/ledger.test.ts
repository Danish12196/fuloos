import test from "node:test";
import assert from "node:assert/strict";
import { LEDGER_RULES } from "../src/ledger/rules.generated.ts";
import {
  bankForMessage,
  dateInText,
  parseSms,
  splitPastedSms,
  maskForDisplay,
} from "../src/ledger/sms.ts";
import { CANONICAL, categorise, makeText } from "../src/ledger/categoriser.ts";
import {
  hashModel,
  loadModel,
  predictPlain,
  predictProba,
  type PlainModel,
} from "../src/ledger/model.ts";
import { guessMap } from "../src/ledger/mapping.ts";
import { suggestCategory } from "../src/ledger/learning.ts";
import {
  previewSms,
  displayPayee,
  markDuplicates,
} from "../src/ledger/smsImport.ts";
import type { Ledger } from "../src/domain.ts";

// All messages below are synthetic, written from the public bank templates. No real SMS is used in tests.
const SMS = {
  liv: "Purchase of AED 45.00 with Debit Card ending 1234 at TALABAT, DUBAI. Avl Bal is AED 1,000.00",
  mashreq:
    "Thank you for using your Mashreq Card ending 5678 for AED 210.50 at CARREFOUR MOE on 05-MAY-2025. Available Balance is AED 3,000.00",
  adcb: "Cr.Card ***9876 used for AED 120.00 on 03/05/2025 12:30 at ADNOC 123,DUBAI-AE. Avl. Cr.limit is AED 5000.00",
  fab: "Credit Card Purchase Card No XXXX4321 AED 56.00 NETFLIX.COM Amsterdam NL 04/05/25 10:11 Available Balance AED 2,000.00",
  adib: "Trx. of AED 75.00 on your card ending ***1111 at ASTER PHARMACY in DUBAI, UNITED ARAB EMI is Approved. Avl. card bal is 900.00",
  otp: "Your OTP is 123456. Do not share it.",
  usd: "Purchase of USD 10.00 with Credit Card ending 1234 at SPOTIFY, STOCKHOLM. Avl Bal is AED 500.00",
  salary: "Salary of AED 15,000.00 has been credited to your account",
};

test("rule tables exclude the private merchant overrides", () => {
  assert.equal("OVERRIDES" in LEDGER_RULES, false);
  assert.equal("source" in LEDGER_RULES, false);
});

test("parses each supported bank template", () => {
  const cases: [string, string, number, string, string | null][] = [
    [SMS.liv, "Liv", 45, "Talabat", null],
    [SMS.mashreq, "Mashreq", 210.5, "Carrefour", "2025-05-05"],
    [SMS.adcb, "ADCB", 120, "ADNOC", "2025-05-03"],
    [SMS.fab, "FAB", 56, "Netflix", "2025-05-04"],
    [SMS.adib, "ADIB", 75, "ASTER PHARMACY", null],
  ];
  for (const [message, bank, amount, merchant, date] of cases) {
    const detected = bankForMessage(message, null);
    assert.equal(detected, bank, message);
    const p = parseSms(message, detected);
    assert.equal(p.txn_type, "purchase");
    assert.equal(p.direction, "debit");
    assert.equal(p.amount_aed, amount);
    assert.equal(p.merchant_clean, merchant);
    assert.equal(p.date_in_text, date);
  }
});

test("flags OTPs, converts foreign currency and reads income", () => {
  assert.equal(parseSms(SMS.otp, null).txn_type, "otp");
  const usd = parseSms(SMS.usd, "Liv");
  assert.equal(usd.currency, "USD");
  assert.ok(Math.abs(usd.amount_aed - 36.725) < 1e-9);
  assert.equal(usd.is_foreign, true);
  const salary = parseSms(SMS.salary, "Liv");
  assert.equal(salary.txn_type, "income");
  assert.equal(salary.direction, "credit");
});

test("dates inside SMS text are validated", () => {
  assert.equal(dateInText("on 31-FEB-2025"), null);
  assert.equal(dateInText("on 29/02/2024 10:00"), "2024-02-29");
  assert.equal(dateInText("no date"), null);
});

test("pasted SMS split on blank lines, else lines; masking hides long numbers", () => {
  assert.equal(splitPastedSms("a\nb\n\nc").length, 2);
  assert.equal(splitPastedSms("a\nb\nc").length, 3);
  assert.equal(
    maskForDisplay("acct 1234567890 x@y.com"),
    "acct 12••••90 •••@•••",
  );
});

test("rules categorise known brands and keywords without a model", () => {
  const talabat = categorise(null, "Talabat", 45);
  assert.equal(talabat.category, "Food_Dining");
  assert.equal(talabat.decidedBy, "rules");
  assert.equal(talabat.needsReview, false);
  const pharmacy = categorise(null, "ASTER PHARMACY", 75);
  assert.equal(pharmacy.category, "Health_Wellness");
  const unknown = categorise(null, "ZQXW", 10);
  assert.equal(unknown.category, null);
  assert.equal(unknown.needsReview, true);
  const own = categorise(
    null,
    "ZQXW",
    10,
    new Map([["ZQXW", ["Travel", 0.95]]]),
  );
  assert.equal(own.category, "Travel");
  assert.equal(own.decidedBy, "your corrections");
  assert.equal(makeText("ADNOC 123-456 7890"), "ADNOC");
});

function tinyPlainModel(): PlainModel {
  const char = [" ta", "tal", "ala", " ca", "car", "rre", "ix "];
  const word = ["talabat", "carrefour", "netflix", "dewa"];
  const n = char.length + word.length + 1;
  let seed = 7;
  const rand = () =>
    ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return {
    categories: [...CANONICAL],
    classes: [...CANONICAL].reverse(),
    char: {
      analyzer: "char_wb",
      ngram: [2, 5],
      vocab: char,
      idf: char.map((_, i) => 1 + i / 10),
    },
    word: {
      analyzer: "word",
      ngram: [1, 2],
      vocab: word,
      idf: word.map((_, i) => 2 + i / 10),
    },
    amount: { mean: 4, scale: 1.5 },
    coef: CANONICAL.map(() => Array.from({ length: n }, rand)),
    intercept: CANONICAL.map(() => rand()),
    calibration: {
      method: "sigmoid",
      a: CANONICAL.map(() => -1.2),
      b: CANONICAL.map(() => 0.1),
    },
    review_threshold: 0.6,
    meta: { n_train: 10, people: 2, min_users: 2 },
  };
}

test("hashed model keeps predictions and drops every readable n-gram", () => {
  const plain = tinyPlainModel();
  const hashed = hashModel(plain, 24, "test");
  const json = JSON.stringify(hashed);
  for (const g of [...plain.char.vocab, ...plain.word.vocab])
    assert.equal(json.includes(JSON.stringify(g)), false, g);
  const model = loadModel(JSON.parse(json));
  for (const [text, amount] of [
    ["TALABAT", 45],
    ["CARREFOUR", 210],
    ["NETFLIX", 56],
    ["UNSEEN SHOP", 10],
  ] as const) {
    const p = predictProba(model, text, amount);
    const q = predictPlain(plain, text, amount);
    p.forEach((v, k) => assert.ok(Math.abs(v - q[k]) < 1e-5));
    assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
});

test("loadModel refuses plain exports and damaged files", () => {
  assert.throws(() => loadModel(tinyPlainModel()), /Not a hashed Ledger model/);
  const hashed = hashModel(tinyPlainModel(), 24);
  hashed.intercept[0] += 5;
  assert.throws(() => loadModel(hashed), /self-check failed/);
});

test("category names are guessed at word starts", () => {
  const categories = [
    { id: "g", name: "Groceries", description: "", color: "" },
    { id: "c", name: "Car", description: "", color: "" },
    { id: "s", name: "Scarves", description: "", color: "" },
    { id: "f", name: "Eating out", description: "", color: "" },
  ];
  const map = guessMap(categories);
  assert.equal(map.Groceries, "g");
  assert.equal(map.Transport_Auto, "c");
  assert.equal(map.Food_Dining, "f");
  assert.equal(map.Travel, null);
});

test("SMS preview builds reviewable transactions", () => {
  const ledger: Ledger = {
    accounts: [
      {
        id: "a",
        name: "Liv",
        type: "current",
        opening_balance: 0,
        opening_date: "2020-01-01",
        color: "",
      },
    ],
    categories: [{ id: "food", name: "Food", description: "", color: "" }],
    transactions: [
      {
        id: "t1",
        type: "expense",
        amount: 21050,
        account_id: "a",
        to_account_id: null,
        category_id: null,
        date: "2025-05-05",
        payee: "Carrefour",
        notes: "",
      },
    ],
  };
  const rows = previewSms(
    [SMS.liv, SMS.mashreq, SMS.otp, SMS.usd, SMS.salary, SMS.liv].map(
      (message) => ({
        message,
        date: null,
        sender: null,
      }),
    ),
    { account: "a", fallbackDate: "2025-06-01" },
    ledger,
    (m, a) => suggestCategory(null, null, { Food_Dining: "food" }, m, a),
  );
  const [talabat, carrefour, otp, usd, salary, repeat] = rows;
  assert.deepEqual(talabat.transaction, {
    date: "2025-06-01",
    account_id: "a",
    to_account_id: null,
    category_id: "food",
    type: "expense",
    amount: 4500,
    payee: "Talabat",
    notes: "From Liv SMS",
  });
  assert.equal(talabat.dateSource, "fallback");
  assert.equal(carrefour.duplicate, true);
  assert.equal(carrefour.transaction?.date, "2025-05-05");
  assert.match(otp.skipped, /One-time password/);
  assert.equal(otp.transaction, null);
  assert.equal(usd.transaction?.amount, 3673);
  assert.match(usd.transaction!.notes, /10\.00 USD/);
  assert.equal(salary.transaction?.type, "income");
  assert.equal(salary.transaction?.category_id, null);
  assert.equal(salary.transaction?.payee, "Salary / income");
  assert.equal(repeat.duplicate, true);
  assert.equal(displayPayee("AL MAYA SUPERMARKET"), "Al Maya Supermarket");
});

test("duplicates follow edits and repeated SMS on different days are kept", () => {
  const ledger: Ledger = {
    accounts: [
      {
        id: "a",
        name: "Liv",
        type: "current",
        opening_balance: 0,
        opening_date: "2020-01-01",
        color: "",
      },
    ],
    categories: [],
    transactions: [
      {
        id: "t1",
        type: "expense",
        amount: 4500,
        account_id: "a",
        to_account_id: null,
        category_id: null,
        date: "2025-01-10",
        payee: "Talabat",
        notes: "",
      },
    ],
  };
  const rows = previewSms(
    [
      { message: SMS.salary, date: "2025-01-31", sender: "Liv" },
      { message: SMS.salary, date: "2025-02-28", sender: "Liv" },
      { message: SMS.liv, date: null, sender: null },
    ],
    { account: "a", fallbackDate: "2025-06-01" },
    ledger,
    (m, a) => suggestCategory(null, null, {}, m, a),
  );
  assert.equal(rows[0].duplicate, false);
  assert.equal(rows[1].duplicate, false);
  assert.equal(rows[2].duplicate, false);
  const edited = markDuplicates(
    rows.map((r, i) =>
      i === 2
        ? { ...r, transaction: { ...r.transaction!, date: "2025-01-10" } }
        : r,
    ),
    ledger,
  );
  assert.equal(edited[2].duplicate, true);
});
