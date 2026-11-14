/// <reference path="../pb_data/types.d.ts" />
// Fuloos household invite & join hooks for PocketBase (v0.23+ / v0.40+).

onRecordAfterCreateSuccess((e) => {
  const household = e.record;
  if (!household) return e.next();

  const householdId = household.id;
  const ownerId = household.getString("owner_id");
  if (!householdId || !ownerId) return e.next();

  try {
    const existing = $app.findRecordsByFilter(
      "fuloos_household_members",
      "household_id = {:hid} && user_id = {:uid}",
      "",
      1,
      0,
      { hid: householdId, uid: ownerId },
    );
    if (existing.length > 0) return e.next();

    let ownerEmail = "";
    try {
      const user = $app.findRecordById("fuloos_users", ownerId);
      ownerEmail = user.getString("email") || "";
    } catch (_) {
      ownerEmail = "";
    }

    const membersCol = $app.findCollectionByNameOrId("fuloos_household_members");
    const rec = new Record(membersCol);
    rec.set("household_id", householdId);
    rec.set("user_id", ownerId);
    rec.set("role", "owner");
    rec.set("status", "active");
    rec.set("invite_code", "");
    rec.set("member_email", ownerEmail);
    $app.save(rec);
  } catch (err) {
    console.error("Failed to create owner household member:", err);
  }

  return e.next();
}, "fuloos_households");

routerAdd(
  "POST",
  "/api/fuloos/households/invite",
  (e) => {
    const auth = e.auth;
    if (!auth || auth.collection().name !== "fuloos_users") {
      return e.unauthorizedError("Authentication required.", null);
    }

    let membersCol;
    try {
      membersCol = $app.findCollectionByNameOrId("fuloos_household_members");
    } catch (_) {
      return e.json(404, {
        message: "Household features are not installed on the server yet.",
      });
    }

    let body = {};
    try {
      const info = e.requestInfo();
      body = (info && info.body) || {};
    } catch (_) {
      return e.json(400, { message: "Invalid JSON payload." });
    }

    const householdId = String(body.household_id || "").trim();
    const role = body.role === "viewer" ? "viewer" : "editor";
    if (!householdId) {
      return e.json(400, { message: "household_id is required." });
    }

    let household;
    try {
      household = $app.findRecordById("fuloos_households", householdId);
    } catch (_) {
      return e.json(404, { message: "Household not found." });
    }

    if (household.getString("owner_id") !== auth.id) {
      return e.json(403, {
        message: "Only the household owner can create invites.",
      });
    }

    const inviteCode = $security.randomStringWithAlphabet(
      8,
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    );
    const rec = new Record(membersCol);
    rec.set("household_id", householdId);
    rec.set("user_id", "");
    rec.set("role", role);
    rec.set("status", "pending");
    rec.set("invite_code", inviteCode);
    rec.set("member_email", "");
    $app.save(rec);

    return e.json(200, {
      id: rec.id,
      household_id: rec.getString("household_id"),
      user_id: null,
      role: rec.getString("role"),
      status: rec.getString("status"),
      invite_code: rec.getString("invite_code"),
      member_email: "",
    });
  },
  $apis.requireAuth("fuloos_users"),
);

routerAdd(
  "POST",
  "/api/fuloos/households/join",
  (e) => {
    const auth = e.auth;
    if (!auth || auth.collection().name !== "fuloos_users") {
      return e.unauthorizedError("Authentication required.", null);
    }

    try {
      $app.findCollectionByNameOrId("fuloos_household_members");
    } catch (_) {
      return e.json(404, {
        message: "Household features are not installed on the server yet.",
      });
    }

    let body = {};
    try {
      const info = e.requestInfo();
      body = (info && info.body) || {};
    } catch (_) {
      return e.json(400, { message: "Invalid JSON payload." });
    }

    const code = String(body.invite_code || "")
      .trim()
      .toUpperCase();
    if (!code) {
      return e.json(400, { message: "Invite code is required." });
    }

    const invites = $app.findRecordsByFilter(
      "fuloos_household_members",
      "invite_code = {:code} && status = 'pending'",
      "",
      1,
      0,
      { code },
    );
    if (invites.length === 0) {
      return e.json(404, { message: "Invalid or expired invite code." });
    }

    const invite = invites[0];
    const householdId = invite.getString("household_id");
    const household = $app.findRecordById("fuloos_households", householdId);

    if (household.getString("owner_id") === auth.id) {
      return e.json(400, {
        message: "You are already the owner of this household.",
      });
    }

    const existing = $app.findRecordsByFilter(
      "fuloos_household_members",
      "household_id = {:hid} && user_id = {:uid} && status = 'active'",
      "",
      1,
      0,
      { hid: householdId, uid: auth.id },
    );
    if (existing.length > 0) {
      return e.json(400, {
        message: "You are already a member of this household.",
      });
    }

    invite.set("user_id", auth.id);
    invite.set("status", "active");
    invite.set("invite_code", "");
    invite.set("member_email", auth.getString("email") || "");
    $app.save(invite);

    return e.json(200, {
      household: {
        id: household.id,
        name: household.getString("name"),
        owner_id: household.getString("owner_id"),
      },
      member: {
        id: invite.id,
        household_id: invite.getString("household_id"),
        user_id: invite.getString("user_id"),
        role: invite.getString("role"),
        status: invite.getString("status"),
        invite_code: "",
        member_email: invite.getString("member_email"),
      },
    });
  },
  $apis.requireAuth("fuloos_users"),
);
