// Additive upgrade: adds per-user Web Push subscriptions (`fuloos_push_subscriptions`)
// and extends `fuloos_notification_log.channel` to allow `"push"`.
migrate(
  (app) => {
    const owner =
      "@request.auth.collectionName = 'fuloos_users' && user_id = @request.auth.id";
    const createOwner =
      "@request.auth.collectionName = 'fuloos_users' && @request.body.user_id = @request.auth.id";
    const updateOwner =
      owner +
      " && (@request.body.user_id:isset = false || @request.body.user_id = @request.auth.id)";

    const users = app.findCollectionByNameOrId("fuloos_users");

    const subs = new Collection({
      id: "fulooswebpush01",
      name: "fuloos_push_subscriptions",
      type: "base",
      listRule: owner,
      viewRule: owner,
      createRule: createOwner,
      updateRule: updateOwner,
      deleteRule: owner,
      fields: [
        {
          name: "user_id",
          type: "relation",
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: "endpoint",
          type: "text",
          required: true,
          min: 10,
          max: 2048,
        },
        {
          name: "p256dh",
          type: "text",
          required: true,
          min: 10,
          max: 512,
        },
        {
          name: "auth",
          type: "text",
          required: true,
          min: 10,
          max: 256,
        },
        {
          name: "user_agent",
          type: "text",
          max: 300,
        },
        {
          name: "created_at_iso",
          type: "text",
          max: 64,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_fuloos_push_sub_user_endpoint ON fuloos_push_subscriptions (user_id, endpoint)",
        "CREATE INDEX idx_fuloos_push_sub_user ON fuloos_push_subscriptions (user_id)",
      ],
    });
    app.save(subs);

    for (const action of ["INSERT", "UPDATE"]) {
      const when = action.toLowerCase();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_push_subscriptions_${when} BEFORE ${action} ON fuloos_push_subscriptions BEGIN
      SELECT CASE WHEN trim(COALESCE(NEW.user_id,''))='' THEN RAISE(ABORT,'Push subscription requires a user') END;
      SELECT CASE WHEN trim(COALESCE(NEW.endpoint,''))='' OR length(NEW.endpoint)<10 OR length(NEW.endpoint)>2048 OR (NEW.endpoint NOT LIKE 'https://%' AND NEW.endpoint NOT LIKE 'http://localhost%' AND NEW.endpoint NOT LIKE 'http://127.0.0.1%') THEN RAISE(ABORT,'Push endpoint must be a valid HTTPS (or localhost) URL') END;
      SELECT CASE WHEN trim(COALESCE(NEW.p256dh,''))='' OR length(NEW.p256dh)<10 OR length(NEW.p256dh)>512 THEN RAISE(ABORT,'Push p256dh key must contain 10-512 characters') END;
      SELECT CASE WHEN trim(COALESCE(NEW.auth,''))='' OR length(NEW.auth)<10 OR length(NEW.auth)>256 THEN RAISE(ABORT,'Push auth secret must contain 10-256 characters') END;
      SELECT CASE WHEN length(COALESCE(NEW.user_agent,''))>300 THEN RAISE(ABORT,'User agent must be 300 characters or fewer') END;
      SELECT CASE WHEN length(COALESCE(NEW.created_at_iso,''))>64 THEN RAISE(ABORT,'Timestamp must be 64 characters or fewer') END;
    END`,
        )
        .execute();
    }

    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_push_subscriptions_owner_update BEFORE UPDATE OF user_id ON fuloos_push_subscriptions WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Ownership cannot be changed'); END`,
      )
      .execute();

    // Extend fuloos_notification_log.channel to allow "push" alongside "email".
    try {
      const logCol = app.findCollectionByNameOrId("fuloos_notification_log");
      if (logCol) {
        const channelField = logCol.fields.getByName("channel");
        if (channelField && Array.isArray(channelField.values)) {
          if (!channelField.values.includes("push")) {
            channelField.values = ["email", "push"];
            app.save(logCol);
          }
        }
        for (const action of ["INSERT", "UPDATE"]) {
          const when = action.toLowerCase();
          app
            .db()
            .newQuery(`DROP TRIGGER IF EXISTS fuloos_notification_log_${when}`)
            .execute();
          app
            .db()
            .newQuery(
              `CREATE TRIGGER fuloos_notification_log_${when} BEFORE ${action} ON fuloos_notification_log BEGIN
      SELECT CASE WHEN trim(COALESCE(NEW.user_id,''))='' THEN RAISE(ABORT,'Notification log requires a user') END;
      SELECT CASE WHEN trim(COALESCE(NEW.dedup_key,''))='' OR length(NEW.dedup_key)>200 THEN RAISE(ABORT,'Dedup key must contain 1-200 characters') END;
      SELECT CASE WHEN NEW.channel NOT IN ('email','push') THEN RAISE(ABORT,'Invalid notification channel') END;
      SELECT CASE WHEN NEW.event_type NOT IN ('upcoming_bill','overdue_bill','budget_80','budget_100','weekly_digest','test') THEN RAISE(ABORT,'Invalid notification event type') END;
      SELECT CASE WHEN trim(COALESCE(NEW.period_key,''))='' OR length(NEW.period_key)>64 THEN RAISE(ABORT,'Period key must contain 1-64 characters') END;
    END`,
            )
            .execute();
        }
      }
    } catch (_) {
      // If notifications migration isn't present in a partial test DB, skip log extension.
    }
  },
  (app) => {
    for (const trigger of [
      "fuloos_push_subscriptions_owner_update",
      "fuloos_push_subscriptions_update",
      "fuloos_push_subscriptions_insert",
    ]) {
      app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    }
    try {
      app.delete(app.findCollectionByNameOrId("fuloos_push_subscriptions"));
    } catch (_) {
      // Already deleted.
    }
  },
);
