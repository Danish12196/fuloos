/// <reference path="../pb_data/types.d.ts" />
// Additive upgrade: Shared / Household Mode.
// Creates fuloos_households and fuloos_household_members, adds optional
// household_id on fuloos_accounts and fuloos_budgets, and updates API rules
// and SQLite triggers so shared records are accessible to household members
// while private records (household_id = '') remain strictly owner-only.

const txChecksWithHouseholds = `
      SELECT CASE WHEN NEW.amount IS NULL OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be nonnegative integer fils') END;
      SELECT CASE WHEN NOT EXISTS(
        SELECT 1 FROM fuloos_accounts a
        WHERE a.id=NEW.account_id AND (
          a.user_id=NEW.user_id
          OR (
            COALESCE(a.household_id,'')!='' AND EXISTS(
              SELECT 1 FROM fuloos_households h
              WHERE h.id=a.household_id AND (
                h.owner_id=NEW.user_id
                OR EXISTS(SELECT 1 FROM fuloos_household_members m WHERE m.household_id=h.id AND m.user_id=NEW.user_id AND m.status='active' AND m.role IN ('owner','editor'))
              )
            )
          )
        )
      ) THEN RAISE(ABORT,'Account must belong to the same user or shared household') END;
      SELECT CASE WHEN NEW.type='transfer' AND (COALESCE(NEW.to_account_id,'')='' OR COALESCE(NEW.to_account_id,'')=NEW.account_id OR COALESCE(NEW.category_id,'')!='') THEN RAISE(ABORT,'A transfer requires two different accounts and no category') END;
      SELECT CASE WHEN NEW.type!='transfer' AND COALESCE(NEW.to_account_id,'')!='' THEN RAISE(ABORT,'Only a transfer has a receiving account') END;
      SELECT CASE WHEN COALESCE(NEW.to_account_id,'')!='' AND NOT EXISTS(
        SELECT 1 FROM fuloos_accounts a
        WHERE a.id=NEW.to_account_id AND (
          a.user_id=NEW.user_id
          OR (
            COALESCE(a.household_id,'')!='' AND EXISTS(
              SELECT 1 FROM fuloos_households h
              WHERE h.id=a.household_id AND (
                h.owner_id=NEW.user_id
                OR EXISTS(SELECT 1 FROM fuloos_household_members m WHERE m.household_id=h.id AND m.user_id=NEW.user_id AND m.status='active' AND m.role IN ('owner','editor'))
              )
            )
          )
        )
      ) THEN RAISE(ABORT,'Receiving account must belong to the same user or shared household') END;
      SELECT CASE WHEN COALESCE(NEW.category_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date THEN RAISE(ABORT,'Transaction date must be valid') END;
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

const txChecksHardenedPrev = `
      SELECT CASE WHEN NEW.amount IS NULL OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount != CAST(NEW.amount AS INTEGER) OR NEW.amount < 0 OR NEW.amount > 100000000000 THEN RAISE(ABORT,'Amount must be nonnegative integer fils') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Account must belong to the same user') END;
      SELECT CASE WHEN NEW.type='transfer' AND (COALESCE(NEW.to_account_id,'')='' OR COALESCE(NEW.to_account_id,'')=NEW.account_id OR COALESCE(NEW.category_id,'')!='') THEN RAISE(ABORT,'A transfer requires two different accounts and no category') END;
      SELECT CASE WHEN NEW.type!='transfer' AND COALESCE(NEW.to_account_id,'')!='' THEN RAISE(ABORT,'Only a transfer has a receiving account') END;
      SELECT CASE WHEN COALESCE(NEW.to_account_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_accounts a WHERE a.id=NEW.to_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'Receiving account must belong to the same user') END;
      SELECT CASE WHEN COALESCE(NEW.category_id,'')!='' AND NOT EXISTS(SELECT 1 FROM fuloos_categories c WHERE c.id=NEW.category_id AND c.user_id=NEW.user_id) THEN RAISE(ABORT,'Category must belong to the same user') END;
      SELECT CASE WHEN date(NEW.date) IS NULL OR date(NEW.date)!=NEW.date THEN RAISE(ABORT,'Transaction date must be valid') END;
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
    const users = app.findCollectionByNameOrId("fuloos_users");
    const makeRelationField = (opts) =>
      typeof RelationField === "function"
        ? new RelationField(opts)
        : { type: "relation", ...opts };

    const households = new Collection({
      id: "fulooshh0000001",
      name: "fuloos_households",
      type: "base",
      listRule:
        "@request.auth.collectionName = 'fuloos_users' && owner_id = @request.auth.id",
      viewRule:
        "@request.auth.collectionName = 'fuloos_users' && owner_id = @request.auth.id",
      createRule:
        "@request.auth.collectionName = 'fuloos_users' && @request.body.owner_id = @request.auth.id",
      updateRule:
        "@request.auth.collectionName = 'fuloos_users' && owner_id = @request.auth.id && (@request.body.owner_id:isset = false || @request.body.owner_id = @request.auth.id)",
      deleteRule:
        "@request.auth.collectionName = 'fuloos_users' && owner_id = @request.auth.id",
      fields: [
        {
          name: "name",
          type: "text",
          required: true,
          min: 1,
          max: 80,
        },
        {
          name: "owner_id",
          type: "relation",
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_households_owner ON fuloos_households (owner_id)",
      ],
    });
    app.save(households);

    const householdMembers = new Collection({
      id: "fulooshhmemb001",
      name: "fuloos_household_members",
      type: "base",
      listRule:
        "@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || household_id.owner_id = @request.auth.id || (household_id.fuloos_household_members_via_household_id.user_id ?= @request.auth.id && household_id.fuloos_household_members_via_household_id.status ?= 'active'))",
      viewRule:
        "@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || household_id.owner_id = @request.auth.id || (household_id.fuloos_household_members_via_household_id.user_id ?= @request.auth.id && household_id.fuloos_household_members_via_household_id.status ?= 'active'))",
      createRule:
        "@request.auth.collectionName = 'fuloos_users' && household_id.owner_id = @request.auth.id",
      updateRule:
        "@request.auth.collectionName = 'fuloos_users' && household_id.owner_id = @request.auth.id",
      deleteRule:
        "@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || household_id.owner_id = @request.auth.id)",
      fields: [
        {
          name: "household_id",
          type: "relation",
          required: true,
          collectionId: households.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: "user_id",
          type: "relation",
          required: false,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: "role",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["owner", "editor", "viewer"],
        },
        {
          name: "status",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["active", "pending"],
        },
        {
          name: "invite_code",
          type: "text",
          required: false,
          max: 64,
        },
        {
          name: "member_email",
          type: "text",
          required: false,
          max: 200,
        },
      ],
      indexes: [
        "CREATE INDEX idx_fuloos_hm_household ON fuloos_household_members (household_id,status)",
        "CREATE INDEX idx_fuloos_hm_user ON fuloos_household_members (user_id,status)",
        "CREATE UNIQUE INDEX idx_fuloos_hm_invite_code ON fuloos_household_members (invite_code) WHERE invite_code != ''",
      ],
    });
    app.save(householdMembers);

    // Now that fuloos_household_members exists, allow active members to list/view their household.
    const householdMemberView =
      "@request.auth.collectionName = 'fuloos_users' && (owner_id = @request.auth.id || (fuloos_household_members_via_household_id.user_id ?= @request.auth.id && fuloos_household_members_via_household_id.status ?= 'active'))";
    households.listRule = householdMemberView;
    households.viewRule = householdMemberView;
    app.save(households);

    const sharedView =
      "household_id != '' && (household_id.owner_id = @request.auth.id || (household_id.fuloos_household_members_via_household_id.user_id ?= @request.auth.id && household_id.fuloos_household_members_via_household_id.status ?= 'active'))";
    const sharedEdit =
      "household_id != '' && (household_id.owner_id = @request.auth.id || (household_id.fuloos_household_members_via_household_id.user_id ?= @request.auth.id && household_id.fuloos_household_members_via_household_id.status ?= 'active' && household_id.fuloos_household_members_via_household_id.role ?= 'editor'))";

    // Add optional household_id to fuloos_accounts and update rules.
    const accounts = app.findCollectionByNameOrId("fuloos_accounts");
    accounts.fields.add(
      makeRelationField({
        name: "household_id",
        required: false,
        collectionId: households.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    );
    accounts.listRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${sharedView}))`;
    accounts.viewRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${sharedView}))`;
    accounts.createRule =
      "@request.auth.collectionName = 'fuloos_users' && @request.body.user_id = @request.auth.id";
    accounts.updateRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${sharedEdit})) && (@request.body.user_id:isset = false || @request.body.user_id = user_id)`;
    accounts.deleteRule =
      "@request.auth.collectionName = 'fuloos_users' && user_id = @request.auth.id";
    app.save(accounts);

    // Add optional household_id to fuloos_budgets and update rules.
    const budgets = app.findCollectionByNameOrId("fuloos_budgets");
    budgets.fields.add(
      makeRelationField({
        name: "household_id",
        required: false,
        collectionId: households.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    );
    budgets.listRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${sharedView}))`;
    budgets.viewRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${sharedView}))`;
    budgets.createRule =
      "@request.auth.collectionName = 'fuloos_users' && @request.body.user_id = @request.auth.id";
    budgets.updateRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${sharedEdit})) && (@request.body.user_id:isset = false || @request.body.user_id = user_id)`;
    budgets.deleteRule =
      "@request.auth.collectionName = 'fuloos_users' && user_id = @request.auth.id";
    app.save(budgets);

    // Update fuloos_transactions API rules (tied to account_id.household_id or user_id = @request.auth.id).
    const txSharedView =
      "account_id.household_id != '' && (account_id.household_id.owner_id = @request.auth.id || (account_id.household_id.fuloos_household_members_via_household_id.user_id ?= @request.auth.id && account_id.household_id.fuloos_household_members_via_household_id.status ?= 'active'))";
    const txSharedEdit =
      "account_id.household_id != '' && (account_id.household_id.owner_id = @request.auth.id || (account_id.household_id.fuloos_household_members_via_household_id.user_id ?= @request.auth.id && account_id.household_id.fuloos_household_members_via_household_id.status ?= 'active' && account_id.household_id.fuloos_household_members_via_household_id.role ?= 'editor'))";
    const transactions = app.findCollectionByNameOrId("fuloos_transactions");
    transactions.listRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${txSharedView}))`;
    transactions.viewRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${txSharedView}))`;
    transactions.createRule =
      "@request.auth.collectionName = 'fuloos_users' && @request.body.user_id = @request.auth.id";
    transactions.updateRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${txSharedEdit})) && (@request.body.user_id:isset = false || @request.body.user_id = user_id)`;
    transactions.deleteRule = `@request.auth.collectionName = 'fuloos_users' && (user_id = @request.auth.id || (${txSharedEdit}))`;
    app.save(transactions);

    // SQLite triggers guarding household_id assignment on accounts and budgets.
    for (const action of ["INSERT", "UPDATE"]) {
      const when = action.toLowerCase();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_account_household_${when} BEFORE ${action} ON fuloos_accounts BEGIN
      SELECT CASE WHEN COALESCE(NEW.household_id,'')!='' AND NOT EXISTS(
        SELECT 1 FROM fuloos_households h
        WHERE h.id=NEW.household_id AND (
          h.owner_id=NEW.user_id
          OR EXISTS(SELECT 1 FROM fuloos_household_members m WHERE m.household_id=h.id AND m.user_id=NEW.user_id AND m.status='active' AND m.role IN ('owner','editor'))
        )
      ) THEN RAISE(ABORT,'Account owner must be an owner or editor of the household') END;
    END`,
        )
        .execute();
      app
        .db()
        .newQuery(
          `CREATE TRIGGER fuloos_budgets_household_${when} BEFORE ${action} ON fuloos_budgets BEGIN
      SELECT CASE WHEN COALESCE(NEW.household_id,'')!='' AND NOT EXISTS(
        SELECT 1 FROM fuloos_households h
        WHERE h.id=NEW.household_id AND (
          h.owner_id=NEW.user_id
          OR EXISTS(SELECT 1 FROM fuloos_household_members m WHERE m.household_id=h.id AND m.user_id=NEW.user_id AND m.status='active' AND m.role IN ('owner','editor'))
        )
      ) THEN RAISE(ABORT,'Budget owner must be an owner or editor of the household') END;
    END`,
        )
        .execute();
    }

    replaceTxTriggers(app, txChecksWithHouseholds);
  },
  (app) => {
    replaceTxTriggers(app, txChecksHardenedPrev);

    for (const trigger of [
      "fuloos_account_household_insert",
      "fuloos_account_household_update",
      "fuloos_budgets_household_insert",
      "fuloos_budgets_household_update",
    ]) {
      app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    }

    const owner =
      "@request.auth.collectionName = 'fuloos_users' && user_id = @request.auth.id";
    const createOwner =
      "@request.auth.collectionName = 'fuloos_users' && @request.body.user_id = @request.auth.id";
    const updateOwner =
      owner +
      " && (@request.body.user_id:isset = false || @request.body.user_id = @request.auth.id)";

    for (const name of ["fuloos_accounts", "fuloos_budgets", "fuloos_transactions"]) {
      const col = app.findCollectionByNameOrId(name);
      col.listRule = owner;
      col.viewRule = owner;
      col.createRule = createOwner;
      col.updateRule = updateOwner;
      col.deleteRule = owner;
      if (name !== "fuloos_transactions") {
        col.fields.removeByName("household_id");
      }
      app.save(col);
    }

    for (const name of ["fuloos_household_members", "fuloos_households"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        // Ignore if already removed.
      }
    }
  },
);
