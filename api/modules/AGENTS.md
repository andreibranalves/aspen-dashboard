# `api/modules` - domain business logic and HTTP handlers

Handlers are dispatched by `api/[...path].ts`; shared libraries have no default export.

## Structure

```text
api/modules/
└── *.ts                         # handlers, services and domain helpers (flat,
                                 # one file per domain: quotations, products,
                                 # crm, customers, sales-orders, whatsapp,
                                 # communication, system)
```

## Where to look

| Task | File |
| --- | --- |
| AI extraction | `extract.ts` |
| Quotation creation | `orcamento.ts` / `orcamento-core.ts` |
| Quotation preview and PDF | `quotation-preview.ts` / `pdf.ts` |
| WhatsApp send | `send-whatsapp.ts` / `send-whatsapp-flow.ts` |
| Communication flows | `communication-flows.ts` / `communication-media.ts` |
| Lead ingestion | `quote-leads.ts` / `typebot-lead-capture.ts` |
| Client CRUD | `leads-clients.ts` / `client-detail.ts` |
| CRM operations | `crm-deals.ts` / `crm-update-deal.ts` |
| Product catalog and pricing | `products.ts` / `product-detail.ts` / `product-pricing.ts` |
| Quotation CRUD | `quotations.ts` / `duplicate-quotation.ts` |
| Sales orders | `sales-orders.ts` / `sales-dashboard.ts` |
| Settings | `settings.ts` |
| Auth | `login.ts` / `logout.ts` |

## Conventions

- Handlers receive a Lambda-shaped event and return `{ statusCode, headers?, body }`.
- Register every endpoint once in `api/_app/routes.ts`.
- PostgreSQL repositories live in `api/infrastructure/db/repositories/` and own durable business state and transaction boundaries.
- Evolution is the only WhatsApp delivery transport; its delivery helper lives in `api/infrastructure/integrations/evolution/`.
- Communication media uses Vercel KV and Vercel Blob.
- Shared error helpers return neutral Portuguese messages and log only safe error classes.

## Anti-patterns

- Do not add rollout switches or alternate persistence paths.
- Do not return raw upstream errors, stack traces, credentials or customer data in logs.
- Do not use CommonJS imports.
- Do not register shared libraries as routes.
