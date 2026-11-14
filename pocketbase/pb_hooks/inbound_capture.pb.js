/// <reference path="../pb_data/types.d.ts" />
// Fuloos inbound email & shortcut alert capture hooks for PocketBase (v0.23+ / v0.40+).

routerAdd("POST", "/api/fuloos/inbound-email", (e) => {
  const lib = require(__hooks + "/inbound_capture_lib.js");

  let tokensCol;
  let alertsCol;
  try {
    tokensCol = $app.findCollectionByNameOrId("fuloos_capture_tokens");
    alertsCol = $app.findCollectionByNameOrId("fuloos_captured_alerts");
  } catch (_) {
    return e.json(503, {
      message: "Captured alerts migration is not installed on the server yet.",
    });
  }
  if (!tokensCol || !alertsCol) {
    return e.json(503, {
      message: "Captured alerts migration is not installed on the server yet.",
    });
  }

  if (e.request && e.request.contentLength > lib.MAX_PAYLOAD_BYTES) {
    return e.json(413, { message: "Payload too large (max 64 KB)." });
  }

  let body = {};
  try {
    const info = e.requestInfo();
    body = (info && info.body) || {};
  } catch (_) {
    return e.json(400, { message: "Invalid JSON payload." });
  }

  if (JSON.stringify(body).length > lib.MAX_PAYLOAD_BYTES) {
    return e.json(413, { message: "Payload too large (max 64 KB)." });
  }

  const authHeader = e.request ? e.request.header.get("Authorization") : "";
  const tokenHeader = e.request ? e.request.header.get("X-Fuloos-Token") : "";
  const payload = lib.extractPayloadFields(body, authHeader, tokenHeader);

  if (!payload.token) {
    return e.json(401, { message: "Capture token is required." });
  }

  const incomingHash = lib.sha256Hex(payload.token);
  const tokenRecords = $app.findRecordsByFilter(
    "fuloos_capture_tokens",
    "token_hash = {:hash}",
    "",
    1,
    0,
    { hash: incomingHash },
  );

  if (
    tokenRecords.length === 0 ||
    !lib.constantTimeEqual(tokenRecords[0].getString("token_hash"), incomingHash)
  ) {
    return e.json(401, { message: "Invalid capture token." });
  }

  const tokenRec = tokenRecords[0];
  if (!tokenRec.getBool("enabled")) {
    return e.json(403, { message: "Capture token is disabled." });
  }

  const userId = tokenRec.getString("user_id");
  if (!userId) {
    return e.json(401, { message: "Invalid capture token owner." });
  }

  if (!payload.rawText) {
    return e.json(400, { message: "Alert text or html is required." });
  }

  const rawText = payload.rawText.slice(0, 8000);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const oneMinAgoIso = new Date(nowMs - 60 * 1000).toISOString();
  const oneDayAgoIso = new Date(nowMs - 24 * 3600 * 1000).toISOString();

  // Rate limit: max 20 captured alerts per minute per user.
  const recentMinute = $app.findRecordsByFilter(
    "fuloos_captured_alerts",
    "user_id = {:uid} && created_at_iso >= {:since}",
    "",
    21,
    0,
    { uid: userId, since: oneMinAgoIso },
  );
  if (recentMinute.length >= 20) {
    return e.json(429, {
      message: "Rate limit exceeded. Please wait a minute before sending more alerts.",
    });
  }

  const rawHash = lib.sha256Hex(rawText.replace(/\s+/g, " ").trim());
  const existing = $app.findRecordsByFilter(
    "fuloos_captured_alerts",
    "user_id = {:uid} && raw_hash = {:hash} && created_at_iso >= {:since}",
    "",
    1,
    0,
    { uid: userId, hash: rawHash, since: oneDayAgoIso },
  );
  if (existing.length > 0) {
    return e.json(200, {
      ok: true,
      deduplicated: true,
      id: existing[0].id,
    });
  }

  const parsed = lib.parseBankAlertText(
    rawText,
    payload.subject,
    lib.uaeDateString(new Date(nowMs)),
  );
  if (parsed.is_skip) {
    return e.json(200, {
      ok: true,
      skipped: true,
      reason: parsed.skip_reason || "ignored",
    });
  }

  const rec = new Record(alertsCol);
  rec.set("user_id", userId);
  rec.set("source", payload.source);
  rec.set("subject", payload.subject);
  rec.set("raw_text", rawText);
  rec.set("raw_hash", rawHash);
  rec.set("parsed_type", parsed.parsed_type);
  rec.set("parsed_amount", parsed.parsed_amount);
  rec.set("parsed_date", parsed.parsed_date);
  rec.set("parsed_payee", parsed.parsed_payee);
  rec.set("parsed_notes", parsed.parsed_notes);
  rec.set("account_hint", parsed.account_hint);
  rec.set("status", "pending");
  rec.set("created_at_iso", nowIso);
  $app.save(rec);

  return e.json(201, {
    ok: true,
    id: rec.id,
    parsed_type: parsed.parsed_type,
    parsed_amount: parsed.parsed_amount,
    parsed_date: parsed.parsed_date,
    parsed_payee: parsed.parsed_payee,
  });
});

routerAdd(
  "POST",
  "/api/fuloos/capture-token/rotate",
  (e) => {
    const lib = require(__hooks + "/inbound_capture_lib.js");

    const auth = e.auth;
    if (!auth || auth.collection().name !== "fuloos_users") {
      return e.json(401, { message: "Authentication required." });
    }

    let tokensCol;
    try {
      tokensCol = $app.findCollectionByNameOrId("fuloos_capture_tokens");
    } catch (_) {
      return e.json(503, {
        message: "Captured alerts migration is not installed on the server yet.",
      });
    }
    if (!tokensCol) {
      return e.json(503, {
        message: "Captured alerts migration is not installed on the server yet.",
      });
    }

    const userId = auth.id;
    const token = "flc_" + $security.randomString(40);
    const tokenHash = lib.sha256Hex(token);
    const preview = token.slice(0, 8) + "…" + token.slice(-4);

    const existing = $app.findRecordsByFilter(
      "fuloos_capture_tokens",
      "user_id = {:uid}",
      "",
      1,
      0,
      { uid: userId },
    );

    const rec = existing.length > 0 ? existing[0] : new Record(tokensCol);
    rec.set("user_id", userId);
    rec.set("token_hash", tokenHash);
    rec.set("token_preview", preview);
    rec.set("enabled", true);
    if (existing.length === 0) {
      rec.set("default_account_id", "");
    }
    $app.save(rec);

    return e.json(200, {
      id: rec.id,
      token: token,
      token_preview: preview,
      enabled: rec.getBool("enabled"),
      default_account_id: rec.getString("default_account_id") || null,
    });
  },
  $apis.requireAuth("fuloos_users"),
);
