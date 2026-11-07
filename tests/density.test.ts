import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DENSITY, parseDensity } from "../src/density.ts";

test("parseDensity keeps known values and falls back to compact", () => {
  assert.equal(parseDensity("relaxed"), "relaxed");
  assert.equal(parseDensity("compact"), "compact");
  assert.equal(parseDensity(null), DEFAULT_DENSITY);
  assert.equal(parseDensity("cosy"), DEFAULT_DENSITY);
  assert.equal(DEFAULT_DENSITY, "compact");
});
