# Spec: WhatsApp Inbox Identity & Attachments Refactor

## Objective

Refatorar a inbox do WhatsApp para reduzir fragilidade estrutural e remover heurísticas desnecessárias em três áreas que hoje estão acopladas demais: identidade da conversa, modelagem de anexos e vínculo comercial com orçamento.

O sistema alvo deve tratar a conversa como uma entidade de canal independente de telefone, tratar anexos como dados de primeira classe dentro da mensagem e persistir contexto comercial explícito no momento do envio de PDFs de orçamento. O objetivo não é “descobrir depois” quem é o cliente pelo nome do arquivo, mas registrar corretamente, no momento do envio, que aquela mensagem outbound contém o orçamento X ligado ao cliente Y.

### Success story principal

- Um operador abre a inbox.
- A conversa existe mesmo sem telefone confiável.
- A thread mostra texto e também cards simples para imagem/documento/áudio.
- Quando o Aspen envia um orçamento em PDF, a própria mensagem outbound já fica registrada com metadado explícito de negócio (`quotationId`, `leadId`/`customerId`, `documentRole=quotation_pdf`).
- O painel comercial consegue mostrar “esta conversa já teve o orçamento ORC-... enviado” sem parsing frágil do nome do arquivo.
- Telefone continua sendo atributo opcional e nunca merge key da conversa.

## Tech Stack

- Frontend: React 19 + Vite 6 + TypeScript
- Backend: Node.js ESM em funções Vercel locais (`api/_functions/*.ts`)
- Storage atual: Vercel KV / store baseado em arrays JSON
- Tests: `node --test` para unit/integration local + Playwright para UI
- Provider atual: Evolution API

## Commands

```bash
# frontend dev
npm run dev

# api local
node scripts/dev-api-server.mjs

# unit tests
npm run test:unit

# focused UI tests for inbox
npx playwright test tests/whatsapp-inbox.spec.js

# lint
npm run lint

# production build
npm run build
```

## Project Structure

```text
src/pages/WhatsAppInboxPage.tsx
  → UI principal da inbox: lista de conversas, thread, painel comercial

src/lib/whatsappInboxApi.ts
  → Tipos e cliente HTTP usados pelo frontend da inbox

src/lib/formatters.ts
  → Formatação visual de telefone/data/valores

api/_functions/whatsapp-conversations.ts
  → Endpoint principal da inbox (GET/POST/PATCH)

api/_functions/lib/whatsapp-conversations-store.ts
  → Modelo persistido de conversa/mensagem no store atual

api/_functions/lib/whatsapp-conversations-sync.ts
  → Normalização de chats e mensagens vindos da Evolution

api/_functions/lib/whatsapp-identity-resolver.ts
  → Regras de identidade WhatsApp: provider conversation id, canonicalPhone, displayLabel

api/_functions/send-whatsapp.ts
  → Envios de mensagens/documentos pelo fluxo comercial

api/_functions/lib/whatsapp-crm-match.ts
  → Matching de conversa com Lead/Cliente no ERPNext

tests/unit/*.test.ts
  → Testes unitários de store, formatter, resolver e sync

tests/whatsapp-inbox.spec.js
  → Cobertura E2E da experiência da inbox

docs/superpowers/specs/
  → Specs arquiteturais como esta
```

## Code Style

O estilo alvo é o já usado no projeto: funções pequenas, ESM explícito, payloads simples, sem abstrações “framework internas” novas, e sem criar engines genéricas quando um fluxo específico resolve o problema.

### Example

```ts
export interface WhatsappAttachment {
  id: string;
  kind: 'image' | 'document' | 'audio';
  mimeType: string;
  fileName: string;
  mediaUrl: string;
  caption: string;
  origin: 'provider' | 'internal_generated';
  documentRole: 'quotation_pdf' | 'generic_document' | null;
  quotationId: string | null;
  leadId: string | null;
  customerId: string | null;
}

export interface WhatsappMessage {
  id: string;
  conversationId: string;
  providerMessageId: string;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'document' | 'audio' | 'unknown';
  body: string;
  timestamp: string;
  attachments: WhatsappAttachment[];
}
```

### Conventions

- `providerConversationId` é a identidade externa da conversa; `canonicalPhone` nunca é chave primária nem merge key.
- `null` é preferido a string vazia para metadado de negócio ausente quando o dado é semântico (`quotationId`, `customerId`, `documentRole`).
- Evitar “engines” genéricas de reconciliação; preferir regras explícitas e escopo limitado.
- Não inferir telefone de anexos.
- Não criar camada de viewer/preview pesado para anexos se um card simples resolve a operação.

## Testing Strategy

### Frameworks

- Unit/integration local: `node --test`
- UI regression / behavior: Playwright

### Test locations

- `tests/unit/formatters.test.ts` → formatação visual e regressões de número
- `tests/unit/whatsapp-conversations-store.test.ts` → merge, persistência, invariantes de identidade
- `tests/unit/whatsapp-conversations-sync.test.ts` → normalização de provider payloads
- `tests/unit/whatsapp-identity-resolver.test.ts` → regras de identidade e conflitos
- `tests/whatsapp-inbox.spec.js` → thread, cards, fallback visual, comportamento da inbox

### Required test levels by concern

#### Identity refactor

Must have:

- unit test garantindo que conversa não é mais mergeada por telefone
- unit test garantindo que `providerConversationId` é a única referência de merge da conversa
- regression test garantindo que `canonicalPhone` continua nullable e não reaparece como fallback falso

#### Attachment modeling

Must have:

- unit test para normalizar imagem/documento/áudio em `attachments[]`
- unit test para preservar `fileName`, `mimeType`, `caption`, `documentRole`
- UI test para renderizar card de anexo em vez de `[document]` / `[image]`

#### Outbound quotation persistence

Must have:

- unit/integration test que prova que o envio de PDF gera mensagem outbound persistida na thread
- assertion de que a mensagem outbound persiste `quotationId` e `documentRole=quotation_pdf`
- UI test mostrando card de orçamento em conversa que já teve envio Aspen

### Coverage expectation

Não há meta percentual formal nova. A regra é: toda mudança estrutural nova precisa de teste de regressão cobrindo o comportamento que remove fragilidade.

## Boundaries

### Always

- Tratar `providerConversationId` como identidade externa da conversa.
- Manter `canonicalPhone` como atributo opcional e provenance-aware.
- Persistir contexto comercial explícito no momento do envio de orçamento.
- Renderizar anexos como cards simples e estáveis.
- Rodar `npm run test:unit`, `npx playwright test tests/whatsapp-inbox.spec.js` e `npm run build` antes de concluir a implementação.
- Seguir ESM com imports `.js` nos arquivos backend.

### Ask first

- Migrar o store atual de KV para banco relacional ou outra infraestrutura.
- Adicionar dependência nova de chat UI / media viewer / upload stack.
- Expandir o escopo para reconciliação genérica de todo documento inbound.
- Introduzir multi-instance WhatsApp se isso exigir mudança de identidade global.

### Never

- Nunca usar telefone como merge key da conversa.
- Nunca sobrescrever telefone automaticamente por causa de PDF/nome de arquivo.
- Nunca tratar parsing de filename como fonte primária de verdade quando o sistema poderia persistir metadado explícito no send path.
- Nunca criar um “scoring engine” genérico para documentos nesta refatoração.
- Nunca ocultar side effects comerciais em um simples GET da inbox.

## Success Criteria

A refatoração será considerada concluída quando estas condições forem verdadeiras:

1. **Identity invariant**
   - `upsertWhatsappConversation` não usa mais `phone` para encontrar ou mergear conversa existente.
   - Conversas continuam estáveis com `providerConversationId` mesmo quando `canonicalPhone` está vazio.

2. **Attachment model**
   - Mensagens da inbox deixam de depender apenas de `mediaUrl` escalar.
   - Cada mensagem suporta `attachments[]` com metadado explícito suficiente para UI e contexto de negócio.

3. **Outbound quotation persistence**
   - Ao enviar um orçamento PDF pelo Aspen, o sistema persiste na thread uma mensagem outbound com attachment do tipo documento.
   - Essa mensagem registra explicitamente `quotationId` e `documentRole=quotation_pdf`.
   - Se existir `leadId` ou `customerId` conhecido no momento do envio, ele é persistido junto à mensagem/anexo.

4. **UI behavior**
   - A inbox mostra cards simples para documentos/imagens/áudio.
   - PDFs de orçamento enviados pelo Aspen aparecem visualmente distintos de documentos genéricos.
   - A inbox não precisa abrir inline o arquivo para estar “correta”.

5. **Reconciliation boundary**
   - PDFs de orçamento gerados pelo Aspen podem fornecer contexto forte para o painel comercial.
   - Documentos genéricos inbound/outbound não geram reconciliação automática forte.
   - Telefone não é alterado automaticamente por causa de attachment metadata.

6. **Complexity reduction**
   - Nenhuma engine genérica de score/reconciliação é introduzida.
   - O GET da inbox não cria side effects novos de vínculo comercial.
   - A nova modelagem substitui heurística frágil em vez de empilhar mais heurística.

## Proposed Data Model Direction

### Conversations

Keep the current conversation layer, but tighten invariants:

```ts
interface WhatsappConversation {
  id: string;
  providerConversationId: string;
  canonicalPhone: string;
  displayLabel: string;
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
  linkedQuotationId?: string | null;
  linkedCrmEntityId?: string | null;
  linkedCrmEntityType?: 'lead' | 'cliente' | null;
}
```

Key rule: `canonicalPhone` is not a lookup key.

### Messages

Messages become the durable event log of the thread:

```ts
interface WhatsappMessage {
  id: string;
  conversationId: string;
  providerMessageId: string;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'document' | 'audio' | 'unknown';
  body: string;
  timestamp: string;
  attachments: WhatsappAttachment[];
}
```

### Attachments

Attachments are first-class objects nested under messages in the current store model. No separate generic reconciliation subsystem is introduced.

```ts
interface WhatsappAttachment {
  id: string;
  kind: 'image' | 'document' | 'audio';
  mimeType: string;
  fileName: string;
  mediaUrl: string;
  caption: string;
  origin: 'provider' | 'internal_generated';
  documentRole: 'quotation_pdf' | 'generic_document' | null;
  quotationId: string | null;
  leadId: string | null;
  customerId: string | null;
}
```

### Why nested `attachments[]` instead of a top-level attachment store?

Because the current system is KV/array-backed, and a nested attachment object removes fragility without inventing a new persistence subsystem. This is the minimum structural change that still gives attachments first-class semantics.

## Risks and Non-Goals

### Risks

- Existing legacy messages with only `mediaUrl` will need compatibility mapping during read/render.
- Provider sync and send path may race; idempotency rules for outbound message persistence must be explicit.
- Evolution media URLs may expire; the first version should treat them as display metadata, not guaranteed permanent assets.

### Non-goals

- No full media viewer.
- No generic document intelligence pipeline.
- No automatic phone correction from PDFs.
- No migration to Meta Cloud API in this spec.
- No replacement of the custom inbox with a third-party chat kit.

## Open Questions

None blocking for the spec.

If later required, these are follow-up design topics, not blockers for this refactor:

- multi-instance WhatsApp identity keying
- whether CRM matching should become explicit/manual instead of side-effectful on read
- whether expiring media URLs need a proxy layer
