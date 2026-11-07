import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmDialog,
  currentConfirm,
  settleConfirm,
  subscribeConfirm,
} from "../src/dialogStore.ts";

test("confirm requests queue one at a time and resolve with the answer", async () => {
  let notified = 0;
  const off = subscribeConfirm(() => notified++);
  const first = confirmDialog({ title: "Delete A?", tone: "danger" });
  const second = confirmDialog({ title: "Unlink B?" });
  const shown = currentConfirm();
  assert.equal(shown?.title, "Delete A?");
  assert.equal(shown?.confirmLabel, "Delete");
  assert.equal(shown?.tone, "danger");
  settleConfirm(shown!.id, true);
  assert.equal(await first, true);
  const next = currentConfirm();
  assert.equal(next?.title, "Unlink B?");
  assert.equal(next?.confirmLabel, "Confirm");
  settleConfirm(next!.id, false);
  assert.equal(await second, false);
  assert.equal(currentConfirm(), null);
  assert.ok(notified >= 4);
  off();
});
