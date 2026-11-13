import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_FORMAT_VERSION,
  BackupValidationError,
  createBackup,
  executeRestore,
  isLedgerEmpty,
  MAX_BACKUP_BYTES,
  parseAndValidateBackup,
  serializeBackup,
  type RestoreBackend,
} from "../src/backup.ts";
import { IMPORT_BATCH_SIZE } from "../src/backend.ts";
import type { CsvPreset } from "../src/csvPresets.ts";
import { emptyLedger, type Ledger } from "../src/domain.ts";

function sampleLedger(): Ledger {
  return {
    accounts: [
      {
        id: "old_acc_1",
        name: "ADCB Current",
        type: "current",
        opening_balance: 500000,
        opening_date: "2026-01-01",
        color: "#2d6a4f",
        emoji: "🏦",
      },
      {
        id: "old_acc_2",
        name: "Liv Savings",
        type: "savings",
        opening_balance: 100000,
        opening_date: "2026-01-01",
        color: "#1b4332",
      },
    ],
    categories: [
      {
        id: "old_cat_1",
        name: "Groceries",
        description: "Supermarkets",
        color: "#40916c",
        emoji: "🛒",
      },
      {
        id: "old_cat_2",
        name: "Salary",
        description: "Monthly income",
        color: "#52b788",
      },
    ],
    transactions: [
      {
        id: "old_tx_1",
        type: "expense",
        amount: 12550,
        account_id: "old_acc_1",
        to_account_id: null,
        category_id: "old_cat_1",
        date: "2026-03-01",
        payee: "Carrefour",
        notes: "Weekly",
      },
      {
        id: "old_tx_2",
        type: "transfer",
        amount: 50000,
        account_id: "old_acc_1",
        to_account_id: "old_acc_2",
        category_id: null,
        date: "2026-03-02",
        payee: "Savings move",
        notes: "",
      },
    ],
    recurring: [
      {
        id: "old_rec_1",
        name: "Carrefour Weekly",
        type: "expense",
        amount: 12550,
        amount_type: "variable",
        account_id: "old_acc_1",
        category_id: "old_cat_1",
        frequency: "weekly",
        start_date: "2026-03-01",
        end_date: null,
        status: "active",
        notes: "",
      },
    ],
    recurring_occurrences: [
      {
        id: "old_occ_1",
        recurring_id: "old_rec_1",
        occurrence_date: "2026-03-01",
        transaction_id: "old_tx_1",
        match_source: "manual",
        match_reason: "Confirmed",
      },
    ],
    recurring_prefs: {
      id: "old_pref_1",
      auto_detect: "on",
      auto_match: "review",
      dismissed_keys: ["pattern:abc"],
    },
    budgets: [
      {
        id: "old_bud_1",
        category_id: "old_cat_1",
        amount: 200000,
        start_month: "2026-01",
        end_month: null,
      },
    ],
  };
}

const samplePreset: CsvPreset = {
  name: "ADCB CSV",
  delimiter: ",",
  header: true,
  skip: 0,
  split: false,
  flip: false,
  decimal: ".",
  dateFormat: "DMY",
  headers: ["Date", "Payee", "Amount"],
  columns: {
    date: { index: 0, name: "Date" },
    payee: { index: 1, name: "Payee" },
    notes: null,
    category: null,
    amount: { index: 2, name: "Amount" },
    debit: null,
    credit: null,
  },
};

test("createBackup produces versioned AED backup excluding ml_examples and ml_settings", () => {
  const backup = createBackup(
    sampleLedger(),
    [samplePreset],
    "2026-03-10T12:00:00.000Z",
  );
  assert.equal(backup.format_version, BACKUP_FORMAT_VERSION);
  assert.equal(backup.currency, "AED");
  assert.deepEqual(backup.excluded, ["ml_examples", "ml_settings"]);
  assert.equal("ml_examples" in (backup.data as Record<string, unknown>), false);
  assert.equal("ml_settings" in (backup.data as Record<string, unknown>), false);
  assert.equal(backup.data.accounts.length, 2);
  assert.equal(backup.data.csv_presets.length, 1);

  const { preview } = parseAndValidateBackup(serializeBackup(backup));
  assert.equal(preview.counts.accounts, 2);
  assert.equal(preview.counts.categories, 2);
  assert.equal(preview.counts.transactions, 2);
  assert.equal(preview.counts.recurring, 1);
  assert.equal(preview.counts.recurringOccurrences, 1);
  assert.equal(preview.counts.budgets, 1);
  assert.equal(preview.counts.csvPresets, 1);
});

test("parseAndValidateBackup rejects invalid schema, floats, size limits, and broken integrity", () => {
  assert.throws(() => parseAndValidateBackup(""), BackupValidationError);
  assert.throws(() => parseAndValidateBackup("{"), BackupValidationError);
  assert.throws(
    () => parseAndValidateBackup("x".repeat(MAX_BACKUP_BYTES + 1)),
    BackupValidationError,
  );

  const base = createBackup(sampleLedger(), [samplePreset]);

  // Unsupported version
  const badVer = structuredClone(base) as unknown as Record<string, unknown>;
  badVer.format_version = 99;
  assert.throws(
    () => parseAndValidateBackup(JSON.stringify(badVer)),
    /format_version/,
  );

  // Non-integer fils
  const floatTx = structuredClone(base);
  floatTx.data.transactions[0].amount = 12.34;
  assert.throws(
    () => parseAndValidateBackup(serializeBackup(floatTx)),
    /integer in fils/,
  );

  // Missing account reference
  const missingAcc = structuredClone(base);
  missingAcc.data.transactions[0].account_id = "nope";
  assert.throws(
    () => parseAndValidateBackup(serializeBackup(missingAcc)),
    /missing account/,
  );

  // Transfer with category
  const badTransfer = structuredClone(base);
  badTransfer.data.transactions[1].category_id = "old_cat_1";
  assert.throws(
    () => parseAndValidateBackup(serializeBackup(badTransfer)),
    /cannot have a category/,
  );

  // Occurrence type mismatch
  const badOcc = structuredClone(base);
  badOcc.data.recurring_occurrences[0].transaction_id = "old_tx_2";
  assert.throws(
    () => parseAndValidateBackup(serializeBackup(badOcc)),
    /links a transfer transaction/,
  );

  // Overlapping budgets
  const overlapBudget = structuredClone(base);
  overlapBudget.data.budgets.push({
    id: "old_bud_2",
    category_id: "old_cat_1",
    amount: 100000,
    start_month: "2026-02",
    end_month: "2026-04",
  });
  assert.throws(
    () => parseAndValidateBackup(serializeBackup(overlapBudget)),
    /overlapping budgets/,
  );
});

test("executeRestore restores into empty demo workspace with remapped IDs", async () => {
  const backup = createBackup(sampleLedger(), [samplePreset]);
  const savedPresets: CsvPreset[] = [];
  let seq = 0;

  assert.equal(isLedgerEmpty(emptyLedger), true);
  const { ledger, result } = await executeRestore({
    backup,
    mode: "empty",
    existingLedger: emptyLedger,
    existingPresets: [],
    presetStore: {
      save: async (p) => {
        savedPresets.push(p);
        return { presets: savedPresets, replaced: false };
      },
    },
    demo: true,
    demoId: () => `new_id_${++seq}`,
  });

  assert.equal(result.accountsCreated, 2);
  assert.equal(result.categoriesCreated, 2);
  assert.equal(result.transactionsCreated, 2);
  assert.equal(result.recurringCreated, 1);
  assert.equal(result.occurrencesCreated, 1);
  assert.equal(result.budgetsCreated, 1);
  assert.equal(result.presetsSaved, 1);

  // All IDs remapped cleanly
  assert.notEqual(ledger.accounts[0].id, "old_acc_1");
  assert.equal(ledger.transactions[0].account_id, ledger.accounts[0].id);
  assert.equal(ledger.transactions[0].category_id, ledger.categories[0].id);
  assert.equal(ledger.transactions[1].to_account_id, ledger.accounts[1].id);
  assert.equal(
    ledger.recurring_occurrences![0].recurring_id,
    ledger.recurring![0].id,
  );
  assert.equal(
    ledger.recurring_occurrences![0].transaction_id,
    ledger.transactions[0].id,
  );
  assert.equal(ledger.budgets![0].category_id, ledger.categories[0].id);
});

test("executeRestore rejects empty mode on non-empty workspace and supports merge + resumability", async () => {
  const existing = sampleLedger();
  const backup = createBackup(sampleLedger(), [samplePreset]);
  // Add an extra identical coffee transaction twice in backup to test multiset dedup
  backup.data.transactions.push(
    {
      id: "old_tx_3",
      type: "expense",
      amount: 1500,
      account_id: "old_acc_1",
      to_account_id: null,
      category_id: "old_cat_1",
      date: "2026-03-05",
      payee: "Coffee",
      notes: "",
    },
    {
      id: "old_tx_4",
      type: "expense",
      amount: 1500,
      account_id: "old_acc_1",
      to_account_id: null,
      category_id: "old_cat_1",
      date: "2026-03-05",
      payee: "Coffee",
      notes: "",
    },
  );

  await assert.rejects(
    () =>
      executeRestore({
        backup,
        mode: "empty",
        existingLedger: existing,
        existingPresets: [samplePreset],
        presetStore: {
          save: async () => ({ presets: [samplePreset], replaced: false }),
        },
        demo: true,
        demoId: () => "x",
      }),
    /not empty/,
  );

  let seq = 0;
  const { ledger: merged, result } = await executeRestore({
    backup,
    mode: "merge",
    existingLedger: existing,
    existingPresets: [samplePreset],
    presetStore: {
      save: async () => ({ presets: [samplePreset], replaced: false }),
    },
    demo: true,
    demoId: () => `merged_${++seq}`,
  });

  // Existing accounts, categories, recurring, budgets, presets, and first 2 txs are skipped/reused
  assert.equal(result.accountsCreated, 0);
  assert.equal(result.categoriesCreated, 0);
  assert.equal(result.transactionsCreated, 2); // both new Coffee transactions
  assert.equal(result.skipped.transactions, 2);
  assert.equal(result.skipped.budgets, 1);
  assert.equal(result.skipped.presets, 1);
  assert.equal(merged.transactions.length, 4);

  // Re-running merge again is idempotent (resumable!)
  const { result: secondRun } = await executeRestore({
    backup,
    mode: "merge",
    existingLedger: merged,
    existingPresets: [samplePreset],
    presetStore: {
      save: async () => ({ presets: [samplePreset], replaced: false }),
    },
    demo: true,
    demoId: () => `merged2_${++seq}`,
  });
  assert.equal(secondRun.transactionsCreated, 0);
  assert.equal(secondRun.skipped.transactions, 4);
});

test("executeRestore batches via PocketBase backend across >100 transactions with ID remapping", async () => {
  const base = sampleLedger();
  base.transactions = Array.from({ length: IMPORT_BATCH_SIZE + 25 }, (_, i) => ({
    id: `old_tx_${i}`,
    type: "expense" as const,
    amount: 1000 + i,
    account_id: "old_acc_1",
    to_account_id: null,
    category_id: "old_cat_1",
    date: "2026-03-01",
    payee: `Merchant ${i}`,
    notes: "",
  }));
  base.recurring_occurrences = [
    {
      id: "old_occ_1",
      recurring_id: "old_rec_1",
      occurrence_date: "2026-03-01",
      transaction_id: "old_tx_120",
    },
  ];
  const backup = createBackup(base, []);

  let seq = 0;
  const batchSizes: number[] = [];
  const mockBackend: RestoreBackend = {
    async save(_table, value) {
      return { ...value, id: `pb_${++seq}` };
    },
    async createMany(_table, values, progress) {
      for (let i = 0; i < values.length; i += IMPORT_BATCH_SIZE) {
        const chunk = values.slice(i, i + IMPORT_BATCH_SIZE);
        batchSizes.push(chunk.length);
        const created = chunk.map((v) => ({ ...v, id: `pb_${++seq}` }));
        progress(i + chunk.length, created);
      }
    },
  };

  const progressUpdates: number[] = [];
  const { ledger, result } = await executeRestore({
    backup,
    mode: "empty",
    existingLedger: emptyLedger,
    existingPresets: [],
    presetStore: {
      save: async () => ({ presets: [], replaced: false }),
    },
    backend: mockBackend,
    demo: false,
    demoId: () => "unused",
    onProgress: (done) => progressUpdates.push(done),
  });

  assert.equal(result.transactionsCreated, IMPORT_BATCH_SIZE + 25);
  assert.ok(batchSizes.includes(100));
  assert.ok(batchSizes.includes(25));
  assert.ok(progressUpdates.length > 0);
  // Occurrence at index 120 must point to the newly minted ID of old_tx_120
  assert.equal(
    ledger.recurring_occurrences![0].transaction_id,
    ledger.transactions[120].id,
  );
});
