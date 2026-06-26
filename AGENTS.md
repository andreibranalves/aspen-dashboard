# AGENTS.md — Aspen Orçamento

**Stack:** React 19 + Vite 6 frontend; Node.js ESM Vercel serverless API. Integrates ERPNext / Frappe CRM.

## STRUCTURE

```
./
├── src/              # React SPA (built into public/)
├── api/              # Vercel API catch-all + handlers
│   ├── [...path].js  # single dispatch router
│   ├── _lib/         # auth, rate-limit, function-adapter
│   └── _functions/   # handlers + shared libs
├── scripts/          # dev servers + manual test harnesses
├── tests/            # node --test + Playwright
├── public/           # Vite build output + static assets
└── docs/             # PRDs
```

## WHERE TO LOOK

| Task                          | Location                                                        |
| ----------------------------- | --------------------------------------------------------------- |
| Add API endpoint              | `api/_functions/*.js` + `api/[...path].js`                      |
| Add frontend page             | `src/pages/*.tsx` + `src/App.tsx`                               |
| Shared UI component           | `src/components/ui/*.tsx`                                       |
| ERPNext client / error helper | `api/_functions/lib/erpnext.js`                                 |
| PDF generation                | `api/_functions/pdf.js` + `api/_functions/lib/quotation-pdf.js` |
| Dev server                    | `scripts/dev-api-server.mjs` / `scripts/app-server.mjs`         |
| Tests                         | `tests/unit/*.test.js`, `tests/*.spec.js`, `test_local.mjs`     |

## CONVENTIONS (DEVIATIONS FROM STANDARD)

- **ESM only** — `.js` imports require explicit extension; standalone scripts use `.mjs`.
- **Vite builds into `public/`** with `emptyOutDir: false`; `public/index.html` is generated output, root `index.html` is source.
- **Hash-based routing** — no React Router; `useHashRoute` + `App.tsx` manual dispatch.
- **Frontend TypeScript** — all `src/` source files are `.ts`/`.tsx`; imports use extensionless paths via `@/*` alias.
- **Single catch-all API route** — `api/[...path].js` dispatches to `api/_functions/*.js` via `ROUTES` map.
- **Handler shape is legacy Lambda** — `handler(event)` returns `{statusCode, body}`; `api/_lib/function-adapter.js` converts from/to Express/Vercel `req/res`.
- **Local dev bypasses Vercel CLI** — `scripts/dev-api-server.mjs` (port 8888) + `npm run dev` (port 5173); auth/rate-limit are NOT applied locally.
- **No global state library** — ~90% local `useState`; only `SetTopBarActionsCtx` context.
- **Brazilian Portuguese** for all user-facing API errors.

## ANTI-PATTERNS

- Do NOT use ERPNext `download_pdf`; use Puppeteer + `@sparticuz/chromium` with `--headless=new`.
- Do NOT use `require()` / CommonJS (Tailwind config is a tolerated exception).
- Do NOT omit `.js` on local ESM imports.
- Do NOT expose raw ERPNext errors/stack traces in HTTP responses.
- Do NOT suppress errors silently — log + structured response.
- Do NOT modify `api/_functions/pricing.js` without testing all SKU × bracket combinations.
- Do NOT add dependencies without explicit approval.
- Do NOT commit `.env`.

## UNIQUE STYLES

- **Framer design system** via Tailwind CSS variables (`page`, `surface`, `shell`, `fg`, `line`, `on-solid`) + shadcn-style components.
- **Two-phase pipeline**: `/api/extract` (OpenRouter) → `/api/orcamento` (ERPNext Quotation + CRM Deal).
- **Pricing resolution**: tiered `Pricing Rule` → SKU `Pricing Rule` → `Item Price` fallback; urgent +30%.
- **Product category extraction rules** are hard-coded in `api/_functions/extract.js` system prompt.
- **WhatsApp flows** stored in Vercel KV with localStorage fallback.

## COMMANDS

```bash
npm install
cp .env.example .env
node scripts/dev-api-server.mjs   # API on 8888
npm run dev                       # Vite on 5173
npm run test:unit
npm run test:e2e
node test_local.mjs               # ERPNext integration
npm run lint && npm run build
vercel deploy --prod
```

## NOTES

- `tailwind.config.js` mixes `export default` with `require('tailwindcss-animate')` — tolerated exception.
- `publicDir: 'static'` in Vite is configured but `static/` does not exist; assets live in `public/`.
- `ROUTES` maps are duplicated across `api/[...path].js`, `scripts/dev-api-server.mjs`, and `scripts/app-server.mjs` — keep in sync when adding endpoints.
- Auth (`api/_lib/auth.js`) and rate-limit (`api/_lib/rate-limit.js`) only run in Vercel production; local dev servers skip both.
