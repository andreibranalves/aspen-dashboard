# `api/_lib` - middleware and shared request helpers

This directory contains authentication, rate limiting, request adapters, media constants and small domain-neutral helpers.

## Structure

```
api/_lib/
├── auth.ts
├── password.ts
├── session.ts
├── function-adapter.ts
├── rate-limit.ts
└── media-schema.ts
```

## Conventions

- Keep endpoint handlers and database writes outside this directory.
- Export small named helpers.
- `getRouteName()` must match the route names used by the catch-all and local servers.
- `function-adapter.ts` owns query-string decoding for local and deployed requests.
- Authentication configuration fails closed when required settings are missing.
- Session cookies contain signed identifiers, never passwords or secret values.

## Security

- Do not add header-based authentication fallbacks.
- Do not log cookies, authorization headers, connection strings or personal data.
- Keep rate limiting as a best-effort guard and enforce business limits at repositories.
