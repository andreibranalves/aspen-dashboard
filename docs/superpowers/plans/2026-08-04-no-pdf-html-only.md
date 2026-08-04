# Eliminar PDF, apenas HTML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove PDF issuance + Vercel Blob storage. "Emitir" becomes a status transition only. Preview stays HTML.

**Architecture:** Delete `quotation-issue.ts` and `quotation-document.ts`. Remove `issuedDocuments` from Drizzle schema. Simplify `QuotationDetailPage.tsx` — replace `issuePdf` with lifecycle `setStatus` call. Remove `@vercel/blob` dependency. Keep `quotation-pdf.ts` and `quotation-document-storage.ts` (still used by preview `?format=pdf`, WhatsApp, migration).

**Tech Stack:** React 19, Vite 6, Node.js, PostgreSQL (Neon + Drizzle), Handlebars

## Global Constraints

- Zero PDF stored in blob — apenas preview HTML on-the-fly
- "Emitir" = transição de status `rascunho` → `enviado` via lifecycle endpoint existente
- Histórico de revisões: metadata apenas (sem link para documento)
- ORC-20260001 revertido para rascunho, issued_document deletado
- Manter `quotation-preview?format=pdf` (PDF on-the-fly sem armazenar, útil pra download)
- Manter WhatsApp PDF (funcionalidade separada, não depende de blob)
- Manter migration code (já executado, mantido para referência)

---

### Task 1: Limpar banco e Vercel Blob

**Files:**

- SQL manual (sem arquivo)
- `.env`

**Interfaces:**

- Consumes: nada
- Produces: ORC-20260001 em `rascunho`, blob vazio

- [ ] **Step 1: Deletar PDF do Vercel Blob**

```bash
# Usar o token do .env
curl -X DELETE \
  -H "Authorization: Bearer $(grep QUOTATION_BLOB_READ_WRITE_TOKEN .env | cut -d= -f2)" \
  "https://blob.vercel-storage.com/tqdshqsaocsvarfx/quotations/ORC-20260001/revision-1-*.pdf"
```

Ou via Vercel Dashboard → Blob → deletar manualmente.

- [ ] **Step 2: Reverter ORC-20260001 para rascunho**

```sql
DELETE FROM issued_documents WHERE quotation_id = (SELECT id FROM quotations WHERE business_number = 'ORC-20260001');
UPDATE quotations SET status = 'rascunho' WHERE business_number = 'ORC-20260001';
UPDATE quote_revisions SET status = 'rascunho' WHERE quotation_id = (SELECT id FROM quotations WHERE business_number = 'ORC-20260001');
```

- [ ] **Step 3: Remover QUOTATION_BLOB_READ_WRITE_TOKEN do .env**

Abrir `.env`, remover a linha `QUOTATION_BLOB_READ_WRITE_TOKEN=...`

- [ ] **Step 4: Commit**

```bash
# .env é gitignored, não precisa commitar
```

---

### Task 2: Remover schema issuedDocuments do Drizzle

**Files:**

- Modify: `api/_db/schema.ts` (linhas ~329-360, tabela `issuedDocuments` + relações)

**Interfaces:**

- Consumes: nada
- Produces: schema sem `issuedDocuments`

- [ ] **Step 1: Remover definição da tabela `issuedDocuments`**

Abrir `api/_db/schema.ts`. Remover o bloco inteiro:

```typescript
export const issuedDocuments = pgTable('issued_documents', {
  // ... todas as colunas ...
});
```

E as relações no final do arquivo:

```typescript
export const issuedDocumentsRelations = relations(issuedDocuments, ({ one }) => ({
  quotation: one(quotations, { ... }),
  revision: one(quoteRevisions, { ... }),
}));
```

- [ ] **Step 2: Verificar que não quebrou imports em outros arquivos**

```bash
grep -rn "issuedDocuments" api/ --include="*.ts" --include="*.tsx"
```

Deve retornar apenas `quotation-lifecycle-repository.ts` e `quotation-document-repository.ts` (tratados em tasks seguintes).

- [ ] **Step 3: Build e teste**

```bash
npm run build
npm run test:unit
```

- [ ] **Step 4: Commit**

```bash
git add api/_db/schema.ts
git commit -m "chore: remove issuedDocuments from Drizzle schema"
```

---

### Task 3: Remover endpoints quotation-issue e quotation-document

**Files:**

- Delete: `api/_functions/quotation-issue.ts`
- Delete: `api/_functions/quotation-document.ts`
- Modify: `api/[...path].ts` — remover rotas
- Modify: `scripts/dev-api-server.mjs` — remover rotas
- Modify: `scripts/app-server.mjs` — remover rotas

**Interfaces:**

- Consumes: `ROUTES` map em cada arquivo de roteamento
- Produces: endpoints removidos

- [ ] **Step 1: Deletar arquivos**

```bash
rm api/_functions/quotation-issue.ts
rm api/_functions/quotation-document.ts
```

- [ ] **Step 2: Remover rotas do `api/[...path].ts`**

Remover as linhas de import e as entradas no map `ROUTES`:

```typescript
// Remover:
import { handler as quotationIssueHandler } from './_functions/quotation-issue.js';
import { handler as quotationDocumentHandler } from './_functions/quotation-document.js';

// Remover do ROUTES:
'/quotation-issue': quotationIssueHandler,
'/quotation-document': quotationDocumentHandler,
```

- [ ] **Step 3: Remover rotas do `scripts/dev-api-server.mjs`**

Mesma operação — remover imports e entradas no objeto `ROUTES`.

- [ ] **Step 4: Remover rotas do `scripts/app-server.mjs`**

Mesma operação.

- [ ] **Step 5: Build e teste**

```bash
npm run build
npm run test:unit
```

- [ ] **Step 6: Commit**

```bash
git add api/_functions/quotation-issue.ts api/_functions/quotation-document.ts api/[...path].ts scripts/dev-api-server.mjs scripts/app-server.mjs
git commit -m "feat: remove quotation-issue and quotation-document endpoints"
```

---

### Task 4: Remover dependência @vercel/blob

**Files:**

- Modify: `package.json`

**Interfaces:**

- Consumes: nada
- Produces: `@vercel/blob` removido das dependências

- [ ] **Step 1: Remover do package.json**

```bash
npm uninstall @vercel/blob
```

- [ ] **Step 2: Verificar que não há mais imports**

```bash
grep -rn "@vercel/blob" api/ src/ --include="*.ts" --include="*.tsx"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove @vercel/blob dependency"
```

---

### Task 5: Simplificar QuotationDetailPage — remover PDF issuance

**Files:**

- Modify: `src/pages/QuotationDetailPage.tsx`

**Interfaces:**

- Consumes: `apiPost` (já importado), lifecycle endpoint `/quotations` POST
- Produces: botão "Emitir" que só transiciona status, sem PDF

- [ ] **Step 1: Remover tipo `IssuedQuotationDocumentMetadata` e campo `issued_document`**

Remover interface `IssuedQuotationDocumentMetadata` (linhas ~113-155).
Remover campo `issued_document` de `QuotationData` (linha ~156).

No tipo `QuotationData`, remover:

```typescript
issued_document?: IssuedQuotationDocumentMetadata | null;
```

- [ ] **Step 2: Substituir `issuePdf` callback**

Remover o callback `issuePdf` inteiro (linhas ~544-575) e substituir por uma chamada ao lifecycle:

```typescript
const emitir = useCallback(async () => {
  if (!confirm(`Tem certeza que deseja emitir o orçamento ${data.id}?\n\nApós a emissão ele não poderá mais ser editado.`)) return;
  setIssuing(true);
  setMessage('');
  try {
    await apiPost<unknown>(`/quotations?id=${encodeURIComponent(data.id)}`, {
      action: 'set_status',
      status: 'enviado',
    });
    setMessage('Orçamento emitido com sucesso.');
    await onReload();
  } catch (error) {
    setMessage(`Erro ao emitir: ${(error as Error).message || 'Tente novamente.'}`);
  } finally {
    setIssuing(false);
  }
}, [data.id, onReload]);
```

- [ ] **Step 3: Atualizar botão "Emitir PDF definitivo"**

Mudar o texto e onClick do botão na linha ~1058:

```tsx
{/* era: onClick={issuePdf} + texto "Emitir PDF definitivo" */}
<Button
  variant="success"
  size="sm"
  disabled={issuing || lifecycleAction !== null}
  onClick={emitir}
>
  {issuing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}{' '}
  {issuing ? 'Emitindo…' : 'Emitir orçamento'}
</Button>
```

- [ ] **Step 4: Substituir "Abrir PDF emitido" por "Visualizar"**

Remover condição `data.issued_document &&` e mudar o botão para aparecer sempre que status ≠ rascunho:

```tsx
{/* era: {data.issued_document && (...Abrir PDF emitido...)} */}
{data.status_canonical !== 'rascunho' && (
  <Button variant="outline" size="sm" onClick={openIssuedDocument}>
    <FileText size={14} /> Visualizar
  </Button>
)}
```

Nota: `openIssuedDocument` já abre `/api/quotation-preview` com o template selecionado. Renomear para `visualizar` para clareza.

- [ ] **Step 5: Remover badge "PDF definitivo arquivado"**

Remover o bloco (linhas ~884-890):

```tsx
{/* REMOVER: */}
{data.issued_document && (
  <div className="text-xs text-fg-muted ...">
    PDF definitivo arquivado · ...
  </div>
)}
```

- [ ] **Step 6: Remover referências a `issued_document` no histórico**

No mapeamento do histórico de revisões (linhas ~1129-1156), remover a renderização condicional de `entry.issued_document`:

```tsx
{/* era: {entry.issued_document ? (...) : (...)} */}
{/* Agora sempre mostra "Visualizar" que abre preview HTML */}
<Button variant="outline" size="sm" onClick={() => {
  const params = new URLSearchParams({
    id: data.id,
    template: entry.template_key || 'padrao',
  });
  window.open(`/api/quotation-preview?${params.toString()}`, '_blank', 'noopener,noreferrer');
}}>
  <FileText size={12} /> Visualizar
</Button>
```

Mas atenção: o histórico pode ter revisões de antes da emissão (que nunca foram emitidas). Só mostrar "Visualizar" se a revisão tem status `enviado` ou superior.

- [ ] **Step 7: Build e teste**

```bash
npm run build
npm run test:unit
```

- [ ] **Step 8: Commit**

```bash
git add src/pages/QuotationDetailPage.tsx
git commit -m "feat: replace PDF issuance with status transition in QuotationDetailPage"
```

---

### Task 6: Limpar quotation-lifecycle-repository (issuedDocuments)

**Files:**

- Modify: `api/_db/quotation-lifecycle-repository.ts`
- Modify: `api/_db/quotation-document-repository.ts` (se ainda existir)

**Interfaces:**

- Consumes: schema sem `issuedDocuments`
- Produces: lifecycle sem referências a documentos emitidos

- [ ] **Step 1: Identificar referências a `issuedDocuments`**

```bash
grep -n "issuedDocuments\|issued_document\|QuotationDocument" api/_db/quotation-lifecycle-repository.ts
```

- [ ] **Step 2: Remover referências**

As funções `setStatus` e `createRevision` podem referenciar `issuedDocuments` para validar transições (ex: não pode mudar status de um orçamento já emitido). Remover essas verificações ou trocar por verificação apenas do status da quotation/revision.

- [ ] **Step 3: Remover import de `issuedDocuments` do schema**

```typescript
// Remover:
import { ..., issuedDocuments } from './schema.js';
```

- [ ] **Step 4: Atualizar `quotation-document-repository.ts`**

Se o arquivo ainda existir (não deletado nesta spec), remover métodos `complete()` e `reissue()` que criam registros em `issued_documents`. Manter apenas `prepare()` e `get()` se ainda usados por `operational-status.ts`.

- [ ] **Step 5: Build e teste**

```bash
npm run build
npm run test:unit
```

Atenção: testes que referenciam `issuedDocuments` ou PDF issuance vão quebrar. Lista de testes afetados:

- `tests/unit/quotation-issuance-core.test.js` — remover ou adaptar
- `tests/unit/quotation-issuance-postgres.test.ts` — remover ou adaptar
- `tests/quotation-issuance-core.spec.js` — remover

- [ ] **Step 6: Commit**

```bash
git add api/_db/quotation-lifecycle-repository.ts tests/
git commit -m "chore: remove issuedDocuments references from lifecycle and tests"
```

---

### Task 7: Limpar compilation artifacts e testar E2E

**Files:**

- `api/_functions/quotation-issue.js` (compiled, gitignored)
- `api/_functions/quotation-document.js` (compiled, gitignored)
- etc.

**Interfaces:**

- Consumes: build limpo
- Produces: app funcional sem PDF

- [ ] **Step 1: Limpar build artifacts**

```bash
rm -rf api/_functions/quotation-issue.js api/_functions/quotation-issue.js.map
rm -rf api/_functions/quotation-document.js api/_functions/quotation-document.js.map
npm run build
```

- [ ] **Step 2: Rodar todos os testes**

```bash
npm run test:unit
```

Corrigir quaisquer testes quebrados (principalmente os de issuance).

- [ ] **Step 3: Testar E2E manualmente**

Iniciar dev server:

```bash
node scripts/vite-dev.mjs
```

1. Abrir `/quotations` — verificar que lista carrega
2. Criar novo orçamento — verificar preview HTML
3. Clicar "Emitir orçamento" — verificar transição de status
4. Clicar "Visualizar" — verificar HTML em nova aba
5. Verificar que não há erros no console

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: clean up compiled artifacts"
```

---

### Task 8: Deploy e verificação

- [ ] **Step 1: Deploy no Vercel**

```bash
vercel deploy --prod
```

- [ ] **Step 2: Verificar no ambiente de produção**

1. Acessar app em produção
2. Criar orçamento de teste
3. Emitir (transição de status)
4. Visualizar HTML
5. Confirmar que blob não recebeu novos arquivos

- [ ] **Step 3: Commit final (se houver ajustes)**

```bash
git push origin master
```
