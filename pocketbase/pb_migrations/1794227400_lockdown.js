// Additive lockdown upgrade:
// - lets a signed-in user delete their own fuloos_users record (the app removes recurring
//   schedules and transactions first so account/category delete guards never block the cascade);
// - adds owner-only collections for the AI suggestion feature: per-user settings/consents and a
//   correction log. Raw SMS text is never stored; merchant_text is the cleaned, masked merchant string.
migrate(
  (app) => {
    const owner =
      "@request.auth.collectionName = 'fuloos_users' && user_id = @request.auth.id";
    const createOwner =
      "@request.auth.collectionName = 'fuloos_users' && @request.body.user_id = @request.auth.id";
    const updateOwner =
      owner +
      " && (@request.body.user_id:isset = false || @request.body.user_id = @request.auth.id)";
    const rules = {
      listRule: owner,
      viewRule: owner,
      createRule: createOwner,
      updateRule: updateOwner,
      deleteRule: owner,
    };

    const users = app.findCollectionByNameOrId("fuloos_users");
    users.deleteRule =
      "@request.auth.collectionName = 'fuloos_users' && id = @request.auth.id";
    app.save(users);

    const categories = app.findCollectionByNameOrId("fuloos_categories");
    const ownership = {
      name: "user_id",
      type: "relation",
      required: true,
      collectionId: users.id,
      maxSelect: 1,
      cascadeDelete: true,
    };

    const settings = new Collection({
      id: "fuloosmlset0001",
      name: "fuloos_ml_settings",
      type: "base",
      ...rules,
      fields: [
        ownership,
        // "Learn from my categorisation" (personal model, on this account only).
        { name: "learn_consent", type: "bool" },
        // "Share masked examples to improve the base model".
        { name: "share_consent", type: "bool" },
        // Version of the consent wording the user agreed to, and when.
        { name: "consent_version", type: "text", max: 32 },
        { name: "consent_at", type: "date" },
        // { "<model category>": ["<fuloos_categories id>", ...] } for the base model's categories.
        { name: "category_map", type: "json", maxSize: 20000 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_fuloos_ml_settings_user ON fuloos_ml_settings (user_id)",
      ],
    });
    app.save(settings);

    const examples = new Collection({
      id: "fuloosmlexm0001",
      name: "fuloos_ml_examples",
      type: "base",
      ...rules,
      fields: [
        ownership,
        // Cleaned and masked merchant string (no card/account numbers, never the raw SMS).
        {
          name: "merchant_text",
          type: "text",
          required: true,
          min: 1,
          max: 120,
        },
        { name: "payee", type: "text", max: 160 },
        {
          name: "amount",
          type: "number",
          onlyInt: true,
          min: 0,
          max: 100000000000,
        },
        {
          // Optional: removing a category clears this link but keeps the example.
          name: "category_id",
          type: "relation",
          collectionId: categories.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "source",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["sms", "csv", "manual"],
        },
        { name: "model_version", type: "text", max: 32 },
        { name: "suggested_category", type: "text", max: 64 },
        { name: "accepted", type: "bool" },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_ml_examples_user ON fuloos_ml_examples (user_id,created)",
        "CREATE INDEX idx_fuloos_ml_examples_category ON fuloos_ml_examples (category_id)",
      ],
    });
    app.save(examples);

    for (const action of ["INSERT", "UPDATE"]) {
      const when = action.toLowerCase();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_ml_settings_${when} BEFORE ${action} ON fuloos_ml_settings BEGIN
      SELECT CASE WHEN NEW.category_map IS NOT NULL AND NEW.category_map NOT IN ('','null') AND (json_valid(NEW.category_map)=0 OR json_type(NEW.category_map)!='object') THEN RAISE(ABORT,'Category map must be a JSON object') END;
    END`,
        )
        .execute();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_ml_examples_${when} BEFORE ${action} ON fuloos_ml_examples BEGIN
      SELECT CASE WHEN COALESCE(NEW.category_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN NEW.amount IS NOT NULL AND (typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000) THEN RAISE(ABORT,'Amount must be nonnegative integer fils') END;
      SELECT CASE WHEN trim(COALESCE(NEW.merchant_text,''))='' OR length(NEW.merchant_text)>120 THEN RAISE(ABORT,'Merchant text must contain 1-120 characters') END;
      SELECT CASE WHEN NEW.source NOT IN ('sms','csv','manual') THEN RAISE(ABORT,'Invalid example source') END;
    END`,
        )
        .execute();
    }
    for (const table of ["fuloos_ml_settings", "fuloos_ml_examples"])
      app
        .db()
        .newQuery(
          `CREATE TRIGGER ${table}_owner_update BEFORE UPDATE OF user_id ON ${table} WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Ownership cannot be changed'); END`,
        )
        .execute();
  },
  (app) => {
    for (const trigger of [
      "fuloos_ml_examples_owner_update",
      "fuloos_ml_settings_owner_update",
      "fuloos_ml_examples_update",
      "fuloos_ml_examples_insert",
      "fuloos_ml_settings_update",
      "fuloos_ml_settings_insert",
    ])
      app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    app.delete(app.findCollectionByNameOrId("fuloos_ml_examples"));
    app.delete(app.findCollectionByNameOrId("fuloos_ml_settings"));
    const users = app.findCollectionByNameOrId("fuloos_users");
    users.deleteRule = null;
    app.save(users);
  },
);
