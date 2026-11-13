// Additive hardening upgrade:
// 1. Clears orphaned fuloos_ml_examples.category_id when a category is deleted.
// 2. Guards fuloos_transactions triggers against SQLite NULL bypasses on amount, to_account_id, and category_id.
// 3. Isolates fuloos_users listRule, viewRule, and updateRule to the fuloos_users auth collection.
// 4. Enforces fuloos_csv_presets.name_key == lower(trim(name)) in SQLite triggers.

const txChecksHardened = `
      SELECT CASE WHEN NEW.amount IS NULL OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be nonnegative integer fils') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Account must belong to the same user') END;
      SELECT CASE WHEN NEW.type='transfer' AND (COALESCE(NEW.to_account_id,'')='' OR COALESCE(NEW.to_account_id,'')=NEW.account_id OR COALESCE(NEW.category_id,'')!='') THEN RAISE(ABORT,'A transfer requires two different accounts and no category') END;
      SELECT CASE WHEN NEW.type!='transfer' AND COALESCE(NEW.to_account_id,'')!='' THEN RAISE(ABORT,'Only a transfer has a receiving account') END;
      SELECT CASE WHEN COALESCE(NEW.to_account_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.to_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Receiving account must belong to the same user') END;
      SELECT CASE WHEN COALESCE(NEW.category_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date THEN RAISE(ABORT,'Transaction date must be valid') END;`;

const txChecksPrev = `
      SELECT CASE WHEN NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be nonnegative integer fils') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Account must belong to the same user') END;
      SELECT CASE WHEN NEW.type='transfer' AND (NEW.to_account_id='' OR NEW.to_account_id=NEW.account_id OR NEW.category_id!='') THEN RAISE(ABORT,'A transfer requires two different accounts and no category') END;
      SELECT CASE WHEN NEW.type!='transfer' AND NEW.to_account_id!='' THEN RAISE(ABORT,'Only a transfer has a receiving account') END;
      SELECT CASE WHEN NEW.to_account_id!='' AND NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.to_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Receiving account must belong to the same user') END;
      SELECT CASE WHEN NEW.category_id!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date THEN RAISE(ABORT,'Transaction date must be valid') END;`;

function replaceTxTriggers(app, checks) {
  for (const action of ["INSERT", "UPDATE"]) {
    const when = action.toLowerCase();
    app
      .db()
      .newQuery(`DROP TRIGGER IF EXISTS fuloos_transaction_${when}`)
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_transaction_${when} BEFORE ${action} ON fuloos_transactions BEGIN${checks}
    END`,
      )
      .execute();
  }
}

function replaceCsvPresetTriggers(app, requireLowerTrim) {
  const keyCheck = requireLowerTrim
    ? "trim(NEW.name_key)='' OR NEW.name_key!=trim(NEW.name_key) OR NEW.name_key!=lower(trim(NEW.name))"
    : "trim(NEW.name_key)='' OR NEW.name_key!=trim(NEW.name_key)";
  for (const action of ["INSERT", "UPDATE"]) {
    const when = action.toLowerCase();
    app
      .db()
      .newQuery(`DROP TRIGGER IF EXISTS fuloos_csv_presets_${when}`)
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_csv_presets_${when} BEFORE ${action} ON fuloos_csv_presets BEGIN
      SELECT CASE WHEN trim(NEW.user_id)='' THEN RAISE(ABORT,'Presets require a user') END;
      SELECT CASE WHEN trim(NEW.name)='' OR length(trim(NEW.name))>80 THEN RAISE(ABORT,'Preset names must contain 1-80 characters') END;
      SELECT CASE WHEN ${keyCheck} THEN RAISE(ABORT,'Invalid preset name key') END;
      SELECT CASE WHEN NEW.config IS NULL OR json_valid(NEW.config)=0 OR json_type(NEW.config)!='object' THEN RAISE(ABORT,'Preset configuration must be a JSON object') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_csv_presets p WHERE p.user_id=NEW.user_id AND p.name_key=NEW.name_key AND p.id!=NEW.id) THEN RAISE(ABORT,'A preset with this name already exists.') END;
    END`,
      )
      .execute();
  }
}

migrate(
  (app) => {
    app
      .db()
      .newQuery("DROP TRIGGER IF EXISTS fuloos_category_delete_ml_examples")
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_category_delete_ml_examples AFTER DELETE ON fuloos_categories BEGIN
      UPDATE fuloos_ml_examples SET category_id='' WHERE category_id=OLD.id;
    END`,
      )
      .execute();

    replaceTxTriggers(app, txChecksHardened);
    replaceCsvPresetTriggers(app, true);

    const users = app.findCollectionByNameOrId("fuloos_users");
    const selfRule =
      "@request.auth.collectionName = 'fuloos_users' && id = @request.auth.id";
    users.listRule = selfRule;
    users.viewRule = selfRule;
    users.updateRule = selfRule;
    app.save(users);
  },
  (app) => {
    app
      .db()
      .newQuery("DROP TRIGGER IF EXISTS fuloos_category_delete_ml_examples")
      .execute();

    replaceTxTriggers(app, txChecksPrev);
    replaceCsvPresetTriggers(app, false);

    const users = app.findCollectionByNameOrId("fuloos_users");
    users.listRule = "id = @request.auth.id";
    users.viewRule = "id = @request.auth.id";
    users.updateRule = "id = @request.auth.id";
    app.save(users);
  },
);
