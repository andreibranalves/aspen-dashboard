# Spec: Eliminar PDF, apenas HTML

**Data:** 2026-08-04
**Status:** aprovado

## Motivação

O usuário não quer lotar o Vercel Blob com PDFs de orçamento.
Na versão antiga do app (Frappe mode), orçamentos eram visualizados
como HTML no browser e o usuário imprimia/baixava com Ctrl+P.

## Design

### Emitir = só transição de status

O botão "Emitir" apenas chama o endpoint de lifecycle já existente:

```
POST /api/quotations?id=ORC-XXX
{"action": "set_status", "status": "enviado"}
```

Nada de PDF, nada de blob. O status transiciona de `rascunho` para `enviado`.

### Visualizar = HTML on-the-fly

O endpoint `/api/quotation-preview` (já existe) renderiza HTML com o
template selecionado. O botão "Visualizar" abre em nova aba.

Browser imprime/baixa com Ctrl+P.

### Histórico de revisões

Apenas metadata: data, versão, status, template usado.
Sem link para documento armazenado.

## O que é removido

| Artefato                                                             | Destino      |
| -------------------------------------------------------------------- | ------------ |
| `api/_functions/quotation-issue.ts`                                  | deletado     |
| `api/_functions/quotation-document.ts`                               | deletado     |
| `api/_db/quotation-document-repository.ts`                           | deletado     |
| `api/_functions/lib/quotation-document-storage.ts`                   | deletado     |
| Tabela `issuedDocuments` no schema Drizzle                           | removida     |
| Campo `issued_document` no tipo `QuotationData`                      | removido     |
| PDF no blob (ORC-20260001-R1.pdf)                                    | deletado     |
| Dependência `@vercel/blob` do package.json                           | removida     |
| `QUOTATION_BLOB_READ_WRITE_TOKEN` do .env                            | removido     |
| `quotation-lifecycle-repository.ts`: referências a `issuedDocuments` | simplificado |

## O que fica

- `/api/quotation-preview` — HTML on-the-fly, sem alterações
- Templates (`quotation-templates.ts`) — sem alterações
- Lifecycle endpoints: `setStatus`, `createRevision` — sem alterações de contrato
- Preview no detail page: botão "Visualizar" abre HTML em nova aba

## Frontend

### QuotationDetailPage.tsx

- Botão "Emitir PDF definitivo" → "Emitir orçamento" (chama `setStatus('enviado')`)
- Botão "Abrir PDF emitido" → "Visualizar" (abre `/api/quotation-preview` em nova aba)
- Badge "PDF definitivo arquivado · XXX KB" → removido
- Campo `issued_document` removido do tipo `QuotationData`
- `issuePdf` callback → substituído por chamada ao lifecycle `setStatus`

### QuotationsPage.tsx

- Ícone `FileText` (abrir PDF) já está condicionado a `!coreMode` — sem alteração

## ORC-20260001

Revertido para `rascunho` (SQL direto ou script). Registro `issued_document` deletado.

## Migração do banco

Remover tabela `issued_documents`. Como estamos em desenvolvimento e só
existe 1 registro de teste, um `DROP TABLE IF EXISTS issued_documents`
manual é suficiente. O Drizzle schema é atualizado para não referenciar
a tabela.

## Rollback

Não há rollback automatizado. Se precisar restaurar PDF futuramente,
o código está no histórico do git. O blob estará vazio e precisaria
ser recriado.

## Riscos

- **Nenhum.** O preview HTML já funciona. A transição de status já funciona.
  É só remover código morto e renomear botões.
