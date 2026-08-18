# `api/_shared` - middleware and shared request helpers

This directory contains authentication, rate limiting, errors and small domain-neutral helpers.

## Structure

```text
api/_shared/
├── auth.ts
├── password.ts
├── session.ts
├── http-error.ts
└── rate-limit.ts
```

## Conventions

- Keep endpoint handlers and database writes outside this directory.
- Export small named helpers.
- HTTP contract types (`FunctionEvent`, `FunctionResult`) and the function adapter live in `api/_http/`.
- Authentication configuration fails closed when required settings are missing.
- Session cookies contain signed identifiers, never passwords or secret values.

## Security

- Do not add header-based authentication fallbacks.
- Do not log cookies, authorization headers, connection strings or personal data.
- Keep rate limiting as a best-effort guard and enforce business limits at repositories.
