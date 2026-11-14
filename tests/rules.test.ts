import assert from "node:assert/strict";
import test from "node:test";
import type { Category, TransactionRule } from "../src/domain.ts";
import {
  applyRules,
  isSafeRegexPattern,
  matchesRule,
  sortRules,
  validateRule,
} from "../src/rules.ts";

const categories: Category[] = [
  { id: "cat_food", name: "Groceries", description: "", color: "#1d5b48" },
  { id: "cat_util", name: "Utilities", description: "", color: "#696198" },
];

function makeRule(overrides: Partial<TransactionRule> = {}): TransactionRule {
  return {
    id: "r1",
    name: "Carrefour rule",
    enabled: true,
    priority: 10,
    match_field: "payee",
    match_type: "contains",
    pattern: "carrefour",
    min_amount: null,
    max_amount: null,
    set_category_id: "cat_food",
    add_tags: ["groceries"],
    set_payee: "",
    ...overrides,
  };
}

test("isSafeRegexPattern allows safe regexes and blocks ReDoS / invalid patterns", () => {
  assert.equal(isSafeRegexPattern("^carrefour|spinneys$").ok, true);
  assert.equal(isSafeRegexPattern("").ok, false);
  assert.equal(isSafeRegexPattern("a".repeat(121)).ok, false);
  assert.equal(isSafeRegexPattern("(a+)+").ok, false);
  assert.equal(isSafeRegexPattern("([a-z]+)*").ok, false);
  assert.equal(isSafeRegexPattern("(a)\\1").ok, false);
  assert.equal(isSafeRegexPattern("[unclosed").ok, false);
});

test("validateRule validates fields, bounds, category, and actions", () => {
  assert.doesNotThrow(() => validateRule(makeRule(), categories));
  assert.throws(() => validateRule(makeRule({ name: "" }), categories), /Rule name/);
  assert.throws(() => validateRule(makeRule({ priority: -1 }), categories), /Priority/);
  assert.throws(
    () =>
      validateRule(
        makeRule({ match_type: "regex", pattern: "(a+)+" }),
        categories,
      ),
    /Nested quantifiers/,
  );
  assert.throws(
    () =>
      validateRule(
        makeRule({ min_amount: 5000, max_amount: 1000 }),
        categories,
      ),
    /Minimum amount cannot exceed/,
  );
  assert.throws(
    () => validateRule(makeRule({ set_category_id: "missing" }), categories),
    /does not exist/,
  );
  assert.throws(
    () =>
      validateRule(
        makeRule({ set_category_id: null, add_tags: [], set_payee: "" }),
        categories,
      ),
    /at least one action/,
  );
});

test("matchesRule supports contains, starts_with, exact, regex, fields, and amount bounds", () => {
  const containsRule = makeRule({ match_type: "contains", pattern: "carrefour" });
  assert.equal(matchesRule(containsRule, { payee: "CARREFOUR MOE", amount: 5000 }), true);
  assert.equal(matchesRule(containsRule, { payee: "Spinneys", amount: 5000 }), false);

  const startsRule = makeRule({ match_type: "starts_with", pattern: "dewa" });
  assert.equal(matchesRule(startsRule, { payee: "DEWA Bill", amount: 5000 }), true);
  assert.equal(matchesRule(startsRule, { payee: "My DEWA", amount: 5000 }), false);

  const exactRule = makeRule({ match_type: "exact", pattern: "Netflix" });
  assert.equal(matchesRule(exactRule, { payee: "  netflix ", amount: 5000 }), true);
  assert.equal(matchesRule(exactRule, { payee: "Netflix UAE", amount: 5000 }), false);

  const notesRegexRule = makeRule({
    match_field: "notes",
    match_type: "regex",
    pattern: "inv-\\d+",
  });
  assert.equal(
    matchesRule(notesRegexRule, { payee: "Vendor", notes: "Paid INV-421", amount: 100 }),
    true,
  );

  const boundedRule = makeRule({ min_amount: 1000, max_amount: 5000 });
  assert.equal(matchesRule(boundedRule, { payee: "Carrefour", amount: 999 }), false);
  assert.equal(matchesRule(boundedRule, { payee: "Carrefour", amount: 2500 }), true);
  assert.equal(matchesRule(boundedRule, { payee: "Carrefour", amount: 5001 }), false);

  const disabledRule = makeRule({ enabled: false });
  assert.equal(matchesRule(disabledRule, { payee: "Carrefour", amount: 2500 }), false);
});

test("applyRules evaluates in priority order and supports first vs all mode", () => {
  const rHigh = makeRule({
    id: "r_high",
    name: "High priority",
    priority: 5,
    set_category_id: "cat_food",
    add_tags: ["supermarket"],
    set_payee: "Carrefour",
  });
  const rLow = makeRule({
    id: "r_low",
    name: "Low priority",
    priority: 20,
    set_category_id: "cat_util",
    add_tags: ["weekly", "supermarket"],
    set_payee: "Other Name",
  });

  assert.deepEqual(
    sortRules([rLow, rHigh]).map((r) => r.id),
    ["r_high", "r_low"],
  );

  const allRes = applyRules(
    [rLow, rHigh],
    {
      type: "expense",
      payee: "CARREFOUR DXB 123",
      notes: "",
      amount: 5000,
      category_id: null,
      tags: ["card"],
    },
    { mode: "all", overwritePayee: true },
  );
  assert.equal(allRes.category_id, "cat_food");
  assert.equal(allRes.payee, "Carrefour");
  assert.deepEqual(allRes.tags, ["card", "supermarket", "weekly"]);
  assert.equal(allRes.matchedRules.length, 2);

  const firstRes = applyRules(
    [rLow, rHigh],
    {
      type: "expense",
      payee: "CARREFOUR DXB 123",
      notes: "",
      amount: 5000,
      category_id: null,
      tags: [],
    },
    { mode: "first" },
  );
  assert.equal(firstRes.matchedRules.length, 1);
  assert.deepEqual(firstRes.tags, ["supermarket"]);

  // Transfers never receive a category from rules.
  const transferRes = applyRules([rHigh], {
    type: "transfer",
    payee: "Carrefour",
    amount: 5000,
    category_id: null,
    tags: [],
  });
  assert.equal(transferRes.category_id, null);
});
