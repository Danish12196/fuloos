// Additive upgrade: adds per-user notification preferences and a deduplicated sent-log
// for server-side email notifications (and future pluggable channels).
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

    const prefs = new Collection({
      id: "fuloosnpref0001",
      name: "fuloos_notification_prefs",
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
        { name: "email_enabled", type: "bool" },
        { name: "upcoming_bill_enabled", type: "bool" },
        {
          name: "upcoming_bill_days",
          type: "number",
          onlyInt: true,
          min: 0,
          max: 30,
        },
        { name: "overdue_enabled", type: "bool" },
        { name: "budget_80_enabled", type: "bool" },
        { name: "budget_100_enabled", type: "bool" },
        { name: "weekly_digest_enabled", type: "bool" },
        {
          name: "digest_day",
          type: "select",
          maxSelect: 1,
          values: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
        },
        { name: "timezone", type: "text", max: 64 },
        { name: "channels", type: "json", maxSize: 4000 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_fuloos_notification_prefs_user ON fuloos_notification_prefs (user_id)",
      ],
    });
    app.save(prefs);

    const log = new Collection({
      id: "fuloosnlog00001",
      name: "fuloos_notification_log",
      type: "base",
      listRule: owner,
      viewRule: owner,
      createRule: null,
      updateRule: null,
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
          name: "dedup_key",
          type: "text",
          required: true,
          min: 1,
          max: 200,
        },
        {
          name: "channel",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["email"],
        },
        {
          name: "event_type",
          type: "select",
          required: true,
          maxSelect: 1,
          values: [
            "upcoming_bill",
            "overdue_bill",
            "budget_80",
            "budget_100",
            "weekly_digest",
            "test",
          ],
        },
        {
          name: "period_key",
          type: "text",
          required: true,
          min: 1,
          max: 64,
        },
        {
          name: "subject",
          type: "text",
          max: 200,
        },
        {
          name: "sent_at",
          type: "autodate",
          onCreate: true,
          onUpdate: false,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_fuloos_notification_log_dedup ON fuloos_notification_log (user_id, dedup_key)",
        "CREATE INDEX idx_fuloos_notification_log_user_sent ON fuloos_notification_log (user_id, sent_at)",
      ],
    });
    app.save(log);

    for (const action of ["INSERT", "UPDATE"]) {
      const when = action.toLowerCase();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_notification_prefs_${when} BEFORE ${action} ON fuloos_notification_prefs BEGIN
      SELECT CASE WHEN trim(COALESCE(NEW.user_id,''))='' THEN RAISE(ABORT,'Preferences require a user') END;
      SELECT CASE WHEN NEW.upcoming_bill_days IS NOT NULL AND (typeof(NEW.upcoming_bill_days) NOT IN ('integer','real') OR NEW.upcoming_bill_days != CAST(NEW.upcoming_bill_days AS INTEGER) OR NEW.upcoming_bill_days < 0 OR NEW.upcoming_bill_days > 30) THEN RAISE(ABORT,'Upcoming bill days must be an integer between 0 and 30') END;
      SELECT CASE WHEN COALESCE(NEW.digest_day,'')!='' AND NEW.digest_day NOT IN ('sun','mon','tue','wed','thu','fri','sat') THEN RAISE(ABORT,'Invalid digest day') END;
      SELECT CASE WHEN length(COALESCE(NEW.timezone,''))>64 THEN RAISE(ABORT,'Timezone must be 64 characters or fewer') END;
      SELECT CASE WHEN NEW.channels IS NOT NULL AND NEW.channels NOT IN ('','null') AND (json_valid(NEW.channels)=0 OR json_type(NEW.channels)!='object') THEN RAISE(ABORT,'Channels must be a JSON object') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_notification_prefs p WHERE p.user_id=NEW.user_id AND p.id!=NEW.id) THEN RAISE(ABORT,'Notification preferences already exist for this user') END;
    END`,
        )
        .execute();

      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_notification_log_${when} BEFORE ${action} ON fuloos_notification_log BEGIN
      SELECT CASE WHEN trim(COALESCE(NEW.user_id,''))='' THEN RAISE(ABORT,'Notification log requires a user') END;
      SELECT CASE WHEN trim(COALESCE(NEW.dedup_key,''))='' OR length(NEW.dedup_key)>200 THEN RAISE(ABORT,'Dedup key must contain 1-200 characters') END;
      SELECT CASE WHEN NEW.channel NOT IN ('email') THEN RAISE(ABORT,'Invalid notification channel') END;
      SELECT CASE WHEN NEW.event_type NOT IN ('upcoming_bill','overdue_bill','budget_80','budget_100','weekly_digest','test') THEN RAISE(ABORT,'Invalid notification event type') END;
      SELECT CASE WHEN trim(COALESCE(NEW.period_key,''))='' OR length(NEW.period_key)>64 THEN RAISE(ABORT,'Period key must contain 1-64 characters') END;
    END`,
        )
        .execute();
    }

    for (const table of [
      "fuloos_notification_prefs",
      "fuloos_notification_log",
    ]) {
      app
        .db()
        .newQuery(
          `CREATE TRIGGER ${table}_owner_update BEFORE UPDATE OF user_id ON ${table} WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Ownership cannot be changed'); END`,
        )
        .execute();
    }
  },
  (app) => {
    for (const trigger of [
      "fuloos_notification_log_owner_update",
      "fuloos_notification_prefs_owner_update",
      "fuloos_notification_log_update",
      "fuloos_notification_log_insert",
      "fuloos_notification_prefs_update",
      "fuloos_notification_prefs_insert",
    ]) {
      app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    }
    app.delete(app.findCollectionByNameOrId("fuloos_notification_log"));
    app.delete(app.findCollectionByNameOrId("fuloos_notification_prefs"));
  },
);
