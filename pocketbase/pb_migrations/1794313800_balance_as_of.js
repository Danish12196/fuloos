// Trigger-only upgrade, no collection or field changes.
// An account's opening_balance/opening_date is now a "balance as of a date" anchor, not a
// creation date: transactions dated before it are allowed and are treated as already included
// in that balance. This drops the two guards that rejected such transactions and that stopped
// the anchor date moving past existing transactions. Every other check is unchanged.
const transactionChecks = (amountCheck, dateCheck) => `
      SELECT CASE WHEN ${amountCheck} END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Account must belong to the same user') END;
      SELECT CASE WHEN NEW.type='transfer' AND (NEW.to_account_id='' OR NEW.to_account_id=NEW.account_id OR NEW.category_id!='') THEN RAISE(ABORT,'A transfer requires two different accounts and no category') END;
      SELECT CASE WHEN NEW.type!='transfer' AND NEW.to_account_id!='' THEN RAISE(ABORT,'Only a transfer has a receiving account') END;
      SELECT CASE WHEN NEW.to_account_id!='' AND NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.to_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Receiving account must belong to the same user') END;
      SELECT CASE WHEN NEW.category_id!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN ${dateCheck} END;`;
const amount =
  "NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be nonnegative integer fils')";
const openingBalance =
  "SELECT CASE WHEN NEW.opening_balance != CAST(NEW.opening_balance AS INTEGER) OR abs(NEW.opening_balance)>100000000000 THEN RAISE(ABORT,'Opening balance must be integer fils') END;";

function replaceTriggers(app, transactionDate, accountDate) {
  for (const action of ["INSERT", "UPDATE"]) {
    const when = action.toLowerCase();
    app
      .db()
      .newQuery(`DROP TRIGGER IF EXISTS fuloos_transaction_${when}`)
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_transaction_${when} BEFORE ${action} ON fuloos_transactions BEGIN${transactionChecks(amount, transactionDate)}
    END`,
      )
      .execute();
    app
      .db()
      .newQuery(`DROP TRIGGER IF EXISTS fuloos_account_${when}`)
      .execute();
    app
      .db()
      .newQuery(
        `CREATE TRIGGER fuloos_account_${when} BEFORE ${action} ON fuloos_accounts BEGIN
      ${openingBalance}
      SELECT CASE WHEN ${accountDate} END;
    END`,
      )
      .execute();
  }
}

migrate(
  (app) =>
    replaceTriggers(
      app,
      "date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date THEN RAISE(ABORT,'Transaction date must be valid')",
      "date(NEW.opening_date) IS NULL OR date(NEW.opening_date)!=NEW.opening_date THEN RAISE(ABORT,'Balance date must be valid')",
    ),
  // Restores the previous guards. Fails if a transaction is already dated before its account's anchor.
  (app) =>
    replaceTriggers(
      app,
      "date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date OR EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id IN (NEW.account_id,NEW.to_account_id) AND a.opening_date>NEW.date) THEN RAISE(ABORT,'Transaction date must be valid and on or after both account opening dates')",
      "date(NEW.opening_date) IS NULL OR date(NEW.opening_date)!=NEW.opening_date OR EXISTS(SELECT 1 FROM fuloos_transactions t WHERE (t.account_id=NEW.id OR t.to_account_id=NEW.id) AND t.date<NEW.opening_date) THEN RAISE(ABORT,'Opening date must be valid and no later than existing transactions')",
    ),
);
