# Fuloos

A UAE-focused personal finance tracker. Phase 1 is a responsive React + TypeScript web app with PocketBase email/password authentication, user-owned accounts and neutral categories, manual income, expenses and transfers, and recurring schedule & subscription tracking.

## Local development

Requires Node.js 24.

```sh
npm ci
cp .env.example .env
npm run dev
```

Without `VITE_POCKETBASE_URL`, an explicitly labeled in-memory demo is available. Demo changes are discarded on exit/refresh and never write financial records to the database.

## Backend and deployment

The web app builds to `dist/` for Vercel. Your persistent PocketBase instance at `https://pb.danishali.dev` provides authentication and data storage. See [PocketBase setup](pocketbase/README.md) for the namespaced migrations and verification steps:

- `pocketbase/pb_migrations/1793709000_fuloos.js` — core users, accounts, categories and transactions collections.
- `pocketbase/pb_migrations/1793795400_import_appearance.js` — zero-amount support and emoji persistence.
- `pocketbase/pb_migrations/1793881800_recurring.js` — recurring schedules (`fuloos_recurring`) and confirmed occurrence links (`fuloos_recurring_occurrences`).

Set `VITE_POCKETBASE_URL` as a build environment variable after backend setup. No superuser key or service credential belongs in browser code. User sessions are stored in localStorage, refreshed on app startup and removed on signout; restrict frontend script sources and avoid untrusted scripts. Signing out clears the current browser session; PocketBase tokens remain valid until expiry or server-side invalidation.

## Included

- Sign up, sign in, session restoration and sign out.
- Account CRUD: current, savings, credit card, cash and other; AED-only in Phase 1.
- Signed opening balances with an as-of date; balances are derived from transactions.
- Neutral category CRUD with description and color; one category can be used for income or expenses.
- Transaction CRUD; month navigation, text search, account and type filters.
- Recurring schedules & subscriptions CRUD with pause/resume, fixed or variable AED amounts, daily/weekly/monthly/yearly frequencies, month-end and leap-year clamping, chronological and monthly calendar views, and manual payment confirmation (record new or link existing transaction).
- Overview with total net balance, monthly income/expenses, category spending, recent activity, 30-day upcoming recurring forecast, and monthly recurring vs recorded actuals breakdown without double-counting linked payments.
- A transfer is one atomic row affecting both accounts; edits/deletion affect both sides together. Credit card payments are transfers. Opening balances and transfers are excluded from income/expenses.
- Integer fils throughout; no floating-point monetary arithmetic.
- PocketBase API ownership rules plus SQLite integrity triggers for cross-user references, transfers, recurring occurrence uniqueness, dates and deletion restrictions.

New users start with an empty workspace. Create accounts and categories before adding transactions or recurring schedules. Deleting a used category requires reassignment first; deleting an account with transactions or recurring schedules requires moving/removing them first. Deleting a recurring schedule removes its schedule and confirmation links while preserving past recorded ledger transactions and balances. Editing an opening balance intentionally changes the derived current balance.

## Recurring transactions & subscriptions

Open **Recurring** from the workspace navigation to manage regular bills, subscriptions and recurring income:

- **Schedules**: Supports `expense` and `income` schedules in integer fils (AED) with `daily`, `weekly`, `monthly` or `yearly` frequencies, start date, optional end date, account, optional category, notes, and `active` or `paused` status.
- **Fixed vs variable amounts**: Fixed schedules prefill the expected AED amount on confirmation; variable schedules (such as DEWA utilities) require entering the actual amount paid or received when confirming.
- **Calendar & timezone handling**: Today's boundary is evaluated in `Asia/Dubai` (`UTC+4`). Monthly and yearly schedules anchor to the `start_date` day-of-month and clamp cleanly to shorter months and non-leap years (`2026-01-31` → `2026-02-28` → `2026-03-31`, `2024-02-29` → `2025-02-28` → `2028-02-29`).
- **Balances stay separate until paid**: Upcoming, overdue and paused schedules are forecasts only and never alter account balances or recorded income/expense totals. Marking an occurrence paid either creates a real ledger transaction or links an existing unlinked transaction of matching type, and prevents duplicate confirmation of the same occurrence or linking one transaction twice.

## Checks

```sh
npm test
npm run build
```

Tests cover exact money calculations, transfers, neutral-category usage, recurring schedule generation and confirmation rules, PocketBase HTTP adapter behavior and the migrations' SQLite integrity triggers. The schema test runs the actual migration trigger SQL against embedded SQLite and inspects collection rule definitions; it does not substitute for live PocketBase API isolation tests. Live signup/signin and server migration verification remain pending server access.

## Scope

Android, SMS capture, PDF imports, ML, automatic bank matching, automated payment execution, push notifications, budgets and LLM features are deferred. The ledger is shared-client-ready; Phase 1 keeps one currency (AED) to prevent implicit FX conversions.

Design references: [Ivy Wallet](https://github.com/Ivy-Apps/ivy-wallet), [Actual accounts](https://actualbudget.org/docs/accounts/) and [Actual transfers](https://actualbudget.org/docs/transactions/transfers/). This is an original interface and implementation; no reference application's code or artwork is copied.

## CSV importing

Open Transactions → Import CSV. Choose an existing AED account and file (UTF-8, up to 5 MB / 10,000 rows), set delimiter, header/leading rows, date format and decimal separator, then map date, amount (or debit/credit), payee, notes and category names. Negative signed amounts are expenses; positive amounts are income, with an optional sign flip.

Parsing settings and column mappings can be saved as named presets for repeat bank exports, selected, renamed, replaced or deleted. When an uploaded CSV's header row matches a saved preset, Fuloos suggests it without importing automatically; applying a preset keeps the selected destination account, resolves header-based mappings by column name rather than position, and highlights any missing columns before review. Presets are stored locally per browser in `localStorage`—not per user—and do not sync across browsers or devices.

Review parsed transactions and exclude individual rows before confirming. Invalid rows cannot be imported. Exact account/date/type/amount/normalized-payee matches are marked as possible duplicates and excluded by default; users can include them deliberately. Mark transfer rows explicitly and select the other account; signed amounts determine direction. Missing categories can be created during review with optional description, emoji and color. Filter the preview to invalid fields, duplicates or selected rows. Zero amounts are accepted after the backend upgrade. Files are parsed locally; only selected transactions are sent to PocketBase. Bulk category creation and transaction imports use the authenticated PocketBase batch API, up to 100 records per request. Each batch is atomic; the whole file is not one transaction. A rejected batch saves none of its records, while earlier committed batches are retained and excluded from retry. The ledger refreshes once after each bulk operation. If a network timeout has an uncertain result, close and reopen the importer to reload the ledger before retrying.


### Enable bulk imports

In PocketBase Settings → Application, enable Batch requests and allow at least 100 requests per batch. Keep processing-time and body-size limits bounded (for example 3 seconds and 1 MB), then save. The existing per-user collection rules still apply to every operation in the batch. The importer reports a configuration error if batching is disabled; it does not fall back to individual writes.
