# AGENTS.md - Aspen Orçamento

**Stack:** React 19 + Vite 6 frontend; Node.js ESM Vercel serverless API; PostgreSQL via Drizzle; Evolution API for WhatsApp; OpenRouter for extraction.

## STRUCTURE

```
./
├── src/              # React SPA (built into public/)
├── api/              # Vercel API catch-all + handlers
│   ├── [...path].ts  # single dispatch router
│   ├── _app/         # routes.ts + handle-request.ts (pipeline compartilhado)
│   ├── _http/        # adapters de transporte (vercel, node) + contrato HTTP
│   ├── _shared/      # auth, errors, rate-limit e helpers compartilhados
│   ├── modules/      # regras de negócio e handlers por domínio (flat)
│   └── infrastructure/
│       ├── db/       # schema.ts + repositórios PostgreSQL
│       └── integrations/  # Evolution, Meta CAPI e demais clientes externos
├── scripts/          # dev servers + local test harnesses
├── public/           # Vite build output + static assets
└── docs/             # product and operational documentation
```

## WHERE TO LOOK

| Task | Location |
| --- | --- |
| Add API endpoint | `api/modules/*` + `api/_app/routes.ts` |
| Add frontend page | `src/pages/*.tsx` + `src/App.tsx` |
| Shared UI component | `src/components/ui/*.tsx` |
| Business logic / handlers | `api/modules/*.ts` |
| Shared auth/errors/rate-limit | `api/_shared/` |
| HTTP pipeline e adapters | `api/_app/`, `api/_http/` |
| Database schema | `api/infrastructure/db/schema.ts` |
| PostgreSQL repository | `api/infrastructure/db/repositories/*.ts` |
| External integrations | `api/infrastructure/integrations/*/` |
| PDF generation | `api/modules/pdf.ts` + `api/modules/quotation-pdf.ts` |
| Tests | `tests/unit/*.test.*`, `tests/*.spec.js` |

## CONVENTIONS

- **ESM only** - `.js` imports require explicit extension in backend source.
- **Vite builds into `public/`** with `emptyOutDir: false`.
- **Hash-based routing** uses `useHashRoute` and manual dispatch in `App.tsx`.
- **Backend handlers** receive Lambda-shaped events and return `{ statusCode, body }`.
- **Local API development** uses `npm run dev` (`scripts/vite-dev.mjs`), which runs `scripts/app-server.mjs` on port 8888 behind the Vite `/api` proxy.
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

- `api/_app/routes.ts` is the single route map shared by the Vercel catch-all and `scripts/app-server.mjs`.
- Register new endpoints once in `api/_app/routes.ts`.
- Authentication and rate limiting run in the shared API pipeline at deployed and local Node boundaries.
- Local development may set `APP_AUTH_BYPASS=true` for development-only auth bypass; the bypass is unavailable in production.

## OPERATOR ENVIRONMENT

- Real cutover values stay outside the checkout at `$HOME/.config/aspen-dashboard/.env.local` or `.env`.
- Keep the config directory mode `0700` and files mode `0600`.
- Run `node scripts/cutover-env-status.mjs` before cutover work.
- The preflight reports names and `present`/`missing` status only; never print or commit values.
- Do not copy operator environment files into the repository.
