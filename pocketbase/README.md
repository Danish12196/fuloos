# Fuloos on PocketBase

The frontend runs on Vercel. PocketBase runs on your existing persistent server at `https://pb.danishali.dev`; Vercel does not host PocketBase's persistent SQLite process. The public health endpoint returned HTTP 200 and `API is healthy.` on 3 November 2026. No administrator access or installed PocketBase version was available, so the migration has **not** been applied to that instance.

## Installation

1. Back up the running instance's `pb_data` and existing migration folder. Check its version using `./pocketbase --version`. This migration uses the v0.23+ fields/collection API; review compatibility with the installed version before applying it.
2. Copy `pb_migrations/1793709000_fuloos.js` into the instance's `pb_migrations` directory, preserving existing files. It creates only `fuloos_users`, `fuloos_accounts`, `fuloos_categories` and `fuloos_transactions`; it intentionally refuses collection-name collisions rather than editing an existing application.
3. Run `./pocketbase migrate up` using the instance's existing data and migrations paths, then restart PocketBase. Alternatively, the standard server applies pending migrations on startup. Use the existing container/service's normal deployment process, rather than starting a second instance over the same database.
4. Keep HTTPS enabled. If the server restricts allowed origins, allow the exact Vercel production origin and localhost development origin. Do not put administrator tokens into Vercel frontend variables.
5. Set `VITE_POCKETBASE_URL=https://pb.danishali.dev` as a **build** environment variable, then rebuild/redeploy the frontend. Without it, Fuloos remains an explicitly labeled in-memory demo.
6. Verify signup/signin, then create two test users and confirm that neither user can read or reference the other's accounts/categories/transactions. Test opening-date changes, category deletion restrictions, and credit-card repayments before real financial data.

The migration allows ordinary email/password signup and immediate signin. Email verification is not required initially; if you later require verification, configure SMTP and update the auth UI/collection auth rule together. Password reset and verification-email UI are future additions.

## Data guarantees

API rules scope every ledger record to its owner and prevent reassigning ownership. SQLite triggers validate relation ownership, integer fils, transfer structure, valid dates, and opening-date consistency in the same write. Transfers are one atomic record; they do not need a two-request balance update. Account balances are derived, not independently mutated. Categories have no income/expense type and may be reused for either.

The migration includes a down migration that **deletes Fuloos collections and their records**. Do not run `migrate down` on real data as a routine fix. Restore a verified backup for a production rollback.

Keep regular off-device backups and update PocketBase through its supported version upgrade path. A self-hosted PocketBase instance does not depend on Supabase inactivity policies, but availability still depends on your server, persistent volume, backups and monitoring.

References checked: [Migrations](https://pocketbase.io/docs/js-migrations/), [collection operations](https://pocketbase.io/docs/js-collections/) and [record API](https://pocketbase.io/docs/api-records/).
