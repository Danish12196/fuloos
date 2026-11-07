# Fuloos

A UAE-focused personal finance tracker. Phase 1 & 2 deliver a responsive React + TypeScript web app with PocketBase authentication, user-owned accounts and neutral categories, manual transactions, CSV statement imports, recurring schedules & subscriptions, intelligent pattern detection, automatic payment matching, financial forecasting, and monthly category budgets.

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
- `pocketbase/pb_migrations/1793968200_recurring_automation.js` — quarterly frequency, match provenance on occurrences, and automation preferences (`fuloos_recurring_prefs`).
- `pocketbase/pb_migrations/1794141000_budgets.js` — monthly per-category budgets (`fuloos_budgets`).

Set `VITE_POCKETBASE_URL` as a build environment variable after backend setup. No superuser key or service credential belongs in browser code. User sessions are stored in localStorage, refreshed on app startup and removed on signout; restrict frontend script sources and avoid untrusted scripts. Signing out clears the current browser session; PocketBase tokens remain valid until expiry or server-side invalidation.

## Included

- Sign up, sign in, session restoration and sign out.
- Account CRUD: current, savings, credit card, cash and other; AED-only.
- Signed opening balances with an as-of date; balances are derived from transactions.
- Neutral category CRUD with description and color; one category can be used for income or expenses.
- Transaction CRUD; month navigation, text search, account and type filters.
- Recurring schedules & subscriptions CRUD with pause/resume, fixed or variable AED amounts, daily/weekly/monthly/quarterly/yearly frequencies, month-end and leap-year clamping, chronological and monthly calendar views, and manual payment confirmation (record new or link existing transaction).
- Intelligent Recurring Automation:
  - **Automatic Detection**: Deterministic analysis and statistical cadence fitting discovering recurring patterns from transaction history and CSV imports without external paid AI APIs.
  - **UAE Merchant Normalization**: Strips POS/terminal codes and noise prefixes, handles store numbers and trailing location codes, and maps canonical aliases (e&/Etisalat, du, DEWA, Salik, Netflix, Spinneys, Carrefour, LuLu).
  - **Automatic Transaction Matching**: Multi-signal bipartite reconciliation matching transactions to scheduled occurrences by payee similarity, dates, integer fils amounts, accounts, and categories. Auto-links safe high-confidence matches (score >= 0.88), routes ambiguous or tied matches to a review queue, and enforces a sticky dismissal key on unlinking to prevent re-matching loops.
  - **Intelligent Forecasting & Insights**: Observed historical median payment day jitter, recency-weighted variable bill estimates, 30/60/90-day cash flow horizons, and per-account projected balances without mutating recorded ledger balances.
- Dedicated Recurring Workspace Tabs: **Schedules**, **Suggestions**, **Upcoming**, **History**, and **Insights**, plus an **Automation Preferences** bar.
- Overview with total net balance, monthly income/expenses, category spending, recent activity, suggestion banners, 30-day upcoming recurring forecast, and monthly recurring vs recorded actuals breakdown without double-counting linked payments.
- A transfer is one atomic row affecting both accounts; edits/deletion affect both sides together. Credit card payments are transfers. Opening balances and transfers are excluded from income/expenses.
- Integer fils throughout; no floating-point monetary arithmetic.
- PocketBase API ownership rules plus SQLite integrity triggers for cross-user references, transfers, recurring occurrence uniqueness, dates, deletion restrictions, and automation preferences.

New users start with an empty workspace. Create accounts and categories before adding transactions or recurring schedules. Deleting a used category requires reassignment first; deleting an account with transactions or recurring schedules requires moving/removing them first. Deleting a recurring schedule removes its schedule and confirmation links while preserving past recorded ledger transactions and balances. Editing an opening balance intentionally changes the derived current balance.

## Recurring transactions, subscriptions & automation

Open **Recurring** from the workspace navigation to manage regular bills, subscriptions and recurring income across 5 dedicated tabs:

- **Schedules**: Manage active and paused recurring schedules (`expense` and `income` in integer fils AED) with `daily`, `weekly`, `monthly`, `quarterly`, or `yearly` frequencies, start date, optional end date, account, optional category, notes, and fixed/variable amounts.
- **Suggestions**: Review high-confidence detected patterns discovered from historical and CSV-imported transactions (Accept, Edit as draft, or Dismiss permanently). Review ambiguous match candidates with similarity breakdowns and confirm or dismiss them with one click.
- **Upcoming**: Chronological and monthly calendar forecast view of upcoming payments over the next 30, 60, and 90 days with predicted dates (accounting for observed historical day jitter) and variable bill range estimates.
- **History**: Audit past confirmed occurrences with match provenance badges (`AUTO` vs `MANUAL`), match explanations, change-link options, and unlink controls.
- **Insights**: Multi-horizon cash flow projections (30, 60, 90 days), projected account balances, and monthly fixed vs variable commitments.
- **Balances stay separate until paid**: Upcoming, overdue and paused schedules are forecasts only and never alter account balances or recorded ledger totals. Marking an occurrence paid either creates a real ledger transaction or links an existing unlinked transaction of matching type, and prevents duplicate confirmation of the same occurrence or linking one transaction twice.

## Budgets

Open **Budgets** to set a monthly limit (integer fils, AED) per category. A budget starts in a month and either repeats every month or ends in a chosen month; one category cannot have two budgets covering the same month. The page shows spending against each limit for the selected month (green under 80%, amber from 80%, red when over), categories with spending but no budget, and every past, current and upcoming budget for editing or deletion. **Reports** adds a *Budget vs actual* panel for the chosen range: each month's budget is added up across the range, and only expenses from months a category has a budget count against it. Income and transfers never use up a budget. Deleting a category deletes its budgets. Demo mode includes sample budgets.

## SMS import and category suggestions

Open Transactions → Import SMS. Paste bank SMS alerts (one per paragraph) or upload an SMS Backup & Restore XML file, choose the account, and review before importing. The parser covers the Liv, Mashreq, ADCB, FAB and ADIB templates. OTPs, declined payments, moves inside the same bank and card repayments are skipped. Foreign-currency purchases are converted at the parser's fixed reference rate and the original amount is kept in the notes. Rows already in the ledger, or the same SMS pasted twice, are flagged as possible duplicates.

Expenses get a category suggestion from a confidence cascade ported from the [Ledger project](https://github.com/Danish12196/ledger-uae-banks) (MAAI902): public brand and keyword rules first, then a calibrated TF-IDF + logistic regression model. Below 60% confidence the row is marked "Check category". The model predicts 12 standard groups; the dialog's "Match suggestions to your categories" panel maps each group to one of your own categories (guessed from category names, saved in this browser).

Privacy:

- SMS text is parsed in the browser and never uploaded or stored. Only confirmed transactions are saved.
- `src/ledger/rules.generated.ts` is produced by `scripts/ledger/import-rules.ts`, which copies only the generic tables (bank templates, public brands, keywords) and drops the Ledger project's merchant overrides because those came from contributors' own SMS.
- No model file is committed. `scripts/ledger/hash-model.ts` converts the Ledger export into a hashed model: every character and word n-gram is replaced by a 24-bit FNV-1a bucket, so the file holds numbers only, and the converter fails if any vocabulary string survives. The app refuses plain exports and verifies a self-check built from public brand names. Hashing removes readable text but is not anonymisation on its own: someone can still test whether a guessed merchant name hashes to a bucket in the file, so the minimum-contributors rule in the Ledger export still matters.

To enable the model, convert and host it, then set `VITE_LEDGER_MODEL_URL` for the build:

```sh
node --experimental-strip-types scripts/ledger/hash-model.ts path/to/ledger_web_model.json ledger-model-v1.json 1
# upload ledger-model-v1.json to the model host (it must allow cross-origin GET), then:
# VITE_LEDGER_MODEL_URL=https://<host>/ledger-model-v1.json
```

Without the variable, SMS import works with the rules alone.

## Checks

```sh
npm test
npm run build
```

Tests cover exact money calculations, transfers, neutral-category usage, recurring schedule generation, cadence fitting and pattern detection, multi-signal transaction matching, intelligent forecasting, PocketBase HTTP adapter behavior, and the migrations' SQLite integrity triggers. The schema test runs the actual migration trigger SQL against embedded SQLite and inspects collection rule definitions; it does not substitute for live PocketBase API isolation tests. Live signup/signin and server migration verification remain pending server access.

## Scope

Android SMS capture, PDF imports, automated payment execution, push notifications, savings goals and cloud LLM APIs are deferred. The ledger is shared-client-ready; one currency (AED) is maintained to prevent implicit FX conversions.

Design references: [Ivy Wallet](https://github.com/Ivy-Apps/ivy-wallet), [Actual accounts](https://actualbudget.org/docs/accounts/) and [Actual transfers](https://actualbudget.org/docs/transactions/transfers/). This is an original interface and implementation; no reference application's code or artwork is copied.

## CSV importing

Open Transactions → Import CSV. Choose an existing AED account and file (UTF-8, up to 5 MB / 10,000 rows), set delimiter, header/leading rows, date format and decimal separator, then map date, amount (or debit/credit), payee, notes and category names. Negative signed amounts are expenses; positive amounts are income, with an optional sign flip.

Parsing settings and column mappings can be saved as named presets for repeat bank exports, selected, renamed, replaced or deleted. When an uploaded CSV's header row matches a saved preset, Fuloos suggests it without importing automatically; applying a preset keeps the selected destination account, resolves header-based mappings by column name rather than position, and highlights any missing columns before review. When signed in, presets are saved to your account (PocketBase `fuloos_csv_presets`) and follow you across browsers and devices; presets saved in a browser by earlier versions are moved to your account the first time you open the import dialog. Demo mode, and servers that have not installed the preset migration yet, keep presets in the browser.

Review parsed transactions and exclude individual rows before confirming. Invalid rows cannot be imported. Exact account/date/type/amount/normalized-payee matches are marked as possible duplicates and excluded by default; users can include them deliberately. Mark transfer rows explicitly and select the other account; signed amounts determine direction. Missing categories can be created during review with optional description, emoji and color. Filter the preview to invalid fields, duplicates or selected rows. Zero amounts are accepted after the backend upgrade. Files are parsed locally; only selected transactions are sent to PocketBase. Bulk category creation and transaction imports use the authenticated PocketBase batch API, up to 100 records per request. Each batch is atomic; the whole file is not one transaction. A rejected batch saves none of its records, while earlier committed batches are retained and excluded from retry. The ledger refreshes once after each bulk operation. If a network timeout has an uncertain result, close and reopen the importer to reload the ledger before retrying.

### Enable bulk imports

In PocketBase Settings → Application, enable Batch requests and allow at least 100 requests per batch. Keep processing-time and body-size limits bounded (for example 3 seconds and 1 MB), then save. The existing per-user collection rules still apply to every operation in the batch. The importer reports a configuration error if batching is disabled; it does not fall back to individual writes.
