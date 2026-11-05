// Additive Phase 2 upgrade: adds quarterly frequency, occurrence match metadata, and per-user automation preferences.
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
    const recurring = app.findCollectionByNameOrId("fuloos_recurring");
    recurring.fields.getByName("frequency").values = [
      "daily",
      "weekly",
      "monthly",
      "quarterly",
      "yearly",
    ];
    app.save(recurring);

    const occurrences = app.findCollectionByNameOrId(
      "fuloos_recurring_occurrences",
    );
    occurrences.fields.add(
      new SelectField({
        name: "match_source",
        maxSelect: 1,
        values: ["manual", "auto"],
      }),
    );
    occurrences.fields.add(
      new TextField({
        name: "match_reason",
        max: 300,
      }),
    );
    app.save(occurrences);

    const prefs = new Collection({
      id: "fuloosrprefs001",
      name: "fuloos_recurring_prefs",
      type: "base",
      ...rules,
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
          name: "auto_detect",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["on", "off"],
        },
        {
          name: "auto_match",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["auto", "review", "off"],
        },
        {
          name: "dismissed_keys",
          type: "text",
          max: 20000,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_fuloos_recurring_prefs_user ON fuloos_recurring_prefs (user_id)",
      ],
    });
    app.save(prefs);

    for (const action of ["INSERT", "UPDATE"]) {
      const updateGuards =
        action === "UPDATE"
          ? `SELECT CASE WHEN NEW.type!=OLD.type AND EXISTS(SELECT 1 FROM fuloos_recurring_occurrences o WHERE o.recurring_id=NEW.id) THEN RAISE(ABORT,'Cannot change recurring type after occurrences are confirmed') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_recurring_occurrences o WHERE o.recurring_id=NEW.id AND (o.occurrence_date<NEW.start_date OR (NEW.end_date!='' AND o.occurrence_date>NEW.end_date))) THEN RAISE(ABORT,'Confirmed occurrences fall outside updated schedule dates') END;
      `
          : "";

      app
        .db()
        .newQuery(`DROP TRIGGER IF EXISTS fuloos_recurring_${action.toLowerCase()}`)
        .execute();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_recurring_${action.toLowerCase()} BEFORE ${action} ON fuloos_recurring BEGIN
      SELECT CASE WHEN trim(NEW.name)='' OR length(NEW.name)>160 THEN RAISE(ABORT,'Recurring name must contain 1-160 characters') END;
      SELECT CASE WHEN NEW.type NOT IN ('expense','income') THEN RAISE(ABORT,'Recurring type must be expense or income') END;
      SELECT CASE WHEN NEW.amount IS NULL OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be nonnegative integer fils') END;
      SELECT CASE WHEN NEW.amount_type NOT IN ('fixed','variable') THEN RAISE(ABORT,'Amount type must be fixed or variable') END;
      SELECT CASE WHEN NEW.frequency NOT IN ('daily','weekly','monthly','quarterly','yearly') THEN RAISE(ABORT,'Invalid recurring frequency') END;
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
          `DROP TRIGGER IF EXISTS fuloos_recurring_occ_${action.toLowerCase()}`,
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
      SELECT CASE WHEN NEW.match_source IS NOT NULL AND NEW.match_source!='' AND NEW.match_source NOT IN ('manual','auto') THEN RAISE(ABORT,'Invalid occurrence match source') END;
      SELECT CASE WHEN NEW.match_reason IS NOT NULL AND length(NEW.match_reason)>300 THEN RAISE(ABORT,'Match reason must be 300 characters or fewer') END;
    END`,
        )
        .execute();

      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_recurring_prefs_${action.toLowerCase()} BEFORE ${action} ON fuloos_recurring_prefs BEGIN
      SELECT CASE WHEN trim(NEW.user_id)='' THEN RAISE(ABORT,'Preferences require a user') END;
      SELECT CASE WHEN NEW.auto_detect NOT IN ('on','off') THEN RAISE(ABORT,'Invalid auto_detect preference') END;
      SELECT CASE WHEN NEW.auto_match NOT IN ('auto','review','off') THEN RAISE(ABORT,'Invalid auto_match preference') END;
      SELECT CASE WHEN NEW.dismissed_keys IS NOT NULL AND length(NEW.dismissed_keys)>20000 THEN RAISE(ABORT,'Dismissed keys exceed maximum size') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM fuloos_recurring_prefs p WHERE p.user_id=NEW.user_id AND p.id!=NEW.id) THEN RAISE(ABORT,'Preferences already exist for this user') END;
    END`,
        )
        .execute();
    }

    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_recurring_prefs_owner_update BEFORE UPDATE OF user_id ON fuloos_recurring_prefs WHEN NEW.user_id!=OLD.user_id BEGIN SELECT RAISE(ABORT,'Recurring preferences ownership cannot be changed'); END`,
      )
      .execute();
  },
  (app) => {
    throw new Error(
      "This migration is forward-only because quarterly schedules and match audit metadata may exist. Restore a verified backup to roll back.",
    );
  },
);
