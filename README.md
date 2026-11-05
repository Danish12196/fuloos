# Fuloos

A UAE-focused personal finance tracker. Phase 1 is a responsive React + TypeScript web app with PocketBase email/password authentication, user-owned accounts and neutral categories, and manual income, expenses and transfers.

## Local development

Requires Node.js 24.

```sh
npm ci
cp .env.example .env
npm run dev
```

Without `VITE_POCKETBASE_URL`, an explicitly labeled in-memory demo is available. Demo changes are discarded on exit/refresh and never write financial records to the database.

## Backend and deployment

The web app builds to `dist/` for Vercel. Your persistent PocketBase instance at `https://pb.danishali.dev` provides authentication and data storage. See [PocketBase setup](pocketbase/README.md) for the namespaced migration and verification steps. The foundation migration is installed and password login has been verified. The CSV/appearance upgrade in `pocketbase/pb_migrations/1793795400_import_appearance.js` must also be applied on the existing server for zero amounts and emoji persistence.

Set `VITE_POCKETBASE_URL` as a build environment variable after backend setup. No superuser key or service credential belongs in browser code. User sessions are stored in localStorage, refreshed on app startup and removed on signout; restrict frontend script sources and avoid untrusted scripts. Signing out clears the current browser session; PocketBase tokens remain valid until expiry or server-side invalidation.

## Included

- Sign up, sign in, session restoration and sign out.
- Account CRUD: current, savings, credit card, cash and other; AED-only in Phase 1.
- Signed opening balances with an as-of date; balances are derived from transactions.
- Neutral category CRUD with description and color; one category can be used for income or expenses.
- Transaction CRUD; month navigation, text search, account and type filters.
- Overview with total net balance, monthly income/expenses, category spending and recent activity.
- A transfer is one atomic row affecting both accounts; edits/deletion affect both sides together. Credit card payments are transfers. Opening balances and transfers are excluded from income/expenses.
- Integer fils throughout; no floating-point monetary arithmetic.
- PocketBase API ownership rules plus SQLite integrity triggers for cross-user references, transfers, dates and deletion restrictions.

New users start with an empty workspace. Create accounts and categories before adding transactions. Deleting a used category requires reassignment first; deleting an account with transactions requires moving/removing them first. Editing an opening balance intentionally changes the derived current balance.

## Checks

```sh
npm test
npm run build
```

Tests cover exact money calculations, transfers, neutral-category usage, PocketBase HTTP adapter behavior and the migration's SQLite integrity triggers. The schema test runs the actual migration trigger SQL against embedded SQLite and inspects collection rule definitions; it does not substitute for live PocketBase API isolation tests. Live signup/signin and server migration verification remain pending server access.

## Scope

Android, SMS capture, PDF imports, ML, budgets and LLM features are deferred. The ledger is shared-client-ready; Phase 1 keeps one currency (AED) to prevent implicit FX conversions.

Design references: [Ivy Wallet](https://github.com/Ivy-Apps/ivy-wallet), [Actual accounts](https://actualbudget.org/docs/accounts/) and [Actual transfers](https://actualbudget.org/docs/transactions/transfers/). This is an original interface and implementation; no reference application's code or artwork is copied.

## CSV importing

Open Transactions → Import CSV. Choose an existing AED account and file (UTF-8, up to 5 MB / 10,000 rows), set delimiter, header/leading rows, date format and decimal separator, then map date, amount (or debit/credit), payee, notes and category names. Negative signed amounts are expenses; positive amounts are income, with an optional sign flip.

Parsing settings and column mappings can be saved as named presets for repeat bank exports, selected, renamed, replaced or deleted. When an uploaded CSV's header row matches a saved preset, Fuloos suggests it without importing automatically; applying a preset keeps the selected destination account, resolves header-based mappings by column name rather than position, and highlights any missing columns before review. Presets are stored locally per browser in `localStorage`—not per user—and do not sync across browsers or devices.

Review parsed transactions and exclude individual rows before confirming. Invalid rows cannot be imported. Exact account/date/type/amount/normalized-payee matches are marked as possible duplicates and excluded by default; users can include them deliberately. Mark transfer rows explicitly and select the other account; signed amounts determine direction. Missing categories can be created during review with optional description, emoji and color. Filter the preview to invalid fields, duplicates or selected rows. Zero amounts are accepted after the backend upgrade. Files are parsed locally; only selected transactions are sent to PocketBase. Bulk category creation and transaction imports use the authenticated PocketBase batch API, up to 100 records per request. Each batch is atomic; the whole file is not one transaction. A rejected batch saves none of its records, while earlier committed batches are retained and excluded from retry. The ledger refreshes once after each bulk operation. If a network timeout has an uncertain result, close and reopen the importer to reload the ledger before retrying.


### Enable bulk imports

In PocketBase Settings → Application, enable Batch requests and allow at least 100 requests per batch. Keep processing-time and body-size limits bounded (for example 3 seconds and 1 MB), then save. The existing per-user collection rules still apply to every operation in the batch. The importer reports a configuration error if batching is disabled; it does not fall back to individual writes.
