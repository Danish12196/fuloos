// Additive upgrade: preserves existing records, ownership rules and reference checks.
migrate(
  (app) => {
    for (const name of ["fuloos_accounts", "fuloos_categories"]) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.add(new TextField({ name: "emoji", max: 32 }));
      app.save(collection);
    }
    const transactions = app.findCollectionByNameOrId("fuloos_transactions");
    transactions.fields.getByName("amount").min = 0;
    transactions.fields.getByName("amount").required = false;
    app.save(transactions);
    for (const action of ["INSERT", "UPDATE"]) {
      app
        .db()
        .newQuery(`DROP TRIGGER fuloos_transaction_${action.toLowerCase()}`)
        .execute();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_transaction_${action.toLowerCase()} BEFORE ${action} ON fuloos_transactions BEGIN
      SELECT CASE WHEN NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be nonnegative integer fils') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Account must belong to the same user') END;
      SELECT CASE WHEN NEW.type='transfer' AND (NEW.to_account_id='' OR NEW.to_account_id=NEW.account_id OR NEW.category_id!='') THEN RAISE(ABORT,'A transfer requires two different accounts and no category') END;
      SELECT CASE WHEN NEW.type!='transfer' AND NEW.to_account_id!='' THEN RAISE(ABORT,'Only a transfer has a receiving account') END;
      SELECT CASE WHEN NEW.to_account_id!='' AND NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.to_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Receiving account must belong to the same user') END;
      SELECT CASE WHEN NEW.category_id!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date OR EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id IN (NEW.account_id,NEW.to_account_id) AND a.opening_date>NEW.date) THEN RAISE(ABORT,'Transaction date must be valid and on or after both account opening dates') END;
    END`,
        )
        .execute();
    }
  },
  (app) => {
    // Rolling back would invalidate saved zero transactions; keep this migration forward-only.
    throw new Error(
      "This migration is forward-only. Restore a verified backup to roll back.",
    );
  },
);
