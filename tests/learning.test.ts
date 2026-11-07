import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPersonalModel,
  makeExample,
  mapFromStored,
  mapToStored,
  merchantKey,
  suggestCategory,
  type LearningExample,
} from "../src/ledger/learning.ts";
import {
  createAccountLearningStore,
  createSessionLearningStore,
  withConsent,
  type LearningRemote,
} from "../src/ledger/learningStore.ts";

const ids = new Set(["food", "coffee", "groceries", "fuel"]);
let clock = 0;
const ex = (
  merchant: string,
  category_id: string,
  amount = 2500,
  payee = "",
): LearningExample => ({
  ...makeExample({
    merchant,
    payee: payee || merchant,
    amount,
    category_id,
    suggested_category_id: null,
    source: "sms",
    model_version: "rules",
  })!,
  created: `2026-01-01 00:00:${String(clock++).padStart(5, "0")}`,
});

test("category map round-trips through the stored array form", () => {
  const stored = mapToStored({ Food_Dining: "food", Groceries: null });
  assert.deepEqual(stored.Food_Dining, ["food"]);
  assert.deepEqual(stored.Groceries, []);
  const back = mapFromStored(
    { ...stored, Travel: ["deleted-id"], Transport_Auto: "fuel" },
    ids,
  )!;
  assert.equal(back.Food_Dining, "food");
  assert.equal(back.Groceries, null);
  assert.equal(back.Transport_Auto, "fuel");
  assert.equal("Travel" in back, false);
  assert.equal(mapFromStored("nope", ids), null);
});

test("examples keep only cleaned merchant text and need a category", () => {
  const e = makeExample({
    merchant: "CAFE 123 4567-890 DXB",
    payee: "  My cafe ",
    amount: 1250.4,
    category_id: "coffee",
    suggested_category_id: "coffee",
    source: "sms",
    model_version: "ledger-1",
  })!;
  assert.equal(e.merchant_text, "CAFE DXB");
  assert.equal(e.payee, "My cafe");
  assert.equal(e.amount, 1250);
  assert.equal(e.accepted, true);
  assert.equal(merchantKey("UNKNOWN MERCHANT"), "");
  for (const bad of [
    { merchant: "UNKNOWN MERCHANT", category_id: "food" },
    { merchant: "1234", category_id: "food" },
    { merchant: "SHOP", category_id: null },
  ])
    assert.equal(
      makeExample({
        ...bad,
        payee: "",
        amount: 1,
        suggested_category_id: null,
        source: "sms",
        model_version: "",
      }),
      null,
    );
});

test("exact merchant corrections win and bring back the chosen payee", () => {
  const personal = buildPersonalModel(
    [
      ex("ZQ MART", "food"),
      ex("ZQ MART", "groceries", 2500, "ZQ Mart"),
      ex("ZQ MART", "groceries", 2500, "ZQ Mart"),
    ],
    null,
    {},
    ids,
  );
  const s = suggestCategory(personal, null, {}, "ZQ MART", 30);
  assert.equal(s.category_id, "groceries");
  assert.equal(s.decidedBy, "your corrections");
  assert.equal(s.payee, "ZQ Mart");
  assert.equal(s.needsReview, false);
  // Unknown merchants fall through to rules and the mapping.
  const talabat = suggestCategory(
    personal,
    null,
    { Food_Dining: "food" },
    "Talabat",
    40,
  );
  assert.equal(talabat.category_id, "food");
  assert.equal(talabat.decidedBy, "rules");
});

test("personal model learns a split the standard mapping can't express", () => {
  const examples: LearningExample[] = [];
  const coffee = [
    "BEAN CAFE",
    "COFFEE CORNER",
    "ESPRESSO CAFE",
    "CAFE NERO",
    "ROAST COFFEE",
  ];
  const food = [
    "GRILL HOUSE",
    "SHAWARMA KING",
    "BIRYANI POT",
    "PIZZA SPOT",
    "BURGER BARN",
  ];
  for (let i = 0; i < 6; i++) {
    coffee.forEach((m) => examples.push(ex(m, "coffee", 1800)));
    food.forEach((m) => examples.push(ex(m, "food", 6500)));
  }
  const map = { Food_Dining: "food" };
  const personal = buildPersonalModel(examples, null, map, ids);
  assert.equal(personal.stats.examples, 60);
  assert.equal(personal.stats.usesClassifier, true);
  assert.ok(
    personal.stats.personalAccuracy! > personal.stats.baselineAccuracy!,
  );
  const unseen = suggestCategory(personal, null, map, "MOCHA CAFE", 19);
  assert.equal(unseen.category_id, "coffee");
  assert.equal(unseen.decidedBy, "personal model");
  // Without learning the same merchant goes to the mapped category.
  assert.equal(
    suggestCategory(null, null, map, "MOCHA CAFE", 19).category_id,
    "food",
  );
});

test("too few corrections, or ones for deleted categories, keep the classifier off", () => {
  const few = buildPersonalModel(
    [ex("A SHOP", "food"), ex("B SHOP", "coffee")],
    null,
    {},
    ids,
  );
  assert.equal(few.classifier, null);
  const gone = buildPersonalModel(
    Array.from({ length: 30 }, (_, i) =>
      ex(`SHOP ${"X".repeat((i % 5) + 1)}`, "deleted"),
    ),
    null,
    {},
    ids,
  );
  assert.equal(gone.stats.examples, 0);
});

test("session store keeps examples only while learning is on", async () => {
  const store = createSessionLearningStore();
  let data = await store.load(ids);
  assert.equal(data.settings.learn_consent, false);
  assert.equal(data.storedMap, null);
  await store.addExamples([ex("ZQ MART", "food")]);
  assert.equal((await store.load(ids)).examples.length, 0);
  const on = withConsent(data.settings, true, new Date("2026-11-07T00:00:00Z"));
  assert.equal(on.consent_at, "2026-11-07T00:00:00.000Z");
  assert.ok(on.consent_version);
  await store.saveSettings(on);
  data = await store.load(ids);
  assert.equal(data.examples.length, 1);
  assert.equal(await store.clearExamples(), 1);
  assert.equal((await store.load(ids)).examples.length, 0);
  const off = withConsent(on, false);
  assert.equal(off.learn_consent, false);
  assert.equal(off.consent_at, on.consent_at);
});

test("account store sorts the log, saves the map as arrays and deletes everything", async () => {
  const saved: { body: Record<string, unknown>; id?: string }[] = [];
  let rows = [
    { ...ex("B", "food"), id: "2", created: "2026-02-01 00:00:00" },
    { ...ex("A", "food"), id: "1", created: "2026-01-01 00:00:00" },
  ];
  const removed: string[] = [];
  const remote: LearningRemote = {
    listSettings: async () => [
      {
        id: "s1",
        learn_consent: true,
        consent_version: "learn-v1",
        consent_at: "2026-01-01",
        category_map: { Food_Dining: ["food"] },
      },
    ],
    saveSettings: async (body, id) => {
      saved.push({ body, id });
      return { id: id ?? "new" };
    },
    listExamples: async () => rows,
    createExamples: async (list) => {
      rows = [...rows, ...list.map((e, i) => ({ ...e, id: `n${i}` }))];
    },
    removeExamples: async (list) => {
      removed.push(...list);
    },
  };
  const store = createAccountLearningStore(remote);
  const data = await store.load(ids);
  assert.deepEqual(
    data.examples.map((e) => e.merchant_text),
    ["A", "B"],
  );
  assert.equal(data.storedMap?.Food_Dining, "food");
  await store.saveSettings({
    ...data.settings,
    category_map: { Groceries: "groceries" },
  });
  assert.equal(saved[0].id, "s1");
  assert.deepEqual(
    (saved[0].body.category_map as Record<string, string[]>).Groceries,
    ["groceries"],
  );
  assert.equal(await store.clearExamples(), 2);
  assert.deepEqual(removed.sort(), ["1", "2"]);
});
