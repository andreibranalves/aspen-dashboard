# Tests

The repository uses Node's test runner for unit tests and Playwright for browser coverage.

## Structure

```
tests/
├── unit/                 # deterministic Node tests
├── support/              # shared local test helpers
└── *.spec.js             # Playwright scenarios
```

## Conventions

- Import backend source from `api/modules` or `api/infrastructure/db` directly.
- Use `node:assert/strict` and restore modified globals in `afterEach`.
- Mock HTTP requests and database repositories in unit tests.
- Playwright tests use hash routes and mock API responses with `page.route()`.
- Keep tests deterministic and independent of deployed services.
- Do not include credentials, connection strings, customer records or upstream URLs in fixtures.

## Commands

```bash
npm run build:api
npm run test:unit
npx playwright test
```
