import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, previewCsv } from "../src/csv.ts";
import {
  buildPreset,
  savePreset,
  loadPresets,
  renamePreset,
  deletePreset,
  validatePresetName,
  resolvePreset,
  suggestPreset,
  PRESET_STORAGE_KEY,
  MAX_PRESET_NAME_LENGTH,
  MAX_PRESET_SKIP,
  type PresetStorage,
} from "../src/csvPresets.ts";

function createMockStorage(
  initial?: Record<string, string>,
): PresetStorage & { map: Map<string, string> } {
  const map = new Map<string, string>(
    initial ? Object.entries(initial) : undefined,
  );
  return {
    map,
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

const sampleLedger = {
  accounts: [
    {
      id: "acc_1",
      name: "Checking",
      type: "current" as const,
      opening_balance: 0,
      opening_date: "2020-01-01",
      color: "",
    },
  ],
  categories: [],
  transactions: [],
};

const validPresetInput = {
  name: "Standard Bank",
  delimiter: "," as const,
  header: true,
  skip: 0,
  firstRow: ["Date", "Payee", "Amount", "Notes"],
  options: {
    date: 0,
    payee: 1,
    amount: 2,
    notes: 3,
    category: -1,
    debit: -1,
    credit: -1,
    split: false,
    flip: false,
    decimal: "." as const,
    dateFormat: "DMY" as const,
  },
};

test("save and load round trip persists format, updates memory, and supports replace", () => {
  const storage = createMockStorage();
  const preset = buildPreset(validPresetInput);

  assert.equal("account" in (preset as Record<string, unknown>), false);
  assert.equal("transfers" in (preset as Record<string, unknown>), false);

  const saveResult = savePreset(storage, preset);
  assert.equal(saveResult.persisted, true);
  assert.equal(saveResult.replaced, false);
  assert.equal(saveResult.presets.length, 1);
  assert.equal(saveResult.presets[0].name, "Standard Bank");

  const rawStorage = storage.getItem(PRESET_STORAGE_KEY);
  assert.ok(rawStorage);
  const parsedStorage = JSON.parse(rawStorage);
  assert.equal(parsedStorage.version, 1);
  assert.equal(parsedStorage.presets.length, 1);

  const loaded = loadPresets(storage);
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0], preset);
  assert.deepEqual(loaded[0].headers, ["Date", "Payee", "Amount", "Notes"]);
  assert.equal(loaded[0].columns.date?.index, 0);
  assert.equal(loaded[0].columns.date?.name, "Date");
  assert.equal(loaded[0].columns.amount?.index, 2);
  assert.equal(loaded[0].columns.category, null);

  const secondPreset = buildPreset({
    ...validPresetInput,
    name: "Second Bank",
    firstRow: ["TxDate", "Description", "Value"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 1,
      amount: 2,
      notes: -1,
    },
  });
  const saveSecondResult = savePreset(storage, secondPreset);
  assert.equal(saveSecondResult.persisted, true);
  assert.equal(saveSecondResult.replaced, false);
  assert.equal(saveSecondResult.presets.length, 2);
  assert.equal(loadPresets(storage).length, 2);

  const updatedFirstPreset = buildPreset({
    ...validPresetInput,
    name: "  Standard Bank  ",
    options: {
      ...validPresetInput.options,
      flip: true,
    },
  });
  const replaceResult = savePreset(storage, updatedFirstPreset);
  assert.equal(replaceResult.persisted, true);
  assert.equal(replaceResult.replaced, true);
  assert.equal(replaceResult.presets.length, 2);

  const reloaded = loadPresets(storage);
  assert.equal(reloaded.length, 2);
  assert.equal(reloaded[0].name, "Standard Bank");
  assert.equal(reloaded[0].flip, true);
});

test("buildPreset captures decimal and dateFormat options and drops out-of-range columns", () => {
  const commaMdyPreset = buildPreset({
    ...validPresetInput,
    name: "European MDY",
    options: {
      ...validPresetInput.options,
      decimal: ",",
      dateFormat: "MDY",
    },
  });
  assert.equal(commaMdyPreset.decimal, ",");
  assert.equal(commaMdyPreset.dateFormat, "MDY");

  const ymdPreset = buildPreset({
    ...validPresetInput,
    name: "YMD Preset",
    options: {
      ...validPresetInput.options,
      dateFormat: "YMD",
    },
  });
  assert.equal(ymdPreset.decimal, ".");
  assert.equal(ymdPreset.dateFormat, "YMD");

  const droppedColumnsPreset = buildPreset({
    ...validPresetInput,
    firstRow: ["Date", "Amount"],
    options: {
      ...validPresetInput.options,
      date: 0,
      amount: 1,
      payee: 2,
      notes: 5,
    },
  });
  assert.deepEqual(droppedColumnsPreset.columns.date, {
    index: 0,
    name: "Date",
  });
  assert.deepEqual(droppedColumnsPreset.columns.amount, {
    index: 1,
    name: "Amount",
  });
  assert.equal(droppedColumnsPreset.columns.payee, null);
  assert.equal(droppedColumnsPreset.columns.notes, null);
});

test("storage unavailable or throwing operations report persisted: false without mutating stored presets", () => {
  const preset = buildPreset(validPresetInput);

  assert.deepEqual(loadPresets(null), []);
  assert.deepEqual(loadPresets(undefined), []);

  const nullStorageSave = savePreset(null, preset);
  assert.equal(nullStorageSave.persisted, false);
  assert.deepEqual(nullStorageSave.presets, []);

  const nullStorageDelete = deletePreset(null, "Standard Bank");
  assert.equal(nullStorageDelete.persisted, false);
  assert.deepEqual(nullStorageDelete.presets, []);

  assert.throws(
    () => renamePreset(null, "Standard Bank", "Renamed Bank"),
    /Preset not found\./,
  );

  const throwingGetStorage: PresetStorage = {
    getItem() {
      throw new Error("Disk read failure");
    },
    setItem() {},
  };
  assert.deepEqual(loadPresets(throwingGetStorage), []);

  const backingStore = new Map<string, string>();
  backingStore.set(
    PRESET_STORAGE_KEY,
    JSON.stringify({ version: 1, presets: [preset] }),
  );
  let shouldThrow = false;
  const throwingSetStorage: PresetStorage = {
    getItem(key) {
      return backingStore.get(key) ?? null;
    },
    setItem(key, value) {
      if (shouldThrow) {
        throw new Error("QuotaExceededError");
      }
      backingStore.set(key, value);
    },
  };

  shouldThrow = true;
  const secondPreset = buildPreset({
    ...validPresetInput,
    name: "Second Bank",
  });
  const saveFailed = savePreset(throwingSetStorage, secondPreset);
  assert.equal(saveFailed.persisted, false);
  assert.equal(saveFailed.presets.length, 1);
  assert.equal(saveFailed.presets[0].name, "Standard Bank");
  assert.equal(loadPresets(throwingSetStorage).length, 1);

  const renameFailed = renamePreset(
    throwingSetStorage,
    "Standard Bank",
    "New Name",
  );
  assert.equal(renameFailed.persisted, false);
  assert.equal(renameFailed.presets.length, 1);
  assert.equal(renameFailed.presets[0].name, "Standard Bank");
  assert.equal(loadPresets(throwingSetStorage)[0].name, "Standard Bank");

  const deleteFailed = deletePreset(throwingSetStorage, "Standard Bank");
  assert.equal(deleteFailed.persisted, false);
  assert.equal(deleteFailed.presets.length, 1);
  assert.equal(deleteFailed.presets[0].name, "Standard Bank");
  assert.equal(loadPresets(throwingSetStorage).length, 1);
});

test("storage with bad JSON or wrong shape returns empty presets", () => {
  const corruptJsonStorage = createMockStorage({
    [PRESET_STORAGE_KEY]: "{ unclosed json",
  });
  assert.deepEqual(loadPresets(corruptJsonStorage), []);

  const invalidShapes = [
    "plain string",
    "123",
    "true",
    "null",
    "[]",
    JSON.stringify({ version: 2, presets: [] }),
    JSON.stringify({ version: "1", presets: [] }),
    JSON.stringify({ version: 1, presets: "not-an-array" }),
    JSON.stringify({ version: 1, presets: null }),
    JSON.stringify({ presets: [] }),
    JSON.stringify({ version: 1 }),
  ];

  for (const raw of invalidShapes) {
    const storage = createMockStorage({ [PRESET_STORAGE_KEY]: raw });
    assert.deepEqual(loadPresets(storage), []);
  }
});

test("invalid individual presets are dropped while valid ones survive, deduplicating case-insensitively", () => {
  const validPreset1 = buildPreset(validPresetInput);
  const validPreset2 = buildPreset({
    ...validPresetInput,
    name: "Valid Second",
    firstRow: ["D", "P", "A"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 1,
      amount: 2,
      notes: -1,
    },
  });

  const rawPresets = [
    validPreset1,
    null,
    "not-an-object",
    { ...validPreset1, name: "" },
    { ...validPreset1, name: "   " },
    { ...validPreset1, name: "A".repeat(MAX_PRESET_NAME_LENGTH + 1) },
    { ...validPreset1, delimiter: "/" },
    { ...validPreset1, header: "true" },
    { ...validPreset1, skip: -1 },
    { ...validPreset1, skip: 1.5 },
    { ...validPreset1, skip: MAX_PRESET_SKIP + 1 },
    { ...validPreset1, split: 1 },
    { ...validPreset1, flip: "false" },
    { ...validPreset1, decimal: "x" },
    { ...validPreset1, dateFormat: "YDM" },
    { ...validPreset1, headers: "Date,Payee,Amount" },
    { ...validPreset1, headers: [123] },
    { ...validPreset1, columns: null },
    {
      ...validPreset1,
      columns: {
        ...validPreset1.columns,
        date: { index: -1, name: "Date" },
      },
    },
    {
      ...validPreset1,
      columns: {
        ...validPreset1.columns,
        date: { index: 1.5, name: "Date" },
      },
    },
    {
      ...validPreset1,
      columns: {
        ...validPreset1.columns,
        date: { index: 0, name: 123 },
      },
    },
    {
      ...validPreset1,
      columns: {
        ...validPreset1.columns,
        amount: "column 2",
      },
    },
    validPreset2,
    {
      ...validPreset2,
      name: "valid second",
    },
    {
      ...validPreset1,
      name: "  STANDARD BANK  ",
    },
  ];

  const storage = createMockStorage({
    [PRESET_STORAGE_KEY]: JSON.stringify({ version: 1, presets: rawPresets }),
  });

  const loaded = loadPresets(storage);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].name, "Standard Bank");
  assert.equal(loaded[1].name, "Valid Second");
});

test("re-read before write preserves presets written by another tab", () => {
  const storage = createMockStorage();

  const tab1Preset = buildPreset({
    ...validPresetInput,
    name: "Tab 1 Preset",
  });
  savePreset(storage, tab1Preset);
  assert.equal(loadPresets(storage).length, 1);

  const tab2Preset = buildPreset({
    ...validPresetInput,
    name: "Tab 2 Preset",
  });
  const tab2DirectWrite = {
    version: 1,
    presets: [...loadPresets(storage), tab2Preset],
  };
  storage.setItem(PRESET_STORAGE_KEY, JSON.stringify(tab2DirectWrite));
  assert.equal(loadPresets(storage).length, 2);

  const tab1AnotherPreset = buildPreset({
    ...validPresetInput,
    name: "Tab 1 Followup",
  });
  const tab1Result = savePreset(storage, tab1AnotherPreset);

  assert.equal(tab1Result.persisted, true);
  assert.equal(tab1Result.presets.length, 3);
  const names = tab1Result.presets.map((p) => p.name);
  assert.deepEqual(names, ["Tab 1 Preset", "Tab 2 Preset", "Tab 1 Followup"]);

  const reloaded = loadPresets(storage);
  assert.deepEqual(
    reloaded.map((p) => p.name),
    ["Tab 1 Preset", "Tab 2 Preset", "Tab 1 Followup"],
  );

  const tab2ThirdPreset = buildPreset({
    ...validPresetInput,
    name: "Tab 2 Concurrent Delete Target",
  });
  storage.setItem(
    PRESET_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      presets: [...loadPresets(storage), tab2ThirdPreset],
    }),
  );

  const renameResult = renamePreset(
    storage,
    "Tab 1 Followup",
    "Tab 1 Followup Renamed",
  );
  assert.ok(
    renameResult.presets.some(
      (p) => p.name === "Tab 2 Concurrent Delete Target",
    ),
  );

  const deleteResult = deletePreset(storage, "Tab 2 Concurrent Delete Target");
  assert.equal(
    deleteResult.presets.some(
      (p) => p.name === "Tab 2 Concurrent Delete Target",
    ),
    false,
  );
  assert.equal(
    deleteResult.presets.some((p) => p.name === "Tab 1 Preset"),
    true,
  );
});

test("preset name validation enforces length, uniqueness, and exclusion rules", () => {
  const existing = [buildPreset(validPresetInput)];

  assert.equal(validatePresetName(""), "Enter a preset name.");
  assert.equal(validatePresetName("   "), "Enter a preset name.");

  const tooLong = "A".repeat(MAX_PRESET_NAME_LENGTH + 1);
  const tooLongError = validatePresetName(tooLong);
  assert.ok(tooLongError && tooLongError.includes("80"));

  const exactLimit = "A".repeat(MAX_PRESET_NAME_LENGTH);
  assert.equal(validatePresetName(exactLimit), null);

  assert.equal(
    validatePresetName("standard bank", existing),
    "A preset with this name already exists.",
  );
  assert.equal(
    validatePresetName("  STANDARD BANK  ", existing),
    "A preset with this name already exists.",
  );

  assert.equal(
    validatePresetName("Standard Bank", existing, {
      excludeName: "standard bank",
    }),
    null,
  );
  assert.equal(
    validatePresetName("Standard Bank", existing, {
      excludeName: "Other Bank",
    }),
    "A preset with this name already exists.",
  );

  assert.equal(validatePresetName("Unique New Bank", existing), null);
});

test("resolve preset by name after columns are reordered in CSV header", () => {
  const preset = buildPreset(validPresetInput);
  const reorderedCsv =
    "Notes,Amount,Payee,Date\nGrocery receipt,125.50,Carrefour,02/03/2026\n";

  const resolved = resolvePreset(preset, reorderedCsv);
  assert.equal(resolved.missing.length, 0);
  assert.equal(resolved.options.notes, 0);
  assert.equal(resolved.options.amount, 1);
  assert.equal(resolved.options.payee, 2);
  assert.equal(resolved.options.date, 3);
  assert.equal(resolved.options.category, -1);
});

test("resolvePreset resolves all options for non-default delimiter, skip, split, flip, decimal, and dateFormat", () => {
  const nonDefaultPreset = buildPreset({
    name: "European Semicolon Split",
    delimiter: ";",
    header: true,
    skip: 1,
    firstRow: [
      "TxDate",
      "PayeeDesc",
      "NotesField",
      "Tag",
      "DebitVal",
      "CreditVal",
    ],
    options: {
      date: 0,
      payee: 1,
      notes: 2,
      category: 3,
      amount: -1,
      debit: 4,
      credit: 5,
      split: true,
      flip: true,
      decimal: ",",
      dateFormat: "MDY",
    },
  });

  const csvText = [
    "Export metadata; generated on 2026-03-01",
    "TxDate;PayeeDesc;NotesField;Tag;DebitVal;CreditVal",
    "02/28/2026;Market;Groceries;Food;54,20;;",
  ].join("\r\n");

  const resolved = resolvePreset(nonDefaultPreset, csvText);

  assert.equal(resolved.missing.length, 0);
  assert.deepEqual(resolved.options, {
    date: 0,
    payee: 1,
    notes: 2,
    category: 3,
    amount: -1,
    debit: 4,
    credit: 5,
    split: true,
    flip: true,
    decimal: ",",
    dateFormat: "MDY",
  });
});

test("renamed column is reported missing and NEVER falls back to saved index", () => {
  const preset = buildPreset(validPresetInput);
  const renamedCsv =
    "Transaction Date,Payee,Balance,Notes\n02/03/2026,Carrefour,5000.00,Grocery receipt\n";

  const resolved = resolvePreset(preset, renamedCsv);
  assert.equal(resolved.options.date, -1);
  assert.equal(resolved.options.payee, 1);
  assert.equal(resolved.options.amount, -1);
  assert.equal(resolved.options.notes, 3);

  assert.equal(resolved.missing.length, 2);
  assert.deepEqual(resolved.missing[0], {
    field: "date",
    label: "Date",
    savedName: "Date",
  });
  assert.deepEqual(resolved.missing[1], {
    field: "amount",
    label: "Amount",
    savedName: "Amount",
  });
});

test("duplicate header names resolve when saved index matches and report missing when ambiguous", () => {
  const preset = buildPreset(validPresetInput);

  const matchingSavedIndexCsv =
    "Date,Payee,Payee,Notes\n01/01/2026,Shop A,Shop B,Note 1\n";
  const matchingResolved = resolvePreset(preset, matchingSavedIndexCsv);
  assert.equal(matchingResolved.options.date, 0);
  assert.equal(matchingResolved.options.payee, 1);
  assert.equal(matchingResolved.options.amount, -1);
  assert.equal(
    matchingResolved.missing.some((m) => m.field === "payee"),
    false,
  );
  assert.equal(
    matchingResolved.missing.some((m) => m.field === "amount"),
    true,
  );

  const ambiguousPreset = buildPreset({
    ...validPresetInput,
    firstRow: ["Unrelated", "Date", "Payee", "Amount"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 2,
      amount: 3,
    },
  });
  ambiguousPreset.columns.date = { index: 0, name: "Date" };

  const ambiguousCsv =
    "Header 1,Date,Date,Amount\nX,01/01/2026,01/01/2026,100\n";
  const ambiguousResolved = resolvePreset(ambiguousPreset, ambiguousCsv);
  assert.equal(ambiguousResolved.options.date, -1);
  assert.ok(ambiguousResolved.missing.some((m) => m.field === "date"));
});

test("header:false resolves strictly by index and flags out-of-range columns", () => {
  const noHeaderPreset = buildPreset({
    ...validPresetInput,
    header: false,
    firstRow: ["01/01/2026", "Store", "100.00", "Coffee", "Extra"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 1,
      amount: 2,
      notes: 4,
    },
  });

  const fullRowCsv = "02/02/2026,Bakery,45.00,Bread,Breakfast\n";
  const fullResolved = resolvePreset(noHeaderPreset, fullRowCsv);
  assert.equal(fullResolved.missing.length, 0);
  assert.equal(fullResolved.options.date, 0);
  assert.equal(fullResolved.options.payee, 1);
  assert.equal(fullResolved.options.amount, 2);
  assert.equal(fullResolved.options.notes, 4);

  const shortRowCsv = "02/02/2026,Bakery,45.00\n";
  const shortResolved = resolvePreset(noHeaderPreset, shortRowCsv);
  assert.equal(shortResolved.options.date, 0);
  assert.equal(shortResolved.options.payee, 1);
  assert.equal(shortResolved.options.amount, 2);
  assert.equal(shortResolved.options.notes, -1);

  assert.equal(shortResolved.missing.length, 1);
  assert.deepEqual(shortResolved.missing[0], {
    field: "notes",
    label: "Notes",
    savedName: "Column 5",
  });
});

test("missing-column reporting respects split vs non-split mode and skips unmapped fields", () => {
  const nonSplitPreset = buildPreset({
    ...validPresetInput,
    firstRow: ["Date", "Payee", "Amount", "Debit", "Credit"],
    options: {
      ...validPresetInput.options,
      split: false,
      date: 0,
      payee: 1,
      amount: 2,
      debit: 3,
      credit: 4,
      notes: -1,
      category: -1,
    },
  });

  const nonSplitCsv = "Date,Payee\n01/01/2026,Store\n";
  const nonSplitResolved = resolvePreset(nonSplitPreset, nonSplitCsv);
  assert.equal(nonSplitResolved.options.date, 0);
  assert.equal(nonSplitResolved.options.payee, 1);
  assert.equal(nonSplitResolved.options.amount, -1);
  assert.equal(nonSplitResolved.missing.length, 1);
  assert.equal(nonSplitResolved.missing[0].field, "amount");

  const splitPreset = buildPreset({
    ...validPresetInput,
    firstRow: ["Date", "Payee", "Debit", "Credit", "Amount"],
    options: {
      ...validPresetInput.options,
      split: true,
      date: 0,
      payee: 1,
      debit: 2,
      credit: 3,
      amount: 4,
      notes: -1,
      category: -1,
    },
  });

  const splitCsv = "Date,Payee\n01/01/2026,Store\n";
  const splitResolved = resolvePreset(splitPreset, splitCsv);
  assert.equal(splitResolved.options.date, 0);
  assert.equal(splitResolved.options.payee, 1);
  assert.equal(splitResolved.options.debit, -1);
  assert.equal(splitResolved.options.credit, -1);
  assert.equal(splitResolved.options.amount, -1);
  const missingFields = splitResolved.missing.map((m) => m.field);
  assert.deepEqual(missingFields.sort(), ["credit", "debit"]);
});

test("malformed CSV quoting and skip past EOF do not crash resolution", () => {
  const preset = buildPreset(validPresetInput);

  const brokenCsv = 'Date,Payee,Amount,Notes\n"unclosed quote line';
  const brokenResolved = resolvePreset(preset, brokenCsv);
  assert.equal(brokenResolved.options.date, -1);
  assert.equal(brokenResolved.options.payee, -1);
  assert.equal(brokenResolved.options.amount, -1);
  assert.equal(brokenResolved.options.notes, -1);
  assert.equal(brokenResolved.missing.length, 4);

  const pastEofPreset = buildPreset({
    ...validPresetInput,
    skip: 10,
  });
  const shortCsv = "Date,Payee,Amount,Notes\n01/01/2026,Shop,10,Gift\n";
  const pastEofResolved = resolvePreset(pastEofPreset, shortCsv);
  assert.equal(pastEofResolved.options.date, -1);
  assert.equal(pastEofResolved.missing.length, 4);

  const emptyResolved = resolvePreset(preset, "");
  assert.equal(emptyResolved.options.date, -1);
  assert.equal(emptyResolved.missing.length, 4);
});

test("suggestPreset returns null for empty inputs, unheadered presets, or partial header sets", () => {
  const presetComma = buildPreset({
    ...validPresetInput,
    name: "Comma Preset",
    firstRow: ["Date", "Payee", "Amount"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 1,
      amount: 2,
      notes: -1,
    },
  });

  const presetNoHeader = buildPreset({
    ...validPresetInput,
    name: "No Header Preset",
    header: false,
    firstRow: ["01/01/2026", "Store", "100"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 1,
      amount: 2,
      notes: -1,
    },
  });

  assert.equal(suggestPreset([], "Date,Payee,Amount\n"), null);
  assert.equal(suggestPreset([presetComma], ""), null);
  assert.equal(suggestPreset([presetNoHeader], "01/01/2026,Store,100\n"), null);
  assert.equal(
    suggestPreset([presetComma], "Date,Payee\n01/01/2026,Store\n"),
    null,
  );
  assert.equal(
    suggestPreset(
      [presetComma],
      "Date,Payee,Amount,Extra\n01/01/2026,Store,10,Y\n",
    ),
    null,
  );
});

test("suggestPreset matches case-insensitively and regardless of header order", () => {
  const presetComma = buildPreset({
    ...validPresetInput,
    name: "Comma Preset",
    firstRow: ["Date", "Payee", "Amount"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 1,
      amount: 2,
      notes: -1,
    },
  });

  const reorderedCsv = "  AMOUNT , date , PAYEE \n100,01/01/2026,Store\n";
  const suggestedReordered = suggestPreset([presetComma], reorderedCsv);
  assert.equal(suggestedReordered?.name, "Comma Preset");
});

test("suggestPreset uses each preset's delimiter and skip, isolating parse errors per preset", () => {
  const presetComma = buildPreset({
    ...validPresetInput,
    name: "Comma Preset",
    firstRow: ["Date", "Payee", "Amount"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 1,
      amount: 2,
      notes: -1,
    },
  });

  const presetSemicolon = buildPreset({
    ...validPresetInput,
    name: "Semicolon Skip 1",
    delimiter: ";",
    skip: 1,
    firstRow: ["Date", "Payee", "Amount"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 1,
      amount: 2,
      notes: -1,
    },
  });

  const semicolonCsv =
    "Report exported on 2026-03-01\nDate;Payee;Amount\n01/01/2026;Store;50\n";
  const suggestedSemicolon = suggestPreset(
    [presetComma, presetSemicolon],
    semicolonCsv,
  );
  assert.equal(suggestedSemicolon?.name, "Semicolon Skip 1");

  // Comma parser throws on unclosed quote after non-delimiter `;`, while semicolon parser succeeds!
  const throwsUnderCommaValidUnderSemicolon =
    'Report;"Note";Summary\nDate;Payee;Amount\n01/01/2026;Store;10\n';
  assert.throws(() => parseCsv(throwsUnderCommaValidUnderSemicolon, ","));
  const suggestedDespiteError = suggestPreset(
    [presetComma, presetSemicolon],
    throwsUnderCommaValidUnderSemicolon,
  );
  assert.equal(suggestedDespiteError?.name, "Semicolon Skip 1");
});

test("suggestPreset prefers exact-order match over reordered multiset match", () => {
  const presetComma = buildPreset({
    ...validPresetInput,
    name: "Comma Exact",
    firstRow: ["Date", "Payee", "Amount"],
    options: {
      ...validPresetInput.options,
      date: 0,
      payee: 1,
      amount: 2,
      notes: -1,
    },
  });

  const presetReordered = buildPreset({
    ...validPresetInput,
    name: "Reordered Preset",
    firstRow: ["Amount", "Payee", "Date"],
    options: {
      ...validPresetInput.options,
      amount: 0,
      payee: 1,
      date: 2,
      notes: -1,
    },
  });

  const exactOrderCsv = "Date,Payee,Amount\n01/01/2026,Store,10\n";
  const suggestedExact = suggestPreset(
    [presetReordered, presetComma],
    exactOrderCsv,
  );
  assert.equal(suggestedExact?.name, "Comma Exact");

  const multisetOnlyCsv = "Payee,Date,Amount\nStore,01/01/2026,10\n";
  const suggestedFirstMultiset = suggestPreset(
    [presetReordered, presetComma],
    multisetOnlyCsv,
  );
  assert.equal(suggestedFirstMultiset?.name, "Reordered Preset");
});

test("suggestPreset rejects header multiset when column multiplicities differ", () => {
  const presetAmountAmount = buildPreset({
    ...validPresetInput,
    name: "Amount Twice",
    firstRow: ["Date", "Amount", "Amount"],
    options: {
      ...validPresetInput.options,
      date: 0,
      amount: 1,
      payee: -1,
      notes: -1,
    },
  });

  const csvDateDateAmount = "Date,Date,Amount\n01/01/2026,01/01/2026,100\n";
  assert.equal(suggestPreset([presetAmountAmount], csvDateDateAmount), null);
});

test("previewCsv regression: missing amount column produces actionable error on every row and no transactions", () => {
  const preset = buildPreset(validPresetInput);
  const csvWithMissingAmount =
    "Date,Payee,Total,Notes\n01/02/2026,Carrefour,120.00,Lunch\n02/02/2026,Gas Station,50.00,Fuel\n";

  const resolved = resolvePreset(preset, csvWithMissingAmount);
  assert.equal(resolved.options.amount, -1);
  assert.ok(resolved.missing.some((m) => m.field === "amount"));

  const allRows = parseCsv(csvWithMissingAmount, preset.delimiter);
  const dataRows = allRows.slice(preset.skip + (preset.header ? 1 : 0));
  assert.equal(dataRows.length, 2);

  const preview = previewCsv(
    dataRows,
    { ...resolved.options, account: "acc_1" },
    sampleLedger,
  );

  assert.equal(preview.length, 2);
  for (const row of preview) {
    assert.equal(row.transaction, null);
    assert.equal(row.duplicate, false);
    assert.equal(row.error, "Map the date and amount columns.");
  }
});

test("resolving or building presets never includes account or transfers", () => {
  const inputWithOptions = {
    ...validPresetInput,
    options: {
      ...validPresetInput.options,
      account: "acc_ignored",
      transfers: { 0: "acc_dest" },
    } as typeof validPresetInput.options,
  };

  const preset = buildPreset(inputWithOptions);
  assert.equal("account" in preset, false);
  assert.equal("transfers" in preset, false);

  const resolved = resolvePreset(
    preset,
    "Date,Payee,Amount,Notes\n01/01/2026,Shop,10,Note\n",
  );
  assert.equal("account" in resolved.options, false);
  assert.equal("transfers" in resolved.options, false);
});
