# Fuloos

A UAE-focused personal finance tracker. Phase 1 is a responsive React + TypeScript web app with Supabase email/password authentication, user-owned accounts and categories, and manual income, expenses and transfers.

## Local development

Requires Node.js 24.

```sh
npm ci
cp .env.example .env
npm run dev
```

Without Supabase environment variables, an explicitly labeled in-memory demo is available. Demo changes are discarded on exit/refresh. Demo access is not authentication and never writes financial records to the database.

## Connect Supabase

1. Create a **dedicated** Supabase project; do not run the schema in another application's database.
2. Run `supabase/schema.sql` once using the SQL editor.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` (and deployment build environment). Only the publishable key belongs in browser code. Never use a service role/secret key.
4. Configure Supabase Auth Site URL and allowed redirect URLs for your deployment and localhost. Keep email confirmation enabled; after confirmation users sign in with their password.
5. Run `npm run build` and deploy `dist/` to your static hosting provider with SPA fallback to `index.html`.

## Included

- Sign up, confirmation-email notice, sign in, session restoration and sign out.
- Account CRUD: current, savings, credit card, cash and other; AED-only in Phase 1.
- Signed opening balances with an as-of date; balances are derived from transactions.
- Category CRUD with income/expense types, description and color.
- Transaction CRUD; month navigation, text search, account and type filters.
- Overview with total net balance, monthly income/expenses, category spending and recent activity.
- A transfer is one atomic row affecting both accounts; edits/deletion affect both sides together. Credit card payments are transfers. Opening balances and transfers are excluded from income/expenses.
- Integer fils throughout; no floating-point monetary arithmetic.
- Database RLS and composite ownership foreign keys prevent cross-user account/category references. Category types are enforced by a composite FK.
- Database validation of opening dates; referenced account/category deletion is blocked.

New users start with an empty workspace. Create accounts and categories before adding transactions. Deleting a used category requires reassignment first; deleting an account with transactions requires moving/removing them first. Editing an opening balance changes the derived current balance intentionally.

## Checks

```sh
npm test
npm run build
```

The unit suite covers exact money parsing, net-balance conservation, credit repayment, opening balances, transfer validation and category/date constraints. An embedded PostgreSQL test also exercises the actual schema, including two-user RLS isolation, cross-user references, category type constraints, deletion restrictions and opening dates. Before a real-data release, verify live signup/confirmation/login and two-user database isolation against the provisioned project; SQL has not been production-verified until these checks are run.

## Scope

Android, SMS capture, imports/PDFs, ML, budgets and LLM features are deferred. The Supabase ledger is shared-client-ready, while Phase 1 keeps one currency (AED) to prevent implicit FX conversions.

Design references: [Ivy Wallet](https://github.com/Ivy-Apps/ivy-wallet), [Actual accounts](https://actualbudget.org/docs/accounts/) and [Actual transfers](https://actualbudget.org/docs/transactions/transfers/). This is an original interface and implementation; no reference application's code or artwork is copied.
