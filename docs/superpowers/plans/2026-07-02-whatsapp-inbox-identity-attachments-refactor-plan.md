# Implementation Plan: WhatsApp Inbox Identity & Attachments Refactor

## Overview

Implementar uma refatoração estrutural da inbox do WhatsApp para remover fragilidade em três frentes: identidade da conversa, modelagem de anexos e persistência explícita de contexto comercial no envio de orçamento PDF. A direção é trocar heurísticas implícitas por invariantes simples: conversa identificada por `providerConversationId`, telefone como atributo opcional, anexos como dados de primeira classe, e PDFs de orçamento registrados com metadado de negócio no momento do envio.

## Architecture Decisions

- **Conversation identity is provider-based, not phone-based.** `canonicalPhone` deixa de participar do merge/lookup da conversa.
- **Attachments stay nested under messages in the current KV model.** Isso reduz fragilidade sem introduzir um novo subsistema de persistência.
- **Quotation PDF linkage is explicit at send time.** Não vamos depender de parsing posterior de filename como fonte primária.
- **The inbox remains custom.** Não trocar para chat UI kit nem introduzir viewer complexo de mídia.
- **Generic document reconciliation is out of scope.** PDFs genéricos e inbound continuam fracos/sugestivos ou ignorados.
- **GET endpoints are strictly read-only.** Se o CRM match continuar existindo, ele deve ser leitura/sugestão, nunca persistência implícita por visualização.

## Dependency Graph

```text
Conversation identity invariant
    │
    ├── Attachment-capable message model
    │       │
    │       ├── Provider sync normalization
    │       ├── Outbound quotation send persistence
    │       └── Frontend API types
    │               │
    │               └── Inbox attachment cards + quotation context UI
    │
    └── CRM/read-side behavior cleanup
```

Implementation order follows this graph: fix identity invariants first, then message/attachment modeling, then the two write/read paths (sync + send), then UI rendering, then cleanup of read-side commercial linkage behavior.

## Task List

### Phase 1: Foundation

- [ ] **Task 1: Remove phone-based conversation merge and lock identity invariants**
  - **Description:** Remove o acoplamento residual entre identidade da conversa e telefone, garantindo que o merge de conversas seja baseado apenas em `providerConversationId`.
  - **Acceptance:**
    - `upsertWhatsappConversation` não encontra nem mergeia conversa existente por telefone.
    - Conversas permanecem estáveis quando `providerConversationId` é o mesmo e `canonicalPhone` muda ou desaparece.
    - O cleanup legado para conversas `@lid` unresolved continua funcionando.
  - **Verify:**
    - Tests pass: `node --test tests/unit/whatsapp-conversations-store.test.ts`
    - Tests pass: `node --test tests/unit/whatsapp-conversations-sync.test.ts`
    - Build succeeds: `npm run build`
  - **Dependencies:** None
  - **Files likely touched:**
    - `api/_functions/lib/whatsapp-conversations-store.ts`
    - `tests/unit/whatsapp-conversations-store.test.ts`
    - `tests/unit/whatsapp-conversations-sync.test.ts`
  - **Estimated scope:** Small

- [ ] **Task 2: Introduce first-class attachments in the message/store model with compatibility mapping**
  - **Description:** Evolui o modelo de mensagem para suportar `attachments[]` sem quebrar o legado que hoje depende de `mediaUrl` escalar.
  - **Acceptance:**
    - `WhatsappMessage` suporta `attachments[]` junto com os metadados atuais.
    - Mensagens legadas com apenas `mediaUrl` continuam legíveis durante a transição.
    - O attachment inclui `kind`, `mimeType`, `fileName`, `mediaUrl`, `caption`, `origin`, `documentRole` e business refs.
  - **Verify:**
    - Tests pass: `node --test tests/unit/whatsapp-conversations-store.test.ts`
    - Tests pass: `node --test tests/unit/whatsapp-conversations-sync.test.ts`
    - Build succeeds: `npm run build`
  - **Dependencies:** Task 1
  - **Files likely touched:**
    - `api/_functions/lib/whatsapp-conversations-store.ts`
    - `api/_functions/lib/whatsapp-conversations-sync.ts`
    - `src/lib/whatsappInboxApi.ts`
    - `tests/unit/whatsapp-conversations-store.test.ts`
    - `tests/unit/whatsapp-conversations-sync.test.ts`
  - **Estimated scope:** Medium

### Checkpoint: Foundation

- [ ] `npm run test:unit`
- [ ] `npm run build`
- [ ] Identity no longer uses phone as merge key
- [ ] Attachment model exists without breaking legacy reads
- [ ] Review with human before proceeding if the model shape drifted from the spec

### Phase 2: Message Paths

- [ ] **Task 3: Normalize provider media into attachment objects during sync**
  - **Description:** Faz o caminho inbound/provider produzir attachments first-class em vez de depender só de `mediaUrl`.
  - **Acceptance:**
    - Mensagens inbound/provider de tipo image/document/audio populam `attachments[]` em vez de depender apenas de `mediaUrl` escalar.
    - Document attachments preservam filename/mime/caption quando presentes no payload do provider.
    - `body` continua funcionando como fallback de texto/caption sem exigir viewer.
  - **Verify:**
    - Tests pass: `node --test tests/unit/whatsapp-conversations-sync.test.ts`
    - Tests pass: `node --test tests/unit/whatsapp-conversations-store.test.ts`
    - Manual check: uma mensagem sincronizada com mídia/documento aparece no payload persistido com `attachments[]`
  - **Dependencies:** Task 2
  - **Files likely touched:**
    - `api/_functions/lib/whatsapp-conversations-sync.ts`
    - `api/_functions/lib/whatsapp-conversations-store.ts`
    - `tests/unit/whatsapp-conversations-sync.test.ts`
    - `tests/unit/whatsapp-conversations-store.test.ts`
  - **Estimated scope:** Small

- [ ] **Task 4: Persist outbound quotation PDFs as inbox messages with explicit business metadata**
  - **Description:** Faz o send path do orçamento registrar uma mensagem outbound real na thread, com attachment document e metadado explícito de negócio.
  - **Acceptance:**
    - Enviar um quotation PDF cria uma mensagem outbound no conversation store.
    - A mensagem outbound inclui document attachment com `documentRole=quotation_pdf`.
    - A mensagem/anexo persiste `quotationId` explicitamente.
    - `leadId` e `customerId` são persistidos separadamente quando conhecidos com confiança no send path; caso contrário, permanecem `null`.
    - O design não depende de parsing de filename para estabelecer vínculo com orçamento.
  - **Verify:**
    - Tests pass: focused send/flow tests (new or existing) for quotation PDF path
    - Tests pass: `npm run test:unit`
    - Build succeeds: `npm run build`
    - Manual check: after a local quotation send flow, the conversation history contains the outbound PDF message record
  - **Dependencies:** Task 2
  - **Files likely touched:**
    - `api/_functions/send-whatsapp.ts`
    - `api/_functions/lib/whatsapp-conversations-store.ts`
    - `tests/unit/send-whatsapp*.test.ts` or new focused test file
    - `tests/unit/whatsapp-conversations-store.test.ts`
  - **Estimated scope:** Medium

### Checkpoint: Message Paths

- [ ] `npm run test:unit`
- [ ] `npm run build`
- [ ] Synced media uses `attachments[]`
- [ ] Outbound quotation PDF is durably recorded in the thread
- [ ] No new filename-parsing dependency was introduced

### Phase 3: UI and Read-Side Behavior

- [ ] **Task 5: Render attachment cards in the inbox thread and keep UI intentionally simple**
  - **Description:** Troca placeholders crus (`[document]`, `[image]`) por cards simples de anexo, sem viewer inline nem nova lib de chat.
  - **Acceptance:**
    - Mensagens de texto continuam renderizando normalmente.
    - Image/document/audio renderizam como cards simples, não placeholders crus.
    - Quotation PDFs enviados pelo Aspen ficam visualmente distintos de documentos genéricos.
    - Nenhum viewer inline, download manager complexo ou nova chat UI dependency é introduzido.
  - **Verify:**
    - Tests pass: `npx playwright test tests/whatsapp-inbox.spec.js`
    - Tests pass: `npm run test:unit`
    - Manual check: a thread mostra card de documento para quotation PDF e card genérico para outros attachments
  - **Dependencies:** Task 3, Task 4
  - **Files likely touched:**
    - `src/pages/WhatsAppInboxPage.tsx`
    - `src/lib/whatsappInboxApi.ts`
    - `tests/whatsapp-inbox.spec.js`
  - **Estimated scope:** Small

- [ ] **Task 6: Make quotation/business context explicit in the inbox while making GET read-only**
  - **Description:** Expõe contexto comercial explícito de orçamento na UI e remove write-side coupling das leituras da inbox.
  - **Acceptance:**
    - O painel comercial consegue mostrar contexto explícito de orçamento a partir de outbound quotation attachments/messages.
    - Documentos genéricos não disparam reconciliação automática forte.
    - Telefone nunca é sobrescrito por attachment metadata.
    - GET/read flows são estritamente read-only: qualquer CRM match retornado por eles é suggestion-only e nunca persiste hidden linkage state.
  - **Verify:**
    - Tests pass: `npx playwright test tests/whatsapp-inbox.spec.js`
    - Tests pass: focused unit tests for `whatsapp-crm-match` / inbox endpoint behavior
    - Manual check: opening the inbox does not create, clear, or mutate CRM linkage state
  - **Dependencies:** Task 4, Task 5
  - **Files likely touched:**
    - `api/_functions/whatsapp-conversations.ts`
    - `api/_functions/lib/whatsapp-crm-match.ts`
    - `src/pages/WhatsAppInboxPage.tsx`
    - `tests/whatsapp-inbox.spec.js`
    - `tests/unit/whatsapp-crm-match*.test.ts` or new focused endpoint test
  - **Estimated scope:** Medium

### Checkpoint: Complete

- [ ] `npm run test:unit`
- [ ] `npx playwright test tests/whatsapp-inbox.spec.js`
- [ ] `npm run build`
- [ ] Inbox works with unresolved identity, synced media, and outbound quotation PDFs
- [ ] Conversation identity is provider-based only
- [ ] Ready for review

## Risks and Mitigations

| Risk                                                                 | Impact | Mitigation                                                                                                                                |
| -------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Sync and send create duplicate outbound message records              | High   | Define idempotency around `providerMessageId` where available and a deterministic local fallback for send-time persistence                |
| Evolution payloads omit filename/mime for some media                 | Medium | Treat attachment metadata as best-effort for provider media and require explicit metadata only for internally generated quotation PDFs    |
| Legacy messages/conversations break after shape change               | High   | Keep compatibility mapping during read path and cover legacy fixtures in unit tests                                                       |
| GET-side CRM match still performs hidden persistence                 | Medium | Remove read-path writes entirely in Task 6 and verify GET remains suggestion-only                                                         |
| KV array storage introduces race conditions for concurrent send/sync | Medium | Keep tasks scoped to model semantics first; document concurrency limitations and avoid inventing a new persistence layer in this refactor |

## Open Questions

None blocking for implementation.

Resolved for this plan:

- Task 6 removes GET-side CRM persistence; read paths stay suggestion-only.
- Task 4 persists `quotationId` always and `leadId`/`customerId` separately when known with confidence at send time; otherwise they remain `null`.
