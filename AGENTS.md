# AGENTS.md - Aspen Orçamento

**Stack:** React 19 + Vite 6 frontend; Node.js ESM Vercel serverless API; PostgreSQL via Drizzle; Evolution API for WhatsApp; OpenRouter for extraction.

## STRUCTURE

```
./
├── src/              # React SPA (built into public/)
├── api/              # Vercel API catch-all + handlers
│   ├── [...path].js  # single dispatch router
│   ├── _lib/         # auth, rate-limit, function-adapter
│   └── _functions/   # handlers + shared libraries
├── scripts/          # dev servers + local test harnesses
├── public/           # Vite build output + static assets
└── docs/             # product and operational documentation
```

## WHERE TO LOOK

| Task | Location |
| --- | --- |
| Add API endpoint | `api/_functions/*.ts` + `api/[...path].ts` |
| Add frontend page | `src/pages/*.tsx` + `src/App.tsx` |
| Shared UI component | `src/components/ui/*.tsx` |
| Database schema | `api/_db/schema.ts` |
| PostgreSQL repository | `api/_db/*.ts` |
| PDF generation | `api/_functions/pdf.ts` + `api/_functions/lib/quotation-pdf.ts` |
| Tests | `tests/unit/*.test.*`, `tests/*.spec.js` |

## CONVENTIONS

- **ESM only** - `.js` imports require explicit extension in backend source.
- **Vite builds into `public/`** with `emptyOutDir: false`.
- **Hash-based routing** uses `useHashRoute` and manual dispatch in `App.tsx`.
- **Backend handlers** receive Lambda-shaped events and return `{ statusCode, body }`.
- **Local API development** uses `scripts/dev-api-server.mjs` on port 8888.
- **Errors** returned to users are written in Brazilian Portuguese.
- **PostgreSQL** is the source of truth for products, clients, quotations, CRM, orders and activity.
- **Evolution API** is the only WhatsApp transport.

## ANTI-PATTERNS

- Do not add provider fallbacks or rollout branches.
- Do not expose database errors, stack traces, secrets or personal data in HTTP responses.
- Do not modify historical files under `drizzle/`.
- Do not edit generated Vite output under `public/` during source changes.
- Do not add dependencies without explicit approval.
- Do not commit `.env`, credentials or production data.

## COMMANDS

```bash
npm run build:api
npm run test:unit
npm run lint
npm run build
node scripts/check-no-legacy-provider.mjs
```

## NOTES

- `ROUTES` maps are duplicated across `api/[...path].ts`, `scripts/dev-api-server.mjs` and `scripts/app-server.mjs`.
- Keep all three route maps synchronized when adding or removing endpoints.
- Authentication and rate limiting run at the deployed API boundary.
- Local development servers intentionally omit deployed authentication middleware.
