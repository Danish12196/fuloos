import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildQuickAddTransaction,
  LAST_ACCOUNT_KEY,
  parseQuickAddUrl,
  parseSharedTransactionText,
  pickDefaultAccountId,
  readRememberedAccount,
  saveRememberedAccount,
  type StorageLike,
} from "../src/quickAdd.ts";
import { emptyLedger, type Ledger } from "../src/domain.ts";

function makeMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const sampleLedger: Ledger = {
  ...emptyLedger,
  accounts: [
    {
      id: "acc-1",
      name: "Liv Current",
      type: "current",
      opening_balance: 100_000,
      opening_date: "2026-01-01",
      color: "#1d5b48",
    },
    {
      id: "acc-2",
      name: "Cash",
      type: "cash",
      opening_balance: 20_000,
      opening_date: "2026-01-01",
      color: "#b08448",
    },
  ],
  categories: [
    {
      id: "cat-food",
      name: "Groceries",
      description: "",
      color: "#619a92",
    },
  ],
};

test("parseQuickAddUrl handles ?quickadd=1 and direct query params", () => {
  assert.deepEqual(parseQuickAddUrl("", "2026-11-13"), {
    open: false,
    draft: {},
  });
  assert.deepEqual(parseQuickAddUrl("?tab=overview", "2026-11-13"), {
    open: false,
    draft: {},
  });

  const shortcut = parseQuickAddUrl("?quickadd=1", "2026-11-13");
  assert.equal(shortcut.open, true);

  const prefilled = parseQuickAddUrl(
    "?quickadd=true&type=income&amount=120.50&payee=Refund&date=2026-11-10",
    "2026-11-13",
  );
  assert.equal(prefilled.open, true);
  assert.deepEqual(prefilled.draft, {
    type: "income",
    amount: "120.50",
    payee: "Refund",
    date: "2026-11-10",
  });
});

test("parseSharedTransactionText extracts AED amount, merchant, date, and kind", () => {
  const coffee = parseSharedTransactionText(
    "Spent AED 24.50 at Starbucks Dubai on 2026-11-12 using card XXXX1234",
    "Receipt",
    "2026-11-13",
  );
  assert.equal(coffee.type, "expense");
  assert.equal(coffee.amount, "24.50");
  assert.equal(coffee.payee, "Starbucks Dubai");
  assert.equal(coffee.date, "2026-11-12");

  const salary = parseSharedTransactionText(
    "Your account was credited with Dhs 15,000.00 Salary on 01/11/2026",
    "",
    "2026-11-13",
  );
  assert.equal(salary.type, "income");
  assert.equal(salary.amount, "15000.00");
  assert.equal(salary.date, "2026-11-01");

  const creditCardPurchase = parseSharedTransactionText(
    "Credit card purchase of 89 AED at Carrefour",
    "",
    "2026-11-13",
  );
  assert.equal(creditCardPurchase.type, "expense");
  assert.equal(creditCardPurchase.amount, "89");
  assert.equal(creditCardPurchase.payee, "Carrefour");
});

test("account memory picks remembered account when valid and falls back safely", () => {
  const storage = makeMemoryStorage();
  assert.equal(readRememberedAccount(storage), null);

  saveRememberedAccount("acc-2", storage);
  assert.equal(storage.getItem(LAST_ACCOUNT_KEY), "acc-2");
  assert.equal(readRememberedAccount(storage), "acc-2");

  assert.equal(
    pickDefaultAccountId(sampleLedger.accounts, readRememberedAccount(storage)),
    "acc-2",
  );
  assert.equal(
    pickDefaultAccountId(sampleLedger.accounts, "deleted-acc"),
    "acc-1",
  );
  assert.equal(pickDefaultAccountId([], "acc-1"), "");
});

test("buildQuickAddTransaction converts AED to integer fils and validates", () => {
  const tx = buildQuickAddTransaction(
    {
      type: "expense",
      amount: "24.50",
      accountId: "acc-1",
      categoryId: "cat-food",
      payee: "  Spinneys  ",
      date: "2026-11-13",
    },
    sampleLedger,
  );
  assert.deepEqual(tx, {
    type: "expense",
    amount: 2450,
    account_id: "acc-1",
    to_account_id: null,
    category_id: "cat-food",
    date: "2026-11-13",
    payee: "Spinneys",
    notes: "",
  });

  assert.throws(
    () =>
      buildQuickAddTransaction(
        {
          type: "expense",
          amount: "0",
          accountId: "acc-1",
          categoryId: "",
          payee: "",
          date: "2026-11-13",
        },
        sampleLedger,
      ),
    /greater than zero/,
  );

  assert.throws(
    () =>
      buildQuickAddTransaction(
        {
          type: "expense",
          amount: "10",
          accountId: "missing",
          categoryId: "",
          payee: "",
          date: "2026-11-13",
        },
        sampleLedger,
      ),
    /Select an account/,
  );
});

test("manifest.webmanifest and sw.js uphold PWA and security invariants", async () => {
  const manifestRaw = await readFile(
    new URL("../public/manifest.webmanifest", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw) as {
    name: string;
    short_name: string;
    display: string;
    icons: Array<{ sizes: string; purpose?: string; src: string }>;
    shortcuts: Array<{ url: string }>;
    share_target?: { action: string; method: string };
  };

  assert.equal(manifest.short_name, "Fuloos");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((i) => i.sizes === "192x192"));
  assert.ok(manifest.icons.some((i) => i.sizes === "512x512"));
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
  assert.ok(manifest.shortcuts.some((s) => s.url === "/?quickadd=1"));
  assert.equal(manifest.share_target?.method, "GET");

  const sw = await readFile(
    new URL("../public/sw.js", import.meta.url),
    "utf8",
  );
  assert.match(sw, /SKIP_WAITING/);
  assert.match(sw, /\/api\//);
  assert.match(sw, /authorization/);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
});
