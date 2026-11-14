// Additive upgrade: adds Net Worth Assets & Liabilities (fuloos_net_worth_items and fuloos_net_worth_snapshots).
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

    const items = new Collection({
      id: "fuloosnwitem001",
      name: "fuloos_net_worth_items",
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
          name: "kind",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["asset", "liability"],
        },
        {
          name: "category",
          type: "select",
          required: true,
          maxSelect: 1,
          values: [
            "investment",
            "gold",
            "crypto",
            "property",
            "vehicle",
            "other_asset",
            "mortgage",
            "auto_loan",
            "personal_loan",
            "student_loan",
            "other_liability",
          ],
        },
        {
          name: "current_value",
          type: "number",
          required: false,
          onlyInt: true,
          min: 0,
          max: 100000000000,
        },
        {
          name: "as_of_date",
          type: "text",
          required: true,
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
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
          name: "notes",
          type: "text",
          required: false,
          max: 500,
        },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_nw_items_user ON fuloos_net_worth_items (user_id)",
      ],
    });
    app.save(items);

    const snapshots = new Collection({
      id: "fuloosnwsnap001",
      name: "fuloos_net_worth_snapshots",
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
          name: "item_id",
          type: "relation",
          required: true,
          collectionId: items.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: "value",
          type: "number",
          required: false,
          onlyInt: true,
          min: 0,
          max: 100000000000,
        },
        {
          name: "date",
          type: "text",
          required: true,
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        {
          name: "notes",
          type: "text",
          required: false,
          max: 500,
        },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_nw_snapshots_user ON fuloos_net_worth_snapshots (user_id)",
        "CREATE INDEX idx_fuloos_nw_snapshots_item ON fuloos_net_worth_snapshots (item_id, date)",
      ],
    });
    app.save(snapshots);

    for (const action of ["INSERT", "UPDATE"]) {
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_net_worth_items_${action.toLowerCase()} BEFORE ${action} ON fuloos_net_worth_items BEGIN
      SELECT CASE WHEN NEW.current_value IS NULL OR typeof(NEW.current_value) NOT IN ('integer','real') OR NEW.current_value != CAST(NEW.current_value AS INTEGER) OR NEW.current_value < 0 OR NEW.current_value > 100000000000 THEN RAISE(ABORT,'Net worth item current_value must be nonnegative integer fils') END;
      SELECT CASE WHEN NEW.as_of_date IS NULL OR date(NEW.as_of_date) IS NULL OR date(NEW.as_of_date)!=NEW.as_of_date OR NEW.as_of_date<'1970-01-01' OR NEW.as_of_date>'2100-12-31' THEN RAISE(ABORT,'Net worth item as_of_date must be a valid YYYY-MM-DD date') END;
      SELECT CASE WHEN NEW.kind='asset' AND NEW.category NOT IN ('investment','gold','crypto','property','vehicle','other_asset') THEN RAISE(ABORT,'Asset item must use an asset category') END;
      SELECT CASE WHEN NEW.kind='liability' AND NEW.category NOT IN ('mortgage','auto_loan','personal_loan','student_loan','other_liability') THEN RAISE(ABORT,'Liability item must use a liability category') END;
    END`,
        )
        .execute();

      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_net_worth_snapshots_${action.toLowerCase()} BEFORE ${action} ON fuloos_net_worth_snapshots BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_net_worth_items i WHERE i.id=NEW.item_id AND i.user_id=NEW.user_id) THEN RAISE(ABORT,'Net worth item must belong to the same user') END;
      SELECT CASE WHEN NEW.value IS NULL OR typeof(NEW.value) NOT IN ('integer','real') OR NEW.value != CAST(NEW.value AS INTEGER) OR NEW.value < 0 OR NEW.value > 100000000000 THEN RAISE(ABORT,'Snapshot value must be nonnegative integer fils') END;
      SELECT CASE WHEN NEW.date IS NULL OR date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date OR NEW.date<'1970-01-01' OR NEW.date>'2100-12-31' THEN RAISE(ABORT,'Snapshot date must be a valid YYYY-MM-DD date') END;
    END`,
        )
        .execute();
    }

    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_net_worth_items_owner_update BEFORE UPDATE OF user_id ON fuloos_net_worth_items WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Net worth item ownership cannot be changed'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_net_worth_snapshots_owner_update BEFORE UPDATE OF user_id ON fuloos_net_worth_snapshots WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Net worth snapshot ownership cannot be changed'); END`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_net_worth_item_delete_snapshots AFTER DELETE ON fuloos_net_worth_items BEGIN DELETE FROM fuloos_net_worth_snapshots WHERE item_id=OLD.id; END`,
      )
      .execute();
  },
  (app) => {
    for (const trigger of [
      "fuloos_net_worth_item_delete_snapshots",
      "fuloos_net_worth_snapshots_owner_update",
      "fuloos_net_worth_items_owner_update",
      "fuloos_net_worth_snapshots_update",
      "fuloos_net_worth_snapshots_insert",
      "fuloos_net_worth_items_update",
      "fuloos_net_worth_items_insert",
    ])
      app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    app.delete(app.findCollectionByNameOrId("fuloos_net_worth_snapshots"));
    app.delete(app.findCollectionByNameOrId("fuloos_net_worth_items"));
  },
);
