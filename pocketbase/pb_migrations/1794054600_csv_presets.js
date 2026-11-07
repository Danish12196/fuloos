// Additive upgrade: stores CSV column-mapping presets per user so they follow the account across devices.
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

    const presets = new Collection({
      id: "fuloosrcsvprst1",
      name: "fuloos_csv_presets",
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
        { name: "name", type: "text", required: true, min: 1, max: 80 },
        // Case-insensitive lookup key computed by the client (trimmed, lowercased name).
        { name: "name_key", type: "text", required: true, min: 1, max: 80 },
        // Mapping settings: delimiter, header, skip, split, flip, decimal, dateFormat, headers and columns.
        { name: "config", type: "json", required: true, maxSize: 200000 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_fuloos_csv_presets_user_name ON fuloos_csv_presets (user_id, name_key)",
      ],
    });
    app.save(presets);

    for (const action of ["INSERT", "UPDATE"]) {
      app
        .db()
        .newQuery(
          `DROP TRIGGER IF EXISTS fuloos_csv_presets_${action.toLowerCase()}`,
        )
        .execute();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_csv_presets_${action.toLowerCase()} BEFORE ${action} ON fuloos_csv_presets BEGIN
      SELECT CASE WHEN trim(NEW.user_id)='' THEN RAISE(ABORT,'Presets require a user') END;
      SELECT CASE WHEN trim(NEW.name)='' OR length(trim(NEW.name))>80 THEN RAISE(ABORT,'Preset names must contain 1-80 characters') END;
      SELECT CASE WHEN trim(NEW.name_key)='' OR NEW.name_key!=trim(NEW.name_key) THEN RAISE(ABORT,'Invalid preset name key') END;
      SELECT CASE WHEN NEW.config IS NULL OR json_valid(NEW.config)=0 OR json_type(NEW.config)!='object' THEN RAISE(ABORT,'Preset configuration must be a JSON object') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_csv_presets p WHERE p.user_id=NEW.user_id AND p.name_key=NEW.name_key AND p.id!=NEW.id) THEN RAISE(ABORT,'A preset with this name already exists.') END;
    END`,
        )
        .execute();
    }

    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_csv_presets_owner_update BEFORE UPDATE OF user_id ON fuloos_csv_presets WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Preset ownership cannot be changed'); END`,
      )
      .execute();
  },
  (app) => {
    // Presets are convenience settings, not ledger data, so rolling back only removes saved mappings.
    const presets = app.findCollectionByNameOrId("fuloos_csv_presets");
    app.delete(presets);
  },
);
