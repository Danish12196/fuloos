import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PIN_ATTEMPTS,
  clearAppLock,
  createAppLockConfig,
  getFailedAttempts,
  hashPin,
  isValidPin,
  loadAppLock,
  loadIdleSessionTimeout,
  recordFailedAttempt,
  resetFailedAttempts,
  saveAppLock,
  saveIdleSessionTimeout,
  shouldLockForIdle,
  shouldSignOutForIdle,
  verifyPin,
  type StorageLike,
} from "../src/appLock.ts";

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test("isValidPin accepts 4-8 digits and rejects non-digits or wrong lengths", () => {
  assert.equal(isValidPin("1234"), true);
  assert.equal(isValidPin("12345678"), true);
  assert.equal(isValidPin("123"), false);
  assert.equal(isValidPin("123456789"), false);
  assert.equal(isValidPin("12ab"), false);
  assert.equal(isValidPin(""), false);
});

test("PBKDF2 PIN hashing uses unique salts and verifies correctly", async () => {
  const a = await createAppLockConfig("user-1", "2580", 5, true);
  const b = await createAppLockConfig("user-1", "2580", 5, true);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.hash, "2580");
  assert.equal(await verifyPin("2580", a), true);
  assert.equal(await verifyPin("2581", a), false);
  assert.equal(await verifyPin("abc", a), false);
  await assert.rejects(hashPin("12", a.salt), /4 to 8 digits/);
});

test("app lock config persists per user and clears cleanly", async () => {
  const storage = memoryStorage();
  const cfg = await createAppLockConfig("user-a", "4321", 10, false);
  saveAppLock(storage, cfg);
  const loadedA = loadAppLock(storage, "user-a");
  assert.deepEqual(loadedA, cfg);
  assert.equal(loadAppLock(storage, "user-b"), null);
  clearAppLock(storage, "user-a");
  assert.equal(loadAppLock(storage, "user-a"), null);
});

test("failed PIN attempts track up to MAX_PIN_ATTEMPTS and reset on success", () => {
  const storage = memoryStorage();
  assert.equal(getFailedAttempts(storage, "user-a"), 0);
  for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
    const res = recordFailedAttempt(storage, "user-a");
    assert.equal(res.attempts, i);
    assert.equal(res.lockedOut, false);
  }
  const final = recordFailedAttempt(storage, "user-a");
  assert.equal(final.attempts, MAX_PIN_ATTEMPTS);
  assert.equal(final.lockedOut, true);
  resetFailedAttempts(storage, "user-a");
  assert.equal(getFailedAttempts(storage, "user-a"), 0);
});

test("idle lock and idle session sign-out thresholds behave as expected", () => {
  const storage = memoryStorage();
  assert.equal(loadIdleSessionTimeout(storage, "user-a"), 0);
  saveIdleSessionTimeout(storage, "user-a", 30);
  assert.equal(loadIdleSessionTimeout(storage, "user-a"), 30);
  saveIdleSessionTimeout(storage, "user-a", 0);
  assert.equal(loadIdleSessionTimeout(storage, "user-a"), 0);

  const t0 = 1_000_000;
  assert.equal(shouldLockForIdle(t0, t0 + 4 * 60_000, 5), false);
  assert.equal(shouldLockForIdle(t0, t0 + 5 * 60_000, 5), true);
  assert.equal(shouldLockForIdle(t0, t0 + 999 * 60_000, 0), false);

  assert.equal(shouldSignOutForIdle(t0, t0 + 14 * 60_000, 15), false);
  assert.equal(shouldSignOutForIdle(t0, t0 + 15 * 60_000, 15), true);
  assert.equal(shouldSignOutForIdle(t0, t0 + 999 * 60_000, 0), false);
});
