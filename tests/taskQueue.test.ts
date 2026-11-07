import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskQueue } from "../src/taskQueue.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("runs tasks one at a time in order and reports pending work", async () => {
  const q = new TaskQueue();
  const order: string[] = [];
  const first = deferred();
  q.enqueue({
    label: "first",
    total: 2,
    run: async ({ progress }) => {
      order.push("first:start");
      progress(1);
      await first.promise;
      order.push("first:end");
    },
  });
  q.enqueue({
    label: "second",
    run: async () => {
      order.push("second");
    },
  });
  await Promise.resolve();
  let snap = q.getSnapshot();
  assert.equal(snap.pending, 2);
  assert.deepEqual(
    snap.tasks.map((t) => t.status),
    ["running", "queued"],
  );
  assert.equal(snap.tasks[0].done, 1);
  first.resolve();
  await q.idle();
  snap = q.getSnapshot();
  assert.equal(snap.pending, 0);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
  assert.deepEqual(
    snap.tasks.map((t) => [t.status, t.done, t.total]),
    [
      ["done", 2, 2],
      ["done", 1, 1],
    ],
  );
});

test("a failed task keeps its error and does not stop later tasks", async () => {
  const q = new TaskQueue();
  let ran = false;
  q.enqueue({
    label: "bad",
    run: async () => {
      throw new Error("Server said no.");
    },
  });
  q.enqueue({
    label: "good",
    run: async () => {
      ran = true;
    },
  });
  await q.idle();
  const [bad, good] = q.getSnapshot().tasks;
  assert.equal(bad.status, "failed");
  assert.equal(bad.error, "Server said no.");
  assert.equal(good.status, "done");
  assert.ok(ran);
  q.clearDone();
  assert.deepEqual(
    q.getSnapshot().tasks.map((t) => t.label),
    ["bad"],
  );
  q.dismiss(bad.id);
  assert.equal(q.getSnapshot().tasks.length, 0);
});

test("notifies subscribers and cannot dismiss running work", async () => {
  const q = new TaskQueue();
  let calls = 0;
  const unsubscribe = q.subscribe(() => calls++);
  const gate = deferred();
  const id = q.enqueue({ label: "slow", run: () => gate.promise });
  await Promise.resolve();
  q.dismiss(id);
  assert.equal(q.getSnapshot().tasks.length, 1);
  assert.ok(calls >= 2);
  gate.resolve();
  await q.idle();
  unsubscribe();
  const before = calls;
  q.dismiss(id);
  assert.equal(calls, before);
});

test("cancelQueued drops tasks that have not started", async () => {
  const q = new TaskQueue();
  const gate = deferred();
  let secondRan = false;
  q.enqueue({ label: "a", run: () => gate.promise });
  q.enqueue({
    label: "b",
    run: async () => {
      secondRan = true;
    },
  });
  await Promise.resolve();
  q.cancelQueued();
  assert.deepEqual(
    q.getSnapshot().tasks.map((t) => t.label),
    ["a"],
  );
  gate.resolve();
  await q.idle();
  assert.equal(secondRan, false);
});
