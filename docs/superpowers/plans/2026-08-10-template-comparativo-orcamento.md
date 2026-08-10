# Template comparativo de orçamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o layout comparativo recebido como template selecionável do CRM, com matriz de preços derivada somente do snapshot imutável do orçamento.

**Architecture:** O HTML será convertido para Handlebars seguro e registrado como o modelo built-in `comparativo` em `api/_functions/lib/quotation-templates.ts`.
A projeção `comparison` será calculada em `quotationSnapshotViewModel` a partir das linhas salvas, e o seed de templates existente propagará o modelo para o banco.
O fluxo existente de seleção, preview, PDF e link público continuará sendo reutilizado sem mudanças de rota ou dependência do Frappe.

**Tech Stack:** Node.js ESM, TypeScript, Handlebars, Drizzle ORM, Node test runner, Chromium/Puppeteer e Vite.

## Global Constraints

- As faixas suportadas são `30`, `100`, `300`, `500` e `1000`, com rótulos `30 - 99`, `100 - 299`, `300 - 499`, `500 - 999` e `1000+`.
- A matriz usa somente as linhas da revisão imutável e não consulta preços atuais.
- A faixa usa `preco_minimo_faixa` válido ou o fallback derivado da quantidade.
- Duplicatas do mesmo produto e faixa usam a última linha salva.
- O modelo não se torna padrão e não altera revisões históricas.
- Contatos, dados bancários, prazo e condições fixas permanecem iguais ao arquivo recebido.
- O runtime não executa Jinja, `doc`, `frappe.db`, macros ou mutações de template.
- O renderer continua limitado aos helpers Handlebars `if` e `each` e ao escape padrão.
- Não adicionar dependências.
- Não alterar arquivos gerados automaticamente.

---

## File Map

- Modify: `api/_db/quotation-template-repository.ts` to build the snapshot-backed `comparison` projection.
- Modify: `api/_functions/lib/quotation-templates.ts` to register the converted built-in source and preview fixture.
- Modify: `tests/unit/quotation-templates-core.test.js` to cover matrix construction, rendering and source safety.
- Modify: `tests/unit/quotation-template-migration.test.ts` to assert that the real seed contains `comparativo` and keeps one default.
- Keep unchanged: `template-comparison.html` as the original Frappe/Jinja reference supplied by the user.
- Create: no new runtime module and no new dependency.

## Task 1: Add failing coverage for the comparison view model

**Files:**

- Modify: `tests/unit/quotation-templates-core.test.js` near the existing snapshot model tests.
- Test: `tests/unit/quotation-templates-core.test.js`.

**Interfaces:**

- Consumes: `quotationSnapshotViewModel(snapshot)`.
- Produces: assertions for `model.comparison.brackets` and `model.comparison.products` used by the converted template.

- [ ] **Step 1: Add a fixture with repeated products and explicit tiers.**

Use the existing `snapshot` fixture and clone its item rows so the test remains independent of database state.

```js
const comparisonSnapshot = {
  ...snapshot,
  items: [
    {
      ...snapshot.items[0],
      position: 1,
      produtoSku: 'SKU-A',
      productSku: 'SKU-A',
      produtoNome: 'Camiseta',
      produtoDescricao: 'Algodão',
      precoMinimoFaixa: '30',
      precoAplicado: '10.00',
      totalLinha: '300.00',
    },
    {
      ...snapshot.items[1],
      position: 2,
      produtoSku: 'SKU-A',
      productSku: 'SKU-A',
      produtoNome: 'Camiseta',
      produtoDescricao: 'Algodão',
      precoMinimoFaixa: '100',
      precoAplicado: '8.00',
      totalLinha: '800.00',
    },
    {
      ...snapshot.items[1],
      position: 3,
      produtoSku: 'SKU-A',
      productSku: 'SKU-A',
      produtoNome: 'Camiseta',
      produtoDescricao: 'Algodão',
      precoMinimoFaixa: '100',
      precoAplicado: '7.50',
      totalLinha: '750.00',
    },
    {
      ...snapshot.items[1],
      position: 4,
      produtoSku: 'SKU-B',
      productSku: 'SKU-B',
      produtoNome: 'Caneca',
      produtoDescricao: '',
      precoMinimoFaixa: null,
      quantidade: '500.000',
      precoAplicado: '5.00',
      totalLinha: '2500.00',
    },
  ],
};
```

- [ ] **Step 2: Write the failing projection assertions.**

```js
test('snapshot model builds the saved comparison matrix by tier', () => {
  const comparison = quotationSnapshotViewModel(comparisonSnapshot).comparison;

  assert.deepEqual(
    comparison.brackets.map(({ minimum, label }) => ({ minimum, label })),
    [
      { minimum: 30, label: '30 - 99' },
      { minimum: 100, label: '100 - 299' },
      { minimum: 500, label: '500 - 999' },
    ],
  );
  assert.deepEqual(comparison.products.map(({ name, description }) => ({ name, description })), [
    { name: 'Camiseta', description: 'Algodão' },
    { name: 'Caneca', description: '' },
  ]);
  assert.equal(comparison.products[0].prices[1].display, 'R$ 7,50');
  assert.equal(comparison.products[0].prices[1].available, true);
  assert.equal(comparison.products[1].prices[0].available, false);
});
```

The duplicate `SKU-A` row at tier `100` must make `R$ 7,50` win.

- [ ] **Step 3: Run the focused test and confirm it fails for the missing projection.**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-templates-core.test.js`

Expected: FAIL because `model.comparison` is not present yet.

- [ ] **Step 4: Commit the red test.**

```bash
git add tests/unit/quotation-templates-core.test.js
git commit -m "test: specify comparison quote matrix"
```

## Task 2: Implement the snapshot-backed comparison projection

**Files:**

- Modify: `api/_db/quotation-template-repository.ts` near `formatQuantityForDisplay` and `quotationSnapshotViewModel`.
- Test: `tests/unit/quotation-templates-core.test.js` from Task 1.

**Interfaces:**

- Consumes: raw revision item rows from `QuotationTemplateSnapshot.items`.
- Produces: `comparison: { brackets, products }` on the object returned by `quotationSnapshotViewModel`.

- [ ] **Step 1: Add the fixed bracket metadata and internal projection helper.**

Use an internal helper to avoid exposing a new public API.

```ts
const COMPARISON_BRACKETS = [
  { minimum: 30, label: '30 - 99' },
  { minimum: 100, label: '100 - 299' },
  { minimum: 300, label: '300 - 499' },
  { minimum: 500, label: '500 - 999' },
  { minimum: 1000, label: '1000+' },
] as const;

function comparisonMinimum(tier: string, quantity: string): number {
  const explicit = Number(tier);
  if (COMPARISON_BRACKETS.some((bracket) => bracket.minimum === explicit)) return explicit;
  const value = Number(quantity);
  if (value >= 1000) return 1000;
  if (value >= 500) return 500;
  if (value >= 300) return 300;
  if (value >= 100) return 100;
  return 30;
}
```

The helper must normalize invalid or missing values to the quantity fallback instead of throwing.

- [ ] **Step 2: Build groups in saved position order.**

Map the already normalized item rows into a `Map` keyed by SKU or name plus description.

Each group must retain the first position and replace a tier cell when another row for the same group and tier appears later.

Each cell must contain `{ display: string, available: boolean }` and use `item.display.unit_price` as its display value.

- [ ] **Step 3: Add aligned cells and visible brackets to the view model.**

Return only bracket columns that appeared in at least one saved line, sorted by the fixed bracket order.

For each product, create one price cell per visible bracket so the Handlebars template can loop without lookup helpers.

Missing cells must be `{ display: '', available: false }`.

Add the result as `comparison` beside `items`, `display` and `terms` in `quotationSnapshotViewModel`.

- [ ] **Step 4: Run the focused test and confirm it passes.**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-templates-core.test.js`

Expected: PASS for the new matrix test and all existing quotation template tests.

- [ ] **Step 5: Commit the projection.**

```bash
git add api/_db/quotation-template-repository.ts tests/unit/quotation-templates-core.test.js
git commit -m "feat: project saved quote comparison matrix"
```

## Task 3: Convert and register the comparative template

**Files:**

- Modify: `api/_functions/lib/quotation-templates.ts` near the built-in source constants and preview view model.
- Modify: `tests/unit/quotation-templates-core.test.js` near built-in template tests.
- Keep unchanged: `template-comparison.html`.

**Interfaces:**

- Consumes: `viewModel.client`, `viewModel.quote_number`, `viewModel.display`, `viewModel.comparison` and `viewModel.items`.
- Produces: `getQuotationTemplate('comparativo')` and a source accepted by the existing HTML and Handlebars validators.

- [ ] **Step 1: Write failing registration and rendering tests.**

```js
test('comparativo template is registered and renders the saved matrix', () => {
  const template = getQuotationTemplate('comparativo');
  assert.ok(template);
  assert.equal(template.name, 'Comparativo por faixa');

  const model = quotationSnapshotViewModel(comparisonSnapshot);
  const html = renderQuotationTemplate(template, model);
  assert.match(html, /30 - 99/);
  assert.match(html, /100 - 299/);
  assert.match(html, /R\$ 7,50/);
  assert.match(html, /Camiseta/);
  assert.doesNotMatch(template.source, /\{%|%\}|\bfrappe\b|\bdoc\./i);
});

test('comparativo source satisfies the new-template contract', () => {
  const template = getQuotationTemplate('comparativo');
  assert.ok(template);
  validateQuotationSource(template.source, template.key);
});
```

The tests may reuse the `comparisonSnapshot` fixture created in Task 1 or define a local minimal snapshot with the same fields.

- [ ] **Step 2: Run the focused test and confirm it fails because the key is absent.**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-templates-core.test.js`

Expected: FAIL because `getQuotationTemplate('comparativo')` returns `null`.

- [ ] **Step 3: Convert the Frappe/Jinja placeholders to Handlebars.**

Create a `COMPARATIVE_SOURCE` constant following the existing built-in source convention.

Wrap the fragment in a complete HTML document with the original styles and inline SVG preserved.

Use `{{client.name}}`, `{{client.email}}`, `{{client.phone}}`, `{{quote_number}}`, `{{display.quote_date}}` and `{{display.validity_date}}` for the header.

Use `{{#each comparison.brackets}}` for visible columns and `{{#each comparison.products}}` for product rows.

Use `{{#each prices}}` inside each row and render `{{display}}` only when `{{#if available}}` is true, otherwise render `-`.

Use the fixed contact, banking, production and conditions text from `template-comparison.html` without changing its values.

Include a visually hidden contract block containing `{{#each items}}` and `{{display.total}}` so the existing required-field validator can enforce the common quotation contract without changing the visible layout.

Do not use dynamic `href`, `src` or `style` attributes.

- [ ] **Step 4: Register the source in the built-in definitions.**

Add this entry after the existing built-ins without changing the default entry.

```ts
{ key: 'comparativo', name: 'Comparativo por faixa', is_default: false, source: COMPARATIVE_SOURCE },
```

The existing `QUOTATION_TEMPLATES` and `templateSeedPlan` will then compute its hash and seed version automatically.

- [ ] **Step 5: Extend the deterministic preview model.**

Add a small `comparison` object with at least two visible brackets, two products and one unavailable cell.

Keep existing preview fields unchanged so current templates continue to render.

- [ ] **Step 6: Run the focused tests and confirm rendering and validation pass.**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-templates-core.test.js`

Expected: PASS for the comparative template tests and all existing built-in template tests.

- [ ] **Step 7: Commit the converted source and registration.**

```bash
git add api/_functions/lib/quotation-templates.ts tests/unit/quotation-templates-core.test.js
git commit -m "feat: add comparative quotation template"
```

## Task 4: Verify automatic seeding and preserve the default

**Files:**

- Modify: `tests/unit/quotation-template-migration.test.ts` in the existing seed-plan test.
- Test: `tests/unit/quotation-template-migration.test.ts`.

**Interfaces:**

- Consumes: `templateSeedPlan()` from `api/_db/quotation-template-migration.ts`.
- Produces: a regression assertion that the new built-in is seeded and the existing `padrao` entry remains present without duplicate keys.

- [ ] **Step 1: Add explicit seed assertions.**

```ts
const comparative = plan.find((item) => item.key === 'comparativo');
assert.ok(comparative);
assert.equal(comparative.name, 'Comparativo por faixa');
assert.equal(plan.filter((item) => item.key === 'padrao').length, 1);
assert.equal(new Set(plan.map((item) => item.key)).size, plan.length);
```

Keep the existing uniqueness, hash format and idempotence assertions.

- [ ] **Step 2: Run the migration test.**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-template-migration.test.ts`

Expected: PASS with the real built-in plan containing `comparativo`.

- [ ] **Step 3: Commit the seed regression test.**

```bash
git add tests/unit/quotation-template-migration.test.ts
git commit -m "test: cover comparative template seed"
```

## Task 5: Run repository verification and inspect the generated layout

**Files:**

- No planned source changes.
- Verify: `api/_db/quotation-template-repository.ts`, `api/_functions/lib/quotation-templates.ts`, `tests/unit/quotation-templates-core.test.js`, `tests/unit/quotation-template-migration.test.ts`.

**Interfaces:**

- Consumes: all implementation tasks.
- Produces: passing diagnostics, tests, lint and build evidence.

- [ ] **Step 1: Run focused unit tests after the final implementation.**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-templates-core.test.js tests/unit/quotation-template-migration.test.ts tests/unit/quotation-template-library.test.ts`

Expected: PASS with no template validation errors.

- [ ] **Step 2: Run diagnostics before the full build.**

Run LSP diagnostics for the four modified TypeScript/JavaScript files.

Expected: no new errors or warnings in the changed files.

- [ ] **Step 3: Run repository checks.**

Run: `npm run lint`

Expected: PASS.

Run: `npm run build`

Expected: PASS for API compilation and Vite output.

- [ ] **Step 4: Run the template-focused browser flow when local services are available.**

Run: `npx playwright test tests/quotation-templates-core.spec.js`

Expected: the existing template manager flow remains green and the new model is accepted by the mocked catalog contract.

If the browser test environment is unavailable, record the concrete environment error and retain the unit, lint and build evidence.

- [ ] **Step 5: Inspect the final diff and working tree.**

Run: `git diff HEAD~4 --stat && git diff --check && git status --short`

Expected: only the planned source, tests and committed design/plan documents changed, with `template-comparison.html` still unmodified.

- [ ] **Step 6: Run the session diagnostic audit.**

Use `lens_diagnostics` with `mode: "all"` for all edited files.

Expected: no blocking diagnostics remain.
