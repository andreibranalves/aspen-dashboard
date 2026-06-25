# AGENTS.md — Aspen Orçamento /scripts

## OVERVIEW

Local dev/test harnesses and the production combined app server (VPS). All files are standalone Node ESM executables.

## STRUCTURE
```
scripts/
├── dev-api-server.mjs          # API-only dev server (port 8888)
├── app-server.mjs              # Combined static + API server for VPS
├── vite-dev.mjs                # Vite dev wrapper (port 5173 / Vercel dev)
├── load-env.mjs                # Minimal .env loader for dev-api-server
├── migrate-tokens.mjs          # One-off token migration helper
├── playwright-test-*.mjs       # Manual Playwright E2E harnesses
├── test-*.mjs                  # Node assertion tests against src/lib modules
└── test_client-metadata.mjs    # ERPNext client metadata sanity check
```

## WHERE TO LOOK

| Task | File |
|---|---|
| Run API locally without Vercel CLI | `node scripts/dev-api-server.mjs` |
| Serve built frontend + API on VPS | `PORT=8888 node scripts/app-server.mjs` |
| Run Vite dev server | `npm run dev` → `scripts/vite-dev.mjs` |
| Load `.env` before handler imports | `scripts/load-env.mjs` |
| Manual E2E smoke test for a page | `playwright-test-product-detail.mjs`, `playwright-test-react.mjs`, etc. |
| Unit-test `src/lib/whatsappFlows.js` | `node scripts/test-whatsapp-flows.mjs` |
| One-off token migration | `node scripts/migrate-tokens.mjs` |

## CONVENTIONS

- **Standalone scripts use `.mjs`.** Shared modules under `src/` are `.js`.
- **`dev-api-server.mjs` imports `load-env.mjs` first**, then statically imports every `api/_functions/*.js` handler and maps them in `ROUTES`.
- **`app-server.mjs` uses `dotenv/config`** (not `load-env.mjs`) and additionally serves static files from `public/` with SPA fallback.
- **Route maps are duplicated** across `api/[...path].js`, `scripts/dev-api-server.mjs`, and `scripts/app-server.mjs`. Keep them in sync.
- **Dev servers construct a synthetic Lambda `event`** (`httpMethod`, `body`, `queryStringParameters`, `headers`) and call handlers directly. Auth and rate-limit are skipped locally.
- **Manual Playwright harnesses read `BASE_URL`** (`http://localhost:3000` by default), mock API routes via `page.route()`, and use custom `check`/`assert` helpers instead of `@playwright/test`.
- **Module tests import source files dynamically** with a cache-busting query string (e.g. `../src/lib/whatsappFlows.js?t=${Date.now()}`).

## ANTI-PATTERNS / NOTES

- Do NOT add a new `api/_functions/*.js` route only in the dev/app servers; update the production `ROUTES` in `api/[...path].js` too.
- Do NOT call `load-env.mjs` from `app-server.mjs`; production/VPS expects `dotenv/config`.
- Do NOT rely on dev servers for auth/rate-limit behavior; both are bypassed.
- `app-server.mjs` requires `ERPNEXT_TOKEN` and exits early if missing.
- `public/index.html` must exist before starting `app-server.mjs`; build first (`vite build`).
