import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodContains,
  periodDates,
  periodLabel,
  periodMonths,
  periodStep,
} from "../src/period.ts";

test("period ranges end at the chosen month", () => {
  assert.deepEqual(periodMonths("month", "2026-11"), {
    first: "2026-11",
    last: "2026-11",
  });
  assert.deepEqual(periodMonths("3", "2026-02"), {
    first: "2025-12",
    last: "2026-02",
  });
  assert.deepEqual(periodMonths("ytd", "2026-11"), {
    first: "2026-01",
    last: "2026-11",
  });
  assert.deepEqual(periodMonths("12", "2026-11"), {
    first: "2025-12",
    last: "2026-11",
  });
  assert.equal(periodMonths("all", "2026-11"), null);
});

test("labels read like a person would say them", () => {
  assert.equal(periodLabel("month", "2026-11"), "November 2026");
  assert.equal(periodLabel("3", "2026-11"), "Sep – Nov 2026");
  assert.equal(periodLabel("6", "2026-02"), "Sep 2025 – Feb 2026");
  assert.equal(periodLabel("ytd", "2026-01"), "January 2026");
  assert.equal(periodLabel("all", "2026-11"), "All time");
  assert.equal(periodDates("3", "2026-11"), "1 Sep – 30 Nov 2026");
  assert.equal(periodDates("month", "2028-02"), "1 Feb – 29 Feb 2028");
  assert.equal(periodDates("12", "2026-11"), "1 Dec 2025 – 30 Nov 2026");
});

test("arrows move a whole period and all time does not move", () => {
  assert.equal(periodStep("month"), 1);
  assert.equal(periodStep("3"), 3);
  assert.equal(periodStep("ytd"), 12);
  assert.equal(periodStep("all"), 0);
  assert.ok(periodContains("3", "2026-11", "2026-09"));
  assert.ok(!periodContains("3", "2026-11", "2026-08"));
  assert.ok(periodContains("all", "2026-11", "1999-01"));
});
