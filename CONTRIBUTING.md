# Contributing to Fuloos

Thank you for contributing to Fuloos!

## Prerequisites

- **Node.js 24+** (`npm ci` to install dependencies)
- **Playwright Chromium** (`npx playwright install chromium`) for browser E2E tests
- **unzip** on PATH for `npm run test:pb` (auto-downloads PocketBase into `.pocketbase/`)

## Development workflow

1. Start the dev server in demo mode (in-memory, no PocketBase needed):
   ```sh
   npm run dev
   ```
2. Or connect to a local PocketBase instance by setting `VITE_POCKETBASE_URL` in `.env` (see `.env.example`).
3. Keep AED amounts in integer **fils** (`1 AED = 100 fils`) and follow the existing validation rules in `src/domain.ts`.

## Checks before opening a PR

```sh
npx tsc -b
npm test
npm run build
npm run test:e2e
npm run test:pb
```

If you add or modify PocketBase migrations in `pocketbase/pb_migrations/`, make sure `npm run test:pb` passes from an empty database and preserves strict per-user isolation.
