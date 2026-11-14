// Additive upgrade: Transaction Enrichment — tags, split transactions,
// deterministic rules engine (fuloos_rules), and receipt attachments.

const txChecksBase = `
      SELECT CASE WHEN NEW.amount IS NULL OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be nonnegative integer fils') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Account must belong to the same user') END;
      SELECT CASE WHEN NEW.type='transfer' AND (COALESCE(NEW.to_account_id,'')='' OR COALESCE(NEW.to_account_id,'')=NEW.account_id OR COALESCE(NEW.category_id,'')!='') THEN RAISE(ABORT,'A transfer requires two different accounts and no category') END;
      SELECT CASE WHEN NEW.type!='transfer' AND COALESCE(NEW.to_account_id,'')!='' THEN RAISE(ABORT,'Only a transfer has a receiving account') END;
      SELECT CASE WHEN COALESCE(NEW.to_account_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.to_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Receiving account must belong to the same user') END;
      SELECT CASE WHEN COALESCE(NEW.category_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date THEN RAISE(ABORT,'Transaction date must be valid') END;`;

const txChecksEnriched = `${txChecksBase}
      SELECT CASE WHEN COALESCE(NEW.tags,'') NOT IN ('','null') AND (json_valid(NEW.tags)=0 OR json_type(NEW.tags)!='array' OR json_array_length(NEW.tags)>20) THEN RAISE(ABORT,'Tags must be a JSON array of at most 20 items') END;
      SELECT CASE WHEN COALESCE(NEW.splits,'') NOT IN ('','null') AND (json_valid(NEW.splits)=0 OR json_type(NEW.splits)!='array') THEN RAISE(ABORT,'Splits must be a JSON array') END;
      SELECT CASE WHEN COALESCE(NEW.splits,'') NOT IN ('','null') AND json_type(NEW.splits)='array' AND json_array_length(NEW.splits)>0 AND NEW.type='transfer' THEN RAISE(ABORT,'Transfers cannot have splits') END;
      SELECT CASE WHEN COALESCE(NEW.splits,'') NOT IN ('','null') AND json_type(NEW.splits)='array' AND json_array_length(NEW.splits)>0 AND (
        EXISTS(
          SELECT 1 FROM json_each(NEW.splits) s
          WHERE json_type(s.value,'$.amount') NOT IN ('integer','real')
             OR json_extract(s.value,'$.amount')!=CAST(json_extract(s.value,'$.amount') AS INTEGER)
             OR json_extract(s.value,'$.amount')<=0
             OR (
               COALESCE(json_extract(s.value,'$.category_id'),'')!=''
               AND NOT EXISTS(
                 SELECT 1 FROM fuloos_categories c
                 WHERE c.id=json_extract(s.value,'$.category_id') AND c.user_id=NEW.user_id
               )
             )
        )
        OR (SELECT COALESCE(SUM(json_extract(s.value,'$.amount')),0) FROM json_each(NEW.splits) s)!=NEW.amount
      ) THEN RAISE(ABORT,'Splits must have positive integer amounts summing to the transaction amount') END;`;

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
    const transactions = app.findCollectionByNameOrId("fuloos_transactions");

    const makeJsonField = (opts) =>
      typeof JSONField === "function"
        ? new JSONField(opts)
        : { type: "json", ...opts };
    const makeFileField = (opts) =>
      typeof FileField === "function"
        ? new FileField(opts)
        : { type: "file", ...opts };

    transactions.fields.add(makeJsonField({ name: "tags", maxSize: 4000 }));
    transactions.fields.add(makeJsonField({ name: "splits", maxSize: 16000 }));
    transactions.fields.add(
      makeFileField({
        name: "receipt",
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
        ],
        protected: true,
      }),
    );
    app.save(transactions);

    replaceTxTriggers(app, txChecksEnriched);

    const rules = new Collection({
      id: "fuloosrules001",
      name: "fuloos_rules",
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
        { name: "enabled", type: "bool" },
        {
          name: "priority",
          type: "number",
          onlyInt: true,
          min: 0,
          max: 10000,
        },
        {
          name: "match_field",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["payee", "notes", "either"],
        },
        {
          name: "match_type",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["contains", "starts_with", "exact", "regex"],
        },
        { name: "pattern", type: "text", required: true, min: 1, max: 200 },
        {
          name: "min_amount",
          type: "number",
          onlyInt: true,
          min: 0,
          max: 100000000000,
        },
        {
          name: "max_amount",
          type: "number",
          onlyInt: true,
          min: 0,
          max: 100000000000,
        },
        {
          name: "set_category_id",
          type: "relation",
          collectionId: categories.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: "add_tags", type: "json", maxSize: 4000 },
        { name: "set_payee", type: "text", max: 160 },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_rules_user_priority ON fuloos_rules (user_id, priority)",
      ],
    });
    app.save(rules);

    for (const action of ["INSERT", "UPDATE"]) {
      const when = action.toLowerCase();
      app
        .db()
        .newQuery(`DROP TRIGGER IF EXISTS fuloos_rules_${when}`)
        .execute();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_rules_${when} BEFORE ${action} ON fuloos_rules BEGIN
      SELECT CASE WHEN COALESCE(NEW.set_category_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.set_category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Rule category must belong to the same user') END;
    END`,
        )
        .execute();
    }

    app
      .db()
      .newQuery("DROP TRIGGER IF EXISTS fuloos_category_delete_rules")
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_category_delete_rules AFTER DELETE ON fuloos_categories BEGIN
      UPDATE fuloos_rules SET set_category_id='' WHERE set_category_id=OLD.id;
    END`,
      )
      .execute();
  },
  (app) => {
    app
      .db()
      .newQuery("DROP TRIGGER IF EXISTS fuloos_category_delete_rules")
      .execute();
    app.db().newQuery("DROP TRIGGER IF EXISTS fuloos_rules_insert").execute();
    app.db().newQuery("DROP TRIGGER IF EXISTS fuloos_rules_update").execute();
    const rules = app.findCollectionByNameOrId("fuloos_rules");
    if (rules) app.delete(rules);

    replaceTxTriggers(app, txChecksBase);

    const transactions = app.findCollectionByNameOrId("fuloos_transactions");
    transactions.fields.removeByName("tags");
    transactions.fields.removeByName("splits");
    transactions.fields.removeByName("receipt");
    app.save(transactions);
  },
);
