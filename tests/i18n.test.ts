import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dir,
  formatLocalizedAed,
  formatLocalizedDate,
  getGlobalLocale,
  MESSAGES,
  setGlobalLocale,
  t,
  type TranslationKey,
} from "../src/i18n.ts";

test("every key in en has a non-empty ar translation", () => {
  const enKeys = Object.keys(MESSAGES.en) as TranslationKey[];
  const arKeys = Object.keys(MESSAGES.ar) as TranslationKey[];

  assert.equal(
    arKeys.length,
    enKeys.length,
    "ar and en dictionaries must have the same number of keys",
  );

  for (const key of enKeys) {
    const enVal = MESSAGES.en[key];
    const arVal = MESSAGES.ar[key];
    assert.equal(typeof enVal, "string", `en key ${key} must be a string`);
    assert.ok(enVal.trim().length > 0, `en key ${key} must be non-empty`);
    assert.equal(typeof arVal, "string", `ar key ${key} must be a string`);
    assert.ok(arVal.trim().length > 0, `ar key ${key} must be non-empty`);
  }
});

test("dir helper returns rtl for ar and ltr for en", () => {
  assert.equal(dir("ar"), "rtl");
  assert.equal(dir("en"), "ltr");
});

test("t() supports variable interpolation in en and ar", () => {
  assert.equal(
    t("overview.acrossAccounts", { count: 5 }, "en"),
    "Across 5 accounts",
  );
  assert.equal(
    t("overview.acrossAccounts", { count: 5 }, "ar"),
    "عبر 5 حسابات",
  );
  assert.equal(t("common.selectedCount", { count: 3 }, "en"), "3 selected");
  assert.equal(t("common.selectedCount", { count: 3 }, "ar"), "تم تحديد 3");
});

test("setGlobalLocale updates default locale for t()", () => {
  const prev = getGlobalLocale();
  try {
    setGlobalLocale("ar");
    assert.equal(getGlobalLocale(), "ar");
    assert.equal(t("nav.Overview"), "نظرة عامة");

    setGlobalLocale("en");
    assert.equal(getGlobalLocale(), "en");
    assert.equal(t("nav.Overview"), "Overview");
  } finally {
    setGlobalLocale(prev);
  }
});

test("formatLocalizedAed formats fils in en-AE and ar-AE", () => {
  const enFormatted = formatLocalizedAed(12345, "en");
  assert.match(enFormatted, /AED/);
  assert.match(enFormatted, /123\.45/);

  const arFormatted = formatLocalizedAed(12345, "ar");
  assert.ok(arFormatted.length > 0);
  assert.notEqual(arFormatted, enFormatted);
});

test("formatLocalizedDate formats ISO dates in en and ar", () => {
  const enDate = formatLocalizedDate("2026-03-15", "en");
  assert.match(enDate, /2026/);
  assert.match(enDate, /15/);

  const arDate = formatLocalizedDate("2026-03-15", "ar");
  assert.ok(arDate.length > 0);
  assert.notEqual(arDate, enDate);
});
