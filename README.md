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

The web app builds to `dist/` for Vercel. Your persistent PocketBase instance at `https://pb.danishali.dev` provides authentication and data storage. See [PocketBase setup](pocketbase/README.md) for the namespaced migration and verification steps. The health endpoint is reachable; the migration has **not** been applied because server/admin access was not provided. Do not enable real-data use until the migration and two-user isolation checks are complete.

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

Open Transactions → Import CSV. Choose an existing AED account and file (UTF-8, up to 5 MB / 10,000 rows), set delimiter, header/leading rows, date format and decimal separator, then map date, amount (or debit/credit), payee, notes and existing category names. Negative signed amounts are expenses; positive amounts are income, with an optional sign flip.

Review parsed transactions and exclude individual rows before confirming. Invalid rows cannot be imported. Exact account/date/type/amount/normalized-payee matches are marked as possible duplicates and excluded by default; users can include them deliberately. Transfers are not inferred. Files are parsed locally; only selected transactions are sent to PocketBase. Saves are sequential, not atomic: if a request fails, confirmed successful rows are excluded from retry. If a network timeout has an uncertain result, close and reopen the importer to reload the ledger before retrying.
