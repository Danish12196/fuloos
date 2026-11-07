# Fuloos on PocketBase

The frontend runs on Vercel. PocketBase runs on your existing persistent server at `https://pb.danishali.dev`; Vercel does not host PocketBase's persistent SQLite process. The public health endpoint returned HTTP 200 and `API is healthy.` on 3 November 2026. No administrator access or installed PocketBase version was available, so pending migrations must be applied by the server operator during deployment.

## Live server checks

Read-only probes of `https://pb.danishali.dev` on 7 November 2026:

- `/api/health` returns 200. CORS preflight allows any origin (`*`) with `content-type,authorization` headers, so both the Vercel origin and `localhost` work.
- `fuloos_users` exists with email/password and Google OAuth2 enabled; MFA and OTP are off. A wrong password returns 400 `Failed to authenticate.`
- `fuloos_accounts`, `fuloos_categories` and `fuloos_transactions` exist; unauthenticated lists return empty.
- Batch requests are enabled.
- **`fuloos_recurring`, `fuloos_recurring_occurrences` and `fuloos_recurring_prefs` are missing.** Migrations `1793881800_recurring.js` and `1793968200_recurring_automation.js` have not been applied. The app still signs in and loads (recurring data loads as empty), but creating schedules, confirming payments and saving automation preferences fail until they are installed.

The same flow was run on 7 November 2026 against local PocketBase v0.40.6 instances (all four migrations, and only the first two to mirror production) using the app's own `PocketBaseBackend`: sign-up, stored session, session restore, empty ledger load, account create/delete, sign-out, wrong password and duplicate email all behaved correctly. With only the first two migrations, the ledger still loads and only recurring saves fail.

No user was created on the production server. To verify sign-up and sign-in end to end, run the smoke test with a throwaway email. It uses the app's own `PocketBaseBackend`, checks every collection, signs up/in, restores the session in a fresh instance, loads the ledger, creates and deletes one account, signs out and confirms a wrong password is rejected:

```sh
FULOOS_TEST_EMAIL=you+fuloos-test@example.com FULOOS_TEST_PASSWORD='long-random-password' npm run check:live -- --signup
```

Omit `--signup` to reuse an existing test user, or omit the credentials to run only the read-only collection checks. Set `FULOOS_PB_URL` to test another server. Remove the test user afterwards with **Delete my account** in the app (after the lockdown migration), or from the dashboard as described under "Clearing test data".

## Installation & Upgrades

1. Back up the running instance's `pb_data` and existing migration folder. Check its version using `./pocketbase --version`. These migrations use the v0.23+ fields/collection API; review compatibility with the installed version before applying them.
2. Copy the migration files from `pocketbase/pb_migrations/` into the instance's `pb_migrations` directory, preserving existing files:
   - `1793709000_fuloos.js` — creates `fuloos_users`, `fuloos_accounts`, `fuloos_categories` and `fuloos_transactions` (refuses collection-name collisions).
   - `1793795400_import_appearance.js` — enables zero-fils amounts and account/category emoji fields.
   - `1793881800_recurring.js` — creates `fuloos_recurring` and `fuloos_recurring_occurrences` with per-user ownership rules, unique indexes, and relational integrity triggers.
   - `1793968200_recurring_automation.js` — adds `quarterly` frequency, `match_source` and `match_reason` on occurrences, and creates `fuloos_recurring_prefs` collection with per-user ownership rules and triggers.
   - `1794054600_csv_presets.js` — creates `fuloos_csv_presets` so CSV column-mapping presets are stored per user and follow them across devices.
   - `1794141000_budgets.js` — creates `fuloos_budgets` (monthly per-category limits) with per-user ownership rules and integrity triggers.
   - `1794227400_lockdown.js` — lets users delete their own account, and creates the owner-only `fuloos_ml_settings` and `fuloos_ml_examples` collections for AI suggestions.
   - `1794313800_balance_as_of.js` — trigger-only, no field changes. An account's `opening_balance`/`opening_date` now means "balance as of a date", so transactions may be dated before it and the date may move past existing transactions. All other ledger checks are unchanged.
3. Run `./pocketbase migrate up` using the instance's existing data and migrations paths, then restart PocketBase. Alternatively, the standard server applies pending migrations on startup. Use the existing container/service's normal deployment process, rather than starting a second instance over the same database.
4. Keep HTTPS enabled. If the server restricts allowed origins, allow the exact Vercel production origin and localhost development origin. Do not put administrator tokens into Vercel frontend variables.
5. Set `VITE_POCKETBASE_URL=https://pb.danishali.dev` as a **build** environment variable, then rebuild/redeploy the frontend. Without it, Fuloos remains an explicitly labeled in-memory demo.
6. Verify signup/signin, then create two test users and confirm that neither user can read or reference the other's accounts, categories, transactions, recurring schedules, occurrence confirmations, automation preferences, or budgets. Test opening-date changes, category/account deletion restrictions, recurring schedule confirmation/linking, and credit-card repayments before real financial data.

The migration allows ordinary email/password signup and immediate signin. Email verification is not required initially; if you later require verification, configure SMTP and update the auth UI/collection auth rule together. Password reset and verification-email UI are future additions.

## Data guarantees

API rules scope every ledger and recurring record to its owner and prevent reassigning ownership. SQLite triggers validate relation ownership, integer fils, transfer structure, valid ISO calendar dates, and opening-date consistency in the same write. Transfers are one atomic record; they do not need a two-request balance update. Account balances are derived, not independently mutated. Categories have no income/expense type and may be reused for either.

### Recurring collections (`1793881800_recurring.js`)

- **`fuloos_recurring`**: Stores recurring `expense` and `income` schedules (`name`, integer fils `amount` in `0..100,000,000,000`, `amount_type` in `fixed | variable`, `account_id`, optional `category_id`, `frequency` in `daily | weekly | monthly | yearly`, `start_date`, optional `end_date >= start_date`, `status` in `active | paused`, and `notes`).
- **`fuloos_recurring_occurrences`**: Links a confirmed `(recurring_id, occurrence_date)` pair to a real `fuloos_transactions` row (`transaction_id`).
- **Uniqueness & type safety**: Enforces `UNIQUE(recurring_id, occurrence_date)` (an occurrence cannot be confirmed twice) and `UNIQUE(transaction_id)` (a ledger transaction cannot be linked to multiple occurrences). SQLite triggers enforce same-user ownership across `account_id`, `category_id`, `recurring_id` and `transaction_id`, require `transaction.type == recurring.type` (blocking transfers and mismatched types), and prevent changing the `type` of a schedule or transaction while linked.
- **Safe deletion**: Deleting an account or category referenced by `fuloos_recurring` is blocked until reassigned or removed. Deleting a `fuloos_recurring` schedule automatically removes its `fuloos_recurring_occurrences` links while leaving historical `fuloos_transactions` and account balances intact. Deleting a linked `fuloos_transactions` row automatically removes its occurrence confirmation link.

### Recurring Automation collections & schema updates (`1793968200_recurring_automation.js`)

- **`fuloos_recurring.frequency`**: Extends frequency options to include `quarterly` (`daily | weekly | monthly | quarterly | yearly`).
- **`fuloos_recurring_occurrences`**: Adds optional `match_source` (`auto | manual`) and `match_reason` fields to track provenance and explain automatic transaction linkages.
- **`fuloos_recurring_prefs`**: Stores user automation preferences (`user_id`, `auto_detect` in `on | off`, `auto_match` in `auto | review | off`, and `dismissed_keys` JSON array).
- **Triggers & Data Integrity**: Preserves cross-tenant isolation and per-user uniqueness (`UNIQUE(user_id)`). Validates that user preferences cannot reference another user's account or ledger records.

### CSV import presets (`1794054600_csv_presets.js`)

- **`fuloos_csv_presets`**: One row per saved column-mapping preset (`user_id`, `name` of 1–80 characters, `name_key` = trimmed lowercase name, and `config` JSON with delimiter, header row, skipped rows, split/flip, decimal separator, date format, saved headers and column mapping). Owner-only API rules match the other collections.
- **Uniqueness & validation**: `UNIQUE(user_id, name_key)` keeps preset names unique per user, ignoring case. Triggers reject blank or over-long names, non-object `config` values, and ownership changes. The app validates the full preset shape again when it loads records.
- **Upgrade from browser-only presets**: the first time a signed-in user opens the CSV import dialog, presets saved in that browser by older versions are uploaded to their account (a preset whose name already exists in the account is kept as the account version) and then removed from the browser, so a different account signing in later on the same browser does not receive them. Presets that fail to upload stay in the browser and are retried next time.
- **Before the migration is installed** the app keeps presets in the browser, as before, and says so in the dialog. Demo mode always uses browser storage.
- The down migration deletes `fuloos_csv_presets` and its saved presets; it does not touch ledger data.

### Budgets collection (`1794141000_budgets.js`)

- **`fuloos_budgets`**: `user_id`, `category_id` (same user's category), `amount` (integer fils `0..100,000,000,000`, zero allowed), `start_month` (`YYYY-MM`) and optional `end_month` (`YYYY-MM`, on or after `start_month`; empty means it repeats indefinitely).
- **Triggers**: validate same-user category ownership, integer fils, real calendar months between 1970-01 and 2100-12, and reject overlapping month ranges for the same user and category. Ownership cannot be changed. Deleting a category deletes its budgets. Budgets never change account balances.
- The frontend treats a missing `fuloos_budgets` collection (404 before the migration is applied) as having no budgets.

### Lockdown migration (`1794227400_lockdown.js`)

- **Account self-delete**: `fuloos_users.deleteRule` becomes `id = @request.auth.id` (Fuloos users only). The app's **Delete my account** button first tries to delete the user directly (a 403 means this migration isn't applied, and nothing is removed). If a delete guard blocks the cascade (400), it deletes the user's recurring schedules (their confirmed occurrences go with them) and transactions in batches of 100, then deletes the user again. PocketBase's cascade then removes accounts, categories, budgets, CSV presets, recurring preferences and AI data. The order matters because the account and category delete guards refuse while transactions or schedules still point at them, and PocketBase does not cascade in a fixed order. A partial run is safe to retry, and the app reloads the ledger if deletion stops part-way.
- **`fuloos_ml_settings`**: one row per user (`UNIQUE(user_id)`): `learn_consent`, `share_consent`, `consent_version`, `consent_at`, and `category_map` (a JSON object mapping each base-model category to the user's `fuloos_categories` ids).
- **`fuloos_ml_examples`**: the user's correction log: `merchant_text` (cleaned and masked, 1–120 characters, never the raw SMS), `payee`, `amount` (integer fils), optional `category_id` (same user; cleared if the category is deleted), `source` (`sms | csv | manual`), `model_version`, `suggested_category`, `accepted`, `created`.
- Both are owner-only with the same rules as the ledger collections; ownership cannot change. Nothing in them is shared. Sharing examples for base-model retraining would be a separate, explicit export step.

### Clearing test data from the dashboard

Truncate collections in this order so no delete guard blocks: `fuloos_recurring_occurrences`, `fuloos_recurring_prefs`, `fuloos_budgets`, `fuloos_csv_presets`, `fuloos_ml_examples`, `fuloos_ml_settings`, `fuloos_recurring`, `fuloos_transactions`, `fuloos_categories`, `fuloos_accounts`, `fuloos_users`. To remove one user, delete their recurring schedules and transactions first, then the user.

Each migration includes a down migration that **deletes its Fuloos collections and their records**. Do not run `migrate down` on real data as a routine fix. Restore a verified backup for a production rollback.

Keep regular off-device backups and update PocketBase through its supported version upgrade path. A self-hosted PocketBase instance does not depend on Supabase inactivity policies, but availability still depends on your server, persistent volume, backups and monitoring.

References checked: [Migrations](https://pocketbase.io/docs/js-migrations/), [collection operations](https://pocketbase.io/docs/js-collections/) and [record API](https://pocketbase.io/docs/api-records/).

## Google sign-in

The frontend uses PocketBase's official SDK popup flow with a one-off realtime connection. It shares the normal Fuloos session after success. The button is enabled automatically when the public auth-methods endpoint advertises Google.

1. In Google Cloud Console, create/configure an OAuth consent screen and an OAuth client of type **Web application**. For an external app in Testing, add your test Google accounts as test users.
2. Add the exact authorized redirect URI: `https://pb.danishali.dev/api/oauth2-redirect`.
3. In the PocketBase dashboard, edit **fuloos_users → Options → OAuth2**, enable OAuth2 and the Google provider, then enter the Google client ID and client secret and save. Store the secret only in PocketBase, never Vercel or the frontend repository.
4. Reload Fuloos. Choose Continue with Google and verify a new user and an existing user can authenticate. Keep the Google popup and PocketBase realtime connection reachable through your reverse proxy.

No migration or container restart is required for this provider setting. OAuth must be configured on `fuloos_users`, not `_superusers` or another application's users collection. Google login has not been end-to-end verified until the provider credentials are configured and the consent flow is completed.
