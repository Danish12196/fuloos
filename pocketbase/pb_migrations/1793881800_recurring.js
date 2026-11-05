// Additive upgrade: adds recurring schedules and occurrence links while keeping ledger balances derived solely from transactions.
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
    const accounts = app.findCollectionByNameOrId("fuloos_accounts");
    const categories = app.findCollectionByNameOrId("fuloos_categories");
    const transactions = app.findCollectionByNameOrId("fuloos_transactions");

    const ownership = {
      name: "user_id",
      type: "relation",
      required: true,
      collectionId: users.id,
      maxSelect: 1,
      cascadeDelete: true,
    };

    const recurring = new Collection({
      id: "fuloosrecs00001",
      name: "fuloos_recurring",
      type: "base",
      ...rules,
      fields: [
        ownership,
        { name: "name", type: "text", required: true, min: 1, max: 160 },
        {
          name: "type",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["expense", "income"],
        },
        {
          name: "amount",
          type: "number",
          required: false,
          onlyInt: true,
          min: 0,
          max: 100000000000,
        },
        {
          name: "amount_type",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["fixed", "variable"],
        },
        {
          name: "account_id",
          type: "relation",
          required: true,
          collectionId: accounts.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "category_id",
          type: "relation",
          collectionId: categories.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "frequency",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["daily", "weekly", "monthly", "yearly"],
        },
        {
          name: "start_date",
          type: "text",
          required: true,
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        {
          name: "end_date",
          type: "text",
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        {
          name: "status",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["active", "paused"],
        },
        { name: "notes", type: "text", max: 1000 },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_recurring_user_status ON fuloos_recurring (user_id,status)",
        "CREATE INDEX idx_fuloos_recurring_account ON fuloos_recurring (account_id)",
        "CREATE INDEX idx_fuloos_recurring_category ON fuloos_recurring (category_id)",
      ],
    });
    app.save(recurring);

    const occurrences = new Collection({
      id: "fuloosroccs0001",
      name: "fuloos_recurring_occurrences",
      type: "base",
      ...rules,
      fields: [
        ownership,
        {
          name: "recurring_id",
          type: "relation",
          required: true,
          collectionId: recurring.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: "occurrence_date",
          type: "text",
          required: true,
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        {
          name: "transaction_id",
          type: "relation",
          required: true,
          collectionId: transactions.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_fuloos_recurring_occ_unique ON fuloos_recurring_occurrences (recurring_id,occurrence_date)",
        "CREATE UNIQUE INDEX idx_fuloos_recurring_occ_txn ON fuloos_recurring_occurrences (transaction_id)",
        "CREATE INDEX idx_fuloos_recurring_occ_user ON fuloos_recurring_occurrences (user_id)",
      ],
    });
    app.save(occurrences);

    for (const action of ["INSERT", "UPDATE"]) {
      const updateGuards =
        action === "UPDATE"
          ? `SELECT CASE WHEN NEW.type!=OLD.type AND EXISTS(SELECT 1 FROM fuloos_recurring_occurrences o WHERE o.recurring_id=NEW.id) THEN RAISE(ABORT,'Cannot change recurring type after occurrences are confirmed') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_recurring_occurrences o WHERE o.recurring_id=NEW.id AND (o.occurrence_date<NEW.start_date OR (NEW.end_date!='' AND o.occurrence_date>NEW.end_date))) THEN RAISE(ABORT,'Confirmed occurrences fall outside updated schedule dates') END;
      `
          : "";
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_recurring_${action.toLowerCase()} BEFORE ${action} ON fuloos_recurring BEGIN
      SELECT CASE WHEN trim(NEW.name)='' OR length(NEW.name)>160 THEN RAISE(ABORT,'Recurring name must contain 1-160 characters') END;
      SELECT CASE WHEN NEW.type NOT IN ('expense','income') THEN RAISE(ABORT,'Recurring type must be expense or income') END;
      SELECT CASE WHEN NEW.amount IS NULL OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be nonnegative integer fils') END;
      SELECT CASE WHEN NEW.amount_type NOT IN ('fixed','variable') THEN RAISE(ABORT,'Amount type must be fixed or variable') END;
      SELECT CASE WHEN NEW.frequency NOT IN ('daily','weekly','monthly','yearly') THEN RAISE(ABORT,'Invalid recurring frequency') END;
      SELECT CASE WHEN NEW.status NOT IN ('active','paused') THEN RAISE(ABORT,'Invalid recurring status') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Account must belong to the same user') END;
      SELECT CASE WHEN NEW.category_id!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN date(NEW.start_date) IS NULL OR date(NEW.start_date)!=NEW.start_date OR NEW.start_date<'1970-01-01' OR NEW.start_date>'2100-12-31' THEN RAISE(ABORT,'Start date must be a valid YYYY-MM-DD date between 1970-01-01 and 2100-12-31') END;
      SELECT CASE WHEN NEW.end_date!='' AND (date(NEW.end_date) IS NULL OR date(NEW.end_date)!=NEW.end_date OR NEW.end_date<NEW.start_date OR NEW.end_date>'2100-12-31') THEN RAISE(ABORT,'End date must be valid and on or after start date') END;
      ${updateGuards}END`,
        )
        .execute();

      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_recurring_occ_${action.toLowerCase()} BEFORE ${action} ON fuloos_recurring_occurrences BEGIN
      SELECT CASE WHEN date(NEW.occurrence_date) IS NULL OR date(NEW.occurrence_date)!=NEW.occurrence_date OR NEW.occurrence_date<'1970-01-01' OR NEW.occurrence_date>'2100-12-31' THEN RAISE(ABORT,'Occurrence date must be a valid YYYY-MM-DD date') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_recurring r WHERE r.id=NEW.recurring_id AND r.user_id=NEW.user_id) THEN RAISE(ABORT,'Recurring schedule must belong to the same user') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_recurring r WHERE r.id=NEW.recurring_id AND (NEW.occurrence_date<r.start_date OR (r.end_date!='' AND NEW.occurrence_date>r.end_date))) THEN RAISE(ABORT,'Occurrence date is outside schedule date range') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_transactions t WHERE t.id=NEW.transaction_id AND t.user_id=NEW.user_id) THEN RAISE(ABORT,'Linked transaction must belong to the same user') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_recurring r JOIN fuloos_transactions t ON t.id=NEW.transaction_id WHERE r.id=NEW.recurring_id AND r.type!=t.type) THEN RAISE(ABORT,'Linked transaction type must match recurring schedule type') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_recurring_occurrences o WHERE o.recurring_id=NEW.recurring_id AND o.occurrence_date=NEW.occurrence_date AND o.id!=NEW.id) THEN RAISE(ABORT,'Occurrence is already confirmed') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_recurring_occurrences o WHERE o.transaction_id=NEW.transaction_id AND o.id!=NEW.id) THEN RAISE(ABORT,'Transaction is already linked to a recurring occurrence') END;
    END`,
        )
        .execute();
    }

    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_recurring_owner_update BEFORE UPDATE OF user_id ON fuloos_recurring WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Recurring ownership cannot be changed'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_recurring_occ_owner_update BEFORE UPDATE OF user_id ON fuloos_recurring_occurrences WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Recurring occurrence ownership cannot be changed'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_transaction_recurring_type_guard BEFORE UPDATE OF type ON fuloos_transactions WHEN NEW.type!=OLD.type AND EXISTS(SELECT 1 FROM fuloos_recurring_occurrences o JOIN fuloos_recurring r ON r.id=o.recurring_id WHERE o.transaction_id=NEW.id AND r.type!=NEW.type) BEGIN SELECT RAISE(ABORT,'Unlink recurring occurrence before changing transaction type'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_account_delete_recurring BEFORE DELETE ON fuloos_accounts BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_recurring r WHERE r.account_id=OLD.id) THEN RAISE(ABORT,'Delete or reassign recurring schedules for this account first') END; END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_category_delete_recurring BEFORE DELETE ON fuloos_categories BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_recurring r WHERE r.category_id=OLD.id) THEN RAISE(ABORT,'Reassign recurring schedules for this category first') END; END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_recurring_delete_cleanup AFTER DELETE ON fuloos_recurring BEGIN DELETE FROM fuloos_recurring_occurrences WHERE recurring_id=OLD.id; END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_transaction_delete_recurring_cleanup AFTER DELETE ON fuloos_transactions BEGIN DELETE FROM fuloos_recurring_occurrences WHERE transaction_id=OLD.id; END`,
      )
      .execute();
  },
  (app) => {
    for (const trigger of [
      "fuloos_transaction_delete_recurring_cleanup",
      "fuloos_recurring_delete_cleanup",
      "fuloos_category_delete_recurring",
      "fuloos_account_delete_recurring",
      "fuloos_transaction_recurring_type_guard",
      "fuloos_recurring_occ_owner_update",
      "fuloos_recurring_owner_update",
      "fuloos_recurring_occ_update",
      "fuloos_recurring_occ_insert",
      "fuloos_recurring_update",
      "fuloos_recurring_insert",
    ])
      app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    for (const name of ["fuloos_recurring_occurrences", "fuloos_recurring"])
      app.delete(app.findCollectionByNameOrId(name));
  },
);
