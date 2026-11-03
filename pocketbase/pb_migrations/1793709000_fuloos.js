/// <reference path="../pb_data/types.d.ts" />
// Targets PocketBase's v0.23+ collection API; tested against v0.41.1 docs.
// Creates only namespaced Fuloos collections. No existing collections are changed.
migrate(
  (app) => {
    const owner =
      "@request.auth.collectionName = 'fuloos_users' && user_id = @request.auth.id";
    const createOwner =
      "@request.auth.collectionName = 'fuloos_users' && @request.body.user_id = @request.auth.id";
    const updateOwner =
      owner +
      " && (@request.body.user_id:isset = false || @request.body.user_id = @request.auth.id)";
    const users = new Collection({
      id: "fuloosusers0001",
      name: "fuloos_users",
      type: "auth",
      listRule: "id = @request.auth.id",
      viewRule: "id = @request.auth.id",
      createRule: "",
      updateRule: "id = @request.auth.id",
      deleteRule: null,
      authRule: "",
      passwordAuth: { enabled: true, identityFields: ["email"] },
    });
    app.save(users);
    const ownership = {
      name: "user_id",
      type: "relation",
      required: true,
      collectionId: users.id,
      maxSelect: 1,
      cascadeDelete: true,
    };
    const color = {
      name: "color",
      type: "text",
      required: true,
      pattern: "^#[0-9A-Fa-f]{6}$",
    };
    const name = {
      name: "name",
      type: "text",
      required: true,
      min: 1,
      max: 80,
    };
    const rules = {
      listRule: owner,
      viewRule: owner,
      createRule: createOwner,
      updateRule: updateOwner,
      deleteRule: owner,
    };
    const accounts = new Collection({
      id: "fuloosaccs00001",
      name: "fuloos_accounts",
      type: "base",
      ...rules,
      fields: [
        ownership,
        name,
        color,
        {
          name: "type",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["current", "savings", "credit_card", "cash", "other"],
        },
        {
          name: "opening_balance",
          type: "number",
          onlyInt: true,
          min: -100000000000,
          max: 100000000000,
        },
        {
          name: "opening_date",
          type: "text",
          required: true,
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_accounts_user ON fuloos_accounts (user_id)",
      ],
    });
    app.save(accounts);
    const categories = new Collection({
      id: "fulooscats00001",
      name: "fuloos_categories",
      type: "base",
      ...rules,
      fields: [
        ownership,
        name,
        color,
        { name: "description", type: "text", max: 500 },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_categories_user ON fuloos_categories (user_id)",
      ],
    });
    app.save(categories);
    const transactions = new Collection({
      id: "fuloostxns00001",
      name: "fuloos_transactions",
      type: "base",
      ...rules,
      fields: [
        ownership,
        {
          name: "type",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["expense", "income", "transfer"],
        },
        {
          name: "amount",
          type: "number",
          required: true,
          onlyInt: true,
          min: 1,
          max: 100000000000,
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
          name: "to_account_id",
          type: "relation",
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
          name: "date",
          type: "text",
          required: true,
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        { name: "payee", type: "text", max: 160 },
        { name: "notes", type: "text", max: 1000 },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_transactions_user_date ON fuloos_transactions (user_id,date)",
        "CREATE INDEX idx_fuloos_transactions_account ON fuloos_transactions (account_id)",
        "CREATE INDEX idx_fuloos_transactions_destination ON fuloos_transactions (to_account_id)",
        "CREATE INDEX idx_fuloos_transactions_category ON fuloos_transactions (category_id)",
      ],
    });
    app.save(transactions);
    // SQLite triggers enforce invariants in the same atomic write, including concurrent clients.
    for (const action of ["INSERT", "UPDATE"]) {
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_transaction_${action.toLowerCase()} BEFORE ${action} ON fuloos_transactions BEGIN
      SELECT CASE WHEN NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount <= 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be positive integer fils') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Account must belong to the same user') END;
      SELECT CASE WHEN NEW.type='transfer' AND (NEW.to_account_id='' OR NEW.to_account_id=NEW.account_id OR NEW.category_id!='') THEN RAISE(ABORT,'A transfer requires two different accounts and no category') END;
      SELECT CASE WHEN NEW.type!='transfer' AND NEW.to_account_id!='' THEN RAISE(ABORT,'Only a transfer has a receiving account') END;
      SELECT CASE WHEN NEW.to_account_id!='' AND NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.to_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Receiving account must belong to the same user') END;
      SELECT CASE WHEN NEW.category_id!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date OR EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id IN (NEW.account_id,NEW.to_account_id) AND a.opening_date>NEW.date) THEN RAISE(ABORT,'Transaction date must be valid and on or after both account opening dates') END;
    END`,
        )
        .execute();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_account_${action.toLowerCase()} BEFORE ${action} ON fuloos_accounts BEGIN
      SELECT CASE WHEN NEW.opening_balance != CAST(NEW.opening_balance AS INTEGER) OR abs(NEW.opening_balance)>100000000000 THEN RAISE(ABORT,'Opening balance must be integer fils') END;
      SELECT CASE WHEN date(NEW.opening_date) IS NULL OR date(NEW.opening_date)!=NEW.opening_date OR EXISTS(SELECT 1 FROM fuloos_transactions t WHERE (t.account_id=NEW.id OR t.to_account_id=NEW.id) AND t.date<NEW.opening_date) THEN RAISE(ABORT,'Opening date must be valid and no later than existing transactions') END;
    END`,
        )
        .execute();
    }
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_account_delete BEFORE DELETE ON fuloos_accounts BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_transactions t WHERE t.account_id=OLD.id OR t.to_account_id=OLD.id) THEN RAISE(ABORT,'Move or delete account transactions first') END; END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_category_delete BEFORE DELETE ON fuloos_categories BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_transactions t WHERE t.category_id=OLD.id) THEN RAISE(ABORT,'Reassign category transactions first') END; END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_account_owner_update BEFORE UPDATE OF user_id ON fuloos_accounts WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Account ownership cannot be changed'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_category_owner_update BEFORE UPDATE OF user_id ON fuloos_categories WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Category ownership cannot be changed'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_transaction_owner_update BEFORE UPDATE OF user_id ON fuloos_transactions WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Transaction ownership cannot be changed'); END`,
      )
      .execute();
  },
  (app) => {
    for (const name of [
      "fuloos_transactions",
      "fuloos_categories",
      "fuloos_accounts",
      "fuloos_users",
    ])
      app.delete(app.findCollectionByNameOrId(name));
  },
);
