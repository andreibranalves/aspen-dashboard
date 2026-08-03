# AGENTS.md — `api/_lib`

## OVERVIEW
Shared middleware, request/response adapters, and domain constants used by `api/[...path].js` and the handlers in `api/_functions/`.

## STRUCTURE

```
api/_lib/
├── auth.js            # Session auth + route-name extraction
├── password.js        # Versioned scrypt password parsing and verification
├── session.js         # Versioned HMAC-signed session tokens and cookies
├── function-adapter.js # Express/Vercel req/res ⇄ legacy Lambda event
├── rate-limit.js      # In-memory per-route rate limiter
└── media-schema.js    # Constants & factories for WhatsApp media/flows
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Add a public route | `auth.js` → `PUBLIC_ROUTES` / `AUTH_ROUTES` |
| Change session validation | `auth.js` → `isAuthenticated`; `session.js` → token helpers |
| Change password hashing | `password.js` → fixed `scrypt:v1` format |
| Fix query/body shape before handler | `function-adapter.js` |
| Add or change rate limits | `rate-limit.js` → `ROUTE_LIMITS` |
| Add a WhatsApp flow step type | `media-schema.js` → `STEP_TYPES` + `createStep` |
| Add a product group for media | `media-schema.js` → `PRODUCT_GROUPS` + `GROUP_LABELS` |
| Change KV key prefix for comms | `media-schema.js` → `KV_PREFIX` |

## CONVENTIONS

- Keep this directory free of endpoint handlers and ERPNext calls.
- Export small named helpers; avoid classes or mutable shared state beyond the rate-limit `Map`.
- `getRouteName()` must stay consistent between `auth.js` and `rate-limit.js`; both use `req.query.path` first, then `/api/:segment`.
- `function-adapter.js` owns all `+` → space decoding for Vercel dev query strings.

## ANTI-PATTERNS / NOTES

- Do NOT use `checkRateLimit` for hard guarantees; bucket `Map` resets on every cold start.
- Do NOT add business logic or DB/KV writes here; only constants, parsing, and adapters.
- Do NOT change `media-schema.js` field names lightly; `communication-media.js`, `communication-flows.js`, and `send-whatsapp-flow.js` depend on them.
- `APP_PASSWORD_HASH` must be exactly `scrypt:v1:<salt-base64url>:<derived-key-base64url>`; plaintext passwords are never stored or compared.
- Generate it with `node scripts/hash-app-password.mjs`; the terminal prompt does not echo the password and stdout contains only the hash.
- `APP_SESSION_SECRET` is independent from the password hash and must contain at least 32 UTF-8 bytes. Missing or malformed auth configuration fails closed.
- `aspen_token` is a versioned HMAC-SHA256 session cookie, not a password-bearing cookie. It expires after 30 days and is verified with a timing-safe comparison.
- `APP_AUTH_BYPASS=true` is an explicit development-only bypass. It is ignored whenever `NODE_ENV` or `VERCEL_ENV` indicates production.
- There is no header-based authentication fallback.
