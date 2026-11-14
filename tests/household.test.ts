import assert from "node:assert/strict";
import test from "node:test";
import { PocketBaseBackend } from "../src/backend.ts";
import type { Account, Budget, HouseholdMember } from "../src/domain.ts";
import {
  canEditHouseholdRole,
  generateDemoInviteCode,
  householdMembersFor,
  isSharedRecord,
  normalizeInviteCode,
  sharedAccountCount,
  sharedBudgetCount,
  userRoleInHousehold,
  validateHouseholdName,
} from "../src/household.ts";

test("validateHouseholdName trims valid names and rejects empty or oversized names", () => {
  assert.equal(validateHouseholdName("  Home  "), "Home");
  assert.throws(() => validateHouseholdName("   "), /Enter a household name/);
  assert.throws(
    () => validateHouseholdName("a".repeat(81)),
    /80 characters or fewer/,
  );
});

test("normalizeInviteCode trims and uppercases codes", () => {
  assert.equal(normalizeInviteCode("  ab12cd34 "), "AB12CD34");
});

test("isSharedRecord distinguishes shared vs private records", () => {
  assert.equal(isSharedRecord({ household_id: "hh1" }), true);
  assert.equal(isSharedRecord({ household_id: null }), false);
  assert.equal(isSharedRecord({ household_id: "" }), false);
  assert.equal(isSharedRecord({ household_id: "   " }), false);
  assert.equal(isSharedRecord({}), false);
});

test("canEditHouseholdRole allows owner and editor only", () => {
  assert.equal(canEditHouseholdRole("owner"), true);
  assert.equal(canEditHouseholdRole("editor"), true);
  assert.equal(canEditHouseholdRole("viewer"), false);
  assert.equal(canEditHouseholdRole(null), false);
  assert.equal(canEditHouseholdRole(undefined), false);
});

test("userRoleInHousehold resolves owner, active members, and ignores pending", () => {
  const members: HouseholdMember[] = [
    {
      id: "m1",
      household_id: "hh1",
      user_id: "u2",
      role: "editor",
      status: "active",
    },
    {
      id: "m2",
      household_id: "hh1",
      user_id: "u3",
      role: "viewer",
      status: "pending",
      invite_code: "ABCD1234",
    },
  ];
  assert.equal(userRoleInHousehold(members, "hh1", "u1", "u1"), "owner");
  assert.equal(userRoleInHousehold(members, "hh1", "u2", "u1"), "editor");
  assert.equal(userRoleInHousehold(members, "hh1", "u3", "u1"), null);
  assert.equal(userRoleInHousehold(members, "hh1", "u4", "u1"), null);
});

test("householdMembersFor filters and sorts owner, editor, viewer, then pending", () => {
  const members: HouseholdMember[] = [
    {
      id: "p1",
      household_id: "hh1",
      user_id: null,
      role: "editor",
      status: "pending",
      invite_code: "CODE1234",
    },
    {
      id: "v1",
      household_id: "hh1",
      user_id: "u3",
      role: "viewer",
      status: "active",
    },
    {
      id: "other",
      household_id: "hh2",
      user_id: "u9",
      role: "owner",
      status: "active",
    },
    {
      id: "o1",
      household_id: "hh1",
      user_id: "u1",
      role: "owner",
      status: "active",
    },
    {
      id: "e1",
      household_id: "hh1",
      user_id: "u2",
      role: "editor",
      status: "active",
    },
  ];
  assert.deepEqual(
    householdMembersFor(members, "hh1").map((m) => m.id),
    ["o1", "e1", "v1", "p1"],
  );
});

test("sharedAccountCount and sharedBudgetCount count records for a household", () => {
  const accounts: Account[] = [
    {
      id: "a1",
      name: "Joint",
      type: "current",
      opening_balance: 0,
      opening_date: "2026-01-01",
      color: "#1d5b48",
      household_id: "hh1",
    },
    {
      id: "a2",
      name: "Private",
      type: "cash",
      opening_balance: 0,
      opening_date: "2026-01-01",
      color: "#1d5b48",
      household_id: null,
    },
  ];
  const budgets: Budget[] = [
    {
      id: "b1",
      category_id: "c1",
      amount: 10000,
      start_month: "2026-01",
      end_month: null,
      household_id: "hh1",
    },
  ];
  assert.equal(sharedAccountCount(accounts, "hh1"), 1);
  assert.equal(sharedBudgetCount(budgets, "hh1"), 1);
});

test("generateDemoInviteCode creates 8-char uppercase alphanumeric codes", () => {
  const code = generateDemoInviteCode();
  assert.match(code, /^[A-Z0-9]{8}$/);
});

test("PocketBaseBackend.loadHouseholds tolerates MissingCollectionError (404)", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/auth-with-password")) {
      return new Response(
        JSON.stringify({
          token: "tok",
          record: { id: "u1", email: "a@example.com" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ message: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
  const pb = new PocketBaseBackend("http://127.0.0.1:8090", undefined, fakeFetch);
  await pb.signIn("a@example.com", "secret");
  const res = await pb.loadHouseholds();
  assert.deepEqual(res, { households: [], members: [], supported: false });
});
