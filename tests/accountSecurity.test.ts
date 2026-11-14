import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BackendError,
  MfaRequiredError,
  PocketBaseBackend,
} from "../src/backend.ts";

function fixture() {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue: Response[] = [];
  const saved = new Map<string, string>();
  const storage = {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => {
      saved.set(k, v);
    },
    removeItem: (k: string) => {
      saved.delete(k);
    },
  };
  const fetcher = (async (url: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = queue.shift();
    if (!r) throw new Error("Unexpected request");
    return r;
  }) as typeof fetch;
  return {
    backend: new PocketBaseBackend("https://pb.example.test", storage, fetcher),
    calls,
    queue,
    saved,
  };
}

const json = (value: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  });

const auth = {
  token: "user-token",
  record: {
    id: "user-a",
    email: "test@example.test",
    verified: true,
    mfa_enabled: true,
  },
};

test("MFA flow: authWithPassword -> MfaRequiredError -> requestOtp -> verifyMfaOtp", async () => {
  const f = fixture();
  f.queue.push(
    json({ status: 401, message: "MFA required.", mfaId: "mfa-123" }, 401),
    json({ otpId: "otp-456" }, 200),
    json(auth, 200),
  );

  await assert.rejects(
    f.backend.signIn("test@example.test", "password123"),
    (err: unknown) => err instanceof MfaRequiredError && err.mfaId === "mfa-123",
  );

  const { otpId } = await f.backend.requestOtp("test@example.test");
  assert.equal(otpId, "otp-456");

  const session = await f.backend.verifyMfaOtp("mfa-123", otpId, " 12345678 ");
  assert.equal(session.user.id, "user-a");
  assert.equal(session.user.verified, true);
  assert.equal(session.user.mfaEnabled, true);
  assert.equal(
    JSON.parse(String(f.calls[2].init.body)).password,
    "12345678",
  );
});

test("signUp returns verificationRequired when immediate signIn is blocked by unverified authRule", async () => {
  const f = fixture();
  f.queue.push(
    json({ id: "user-a", email: "new@example.test" }, 200),
    json({ message: "The account is not verified." }, 403),
  );
  const res = await f.backend.signUp("new@example.test", "password123");
  assert.equal(res.session, null);
  assert.equal(res.verificationRequired, true);
});

test("password reset, email verification, change password, change email, MFA toggle, and signOutEverywhere", async () => {
  const f = fixture();
  f.queue.push(
    json(null, 204), // requestPasswordReset
    json(null, 204), // confirmPasswordReset
    json(null, 204), // requestVerification
    json(null, 204), // confirmVerification
    json(auth, 200), // signIn
    json({ id: "user-a" }, 200), // changePassword
    json(null, 204), // requestEmailChange
    json({ id: "user-a", email: "test@example.test", mfa_enabled: false }, 200), // setMfaEnabled(false)
    json({ ok: true }, 200), // signOutEverywhere
  );

  await f.backend.requestPasswordReset("test@example.test");
  await f.backend.confirmPasswordReset("tok", "newpass123", "newpass123");
  await f.backend.requestVerification("test@example.test");
  await f.backend.confirmVerification("vtok");

  await f.backend.signIn("test@example.test", "newpass123");
  await f.backend.changePassword("newpass123", "newerpass123", "newerpass123");
  await f.backend.requestEmailChange("other@example.test");

  const updated = await f.backend.setMfaEnabled(false);
  assert.equal(updated.user.mfaEnabled, false);

  await f.backend.signOutEverywhere();
  assert.equal(f.saved.size, 0);
  await assert.rejects(f.backend.load(), /sign in/);
});

test("signOutEverywhere reports clear error when pb_hooks route is not installed (404)", async () => {
  const f = fixture();
  f.queue.push(json(auth, 200), json({ message: "Not found." }, 404));
  await f.backend.signIn("test@example.test", "password123");
  await assert.rejects(
    f.backend.signOutEverywhere(),
    (e: unknown) =>
      e instanceof BackendError &&
      e.status === 404 &&
      /fuloos_security\.pb\.js/.test(e.message),
  );
});
