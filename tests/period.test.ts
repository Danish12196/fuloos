import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthsBetween,
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

test("custom ranges run from any start month to any end month", () => {
  assert.deepEqual(periodMonths("custom", "2026-02", "2025-10"), {
    first: "2025-10",
    last: "2026-02",
  });
  // A missing or later start collapses to a single month.
  assert.deepEqual(periodMonths("custom", "2026-02"), {
    first: "2026-02",
    last: "2026-02",
  });
  assert.deepEqual(periodMonths("custom", "2026-02", "2026-05"), {
    first: "2026-02",
    last: "2026-02",
  });
  assert.equal(monthsBetween("2025-10", "2026-02"), 5);
  assert.equal(periodStep("custom", "2026-02", "2025-10"), 5);
  assert.ok(periodContains("custom", "2026-02", "2025-12", "2025-10"));
  assert.ok(!periodContains("custom", "2026-02", "2025-09", "2025-10"));
});

test("labels read like a person would say them", () => {
  assert.equal(periodLabel("month", "2026-11"), "November 2026");
  assert.equal(periodLabel("custom", "2026-11", "2026-09"), "Sep – Nov 2026");
  assert.equal(
    periodLabel("custom", "2026-02", "2025-09"),
    "Sep 2025 – Feb 2026",
  );
  assert.equal(periodLabel("ytd", "2026-01"), "January 2026");
  assert.equal(periodLabel("all", "2026-11"), "All time");
  assert.equal(
    periodDates("custom", "2026-11", "2026-09"),
    "1 Sep – 30 Nov 2026",
  );
  assert.equal(periodDates("month", "2028-02"), "1 Feb – 29 Feb 2028");
  assert.equal(periodDates("12", "2026-11"), "1 Dec 2025 – 30 Nov 2026");
});

test("arrows move a whole period and all time does not move", () => {
  assert.equal(periodStep("month"), 1);
  assert.equal(periodStep("ytd"), 12);
  assert.equal(periodStep("12"), 12);
  assert.equal(periodStep("all"), 0);
  assert.ok(periodContains("all", "2026-11", "1999-01"));
});
