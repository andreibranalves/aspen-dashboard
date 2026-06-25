# AGENTS.md — `api/_lib`

## OVERVIEW
Shared middleware, request/response adapters, and domain constants used by `api/[...path].js` and the handlers in `api/_functions/`.

## STRUCTURE

```
api/_lib/
├── auth.js            # Password-based auth + route-name extraction
├── function-adapter.js # Express/Vercel req/res ⇄ legacy Lambda event
├── rate-limit.js      # In-memory per-route rate limiter
└── media-schema.js    # Constants & factories for WhatsApp media/flows
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Add a public route | `auth.js` → `PUBLIC_ROUTES` / `AUTH_ROUTES` |
| Change auth token source | `auth.js` → `isAuthenticated` |
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
- `APP_PASSWORD` absence means dev mode (all requests allowed); production must set it.
- `x-aspen-key` header is a fallback for scripts/integrations; prefer `aspen_token` httpOnly cookie for browser sessions.
