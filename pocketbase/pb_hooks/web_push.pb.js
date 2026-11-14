/// <reference path="../pb_data/types.d.ts" />

// Authenticated, rate-limited Web Push test endpoint.
routerAdd("POST", "/api/fuloos/push-test", (e) => {
  const notifLib = require(__hooks + "/notifications_lib.js");
  const pushLib = require(__hooks + "/web_push_lib.js");

  const auth = e.auth;
  if (!auth || auth.collection().name !== "fuloos_users") {
    return e.json(401, { message: "Authentication required." });
  }

  let subsCol;
  let logCol;
  try {
    subsCol = $app.findCollectionByNameOrId("fuloos_push_subscriptions");
    logCol = $app.findCollectionByNameOrId("fuloos_notification_log");
  } catch (_) {
    return e.json(503, {
      message: "Web Push migration is not installed on the server yet.",
    });
  }
  if (!subsCol || !logCol) {
    return e.json(503, {
      message: "Web Push migration is not installed on the server yet.",
    });
  }

  const userId = auth.id;

  // Rate limit: max 3 test pushes per hour and at least 60s between sends.
  const oneHourAgo = new Date(Date.now() - 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const oneMinAgo = new Date(Date.now() - 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const recentHour = $app.findRecordsByFilter(
    "fuloos_notification_log",
    "user_id = {:uid} && channel = 'push' && event_type = 'test' && sent_at >= {:since}",
    "-sent_at",
    10,
    0,
    { uid: userId, since: oneHourAgo },
  );
  if (recentHour.length >= 3) {
    return e.json(429, {
      message:
        "Rate limit exceeded. You can send up to 3 test push notifications per hour.",
    });
  }
  if (recentHour.length > 0 && recentHour[0].getString("sent_at") >= oneMinAgo) {
    return e.json(429, {
      message:
        "Please wait a minute before sending another test push notification.",
    });
  }

  const subs = $app.findRecordsByFilter(
    "fuloos_push_subscriptions",
    "user_id = {:uid}",
    "",
    50,
    0,
    { uid: userId },
  );
  if (subs.length === 0) {
    return e.json(400, {
      message: "No Web Push subscriptions found for your account.",
    });
  }

  const envFn = (k) => $os.getenv(k) || "";
  if (!pushLib.isPushRelayConfigured(envFn)) {
    return e.json(503, {
      message:
        "Web Push relay is not configured on the PocketBase server (PUSH_RELAY_URL is missing).",
    });
  }

  const message = notifLib.buildPushMessage({ eventType: "test", payload: {} });
  let sentCount = 0;
  for (const subRec of subs) {
    try {
      const res = pushLib.dispatchPushToSubscription(
        $http.send,
        {
          endpoint: subRec.getString("endpoint"),
          p256dh: subRec.getString("p256dh"),
          auth: subRec.getString("auth"),
        },
        message,
        envFn,
      );
      if (res.ok) {
        sentCount++;
      } else if (res.gone) {
        try {
          $app.delete(subRec);
        } catch (_) {
          // Ignore cleanup failure
        }
      }
    } catch (err) {
      $app
        .logger()
        .error("Test push send failed", "userId", userId, "error", String(err));
    }
  }

  if (sentCount === 0) {
    return e.json(502, {
      message:
        "Could not deliver test push notification. Check PUSH_RELAY_URL and browser subscription.",
    });
  }

  const nowKey = String(Date.now());
  const logRec = new Record(logCol);
  logRec.set("user_id", userId);
  logRec.set(
    "dedup_key",
    "push:test:" + nowKey + ":" + Math.random().toString(36).slice(2, 8),
  );
  logRec.set("channel", "push");
  logRec.set("event_type", "test");
  logRec.set("period_key", nowKey);
  logRec.set("subject", String(message.title || "").slice(0, 200));
  $app.save(logRec);

  return e.json(200, {
    ok: true,
    message:
      "Test push notification sent to " +
      sentCount +
      (sentCount === 1 ? " device." : " devices."),
  });
});
