# Inventário de rotas e dependências de orçamento

Auditoria dos handlers em `api/_functions/` e dos três mapas de rota em 2026-08-05.

A autenticação descrita como `sessão` é aplicada pelo catch-all Vercel e pelo servidor combinado.
O servidor `dev-api-server.mjs` é um harness local sem autenticação por desenho.
Rotas sem flag própria permanecem no caminho legado quando há guard de `CRM_OPERATIONAL_MODE`.
Nas linhas com `CRM_CORE_QUOTES_ENABLED`, o código atual avalia primeiro `CRM_OPERATIONAL_MODE=true`, que habilita o caminho core antes da flag específica; Task 3 deve remover esse override e deixar a flag de orçamento isolada.
Nenhuma linha abaixo representa uma flag, migração, documento ou outbox implementado nesta tarefa.

## Paridade dos mapas

`tests/unit/route-map.test.ts` lê os três mapas reais, compara conjuntos ordenados independentemente da ordem de inserção e exige 40 nomes.
A lista inclui as rotas de orçamento, visualização, PDF, WhatsApp e Sales Order.

## Inventário

| route | methods | auth | source of truth | Frappe calls | PostgreSQL tables | external side effects | flag | migration status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `extract` | POST | sessão | OpenRouter extraction; sem registro de orçamento | none | none | OpenRouter API | none | legacy dependency |
| `orcamento` | POST | sessão | PostgreSQL draft when core is selected; Frappe quotation otherwise | legacy: `Quotation`, `Customer`/`Lead`, `CRM Deal`, `Item` and pricing reads/writes through ERPNext | core: `clients`, `products`, `product_pricing_tiers`, `quotations`, `quote_revisions`, `quote_revision_items` | legacy: N8N webhook and Frappe quotation/CRM writes; core: PostgreSQL write | current: `CRM_OPERATIONAL_MODE=true` overrides and enables core before `CRM_CORE_QUOTES_ENABLED`; Task 3 removes override | partial; core draft path exists, legacy pipeline remains |
| `products` | GET, POST, DELETE | sessão | PostgreSQL when products core is selected; Frappe otherwise | legacy: `Item` and pricing-related ERPNext reads/writes | core: `products`, `product_pricing_tiers` | PostgreSQL or Frappe catalog mutation | `CRM_CORE_PRODUCTS_ENABLED`; quote GET also selects core with `CRM_CORE_QUOTES_ENABLED` | partial; quote dependency has a separate rollout |
| `product-detail` | GET | sessão | PostgreSQL when products core is selected; Frappe otherwise | legacy: `Item`, pricing and stock metadata reads | core: `products`, `product_pricing_tiers` | none | `CRM_CORE_PRODUCTS_ENABLED` | partial |
| `product-pricing` | GET, POST, PUT | sessão | PostgreSQL pricing when products core is selected; Frappe Pricing Rule/Item Price otherwise | legacy: `Pricing Rule`, `Item Price`, `Item` reads and pricing writes | core: `products`, `product_pricing_tiers` | PostgreSQL or Frappe pricing mutation | `CRM_CORE_PRODUCTS_ENABLED` | partial |
| `product-pricing-update` | PUT | sessão | PostgreSQL complete pricing-set writer when products core is selected; Frappe Pricing Rule otherwise | legacy: `Pricing Rule` list, create and update calls | core: `products`, `product_pricing_tiers` | PostgreSQL or Frappe pricing mutation | `CRM_CORE_PRODUCTS_ENABLED`; `CRM_OPERATIONAL_MODE` also blocks legacy path | partial |
| `product-update` | PATCH, PUT | sessão | PostgreSQL product/catalog record when products core is selected; Frappe Item otherwise | legacy: `Item` reads and updates | core: `products`, `product_pricing_tiers` | PostgreSQL or Frappe product/pricing mutation | `CRM_CORE_PRODUCTS_ENABLED` | partial |
| `product-activity` | GET | sessão | Frappe audit/activity history | `Quotation`, `Version` for `Pricing Rule` and `Item` | none | none | `CRM_OPERATIONAL_MODE` guard | legacy; replacement tests required |
| `pricing-lookup` | POST | sessão | PostgreSQL pricing when products core is selected; Frappe pricing otherwise | legacy: `Item` names and pricing reads | core: `products`, `product_pricing_tiers` | none | `CRM_CORE_PRODUCTS_ENABLED` | partial; core lookup still resolves only catalog data |
| `client-detail` | GET, PATCH, PUT | sessão | PostgreSQL when clients core is selected; Frappe otherwise | legacy customer/lead detail and update calls | core: `clients` | PostgreSQL or Frappe client mutation | `CRM_CORE_CLIENTS_ENABLED` | partial |
| `leads-clients` | GET, POST, DELETE | sessão | PostgreSQL when clients core is selected; Frappe otherwise | legacy Customer/Lead list, create and delete calls | core: `clients` | PostgreSQL or Frappe client mutation | `CRM_CORE_CLIENTS_ENABLED`; quote GET may select core | partial |
| `quote-leads` | GET, POST, PATCH | sessão; POST ingest also requires `QUOTE_LEADS_INGEST_TOKEN` | Vercel KV quote-lead collection | none | none | Vercel KV writes | `CRM_OPERATIONAL_MODE` guard | legacy dependency |
| `quotations` | GET, PUT, DELETE | sessão | PostgreSQL quotation aggregate when quote core is selected; Frappe otherwise | legacy: `Quotation`, `Lead`, `Sales Order Item`, `Sales Order`; cancel uses `frappe.client.cancel` | core: `clients`, `products`, `product_pricing_tiers`, `quotations`, `quote_revisions`, `quote_revision_items`, `quotation_templates`, `quotation_template_versions` | legacy quotation update, cancellation and deletion in Frappe | current: `CRM_OPERATIONAL_MODE=true` overrides and enables core before `CRM_CORE_QUOTES_ENABLED`; Task 3 removes override | partial; core read/update/lifecycle path exists, legacy remains |
| `quotation-preview` | GET | sessão | PostgreSQL quotation revision snapshot and versioned template | none in core path | `quotations`, `quote_revisions`, `quote_revision_items`, `quotation_templates`, `quotation_template_versions`, `products` | optional browser PDF rendering; no remote write | current: `CRM_OPERATIONAL_MODE=true` overrides and enables core before `CRM_CORE_QUOTES_ENABLED`; Task 3 removes override | partial; PostgreSQL preview exists, replacement coverage pending |
| `quotation-templates` | GET, POST, PUT; POST `/validate` | sessão | PostgreSQL template library | none | `quotation_templates`, `quotation_template_versions`, `app_settings`, `quote_revisions` | PostgreSQL template/version/archive writes | current: `CRM_OPERATIONAL_MODE=true` overrides and enables core before `CRM_CORE_QUOTES_ENABLED`; Task 3 removes override | partial; PostgreSQL library exists, migration/seeding is separate |
| `view` | GET | public route classification; administrative callers still use the route directly | Frappe quotation HTML and print-format data | quotation and Lead reads through `quotation-html`/print-format helpers | none | browser-facing HTML response | none | legacy; replacement tests required |
| `pdf` | GET | sessão in Vercel catch-all; public route classification does not apply | Frappe quotation data rendered by Chromium/Puppeteer | quotation, Lead and related reads through quotation HTML helpers | none | Chromium/Puppeteer PDF generation | none | legacy; replacement tests required |
| `send-whatsapp` | POST | sessão | Frappe quotation/contact context plus Evolution transport | `Quotation`, party doctype, `Contact`, `CRM Deal`; media may be downloaded from ERPNext | none | Evolution API text/media sends; Frappe CRM update; conversation-store persistence | `CRM_OPERATIONAL_MODE` guard | legacy; replacement tests required |
| `send-whatsapp-flow` | POST | sessão | Frappe quotation/contact context, Vercel KV flow/event data and Evolution transport | `Quotation`, `CRM Deal`; CRM updates use ERPNext | none | Evolution API sends; Vercel KV flow/send-event writes; optional N8N webhook; Frappe CRM update | `CRM_OPERATIONAL_MODE` guard | legacy; replacement tests required |
| `communication-flow-preview` | POST | sessão | Vercel KV flow/media definitions plus Frappe quotation context when `quotation_id` is provided | `Quotation` read | none | Vercel KV flow/media reads; renders links and document-step metadata | `CRM_OPERATIONAL_MODE` guard | legacy dependency; replacement tests required |
| `communication-send-events` | GET | sessão | Vercel KV send-event records | none | none | Vercel KV event reads | `CRM_OPERATIONAL_MODE` guard | legacy dependency; replacement tests required |
| `sales-order-from-quotation` | POST | sessão | Frappe quotation and Sales Order | `Quotation`, `Sales Order Item`, `Sales Order`, `CRM Deal`; `make_sales_order`, submit and set-value methods | none | Frappe Sales Order create/submit and CRM Deal update | `CRM_OPERATIONAL_MODE` guard | legacy; replacement tests required |
| `sales-orders` | GET | sessão | Frappe Sales Order | `Sales Order`, `Sales Order Item` | none | none | `CRM_OPERATIONAL_MODE` guard | legacy; replacement tests required |
| `sales-dashboard` | GET | sessão | Frappe Sales Order and Quotation reporting | `Sales Order`, `Sales Order Item`, `Quotation` | none | none | `CRM_OPERATIONAL_MODE` guard | legacy; replacement tests required |
| `duplicate-quotation` | POST | sessão | Frappe quotation copy | `Quotation` reads and create | none | Frappe quotation create | `CRM_OPERATIONAL_MODE` guard | legacy dependency |
| `edit-draft` | POST | sessão | OpenRouter-generated draft; no persisted quotation by this handler | none | none | OpenRouter API call | `CRM_OPERATIONAL_MODE` guard | legacy dependency |

## Dependency conclusions

The minimum PostgreSQL quotation aggregate is not only `quotations`.
It requires client identity, active products and pricing, revision/item snapshots, and template/version rows before a draft or preview can be accepted.

`view`, `pdf`, both WhatsApp routes, and all Sales Order routes remain explicitly legacy until replacement tests cover their data source and side effects.
The route parity test does not imply behavioral parity or migration readiness.

No outbox is listed as an existing dependency.
External effects remain direct handler effects until a later task introduces an outbox contract.
