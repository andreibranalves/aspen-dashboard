# `api/_functions` — Serverless Handlers & Shared Libs

Internal handlers dispatched by `api/[...path].js`; shared libs have no default export.

## Structure

```
api/_functions/
├── *.js                         ← handlers (default export: async function handler(event))
├── lib/                         ← shared libraries
│   ├── erpnext.js               # ERPNext client + createHttpError helper
│   ├── quotation-html.js        # HTML assembly for quotation view
│   ├── quotation-pdf.js         # PDF generation (Puppeteer + Chromium)
│   ├── print-format.js          # Print format resolution
│   ├── quote-pipeline.js        # Quotation + CRM Deal creation pipeline
│   ├── quote-response.js        # Response shape normalization
│   ├── deal-resolution.js       # CRM Deal resolution
│   ├── customer-resolution.js   # Customer / Contact resolution
│   ├── client-metadata.js       # CNPJ, lead source, address validation
│   └── time-greeting.js         # Time-aware Portuguese greeting
├── pricing.js                   # Pricing rules / brackets (shared lib, no handler export)
└── view.js                      # Only GET handler returning text/html
```

## Where to Look

| Task | File |
|---|---|
| AI extraction (text/image → order) | `extract.js` |
| Main quotation + CRM Deal pipeline | `orcamento.js` |
| Edit draft quotation via AI | `edit-draft.js` |
| Render public quotation HTML | `view.js` |
| Generate PDF | `pdf.js` / `lib/quotation-pdf.js` |
| Send WhatsApp message | `send-whatsapp.js` |
| Execute WhatsApp/communication flow | `send-whatsapp-flow.js` |
| Manage communication flows | `communication-flows.js` |
| Manage media assets (KV + Blob) | `communication-media.js` |
| Upload media to Blob | `communication-media-upload.js` |
| Send-event history | `communication-send-events.js` |
| Preview rendered flow message | `communication-flow-preview.js` |
| WhatsApp lead ingestion | `whatsapp-leads.js` / `typebot-lead-capture.js` |
| Lead/Customer CRUD | `leads-clients.js` / `client-detail.js` |
| CRM Deal operations | `crm-deals.js` / `crm-update-deal.js` |
| Product catalog & pricing | `products.js` / `product-detail.js` / `product-pricing.js` |
| Product core rollout | `products-core.js` / `product-detail-core.js` / `product-update-core.js` (PostgreSQL) and `*-legacy.js` (Frappe) |
| Product updates | `product-update.js` / `product-pricing-update.js` / `product-activity.js` |
| Direct price lookup | `pricing-lookup.js` / `pricing.js` |
| Quotation CRUD / duplicate | `quotations.js` / `duplicate-quotation.js` |
| Sales orders / dashboard | `sales-orders.js` / `sales-order-from-quotation.js` / `sales-dashboard.js` |
| Default quotation settings | `settings.js` |
| Auth cookie handlers | `login.js` / `logout.js` |

## Conventions

- Handlers receive a Vercel/Express-shaped `event` and return `{ statusCode, headers?, body }`.
- Add every new handler to `api/[...path].js` `ROUTES` map; kebab-case keys match URL path segments.
- Shared libs live in `lib/`; `pricing.js` is a shared lib at the top level and must not be added to `ROUTES`.
- `view.js` is the only handler that returns `text/html`; all others return JSON.
- Communication flows/media use Vercel KV (`aspen:communication:*` namespace) and Vercel Blob.
- Shared schemas live in `api/_lib/media-schema.js`, not inside `_functions`.
- Products use PostgreSQL only when `CRM_CORE_PRODUCTS_ENABLED === 'true'`; otherwise
  the boundary delegates to the preserved Frappe handlers. Unified clients use
  PostgreSQL when `CRM_CORE_CLIENTS_ENABLED === 'true'`; the in-memory repository
  is a test seam only. Core failures never fall back to Frappe, and core responses
  expose `core_mode`/`source` metadata.

## Anti-Patterns / Notes

- Do not register `pricing.js` as a route.
- Do not return raw ERPNext errors or stack traces in HTTP responses.
- Do not use `require()` / CommonJS; keep imports ESM with explicit `.js` extensions.
- When adding a new route, mirror the registration in `scripts/dev-api-server.mjs` and `scripts/app-server.mjs` as well.
