# Remoção Definitiva de Frappe e ERPNext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o Aspen Dashboard PostgreSQL-only, preservando todas as superfícies atuais sem importar dados históricos de CRM, pedidos, atividades ou leads.

**Architecture:** O corte introduz tabelas locais vazias para CRM, leads, pedidos e atividades, substitui handlers externos por repositórios Drizzle e remove dispatchers de rollout em marcos serializados.
Os contratos HTTP equivalentes permanecem estáveis onde possível, enquanto metadados de fonte, links externos e fallbacks são removidos junto com o cliente Frappe/ERPNext.

**Tech Stack:** React 19, Vite 6, Node.js ESM, Vercel Serverless, TypeScript, Drizzle ORM, PostgreSQL, Node test runner e Playwright.

## Global Constraints

- Não adicionar dependências.
- Não importar, backfillar ou semear CRM, pedidos, atividades ou leads em Production.
- Usar fixtures apenas em testes e staging descartável.
- Preservar produtos, clientes, orçamentos, revisões, templates, previews, PDFs e links públicos PostgreSQL existentes.
- Preservar tabelas históricas `frappe_*` e migrations Drizzle já aplicadas somente como artefatos de auditoria fora do runtime.
- Nunca editar ou apagar migrations e snapshots históricos sob `drizzle/`.
- Não incluir `package-lock.json` nem `template-comparison.html` não rastreado em commits deste trabalho.
- Usar imports ESM com extensão `.js` para módulos locais do backend.
- Manter erros HTTP visíveis em português brasileiro.
- Remover toda chamada, import, URL, variável de ambiente, branch e flag Frappe/ERPNext de runtime, testes ativos e documentação operacional.
- Permitir referências Frappe/ERPNext somente nas migrations históricas imutáveis sob `drizzle/` e no histórico Git.
- Aplicar TDD para cada comportamento novo ou mudança de comportamento.
- Não fazer deploy em Production antes de staging sem egress Frappe/ERPNext e canário PostgreSQL-only verde.

---

## Estrutura de Arquivos

| Arquivo | Responsabilidade após o corte |
| --- | --- |
| `api/_lib/http-error.ts` | Erro HTTP genérico sem acoplamento a provedor externo. |
| `api/_db/schema.ts` | Tabelas e invariantes PostgreSQL dos domínios locais. |
| `api/_db/crm-deals-repository.ts` | Deals, Kanban e limpeza de pipeline locais. |
| `api/_db/quote-leads-repository.ts` | Fila de leads e deduplicação idempotente local. |
| `api/_db/sales-orders-repository.ts` | Pedidos, conversão de orçamento, listagem e métricas de vendas. |
| `api/_db/product-activity-repository.ts` | Eventos append-only de catálogo, preços, orçamento e pedido. |
| `api/_functions/crm-deals.ts` | Handler Kanban PostgreSQL-only. |
| `api/_functions/crm-update-deal.ts` | Atualização local de status e follow-up. |
| `api/_functions/crm-prune-candidates.ts` | Inspeção e limpeza revalidada de deals locais. |
| `api/_functions/quote-leads.ts` | API da fila de leads PostgreSQL-only. |
| `api/_functions/typebot-lead-capture.ts` | Captura Typebot durável e local. |
| `api/_functions/sales-orders.ts` | Listagem e detalhe de pedidos locais. |
| `api/_functions/sales-order-from-quotation.ts` | Conversão transacional de orçamento em pedido local. |
| `api/_functions/sales-dashboard.ts` | Agregações SQL para o dashboard de vendas. |
| `api/_functions/product-activity.ts` | Atividade recente derivada de eventos locais. |
| `api/_functions/duplicate-quotation.ts` | Clonagem de orçamento PostgreSQL-only. |
| `api/_functions/lib/quotation-templates.ts` | Leitura de snapshots reutilizada pela duplicação e comunicação. |
| `api/_functions/send-whatsapp.ts` | Envio com snapshot PostgreSQL, Evolution e outbox durável. |
| `api/_functions/send-whatsapp-flow.ts` | Fluxos de comunicação com contexto local. |
| `api/[...path].ts` | Mapa único de handlers sem imports externos ou legados. |
| `scripts/dev-api-server.mjs` | Mapa local sincronizado com o catch-all. |
| `scripts/app-server.mjs` | Mapa de servidor local sincronizado com o catch-all. |
| `src/pages/CrmKanbanPage.tsx` | Consome contracts locais de Kanban e prune. |
| `src/pages/SalesOrdersPage.tsx` | Consome lista PostgreSQL de pedidos. |
| `src/pages/SalesOrderDetailPage.tsx` | Consome detalhe local sem links externos. |
| `src/pages/DashboardPage.tsx` | Consome métricas SQL com contratos normalizados. |
| `src/pages/LeadDetailPage.tsx` | Consome cliente e deal local sem URL externa. |
| `src/pages/ProductDetailPage.tsx` | Exibe atividade local sem modo legado. |

### Contratos de Persistência

`crm_deals` terá UUID, `quote_lead_id` opcional, `client_id` opcional, `quotation_id` opcional, snapshot de contato, status, estágio de follow-up, próxima ação, motivo de perda e timestamps.

`quote_leads` terá UUID, chave de identidade única, contato normalizado, pedido, atribuição JSON, dados brutos JSON, status, orçamento e deal associados e timestamps.

`sales_orders` terá UUID, número comercial único `PED-AAAA-NNNN`, cliente, orçamento e revisão de origem opcionais, status, datas, percentuais, totais e timestamps.

`sales_order_sequences` reservará números de pedido por ano dentro da transação de criação.

`sales_order_items` terá UUID, pedido, posição, snapshot de produto, quantidade decimal, unidade, preço e total.

`product_activity_events` terá UUID, SKU, tipo, texto, referência local opcional e timestamp.

### Task 1: Criar a fundação de schema e erro HTTP neutro

**Files:**

- Create: `api/_lib/http-error.ts`
- Create: `drizzle/0017_postgres_only_domains.sql`
- Create: `drizzle/meta/0017_snapshot.json`
- Create: `tests/unit/postgres-first-party-schema.test.ts`
- Modify: `api/_db/schema.ts`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/unit/postgres-first-party-schema.test.ts`

**Interfaces:**

- Produces: `createHttpError(statusCode, publicMessage, logMessage?)` returning `HttpError`.
- Produces: schema exports `crmDeals`, `quoteLeads`, `salesOrderSequences`, `salesOrders`, `salesOrderItems` and `productActivityEvents`.
- Produces: migration `0017_postgres_only_domains.sql` that adds empty tables and never changes existing rows.
- Consumes: existing `clients`, `quotations`, `quoteRevisions` and `products` schema exports.

- [ ] **Step 1: Write the failing structural and HTTP-error tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpError } from '../../api/_lib/http-error.js';
import { crmDeals, quoteLeads, salesOrders } from '../../api/_db/schema.js';

test('exposes first-party domain tables and a neutral HTTP error', () => {
  const error = createHttpError(409, 'Conflito.');
  assert.equal(error.statusCode, 409);
  assert.equal(error.logMessage, 'Conflito.');
  assert.ok(crmDeals.id);
  assert.ok(quoteLeads.identityKey);
  assert.ok(salesOrders.orderNumber);
});
```

- [ ] **Step 2: Run the structural test to verify it fails because the exports do not exist**

Run: `npm run build:api && TZ=UTC node --test tests/unit/postgres-first-party-schema.test.ts`

Expected: FAIL with missing module or missing schema export.

- [ ] **Step 3: Add the minimal neutral error helper and schema**

```ts
export interface HttpError extends Error {
  statusCode: number;
  logMessage: string;
}

export function createHttpError(
  statusCode: number,
  publicMessage: string,
  logMessage = publicMessage,
): HttpError {
  return Object.assign(new Error(publicMessage), { statusCode, logMessage });
}
```

```ts
export const salesOrders = pgTable('sales_orders', {
  id: uuid('id').primaryKey(),
  orderNumber: varchar('order_number', { length: 32 }).notNull(),
  quotationId: uuid('quotation_id').references(() => quotations.id),
  quotationRevisionId: uuid('quotation_revision_id').references(() => quoteRevisions.id),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  status: varchar('status', { length: 32 }).notNull().default('Draft'),
  transactionDate: date('transaction_date').notNull(),
  grandTotal: numeric('grand_total', { precision: 20, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Add every table and check constraint described in the design document.

Add indexes for Kanban status and modification time, lead identity, sales list filters, order items by product, and product activity by SKU and timestamp.

Add a partial unique index that permits retry only after a cancelled order and prevents two active orders for one quotation.

Write `0017_postgres_only_domains.sql`, `0017_snapshot.json` and the journal entry from the updated Drizzle schema without modifying prior migrations.

- [ ] **Step 4: Run structural checks and validate migration purity**

Run: `npm run build:api && TZ=UTC node --test tests/unit/postgres-first-party-schema.test.ts && git diff --check`

Expected: PASS and no `INSERT`, `UPDATE`, `DELETE`, `DROP` or `ALTER` against pre-existing business rows in `drizzle/0017_postgres_only_domains.sql`.

- [ ] **Step 5: Commit the schema foundation**

```bash
git add api/_lib/http-error.ts api/_db/schema.ts drizzle/0017_postgres_only_domains.sql drizzle/meta/0017_snapshot.json drizzle/meta/_journal.json tests/unit/postgres-first-party-schema.test.ts
git commit -m "feat(db): add first-party CRM domains"
```

### Task 2: Implement CRM deals and pipeline pruning over PostgreSQL

**Files:**

- Create: `api/_db/crm-deals-repository.ts`
- Create: `tests/unit/crm-deals-postgres.test.ts`
- Modify: `api/_functions/crm-deals.ts`
- Modify: `api/_functions/crm-update-deal.ts`
- Modify: `api/_functions/crm-prune-candidates.ts`
- Modify: `api/_functions/lib/crm-prune.ts`
- Modify: `tests/unit/crm-prune.test.ts`
- Test: `tests/unit/crm-deals-postgres.test.ts`
- Test: `tests/unit/crm-prune.test.ts`

**Interfaces:**

- Consumes: `crmDeals`, `quotations`, `quoteRevisions` and `salesOrders`.
- Produces: `CrmDealRepository.list({ search, limit })`, `updateStatus(id, patch)`, `upsertForQuotation(input)` and `prune(ids, now)`.
- Produces: unchanged Kanban response shape `{ columns, meta }` and prune response shapes expected by `CrmKanbanPage`.

- [ ] **Step 1: Write failing handler tests for local Kanban and prune revalidation**

```ts
test('groups local deals into canonical Kanban columns without external fetches', async () => {
  const handler = createCrmDealsHandler({ repository: memoryDeals });
  const result = await handler(event('GET', undefined, { search: 'Ana' }));
  const body = JSON.parse(result.body);
  assert.equal(result.statusCode, 200);
  assert.equal(body.columns[0].status, 'Novo Lead');
  assert.equal(body.columns[0].deals[0].lead_name, 'Ana');
});

test('revalidates a prune candidate before marking it lost', async () => {
  const result = await pruneDeals(['deal-1'], fixedNow, repositoryThatNowHasOrder);
  assert.deepEqual(result, {
    success: true,
    updated: 0,
    skipped: 1,
    skipped_deals: [{ deal_id: 'deal-1', reason: 'Pedido criado após a listagem.' }],
  });
});
```

- [ ] **Step 2: Run the focused tests to verify they fail for missing local repository behavior**

Run: `npm run build:api && TZ=UTC node --test tests/unit/crm-deals-postgres.test.ts tests/unit/crm-prune.test.ts`

Expected: FAIL because handlers still import or call the external client.

- [ ] **Step 3: Add the repository and replace CRM handlers**

```ts
export const CRM_PIPELINE = [
  'Novo Lead',
  'Contato Feito',
  'Orcamento Enviado',
  'Em Negociacao',
  'Arte Aprovada',
  'Pedido Fechado',
  'Perdido',
] as const;

export async function updateStatus(
  id: string,
  patch: { status: CrmDealStatus; followUpStage?: number | null },
): Promise<CrmDealRecord | null> {
  // Set lostReason when status is Perdido and always update updatedAt.
}
```

Implement case-insensitive search, canonical columns followed by alphabetical unknown statuses, and local timestamps.

Implement prune eligibility from local quotation age, deal modification time and active local order linkage.

Revalidate each selected deal inside the repository transaction before applying `Perdido`, its Portuguese next step and a lost reason.

Replace external imports with `api/_lib/http-error.ts` where errors remain necessary.

- [ ] **Step 4: Run focused CRM tests and static no-provider checks**

Run: `npm run build:api && TZ=UTC node --test tests/unit/crm-deals-postgres.test.ts tests/unit/crm-prune.test.ts && rg -n "lib/erpnext|ERPNEXT|FRAPPE" api/_functions/crm-deals.ts api/_functions/crm-update-deal.ts api/_functions/crm-prune-candidates.ts api/_functions/lib/crm-prune.ts`

Expected: tests PASS and `rg` has no matches.

- [ ] **Step 5: Commit the CRM milestone**

```bash
git add api/_db/crm-deals-repository.ts api/_functions/crm-deals.ts api/_functions/crm-update-deal.ts api/_functions/crm-prune-candidates.ts api/_functions/lib/crm-prune.ts tests/unit/crm-deals-postgres.test.ts tests/unit/crm-prune.test.ts
git commit -m "feat(crm): store Kanban deals locally"
```

### Task 3: Move quote leads and Typebot capture to PostgreSQL

**Files:**

- Create: `api/_db/quote-leads-repository.ts`
- Create: `tests/unit/quote-leads-postgres.test.ts`
- Modify: `api/_functions/quote-leads.ts`
- Modify: `api/_functions/typebot-lead-capture.ts`
- Modify: `tests/unit/quote-leads-store.test.ts`
- Modify: `tests/unit/typebot-lead-capture.test.ts`
- Test: `tests/unit/quote-leads-postgres.test.ts`
- Test: `tests/unit/typebot-lead-capture.test.ts`

**Interfaces:**

- Consumes: `quoteLeads`, `crmDeals` and existing pure lead normalization rules.
- Produces: `QuoteLeadRepository.upsert(input)`, `list(filters)` and `update(id, patch)`.
- Produces: Typebot result `{ success, enabled, dry_run, action, lead_id, lead, existing_lead, activation_required, quote_lead }` backed by a durable local transaction.

- [ ] **Step 1: Write failing idempotency and durable-capture tests**

```ts
test('merges repeated Typebot deliveries by normalized identity', async () => {
  const first = await repository.upsert({ nome: 'Ana', telefone: '(11) 99999-0000', source: 'typebot' });
  const second = await repository.upsert({ nome: 'Ana', telefone: '5511999990000', produto: 'Canga' });
  assert.equal(first.id, second.id);
  assert.equal(second.produto, 'Canga');
});

test('persists a qualified Typebot lead in operational deployment mode', async () => {
  const response = await handler(typebotEvent(validPayload));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).activation_required, false);
  assert.equal(await repository.count(), 1);
});
```

- [ ] **Step 2: Run focused tests to verify they fail because the queue uses KV or an external lead writer**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quote-leads-postgres.test.ts tests/unit/typebot-lead-capture.test.ts`

Expected: FAIL because durable PostgreSQL upsert is absent.

- [ ] **Step 3: Add a conflict-safe PostgreSQL lead repository and adapt handlers**

```ts
export interface QuoteLeadRepository {
  upsert(input: QuoteLeadInput): Promise<QuoteLeadRecord>;
  list(options: QuoteLeadListOptions): Promise<QuoteLeadRecord[]>;
  update(id: string, patch: QuoteLeadPatch): Promise<QuoteLeadRecord | null>;
}
```

Compute one normalized `identityKey` from local phone, email or source plus external ID.

Keep existing fill-only attribution merge, converted and discarded status stickiness, normalized email and phone behavior, formatted `texto` and bounded list contract.

Make Typebot dry-run side-effect free.

Make enabled Typebot capture write the quote lead and upsert a local CRM deal before returning success.

Remove the operational-mode early success path that drops valid Typebot leads.

- [ ] **Step 4: Run focused lead tests and verify no KV or external lead dependency remains**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quote-leads-postgres.test.ts tests/unit/quote-leads-store.test.ts tests/unit/typebot-lead-capture.test.ts && rg -n "@vercel/kv|lib/erpnext|ERPNEXT|FRAPPE" api/_functions/quote-leads.ts api/_functions/typebot-lead-capture.ts api/_db/quote-leads-repository.ts`

Expected: tests PASS and `rg` has no matches.

- [ ] **Step 5: Commit the local lead milestone**

```bash
git add api/_db/quote-leads-repository.ts api/_functions/quote-leads.ts api/_functions/typebot-lead-capture.ts tests/unit/quote-leads-postgres.test.ts tests/unit/quote-leads-store.test.ts tests/unit/typebot-lead-capture.test.ts
git commit -m "feat(leads): persist Typebot leads locally"
```

### Task 4: Make catalog, clients, quotes and duplication PostgreSQL-only

**Files:**

- Modify: `api/_functions/products.ts`
- Modify: `api/_functions/products-core.ts`
- Modify: `api/_functions/product-detail.ts`
- Modify: `api/_functions/product-detail-core.ts`
- Modify: `api/_functions/product-update.ts`
- Modify: `api/_functions/product-update-core.ts`
- Modify: `api/_functions/product-pricing.ts`
- Modify: `api/_functions/product-pricing-update.ts`
- Modify: `api/_functions/pricing-lookup.ts`
- Modify: `api/_functions/leads-clients.ts`
- Modify: `api/_functions/client-core.ts`
- Modify: `api/_functions/client-detail.ts`
- Modify: `api/_functions/orcamento.ts`
- Modify: `api/_functions/orcamento-core.ts`
- Modify: `api/_functions/quotations.ts`
- Modify: `api/_functions/quotations-core.ts`
- Modify: `api/_functions/duplicate-quotation.ts`
- Modify: `api/_db/quote-repository.ts`
- Modify: `api/_db/quote-draft-management-repository.ts`
- Modify: `api/_db/quotation-lifecycle-repository.ts`
- Create: `tests/unit/duplicate-quotation-postgres.test.ts`
- Modify: `tests/unit/products.test.ts`
- Modify: `tests/unit/pricing-rollout.test.ts`
- Modify: `tests/unit/client-rollout.test.ts`
- Modify: `tests/unit/leads-clients-quote-mode.test.ts`
- Modify: `tests/unit/orcamento-core.test.ts`
- Modify: `tests/unit/operational-mode.test.ts`
- Modify: `tests/unit/quotations-core.test.ts`
- Modify: `tests/unit/quotations-postgres.test.ts`
- Test: `tests/unit/duplicate-quotation-postgres.test.ts`

**Interfaces:**

- Consumes: existing PostgreSQL product, pricing, client, quotation and CRM deal repositories.
- Produces: direct PostgreSQL handlers with no `core_mode`, `source`, rollout state or legacy fallback.
- Produces: `duplicateQuotation(quotationId)` that creates a distinct local draft from the selected immutable revision.

- [ ] **Step 1: Write failing direct-path and duplicate tests**

```ts
test('updates an empty product description through the only product handler', async () => {
  const result = await productUpdate(event('PATCH', { descricao: '' }, { sku: 'SKU-1' }));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).produto.descricao, '');
});

test('duplicates a PostgreSQL quotation without calling a provider', async () => {
  const result = await duplicateQuotation({ quotationId: seededQuote.id });
  assert.notEqual(result.quotation.id, seededQuote.id);
  assert.deepEqual(result.items.map((item) => item.produtoSku), seededQuote.items.map((item) => item.produtoSku));
});
```

- [ ] **Step 2: Run focused tests to verify they fail under mode dispatch or external duplication**

Run: `npm run build:api && TZ=UTC node --test tests/unit/products.test.ts tests/unit/pricing-rollout.test.ts tests/unit/client-rollout.test.ts tests/unit/leads-clients-quote-mode.test.ts tests/unit/orcamento-core.test.ts tests/unit/quotations-core.test.ts tests/unit/quotations-postgres.test.ts tests/unit/duplicate-quotation-postgres.test.ts`

Expected: FAIL because a flag, legacy branch or external duplicate implementation remains.

- [ ] **Step 3: Collapse every core boundary to one PostgreSQL implementation**

```ts
export const handler = createCoreHandler();
```

Replace each mode dispatcher with its existing PostgreSQL core handler.

Remove response metadata that exposes `core_mode` or external `source`.

Implement quote duplication by opening a repository transaction, copying client and revision snapshots, allocating a new business number, copying item snapshots, creating a fresh draft revision and creating or updating its local CRM deal.

Preserve concurrency checks, immutable existing revisions, public link behavior, outbox durability and Portuguese error contracts.

- [ ] **Step 4: Run focused core tests and check direct handler imports**

Run: `npm run build:api && TZ=UTC node --test tests/unit/products.test.ts tests/unit/pricing-core.test.ts tests/unit/pricing-postgres.test.ts tests/unit/client-rollout.test.ts tests/unit/leads-clients-quote-mode.test.ts tests/unit/orcamento-core.test.ts tests/unit/quotations-core.test.ts tests/unit/quotations-postgres.test.ts tests/unit/duplicate-quotation-postgres.test.ts && rg -n "legacy|CRM_CORE_|CRM_OPERATIONAL_MODE|CRM_QUOTES_ROLLOUT_STATE|lib/erpnext" api/_functions/products.ts api/_functions/products-core.ts api/_functions/product-detail.ts api/_functions/product-detail-core.ts api/_functions/product-update.ts api/_functions/product-update-core.ts api/_functions/product-pricing.ts api/_functions/product-pricing-update.ts api/_functions/pricing-lookup.ts api/_functions/leads-clients.ts api/_functions/client-core.ts api/_functions/client-detail.ts api/_functions/orcamento.ts api/_functions/orcamento-core.ts api/_functions/quotations.ts api/_functions/quotations-core.ts api/_functions/duplicate-quotation.ts`

Expected: tests PASS and the final `rg` has no matches.

- [ ] **Step 5: Commit the direct core cutover**

```bash
git add api/_functions/products.ts api/_functions/products-core.ts api/_functions/product-detail.ts api/_functions/product-detail-core.ts api/_functions/product-update.ts api/_functions/product-update-core.ts api/_functions/product-pricing.ts api/_functions/product-pricing-update.ts api/_functions/pricing-lookup.ts api/_functions/leads-clients.ts api/_functions/client-core.ts api/_functions/client-detail.ts api/_functions/orcamento.ts api/_functions/orcamento-core.ts api/_functions/quotations.ts api/_functions/quotations-core.ts api/_functions/duplicate-quotation.ts api/_db/quote-repository.ts api/_db/quote-draft-management-repository.ts api/_db/quotation-lifecycle-repository.ts tests/unit/products.test.ts tests/unit/pricing-rollout.test.ts tests/unit/client-rollout.test.ts tests/unit/leads-clients-quote-mode.test.ts tests/unit/orcamento-core.test.ts tests/unit/operational-mode.test.ts tests/unit/quotations-core.test.ts tests/unit/quotations-postgres.test.ts tests/unit/duplicate-quotation-postgres.test.ts
git commit -m "refactor(core): remove rollout dispatch"
```

### Task 5: Implement pedidos e dashboard de vendas PostgreSQL-only

**Files:**

- Create: `api/_db/sales-orders-repository.ts`
- Create: `tests/unit/sales-orders-postgres.test.ts`
- Create: `tests/unit/sales-dashboard-postgres.test.ts`
- Modify: `api/_functions/sales-orders.ts`
- Modify: `api/_functions/sales-order-from-quotation.ts`
- Modify: `api/_functions/sales-dashboard.ts`
- Modify: `src/types/domain.ts`
- Modify: `tests/unit/operational-mode.test.ts`
- Test: `tests/unit/sales-orders-postgres.test.ts`
- Test: `tests/unit/sales-dashboard-postgres.test.ts`

**Interfaces:**

- Consumes: `salesOrders`, `salesOrderItems`, `salesOrderSequences`, quotations, revisions and CRM deals.
- Produces: `SalesOrdersRepository.list(options)`, `get(id)`, `createFromQuotation(quotationId)` and `dashboard(period)`.
- Produces: existing list and detail response fields used by `SalesOrdersPage` and `SalesOrderDetailPage`.

- [ ] **Step 1: Write failing order conversion, empty list and dashboard tests**

```ts
test('returns a zero-valued dashboard when no local orders exist', async () => {
  const response = await dashboardHandler(event('GET', undefined, { period: '30d' }));
  const body = JSON.parse(response.body);
  assert.deepEqual(body.summary, {
    total_revenue: 0,
    orders_count: 0,
    avg_ticket: 0,
    open_orders: 0,
    conversion_rate: 0,
  });
  assert.deepEqual(body.top_products, []);
});

test('creates one local order from one approved quotation revision', async () => {
  const created = await repository.createFromQuotation(approvedQuotation.id);
  const duplicate = await repository.createFromQuotation(approvedQuotation.id);
  assert.equal(created.alreadyExists, false);
  assert.equal(duplicate.alreadyExists, true);
  assert.equal(await repository.itemCount(created.id), approvedQuotation.items.length);
});
```

- [ ] **Step 2: Run focused tests to verify they fail because sales handlers call the external client**

Run: `npm run build:api && TZ=UTC node --test tests/unit/sales-orders-postgres.test.ts tests/unit/sales-dashboard-postgres.test.ts`

Expected: FAIL because no local sales repository exists.

- [ ] **Step 3: Add local order repository and replace sales handlers**

```ts
export interface SalesOrdersRepository {
  list(options: SalesOrderListOptions): Promise<SalesOrderListResult>;
  get(id: string): Promise<SalesOrderDetail | null>;
  createFromQuotation(quotationId: string): Promise<CreateSalesOrderResult>;
  dashboard(options: DashboardPeriod): Promise<SalesDashboardResult>;
}
```

Reserve `PED-AAAA-NNNN` atomically with the order insert.

Lock or guard quotation linkage so concurrent conversion is idempotent.

Return a successful existing-order response instead of a conflict for repeated conversion.

Snapshot the chosen quote revision items into sales order items without recalculating money.

Update the local deal to `Pedido Fechado` in the same transaction when one exists.

Compute list pagination using `COUNT(*)`, date filters, status filters and case-insensitive search.

Compute dashboard totals, previous-period delta, top products, top customers, daily sales, conversion and stale quotes through SQL aggregates without N-plus-one reads.

Normalize the handler response to frontend names `total_revenue`, `orders_count` and `avg_ticket`.

- [ ] **Step 4: Run focused order tests and check no external dependency remains**

Run: `npm run build:api && TZ=UTC node --test tests/unit/sales-orders-postgres.test.ts tests/unit/sales-dashboard-postgres.test.ts && rg -n "lib/erpnext|ERPNEXT|CRM_OPERATIONAL_MODE" api/_functions/sales-orders.ts api/_functions/sales-order-from-quotation.ts api/_functions/sales-dashboard.ts api/_db/sales-orders-repository.ts`

Expected: tests PASS and the final `rg` has no matches.

- [ ] **Step 5: Commit the local sales milestone**

```bash
git add api/_db/sales-orders-repository.ts api/_functions/sales-orders.ts api/_functions/sales-order-from-quotation.ts api/_functions/sales-dashboard.ts src/types/domain.ts tests/unit/sales-orders-postgres.test.ts tests/unit/sales-dashboard-postgres.test.ts tests/unit/operational-mode.test.ts
git commit -m "feat(sales): store orders and metrics locally"
```

### Task 6: Registrar e exibir atividade local de produto

**Files:**

- Create: `api/_db/product-activity-repository.ts`
- Create: `tests/unit/product-activity-postgres.test.ts`
- Modify: `api/_db/product-catalog-repository.ts`
- Modify: `api/_db/pricing-repository.ts`
- Modify: `api/_db/quote-repository.ts`
- Modify: `api/_db/sales-orders-repository.ts`
- Modify: `api/_functions/product-activity.ts`
- Modify: `src/pages/ProductDetailPage.tsx`
- Test: `tests/unit/product-activity-postgres.test.ts`

**Interfaces:**

- Consumes: product SKU, local product mutation, quote and order transactions.
- Produces: `ProductActivityRepository.appendMany(events)` and `list(sku, limit)`.
- Produces: `{ sku, atividades: [{ tipo, texto, data, id }] }` from local data only.

- [ ] **Step 1: Write failing tests for empty and appended local activity**

```ts
test('returns an empty local activity stream for a new SKU', async () => {
  const result = await handler(event('GET', undefined, { sku: 'SKU-NEW' }));
  assert.deepEqual(JSON.parse(result.body), { sku: 'SKU-NEW', atividades: [] });
});

test('records a price change and returns it newest first', async () => {
  await activityRepository.appendMany([{ sku: 'SKU-1', tipo: 'preco', texto: 'Preço atualizado' }]);
  const rows = await activityRepository.list('SKU-1', 3);
  assert.equal(rows[0].tipo, 'preco');
});
```

- [ ] **Step 2: Run focused tests to verify they fail because activity reads external versions**

Run: `npm run build:api && TZ=UTC node --test tests/unit/product-activity-postgres.test.ts`

Expected: FAIL because the handler does not have a local event repository.

- [ ] **Step 3: Implement append-only local activity integration**

```ts
export interface ProductActivityRepository {
  appendMany(events: readonly ProductActivityEventInput[]): Promise<void>;
  list(sku: string, limit: number): Promise<ProductActivityRecord[]>;
}
```

Write events inside the catalog, pricing, quote and sales-order transactions.

Use event types `produto`, `preco`, `orcamento` and `pedido`.

Do not manufacture pre-cutover changes, external version history or fake data.

Make `ProductDetailPage` fetch activity for every non-new product and render the same card without legacy mode state.

- [ ] **Step 4: Run focused tests and product E2E coverage**

Run: `npm run build:api && TZ=UTC node --test tests/unit/product-activity-postgres.test.ts tests/unit/products.test.ts tests/unit/pricing-postgres.test.ts && npx playwright test tests/products-core.spec.js`

Expected: PASS with no external activity request.

- [ ] **Step 5: Commit the product activity milestone**

```bash
git add api/_db/product-activity-repository.ts api/_db/product-catalog-repository.ts api/_db/pricing-repository.ts api/_db/quote-repository.ts api/_db/sales-orders-repository.ts api/_functions/product-activity.ts src/pages/ProductDetailPage.tsx tests/unit/product-activity-postgres.test.ts
git commit -m "feat(products): record local activity"
```

### Task 7: Make WhatsApp and communication flows snapshot-only

**Files:**

- Modify: `api/_functions/send-whatsapp.ts`
- Modify: `api/_functions/send-whatsapp-flow.ts`
- Modify: `api/_functions/communication-flow-preview.ts`
- Modify: `api/_functions/communication-media.ts`
- Modify: `api/_functions/communication-media-upload.ts`
- Modify: `api/_functions/communication-flows.ts`
- Modify: `api/_functions/whatsapp-conversations.ts`
- Modify: `api/_functions/whatsapp-leads.ts`
- Modify: `api/_functions/lib/postgres-media.ts`
- Modify: `api/_functions/lib/whatsapp-conversations-store.ts`
- Modify: `api/_functions/lib/whatsapp-conversations-sync.ts`
- Modify: `tests/unit/send-whatsapp.test.ts`
- Modify: `tests/unit/whatsapp-conversations.test.ts`
- Modify: `tests/unit/whatsapp-leads.test.ts`
- Test: `tests/unit/send-whatsapp.test.ts`

**Interfaces:**

- Consumes: quotation revision snapshots, local clients, local deals, Blob/KV media and Evolution configuration.
- Produces: existing send and flow response fields without provider-specific quotation, deal, contact or media resolution.
- Produces: rejection of direct external media URLs before a provider send attempt.

- [ ] **Step 1: Write failing local-context and media-rejection tests**

```ts
test('sends a quotation flow from a PostgreSQL revision without an external lookup', async () => {
  const result = await handler(postgresFlowEvent({ quotation_id: quote.id, revision_id: revision.id }));
  assert.equal(result.statusCode, 200);
  assert.equal(fetchCalls.some((url) => String(url).includes('frappe')), false);
});

test('rejects a direct legacy media URL before delivery', async () => {
  const result = await handler(postgresFlowEvent({ media_url: 'https://legacy.invalid/file.png' }));
  assert.equal(result.statusCode, 400);
});
```

- [ ] **Step 2: Run focused communication tests to verify they fail for legacy lookup paths**

Run: `npm run build:api && TZ=UTC node --test tests/unit/send-whatsapp.test.ts tests/unit/whatsapp-conversations.test.ts tests/unit/whatsapp-leads.test.ts`

Expected: FAIL because a non-PostgreSQL branch or direct legacy media URL remains accepted.

- [ ] **Step 3: Remove communication fallbacks and use local snapshots**

```ts
function requirePostgresRevision(payload: Record<string, unknown>): {
  quotationId: string;
  revisionId: string;
} {
  const quotationId = String(payload.quotation_id || payload.quotationId || '').trim();
  const revisionId = String(payload.revision_id || payload.revisionId || '').trim();
  if (!quotationId || !revisionId) throw createHttpError(400, 'Orçamento e revisão são obrigatórios.');
  return { quotationId, revisionId };
}
```

Resolve recipient, items, link, PDF and local deal correlation from the revision snapshot and repositories.

Keep Evolution as the only optional transport.

Keep outbox durability and partial-send handling.

Allow only local Blob URLs, revision-bound public quotation URLs and explicitly approved Evolution payload data as media sources.

Replace any generic external error import with `api/_lib/http-error.ts`.

- [ ] **Step 4: Run focused communication tests and scan changed modules**

Run: `npm run build:api && TZ=UTC node --test tests/unit/send-whatsapp.test.ts tests/unit/whatsapp-conversations.test.ts tests/unit/whatsapp-leads.test.ts tests/unit/whatsapp-flows.test.ts && rg -n "lib/erpnext|ERPNEXT|frappe\.cloud" api/_functions/send-whatsapp.ts api/_functions/send-whatsapp-flow.ts api/_functions/communication-flow-preview.ts api/_functions/communication-media.ts api/_functions/communication-media-upload.ts api/_functions/communication-flows.ts api/_functions/whatsapp-conversations.ts api/_functions/whatsapp-leads.ts api/_functions/lib/postgres-media.ts`

Expected: tests PASS and the final `rg` has no matches.

- [ ] **Step 5: Commit communication cutover**

```bash
git add api/_functions/send-whatsapp.ts api/_functions/send-whatsapp-flow.ts api/_functions/communication-flow-preview.ts api/_functions/communication-media.ts api/_functions/communication-media-upload.ts api/_functions/communication-flows.ts api/_functions/whatsapp-conversations.ts api/_functions/whatsapp-leads.ts api/_functions/lib/postgres-media.ts api/_functions/lib/whatsapp-conversations-store.ts api/_functions/lib/whatsapp-conversations-sync.ts tests/unit/send-whatsapp.test.ts tests/unit/whatsapp-conversations.test.ts tests/unit/whatsapp-leads.test.ts
git commit -m "refactor(whatsapp): use local quote context"
```

### Task 8: Remover metadados, tipos e links externos do frontend

**Files:**

- Delete: `src/types/erpnext.ts`
- Delete: `src/lib/erpLinks.ts`
- Modify: `src/types/index.ts`
- Modify: `src/types/domain.ts`
- Modify: `src/pages/CrmKanbanPage.tsx`
- Modify: `src/pages/LeadDetailPage.tsx`
- Modify: `src/pages/LeadsPage.tsx`
- Modify: `src/pages/ManualOrcamentoPage.tsx`
- Modify: `src/pages/SalesOrdersPage.tsx`
- Modify: `src/pages/SalesOrderDetailPage.tsx`
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/pages/ProductDetailPage.tsx`
- Modify: `src/lib/communicationApi.ts`
- Modify: `tests/client-core.spec.js`
- Modify: `tests/products-core.spec.js`
- Modify: `tests/orcamento-core.spec.js`
- Test: `tests/quotation-lifecycle.spec.js`

**Interfaces:**

- Consumes: direct local handler contracts created in Tasks 2 through 7.
- Produces: frontend types without external source unions, mode flags or external URL fields.
- Produces: same visible screens with local navigation and empty-state behavior.

- [ ] **Step 1: Write failing browser tests for local-only affordances**

```js
test('does not render an external ERP link on a local sales order', async ({ page }) => {
  await page.goto('/#/sales-orders/PED-2026-0001');
  await expect(page.getByRole('link', { name: /ERP/i })).toHaveCount(0);
  await expect(page.getByText('Voltar ao orçamento')).toBeVisible();
});

test('renders zero-valued local sales metrics for an empty period', async ({ page }) => {
  await page.goto('/#/dashboard');
  await expect(page.getByText('R$ 0,00').first()).toBeVisible();
});
```

- [ ] **Step 2: Run browser tests to verify they fail because ERP links and source metadata still exist**

Run: `npx playwright test tests/client-core.spec.js tests/products-core.spec.js tests/orcamento-core.spec.js tests/quotation-lifecycle.spec.js`

Expected: FAIL because an external link, source mode branch or legacy type remains.

- [ ] **Step 3: Replace frontend contracts with local contracts**

```ts
export interface QuotationResponse {
  success?: boolean;
  quotation_id?: string;
  quote_id?: string;
  revision_id?: string;
  status?: string;
  public_url?: string | null;
}
```

Move these local response types into `src/types/domain.ts` or the consuming page.

Remove `source`, `core_mode`, `erp_url`, `doctype` compatibility branches and links to the external application.

Keep phone and email links because they are user-controlled actions rather than provider dependencies.

Use local sales order and quotation route navigation in place of external anchors.

Normalize dashboard properties to the backend local response contract.

- [ ] **Step 4: Run frontend E2E and static source scans**

Run: `npx playwright test tests/client-core.spec.js tests/products-core.spec.js tests/orcamento-core.spec.js tests/quotation-lifecycle.spec.js && rg -n -i "frappe|erpnext|core_mode|source: 'frappe'|erp_url" src`

Expected: browser tests PASS and the final `rg` has no matches.

- [ ] **Step 5: Commit frontend cleanup**

```bash
git add src/types/index.ts src/types/domain.ts src/pages/CrmKanbanPage.tsx src/pages/LeadDetailPage.tsx src/pages/LeadsPage.tsx src/pages/ManualOrcamentoPage.tsx src/pages/SalesOrdersPage.tsx src/pages/SalesOrderDetailPage.tsx src/pages/DashboardPage.tsx src/pages/ProductDetailPage.tsx src/lib/communicationApi.ts tests/client-core.spec.js tests/products-core.spec.js tests/orcamento-core.spec.js tests/quotation-lifecycle.spec.js
git rm src/types/erpnext.ts src/lib/erpLinks.ts
git commit -m "refactor(ui): remove external provider state"
```

### Task 9: Delete runtime legacy code, routes, flags and credentials references

**Files:**

- Delete: `api/_functions/lib/erpnext.ts`
- Delete: `api/_functions/products-legacy.ts`
- Delete: `api/_functions/product-detail-legacy.ts`
- Delete: `api/_functions/product-update-legacy.ts`
- Delete: `api/_functions/leads-clients-legacy.ts`
- Delete: `api/_functions/client-detail-legacy.ts`
- Delete: `api/_functions/orcamento-legacy.ts`
- Delete: `api/_functions/frappe-migration.ts`
- Delete: `api/_functions/lib/frappe-migration-core.ts`
- Delete: `api/_db/frappe-migration-repository.ts`
- Delete: `api/_functions/operational-mode.ts`
- Delete: `api/_functions/orcamento-mode.ts`
- Delete: `api/_functions/products-mode.ts`
- Delete: `api/_functions/pricing.ts`
- Delete: `scripts/migrate-frappe-crm.mjs`
- Delete: `scripts/anonymize-frappe-snapshot.mjs`
- Delete: `scripts/reconcile-migration.mjs`
- Delete: `scripts/test-client-metadata.mjs`
- Delete: `test_local.mjs`
- Create: `scripts/check-no-legacy-provider.mjs`
- Modify: `api/[...path].ts`
- Modify: `scripts/dev-api-server.mjs`
- Modify: `scripts/app-server.mjs`
- Modify: `api/_db/schema.ts`
- Modify: `api/_functions/operational-status.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `tests/unit/route-map.test.ts`
- Modify: `tests/operational-mode.spec.js`
- Modify: `tests/quotation-cutover.spec.js`
- Modify: `tests/quotation-cutover-staging.spec.js`
- Modify: `docs/pre-orcamentos-inbox.md`
- Modify: `aspen-vault/referencia/env-vars.md`
- Modify: `aspen-vault/runbooks/rotacionar-env-vars.md`
- Test: `scripts/check-no-legacy-provider.mjs`

**Interfaces:**

- Consumes: all PostgreSQL-only replacements from Tasks 2 through 8.
- Produces: three synchronized route maps with no legacy imports.
- Produces: source tree guard that permits historical `drizzle/` content only.

- [ ] **Step 1: Write a failing structural guard test**

```ts
test('contains no legacy provider reference outside immutable migrations', () => {
  const result = spawnSync('node', ['scripts/check-no-legacy-provider.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
```

- [ ] **Step 2: Run the guard to verify it fails against remaining runtime references**

Run: `node scripts/check-no-legacy-provider.mjs`

Expected: FAIL with the exact runtime paths that still refer to Frappe, ERPNext, rollout flags or legacy client imports.

- [ ] **Step 3: Delete only code replaced by earlier milestones and synchronize maps**

```js
const forbidden = /\b(?:frappe|erpnext)\b|CRM_(?:CORE_|OPERATIONAL_MODE\b|QUOTES_ROLLOUT_STATE\b)/i;
const includedRoots = [
  'api',
  'src',
  'scripts',
  'tests',
  'docs/operational-cutoff-procedure.md',
  'docs/pre-orcamentos-inbox.md',
  'aspen-vault',
  '.env.example',
  'package.json',
];
const allowedHistoricalPrefix = 'drizzle/';
```

Make the guard scan tracked source under the included roots.

Exclude `docs/superpowers/` because approved plans, specifications and acceptance reports are audit records rather than active operational documentation.

Make it skip only `drizzle/` historical migration artifacts, `docs/superpowers/` audit records and Git metadata.

Remove lineage table exports from `api/_db/schema.ts` without dropping physical database tables.

Change `operational-status` to report database connectivity and mandatory local settings without querying historical lineage.

Remove migration and external-test package scripts.

Remove Frappe/ERPNext and rollout variables from `.env.example`.

Delete outdated tests and documentation only after replacing their behavioral coverage with PostgreSQL-only tests.

Keep `api/[...path].ts`, `scripts/dev-api-server.mjs` and `scripts/app-server.mjs` route names synchronized.

- [ ] **Step 4: Run complete static and test checks**

Run: `node scripts/check-no-legacy-provider.mjs && npm run build:api && TZ=UTC node --test tests/unit/*.test.{js,ts} && npm run lint && npm run build`

Expected: every command exits zero and `git grep -i -n -E 'frappe|erpnext' -- api src scripts tests .env.example package.json docs/operational-cutoff-procedure.md docs/pre-orcamentos-inbox.md aspen-vault` has no matches in tracked active files.

- [ ] **Step 5: Commit final runtime deletion**

```bash
git add api src scripts tests docs aspen-vault package.json .env.example drizzle/meta/_journal.json
git rm api/_functions/lib/erpnext.ts api/_functions/products-legacy.ts api/_functions/product-detail-legacy.ts api/_functions/product-update-legacy.ts api/_functions/leads-clients-legacy.ts api/_functions/client-detail-legacy.ts api/_functions/orcamento-legacy.ts api/_functions/frappe-migration.ts api/_functions/lib/frappe-migration-core.ts api/_db/frappe-migration-repository.ts api/_functions/operational-mode.ts api/_functions/orcamento-mode.ts api/_functions/products-mode.ts api/_functions/pricing.ts scripts/migrate-frappe-crm.mjs scripts/anonymize-frappe-snapshot.mjs scripts/reconcile-migration.mjs scripts/test-client-metadata.mjs test_local.mjs
git commit -m "refactor: remove Frappe runtime"
```

### Task 10: Validate staging, remove Vercel configuration and cut Production

**Files:**

- Create: `tests/postgres-only-cutover.spec.js`
- Create: `scripts/postgres-only-canary.mjs`
- Modify: `tests/support/staging-auth.js`
- Modify: `docs/operational-cutoff-procedure.md`
- Modify: `docs/superpowers/reports/2026-08-10-remocao-definitiva-frappe-acceptance.md`
- Test: `tests/postgres-only-cutover.spec.js`

**Interfaces:**

- Consumes: PostgreSQL-only app deployment and staging credentials.
- Produces: canary evidence for no Frappe/ERPNext egress, working local screens and absent rollout/provider variables.
- Produces: Production environment with no `ERPNEXT_*`, `FRAPPE_*`, `CRM_CORE_*`, `CRM_OPERATIONAL_MODE` or `CRM_QUOTES_ROLLOUT_STATE` values.

- [ ] **Step 1: Write a failing staging cutover test and canary assertion**

```js
test('uses only local handlers after PostgreSQL-only cutover', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await loginToStaging(page);
  await page.goto('/#/products');
  await expect(page.getByText(/Produtos/i).first()).toBeVisible();
  assert.equal(requests.some((url) => /frappe|erpnext/i.test(url)), false);
});
```

```js
assert.equal(environmentNames.some((name) => /^(ERPNEXT|FRAPPE|CRM_CORE_|CRM_OPERATIONAL_MODE|CRM_QUOTES_ROLLOUT_STATE)/.test(name)), false);
```

- [ ] **Step 2: Run the test before configuration deletion to verify its failure identifies a remaining dependency**

Run: `STAGING_E2E=1 BASE_URL="$STAGING_BASE_URL" npx playwright test tests/postgres-only-cutover.spec.js`

Expected: FAIL until staging deploy and environment cleanup are complete.

- [ ] **Step 3: Deploy and validate staging before Production**

Apply migration `0017_postgres_only_domains.sql` to staging.

Deploy the PostgreSQL-only build to staging with Frappe/ERPNext egress denied.

Run unit, type, lint, build, focused E2E, product, client, quote, CRM, sales, activity, Typebot, WhatsApp preview and public-link checks.

Inspect staging logs and firewall counters for zero Frappe/ERPNext DNS or HTTP attempts.

Verify empty CRM, order, dashboard and activity surfaces render zero or empty local state without seeded Production-like data.

- [ ] **Step 4: Cut Production and remove credentials only after the staging canary passes**

Create a PostgreSQL backup and capture current deploy ID before changing Production.

Apply the compatible DDL migration before deploying code that uses it.

Solicite confirmação explícita do usuário imediatamente antes de aplicar a migration em Production, deployar Production, remover variáveis Vercel ou revogar credenciais.

Depois da confirmação, deploye Production, execute `scripts/postgres-only-canary.mjs`, então remova `ERPNEXT_*`, `FRAPPE_*`, `CRM_CORE_PRODUCTS_ENABLED`, `CRM_CORE_CLIENTS_ENABLED`, `CRM_CORE_QUOTES_ENABLED`, `CRM_QUOTES_ROLLOUT_STATE` e `CRM_OPERATIONAL_MODE` de cada ambiente Vercel.

Faça redeploy depois da remoção das variáveis e execute novamente o canário.

Revogue o token externo antigo somente depois que o canário final de Production confirmar dependência zero.

Registre IDs de deploy, comandos, contagens de testes, resultados do canário, nomes de variáveis de ambiente e riscos residuais no relatório de aceite.

- [ ] **Step 5: Commit validation assets and report**

```bash
git add tests/postgres-only-cutover.spec.js scripts/postgres-only-canary.mjs tests/support/staging-auth.js docs/operational-cutoff-procedure.md docs/superpowers/reports/2026-08-10-remocao-definitiva-frappe-acceptance.md
git commit -m "test: verify PostgreSQL-only cutover"
```

## Final Verification Checklist

- [ ] `git status --short` contains only intended tracked changes and preserves unrelated `template-comparison.html`.
- [ ] `node scripts/check-no-legacy-provider.mjs` exits zero.
- [ ] `npm run build:api` exits zero.
- [ ] `TZ=UTC node --test tests/unit/*.test.{js,ts}` exits zero.
- [ ] `npm run lint` exits zero.
- [ ] `npm run build` exits zero.
- [ ] Relevant Playwright suites pass locally and in staging.
- [ ] Staging firewall and logs show no Frappe/ERPNext egress.
- [ ] Production canary validates products, clients, quotations, previews, PDFs, links, CRM, sales, activity, Typebot and WhatsApp PostgreSQL-only behavior.
- [ ] Vercel no longer has external provider credentials or rollout flags.
- [ ] Existing PostgreSQL quotations, revisions and public links remain accessible.
- [ ] No production seed or historical backfill was inserted.
