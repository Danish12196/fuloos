// Additive upgrade: adds per-category monthly budgets. Budgets never change balances; they are compared with expense transactions in the app.
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
    const categories = app.findCollectionByNameOrId("fuloos_categories");

    const budgets = new Collection({
      id: "fuloosbudgt0001",
      name: "fuloos_budgets",
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
          name: "category_id",
          type: "relation",
          required: true,
          collectionId: categories.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          // Monthly limit in integer fils. Not "required" so a zero budget is allowed.
          name: "amount",
          type: "number",
          required: false,
          onlyInt: true,
          min: 0,
          max: 100000000000,
        },
        {
          name: "start_month",
          type: "text",
          required: true,
          pattern: "^[0-9]{4}-[0-9]{2}$",
        },
        {
          // Empty means the budget repeats every month from start_month onward.
          name: "end_month",
          type: "text",
          pattern: "^[0-9]{4}-[0-9]{2}$",
        },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_budgets_user ON fuloos_budgets (user_id)",
        "CREATE INDEX idx_fuloos_budgets_category ON fuloos_budgets (category_id,start_month)",
      ],
    });
    app.save(budgets);

    for (const action of ["INSERT", "UPDATE"]) {
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_budgets_${action.toLowerCase()} BEFORE ${action} ON fuloos_budgets BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN NEW.amount IS NULL OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Budget must be nonnegative integer fils') END;
      SELECT CASE WHEN NEW.start_month IS NULL OR date(NEW.start_month || '-01') IS NULL OR date(NEW.start_month || '-01')!=NEW.start_month || '-01' OR NEW.start_month<'1970-01' OR NEW.start_month>'2100-12' THEN RAISE(ABORT,'Start month must be a valid YYYY-MM month between 1970-01 and 2100-12') END;
      SELECT CASE WHEN COALESCE(NEW.end_month,'')!='' AND (date(NEW.end_month || '-01') IS NULL OR date(NEW.end_month || '-01')!=NEW.end_month || '-01' OR NEW.end_month<NEW.start_month OR NEW.end_month>'2100-12') THEN RAISE(ABORT,'End month must be valid and on or after start month') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_budgets b WHERE b.user_id=NEW.user_id AND b.category_id=NEW.category_id AND b.id!=NEW.id AND b.start_month<=COALESCE(NULLIF(NEW.end_month,''),'9999-12') AND COALESCE(NULLIF(b.end_month,''),'9999-12')>=NEW.start_month) THEN RAISE(ABORT,'Budget months overlap an existing budget for this category') END;
    END`,
        )
        .execute();
    }

    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_budgets_owner_update BEFORE UPDATE OF user_id ON fuloos_budgets WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Budget ownership cannot be changed'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_category_delete_budgets AFTER DELETE ON fuloos_categories BEGIN DELETE FROM fuloos_budgets WHERE category_id=OLD.id; END`,
      )
      .execute();
  },
  (app) => {
    for (const trigger of [
      "fuloos_category_delete_budgets",
      "fuloos_budgets_owner_update",
      "fuloos_budgets_update",
      "fuloos_budgets_insert",
    ])
      app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    app.delete(app.findCollectionByNameOrId("fuloos_budgets"));
  },
);
