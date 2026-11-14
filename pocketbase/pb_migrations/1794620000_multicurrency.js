/// <reference path="../pb_data/types.d.ts" />
// Additive upgrade: Explicit Multi-Currency Support.
// Adds optional currency on fuloos_accounts and explicit original_amount,
// original_currency, and fx_rate on fuloos_transactions with SQLite trigger validation.
migrate(
  (app) => {
    const makeTextField = (opts) =>
      typeof TextField === "function"
        ? new TextField(opts)
        : { type: "text", ...opts };
    const makeNumberField = (opts) =>
      typeof NumberField === "function"
        ? new NumberField(opts)
        : { type: "number", ...opts };

    const accounts = app.findCollectionByNameOrId("fuloos_accounts");
    accounts.fields.add(makeTextField({ name: "currency", max: 3 }));
    app.save(accounts);

    const transactions = app.findCollectionByNameOrId("fuloos_transactions");
    transactions.fields.add(
      makeNumberField({
        name: "original_amount",
        onlyInt: true,
        min: 0,
        max: 100000000000,
      }),
    );
    transactions.fields.add(
      makeTextField({ name: "original_currency", max: 3 }),
    );
    transactions.fields.add(makeNumberField({ name: "fx_rate", min: 0 }));
    app.save(transactions);

    for (const action of ["INSERT", "UPDATE"]) {
      const when = action.toLowerCase();
      app
        .db()
        .newQuery(`DROP TRIGGER IF EXISTS fuloos_transaction_multicurrency_${when}`)
        .execute();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_transaction_multicurrency_${when} BEFORE ${action} ON fuloos_transactions BEGIN
      SELECT CASE
        WHEN COALESCE(NEW.original_currency, '') != '' AND (length(NEW.original_currency) != 3 OR NEW.original_currency != upper(NEW.original_currency))
        THEN RAISE(ABORT, 'original_currency must be a 3-letter uppercase ISO currency code')
      END;
      SELECT CASE
        WHEN COALESCE(NEW.original_currency, '') NOT IN ('', 'AED') AND (
          NEW.original_amount IS NULL
          OR typeof(NEW.original_amount) NOT IN ('integer', 'real')
          OR NEW.original_amount != CAST(NEW.original_amount AS INTEGER)
          OR NEW.original_amount < 0
          OR NEW.original_amount > 100000000000
          OR NEW.fx_rate IS NULL
          OR typeof(NEW.fx_rate) NOT IN ('integer', 'real')
          OR NEW.fx_rate <= 0
        )
        THEN RAISE(ABORT, 'Foreign currency transactions require nonnegative integer original_amount and positive fx_rate')
      END;
    END`,
        )
        .execute();
    }
  },
  (app) => {
    app
      .db()
      .newQuery("DROP TRIGGER IF EXISTS fuloos_transaction_multicurrency_insert")
      .execute();
    app
      .db()
      .newQuery("DROP TRIGGER IF EXISTS fuloos_transaction_multicurrency_update")
      .execute();

    const transactions = app.findCollectionByNameOrId("fuloos_transactions");
    transactions.fields.removeByName("original_amount");
    transactions.fields.removeByName("original_currency");
    transactions.fields.removeByName("fx_rate");
    app.save(transactions);

    const accounts = app.findCollectionByNameOrId("fuloos_accounts");
    accounts.fields.removeByName("currency");
    app.save(accounts);
  },
);
