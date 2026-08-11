# Descrição por item de orçamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir salvar uma descrição personalizada por item, somente no orçamento, no draft `/auto` e em orçamentos core já criados.

**Architecture:** Reutilizar `item_name` como entrada HTTP e `produtoNome` como snapshot persistido da linha da revisão.

O catálogo continua sendo a fonte de SKU e preço inicial, mas não recebe nenhuma escrita.

O frontend mantém a coluna existente `Produto` e adiciona o campo dentro dela.

**Tech Stack:** React 19, TypeScript, Node.js ESM, Drizzle/PostgreSQL, Playwright e `node:test`.

## Global Constraints

- Não adicionar dependências, rota, tabela ou migração.
- Usar `item_name` como nome canônico no payload HTTP.
- Salvar o nome no snapshot `quote_revision_items.produto_nome`.
- Manter SKU, quantidade e preço independentes da descrição personalizada.
- Não alterar o cadastro em `products` ou ERPNext Item.
- Manter uma única coluna `Produto` no draft `/auto`.
- Usar o texto acessível em português `Nome exibido no orçamento`.
- Preservar a descrição personalizada durante recálculos de preço do draft.
- Validar texto no backend com máximo de 255 caracteres.
- Não incluir arquivos de trabalho alheios ao recurso nos commits.

---

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `api/_db/quote-repository.ts` | Aceitar `item_name` na criação core e gravá-lo no snapshot da revisão. |
| `api/_db/quote-draft-management-repository.ts` | Aceitar `item_name` na edição core e gravá-lo no snapshot da revisão. |
| `api/_functions/lib/quote-pipeline.ts` | Encaminhar `item_name` à Quotation legada do Frappe. |
| `src/components/SplitResultCard.tsx` | Exibir e editar a descrição no draft ativo de `/auto`. |
| `src/hooks/useExtractionDrafts.ts` | Não sobrescrever uma descrição já presente ao recalcular preço. |
| `src/pages/AutoQuotePage.tsx` | Incluir `item_name` no payload de criação do draft. |
| `src/pages/QuotationDetailPage.tsx` | Editar e enviar `item_name` no editor core de orçamento salvo. |
| `tests/unit/orcamento-core.test.ts` | Cobrir encaminhamento do nome no boundary de criação core. |
| `tests/unit/orcamento-postgres.test.ts` | Cobrir snapshot de nome na criação core e validação de tamanho. |
| `tests/unit/quotations-postgres.test.ts` | Cobrir snapshot de nome na atualização core e no documento renderizado. |
| `tests/orcamento.spec.js` | Cobrir descrição editada no draft `/auto` e payload de criação. |
| `tests/quotations-core.spec.js` | Cobrir descrição editada e salva no orçamento core existente. |

## Task 1: Persistir nome personalizado nos backends core e legado

**Files:**

- Modify: `api/_db/quote-repository.ts:99-105,221-227,390-419,578-615,916-1029`
- Modify: `api/_db/quote-draft-management-repository.ts:1067-1114,1225-1420`
- Modify: `api/_functions/lib/quote-pipeline.ts:30-46,103-141`
- Modify: `tests/unit/orcamento-core.test.ts:73-108`
- Modify: `tests/unit/orcamento-postgres.test.ts:111-153,229-276`
- Modify: `tests/unit/quotations-postgres.test.ts:250-385`

**Interfaces:**

- Consumes: `items[].item_name?: string` nos payloads de criação e atualização.
- Produces: `QuoteDraftItemSnapshot.nome` e `QuoteDraftManagementItem.nome` com o texto personalizado persistido.
- Produces: `quoteRevisionItems.produtoNome` como snapshot da descrição exibida no orçamento.

- [ ] **Step 1: Escrever testes de criação, atualização e limite de texto**

Em `tests/unit/orcamento-core.test.ts`, acrescente `item_name: 'Lenço 100 x 100 cm'` ao item enviado ao handler core e a asserção abaixo.

```ts
assert.equal(receivedItems[0]?.item_name, 'Lenço 100 x 100 cm');
```

Em `tests/unit/orcamento-postgres.test.ts`, crie o orçamento manual com o item abaixo e confirme retorno e linha persistida.

```ts
const customItemName = 'Lenço 100 x 100 cm';
items: [{ item_code: sku, item_name: customItemName, qty: '30.001', manual_rate: true, rate: '10.00' }];
assert.equal(manual.items[0].nome, customItemName);
assert.equal(itemRows[0]?.produtoNome, customItemName);
```

No helper `assertBoundaryRejects`, acrescente caso para `item_name: 'N'.repeat(256)` e espere `/Nome exibido no orçamento/`.

Em `tests/unit/quotations-postgres.test.ts`, envie o mesmo `customItemName` no `managementUpdate` principal e confirme retorno, snapshot e HTML.

```ts
items: [{ item_code: sku, item_name: customItemName, qty: '30.000', rate: '10.00', manual_rate: true }];
assert.equal(updated.items[0].nome, customItemName);
assert.equal(item?.produtoNome, customItemName);
assert.match(beforeHtml, /Lenço 100 x 100 cm/);
```

- [ ] **Step 2: Executar os testes para confirmar falha**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/orcamento-core.test.ts tests/unit/orcamento-postgres.test.ts tests/unit/quotations-postgres.test.ts
```

Expected: falhas nas novas asserções porque `item_name` ainda é descartado ou substituído pelo nome do catálogo.

- [ ] **Step 3: Normalizar e persistir `item_name` no core**

Em `api/_db/quote-repository.ts`, adicione `item_name?: unknown` a `QuoteDraftItemInput` e `itemName: string` a `NormalizedItem`.

Normalize a entrada usando o helper existente e aceite também `nome` como alias de compatibilidade.

```ts
const itemName = inputText(
  firstDefined(raw, ['item_name', 'nome']),
  'Nome exibido no orçamento',
  255,
);
```

Inclua `itemName` no item normalizado e no item resolvido.

Ao inserir e retornar a linha, use o nome personalizado quando não estiver vazio e o nome do catálogo como fallback.

```ts
produtoNome: item.itemName || item.product.nome,
nome: item.itemName || item.product.nome,
```

Em `itemSnapshot`, retorne `row.produtoNome` para preservar o snapshot, em vez de reler `product.nome`.

Em `api/_db/quote-draft-management-repository.ts`, faça a mesma normalização em `normalizeUpdateItems` e propague `itemName` por `resolvedItems` até o novo `quoteRevisionItems`.

Use o fallback `item.itemName || item.product.nome` ao preencher `produtoNome`.

Em `api/_functions/lib/quote-pipeline.ts`, adicione `item_name?: string` ao item de `ExtractedData` e preserve-o no item enviado ao Frappe.

```ts
item_name: item.item_name?.trim() || '',
```

- [ ] **Step 4: Executar os testes e confirmar aprovação**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/orcamento-core.test.ts tests/unit/orcamento-postgres.test.ts tests/unit/quotations-postgres.test.ts
```

Expected: PASS, com os testes PostgreSQL ignorados somente quando `TEST_DATABASE_URL` não estiver configurada.

- [ ] **Step 5: Commitar a fatia de persistência**

```bash
git add api/_db/quote-repository.ts api/_db/quote-draft-management-repository.ts api/_functions/lib/quote-pipeline.ts tests/unit/orcamento-core.test.ts tests/unit/orcamento-postgres.test.ts tests/unit/quotations-postgres.test.ts
git commit -m "feat(quotation): persist line display names"
```

## Task 2: Editar a descrição no draft `/auto`

**Files:**

- Modify: `src/components/SplitResultCard.tsx:105-148,185-196,360-431`
- Modify: `src/hooks/useExtractionDrafts.ts:55-65`
- Modify: `src/pages/AutoQuotePage.tsx:275-289`
- Modify: `tests/orcamento.spec.js:292-327`

**Interfaces:**

- Consumes: `DraftItem.item_name?: string` e `onUpdateItem(draftIdx, itemIdx, 'item_name', value)`.
- Produces: `POST /api/orcamento` com `extracted.items[].item_name`.
- Preserves: `item_name` existente durante `fetchPricing`.

- [ ] **Step 1: Escrever teste E2E para descrição do draft**

No teste `submissão de texto exibe rascunhos para revisão`, depois de mostrar `Pedido 1 de 1`, entre em edição, preencha o campo e crie o orçamento.

```js
const customItemName = 'Lenço 100 x 100 cm';
await page.getByRole('button', { name: 'Editar' }).click();
await page.getByLabel('Nome exibido no orçamento LNC-SED-70').fill(customItemName);
await page.getByRole('button', { name: 'Criar orçamento' }).click();
await expect.poll(() => quoteRequest?.extracted?.items?.[0]?.item_name).toBe(customItemName);
```

Mantenha as asserções existentes para `template_key`, link e abertura do orçamento.

- [ ] **Step 2: Executar o teste para confirmar falha**

Run:

```bash
npx playwright test tests/orcamento.spec.js --grep "submissão de texto exibe rascunhos"
```

Expected: FAIL porque o campo não existe e o payload não contém `item_name`.

- [ ] **Step 3: Adicionar campo na coluna existente e preservar o valor**

Em `SplitResultCard`, mantenha uma única coluna `Produto`.

Use o primeiro input para busca de SKU e, dentro da mesma célula, acrescente o campo de descrição abaixo dele.

```tsx
<label className="mt-1 block space-y-1">
  <span className="text-[10px] font-medium text-fg-muted">Nome exibido no orçamento</span>
  <Input
    aria-label={`Nome exibido no orçamento ${item.item_code || ii + 1}`}
    className="h-7 text-xs"
    value={item.item_name || ''}
    onChange={(event) => onUpdateItem(draft.index, ii, 'item_name', event.target.value)}
  />
</label>
```

Inicialize `itemSearchTerms` com `item.item_code`, não com `item.item_name`.

Após selecionar um produto, guarde `product.sku` no termo de busca.

Em `fetchPricing`, atualize o preço como hoje, mas só preencha `item_name` retornado pela precificação quando a linha ainda não possuir um nome.

```ts
if (!next[di].edited.items[ii].item_name && res.items[i].item_name) {
  next[di].edited.items[ii].item_name = res.items[i].item_name;
}
```

Em `createSingleQuote` de `AutoQuotePage`, inclua o campo no mapeamento de itens.

```ts
item_name: it.item_name || '',
```

- [ ] **Step 4: Executar o teste E2E para confirmar aprovação**

Run:

```bash
npx playwright test tests/orcamento.spec.js --grep "submissão de texto exibe rascunhos"
```

Expected: PASS, com `item_name` personalizado no POST e sem nova coluna na tabela.

- [ ] **Step 5: Commitar a fatia `/auto`**

```bash
git add src/components/SplitResultCard.tsx src/hooks/useExtractionDrafts.ts src/pages/AutoQuotePage.tsx tests/orcamento.spec.js
git commit -m "feat(auto): edit quotation item names"
```

## Task 3: Editar e salvar a descrição em orçamento core existente

**Files:**

- Modify: `src/pages/QuotationDetailPage.tsx:384-431,500-522,1005-1045`
- Modify: `tests/quotations-core.spec.js:39-112`

**Interfaces:**

- Consumes: `CoreQuotationItem.item_name` e `CoreQuotationItem.nome`.
- Produces: `PUT /api/quotations?id=<id>` com `items[].item_name`.
- Preserves: a coluna `Produto` existente e o SKU em coluna separada.

- [ ] **Step 1: Escrever teste E2E para salvar nome do orçamento existente**

No teste `core quotations list/search/open/edit and surface optimistic conflicts`, preencha o novo campo depois de entrar em edição.

```js
const customItemName = 'Lenço 100 x 100 cm';
await page.getByLabel('Nome exibido no orçamento SKU-1').fill(customItemName);
```

No mock de `PUT`, use `lastPutPayload.items[0].item_name` em `nome` e `item_name` da resposta autoritativa.

Depois de salvar, confirme o payload e a visualização recarregada.

```js
expect(lastPutPayload.items[0].item_name).toBe(customItemName);
await expect(page.getByText(customItemName)).toBeVisible();
```

- [ ] **Step 2: Executar o teste para confirmar falha**

Run:

```bash
npx playwright test tests/quotations-core.spec.js
```

Expected: FAIL porque o editor core não oferece o campo e o payload omite `item_name`.

- [ ] **Step 3: Editar o nome na coluna Produto e enviá-lo no PUT**

Em `CoreQuotationDetail`, mantenha a coluna `Produto` existente.

Quando `editing` for verdadeiro, substitua somente o texto estático por um rótulo e input.

```tsx
<label className="block space-y-1">
  <span className="text-[10px] font-medium text-fg-muted">Nome exibido no orçamento</span>
  <Input
    aria-label={`Nome exibido no orçamento ${item.sku}`}
    className="h-8 text-sm"
    value={item.item_name}
    onChange={(event) =>
      updateItem(item._key, {
        item_name: event.target.value,
        nome: event.target.value,
      })
    }
  />
</label>
```

No mapeamento de `save`, acrescente `item_name: item.item_name` sem alterar `item_code`, `qty`, `rate` ou `manual_rate`.

A seleção de um novo SKU continuará preenchendo ambos `item_name` e `nome` com o nome padrão do produto selecionado.

- [ ] **Step 4: Executar o teste E2E para confirmar aprovação**

Run:

```bash
npx playwright test tests/quotations-core.spec.js
```

Expected: PASS, com texto personalizado persistido na requisição e renderizado após o recarregamento.

- [ ] **Step 5: Commitar a fatia de edição de orçamento**

```bash
git add src/pages/QuotationDetailPage.tsx tests/quotations-core.spec.js
git commit -m "feat(quotation): edit saved item names"
```

## Task 4: Verificação integrada

**Files:**

- Verify: `docs/superpowers/specs/2026-08-10-quotation-line-description-design.md`
- Verify: `docs/superpowers/plans/2026-08-10-quotation-line-description.md`

**Interfaces:**

- Consumes: todas as fatias concluídas.
- Produces: evidência de lint, tipos, build e testes focados aprovados.

- [ ] **Step 1: Revisar a especificação factual**

Confirme que a especificação diz que os fluxos incluirão e persistirão `item_name`.

Confirme que ela não afirma que o payload ou o repositório core já faziam isso antes desta implementação.

- [ ] **Step 2: Executar diagnóstico estático nos arquivos alterados**

Run:

```bash
npx eslint src/components/SplitResultCard.tsx src/hooks/useExtractionDrafts.ts src/pages/AutoQuotePage.tsx src/pages/QuotationDetailPage.tsx api/_db/quote-repository.ts api/_db/quote-draft-management-repository.ts api/_functions/lib/quote-pipeline.ts
```

Expected: PASS sem erros.

- [ ] **Step 3: Executar testes e build de regressão**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/orcamento-core.test.ts tests/unit/orcamento-postgres.test.ts tests/unit/quotations-postgres.test.ts
npx playwright test tests/orcamento.spec.js tests/quotations-core.spec.js
npm run lint
npm run build
```

Expected: todos os comandos aprovados, com testes PostgreSQL explicitamente ignorados apenas sem banco de teste configurado.

- [ ] **Step 4: Verificar diff final**

```bash
git diff --check
git status --short
```

Expected: nenhum arquivo alheio ao recurso aparece no diff.
