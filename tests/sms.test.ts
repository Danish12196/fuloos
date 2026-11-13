import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanName,
  dateInText,
  detectBank,
  smsFromBackupXml,
  splitMerchant,
} from "../src/ledger/sms.ts";

function makeMockParser(
  nodes: { attrs: Record<string, string | null> }[],
  hasError = false,
): DOMParser {
  const makeNode = (attrs: Record<string, string | null>) => ({
    getAttribute: (name: string) =>
      Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null,
  });
  return {
    parseFromString: () =>
      ({
        getElementsByTagName: (tag: string) => {
          if (tag === "parsererror") return hasError ? [{}] : [];
          if (tag === "sms") return nodes.map((n) => makeNode(n.attrs));
          return [];
        },
      }) as unknown as Document,
  } as unknown as DOMParser;
}

test("smsFromBackupXml parses received messages in Asia/Dubai and guards invalid dates", () => {
  // 2025-05-05T22:00:00Z is 2025-05-06T02:00:00+04:00 in Asia/Dubai
  const dubaiNextDayMs = String(Date.UTC(2025, 4, 5, 22, 0, 0));
  const parser = makeMockParser([
    {
      attrs: {
        type: "1",
        date: dubaiNextDayMs,
        body: "  Purchase of AED 10.00  ",
        address: "Liv",
      },
    },
    {
      attrs: {
        type: "2",
        date: dubaiNextDayMs,
        body: "Sent message should be ignored",
        address: "Me",
      },
    },
    {
      attrs: {
        type: "1",
        date: "9000000000000000000", // > max JS Date (~8.64e15) -> Invalid Date
        body: "Huge timestamp",
        address: "ADCB",
      },
    },
    {
      attrs: {
        type: "1",
        date: "not-a-number",
        body: "Bad timestamp",
        address: "FAB",
      },
    },
    {
      attrs: {
        type: "1",
        date: dubaiNextDayMs,
        body: "   ",
        address: "Liv",
      },
    },
  ]);

  const rows = smsFromBackupXml("<smses/>", parser);
  assert.deepEqual(rows, [
    { message: "Purchase of AED 10.00", date: "2025-05-06", sender: "Liv" },
    { message: "Huge timestamp", date: null, sender: "ADCB" },
    { message: "Bad timestamp", date: null, sender: "FAB" },
  ]);

  assert.throws(
    () => smsFromBackupXml("<bad>", makeMockParser([], true)),
    /not a valid SMS backup XML/,
  );
});

test("splitMerchant extracts merchant, location, and country per bank", () => {
  assert.deepEqual(splitMerchant(null, "ADCB"), [null, null, null]);
  assert.deepEqual(splitMerchant("   ", "Liv"), [null, null, null]);
  assert.deepEqual(splitMerchant("ADNOC 123, DUBAI - AE", "ADCB"), [
    "ADNOC 123",
    "DUBAI",
    "AE",
  ]);
  assert.deepEqual(splitMerchant("TALABAT, DUBAI", "Liv"), [
    "TALABAT",
    "DUBAI",
    null,
  ]);
  assert.deepEqual(splitMerchant("NETFLIX.COM Amsterdam NL", "FAB"), [
    "NETFLIX.COM",
    "Amsterdam",
    "NL",
  ]);
  assert.deepEqual(
    splitMerchant("ASTER PHARMACY in DUBAI, UNITED ARAB EMI", "ADIB"),
    ["ASTER PHARMACY", "DUBAI", "AE"],
  );
  assert.deepEqual(splitMerchant("CARREFOUR MOE", "Mashreq"), [
    "CARREFOUR MOE",
    null,
    null,
  ]);
});

test("cleanName normalizes canonical brands and strips payment prefixes and noise", () => {
  assert.equal(cleanName(null), null);
  assert.equal(cleanName("  "), null);
  assert.equal(cleanName("TALABAT.COM DUBAI"), "Talabat");
  assert.equal(cleanName("SP * MY COFFEE SHOP 1234"), "MY COFFEE SHOP");
  assert.equal(cleanName("TAP* BAKERY #45"), "BAKERY");
});

test("detectBank selects the bank matching the most messages", () => {
  assert.equal(detectBank(["hello world"]), null);
  assert.equal(
    detectBank([
      "Purchase of AED 45.00 with Debit Card ending 1234 at TALABAT, DUBAI. Avl Bal is AED 1,000.00",
      "Purchase of AED 20.00 with Debit Card ending 1234 at CAREEM, DUBAI. Avl Bal is AED 980.00",
      "Cr.Card ***9876 used for AED 120.00 on 03/05/2025 12:30 at ADNOC 123,DUBAI-AE. Avl. Cr.limit is AED 5000.00",
    ]),
    "Liv",
  );
});

test("dateInText skips invalid slash dates and finds subsequent valid dates", () => {
  assert.equal(dateInText("ref 31/02/2025 posted 05/05/2025"), "2025-05-05");
  assert.equal(dateInText("on 04/05/25 10:11"), "2025-05-04");
  assert.equal(dateInText("on 05-MAY-2025"), "2025-05-05");
  assert.equal(dateInText("on 31-FEB-2025"), null);
});
