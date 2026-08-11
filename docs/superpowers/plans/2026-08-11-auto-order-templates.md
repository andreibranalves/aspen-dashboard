# Auto Order Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared SKU-only order templates to `/auto`, then apply every extracted quantity to every template SKU in one quotation draft.

**Architecture:** Store templates and ordered SKU membership in PostgreSQL behind one repository and one authenticated CRUD endpoint. Pass only `orderTemplateId` into `/api/extract`; the server loads current template data, extracts quantities, and replaces model-selected products with a deterministic quantity-by-SKU expansion. Keep the existing no-template extraction path unchanged.

**Tech Stack:** React 19, TypeScript, Vite 6, Node.js ESM serverless handlers, PostgreSQL, Drizzle ORM 0.45, Drizzle Kit, Node test runner, Playwright.

## Global Constraints

- Do not add dependencies.
- Keep local ESM imports explicit with `.js` inside `api/`.
- Keep user-facing errors in Brazilian Portuguese.
- Never trust SKUs sent by the browser during extraction.
- Keep `Nenhum` selected on initial load and after `Limpar`.
- Keep all order templates shared across authenticated dashboard users.
- Store no quantities in templates.
- Ignore text-selected products whenever an order template is selected.
- Keep all quantity and SKU combinations in one quotation draft.
- Preserve the current extraction behavior when no template is selected.
- Do not modify quotation HTML template behavior.
- Do not edit generated API `.js` or `.js.map` files.
- Do not touch the unrelated untracked `template-simple.html` file.

## File Map

- Modify `api/_db/schema.ts` to define `order_templates` and `order_template_items`.
- Create `drizzle/0017_order_templates.sql` through Drizzle Kit.
- Create `drizzle/meta/0017_snapshot.json` through Drizzle Kit.
- Modify `drizzle/meta/_journal.json` through Drizzle Kit.
- Create `api/_db/order-template-repository.ts` for validation, transactions, CRUD, and extraction lookup.
- Create `api/_functions/order-templates.ts` for the HTTP contract.
- Modify `api/[...path].ts`, `scripts/dev-api-server.mjs`, and `scripts/app-server.mjs` to register `/api/order-templates`.
- Modify `api/_functions/extract.ts` to load selected templates and expand quantities deterministically.
- Create `src/lib/orderTemplatesApi.ts` for typed frontend API calls.
- Create `src/components/OrderTemplateManager.tsx` for modal management and catalog search.
- Modify `src/pages/AutoQuotePage.tsx` for selector state, modal integration, extraction payload, and reset behavior.
- Create `tests/unit/order-templates.test.ts` for repository contract and HTTP behavior.
- Modify `tests/unit/extract-handler.test.ts` for selected-template extraction.
- Modify `tests/unit/extract-rules.test.ts` for prompt and pure expansion rules.
- Modify `tests/operational-mode.spec.js` for the visible `/auto` workflow.

---

### Task 1: Persist shared order templates

**Files:**

- Modify: `api/_db/schema.ts:1-140`
- Create: `api/_db/order-template-repository.ts`
- Create: `tests/unit/order-templates.test.ts`
- Create: `drizzle/0017_order_templates.sql`
- Create: `drizzle/meta/0017_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**

- Produces: `OrderTemplateItem`, `OrderTemplateRecord`, `OrderTemplateRepository`, and `createOrderTemplateRepository()`.
- Produces: `repository.list()`, `repository.get(id)`, `repository.getForExtraction(id)`, `repository.create(input)`, `repository.update(id, input)`, and `repository.archive(id)`.
- Consumes: existing `products` table and `getDatabase()`.

- [ ] **Step 1: Write failing repository contract tests**

Create `tests/unit/order-templates.test.ts` with a small `MemoryOrderTemplateRepository` implementing the planned interface and contract tests for normalization and errors.
Import the real exported normalization helpers and error classes so the tests exercise production validation.

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeOrderTemplateInput,
  OrderTemplateConflictError,
  OrderTemplateInputError,
} from '../../api/_db/order-template-repository.js';

describe('order template input', () => {
  it('trims a name, preserves SKU order, and rejects duplicate SKUs', () => {
    assert.deepEqual(
      normalizeOrderTemplateInput({ name: ' Todos os lenços ', skus: [' LNC-A ', 'LNC-B'] }),
      { name: 'Todos os lenços', skus: ['LNC-A', 'LNC-B'] }
    );
    assert.throws(
      () => normalizeOrderTemplateInput({ name: 'Pack', skus: ['LNC-A', 'LNC-A'] }),
      OrderTemplateInputError
    );
  });

  it('rejects blank names and empty SKU lists', () => {
    assert.throws(
      () => normalizeOrderTemplateInput({ name: ' ', skus: ['LNC-A'] }),
      /Informe o nome do template de pedido/
    );
    assert.throws(
      () => normalizeOrderTemplateInput({ name: 'Pack', skus: [] }),
      /Adicione pelo menos um produto/
    );
  });

  it('exposes a conflict error for duplicate active names', () => {
    assert.equal(new OrderTemplateConflictError('Nome já utilizado.').statusCode, 409);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/order-templates.test.ts
```

Expected: FAIL because `api/_db/order-template-repository.ts` does not exist.

- [ ] **Step 3: Add the Drizzle schema**

Add `orderTemplates` after `products` so `orderTemplateItems.sku` can reference it without a circular declaration.
Use a case-insensitive partial unique index for active names.

```ts
export const orderTemplates = pgTable(
  'order_templates',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('order_templates_name_not_blank_check', sql`char_length(btrim(${table.name})) > 0`),
    uniqueIndex('order_templates_active_name_unique')
      .on(sql`lower(btrim(${table.name}))`)
      .where(sql`${table.archived} = false`),
  ]
);

export const orderTemplateItems = pgTable(
  'order_template_items',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => orderTemplates.id, { onDelete: 'cascade' }),
    sku: varchar('sku', { length: 120 })
      .notNull()
      .references(() => products.sku, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.templateId, table.sku],
      name: 'order_template_items_pkey',
    }),
    uniqueIndex('order_template_items_position_unique').on(table.templateId, table.position),
    check('order_template_items_position_non_negative_check', sql`${table.position} >= 0`),
  ]
);
```

- [ ] **Step 4: Generate and inspect migration 0017**

Run:

```bash
npm run db:generate -- --name order_templates
```

Expected: Drizzle creates `drizzle/0017_order_templates.sql`, `drizzle/meta/0017_snapshot.json`, and updates `drizzle/meta/_journal.json`.
Inspect the SQL and confirm it contains both tables, both foreign keys, the composite primary key, the position uniqueness constraint, and the partial `lower(btrim(name)) WHERE archived = false` index.
Do not hand-edit generated metadata.

- [ ] **Step 5: Implement the repository boundary**

Create types using API-facing snake case only at serialization boundaries.
Keep internal records concise.

```ts
export interface OrderTemplateItem {
  sku: string;
  name: string;
  position: number;
}

export interface OrderTemplateRecord {
  id: string;
  name: string;
  archived: boolean;
  items: OrderTemplateItem[];
  created_at: string;
  updated_at: string;
}

export interface OrderTemplateRepository {
  list(): Promise<OrderTemplateRecord[]>;
  get(id: string): Promise<OrderTemplateRecord | null>;
  getForExtraction(id: string): Promise<OrderTemplateRecord>;
  create(input: { name: string; skus: string[] }): Promise<{ id: string }>;
  update(id: string, input: { name: string; skus: string[] }): Promise<{ id: string }>;
  archive(id: string): Promise<{ archived: true }>;
}
```

Export four typed errors with `statusCode` and `expose` fields: input `400`, not found `404`, conflict `409`, and repository `503`.
Implement `normalizeOrderTemplateInput()` with trimmed name, maximum length `255`, one or more trimmed SKUs, maximum SKU length `120`, and duplicate rejection.

In `create()` and `update()`:

1. Lock the existing template row during update.
2. Query all requested products with `inArray(products.sku, skus)`.
3. Reject missing or inactive products with `SKU inexistente ou arquivado: <sku>.`.
4. Insert or update the template and replace all membership rows inside one transaction.
5. Insert membership rows as `{ templateId, sku, position }` using input order.
6. Map PostgreSQL `23505` for `order_templates_active_name_unique` to `Já existe um template de pedido com este nome.`.
7. Log no SQL details and expose no database errors.

Implement `getForExtraction(id)` so a missing row throws `Template de pedido não encontrado.`, an archived template throws `O template de pedido selecionado foi arquivado.`, and any inactive referenced product throws `O template de pedido contém um produto arquivado.`.

- [ ] **Step 6: Extend tests around the repository interface**

Add a memory implementation to the same test file and verify these observable contracts:

```ts
it('creates, updates, lists, archives, and protects active names', async () => {
  const repository = new MemoryOrderTemplateRepository([
    { sku: 'LNC-A', name: 'Lenço A', active: true },
    { sku: 'LNC-B', name: 'Lenço B', active: true },
  ]);
  const created = await repository.create({ name: 'Todos os lenços', skus: ['LNC-A', 'LNC-B'] });
  assert.equal((await repository.list())[0].items[1].sku, 'LNC-B');
  await assert.rejects(
    repository.create({ name: ' todos OS LENÇOS ', skus: ['LNC-A'] }),
    OrderTemplateConflictError
  );
  await repository.update(created.id, { name: 'Pack lenços', skus: ['LNC-B'] });
  assert.deepEqual((await repository.get(created.id))?.items.map((item) => item.sku), ['LNC-B']);
  await repository.archive(created.id);
  assert.deepEqual(await repository.list(), []);
});
```

Also test missing SKU, archived SKU, missing template, archived extraction lookup, and item order.

- [ ] **Step 7: Run focused tests and type checks**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/order-templates.test.ts
npm run type-check
```

Expected: all focused tests pass and TypeScript reports no errors.

- [ ] **Step 8: Commit persistence**

```bash
git add api/_db/schema.ts api/_db/order-template-repository.ts tests/unit/order-templates.test.ts drizzle/0017_order_templates.sql drizzle/meta/0017_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(auto): persist order templates"
```

---

### Task 2: Expose authenticated template CRUD

**Files:**

- Create: `api/_functions/order-templates.ts`
- Modify: `api/[...path].ts:1-100`
- Modify: `scripts/dev-api-server.mjs:1-95`
- Modify: `scripts/app-server.mjs:1-110`
- Modify: `tests/unit/order-templates.test.ts`

**Interfaces:**

- Consumes: `OrderTemplateRepository` from Task 1.
- Produces: `createOrderTemplatesHandler({ repository })` and default `handler`.
- Produces: `GET`, `POST`, `PUT`, and `DELETE` on `/api/order-templates`.

- [ ] **Step 1: Add failing handler tests**

Add a fake repository and event helper to `tests/unit/order-templates.test.ts`.

```ts
function event(method: string, query: Record<string, string> = {}, body?: unknown) {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters: query,
    body: body === undefined ? '' : JSON.stringify(body),
    url: '/api/order-templates',
  };
}
```

Test these exact requests and responses:

- `GET` returns `{ data: [...] }` with status `200`.
- `POST { name, skus }` returns `{ id }` with status `201`.
- `PUT ?id=<id> { name, skus }` returns `{ id }` with status `200`.
- `DELETE ?id=<id>` returns `{ archived: true }` with status `200`.
- Missing IDs return `400`.
- Malformed JSON returns `400`.
- Unsupported methods return `405`.
- Typed repository errors preserve `400`, `404`, and `409`.
- Unknown errors log server-side and return generic `503` Portuguese copy.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/order-templates.test.ts
```

Expected: FAIL because `createOrderTemplatesHandler` does not exist.

- [ ] **Step 3: Implement the handler**

Use dependency injection matching the existing quotation template handler.
Parse only JSON objects.
Pass exact typed values into the repository.

```ts
function json(statusCode: number, payload: object): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function parseBody(event: FunctionEvent): Record<string, unknown> | null {
  try {
    const value = JSON.parse(event.body || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function toInput(input: Record<string, unknown>): { name: string; skus: string[] } {
  return {
    name: String(input.name || ''),
    skus: Array.isArray(input.skus) ? input.skus.map(String) : [],
  };
}

function errorResponse(error: unknown): FunctionResult {
  const typed = error as { statusCode?: number; expose?: boolean; message?: string };
  if (Number.isInteger(typed.statusCode) && typed.expose === true) {
    return json(typed.statusCode!, { error: typed.message || 'Requisição inválida.' });
  }
  console.error('[order-templates] request failed', error instanceof Error ? error.name : typeof error);
  return json(503, { error: 'Não foi possível processar os templates de pedido. Tente novamente.' });
}

export interface OrderTemplatesDependencies {
  repository: OrderTemplateRepository;
}

export function createOrderTemplatesHandler(
  dependencies: OrderTemplatesDependencies = {
    repository: createOrderTemplateRepository(),
  }
): LegacyHandler {
  return async (event) => {
    try {
      if (event.httpMethod === 'GET') {
        return json(200, { data: await dependencies.repository.list() });
      }
      if (event.httpMethod === 'POST') {
        const input = parseBody(event);
        if (!input) return json(400, { error: 'JSON inválido.' });
        return json(201, await dependencies.repository.create(toInput(input)));
      }
      if (event.httpMethod === 'PUT') {
        const id = event.queryStringParameters?.id?.trim();
        if (!id) return json(400, { error: 'ID do template de pedido não informado.' });
        const input = parseBody(event);
        if (!input) return json(400, { error: 'JSON inválido.' });
        return json(200, await dependencies.repository.update(id, toInput(input)));
      }
      if (event.httpMethod === 'DELETE') {
        const id = event.queryStringParameters?.id?.trim();
        if (!id) return json(400, { error: 'ID do template de pedido não informado.' });
        return json(200, await dependencies.repository.archive(id));
      }
      return json(405, { error: 'Método não permitido.' });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
```

Use `String(input.name || '')` and `Array.isArray(input.skus) ? input.skus.map(String) : []` in `toInput()`.
Use `Content-Type: application/json; charset=utf-8`.

- [ ] **Step 4: Register the route in all three dispatch maps**

Add explicit `.js` imports and one route key in:

- `api/[...path].ts`
- `scripts/dev-api-server.mjs`
- `scripts/app-server.mjs`

Use exactly:

```ts
import { handler as orderTemplates } from './_functions/order-templates.js';
```

Use the corresponding `../api/_functions/order-templates.js` path in both scripts.
Add `'order-templates': orderTemplates` to each `ROUTES` object.

- [ ] **Step 5: Run focused and route checks**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/order-templates.test.ts
npm run type-check
```

Expected: all tests pass and all three route imports resolve.

- [ ] **Step 6: Commit the HTTP boundary**

```bash
git add api/_functions/order-templates.ts api/[...path].ts scripts/dev-api-server.mjs scripts/app-server.mjs tests/unit/order-templates.test.ts
git commit -m "feat(api): manage order templates"
```

---

### Task 3: Apply templates during extraction

**Files:**

- Modify: `api/_functions/extract.ts:58-388`
- Modify: `tests/unit/extract-rules.test.ts`
- Modify: `tests/unit/extract-handler.test.ts`

**Interfaces:**

- Consumes: `OrderTemplateRepository.getForExtraction(id)` from Task 1.
- Produces: `applyOrderTemplate(orders, template)` pure function.
- Produces: `createExtractHandler({ extractOrders, orderTemplates })` while preserving exported `handler`.
- Extends: `/api/extract` request body with optional `orderTemplateId: string`.

- [ ] **Step 1: Write failing pure transformation tests**

Add tests to `tests/unit/extract-rules.test.ts`.

```ts
import { applyOrderTemplate } from '../../api/_functions/extract.js';

test('order template expands unique quantities across ordered SKUs in one order', () => {
  const orders = [{
    nome: 'Andrei B.',
    email: 'andrei@gmail.com',
    telefone: '21999999999',
    urgente: false,
    origem: '',
    cnpj: null,
    endereco: {},
    items: [
      { item_code: 'IGNORAR', qty: 300 },
      { item_code: 'OUTRO', qty: 500 },
      { item_code: 'REPETIDO', qty: 300 },
    ],
  }];
  const template = {
    id: 'pack-id',
    name: 'Pack',
    archived: false,
    created_at: '2026-08-11T00:00:00.000Z',
    updated_at: '2026-08-11T00:00:00.000Z',
    items: [
      { sku: 'SKU-A', name: 'A', position: 0 },
      { sku: 'SKU-B', name: 'B', position: 1 },
    ],
  };
  assert.deepEqual(applyOrderTemplate(orders, template)[0].items, [
    { item_code: 'SKU-A', qty: 300 },
    { item_code: 'SKU-B', qty: 300 },
    { item_code: 'SKU-A', qty: 500 },
    { item_code: 'SKU-B', qty: 500 },
  ]);
});
```

Add a second test proving quantity `10` becomes `30` and no valid quantity throws `Nenhuma quantidade válida identificada para o template.`.

- [ ] **Step 2: Write failing handler tests**

Extend `tests/unit/extract-handler.test.ts` with an injected extractor and fake repository.
Test that `orderTemplateId` triggers one lookup, passes template context into the prompt/extractor seam, ignores returned product codes, and returns one expanded order.
Test missing and archived templates using typed `404` and `409` errors.
Keep the existing real OpenRouter request normalization test unchanged for the no-template path.

- [ ] **Step 3: Run extraction tests and verify RED**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/extract-rules.test.ts tests/unit/extract-handler.test.ts
```

Expected: FAIL because `applyOrderTemplate` and `createExtractHandler` do not exist.

- [ ] **Step 4: Add template context to the system prompt**

Extend `buildSystemPrompt()` with an optional context:

```ts
interface ExtractionOrderTemplate {
  id: string;
  name: string;
  items: Array<{ sku: string; name: string; position: number }>;
}
```

Append instructions only when this context exists:

```text
TEMPLATE DE PEDIDO SELECIONADO: Pack
SKUs autorizados, na ordem:
- SKU-A
- SKU-B

Ignore qualquer produto ou SKU mencionado no pedido.
Extraia as quantidades solicitadas e use apenas os SKUs autorizados nos itens.
Aplique cada quantidade a todos os SKUs autorizados.
```

The server-side transformation remains authoritative even if the model violates these instructions.

- [ ] **Step 5: Implement deterministic expansion**

Export `applyOrderTemplate()`.
For each order, collect finite positive quantities from returned items, convert values below `30` to `30`, deduplicate while preserving first appearance, and flatten quantity first then template item position.
Never retain model-returned `item_code` values.
Throw a public `422` extraction error when an order has no valid quantity.

- [ ] **Step 6: Add an injectable handler seam**

Define response helpers and dependencies without changing the default production behavior.

```ts
function json(statusCode: number, payload: object): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function extractionErrorResponse(error: unknown): FunctionResult {
  const typed = error as {
    statusCode?: number;
    expose?: boolean;
    logMessage?: string;
    message?: string;
  };
  const isPublic =
    Number.isInteger(typed.statusCode) &&
    (typed.expose === true || typeof typed.logMessage === 'string');
  console.error('[extract]', typed.logMessage || typed.message || error);
  return json(isPublic ? typed.statusCode! : 500, {
    error: isPublic && typed.message ? typed.message : 'Erro interno na extração.',
  });
}

interface ExtractHandlerDependencies {
  extractOrders: typeof extractWithOpenRouter;
  orderTemplates: Pick<OrderTemplateRepository, 'getForExtraction'>;
}

export function createExtractHandler(
  dependencies: ExtractHandlerDependencies = {
    extractOrders: extractWithOpenRouter,
    orderTemplates: createOrderTemplateRepository(),
  }
): LegacyHandler {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido.' });
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.body || '{}') as Record<string, unknown>;
    } catch {
      return json(400, { error: 'JSON inválido' });
    }
    try {
      const templateId = typeof payload.orderTemplateId === 'string'
        ? payload.orderTemplateId.trim()
        : '';
      const template = templateId
        ? await dependencies.orderTemplates.getForExtraction(templateId)
        : undefined;
      const orders = await dependencies.extractOrders(
        payload.text as string | undefined,
        payload.imageBase64 as string | undefined,
        payload.imageMimeType as string | undefined,
        payload.rules as string | undefined,
        payload.existingItems as Array<{ item_code: string; qty: number }> | undefined,
        template
      );
      return json(200, { orders: template ? applyOrderTemplate(orders, template) : orders });
    } catch (error) {
      return extractionErrorResponse(error);
    }
  };
}

export const handler = createExtractHandler();
```

Map typed template errors through their public status and message.
Keep unknown failures logged under `[extract]` and preserve the current generic response behavior.
Do not initialize or query PostgreSQL when `orderTemplateId` is absent.

- [ ] **Step 7: Run extraction regressions**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/extract-rules.test.ts tests/unit/extract-handler.test.ts
```

Expected: selected-template tests pass, missing/archived errors stay public, and the existing no-template OpenRouter test still passes.

- [ ] **Step 8: Commit extraction behavior**

```bash
git add api/_functions/extract.ts tests/unit/extract-rules.test.ts tests/unit/extract-handler.test.ts
git commit -m "feat(auto): apply templates during extraction"
```

---

### Task 4: Add the `/auto` selector and manager modal

**Files:**

- Create: `src/lib/orderTemplatesApi.ts`
- Create: `src/components/OrderTemplateManager.tsx`
- Modify: `src/pages/AutoQuotePage.tsx:74-260,404-420,599-705`
- Modify: `tests/operational-mode.spec.js:88-235`

**Interfaces:**

- Consumes: `/api/order-templates`, `/api/products`, and optional `/api/extract.orderTemplateId`.
- Produces: `OrderTemplate`, `listOrderTemplates`, `createOrderTemplate`, `updateOrderTemplate`, and `archiveOrderTemplate`.
- Produces: `OrderTemplateManager` modal with `open`, `templates`, `onClose`, and `onChanged` props.

- [ ] **Step 1: Add a failing Playwright scenario**

Extend `Auto preserves the extraction-to-quotation PostgreSQL UI contract` or add a neighboring test with method-aware route mocks.
The initial `GET /api/order-templates` response is:

```js
{
  data: [{
    id: 'pack-id',
    name: 'Pack de produtos',
    archived: false,
    items: [
      { sku: 'SKU-A', name: 'Produto A', position: 0 },
      { sku: 'SKU-B', name: 'Produto B', position: 1 },
    ],
    created_at: '2026-08-11T00:00:00.000Z',
    updated_at: '2026-08-11T00:00:00.000Z',
  }],
}
```

Capture the `/api/extract` request and return one order with the four expanded lines.
Assert:

```js
await expect(page.getByLabel('Template de pedido')).toHaveValue('');
await page.getByLabel('Template de pedido').selectOption('pack-id');
await page.locator('textarea').first().fill('Andrei B. andrei@gmail.com 21999999999 300 e 500 unidades');
await page.getByRole('button', { name: /Extrair/i }).click();
expect(extractRequest.orderTemplateId).toBe('pack-id');
await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible();
await page.getByRole('button', { name: 'Limpar' }).click();
await expect(page.getByLabel('Template de pedido')).toHaveValue('');
```

Add a manager flow that clicks `Gerenciar`, creates `Todos os lenços`, searches `LNC`, chooses two mocked catalog products, saves, and asserts POST body `{ name: 'Todos os lenços', skus: ['LNC-A', 'LNC-B'] }`.
Add an API failure case proving the textarea and `Extrair` remain usable when template loading fails.

- [ ] **Step 2: Run the Playwright test and verify RED**

Run:

```bash
npx playwright test tests/operational-mode.spec.js --grep "order template|PostgreSQL UI contract"
```

Expected: FAIL because the selector and manager do not exist.

- [ ] **Step 3: Add the typed frontend API client**

Create `src/lib/orderTemplatesApi.ts`.

```ts
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

export interface OrderTemplateItem {
  sku: string;
  name: string;
  position: number;
}

export interface OrderTemplate {
  id: string;
  name: string;
  archived: boolean;
  items: OrderTemplateItem[];
  created_at: string;
  updated_at: string;
}

export function listOrderTemplates(): Promise<{ data: OrderTemplate[] }> {
  return apiGet('/order-templates');
}

export function createOrderTemplate(input: { name: string; skus: string[] }) {
  return apiPost<{ id: string }>('/order-templates', input);
}

export function updateOrderTemplate(id: string, input: { name: string; skus: string[] }) {
  return apiPut<{ id: string }>(`/order-templates?id=${encodeURIComponent(id)}`, input);
}

export function archiveOrderTemplate(id: string) {
  return apiDelete<{ archived: true }>(`/order-templates?id=${encodeURIComponent(id)}`);
}
```

- [ ] **Step 4: Build the focused manager modal**

Create `OrderTemplateManager.tsx` instead of growing the existing 968-line page further.
Use existing `Button`, `Input`, `ConfirmDialog`, `searchProducts()`, and Lucide icons.
Do not add a dialog dependency.

Required states:

- Closed returns `null`.
- List view shows existing templates and `Novo template`.
- Edit view contains `Nome`, product search, selected ordered items, `Salvar`, and `Cancelar`.
- Archive requires `ConfirmDialog`.
- Search starts at 2 characters and ignores `pricing_available === false` products.
- Selecting a duplicate SKU does nothing.
- Save errors appear inside the modal and preserve form state.
- Successful create, update, or archive awaits `onChanged()` before returning to list view.
- Root panel uses `role="dialog"`, `aria-modal="true"`, and an accessible title.
- Escape and backdrop close only when no save is running.

Use these props:

```ts
interface OrderTemplateManagerProps {
  open: boolean;
  templates: OrderTemplate[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}
```

- [ ] **Step 5: Integrate state into `AutoQuotePage`**

Add states for `orderTemplates`, `orderTemplateId`, `orderTemplatesLoading`, `orderTemplatesError`, and `orderTemplateManagerOpen`.
Add one `loadOrderTemplates()` callback and call it on mount.
On reload, clear `orderTemplateId` if that ID no longer exists.

Insert this compact row directly above the textarea:

```tsx
<div className="flex items-end gap-2">
  <label className="min-w-0 flex-1 text-xs font-medium text-fg-muted">
    Template de pedido
    <select
      aria-label="Template de pedido"
      value={orderTemplateId}
      onChange={(event) => setOrderTemplateId(event.target.value)}
      disabled={extracting || orderTemplatesLoading}
      className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
    >
      <option value="">Nenhum</option>
      {orderTemplates.map((template) => (
        <option key={template.id} value={template.id}>{template.name}</option>
      ))}
    </select>
  </label>
  <Button type="button" variant="outline" size="sm" onClick={() => setOrderTemplateManagerOpen(true)}>
    Gerenciar
  </Button>
</div>
```

Show template loading errors as a compact warning that does not disable the textarea or extraction button.
Render `OrderTemplateManager` once near the page root.

Extend the extraction request only when selected:

```ts
{
  text: text || null,
  imageBase64: imageData?.base64 || null,
  imageMimeType: imageData?.mime || null,
  ...(orderTemplateId ? { orderTemplateId } : {}),
}
```

Add `setOrderTemplateId('')` to `handleReset()`.
Do not persist the selection to local storage.

- [ ] **Step 6: Run focused UI verification**

Run:

```bash
npm run build
npx playwright test tests/operational-mode.spec.js --grep "order template|PostgreSQL UI contract"
```

Expected: build succeeds and focused Playwright tests pass.

- [ ] **Step 7: Inspect the UI manually**

Start the existing local API and Vite servers.
Open `/#/auto` at desktop and mobile widths.
Verify the selector and `Gerenciar` button align without narrowing the textarea, the modal stays within the viewport, long product names wrap, errors do not shift actions off-screen, and keyboard focus reaches every control.
Fix visible spacing, overflow, contrast, and focus issues before committing.

- [ ] **Step 8: Commit the UI flow**

```bash
git add src/lib/orderTemplatesApi.ts src/components/OrderTemplateManager.tsx src/pages/AutoQuotePage.tsx tests/operational-mode.spec.js
git commit -m "feat(auto): manage and select order templates"
```

---

### Task 5: Run complete regression verification

**Files:**

- Verify only.
- Modify only files already listed when a failing check identifies a feature regression.

**Interfaces:**

- Consumes: all deliverables from Tasks 1 through 4.
- Produces: verified feature with no known lint, type, unit, build, or E2E failures.

- [ ] **Step 1: Run proactive diagnostics on edited source files**

Run `lsp_diagnostics` for:

- `api/_db/schema.ts`
- `api/_db/order-template-repository.ts`
- `api/_functions/order-templates.ts`
- `api/_functions/extract.ts`
- `src/lib/orderTemplatesApi.ts`
- `src/components/OrderTemplateManager.tsx`
- `src/pages/AutoQuotePage.tsx`

Expected: no blocking diagnostics.

- [ ] **Step 2: Run all unit tests**

Run:

```bash
npm run test:unit
```

Expected: zero failed tests.

- [ ] **Step 3: Run full project checks**

Run:

```bash
npm run check
```

Expected: ESLint, API type checking, Tailwind content validation, and production build all pass.

- [ ] **Step 4: Run the complete E2E suite**

Run:

```bash
npm run test:e2e
```

Expected: zero failed Playwright tests.

- [ ] **Step 5: Verify migration and working tree**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted feature files.
The pre-existing untracked `template-simple.html` may remain and must not be staged.

- [ ] **Step 6: Review requirement coverage**

Confirm each acceptance item against tests or manual evidence:

- Shared templates persist in PostgreSQL.
- Modal creates, edits, and archives without leaving `/auto`.
- Catalog search accepts only active valid products.
- Initial and reset selection are `Nenhum`.
- Selected template ignores text products.
- Every quantity applies to every template SKU in one draft.
- No-template extraction remains unchanged.
- Errors remain in Portuguese and expose no internals.

- [ ] **Step 7: Close verification**

If a check fails, fix the owning feature file, rerun that failed check, then repeat Steps 1 through 6.
After all checks pass, inspect `git status --short` and commit only intentional tracked fixes with `fix(auto): address template regressions`.
If no fixes were needed, do not create an empty commit.
