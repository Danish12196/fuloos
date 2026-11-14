/// <reference path="../pb_data/types.d.ts" />
// Additive upgrade: Credit-Card & Debt Tools.
// Adds optional credit_limit, statement_day, payment_due_day, apr_bps, and
// minimum_payment on fuloos_accounts with SQLite trigger validation.
migrate(
  (app) => {
    const makeNumberField = (opts) =>
      typeof NumberField === "function"
        ? new NumberField(opts)
        : { type: "number", ...opts };

    const accounts = app.findCollectionByNameOrId("fuloos_accounts");
    accounts.fields.add(
      makeNumberField({
        name: "credit_limit",
        onlyInt: true,
        min: 0,
        max: 100000000000,
      }),
    );
    accounts.fields.add(
      makeNumberField({
        name: "statement_day",
        onlyInt: true,
        min: 0,
        max: 31,
      }),
    );
    accounts.fields.add(
      makeNumberField({
        name: "payment_due_day",
        onlyInt: true,
        min: 0,
        max: 31,
      }),
    );
    accounts.fields.add(
      makeNumberField({
        name: "apr_bps",
        onlyInt: true,
        min: 0,
        max: 100000,
      }),
    );
    accounts.fields.add(
      makeNumberField({
        name: "minimum_payment",
        onlyInt: true,
        min: 0,
        max: 100000000000,
      }),
    );
    app.save(accounts);

    for (const action of ["INSERT", "UPDATE"]) {
      const when = action.toLowerCase();
      app
        .db()
        .newQuery(`DROP TRIGGER IF EXISTS fuloos_account_credit_card_${when}`)
        .execute();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_account_credit_card_${when} BEFORE ${action} ON fuloos_accounts BEGIN
      SELECT CASE
        WHEN NEW.credit_limit IS NOT NULL AND (
          typeof(NEW.credit_limit) NOT IN ('integer', 'real')
          OR NEW.credit_limit != CAST(NEW.credit_limit AS INTEGER)
          OR NEW.credit_limit < 0
          OR NEW.credit_limit > 100000000000
        )
        THEN RAISE(ABORT, 'credit_limit must be a nonnegative integer in fils')
      END;
      SELECT CASE
        WHEN NEW.minimum_payment IS NOT NULL AND (
          typeof(NEW.minimum_payment) NOT IN ('integer', 'real')
          OR NEW.minimum_payment != CAST(NEW.minimum_payment AS INTEGER)
          OR NEW.minimum_payment < 0
          OR NEW.minimum_payment > 100000000000
        )
        THEN RAISE(ABORT, 'minimum_payment must be a nonnegative integer in fils')
      END;
      SELECT CASE
        WHEN NEW.statement_day IS NOT NULL AND (
          typeof(NEW.statement_day) NOT IN ('integer', 'real')
          OR NEW.statement_day != CAST(NEW.statement_day AS INTEGER)
          OR NEW.statement_day < 0
          OR NEW.statement_day > 31
        )
        THEN RAISE(ABORT, 'statement_day must be between 1 and 31 (or 0 when unset)')
      END;
      SELECT CASE
        WHEN NEW.payment_due_day IS NOT NULL AND (
          typeof(NEW.payment_due_day) NOT IN ('integer', 'real')
          OR NEW.payment_due_day != CAST(NEW.payment_due_day AS INTEGER)
          OR NEW.payment_due_day < 0
          OR NEW.payment_due_day > 31
        )
        THEN RAISE(ABORT, 'payment_due_day must be between 1 and 31 (or 0 when unset)')
      END;
      SELECT CASE
        WHEN NEW.apr_bps IS NOT NULL AND (
          typeof(NEW.apr_bps) NOT IN ('integer', 'real')
          OR NEW.apr_bps != CAST(NEW.apr_bps AS INTEGER)
          OR NEW.apr_bps < 0
          OR NEW.apr_bps > 100000
        )
        THEN RAISE(ABORT, 'apr_bps must be an integer between 0 and 100000')
      END;
    END`,
        )
        .execute();
    }
  },
  (app) => {
    app
      .db()
      .newQuery("DROP TRIGGER IF EXISTS fuloos_account_credit_card_insert")
      .execute();
    app
      .db()
      .newQuery("DROP TRIGGER IF EXISTS fuloos_account_credit_card_update")
      .execute();

    const accounts = app.findCollectionByNameOrId("fuloos_accounts");
    accounts.fields.removeByName("credit_limit");
    accounts.fields.removeByName("statement_day");
    accounts.fields.removeByName("payment_due_day");
    accounts.fields.removeByName("apr_bps");
    accounts.fields.removeByName("minimum_payment");
    app.save(accounts);
  },
);
