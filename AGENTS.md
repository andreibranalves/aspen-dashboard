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
netlify dev
```

Runs at `http://localhost:8888`. Functions are served at `/.netlify/functions/*` and proxied via `/api/*` (defined in `netlify.toml`).

## Testing

```bash
node test_local.mjs
```

Runs both functions end-to-end against real ERPNext. Edit the `text` array at the top of the file to test different inputs. Requires a valid `OPENROUTER_API_KEY` in `.env`.

## Environment Variables

| Variable | Where set | Purpose |
|---|---|---|
| `ERPNEXT_TOKEN` | `.env` (local) + Netlify dashboard (prod) | ERPNext API auth |
| `OPENROUTER_API_KEY` | `.env` (local) + Netlify dashboard (prod) | OpenRouter API auth |
| `OPENROUTER_MODEL` | `.env` (local) + Netlify dashboard (prod) | Optional model override for extraction |
| `APP_PASSWORD` | Netlify project settings | UI access password |
| `SMTP_PASSWORD` | `.env` (local) + Netlify dashboard (prod) | Hostinger SMTP — `orcamento@aspenestamparia.com` |

## Architecture

Single-page app (`public/index.html`) + four Netlify Functions:

| Function | Route | Purpose |
|----------|-------|---------|
| `extract.js` | `POST /api/extract` | Sends text/image to OpenRouter; returns structured orders |
| `orcamento.js` | `POST /api/orcamento` | Creates ERPNext Quotation + CRM Deal |
| `send-email.js` | `POST /api/send-email` | Sends email via Hostinger SMTP with PDF attachment |
| `view.js` | `GET /api/view?q={id}` | Renders quotation HTML for browser/print preview |

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
- Ecobags → ECO-30 + ECO-35 + ECO-50
- Explicit SKUs always take precedence (Rule 0)

### Frontend (public/index.html)
Single file — all CSS, HTML, and JS inline. Key functions:
- `setImage` / `clearImage` — handles paste and drag-drop image input
- `renderWaTemplate(template, nome, numeroPedido)` — resolves `(nome)`, `(primeiro_nome)`, `(numero_pedido)`, `(empresa)` tags
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

## Deploy

```bash
netlify deploy --prod
```

Validate locally with `netlify dev` before deploying. Do not deploy after every small change.
