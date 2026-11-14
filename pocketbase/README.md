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

## Email notifications (`1794540000_notifications.js` + `pb_hooks`)

Fuloos supports opt-in email notifications (upcoming bills due N days ahead, overdue recurring occurrences, monthly budgets reaching 80% or exceeding 100%, and an optional weekly summary digest) evaluated server-side by PocketBase JS hooks.

1. **Apply the migration**: Copy `pocketbase/pb_migrations/1794540000_notifications.js` into your PocketBase `pb_migrations` directory and run `./pocketbase migrate up` (or restart PocketBase). This creates owner-only `fuloos_notification_prefs` and `fuloos_notification_log` collections.
2. **Install the hooks**: Copy both `pocketbase/pb_hooks/notifications_lib.js` and `pocketbase/pb_hooks/notifications.pb.js` into your PocketBase `pb_hooks` directory and restart PocketBase.
   - `notifications.pb.js` registers an hourly cron job (`fuloos_notifications_hourly`, `0 * * * *`) and the authenticated, rate-limited `POST /api/fuloos/notify-test` endpoint.
   - All alerts are **off by default** (`email_enabled = false`) until a user opts in via **Settings → Notifications**.
   - Sent notifications are deduplicated per `(user_id, dedup_key)` in `fuloos_notification_log` so the same bill/month/week alert is never sent twice.
3. **Configure SMTP**: In the PocketBase Admin UI, open **Settings → Mail settings**, set your **Sender name** / **Sender address**, enable **SMTP**, and enter your SMTP host, port, username, and password. Use PocketBase's built-in **Send test email** button or the in-app **Settings → Notifications → Send test email** button to verify delivery.
4. **Configure `APP_URL`**: Set the `APP_URL` environment variable on the PocketBase process (for example, `APP_URL=https://fuloos.vercel.app`) so notification emails include a working **Manage / Unsubscribe** link (`/?settings=notifications`).

## Account security (`1794520000_account_security.js` + `pb_hooks`)

1. **Opt-in MFA / Email OTP (`1794520000_account_security.js`)**:
   - Copy `pocketbase/pb_migrations/1794520000_account_security.js` into your PocketBase `pb_migrations` directory and run `./pocketbase migrate up` (or restart PocketBase).
   - This adds a `mfa_enabled` boolean field on `fuloos_users` (default `false`, so existing and new users are not forced into MFA silently), enables Email OTP (`duration: 180`, `length: 8`), and sets `mfa.enabled = true` with `mfa.rule = "mfa_enabled = true"`.
   - **SMTP requirement**: Email OTP, password reset, email verification, and email change all require SMTP to be configured in PocketBase Admin UI (**Settings → Mail settings**).
   - **Operator override**: An operator can enable MFA globally for all users by changing `fuloos_users → Options → MFA → Rule` to `""` (empty) in the PocketBase Admin UI, or keep `"mfa_enabled = true"` so each user opts in from **Settings → Account & Security**.
2. **Sign out everywhere (`pb_hooks/fuloos_security.pb.js`)**:
   - PocketBase does not allow regular users to rotate their own `tokenKey` through the standard record `PATCH` API (non-superuser updates to `tokenKey` are ignored).
   - Copy `pocketbase/pb_hooks/fuloos_security.pb.js` into your PocketBase `pb_hooks` directory and restart PocketBase. It registers `POST /api/fuloos/sign-out-everywhere` (authenticated to `fuloos_users`), which calls `auth.refreshTokenKey()` and `$app.save(auth)` to invalidate all existing JWTs for that user across all browsers and devices.

## Email-Forward & Shortcut Alert Capture (`1794600000_captured_alerts.js` + `pb_hooks`)

Fuloos can automatically capture UAE bank transaction alerts (Liv, Mashreq, ADCB, FAB, ADIB, ENBD) into a per-user **Pending Alerts Queue** without requiring bank aggregator credentials.

1. **Apply the migration & hooks**:
   - Copy `pocketbase/pb_migrations/1794600000_captured_alerts.js` into `pb_migrations/` and run `./pocketbase migrate up`.
   - Copy both `pocketbase/pb_hooks/inbound_capture_lib.js` and `pocketbase/pb_hooks/inbound_capture.pb.js` into `pb_hooks/` and restart PocketBase.
   - Endpoints registered:
     - `POST /api/fuloos/capture-token/rotate` (authenticated `fuloos_users`): generates/rotates the user's personal capture token (`token_hash` stored via SHA-256).
     - `POST /api/fuloos/inbound-email`: accepts JSON `{ token, subject?, text?, html?, source? }` (max 64 KB, 20 requests/min/user, 24h deduplication by `raw_text` hash). Also accepts `Authorization: Bearer <token>` or `X-Fuloos-Token: <token>`, and Postmark/Mailgun/Resend field aliases (`TextBody`/`HtmlBody`, `body-plain`/`body-html`).
2. **Cloudflare Email Worker setup**:
   - Create an Email Routing rule for your bank-alerts address that forwards the email to a Cloudflare Worker, which extracts `subject`/`text`/`html` and `POST`s `{ token, subject, text, html }` as JSON to `https://<your-pb-host>/api/fuloos/inbound-email`.
3. **iOS Shortcuts / Android Tasker setup**:
   - **iOS Shortcuts**: Create a Personal Automation triggered on receiving a bank SMS/Mail (or Share Sheet / Clipboard), then add **Get Contents of URL** (`POST`, JSON body `{ "token": "<YOUR_TOKEN>", "source": "shortcut", "text": "<Shortcut Input>" }`).
   - **Android Tasker**: Add a Notification/SMS event profile for your bank app/sender and send an **HTTP Request** (`POST`, JSON body `{ "token": "<YOUR_TOKEN>", "source": "shortcut", "text": "%evtprm3" }`).

## Web Push Notifications (`1794700000_web_push.js` + `pb_hooks`)

Fuloos supports opt-in browser Web Push notifications alongside email alerts using the pluggable channel dispatcher in `notifications_lib.js`.

1. **Apply the migration & hooks**:
   - Copy `pocketbase/pb_migrations/1794700000_web_push.js` into `pb_migrations/` and run `./pocketbase migrate up` (creates owner-only `fuloos_push_subscriptions` and extends `fuloos_notification_log.channel` to allow `"push"`).
   - Copy `pocketbase/pb_hooks/web_push_lib.js`, `pocketbase/pb_hooks/web_push.pb.js`, `pocketbase/pb_hooks/notifications_lib.js`, and `pocketbase/pb_hooks/notifications.pb.js` into `pb_hooks/` and restart PocketBase.
   - `web_push.pb.js` registers `POST /api/fuloos/push-test` (authenticated `fuloos_users`, rate-limited to 3 per hour / 60s cooldown).
2. **Generate VAPID keys**:
   - Generate a P-256 VAPID keypair (for example with `npx web-push generate-vapid-keys`).
   - Set `VITE_VAPID_PUBLIC_KEY` as a **build** environment variable for the frontend (e.g. on Vercel), then rebuild/redeploy. Without `VITE_VAPID_PUBLIC_KEY`, the UI shows **Not configured** and explains that the VAPID key is missing.
3. **Server-side push delivery (`PUSH_RELAY_URL`)**:
   - **Runtime note**: PocketBase's embedded Goja JS runtime does not expose WebCrypto ECDH (P-256), AES-128-GCM, or ES256 JWT signing primitives required for direct RFC 8291 Web Push encryption. Rather than implementing unverified custom elliptic-curve cryptography in Goja, `web_push_lib.js` dispatches push payloads to an external HTTPS webhook relay configured via `PUSH_RELAY_URL` (and optional `PUSH_RELAY_SECRET` sent as `Authorization: Bearer <secret>`), forwarding `{ subscription: { endpoint, keys: { p256dh, auth } }, payload: { title, body, url, tag }, vapid?: { publicKey, privateKey, subject } }`.
   - Set `PUSH_RELAY_URL`, `PUSH_RELAY_SECRET`, and optionally `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` on the PocketBase process.
   - If the relay or push service returns HTTP `404` or `410`, PocketBase automatically deletes the stale `fuloos_push_subscriptions` record.
