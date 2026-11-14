// Additive upgrade: adds per-user capture tokens and captured alerts queue
// for email-forwarding and iOS Shortcut / Android Tasker / clipboard capture.
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
    const accounts = app.findCollectionByNameOrId("fuloos_accounts");

    const tokens = new Collection({
      id: "fulooscaptok001",
      name: "fuloos_capture_tokens",
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
          name: "token_hash",
          type: "text",
          required: true,
          min: 64,
          max: 64,
        },
        {
          name: "token_preview",
          type: "text",
          required: false,
          max: 32,
        },
        {
          name: "enabled",
          type: "bool",
        },
        {
          name: "default_account_id",
          type: "relation",
          required: false,
          collectionId: accounts.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_fuloos_capture_tokens_user ON fuloos_capture_tokens (user_id)",
        "CREATE UNIQUE INDEX idx_fuloos_capture_tokens_hash ON fuloos_capture_tokens (token_hash)",
      ],
    });
    app.save(tokens);

    const alerts = new Collection({
      id: "fulooscapalt001",
      name: "fuloos_captured_alerts",
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
          name: "source",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["email", "shortcut"],
        },
        {
          name: "subject",
          type: "text",
          required: false,
          max: 200,
        },
        {
          name: "raw_text",
          type: "text",
          required: true,
          min: 1,
          max: 8000,
        },
        {
          name: "raw_hash",
          type: "text",
          required: false,
          max: 64,
        },
        {
          name: "parsed_type",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["expense", "income", "unknown"],
        },
        {
          name: "parsed_amount",
          type: "number",
          required: false,
          onlyInt: true,
          min: 0,
          max: 100000000000,
        },
        {
          name: "parsed_date",
          type: "text",
          required: false,
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        {
          name: "parsed_payee",
          type: "text",
          required: false,
          max: 120,
        },
        {
          name: "parsed_notes",
          type: "text",
          required: false,
          max: 500,
        },
        {
          name: "account_hint",
          type: "text",
          required: false,
          max: 64,
        },
        {
          name: "status",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["pending", "imported", "dismissed"],
        },
        {
          name: "created_at_iso",
          type: "text",
          required: true,
          min: 10,
          max: 40,
        },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_captured_alerts_user_status ON fuloos_captured_alerts (user_id, status)",
        "CREATE INDEX idx_fuloos_captured_alerts_user_hash ON fuloos_captured_alerts (user_id, raw_hash, created_at_iso)",
      ],
    });
    app.save(alerts);

    for (const action of ["INSERT", "UPDATE"]) {
      const when = action.toLowerCase();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_capture_tokens_${when} BEFORE ${action} ON fuloos_capture_tokens BEGIN
      SELECT CASE WHEN trim(COALESCE(NEW.user_id,''))='' THEN RAISE(ABORT,'Capture token requires a user') END;
      SELECT CASE WHEN length(COALESCE(NEW.token_hash,''))!=64 THEN RAISE(ABORT,'Token hash must be 64 characters') END;
      SELECT CASE WHEN COALESCE(NEW.default_account_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.default_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Default account belongs to another user or does not exist') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_capture_tokens t WHERE t.user_id=NEW.user_id AND t.id!=NEW.id) THEN RAISE(ABORT,'Capture token already exists for this user') END;
    END`,
        )
        .execute();

      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_captured_alerts_${when} BEFORE ${action} ON fuloos_captured_alerts BEGIN
      SELECT CASE WHEN trim(COALESCE(NEW.user_id,''))='' THEN RAISE(ABORT,'Captured alert requires a user') END;
      SELECT CASE WHEN NEW.source NOT IN ('email','shortcut') THEN RAISE(ABORT,'Invalid alert source') END;
      SELECT CASE WHEN trim(COALESCE(NEW.raw_text,''))='' OR length(NEW.raw_text)>8000 THEN RAISE(ABORT,'Raw alert text must contain 1-8000 characters') END;
      SELECT CASE WHEN NEW.parsed_type NOT IN ('expense','income','unknown') THEN RAISE(ABORT,'Invalid parsed alert type') END;
      SELECT CASE WHEN NEW.parsed_amount IS NOT NULL AND (typeof(NEW.parsed_amount) NOT IN ('integer','real') OR NEW.parsed_amount != CAST(NEW.parsed_amount AS INTEGER) OR NEW.parsed_amount < 0 OR NEW.parsed_amount > 100000000000) THEN RAISE(ABORT,'Parsed amount must be integer fils') END;
      SELECT CASE WHEN COALESCE(NEW.parsed_date,'')!='' AND (length(NEW.parsed_date)!=10 OR strftime('%Y-%m-%d', NEW.parsed_date) IS NOT NEW.parsed_date) THEN RAISE(ABORT,'Invalid parsed date') END;
      SELECT CASE WHEN NEW.status NOT IN ('pending','imported','dismissed') THEN RAISE(ABORT,'Invalid alert status') END;
      SELECT CASE WHEN trim(COALESCE(NEW.created_at_iso,''))='' THEN RAISE(ABORT,'Alert requires created_at_iso') END;
    END`,
        )
        .execute();
    }

    for (const table of ["fuloos_capture_tokens", "fuloos_captured_alerts"]) {
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
      "fuloos_captured_alerts_owner_update",
      "fuloos_capture_tokens_owner_update",
      "fuloos_captured_alerts_update",
      "fuloos_captured_alerts_insert",
      "fuloos_capture_tokens_update",
      "fuloos_capture_tokens_insert",
    ]) {
      app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    }
    app.delete(app.findCollectionByNameOrId("fuloos_captured_alerts"));
    app.delete(app.findCollectionByNameOrId("fuloos_capture_tokens"));
  },
);
