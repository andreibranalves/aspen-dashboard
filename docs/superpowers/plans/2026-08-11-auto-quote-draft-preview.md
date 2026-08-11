# Auto Quote Draft HTML Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Visualizar` button to each valid Auto quote draft that opens the current quotation HTML template in a new tab without persisting data.

**Architecture:** Extend the existing `/api/quotation-preview` handler with a form-encoded `POST` path for unsaved drafts while preserving its saved-quotation `GET` behavior. Build the template view model from the edited draft, resolve the selected current template version, and reuse `renderQuotationTemplate`. Submit the preview with a native hidden form so the browser opens the HTML response as a top-level document and applies the endpoint's existing security headers.

**Tech Stack:** React 19, TypeScript, Node.js ESM serverless handlers, Handlebars quotation templates, Node test runner, Playwright.

## Global Constraints

- Open preview in a new browser tab.
- Return HTML only and reuse the existing quotation template renderer.
- Do not create or update any quotation, client, revision, ERPNext record, or database row.
- Preserve the existing `GET /api/quotation-preview?id=...` contract.
- Keep user-facing errors in Brazilian Portuguese and do not expose internal errors.
- Preserve the existing HTML security headers and template script prohibition.
- Add no dependencies.
- Keep local ESM imports explicit with `.js`.

---

## File Map

- Modify `api/_functions/quotation-preview.ts` to parse draft preview requests, validate draft data, build the template view model, resolve the selected template, and return secured HTML.
- Create `tests/unit/quotation-preview.test.ts` to cover valid draft preview, invalid draft input, no persistence, and saved-preview regression behavior.
- Modify `src/pages/AutoQuotePage.tsx` to share creation payload construction and submit draft preview through a native form.
- Modify `src/components/SplitResultCard.tsx` to expose and render the preview action.
- Modify `tests/operational-mode.spec.js` to verify the visible Auto flow and new-tab request.

### Task 1: Render an unsaved draft through the existing preview endpoint

**Files:**

- Modify: `api/_functions/quotation-preview.ts:1-140`
- Create: `tests/unit/quotation-preview.test.ts`

**Interfaces:**

- Consumes: Existing `renderQuotationTemplate(template, viewModel)`, `quotationTemplateFromVersion(version)`, `readCurrentQuotationTemplateVersion(db, selection)`, `getDatabase()`, and `HTML_SECURITY_HEADERS` behavior.
- Produces: `POST /api/quotation-preview` accepting form field `payload` containing JSON shaped as `{ extracted: DraftPreviewInput }` and returning `text/html; charset=utf-8`.
- Produces: Injectable dependency `resolveDraftTemplate?: (key: string) => Promise<QuotationTemplate | null>` for unit tests without database access.

- [ ] **Step 1: Write failing handler tests**

Create `tests/unit/quotation-preview.test.ts` with deterministic fixtures and no database:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotationPreviewHandler } from '../../api/_functions/quotation-preview.js';
import { getQuotationTemplate } from '../../api/_functions/lib/quotation-templates.js';

process.env.CRM_CORE_QUOTES_ENABLED = 'true';
process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';

const template = getQuotationTemplate('padrao')!;
const extracted = {
  nome: 'Cliente Preview',
  email: 'preview@example.com',
  telefone: '11999999999',
  cnpj: '12.345.678/0001-90',
  endereco: { endereco: 'Rua A', numero: '10', municipio: 'São Paulo', uf: 'SP' },
  template_key: 'padrao',
  prazo_producao: '15 dias úteis',
  items: [
    {
      item_code: 'SKU-001',
      item_name: 'Produto Preview',
      qty: 2,
      rate: 12.5,
      manual_rate: false,
    },
  ],
};

function post(value: unknown) {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    queryStringParameters: {},
    body: new URLSearchParams({ payload: JSON.stringify(value) }).toString(),
  } as any;
}

test('renders an unsaved quotation draft as secured HTML without loading a snapshot', async () => {
  let snapshotReads = 0;
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => { snapshotReads += 1; return null; } },
    resolveDraftTemplate: async (key) => key === template.key ? template : null,
    now: () => new Date('2026-08-11T12:00:00.000Z'),
  });

  const response = await handler(post({ extracted }));

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'text/html; charset=utf-8');
  assert.match(response.headers?.['Content-Security-Policy'] || '', /script-src 'none'/);
  assert.match(response.body || '', /Cliente Preview/);
  assert.match(response.body || '', /Produto Preview/);
  assert.match(response.body || '', /25,00/);
  assert.equal(snapshotReads, 0);
});

test('rejects draft preview without a client name', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
  });
  const response = await handler(post({ extracted: { ...extracted, nome: '' } }));
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /nome do cliente/i);
});

test('rejects draft preview without valid items', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
  });
  const response = await handler(post({ extracted: { ...extracted, items: [] } }));
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /item válido/i);
});

test('preserves GET preview snapshot loading', async () => {
  let requestedId = '';
  const handler = createQuotationPreviewHandler({
    repository: {
      get: async (id: string) => {
        requestedId = id;
        return null;
      },
    },
    resolveDraftTemplate: async () => template,
  });
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { id: 'ORC-1' },
  } as any);
  assert.equal(response.statusCode, 404);
  assert.equal(requestedId, 'ORC-1');
});
```

- [ ] **Step 2: Run tests and confirm the new contract fails**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-preview.test.ts
```

Expected: TypeScript compilation fails because `resolveDraftTemplate` and `now` are not accepted, or the POST request returns `405`.

- [ ] **Step 3: Add draft input parsing and validation**

In `api/_functions/quotation-preview.ts`, extend dependencies and add focused local types and helpers:

```ts
interface DraftPreviewItem {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  manual_rate: boolean;
}

interface DraftPreviewInput {
  nome: string;
  email?: string | null;
  telefone?: string | null;
  cnpj?: string;
  endereco?: Record<string, unknown>;
  template_key?: string;
  prazo_producao?: string;
  items: DraftPreviewItem[];
}

export interface QuotationPreviewDependencies {
  repository?: {
    get(id: string, templateVersionId?: string): ReturnType<ReturnType<typeof createQuotationTemplateRepository>['get']>;
  };
  renderPdf?: (html: string) => Promise<Buffer>;
  resolveDraftTemplate?: (key: string) => Promise<QuotationTemplate | null>;
  now?: () => Date;
}
```

Add `parseDraftPreview(event)` that reads `new URLSearchParams(event.body || '').get('payload')`, parses JSON, requires an object `extracted`, trims `nome`, filters items to non-empty SKU with finite `qty > 0` and finite `rate >= 0`, and throws `QuotationTemplateResolutionError` with status `400` for these exact cases:

```text
Payload de visualização inválido.
Informe o nome do cliente antes de visualizar.
Adicione ao menos um item válido antes de visualizar.
Template do orçamento inválido.
```

Do not accept template source from the request.
Only accept `template_key` as a selection key.

- [ ] **Step 4: Build the draft template view model**

Add `draftPreviewViewModel(extracted, now)` in `quotation-preview.ts`.
Use `quote_number: 'Pré-visualização'`, `revision: 1`, `status: 'rascunho'`, the current UTC date, a 15-day validity date, and the edited client fields.
Map each item to the aliases used by current templates:

```ts
const items = extracted.items.map((item, position) => {
  const lineTotal = item.qty * item.rate;
  return {
    id: `preview-${position + 1}`,
    position,
    sku: item.item_code,
    item_code: item.item_code,
    nome: item.item_name || item.item_code,
    name: item.item_name || item.item_code,
    descricao: '',
    description: '',
    unidade: '',
    unit: '',
    qty: item.qty,
    quantidade: item.qty,
    quantity: String(item.qty),
    suggested_unit_price: item.rate,
    preco_sugerido: item.rate,
    applied_unit_price: item.rate,
    preco_aplicado: item.rate,
    unit_price: item.rate,
    line_total: lineTotal,
    total_linha: lineTotal,
    manual_rate: item.manual_rate,
    display: {
      unit_price: formatQuotationCurrency(item.rate),
      line_total: formatQuotationCurrency(lineTotal),
    },
  };
});
```

Set `subtotal` and `total` to the item sum, `freight` and `frete` to `0`, populate both `client` and `client_snapshot`, both `items` and `items_snapshot`, both `terms` and `terms_snapshot`, and the existing `display` fields through `formatQuotationCurrency` and `formatQuotationDate`.
Populate `secoes.prazo_producao.value` from `prazo_producao` and leave payment and general-condition HTML empty.

- [ ] **Step 5: Resolve the selected template and return secured HTML**

Create the default resolver from `getDatabase()` and `readCurrentQuotationTemplateVersion()`:

```ts
async function resolveCurrentDraftTemplate(key: string): Promise<QuotationTemplate | null> {
  const selected = await readCurrentQuotationTemplateVersion(getDatabase(), key);
  if (!selected) return null;
  return quotationTemplateFromVersion({
    source: selected.version.source,
    sourceHash: selected.version.sourceHash,
    template: { key: selected.model.key, name: selected.model.name },
  });
}
```

At the start of the handler, branch on `POST` before the existing GET-only validation:

```ts
if (event.httpMethod === 'POST') {
  const extracted = parseDraftPreview(event);
  const template = await resolveDraftTemplate(extracted.template_key || 'padrao');
  if (!template) return json(400, { error: 'Template do orçamento inválido.' });
  const html = renderQuotationTemplate(template, draftPreviewViewModel(extracted, now()));
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...HTML_SECURITY_HEADERS,
      'X-Quotation-Template-Key': template.key,
      'X-Quotation-Template-Version': 'preview',
      'X-Quotation-Template-Hash': template.hash,
    },
    body: html,
  };
}
```

Keep the existing GET branch byte-for-byte equivalent after the method split.
Route all exposed validation failures through structured `400` responses and all unexpected failures through `safeError`.

- [ ] **Step 6: Run focused API tests**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-preview.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 7: Run existing quotation preview regressions**

Run:

```bash
TZ=UTC node --test tests/unit/public-quotation.test.ts tests/unit/quotation-templates-core.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit the backend contract**

```bash
git add api/_functions/quotation-preview.ts tests/unit/quotation-preview.test.ts
git commit -m "feat(api): preview unsaved quotations"
```

### Task 2: Add the Auto draft preview action and verify the new-tab flow

**Files:**

- Modify: `src/pages/AutoQuotePage.tsx:240-335,880-940`
- Modify: `src/components/SplitResultCard.tsx:30-85,170-190,540-635`
- Modify: `tests/operational-mode.spec.js:87-165`

**Interfaces:**

- Consumes: `POST /api/quotation-preview` form field `payload` from Task 1.
- Produces: `buildQuotePayload(draft: Draft): { extracted: Record<string, unknown> }` shared by creation and preview.
- Produces: `onPreviewQuote: (draftIdx: number) => void` on `SplitResultCardProps`.

- [ ] **Step 1: Extend the operational E2E test with a failing preview assertion**

In the existing `Auto preserves the extraction-to-quotation PostgreSQL UI contract` test, capture preview requests without changing the existing creation assertion:

```js
/** @type {any} */
let previewPayload = null;
await page.route('**/api/quotation-preview', async (route) => {
  const form = new URLSearchParams(route.request().postData() || '');
  previewPayload = JSON.parse(form.get('payload') || '{}');
  await route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body>Cliente Core - Produto Core</body></html>',
  });
});
```

After extraction, assert preview opens a popup and does not create a quotation:

```js
const popupPromise = page.waitForEvent('popup');
await page.getByRole('button', { name: 'Visualizar' }).click();
const popup = await popupPromise;
await expect(popup.getByText('Cliente Core - Produto Core')).toBeVisible();
expect(previewPayload?.extracted).toMatchObject({
  nome: 'Cliente Core',
  template_key: 'padrao',
  items: [{
    item_code: 'CORE-001',
    item_name: 'Produto Core',
    qty: 10,
    rate: 12,
    manual_rate: false,
  }],
});
expect(quoteRequest).toBeNull();
```

Then keep the existing click on `Criar orçamento` and its payload assertion.
Add a second extraction fixture with `items: []` and assert both `Visualizar` and `Criar orçamento` are disabled.

- [ ] **Step 2: Run the E2E test and verify it fails**

Run:

```bash
npx playwright test tests/operational-mode.spec.js
```

Expected: FAIL because no `Visualizar` button exists.

- [ ] **Step 3: Share quotation payload construction in AutoQuotePage**

Add a top-level helper near the page-local interfaces:

```ts
function buildQuotePayload(draft: Draft) {
  return {
    extracted: {
      nome: draft.edited.nome,
      email: draft.edited.email || null,
      telefone: draft.edited.telefone || null,
      urgente: draft.edited.urgente,
      origem: draft.edited.origem || undefined,
      cnpj: draft.edited.cnpj || undefined,
      endereco: draft.edited.endereco || undefined,
      items: draft.edited.items
        .filter((item) => item.item_code && item.qty > 0)
        .map((item) => ({
          item_code: item.item_code,
          item_name: item.item_name || '',
          qty: item.qty,
          rate: item.rate,
          manual_rate: item._rateManual === true,
        })),
      prazo_producao: draft.edited.prazo_producao || undefined,
      ...(draft.edited.template_key ? { template_key: draft.edited.template_key } : {}),
    },
  };
}
```

Replace the inline payload inside `createSingleQuote` with `buildQuotePayload(draft)` so creation and preview cannot drift.

- [ ] **Step 4: Submit preview through a native hidden form**

Add `previewSingleQuote` to `AutoQuotePage`:

```ts
const previewSingleQuote = useCallback((draftIndex: number) => {
  const draft = drafts.find((candidate) => candidate.index === draftIndex);
  if (!draft) return;
  const form = document.createElement('form');
  const payload = document.createElement('input');
  form.method = 'POST';
  form.action = '/api/quotation-preview';
  form.target = '_blank';
  form.style.display = 'none';
  payload.type = 'hidden';
  payload.name = 'payload';
  payload.value = JSON.stringify(buildQuotePayload(draft));
  form.append(payload);
  document.body.append(form);
  form.submit();
  form.remove();
}, [drafts]);
```

Pass `onPreviewQuote={previewSingleQuote}` to every `SplitResultCard`.
The native form is required here because it opens the response as a top-level document and preserves the API response's CSP, referrer policy, and content-type headers.

- [ ] **Step 5: Render the preview button with the creation validity rule**

Extend `SplitResultCardProps` and the component arguments:

```ts
onPreviewQuote: (draftIdx: number) => void;
```

Define one validity value after `validItems`:

```ts
const canCreate = validItems > 0 && Boolean(draft.edited.nome?.trim());
```

Use it for both actions and render preview before creation:

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => onPreviewQuote(draft.index)}
  disabled={isProcessing || !canCreate}
>
  <Eye size={13} />
  Visualizar
</Button>
<Button
  size="sm"
  onClick={() => onCreateQuote(draft.index)}
  disabled={isProcessing || !canCreate}
>
  <Send size={13} />
  Criar orçamento
</Button>
```

Import `Eye` from the already-installed `lucide-react` package.
Do not show `Visualizar` after the quotation reaches `done`; the existing `Abrir orçamento` action remains unchanged.

- [ ] **Step 6: Run the focused E2E test**

Run:

```bash
npx playwright test tests/operational-mode.spec.js
```

Expected: all tests pass, the popup contains the intercepted HTML, preview payload matches the edited draft, and no creation request occurs before `Criar orçamento` is clicked.

- [ ] **Step 7: Run proactive diagnostics**

Run LSP diagnostics on:

```text
api/_functions/quotation-preview.ts
src/pages/AutoQuotePage.tsx
src/components/SplitResultCard.tsx
tests/unit/quotation-preview.test.ts
tests/operational-mode.spec.js
```

Expected: no errors.

- [ ] **Step 8: Run repository verification**

Run:

```bash
npm run lint
npm run type-check
npm run build
npm run test:unit
```

Expected: every command exits `0`.

- [ ] **Step 9: Commit the Auto UI flow**

```bash
git add src/pages/AutoQuotePage.tsx src/components/SplitResultCard.tsx tests/operational-mode.spec.js
git commit -m "feat(auto): preview quotation drafts"
```

- [ ] **Step 10: Perform final manual verification**

Start the local API and Vite application, navigate to `/#/auto`, extract one valid order, edit its customer or item data, click `Visualizar`, and verify the new tab reflects the edited values.
Confirm the Auto card remains uncreated until `Criar orçamento` is clicked.
Confirm the existing saved quotation preview still opens from a quotation detail page.
