/// <reference path="../pb_data/types.d.ts" />

// Hourly notification runner: evaluates opt-in users' upcoming bills, overdue
// recurring items, budget 80%/100% thresholds, and weekly summary digests.
cronAdd("fuloos_notifications_hourly", "0 * * * *", () => {
  const lib = require(__hooks + "/notifications_lib.js");

  let prefsCol;
  let logCol;
  try {
    prefsCol = $app.findCollectionByNameOrId("fuloos_notification_prefs");
    logCol = $app.findCollectionByNameOrId("fuloos_notification_log");
  } catch (_) {
    // Notifications migration not applied yet; nothing to do.
    return;
  }
  if (!prefsCol || !logCol) return;

  const pushLib = require(__hooks + "/web_push_lib.js");
  const envFn = (k) => $os.getenv(k) || "";
  const pushConfigured = pushLib.isPushRelayConfigured(envFn);

  const appUrl = $os.getenv("APP_URL") || "";
  const settings = $app.settings();
  const senderAddress = settings.meta.senderAddress || "noreply@fuloos.local";
  const senderName = settings.meta.senderName || "Fuloos";

  const dispatcher = lib.createChannelDispatcher({
    email: (recipient, message) => {
      const mail = new MailerMessage({
        from: { address: senderAddress, name: senderName },
        to: [{ address: recipient }],
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      $app.newMailClient().send(mail);
    },
    push: pushConfigured
      ? (_recipient, message, meta) => {
          const uid = meta && meta.userId;
          if (!uid) return false;
          let subs = [];
          try {
            subs = $app.findRecordsByFilter(
              "fuloos_push_subscriptions",
              "user_id = {:uid}",
              "",
              50,
              0,
              { uid },
            );
          } catch (_) {
            return false;
          }
          if (!subs || subs.length === 0) return false;
          let sentAny = false;
          for (const subRec of subs) {
            const subObj = {
              endpoint: subRec.getString("endpoint"),
              p256dh: subRec.getString("p256dh"),
              auth: subRec.getString("auth"),
            };
            const res = pushLib.dispatchPushToSubscription(
              $http.send,
              subObj,
              message,
              envFn,
            );
            if (res.ok) {
              sentAny = true;
            } else if (res.gone) {
              try {
                $app.delete(subRec);
              } catch (_) {
                // Ignore cleanup error
              }
            }
          }
          return sentAny;
        }
      : undefined,
  });

  const prefRecords = $app.findRecordsByFilter(
    "fuloos_notification_prefs",
    "email_enabled = true || channels != ''",
    "",
    500,
    0,
  );

  for (const prefRec of prefRecords) {
    try {
      const userId = prefRec.getString("user_id");
      if (!userId) continue;

      const prefs = {
        email_enabled: prefRec.getBool("email_enabled"),
        upcoming_bill_enabled: prefRec.getBool("upcoming_bill_enabled"),
        upcoming_bill_days: prefRec.getInt("upcoming_bill_days"),
        overdue_enabled: prefRec.getBool("overdue_enabled"),
        budget_80_enabled: prefRec.getBool("budget_80_enabled"),
        budget_100_enabled: prefRec.getBool("budget_100_enabled"),
        weekly_digest_enabled: prefRec.getBool("weekly_digest_enabled"),
        digest_day: prefRec.getString("digest_day") || "sun",
        timezone: prefRec.getString("timezone") || "Asia/Dubai",
        channels: prefRec.get("channels"),
      };

      if (
        !prefs.upcoming_bill_enabled &&
        !prefs.overdue_enabled &&
        !prefs.budget_80_enabled &&
        !prefs.budget_100_enabled &&
        !prefs.weekly_digest_enabled
      ) {
        continue;
      }

      let userRec;
      try {
        userRec = $app.findRecordById("fuloos_users", userId);
      } catch (_) {
        continue;
      }
      const userEmail = userRec.email ? userRec.email() : userRec.getString("email");

      const asOfDate = lib.todayInTimezone(prefs.timezone, new Date());

      const toPlainRecurring = (r) => ({
        id: r.id,
        name: r.getString("name"),
        type: r.getString("type"),
        amount: r.getInt("amount"),
        amount_type: r.getString("amount_type"),
        account_id: r.getString("account_id"),
        category_id: r.getString("category_id") || null,
        frequency: r.getString("frequency"),
        start_date: r.getString("start_date"),
        end_date: r.getString("end_date") || null,
        status: r.getString("status"),
      });

      const toPlainOccurrence = (o) => ({
        id: o.id,
        recurring_id: o.getString("recurring_id"),
        occurrence_date: o.getString("occurrence_date"),
        transaction_id: o.getString("transaction_id"),
      });

      const toPlainBudget = (b) => ({
        id: b.id,
        category_id: b.getString("category_id"),
        amount: b.getInt("amount"),
        start_month: b.getString("start_month"),
        end_month: b.getString("end_month") || null,
      });

      const toPlainCategory = (c) => ({
        id: c.id,
        name: c.getString("name"),
      });

      const toPlainTx = (t) => ({
        id: t.id,
        type: t.getString("type"),
        amount: t.getInt("amount"),
        category_id: t.getString("category_id") || null,
        date: t.getString("date"),
      });

      const loadAll = (collection, mapper) => {
        try {
          const rows = $app.findRecordsByFilter(
            collection,
            "user_id = {:uid}",
            "",
            2000,
            0,
            { uid: userId },
          );
          return rows.map(mapper);
        } catch (_) {
          return [];
        }
      };

      const ledger = {
        recurring: loadAll("fuloos_recurring", toPlainRecurring),
        recurring_occurrences: loadAll(
          "fuloos_recurring_occurrences",
          toPlainOccurrence,
        ),
        budgets: loadAll("fuloos_budgets", toPlainBudget),
        categories: loadAll("fuloos_categories", toPlainCategory),
        transactions: loadAll("fuloos_transactions", toPlainTx),
      };

      const pending = lib.collectPendingNotifications(ledger, prefs, asOfDate);

      for (const ev of pending) {
        if (!dispatcher.supports(ev.channel)) continue;

        const existing = $app.findRecordsByFilter(
          "fuloos_notification_log",
          "user_id = {:uid} && dedup_key = {:key}",
          "",
          1,
          0,
          { uid: userId, key: ev.dedupKey },
        );
        if (existing.length > 0) continue;

        if (ev.channel === "email" && !userEmail) continue;
        const message =
          ev.channel === "push"
            ? lib.buildPushMessage(ev)
            : lib.buildEmailMessage(ev, appUrl);
        try {
          const sent = dispatcher.send(
            ev.channel,
            ev.channel === "push" ? userId : userEmail,
            message,
            { userId },
          );
          if (ev.channel === "push" && sent === false) continue;
          const logRec = new Record(logCol);
          logRec.set("user_id", userId);
          logRec.set("dedup_key", ev.dedupKey);
          logRec.set("channel", ev.channel);
          logRec.set("event_type", ev.eventType);
          logRec.set("period_key", ev.periodKey);
          logRec.set(
            "subject",
            String(message.subject || message.title || "").slice(0, 200),
          );
          $app.save(logRec);
        } catch (sendErr) {
          $app
            .logger()
            .error(
              "Failed sending notification",
              "userId",
              userId,
              "dedupKey",
              ev.dedupKey,
              "error",
              String(sendErr),
            );
        }
      }
    } catch (userErr) {
      $app
        .logger()
        .error("Notification cron error for user", "error", String(userErr));
    }
  }
});

// Authenticated, rate-limited test email endpoint.
routerAdd("POST", "/api/fuloos/notify-test", (e) => {
  const lib = require(__hooks + "/notifications_lib.js");

  const auth = e.auth;
  if (!auth || auth.collection().name !== "fuloos_users") {
    return e.json(401, { message: "Authentication required." });
  }

  let logCol;
  try {
    logCol = $app.findCollectionByNameOrId("fuloos_notification_log");
  } catch (_) {
    return e.json(503, {
      message: "Notifications migration is not installed on the server yet.",
    });
  }

  const userId = auth.id;
  const userEmail = auth.email ? auth.email() : auth.getString("email");
  if (!userEmail) {
    return e.json(400, { message: "No email address found for your account." });
  }

  // Rate limit: max 3 test emails per hour and at least 60s between sends.
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
    "user_id = {:uid} && event_type = 'test' && sent_at >= {:since}",
    "-sent_at",
    10,
    0,
    { uid: userId, since: oneHourAgo },
  );
  if (recentHour.length >= 3) {
    return e.json(429, {
      message: "Rate limit exceeded. You can send up to 3 test emails per hour.",
    });
  }
  if (recentHour.length > 0 && recentHour[0].getString("sent_at") >= oneMinAgo) {
    return e.json(429, {
      message: "Please wait a minute before sending another test email.",
    });
  }

  const appUrl = $os.getenv("APP_URL") || "";
  const settings = $app.settings();
  const senderAddress = settings.meta.senderAddress || "noreply@fuloos.local";
  const senderName = settings.meta.senderName || "Fuloos";

  const message = lib.buildEmailMessage(
    { eventType: "test", payload: {} },
    appUrl,
  );

  try {
    const mail = new MailerMessage({
      from: { address: senderAddress, name: senderName },
      to: [{ address: userEmail }],
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    $app.newMailClient().send(mail);
  } catch (err) {
    $app
      .logger()
      .error("Test email send failed", "userId", userId, "error", String(err));
    return e.json(502, {
      message:
        "Could not send test email. Check that SMTP is configured on the PocketBase server.",
    });
  }

  const nowKey = String(Date.now());
  const logRec = new Record(logCol);
  logRec.set("user_id", userId);
  logRec.set(
    "dedup_key",
    "email:test:" + nowKey + ":" + Math.random().toString(36).slice(2, 8),
  );
  logRec.set("channel", "email");
  logRec.set("event_type", "test");
  logRec.set("period_key", nowKey);
  logRec.set("subject", String(message.subject || "").slice(0, 200));
  $app.save(logRec);

  return e.json(200, {
    ok: true,
    message: "Test email sent to " + userEmail + ".",
  });
});
