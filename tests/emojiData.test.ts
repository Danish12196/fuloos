import { test } from "node:test";
import assert from "node:assert/strict";
import { emojiGroups, searchEmojis } from "../src/emojiData.ts";

test("emoji search matches word prefixes across groups without duplicates", () => {
  assert.equal(searchEmojis("bank")[0], "🏦");
  assert.ok(searchEmojis("gro").includes("🛒"));
  assert.ok(searchEmojis("credit card").includes("💳"));
  assert.deepEqual(searchEmojis("zzzz"), []);
  assert.deepEqual(searchEmojis("  "), []);
  const repair = searchEmojis("repair");
  assert.equal(repair.length, new Set(repair).size);
  for (const g of emojiGroups) {
    assert.ok(g.items.length > 10, g.name);
    for (const i of g.items) assert.ok(i.words.length > 0, i.emoji);
  }
});
