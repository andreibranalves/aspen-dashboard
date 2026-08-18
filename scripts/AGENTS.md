# `scripts` - local development and test utilities

Scripts are standalone Node ESM executables.

## Structure

```
scripts/
├── check-no-legacy-provider.mjs
├── app-server.mjs
├── vite-dev.mjs
├── load-env.mjs
└── test-*.mjs
```

## Conventions

- Keep executable scripts in `.mjs` files.
- Load local environment values before importing API handlers.
- Keep the route map in `api/_app/routes.ts` synchronized with `app-server.mjs` and the Vercel catch-all.
- Manual browser harnesses use `BASE_URL` and local mocks.
- Never print credentials, tokens, connection strings or personal data.
- Do not run scripts against deployed or production systems from local tests.
