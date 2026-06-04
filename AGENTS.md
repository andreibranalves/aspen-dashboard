# AGENTS.md

Instructions for code agents working in the Orcamento App subproject. This application orchestrates quotation creation via ERPNext and Frappe CRM.

## Quotation PDF Generation (PDF De Orcamento)
- Do not use the ERPNext `download_pdf` API for final PDFs; `wkhtmltopdf` renders differently.
- Use Chrome or Edge headless with `--headless=new`, not legacy mode.
- **Vercel/serverless**: Uses `@sparticuz/chromium` + `puppeteer-core` (lightweight Chromium for serverless).
- **Recommended subprocess timeout:** 60 seconds
- **PDF endpoint:** `POST /api/pdf` — generates on-the-fly, returns PDF binary.

## Dev Server

```bash
vercel dev
```
Runs Vercel Dev locally. The app and API routes are served from the Vercel project configuration in `vercel.json`; API endpoints are exposed at `/api/*`.

Alternative npm command: `npm run dev:vercel`. Frontend-only command: `npm run dev`.

## Testing

```bash
node test_local.mjs           # ERPNext integration test (extract + orcamento pipeline)
npm run test:unit             # Node --test runner (tests/unit/*.test.js)
npm run test:e2e              # Playwright E2E (tests/orcamento.spec.js + playwright.config.js)
npm run test:whatsapp         # WhatsApp send handler test
npm run test:whatsapp-flows   # WhatsApp flows unit test
npm run test:erp              # alias → node test_local.mjs
npm run lint                  # ESLint (flat config, scoped by environment)
npm run lint:fix              # ESLint auto-fix
npm run format                # Prettier
npm run format:check          # Prettier --check
npm run check                 # lint + build
```

Runs both functions end-to-end against real ERPNext. Edit the `text` array at the top of `test_local.mjs` to test different inputs. Requires a valid `OPENROUTER_API_KEY` in `.env`.

Unit tests use Node.js built-in `node:test` + `node:assert/strict` (no Jest/Vitest dependency). E2E tests use Playwright with Chromium only. No CI pipeline configured — all tests run manually.

## Environment Variables

| Variable | Where set | Purpose |
|---|---|---|
| `ERPNEXT_TOKEN` | `.env` (local) + Vercel project env (prod) | ERPNext API auth |
| `OPENROUTER_API_KEY` | `.env` (local) + Vercel project env (prod) | OpenRouter API auth |
| `OPENROUTER_MODEL` | `.env` (local) + Vercel project env (prod) | Optional model override for extraction |
| `APP_PASSWORD` | Vercel project env | UI access password (login cookie auth) |
| `SMTP_PASSWORD` | `.env` (local) + Vercel project env (prod) | Hostinger SMTP — `orcamento@aspenestamparia.com` |
| `EVOLUTION_BASE_URL` | `.env` (local) + Vercel project env (prod) | Evolution API base URL (WhatsApp) |
| `EVOLUTION_API_KEY` | `.env` (local) + Vercel project env (prod) | Evolution API auth |
| `EVOLUTION_INSTANCE` | `.env` (local) + Vercel project env (prod) | Evolution API instance name |
| `N8N_WEBHOOK_URL` | Vercel project env | n8n webhook for post-quotation drip automation |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel-injected (prod) | Vercel KV — WhatsApp flows persistence |

## Architecture

Single-page app (`src` built by Vite into `public`) + Vercel API entrypoint. The catch-all router `api/[...path].js` has auth (`api/_lib/auth.js`) and rate-limiting (`api/_lib/rate-limit.js`) guards before dispatching to handlers.

| Function | Route | Purpose |
|----------|-------|---------|
| `api/[...path].js` | `/api/*` | Vercel catch-all API route — auth + rate-limit + dispatch |
| `api/_functions/extract.js` | `POST /api/extract` | AI extraction: text/image → structured orders via OpenRouter |
| `api/_functions/orcamento.js` | `POST /api/orcamento` | Creates ERPNext Quotation + CRM Deal (two-phase pipeline) |
| `api/_functions/edit-draft.js` | `POST /api/edit-draft` | Natural-language editing of draft quotations via OpenRouter |
| `api/_functions/view.js` | `GET /api/view?q={id}` | Renders quotation HTML for browser/print preview (public, no auth) |
| `api/_functions/pricing.js` | _(shared lib)_ | Pricing bracket/rate logic — imported by `orcamento.js`, no handler export |
| `api/_functions/freight.js` | `POST /api/freight` | Freight calculation lookup |
| `api/_functions/send-whatsapp.js` | `POST /api/send-whatsapp` | Sends WhatsApp message via Evolution API |
| `api/_functions/whatsapp-flows.js` | `GET/PUT /api/whatsapp-flows` | WhatsApp flow templates — persisted in Vercel KV |
| `api/_functions/whatsapp-leads.js` | `POST /api/whatsapp-leads` | WhatsApp lead processing |
| `api/_functions/leads-clients.js` | `POST /api/leads-clients` | Lead/client management |
| `api/_functions/client-detail.js` | `GET/PUT /api/client-detail` | Single Lead/Customer CRUD |
| `api/_functions/crm-deals.js` | `POST /api/crm-deals` | CRM deal operations |
| `api/_functions/crm-update-deal.js` | `POST /api/crm-update-deal` | Update CRM deal fields |
| `api/_functions/products.js` | `POST /api/products` | Product listing/search |
| `api/_functions/product-detail.js` | `POST /api/product-detail` | Single product detail |
| `api/_functions/product-pricing.js` | `POST /api/product-pricing` | Product pricing data |
| `api/_functions/product-pricing-update.js` | `POST /api/product-pricing-update` | Update product pricing |
| `api/_functions/product-update.js` | `POST /api/product-update` | Update product fields |
| `api/_functions/product-activity.js` | `POST /api/product-activity` | Product activity tracking |
| `api/_functions/pricing-lookup.js` | `POST /api/pricing-lookup` | Direct pricing lookup |
| `api/_functions/quotations.js` | `POST /api/quotations` | Quotation listing/search (GET/PUT/DELETE) |
| `api/_functions/duplicate-quotation.js` | `POST /api/duplicate-quotation` | Duplicate an existing quotation |
| `api/_functions/sales-orders.js` | `POST /api/sales-orders` | Sales order operations |
| `api/_functions/sales-order-from-quotation.js` | `POST /api/sales-order-from-quotation` | Create Sales Order from Quotation |
| `api/_functions/sales-dashboard.js` | `POST /api/sales-dashboard` | Sales dashboard data |
| `api/_functions/pdf.js` | `POST /api/pdf` | PDF generation (Puppeteer + Chromium headless) |
| `api/_functions/login.js` | `POST /api/login` | Authentication — sets `aspen_token` cookie (30-day expiry) |
| `api/_functions/logout.js` | `POST /api/logout` | Clears auth cookie |
| `api/_lib/function-adapter.js` | _(adapter)_ | Wraps handlers for Vercel req/res compatibility |
| `api/_lib/auth.js` | _(middleware)_ | Cookie/header-based auth guard |
| `api/_lib/rate-limit.js` | _(middleware)_ | Vercel KV-backed rate limiter |

### Two-phase pipeline

```
User input (text or image paste/drop)
  │
  ├─ POST /api/extract → extract.js
  │    └─ OpenRouter chat completion: returns array of orders [{nome, email, telefone, urgente, items}]
  │
  └─ POST /api/orcamento (one per order) → orcamento.js
       ├─ Resolves pricing (Pricing Rule → Item Price fallback)
       ├─ Upsert Customer (dedup by email → Contact link → Customer; uses `like` to handle ERPNext's auto-appended " - 1" suffixes)
       ├─ Upsert Contact (dedup by email_id)
       ├─ Upsert CRM Deal (dedup by email → lead_name)
       ├─ Create Quotation
       ├─ Update CRM Deal: status="Orcamento Enviado", custom_quotation, custom_quotation_sent_date, custom_follow_up_stage=0
       └─ Returns: quotation_id, deal_id, customer_id, customer_new (bool), print_html, pdf_url
```

### Pricing resolution order (orcamento.js `getRate`)
1. Tiered rule: `Pricing Rule` where `title = "{SKU}-{bracket}"` (e.g. `LNC-SED-70-100`)
2. SKU rule: `Pricing Rule` where `title = "{SKU}"`
3. Fallback: `Item Price` in Standard Selling price list

Quantity brackets: 30, 100, 300, 500, 1000. Urgent orders: +30% on all rates.

### Extract rules (extract.js system prompt)
- Lenços → always quote LNC-SED-70 + LNC-CSD-70
- Echarpes → always quote ECH-SED + ECH-CSD
- Chapéus → always quote CHP-PAN + CHP-PNR + CHP-BAM
- Cangas < 100 → CNG-SAL-70 + CNG-SAL-100; ≥ 100 → adds CNG-VIS-70 + CNG-VIS-100
- Toalhas → TWL-210 + TWL-280
- Bonés < 100 → BNE-TAC-VNL; ≥ 100 → BNE-TAC-SUB + BNE-BRI + BNE-PRE
- Cachecóis → always quote CHC-SOF-140 + CHC-SOF-180 + CHC-LAA-COU + CHC-LAA-BOR (four options)
- Ecobags → ECO-30 + ECO-35 + ECO-50
- Explicit SKUs always take precedence (Rule 0)

### Frontend (public/index.html → React SPA in src/)
The production UI is a React 19 SPA (built by Vite into `public/`). The old single-file `public/index.html` is the build output entry.

Key pages (15 total, hash-based routing via `useHashRoute`, no React Router):
| Hash route | Page component |
|---|---|
| `#/dashboard` | DashboardPage |
| `#/quotations` | QuotationsPage (default) |
| `#/quotations/:id` | QuotationDetailPage |
| `#/auto` | AutoQuotePage — two-phase extraction + quotation |
| `#/manual` | ManualOrcamentoPage |
| `#/sales-orders` | SalesOrdersPage |
| `#/sales-orders/:id` | SalesOrderDetailPage |
| `#/freight` | FreightPage |
| `#/products` | ProductsPage |
| `#/products/:sku` | ProductDetailPage |
| `#/crm` | CrmKanbanPage |
| `#/leads` | LeadsPage |
| `#/leads/:tipo/:id` | LeadDetailPage |
| `#/settings` | SettingsPage |
| `#/login` | LoginPage (full-screen, no layout) |

UI: Framer design system (dark/light), shadcn-style components (CVA + cn), Lucide icons. Dark mode via `.dark` on `<html>` + localStorage.

State: 90% local `useState` + API fetch. WhatsApp flows use **Vercel KV** as primary storage with localStorage fallback. Extraction drafts use localStorage (`aspen_drafts`). Theme uses localStorage (`aspen_theme`).

### Quotation naming series
Format: `ORC-YYYY####` (e.g. `ORC-20261143`). Configured in ERPNext at `/app/naming-series` with prefix `ORC-.YYYY.####`. To reset the counter, set prefix `ORC-2026` to the desired starting value at `/app/naming-series`.

### ERPNext CRM Deal custom fields
- `custom_quotation` — linked Quotation name
- `custom_quotation_sent_date` — ISO date when quotation was created
- `custom_follow_up_stage` — integer 0–4 tracking which follow-up email was last sent

## Conventions

### Module System
- **ESM everywhere** (`package.json` has `"type": "module"`)
- Local imports use explicit `.js` extension: `import { getRate } from './pricing.js'`
- `test_local.mjs` uses `.mjs` extension for standalone scripts; function files use `.js`

### Handler Skeleton (internal API functions)
```js
export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }
  try {
    // ... core logic ...
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[function]', err?.logMessage || err?.message || err);
    return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err?.message || 'Erro interno.' }) };
  }
}
```
Exception: `view.js` is a GET handler — skips method guard, returns `text/html`.

### Error Handling
- **Preferred**: `createHttpError(statusCode, publicMsg, logMsg)` pattern (see `extract.js`, `edit-draft.js`)
- Catch block reads `err?.statusCode` and `err?.logMessage || err?.message || err`
- All user-facing error messages in Brazilian Portuguese
- Never expose raw ERPNext error details to HTTP responses

### Logging
- `console.error('[functionName]', msg)` — tagged format (extract.js, edit-draft.js)
- `console.warn(...)` for non-fatal issues

### Naming
| Scope | Convention | Examples |
|-------|-----------|---------|
| Functions | camelCase | `extractWithOpenRouter`, `sanitizeName` |
| Constants | UPPER_SNAKE_CASE | `ERPNEXT_BASE`, `MAX_TEXT_LENGTH` |
| Files | kebab-case or short word | `edit-draft.js`, `view.js` |
| HTML IDs | kebab-case | `inputArea`, `customer-dot` |
| localStorage keys | snake_case, `aspen_` prefix | `aspen_rules`, `aspen_wa_template` |
| DOM element vars | `el` suffix | `queueEl`, `extractStatusEl` |

### Code Organization
- Helper functions before `handler` export
- Section dividers: `// ── Section Name ──`
- One `handler` export per function file (pricing.js is the exception — exports named utilities)

## Anti-Patterns

- **Do not use ERPNext `download_pdf` API** for final PDFs — `wkhtmltopdf` renders differently. Use Chrome/Edge headless with `--headless=new`.
- **Do not use legacy `--headless` mode** — always `--headless=new`.
- **Do not deploy after every small change** — validate with `vercel dev` first.
- **Do not use `require()`** — ESM only.
- **Do not skip `.js` extension** on local imports — ESM requires it.
- **Do not suppress errors silently** — always log + return structured error response.
- **Do not expose internal ERPNext error messages** to HTTP responses.
- **Do not modify `pricing.js`** without testing against all SKU × bracket combinations.
- **Do not add dependencies** to `package.json` without explicit approval.
- **Do not commit `.env`** (gitignored; `.env.example` is the template).
- **Do not use `@ts-ignore`, `@ts-expect-error`, `as any`** — project is plain JS, type safety via convention.

## Deploy

```bash
vercel deploy --prod
```

Validate locally with `vercel dev` before deploying. Do not deploy after every small change.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
