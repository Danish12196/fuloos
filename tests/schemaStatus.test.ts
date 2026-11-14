import assert from "node:assert/strict";
import test from "node:test";
import { MissingCollectionError } from "../src/backend.ts";
import {
  EXPECTED_COLLECTIONS,
  checkSchemaStatus,
  collectionName,
  formatMissingCollections,
  summarizeSchemaStatus,
} from "../src/schemaStatus.ts";

test("summarizeSchemaStatus reports ok when all collections exist", () => {
  const status = summarizeSchemaStatus(
    EXPECTED_COLLECTIONS.map((table) => ({ table, exists: true })),
  );
  assert.equal(status.checked, true);
  assert.equal(status.ok, true);
  assert.deepEqual(status.missing, []);
});

test("summarizeSchemaStatus lists missing fuloos_* collections", () => {
  const status = summarizeSchemaStatus([
    { table: "accounts", exists: true },
    { table: "budgets", exists: false },
    { table: "ml_settings", exists: false },
  ]);
  assert.equal(status.checked, true);
  assert.equal(status.ok, false);
  assert.deepEqual(status.missing, ["fuloos_budgets", "fuloos_ml_settings"]);
});

test("formatMissingCollections truncates lists longer than 3", () => {
  assert.equal(formatMissingCollections([]), "");
  assert.equal(
    formatMissingCollections(["fuloos_budgets", "fuloos_ml_settings"]),
    "fuloos_budgets, fuloos_ml_settings",
  );
  assert.equal(
    formatMissingCollections([
      "fuloos_a",
      "fuloos_b",
      "fuloos_c",
      "fuloos_d",
      "fuloos_e",
    ]),
    "fuloos_a, fuloos_b, fuloos_c (+2 more)",
  );
});

test("checkSchemaStatus catches MissingCollectionError and reports missing tables", async () => {
  const status = await checkSchemaStatus(
    async (table) => {
      if (table === "budgets") {
        throw new MissingCollectionError("Not found", 404);
      }
      return table !== "csv_presets";
    },
    ["accounts", "budgets", "csv_presets"],
  );
  assert.equal(status.checked, true);
  assert.equal(status.ok, false);
  assert.deepEqual(status.missing, ["fuloos_budgets", "fuloos_csv_presets"]);
});

test("checkSchemaStatus returns unchecked ok on unexpected network error", async () => {
  const status = await checkSchemaStatus(
    async () => {
      throw new Error("Network error");
    },
    ["accounts", "budgets"],
  );
  assert.equal(status.checked, false);
  assert.equal(status.ok, true);
  assert.deepEqual(status.missing, []);
});

test("collectionName prefixes fuloos_", () => {
  assert.equal(collectionName("transactions"), "fuloos_transactions");
});
