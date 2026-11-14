// Additive upgrade: adds Savings Goals & Sinking Funds (fuloos_goals and fuloos_goal_contributions).
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
    const transactions = app.findCollectionByNameOrId("fuloos_transactions");

    const goals = new Collection({
      id: "fuloosgoals0001",
      name: "fuloos_goals",
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
          name: "name",
          type: "text",
          required: true,
          min: 1,
          max: 80,
        },
        {
          name: "target_amount",
          type: "number",
          required: true,
          onlyInt: true,
          min: 1,
          max: 100000000000,
        },
        {
          name: "current_amount",
          type: "number",
          required: false,
          onlyInt: true,
          min: 0,
          max: 100000000000,
        },
        {
          name: "target_date",
          type: "text",
          required: false,
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        {
          name: "account_id",
          type: "relation",
          required: false,
          collectionId: accounts.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "color",
          type: "text",
          required: true,
          pattern: "^#[0-9A-Fa-f]{6}$",
        },
        {
          name: "emoji",
          type: "text",
          required: false,
          max: 16,
        },
        {
          name: "kind",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["savings", "sinking_fund"],
        },
        {
          name: "status",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["active", "completed", "paused"],
        },
        {
          name: "notes",
          type: "text",
          required: false,
          max: 500,
        },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_goals_user ON fuloos_goals (user_id)",
        "CREATE INDEX idx_fuloos_goals_account ON fuloos_goals (account_id)",
      ],
    });
    app.save(goals);

    const contributions = new Collection({
      id: "fuloosgcont0001",
      name: "fuloos_goal_contributions",
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
          name: "goal_id",
          type: "relation",
          required: true,
          collectionId: goals.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: "amount",
          type: "number",
          required: true,
          onlyInt: true,
          min: -100000000000,
          max: 100000000000,
        },
        {
          name: "date",
          type: "text",
          required: true,
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        {
          name: "transaction_id",
          type: "relation",
          required: false,
          collectionId: transactions.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "notes",
          type: "text",
          required: false,
          max: 500,
        },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_goal_contributions_user ON fuloos_goal_contributions (user_id)",
        "CREATE INDEX idx_fuloos_goal_contributions_goal ON fuloos_goal_contributions (goal_id, date)",
      ],
    });
    app.save(contributions);

    for (const action of ["INSERT", "UPDATE"]) {
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_goals_${action.toLowerCase()} BEFORE ${action} ON fuloos_goals BEGIN
      SELECT CASE WHEN NEW.target_amount IS NULL OR typeof(NEW.target_amount) NOT IN ('integer','real') OR NEW.target_amount != CAST(NEW.target_amount AS INTEGER) OR NEW.target_amount <= 0 OR NEW.target_amount > 100000000000 THEN RAISE(ABORT,'Goal target_amount must be positive integer fils') END;
      SELECT CASE WHEN NEW.current_amount IS NULL OR typeof(NEW.current_amount) NOT IN ('integer','real') OR NEW.current_amount != CAST(NEW.current_amount AS INTEGER) OR NEW.current_amount < 0 OR NEW.current_amount > 100000000000 THEN RAISE(ABORT,'Goal current_amount must be nonnegative integer fils') END;
      SELECT CASE WHEN COALESCE(NEW.target_date,'')!='' AND (date(NEW.target_date) IS NULL OR date(NEW.target_date)!=NEW.target_date OR NEW.target_date<'1970-01-01' OR NEW.target_date>'2100-12-31') THEN RAISE(ABORT,'Goal target_date must be a valid YYYY-MM-DD date') END;
      SELECT CASE WHEN COALESCE(NEW.account_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Linked account must belong to the same user') END;
    END`,
        )
        .execute();

      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_goal_contributions_${action.toLowerCase()} BEFORE ${action} ON fuloos_goal_contributions BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_goals g WHERE g.id=NEW.goal_id AND g.user_id=NEW.user_id) THEN RAISE(ABORT,'Goal must belong to the same user') END;
      SELECT CASE WHEN NEW.amount IS NULL OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount = 0 OR ABS(NEW.amount) > 100000000000 THEN RAISE(ABORT,'Contribution amount must be non-zero integer fils') END;
      SELECT CASE WHEN NEW.date IS NULL OR date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date OR NEW.date<'1970-01-01' OR NEW.date>'2100-12-31' THEN RAISE(ABORT,'Contribution date must be a valid YYYY-MM-DD date') END;
      SELECT CASE WHEN COALESCE(NEW.transaction_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_transactions t WHERE t.id=NEW.transaction_id AND t.user_id=NEW.user_id) THEN RAISE(ABORT,'Linked transaction must belong to the same user') END;
    END`,
        )
        .execute();
    }

    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_goals_owner_update BEFORE UPDATE OF user_id ON fuloos_goals WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Goal ownership cannot be changed'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_goal_contributions_owner_update BEFORE UPDATE OF user_id ON fuloos_goal_contributions WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Goal contribution ownership cannot be changed'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_account_delete_clear_goals AFTER DELETE ON fuloos_accounts BEGIN UPDATE fuloos_goals SET account_id='' WHERE account_id=OLD.id; END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_tx_delete_clear_goal_contributions AFTER DELETE ON fuloos_transactions BEGIN UPDATE fuloos_goal_contributions SET transaction_id='' WHERE transaction_id=OLD.id; END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_goal_delete_contributions AFTER DELETE ON fuloos_goals BEGIN DELETE FROM fuloos_goal_contributions WHERE goal_id=OLD.id; END`,
      )
      .execute();
  },
  (app) => {
    for (const trigger of [
      "fuloos_goal_delete_contributions",
      "fuloos_tx_delete_clear_goal_contributions",
      "fuloos_account_delete_clear_goals",
      "fuloos_goal_contributions_owner_update",
      "fuloos_goals_owner_update",
      "fuloos_goal_contributions_update",
      "fuloos_goal_contributions_insert",
      "fuloos_goals_update",
      "fuloos_goals_insert",
    ])
      app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    app.delete(app.findCollectionByNameOrId("fuloos_goal_contributions"));
    app.delete(app.findCollectionByNameOrId("fuloos_goals"));
  },
);
