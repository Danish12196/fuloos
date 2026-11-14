import assert from "node:assert/strict";
import test from "node:test";
import { budgetReport, unbudgetedCategories } from "../src/budgets.ts";
import {
  createBackup,
  parseAndValidateBackup,
  executeRestore,
} from "../src/backup.ts";
import {
  emptyLedger,
  validateTransaction,
  type Ledger,
  type Transaction,
} from "../src/domain.ts";
import {
  MAX_RECEIPT_BYTES,
  MAX_TAGS_PER_TX,
  MAX_TAG_LENGTH,
  collectLedgerTags,
  normalizeSplits,
  normalizeTag,
  normalizeTags,
  splitRemainder,
  transactionCategoryAmounts,
  validateReceiptFile,
  validateSplits,
  validateTags,
} from "../src/enrichment.ts";
import { buildRegister, entryCategory, filterRegister } from "../src/register.ts";

function sampleLedger(): Ledger {
  return {
    ...emptyLedger,
    accounts: [
      {
        id: "acc1",
        name: "Checking",
        type: "current",
        opening_balance: 500000,
        opening_date: "2026-01-01",
        color: "#1d5b48",
      },
      {
        id: "acc2",
        name: "Savings",
        type: "savings",
        opening_balance: 100000,
        opening_date: "2026-01-01",
        color: "#696198",
      },
    ],
    categories: [
      {
        id: "cat_food",
        name: "Groceries",
        description: "",
        color: "#1d5b48",
      },
      {
        id: "cat_home",
        name: "Household",
        description: "",
        color: "#b08448",
      },
    ],
    budgets: [
      {
        id: "b1",
        category_id: "cat_food",
        amount: 100000,
        start_month: "2026-03",
        end_month: null,
      },
    ],
    transactions: [],
  };
}

test("normalizeTag and normalizeTags normalize lowercase, deduplicate, and enforce caps", () => {
  assert.equal(normalizeTag("  Weekly   Groceries "), "weekly groceries");
  assert.deepEqual(
    normalizeTags(["  Food ", "FOOD", "travel", "", "  travel  "]),
    ["food", "travel"],
  );
  assert.deepEqual(normalizeTags("a, B, a, c"), ["a", "b", "c"]);

  const many = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
  assert.equal(normalizeTags(many).length, MAX_TAGS_PER_TX);

  const longTag = "x".repeat(50);
  assert.equal(normalizeTags([longTag])[0].length, MAX_TAG_LENGTH);
});

test("validateTags rejects invalid arrays, long tags, and > 20 tags", () => {
  assert.deepEqual(validateTags(["  Coffee ", "coffee"]), ["coffee"]);
  assert.throws(() => validateTags("not-array"), /list of strings/);
  assert.throws(() => validateTags(["a".repeat(33)]), /exceeds 32/);
  assert.throws(
    () => validateTags(Array.from({ length: 21 }, (_, i) => `t${i}`)),
    /at most 20/,
  );
});

test("validateSplits enforces sum, positive integers, valid categories, and non-transfer", () => {
  const ledger = sampleLedger();
  assert.equal(
    splitRemainder(10000, [{ amount: 6000 }, { amount: 2500 }]),
    1500,
  );
  assert.doesNotThrow(() =>
    validateSplits(
      [
        { category_id: "cat_food", amount: 6000 },
        { category_id: "cat_home", amount: 4000 },
      ],
      10000,
      "expense",
      ledger.categories,
    ),
  );
  assert.throws(
    () =>
      validateSplits(
        [{ category_id: "cat_food", amount: 5000 }],
        10000,
        "expense",
        ledger.categories,
      ),
    /must sum to the transaction amount/,
  );
  assert.throws(
    () =>
      validateSplits(
        [{ category_id: "cat_food", amount: 0 }],
        0,
        "expense",
        ledger.categories,
      ),
    /positive amount/,
  );
  assert.throws(
    () =>
      validateSplits(
        [{ category_id: "missing", amount: 1000 }],
        1000,
        "expense",
        ledger.categories,
      ),
    /missing category/,
  );
  assert.throws(
    () =>
      validateSplits(
        [{ category_id: null, amount: 1000 }],
        1000,
        "transfer",
        ledger.categories,
      ),
    /Transfers cannot be split/,
  );
});

test("validateTransaction enforces tags and splits", () => {
  const ledger = sampleLedger();
  assert.doesNotThrow(() =>
    validateTransaction(
      {
        type: "expense",
        amount: 10000,
        account_id: "acc1",
        to_account_id: null,
        category_id: "cat_food",
        date: "2026-03-10",
        payee: "Carrefour",
        notes: "",
        tags: ["groceries", "home"],
        splits: [
          { category_id: "cat_food", amount: 7000 },
          { category_id: "cat_home", amount: 3000 },
        ],
      },
      ledger,
    ),
  );
  assert.throws(
    () =>
      validateTransaction(
        {
          type: "expense",
          amount: 10000,
          account_id: "acc1",
          to_account_id: null,
          category_id: "cat_food",
          date: "2026-03-10",
          payee: "Carrefour",
          notes: "",
          splits: [{ category_id: "cat_food", amount: 9000 }],
        },
        ledger,
      ),
    /must sum/,
  );
});

test("split expenses attribute amounts to each split category in budgets and attribution helpers", () => {
  const ledger = sampleLedger();
  const splitTx: Transaction = {
    id: "tx1",
    type: "expense",
    amount: 10000,
    account_id: "acc1",
    to_account_id: null,
    category_id: "cat_food",
    date: "2026-03-15",
    payee: "Carrefour",
    notes: "Mixed basket",
    tags: ["groceries", "home"],
    splits: [
      { category_id: "cat_food", amount: 6500 },
      { category_id: "cat_home", amount: 3500 },
    ],
  };
  ledger.transactions = [splitTx];

  assert.deepEqual(transactionCategoryAmounts(splitTx), [
    { category_id: "cat_food", amount: 6500 },
    { category_id: "cat_home", amount: 3500 },
  ]);

  const report = budgetReport(ledger, "2026-03", "2026-03");
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].category.id, "cat_food");
  assert.equal(report.rows[0].actual, 6500);
  assert.equal(report.unbudgeted, 3500);

  const unbudgeted = unbudgetedCategories(ledger, "2026-03");
  assert.equal(unbudgeted.length, 1);
  assert.equal(unbudgeted[0].category.id, "cat_home");
  assert.equal(unbudgeted[0].actual, 3500);
});

test("register filters and searches by tags and split categories", () => {
  const ledger = sampleLedger();
  ledger.transactions = [
    {
      id: "tx1",
      type: "expense",
      amount: 10000,
      account_id: "acc1",
      to_account_id: null,
      category_id: "cat_food",
      date: "2026-03-15",
      payee: "Carrefour",
      notes: "",
      tags: ["ramadan", "family"],
      splits: [
        { category_id: "cat_food", amount: 6000 },
        { category_id: "cat_home", amount: 4000 },
      ],
    },
    {
      id: "tx2",
      type: "expense",
      amount: 2000,
      account_id: "acc1",
      to_account_id: null,
      category_id: "cat_food",
      date: "2026-03-16",
      payee: "Costa",
      notes: "",
      tags: ["coffee"],
    },
  ];

  assert.deepEqual(collectLedgerTags(ledger), ["coffee", "family", "ramadan"]);

  const reg = buildRegister(ledger);
  assert.equal(entryCategory(reg[0], ledger), "Split: Groceries, Household");

  const byTag = filterRegister(reg, ledger, { tag: "ramadan" });
  assert.equal(byTag.length, 1);
  assert.equal(byTag[0].tx.id, "tx1");

  const bySearch = filterRegister(reg, ledger, { search: "coffee" });
  assert.equal(bySearch.length, 1);
  assert.equal(bySearch[0].tx.id, "tx2");

  const bySplitCat = filterRegister(reg, ledger, { category: "cat_home" });
  assert.equal(bySplitCat.length, 1);
  assert.equal(bySplitCat[0].tx.id, "tx1");
});

test("validateReceiptFile enforces size <= 5 MB and allowed MIME types", () => {
  assert.doesNotThrow(() =>
    validateReceiptFile({ size: 1024, type: "image/jpeg" }),
  );
  assert.doesNotThrow(() =>
    validateReceiptFile({ size: 1024, type: "application/pdf" }),
  );
  assert.throws(
    () => validateReceiptFile({ size: 0, type: "image/png" }),
    /empty/,
  );
  assert.throws(
    () =>
      validateReceiptFile({
        size: MAX_RECEIPT_BYTES + 1,
        type: "image/webp",
      }),
    /5 MB/,
  );
  assert.throws(
    () => validateReceiptFile({ size: 100, type: "text/plain" }),
    /JPEG, PNG, WebP/,
  );
});

test("backup parse and restore preserve tags and remap split category IDs", async () => {
  const ledger = sampleLedger();
  ledger.transactions = [
    {
      id: "tx1",
      type: "expense",
      amount: 10000,
      account_id: "acc1",
      to_account_id: null,
      category_id: "cat_food",
      date: "2026-03-15",
      payee: "Carrefour",
      notes: "",
      tags: ["weekly"],
      splits: [
        { category_id: "cat_food", amount: 7000 },
        { category_id: "cat_home", amount: 3000 },
      ],
    },
  ];
  const raw = createBackup(ledger, []);
  const { backup: parsed } = parseAndValidateBackup(JSON.stringify(raw));
  assert.deepEqual(parsed.data.transactions[0].tags, ["weekly"]);
  assert.equal(parsed.data.transactions[0].splits?.length, 2);

  let seq = 0;
  const restored = await executeRestore({
    backup: parsed,
    mode: "empty",
    existingLedger: emptyLedger,
    existingPresets: [],
    presetStore: {
      scope: () => "demo",
      load: async () => ({ presets: [] }),
      save: async () => {},
      remove: async () => {},
    },
    demo: true,
    demoId: () => `new_${++seq}`,
  });

  const restoredTx = restored.ledger.transactions[0];
  assert.deepEqual(restoredTx.tags, ["weekly"]);
  assert.equal(restoredTx.splits?.length, 2);
  const restoredCatIds = new Set(restored.ledger.categories.map((c) => c.id));
  assert.ok(restoredTx.splits!.every((s) => restoredCatIds.has(s.category_id!)));
});

test("normalizeSplits handles malformed inputs safely", () => {
  assert.deepEqual(normalizeSplits(null), []);
  assert.deepEqual(
    normalizeSplits([{ category_id: "", amount: 500, notes: "  ok " }]),
    [{ category_id: null, amount: 500, notes: "ok" }],
  );
});
