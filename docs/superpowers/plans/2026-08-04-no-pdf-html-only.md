# Eliminar PDF, apenas HTML — Implementation Plan

> **Revised 2026-08-04 per oracle review**
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove PDF issuance + Vercel Blob storage. "Emitir" becomes a status transition only. Preview stays HTML.

**Architecture:** Delete `quotation-issue.ts`, `quotation-document.ts`, and `quotation-document-repository.ts`. Remove `issuedDocuments` from Drizzle schema. Simplify `QuotationDetailPage.tsx` — replace `issuePdf` with lifecycle `setStatus` call. Remove `@vercel/blob` dependency. Keep `quotation-pdf.ts` and `quotation-document-storage.ts` (simplified — still used by preview `?format=pdf`, WhatsApp, migration).

**Tech Stack:** React 19, Vite 6, Node.js, PostgreSQL (Neon + Drizzle), Handlebars

## Global Constraints

- Zero PDF stored in blob — apenas preview HTML on-the-fly
- "Emitir" = transição de status `rascunho` → `enviado` via lifecycle endpoint existente
- Histórico de revisões: metadata apenas (sem link para documento)
- ORC-20260001 revertido para rascunho, issued_document deletado
- Manter `quotation-preview?format=pdf` (PDF on-the-fly sem armazenar, útil pra download)
- Manter WhatsApp PDF (funcionalidade separada, não depende de blob)
- Manter migration code (já executado, mantido para referência; será quebrado intencionalmente)

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

- Modify: `api/_db/schema.ts` (linhas ~328-362, tabela `issuedDocuments` + linha ~412, alias `issuedDocument`)

**Interfaces:**

- Consumes: nada
- Produces: schema sem `issuedDocuments` nem `issuedDocument`

- [ ] **Step 1: Remover definição da tabela `issuedDocuments`**

Abrir `api/_db/schema.ts`. Remover o bloco inteiro (linhas 328-362):

```typescript
export const issuedDocuments = pgTable(
  'issued_documents',
  { ... }
);
```

- [ ] **Step 2: Remover alias `issuedDocument`**

Remover linha 412:

```typescript
export const issuedDocument = issuedDocuments;  // REMOVER
```

- [ ] **Step 3: Verificar que não quebrou imports em outros arquivos**

```bash
grep -rn "issuedDocuments" api/ --include="*.ts" --include="*.tsx"
```

Deve retornar apenas `quote-draft-management-repository.ts`, `quotation-lifecycle-repository.ts`, `frappe-migration-repository.ts`, `operational-status.ts` (todos tratados em tasks seguintes). Nenhum outro arquivo deve importar `issuedDocuments`.

- [ ] **Step 4: Build e teste**

```bash
npm run build
npm run test:unit
```

- [ ] **Step 5: Commit**

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

- [ ] **Step 3: Limpar `quotation-document-storage.ts`**

O arquivo `api/_functions/lib/quotation-document-storage.ts` importa `@vercel/blob` nas funções `archiveQuotationPdf()` e `readQuotationPdf()` (via `createVercelQuotationDocumentStorage`). Estas funções são dead code após a remoção de `quotation-issue.ts` e `quotation-document.ts`. Remover:

- `import { get, put } from '@vercel/blob'` (linha 1)
- Função `createVercelQuotationDocumentStorage()` (linhas 127-181) — usa `put` e `get` do blob
- Interface `QuotationBlobClient` (linhas 23-25) — dead export
- Classe `QuotationDocumentStorageError` (linhas 27-35) — só usada por `createVercelQuotationDocumentStorage`
- Função `quotationBlobAuth()` (linhas 50-56) — só usada por `createVercelQuotationDocumentStorage`
- Função `quotationPdfPathname()` (linhas 58-75) — só usada por `quotation-issue.ts`
- Função `streamBuffer()` (linhas 77-96) — helper privado de `readPrivatePdf`
- Função `readPrivatePdf()` (linhas 98-113) — helper privado
- Interface `QuotationDocumentStorage` (linhas 17-21) — não usado após remover `createVercelQuotationDocumentStorage`

**Manter:**
- `QUOTATION_PDF_MIME_TYPE` — usado por `frappe-migration-core.ts` (linha 14)
- `isValidPdfBuffer` — usado por `quotation-preview.ts` (linha 13)
- `quotationPdfChecksum` — usado por `isValidPdfBuffer`? Verificar — se não for usado por mais nada, pode remover também. (É chamado por `createVercelQuotationDocumentStorage` e `streamBuffer` → ambos removidos. Se nenhum outro caller, remover.)
- `StoredQuotationPdf` e `ArchivedQuotationPdf` — verificar se usados pelos exports mantidos.

O arquivo final deve conter apenas:

```typescript
import { createHash } from 'node:crypto';

export const QUOTATION_PDF_MIME_TYPE = 'application/pdf' as const;

export function quotationPdfChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function isValidPdfBuffer(buffer: Buffer): boolean {
  return (
    buffer.length > 8 &&
    buffer.subarray(0, 5).toString('ascii') === '%PDF-' &&
    buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'))
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json api/_functions/lib/quotation-document-storage.ts
git commit -m "chore: remove @vercel/blob dependency + simplify quotation-document-storage.ts"
```

---

### Task 5: Simplificar QuotationDetailPage — remover PDF issuance

**Files:**

- Modify: `src/pages/QuotationDetailPage.tsx`

**Interfaces:**

- Consumes: `apiPost` (já importado), lifecycle endpoint `/quotations` POST
- Produces: botão "Emitir" que só transiciona status, sem PDF

- [ ] **Step 1: Remover tipo `IssuedQuotationDocumentMetadata` e campo `issued_document`**

Remover interface `IssuedQuotationDocumentMetadata`.
Remover campo `issued_document` de `QuotationData`.

No tipo `QuotationData`, remover:

```typescript
issued_document?: IssuedQuotationDocumentMetadata | null;
```

- [ ] **Step 2: Substituir `issuePdf` callback**

Remover o callback `issuePdf` inteiro e substituir por uma chamada ao lifecycle:

```typescript
const emitir = useCallback(async () => {
  if (
    !confirm(
      `Tem certeza que deseja emitir o orçamento ${data.id}?\n\nApós a emissão ele não poderá mais ser editado.`
    )
  )
    return;
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

Mudar o texto e onClick do botão:

```tsx
<Button variant="success" size="sm" disabled={issuing || lifecycleAction !== null} onClick={emitir}>
  {issuing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}{' '}
  {issuing ? 'Emitindo…' : 'Emitir orçamento'}
</Button>
```

- [ ] **Step 4: Substituir "Abrir PDF emitido" por "Visualizar"**

Remover condição `data.issued_document &&` e mudar o botão para aparecer sempre que status ≠ rascunho:

```tsx
{data.status_canonical !== 'rascunho' && (
  <Button variant="outline" size="sm" onClick={openIssuedDocument}>
    <FileText size={14} /> Visualizar
  </Button>
)}
```

`openIssuedDocument` já abre `/api/quotation-preview` com o template selecionado.

- [ ] **Step 5: Remover badge "PDF definitivo arquivado"**

Remover o bloco:

```tsx
{data.issued_document && (
  <div className="text-xs text-fg-muted ...">PDF definitivo arquivado · ...</div>
)}
```

- [ ] **Step 6: Remover referências a `issued_document` no histórico**

No mapeamento do histórico de revisões, remover a renderização condicional de `entry.issued_document`:

```tsx
{/* Sempre mostra "Visualizar" que abre preview HTML, apenas se status é enviado ou superior */}
{entry.status_canonical !== 'rascunho' && (
  <Button variant="outline" size="sm"
    onClick={() => {
      const params = new URLSearchParams({
        id: data.id,
        template: entry.template_key || 'padrao',
      });
      window.open(`/api/quotation-preview?${params.toString()}`, '_blank', 'noopener,noreferrer');
    }}
  >
    <FileText size={12} /> Visualizar
  </Button>
)}
```

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

### Task 6: Atualizar quote-draft-management-repository + operational-status (BLOCKERS)

**Files:**

- Modify: `api/_db/quote-draft-management-repository.ts` (linhas 7, 194-212, 249, 534-550, 552-595, 597-678)
- Modify: `api/_functions/operational-status.ts` (linhas 4, 53-72)

**Interfaces:**

- Consumes: schema sem `issuedDocuments`
- Produces: draft management sem `issued_document`, operational-status sem `checkPdfsArchived`

- [ ] **Step 1: `quote-draft-management-repository.ts` — remover import**

Remover `issuedDocuments` do import na linha 7:

```typescript
// Before:
import { clients, issuedDocuments, products, productPricingTiers, quoteRevisionItems, quoteRevisions, quotations } from './schema.js';
// After:
import { clients, products, productPricingTiers, quoteRevisionItems, quoteRevisions, quotations } from './schema.js';
```

- [ ] **Step 2: Remover campo `issued_document` das interfaces**

Em `QuoteDraftManagementDetail` (linhas 194-212), remover o campo `issued_document`.

Em `QuoteRevisionHistoryEntry` (linha 249), remover:

```typescript
issued_document: QuoteDraftManagementDetail['issued_document'];
```

- [ ] **Step 3: Remover função `documentMetadata()`**

Remover inteiramente a função `documentMetadata()` (linhas 534-550).

- [ ] **Step 4: Atualizar `readRevisionHistory()`**

Remover a query a `issuedDocuments` e o join por `documentByRevision`. Cada entry retorna `issued_document: null`:

Em vez de:

```typescript
const documents = await tx.select().from(issuedDocuments).where(eq(issuedDocuments.quotationId, quotationId));
const documentByRevision = new Map(documents.map((row) => [row.revisionId, row]));
...
issued_document: document ? documentMetadata(document) : null,
```

Fazer:

```typescript
issued_document: null,
```

- [ ] **Step 5: Atualizar `readPostgresQuotationDetail()`**

Remover a query a `issuedDocuments` (linhas 612-615):

```typescript
// REMOVER:
const [issuedDocument] = await tx
  .select()
  .from(issuedDocuments)
  .where(eq(issuedDocuments.revisionId, revision.id))
  .limit(1);
```

E substituir o uso (linha 663):

```typescript
// Before:
issued_document: issuedDocument ? documentMetadata(issuedDocument) : null,
// After:
issued_document: null,
```

- [ ] **Step 6: `operational-status.ts` — remover import + simplificar `checkPdfsArchived()`**

Remover `issuedDocuments` do import (linha 4):

```typescript
// Before:
import { frappeImportLineage, issuedDocuments, appSettings } from '../_db/schema.js';
// After:
import { frappeImportLineage, appSettings } from '../_db/schema.js';
```

Remover `count` do import do drizzle-orm se não for mais usado.

Substituir `checkPdfsArchived()` (linhas 53-72) por:

```typescript
async function checkPdfsArchived(): Promise<{ archived: boolean; pdfCount: number; blobTokenPresent: boolean }> {
  return { archived: true, pdfCount: 0, blobTokenPresent: false };
}
```

A verificação perde o sentido após a remoção dos PDFs. Sempre retorna `archived: true` para não bloquear o readiness check operacional.

- [ ] **Step 7: Build e teste**

```bash
npm run build
npm run test:unit
```

- [ ] **Step 8: Commit**

```bash
git add api/_db/quote-draft-management-repository.ts api/_functions/operational-status.ts
git commit -m "chore: remove issuedDocuments from draft-management + operational-status"
```

---

### Task 7: Limpar quotation-lifecycle-repository + deletar quotation-document-repository

**Files:**

- Delete: `api/_db/quotation-document-repository.ts` (nenhum caller após Task 3)
- Modify: `api/_db/quotation-lifecycle-repository.ts`
- Modify: `api/_db/frappe-migration-repository.ts`

**Interfaces:**

- Consumes: schema sem `issuedDocuments`
- Produces: lifecycle sem referências a documentos emitidos, migration quebrado intencionalmente

- [ ] **Step 1: Deletar `quotation-document-repository.ts`**

```bash
rm api/_db/quotation-document-repository.ts
```

Após Task 3 deletar `quotation-issue.ts` e `quotation-document.ts`, nada em produção importa `quotation-document-repository.ts`. Os testes que o importam serão removidos nesta task.

- [ ] **Step 2: Atualizar `quotation-lifecycle-repository.ts` — remover import**

Remover `issuedDocuments` do import (linha 14):

```typescript
// Before:
import { issuedDocuments, quoteRevisionItems, quoteRevisions, quotations } from './schema.js';
// After:
import { quoteRevisionItems, quoteRevisions, quotations } from './schema.js';
```

- [ ] **Step 3: Remover guard de `sourceDocument` no `createRevision`**

Remover linhas 220-226 (query a `issuedDocuments` pra verificar se a revisão de origem tem documento emitido):

```typescript
// REMOVER:
const [sourceDocument] = await tx
  .select({ id: issuedDocuments.id })
  .from(issuedDocuments)
  .where(and(eq(issuedDocuments.quotationId, quotation.id), eq(issuedDocuments.revisionId, source.id)))
  .limit(1);
if (!sourceDocument) {
  throw new QuoteManagementConflictError('A revisão de origem não possui documento definitivo emitido.');
}
```

O guard de `ISSUED_STATES` na linha 230 (`if (!ISSUED_STATES.has(sourceStatus))`) já é suficiente — uma revisão com status `enviado` pode originar nova revisão, não precisa mais verificar a existência de documento físico.

- [ ] **Step 4: Atualizar `frappe-migration-repository.ts`**

Adicionar comentário no topo do arquivo indicando que o código de migração está quebrado e não deve ser re-executado. Opcional: remover referências a `issuedDocuments` para que o build compile, mas manter a estrutura para referência.

Mínimo para compilar:
- Remover `issuedDocuments` do import (linha 9)
- Remover função `applyQuotationUnit()` que insere em `issuedDocuments` (linhas ~503-568)
- Atualizar `listIssuedDocumentPdfPlaceholders()` e `updateIssuedDocumentPdf()` para retornar arrays vazios / lançar erro
- Adicionar comentário JSDoc: `/** @deprecated Migration code. Do not re-run. Kept for reference only. */`

- [ ] **Step 5: Build e teste**

```bash
npm run build
npm run test:unit
```

**Testes a remover/adaptar:**

Arquivos a DELETAR (testam funcionalidade removida):
- `tests/unit/quotation-issuance-core.test.js`
- `tests/unit/quotation-issuance-postgres.test.ts`
- `tests/quotation-issuance-core.spec.js`
- `tests/unit/quotation-lifecycle-postgres.test.ts` — imports `issuedDocuments`, `quotation-document-repository`
- `tests/unit/frappe-migration-postgres.test.ts` — imports `issuedDocuments`, `quotation-document-storage`
- `tests/quotation-lifecycle.spec.js` — references `issued_document` in expected payloads

- [ ] **Step 6: Commit**

```bash
git add api/_db/quotation-lifecycle-repository.ts api/_db/quotation-document-repository.ts api/_db/frappe-migration-repository.ts tests/
git commit -m "chore: remove issuedDocuments references from lifecycle + delete document-repository + cleanup tests"
```

---

### Task 8: Limpar compilation artifacts e testar E2E

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

Corrigir quaisquer testes quebrados.

- [ ] **Step 3: Testar E2E manualmente**

Iniciar dev server:

```bash
node scripts/dev-api-server.mjs
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

### Task 9: Deploy e verificação

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
