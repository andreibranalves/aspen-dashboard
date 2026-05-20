# AGENTS.md

Instructions for code agents working in the Orcamento App subproject. This application orchestrates quotation creation via ERPNext and Frappe CRM.

## Quotation PDF Generation (PDF De Orcamento)
- Do not use the ERPNext `download_pdf` API for final PDFs; `wkhtmltopdf` renders differently.
- Use Chrome or Edge headless with `--headless=new`, not legacy mode.
- **Expected Browser path:** `/usr/bin/google-chrome` (or `/usr/bin/microsoft-edge-stable`)
- **Recommended subprocess timeout:** 60 seconds
- **Default output path:** `C:\Users\Andrei\Downloads\Aspen\Orcamentos\{quotation_name} - {cliente}.pdf`

## Dev Server

```bash
vercel dev
```
Runs Vercel Dev locally. The app and API routes are served from the Vercel project configuration in `vercel.json`; API endpoints are exposed at `/api/*`.

Alternative npm command: `npm run dev:vercel`. Frontend-only command: `npm run dev`.

## Testing

```bash
node test_local.mjs
```

Runs both functions end-to-end against real ERPNext. Edit the `text` array at the top of the file to test different inputs. Requires a valid `OPENROUTER_API_KEY` in `.env`.

## Environment Variables

| Variable | Where set | Purpose |
|---|---|---|
| `ERPNEXT_TOKEN` | `.env` (local) + Vercel project env (prod) | ERPNext API auth |
| `OPENROUTER_API_KEY` | `.env` (local) + Vercel project env (prod) | OpenRouter API auth |
| `OPENROUTER_MODEL` | `.env` (local) + Vercel project env (prod) | Optional model override for extraction |
| `APP_PASSWORD` | Vercel project env | UI access password |
| `SMTP_PASSWORD` | `.env` (local) + Vercel project env (prod) | Hostinger SMTP — `orcamento@aspenestamparia.com` |

## Architecture

Single-page app (`src` built by Vite into `public`) + Vercel API entrypoint:

| Function | Route | Purpose |
|----------|-------|---------|
| `api/[...path].js` | `/api/*` | Vercel catch-all API route — dispatches to internal handlers |
| `api/_functions/extract.js` | `POST /api/extract` | AI extraction: text/image → structured orders via OpenRouter |
| `api/_functions/orcamento.js` | `POST /api/orcamento` | Creates ERPNext Quotation + CRM Deal (two-phase pipeline) |
| `api/_functions/edit-draft.js` | `POST /api/edit-draft` | Natural-language editing of draft quotations via OpenRouter |
| `api/_functions/view.js` | `GET /api/view?q={id}` | Renders quotation HTML for browser/print preview |
| `api/_functions/pricing.js` | _(shared lib)_ | Pricing bracket/rate logic — imported by `orcamento.js`, no handler export |
| `api/_functions/freight.js` | `POST /api/freight` | Freight calculation lookup |
| `api/_functions/send-whatsapp.js` | `POST /api/send-whatsapp` | Sends WhatsApp message via Evolution API |
| `api/_functions/leads-clients.js` | `POST /api/leads-clients` | Lead/client management |
| `api/_functions/crm-deals.js` | `POST /api/crm-deals` | CRM deal operations |
| `api/_functions/crm-update-deal.js` | `POST /api/crm-update-deal` | Update CRM deal fields |
| `api/_functions/products.js` | `POST /api/products` | Product listing/search |
| `api/_functions/product-detail.js` | `POST /api/product-detail` | Single product detail |
| `api/_functions/product-pricing.js` | `POST /api/product-pricing` | Product pricing data |
| `api/_functions/product-pricing-update.js` | `POST /api/product-pricing-update` | Update product pricing |
| `api/_functions/pricing-lookup.js` | `POST /api/pricing-lookup` | Direct pricing lookup |
| `api/_functions/quotations.js` | `POST /api/quotations` | Quotation listing/search |
| `api/_functions/sales-orders.js` | `POST /api/sales-orders` | Sales order operations |
| `api/_functions/sales-order-from-quotation.js` | `POST /api/sales-order-from-quotation` | Create Sales Order from Quotation |
| `api/_functions/sales-dashboard.js` | `POST /api/sales-dashboard` | Sales dashboard data |
| `api/_lib/function-adapter.js` | _(adapter)_ | Wraps handlers for Vercel req/res compatibility |

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
- Chapéus → always quote CHP-PAN + CHP-PNR + CHP-BAM
- Cangas < 100 → CNG-SAL-70 + CNG-SAL-100; ≥ 100 → adds CNG-VIS-70 + CNG-VIS-100
- Toalhas → TWL-210 + TWL-280
- Bonés < 100 → BNE-TAC-VNL; ≥ 100 → BNE-TAC-SUB + BNE-BRI + BNE-PRE
- Cachecóis → always quote CHC-SOF-140 + CHC-SOF-180 + CHC-LAA-COU + CHC-LAA-BOR (four options)
- Ecobags → ECO-30 + ECO-35 + ECO-50
- Explicit SKUs always take precedence (Rule 0)

### Frontend (public/index.html)
Single file — all CSS, HTML, and JS inline. Key functions:
- `setImage` / `clearImage` — handles paste and drag-drop image input
- `renderWaTemplate(template, nome, numeroPedido)` — resolves `(Saudacao)` (Bom dia/Boa tarde/Boa noite by hour), `(nome)`, `(primeiro_nome)`, `(numero_pedido)`, `(empresa)`, `(link_orcamento)` tags
- `buildWhatsApp(telefone, nome, quotationId)` — builds wa.me link with pre-filled message
- `capitalize(str)` / `fmtPhone(phone)` — display sanitizers (proper case, `(99) 99999-9999`)
- `createCard / setCardProcessing / setCardDone / setCardError` — per-order result UI; `setCardDone` shows colored dot (green = new customer, red = returning) and "Cliente novo/antigo" label
- Form submit handler (line ~910): orchestrates the two-phase fetch pipeline

Settings tab persists custom extraction rules and WhatsApp template to `localStorage`.

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
