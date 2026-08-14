# Ciclo de Emissão e Entrega de Orçamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar rascunho local, prévia PDF, emissão comercial idempotente e entrega WhatsApp auditável.

**Architecture:** O PostgreSQL mantém revisões emitidas, tentativas idempotentes e resumos permanentes de entrega.
O frontend mantém rascunhos locais e chama interfaces explícitas de prévia, emissão e entrega.
PDF continua derivado do snapshot imutável, enquanto KV permanece somente como lease atômica do transporte WhatsApp.

**Tech Stack:** React 19, TypeScript, Node.js ESM, Drizzle ORM, PostgreSQL, Vercel Functions, Playwright e `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-13-ciclo-emissao-entrega-orcamento-design.md`

## Global Constraints

- Ler `CONTEXT.md` e a spec antes de cada tarefa.
- Não adicionar dependências.
- Não armazenar PDF como Blob.
- Não adicionar worker, cron ou fila.
- Não alterar `aspen-vault`.
- Não expor erros, payloads ou credenciais da Evolution.
- Staging mantém provedores externos desativados e egress bloqueado.
- `/api/orcamento` permanece compatível durante a transição.
- Novas escritas usam `emitido`; `enviado` é alias temporário de leitura.
- O fluxo WhatsApp contém exatamente um `quotation_pdf` e deve caber em 45 segundos estimados.
- Link público expira com a validade comercial, limitado a 30 dias.
- Operação incompleta é retomável por 30 dias; diagnósticos ficam disponíveis por 90 dias.
- Nenhum commit, push, migration aplicada, deploy, configuração ou envio real sem autorização explícita separada.
- A árvore atual contém alterações não commitadas de PDF/envio.
Antes da execução, criar worktree via `superpowers:using-git-worktrees` somente após definir como essas alterações entrarão na baseline.
- Cada tarefa usa red-green-refactor e termina com revisão read-only.
- Máximo de três rounds de review/fix.
- Não reabrir Task 9, parser legado ou corpus de aceite protegido.

## File Map

### Banco e domínio

- Create: `api/_lib/quotation-status.ts` - normalização e transições comerciais canônicas, reutilizáveis sem depender do banco.
- Create: `api/_db/quotation-issue-repository.ts` - idempotência, pricing autoritativo e emissão transacional.
- Create: `api/_db/quotation-delivery-repository.ts` - resumo permanente e retenção oportunística da entrega.
- Modify: `api/_db/schema.ts` - campos de emissão e novas tabelas.
- Modify: `api/_db/quotation-lifecycle-repository.ts` - transições `emitido`, nova revisão e perda com motivo.
- Modify: `api/_db/quote-draft-management-repository.ts` - projeção canônica, validade e bloqueio de exclusão.
- Modify: `api/_db/quote-leads-repository.ts` - conversão atômica do lead na emissão.
- Create: `drizzle/0019_quotation_issue_delivery.sql` - status, campos, tabelas e backfill `enviado` para `emitido`.
- Modify: `drizzle/meta/_journal.json` e snapshot `0019` - artefatos gerados pelo Drizzle, nunca editados manualmente.

### API e documento

- Create: `api/_functions/quotation-issues.ts` - POST idempotente e GET read-only da tentativa.
- Create: `api/_functions/lib/quotation-issue-core.ts` - parsing, fingerprint e orquestração da emissão.
- Create: `api/_functions/lib/quotation-draft-snapshot.ts` - canonicalização compartilhada por prévia e emissão.
- Modify: `api/_functions/quotation-preview.ts` - responder PDF real para draft efêmero.
- Modify: `api/_functions/lib/quotation-pdf-renderer.ts` - interface única `renderQuotationPdf`.
- Modify: `api/_functions/public-quotation.ts` - TTL limitado pela validade.
- Modify: `api/[...path].ts`, `scripts/dev-api-server.mjs`, `scripts/app-server.mjs` - registrar `quotation-issues`.

### Entrega

- Create: `api/_functions/lib/quotation-delivery.ts` - validação e interface `deliverQuotation`.
- Modify: `api/_functions/send-whatsapp-flow.ts` - exigir revisão emitida, um PDF, orçamento de tempo e resumo PostgreSQL.
- Modify: `api/_functions/send-whatsapp.ts` - contexto emitido e erros seguros de PDF.
- Modify: `api/_functions/whatsapp-send-status.ts` - recuperar resumo PostgreSQL e reconciliar lease KV.
- Modify: `api/_functions/lib/whatsapp-send-reservation-store.ts` - retenções de 30 e 90 dias sem mudar a função de lease.

### Frontend

- Modify: `src/types/domain.ts` - tipos serializáveis do draft e projeção de emissão.
- Create: `src/lib/autoQuoteDraftStorage.ts` - versão, validação e restauração de `aspen_drafts`.
- Create: `src/lib/quotationIssueApi.ts` - POST/GET da emissão.
- Modify: `src/lib/communicationApi.ts` - contrato público de entrega.
- Modify: `src/lib/communicationSend.ts` - estados comerciais canônicos.
- Modify: `src/pages/AutoQuotePage.tsx` - restaurar, visualizar PDF, emitir, recuperar e iniciar nova revisão.
- Modify: `src/components/SplitResultCard.tsx` - estados mutável e emitido.
- Modify: `src/pages/QuotationDetailPage.tsx` - emissão manual, entrega separada, perda e exclusão restrita.
- Modify: `src/components/WhatsAppSendPanel.tsx` - estados aceito, retry e reconciliação.

### Testes

- Create: `tests/unit/quotation-status.test.ts`.
- Create: `tests/unit/quotation-issue-postgres.test.ts`.
- Create: `tests/unit/quotation-issues.test.ts`.
- Create: `tests/unit/quotation-delivery-postgres.test.ts`.
- Create: `tests/unit/auto-quote-draft-storage.test.ts`.
- Create: `tests/quotation-issue.spec.js`.
- Modify: `tests/unit/quotation-schema.test.ts`.
- Modify: `tests/unit/quotation-preview.test.ts`.
- Modify: `tests/unit/quotation-lifecycle-postgres.test.ts`.
- Modify: `tests/unit/public-quotation.test.ts`.
- Modify: `tests/unit/send-whatsapp.test.ts`.
- Modify: `tests/unit/send-whatsapp-idempotency.test.ts`.
- Modify: `tests/unit/whatsapp-send-status.test.ts`.
- Modify: `tests/unit/communication-api.test.ts`.
- Modify: `tests/unit/communication-send.test.ts`.
- Modify: `tests/quotation-lifecycle.spec.js`.

---

### Task 1: Canonicalizar estados comerciais

**Files:**

- Create: `api/_lib/quotation-status.ts`
- Modify: `api/_db/quotation-lifecycle-repository.ts`
- Modify: `api/_db/quote-draft-management-repository.ts`
- Modify: `src/lib/communicationSend.ts`
- Create: `tests/unit/quotation-status.test.ts`
- Modify: `tests/unit/quotation-lifecycle-postgres.test.ts`
- Modify: `tests/unit/communication-send.test.ts`

**Interfaces:**

- Produces: `canonicalQuotationStatus(value): QuotationStatus`.
- Produces: `isIssuedQuotationStatus(value): boolean`.
- Produces: `assertQuotationTransition(from, to, lossReason?): void`.
- Produces: escrita somente de `rascunho | emitido | aprovado | perdido`.

- [ ] **Step 1: Write failing canonical-status tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertQuotationTransition,
  canonicalQuotationStatus,
  isIssuedQuotationStatus,
} from '../../api/_lib/quotation-status.js';

test('enviado is a read alias for emitido', () => {
  assert.equal(canonicalQuotationStatus('enviado'), 'emitido');
  assert.equal(isIssuedQuotationStatus('enviado'), true);
});

test('new writes reject enviado', () => {
  assert.throws(
    () => assertQuotationTransition('rascunho', 'enviado'),
    /Estado comercial inválido/,
  );
});

test('perdido requires a reason', () => {
  assert.throws(
    () => assertQuotationTransition('emitido', 'perdido'),
    /motivo/i,
  );
  assert.doesNotThrow(() => assertQuotationTransition('emitido', 'perdido', 'Preço'));
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-status.test.ts`
Expected: FAIL because `api/_lib/quotation-status.ts` does not exist.

- [ ] **Step 3: Implement the minimal state module**

```ts
export type QuotationStatus = 'rascunho' | 'emitido' | 'aprovado' | 'perdido';

export function canonicalQuotationStatus(value: unknown): QuotationStatus {
  if (value === 'enviado') return 'emitido';
  if (value === 'rascunho' || value === 'emitido' || value === 'aprovado' || value === 'perdido') return value;
  throw new Error('Estado comercial inválido.');
}

export function isIssuedQuotationStatus(value: unknown): boolean {
  const status = canonicalQuotationStatus(value);
  return status === 'emitido' || status === 'aprovado';
}

export function assertQuotationTransition(from: unknown, to: unknown, lossReason?: string): void {
  const source = canonicalQuotationStatus(from);
  if (to === 'enviado') throw new Error('Estado comercial inválido.');
  const target = canonicalQuotationStatus(to);
  const allowed = source === 'rascunho'
    ? target === 'emitido'
    : source === 'emitido'
      ? target === 'aprovado' || target === 'perdido'
      : false;
  if (!allowed) throw new Error('Transição comercial inválida.');
  if (target === 'perdido' && !lossReason?.trim()) throw new Error('Informe o motivo da perda.');
}
```

- [ ] **Step 4: Route lifecycle and frontend guards through the module**

Replace literal `enviado` transitions with canonical reads and `emitido` writes.
Make deletion return conflict unless the aggregate and latest revision are both `rascunho`.
Keep API output compatibility only through explicit `status_legacy` if an existing caller still proves necessary.

- [ ] **Step 5: Verify GREEN and regressions**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-status.test.ts tests/unit/quotation-lifecycle-postgres.test.ts tests/unit/communication-send.test.ts`
Expected: PASS.

- [ ] **Step 6: Review gate**

Check that no new database write contains `'enviado'` and that `aprovado` remains sendable.

- [ ] **Step 7: Commit only after authorization**

```bash
git add api/_lib/quotation-status.ts api/_db/quotation-lifecycle-repository.ts api/_db/quote-draft-management-repository.ts src/lib/communicationSend.ts tests/unit/quotation-status.test.ts tests/unit/quotation-lifecycle-postgres.test.ts tests/unit/communication-send.test.ts
git commit -m "refactor: canonicalize quotation status"
```

### Task 2: Add schema and reversible status migration

**Files:**

- Modify: `api/_db/schema.ts`
- Create: `drizzle/0019_quotation_issue_delivery.sql`
- Modify generated: `drizzle/meta/_journal.json`
- Create generated: `drizzle/meta/0019_snapshot.json`
- Modify: `tests/unit/quotation-schema.test.ts`

**Interfaces:**

- Consumes: `QuotationStatus` from Task 1.
- Produces: `quotationIssueRequests`, `quotationDeliveries`, `issuedAt`, `lossReason` schema exports.

- [ ] **Step 1: Add failing schema assertions**

```ts
import {
  quotationDeliveries,
  quotationIssueRequests,
  quotations,
  quoteRevisions,
} from '../../api/_db/schema.js';

assert.ok(quotationIssueRequests.idempotencyKey);
assert.ok(quotationIssueRequests.fingerprint);
assert.ok(quotationDeliveries.revisionId);
assert.ok(quotations.lossReason);
assert.ok(quoteRevisions.issuedAt);
```

Also assert unique indexes for `idempotency_key` and `revision_id` and check constraints for the approved state sets.

- [ ] **Step 2: Verify RED**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-schema.test.ts`
Expected: FAIL because schema exports and fields are absent.

- [ ] **Step 3: Add exact Drizzle tables and fields**

```ts
export const quotationIssueRequests = pgTable('quotation_issue_requests', {
  id: uuid('id').primaryKey(),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  fingerprint: text('fingerprint').notNull(),
  state: text('state').notNull(),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  publicError: text('public_error'),
  quotationId: uuid('quotation_id').references(() => quotations.id),
  revisionId: uuid('revision_id').references(() => quoteRevisions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const quotationDeliveries = pgTable('quotation_deliveries', {
  id: uuid('id').primaryKey(),
  revisionId: uuid('revision_id').notNull().unique().references(() => quoteRevisions.id),
  phone: text('phone').notNull(),
  flowId: text('flow_id').notNull(),
  state: text('state').notNull(),
  providerAcceptanceId: text('provider_acceptance_id'),
  publicError: text('public_error'),
  diagnosticsExpiresAt: timestamp('diagnostics_expires_at', { withTimezone: true }),
  resumableUntil: timestamp('resumable_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
```

Add `issued_at` to quotations and revisions, plus `loss_reason` to quotations.
Use checks for issue states `processing | retryable | completed` and delivery states `pending | transporting | accepted_partial | completed | retryable | reconciling`.

- [ ] **Step 4: Generate migration artifacts**

Run: `npm run db:generate -- --name quotation_issue_delivery`
Expected: `0019_quotation_issue_delivery.sql`, journal entry 19 and `0019_snapshot.json` generated.

Inspect SQL and add only the required data migration before tightening checks:

```sql
UPDATE "quotations" SET "status" = 'emitido' WHERE "status" = 'enviado';
UPDATE "quote_revisions" SET "status" = 'emitido' WHERE "status" = 'enviado';
```

Do not run `npm run db:migrate` without separate authorization.

- [ ] **Step 5: Test migration in disposable PostgreSQL**

Create a clean database, apply through `0018`, insert one `rascunho` and one `enviado`, apply `0019`, then assert:

```sql
SELECT status FROM quotations ORDER BY status;
-- emitido, rascunho
```

Rerun migration tooling and confirm no-op.

- [ ] **Step 6: Verify GREEN**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit only after authorization**

```bash
git add api/_db/schema.ts drizzle/0019_quotation_issue_delivery.sql drizzle/meta/_journal.json drizzle/meta/0019_snapshot.json tests/unit/quotation-schema.test.ts
git commit -m "feat: add quotation issuance schema"
```

### Task 3: Share canonical draft snapshots and produce PDF previews

**Files:**

- Create: `api/_functions/lib/quotation-draft-snapshot.ts`
- Modify: `api/_functions/quotation-preview.ts`
- Modify: `api/_functions/lib/quotation-pdf-renderer.ts`
- Modify: `tests/unit/quotation-preview.test.ts`

**Interfaces:**

- Produces: `buildDraftQuotationSnapshot(input, dependencies): Promise<DraftQuotationSnapshot>`.
- Produces: `renderQuotationPdf(html): Promise<Buffer>` using the existing HTML-to-PDF renderer contract.
- Produces: POST `/api/quotation-preview` with `application/pdf` and no persistence.

Define the snapshot contract in the new module:

```ts
export interface DraftQuotationSnapshot {
  template: QuotationTemplate;
  viewModel: QuotationTemplateViewModel;
  authoritativeDraft: Record<string, unknown>;
  pricingDifferences: Array<{ path: string; expected: unknown; received: unknown }>;
}
```

Reuse `QuotationTemplate` and `QuotationTemplateViewModel` from `quotation-templates.ts`.
Render with `renderQuotationTemplate(snapshot.template, snapshot.viewModel)` and pass the resulting HTML to the existing PDF renderer.

- [ ] **Step 1: Change preview tests to require PDF bytes and zero writes**

```ts
test('POST renders an ephemeral PDF without persistence', async () => {
  let writes = 0;
  const response = await createQuotationPreviewHandler({
    resolveDraftTemplate: async () => template,
    renderPdf: async (snapshot) => {
      assert.equal(snapshot.business_number, 'Pré-visualização');
      return Buffer.from('%PDF-1.7 preview');
    },
    recordWrite: async () => { writes += 1; },
  })(post(validDraft));

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'application/pdf');
  assert.equal(writes, 0);
});
```

Retain invalid-client, empty-items and safe-error cases.

- [ ] **Step 2: Verify RED**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-preview.test.ts`
Expected: FAIL because POST currently returns HTML.

- [ ] **Step 3: Extract snapshot construction**

Move parsing and view-model construction out of `quotation-preview.ts` into:

```ts
export interface DraftSnapshotDependencies {
  now?: () => Date;
  resolveTemplate: (key: string, versionId?: string) => Promise<ResolvedQuotationTemplate>;
  resolvePricing?: PricingResolver;
}

export async function buildDraftQuotationSnapshot(
  input: unknown,
  dependencies: DraftSnapshotDependencies,
): Promise<DraftQuotationSnapshot>;
```

Set display number to `Pré-visualização` only when no issued business number is supplied.
Do not import any repository writer.

- [ ] **Step 4: Return PDF with safe headers**

```ts
return {
  statusCode: 200,
  isBase64Encoded: true,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="pre-visualizacao-orcamento.pdf"',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
  body: pdf.toString('base64'),
};
```

- [ ] **Step 5: Verify GREEN**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-preview.test.ts tests/unit/public-quotation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit only after authorization**

```bash
git add api/_functions/lib/quotation-draft-snapshot.ts api/_functions/quotation-preview.ts api/_functions/lib/quotation-pdf-renderer.ts tests/unit/quotation-preview.test.ts
git commit -m "feat: render ephemeral quote previews as PDF"
```

### Task 4: Implement idempotent quotation issuance

**Files:**

- Create: `api/_db/quotation-issue-repository.ts`
- Create: `api/_functions/lib/quotation-issue-core.ts`
- Create: `api/_functions/quotation-issues.ts`
- Modify: `api/_db/quote-leads-repository.ts`
- Modify: `api/[...path].ts`
- Modify: `scripts/dev-api-server.mjs`
- Modify: `scripts/app-server.mjs`
- Create: `tests/unit/quotation-issue-postgres.test.ts`
- Create: `tests/unit/quotation-issues.test.ts`

**Interfaces:**

- Consumes: `buildDraftQuotationSnapshot`, `renderQuotationPdf`, schema from Task 2.
- Produces: `issueQuotation(input): Promise<QuotationIssueResult>`.
- Produces: `readQuotationIssue(idempotencyKey): Promise<QuotationIssueStatus | null>`.
- Produces: POST/GET `/api/quotation-issues`.

Use these exact contracts in `quotation-issue-repository.ts` and re-export them from `quotation-issue-core.ts`:

```ts
export interface QuotationIssueInput {
  idempotencyKey: string;
  draft: unknown;
  sourceLeadId?: string;
  sourceQuotationId?: string;
  sourceRevisionId?: string;
}

export interface QuotationIssueResult {
  quotationId: string;
  businessNumber: string;
  revisionId: string;
  revisionNumber: number;
  status: 'emitido';
  issuedAt: string;
  validUntil: string;
  pdfUrl: string;
}

export type QuotationIssueStatus =
  | { state: 'processing'; retryAfterMs: number }
  | { state: 'retryable'; error: string }
  | ({ state: 'completed' } & QuotationIssueResult);
```

- [ ] **Step 1: Write repository RED tests**

Cover these cases with injected database, clock, UUID, renderer and pricing resolver:

```ts
test('same key and fingerprint returns the completed revision', async () => {
  const first = await repository.issue(input);
  const replay = await repository.issue(input);
  assert.deepEqual(replay, first);
  assert.equal(sequenceReservations, 1);
  assert.equal(revisionWrites, 1);
});

test('same key with different fingerprint conflicts', async () => {
  await repository.issue(input);
  await assert.rejects(
    repository.issue({ ...input, draft: changedDraft }),
    /conteúdo diferente/i,
  );
});

test('PDF failure rolls back number, revision and lead conversion', async () => {
  renderPdf = async () => { throw new Error('renderer down'); };
  await assert.rejects(repository.issue(input), /PDF/i);
  assert.equal(sequenceReservations, 0);
  assert.equal(revisionWrites, 0);
  assert.equal(convertedLeads, 0);
});
```

Also cover stale lease takeover with same key/fingerprint, active lease conflict, price divergence, missing `pagamento`, derived revision under the same business number and concurrent distinct keys.

- [ ] **Step 2: Verify RED**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-issue-postgres.test.ts`
Expected: FAIL because repository does not exist.

- [ ] **Step 3: Implement canonical fingerprint**

```ts
export function quotationIssueFingerprint(input: QuotationIssueInput): string {
  const canonical = canonicalizeQuotationDraft(input.draft);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
```

Canonicalization must sort object keys but preserve item and section order.
Exclude UI-only state, timestamps and the idempotency key.

- [ ] **Step 4: Implement the lease and transaction**

`issueQuotation` must:

1. insert/read `quotation_issue_requests` by key;
2. reject fingerprint mismatch;
3. return completed result;
4. reject non-expired `processing` lease with HTTP-level conflict information;
5. claim missing, `retryable` or expired lease;
6. canonicalize and validate draft;
7. start the existing quotation write-lock transaction;
8. re-read settings and authoritative pricing;
9. reserve candidate number or next revision;
10. render PDF inside the transaction using the candidate snapshot;
11. insert client/quotation/revision/items/activity;
12. convert lead;
13. mark issue `completed` in the same transaction.

On safe pre-commit failure, roll back and mark only the request `retryable` in a separate short transaction.
Never retain a business number from the rolled-back transaction.

- [ ] **Step 5: Write handler RED tests**

```ts
test('POST requires Idempotency-Key', async () => {
  const response = await handler(post(validDraft, {}), dependencies);
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /Idempotency-Key/);
});

test('GET is read-only', async () => {
  const response = await handler(get({ idempotency_key: key }), dependencies);
  assert.equal(response.statusCode, 200);
  assert.equal(issueCalls, 0);
});
```

Assert 409 for price mismatch/fingerprint conflict, 503 for PDF failure and safe Portuguese output.

- [ ] **Step 6: Register route in all three maps**

```ts
import { handler as quotationIssues } from './_functions/quotation-issues.js';

const ROUTES = {
  // existing routes
  'quotation-issues': quotationIssues,
};
```

Use the matching relative import in both local servers.

- [ ] **Step 7: Verify GREEN**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-issue-postgres.test.ts tests/unit/quotation-issues.test.ts tests/unit/orcamento-postgres.test.ts tests/unit/quote-leads-postgres.test.ts`
Expected: PASS.

- [ ] **Step 8: Review gate**

Verify PDF failure leaves only a retryable request row, not client, quotation, revision, sequence increment, activity or lead conversion.

- [ ] **Step 9: Commit only after authorization**

```bash
git add api/_db/quotation-issue-repository.ts api/_functions/lib/quotation-issue-core.ts api/_functions/quotation-issues.ts api/_db/quote-leads-repository.ts 'api/[...path].ts' scripts/dev-api-server.mjs scripts/app-server.mjs tests/unit/quotation-issue-postgres.test.ts tests/unit/quotation-issues.test.ts
git commit -m "feat: issue quotations idempotently"
```

### Task 5: Persist and restore local `/auto` drafts

**Files:**

- Modify: `src/types/domain.ts`
- Create: `src/lib/autoQuoteDraftStorage.ts`
- Modify: `src/pages/AutoQuotePage.tsx`
- Create: `tests/unit/auto-quote-draft-storage.test.ts`

**Interfaces:**

- Produces: `loadAutoQuoteDrafts(storage): StoredAutoQuoteDraft[]`.
- Produces: `saveAutoQuoteDrafts(storage, drafts): void`.
- Produces: versioned shape with optional `issueIdempotencyKey` and completed issue projection.

Add these exact serializable types to `src/types/domain.ts`:

```ts
export interface QuotationIssueProjection {
  quotationId: string;
  businessNumber: string;
  revisionId: string;
  revisionNumber: number;
  status: 'emitido';
  issuedAt: string;
  validUntil: string;
  pdfUrl: string;
}

export interface StoredAutoQuoteDraft extends Draft {
  issueIdempotencyKey?: string;
  issue?: QuotationIssueProjection;
  sourceQuotationId?: string;
  sourceRevisionId?: string;
}
```

- [ ] **Step 1: Write storage RED tests**

```ts
test('restores valid versioned drafts', () => {
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [validDraft] }));
  assert.deepEqual(loadAutoQuoteDrafts(storage), [validDraft]);
});

test('discards malformed storage safely', () => {
  storage.setItem('aspen_drafts', '{broken');
  assert.deepEqual(loadAutoQuoteDrafts(storage), []);
});

test('does not restore unknown versions', () => {
  storage.setItem('aspen_drafts', JSON.stringify({ version: 99, drafts: [validDraft] }));
  assert.deepEqual(loadAutoQuoteDrafts(storage), []);
});
```

Cover missing customer/items and an idempotency key that is not UUID.

- [ ] **Step 2: Verify RED**

Run: `TZ=UTC node --test tests/unit/auto-quote-draft-storage.test.ts`
Expected: FAIL because storage module does not exist.

- [ ] **Step 3: Implement minimal versioned parser**

```ts
const STORAGE_KEY = 'aspen_drafts';
const STORAGE_VERSION = 1;

export function loadAutoQuoteDrafts(storage: Pick<Storage, 'getItem'>): StoredAutoQuoteDraft[] {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.drafts)) return [];
    return parsed.drafts.filter(isStoredAutoQuoteDraft);
  } catch {
    return [];
  }
}
```

Reuse existing `Draft` fields.
Do not create server synchronization.

- [ ] **Step 4: Hydrate once before persistence effects run**

Initialize `/auto` draft state from `loadAutoQuoteDrafts(window.localStorage)`.
Ensure the first render does not overwrite storage with an empty array.
Preserve current writes through `saveAutoQuoteDrafts`.

- [ ] **Step 5: Verify GREEN**

Run: `TZ=UTC node --test tests/unit/auto-quote-draft-storage.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit only after authorization**

```bash
git add src/types/domain.ts src/lib/autoQuoteDraftStorage.ts src/pages/AutoQuotePage.tsx tests/unit/auto-quote-draft-storage.test.ts
git commit -m "feat: restore local automatic quote drafts"
```

### Task 6: Replace `/auto` creation with preview and issuance

**Files:**

- Create: `src/lib/quotationIssueApi.ts`
- Modify: `src/pages/AutoQuotePage.tsx`
- Modify: `src/components/SplitResultCard.tsx`
- Modify: `tests/unit/communication-api.test.ts`
- Create: `tests/quotation-issue.spec.js`

**Interfaces:**

- Consumes: POST/GET `/api/quotation-issues`, PDF preview and storage from Tasks 3-5.
- Produces: `issueQuotation`, `getQuotationIssue` frontend functions.
- Produces: mutable draft card and immutable emitted card.

Use these frontend contracts:

```ts
export type QuotationDraftInput = ReturnType<typeof buildQuotePayload>;
export type QuotationIssueResult = QuotationIssueProjection;
export type QuotationIssueStatus =
  | { state: 'processing'; retryAfterMs: number }
  | { state: 'retryable'; error: string }
  | ({ state: 'completed' } & QuotationIssueResult);
```

Export `buildQuotePayload` from `AutoQuotePage.tsx` or move it unchanged to `quotationIssueApi.ts` if that avoids a page import.
Prefer moving it because API modules must not import React pages.

- [ ] **Step 1: Write API-client RED tests**

```ts
test('issueQuotation sends the idempotency header', async () => {
  await issueQuotation(validDraft, key);
  assert.equal(request.headers.get('Idempotency-Key'), key);
  assert.equal(request.url, '/api/quotation-issues');
});

test('getQuotationIssue never posts work', async () => {
  await getQuotationIssue(key);
  assert.equal(request.method, 'GET');
});
```

Project only documented fields and reject malformed success responses.

- [ ] **Step 2: Verify RED**

Run: `TZ=UTC node --test tests/unit/communication-api.test.ts`
Expected: FAIL because `quotationIssueApi.ts` does not exist.

- [ ] **Step 3: Implement the API client**

```ts
export async function issueQuotation(
  draft: QuotationDraftInput,
  idempotencyKey: string,
): Promise<QuotationIssueResult> {
  return requestIssue('/api/quotation-issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ draft }),
  });
}

export function getQuotationIssue(idempotencyKey: string): Promise<QuotationIssueStatus> {
  return requestIssue(`/api/quotation-issues?idempotency_key=${encodeURIComponent(idempotencyKey)}`);
}
```

- [ ] **Step 4: Write `/auto` E2E RED cases**

Route API calls and assert:

```js
await page.getByRole('button', { name: 'Visualizar PDF' }).click();
expect(previewWrites).toBe(0);

await page.getByRole('button', { name: 'Gerar orçamento' }).dblclick();
expect(issueRequests).toHaveLength(1);
await expect(page.getByText('Emitido')).toBeVisible();
await expect(page.getByText('ORC-20260001 · Revisão 1')).toBeVisible();
```

Reload before emission and assert restored edits.
Simulate lost POST response, reload, allow GET recovery and assert the same revision.
Return 409 pricing differences and assert highlighted corrected values plus a required second click.

- [ ] **Step 5: Implement mutable and emitted card modes**

```ts
type SplitResultCardMode =
  | { kind: 'draft'; onPreview(): void; onIssue(): void; issuing: boolean }
  | { kind: 'issued'; issue: QuotationIssueResult; onOpenPdf(): void; onNewRevision(): void };
```

Replace **Criar orçamento** with **Gerar orçamento**.
After success, freeze editing and show **Emitido**, number, revision, validity, **Abrir PDF**, WhatsApp panel and **Nova revisão**.
Do not automatically open PDF after emission.

Generate UUID once before POST and persist it immediately.
Disable the issue button while the request is active.
On 409 pricing divergence, apply authoritative fields, clear the key and focus the changed values.

- [ ] **Step 6: Implement new revision locally**

Copy the emitted snapshot into a mutable draft.
Set `sourceQuotationId` and `sourceRevisionId`.
Clear issue result, delivery state and idempotency key.
Keep the original emitted card/history intact.

- [ ] **Step 7: Verify GREEN**

Run: `npm run build:api && TZ=UTC node --test tests/unit/communication-api.test.ts tests/unit/auto-quote-draft-storage.test.ts`
Run: `npx playwright test tests/quotation-issue.spec.js`
Expected: PASS.

- [ ] **Step 8: Commit only after authorization**

```bash
git add src/lib/quotationIssueApi.ts src/pages/AutoQuotePage.tsx src/components/SplitResultCard.tsx tests/unit/communication-api.test.ts tests/quotation-issue.spec.js
git commit -m "feat: issue quotations from automatic flow"
```

### Task 7: Add permanent delivery summaries and retention

**Files:**

- Create: `api/_db/quotation-delivery-repository.ts`
- Create: `tests/unit/quotation-delivery-postgres.test.ts`

**Interfaces:**

- Consumes: `quotationDeliveries` from Task 2.
- Produces: `reserveDelivery(input)`, `recordDeliveryState(input)`, `readDeliveryByRevision(revisionId)`.
- Produces: one delivery operation per revision.

- [ ] **Step 1: Write delivery repository RED tests**

```ts
test('one revision has one frozen delivery operation', async () => {
  await repository.reserve({ revisionId, phone: '5521995419741', flowId: 'already-talking' });
  await assert.rejects(
    repository.reserve({ revisionId, phone: '5511999999999', flowId: 'email-first-contact' }),
    /nova revisão/i,
  );
});

test('retry keeps frozen phone and flow', async () => {
  const retry = await repository.reserve({ revisionId, phone, flowId });
  assert.equal(retry.phone, phone);
  assert.equal(retry.flowId, flowId);
});
```

Cover permanent summary, 30-day resumable deadline, 90-day diagnostic expiry and opportunistic redaction without deleting commercial summary.

- [ ] **Step 2: Verify RED**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-delivery-postgres.test.ts`
Expected: FAIL because repository does not exist.

- [ ] **Step 3: Implement the focused repository**

```ts
export interface QuotationDeliveryRepository {
  reserve(input: ReserveQuotationDeliveryInput): Promise<QuotationDelivery>;
  recordState(input: RecordQuotationDeliveryStateInput): Promise<QuotationDelivery>;
  getByRevision(revisionId: string): Promise<QuotationDelivery | null>;
}
```

`reserve` inserts once and returns the existing row only when phone and flow match.
`recordState` accepts public state, neutral acceptance ID and safe public error.
Reads redact diagnostic error after `diagnostics_expires_at` and mark expired incomplete operations read-only after `resumable_until`.

- [ ] **Step 4: Verify GREEN**

Run: `npm run build:api && TZ=UTC node --test tests/unit/quotation-delivery-postgres.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit only after authorization**

```bash
git add api/_db/quotation-delivery-repository.ts tests/unit/quotation-delivery-postgres.test.ts
git commit -m "feat: persist quotation delivery summaries"
```

### Task 8: Enforce safe quotation delivery through WhatsApp

**Files:**

- Create: `api/_functions/lib/quotation-delivery.ts`
- Modify: `api/_functions/send-whatsapp-flow.ts`
- Modify: `api/_functions/send-whatsapp.ts`
- Modify: `api/_functions/whatsapp-send-status.ts`
- Modify: `api/_functions/lib/whatsapp-send-reservation-store.ts`
- Modify: `api/_functions/public-quotation.ts`
- Modify: `tests/unit/send-whatsapp.test.ts`
- Modify: `tests/unit/send-whatsapp-idempotency.test.ts`
- Modify: `tests/unit/whatsapp-send-status.test.ts`
- Modify: `tests/unit/public-quotation.test.ts`

**Interfaces:**

- Consumes: status canonicalization, emitted snapshot and delivery repository.
- Produces: `deliverQuotation(input): Promise<DeliveryResult>`.
- Produces: GET status backed by PostgreSQL summary plus KV lease.

- [ ] **Step 1: Write delivery-policy RED tests**

```ts
test('requires exactly one quotation PDF', async () => {
  await assert.rejects(
    deliverQuotation({ ...input, steps: [{ kind: 'text' }] }),
    /exatamente um PDF/i,
  );
  await assert.rejects(
    deliverQuotation({ ...input, steps: [pdfStep, pdfStep] }),
    /exatamente um PDF/i,
  );
});

test('rejects expired issued revision before Evolution', async () => {
  await assert.rejects(deliverQuotation(expiredInput), /vencido/i);
  assert.equal(evolutionCalls, 0);
});

test('rejects flows whose maximum duration exceeds 45 seconds', async () => {
  await assert.rejects(deliverQuotation({ ...input, maxDelayMs: 45_001 }), /45 segundos/);
});
```

Also cover `rascunho`, missing phone, missing Evolution, PDF failure, public-link TTL, frozen phone/flow and approved revision.

- [ ] **Step 2: Verify RED**

Run: `npm run build:api && TZ=UTC node --test tests/unit/send-whatsapp.test.ts tests/unit/public-quotation.test.ts`
Expected: FAIL on new policy assertions.

- [ ] **Step 3: Implement `deliverQuotation` before transport**

```ts
export interface DeliverQuotationInput {
  revisionId: string;
  phone: string;
  flowId: string;
}

export interface DeliveryResult {
  status: 'completed' | 'retryable' | 'reconciling' | 'accepted_partial';
  message: string;
  publicLink?: string;
}
```

Load the immutable revision by ID.
Canonicalize its state and reject non-issued or expired revisions.
Resolve flow and count `quotation_pdf` steps.
Calculate worst-case delays before any Evolution call.
Reserve the PostgreSQL delivery, then acquire/reuse the existing KV lease.
Render PDF and issue link with `min(validUntil - now, 30 days)`.

- [ ] **Step 4: Persist every public transition**

Map reservation phases:

```ts
const publicStateByPhase = {
  reserved: 'pending',
  transporting: 'transporting',
  accepted_partial: 'accepted_partial',
  completed: 'completed',
  retryable: 'retryable',
  reconciling: 'reconciling',
} as const;
```

After provider acceptance, any uncertain CAS or response must persist `reconciling` and block transport retry.
Before provider acceptance, safe failures persist `retryable`.
Never persist raw provider payload.

- [ ] **Step 5: Make status recovery PostgreSQL-first**

GET status should read the permanent delivery by revision.
Use KV only to refine active `pending`/`transporting` leases.
A missing or expired KV record must not erase completed/reconciling PostgreSQL state.
Resolution actions must require expected version and safe resolution body.

- [ ] **Step 6: Verify GREEN**

Run: `npm run build:api && TZ=UTC node --test tests/unit/send-whatsapp.test.ts tests/unit/send-whatsapp-idempotency.test.ts tests/unit/whatsapp-send-status.test.ts tests/unit/public-quotation.test.ts`
Expected: PASS.

- [ ] **Step 7: Review gate**

Confirm no path calls Evolution before status, validity, flow, PDF count, 45-second budget and frozen operation validations pass.

- [ ] **Step 8: Commit only after authorization**

```bash
git add api/_functions/lib/quotation-delivery.ts api/_functions/send-whatsapp-flow.ts api/_functions/send-whatsapp.ts api/_functions/whatsapp-send-status.ts api/_functions/lib/whatsapp-send-reservation-store.ts api/_functions/public-quotation.ts tests/unit/send-whatsapp.test.ts tests/unit/send-whatsapp-idempotency.test.ts tests/unit/whatsapp-send-status.test.ts tests/unit/public-quotation.test.ts
git commit -m "feat: deliver issued quotations safely"
```

### Task 9: Finish quotation UI and detail lifecycle

**Files:**

- Modify: `src/lib/communicationApi.ts`
- Modify: `src/components/WhatsAppSendPanel.tsx`
- Modify: `src/pages/AutoQuotePage.tsx`
- Modify: `src/pages/QuotationDetailPage.tsx`
- Modify: `tests/unit/communication-api.test.ts`
- Modify: `tests/quotation-issue.spec.js`
- Modify: `tests/quotation-lifecycle.spec.js`

**Interfaces:**

- Consumes: issue and delivery APIs.
- Produces: separate commercial and delivery UI states.

- [ ] **Step 1: Add RED projections for delivery states**

```ts
test('projects provider acceptance without claiming delivery', async () => {
  const result = projectExecuteFlowResponse({
    send_status: 'accepted_partial',
    provider_accepted: true,
  });
  assert.equal(result.label, 'Envio aceito');
  assert.notEqual(result.label, 'Entregue');
});
```

Add projections for `retryable`, `reconciling`, expired/read-only and completed.

- [ ] **Step 2: Add detail-page RED E2E cases**

Assert:

```js
await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeVisible();
await page.getByRole('button', { name: 'Emitir orçamento' }).click();
await expect(page.getByText('Emitido')).toBeVisible();
await expect(page.getByRole('button', { name: 'Excluir' })).toHaveCount(0);
await expect(page.getByRole('button', { name: 'Enviar WhatsApp' })).toBeVisible();
```

For expired revision, assert send disabled with instruction to create a new revision.
For loss, require reason before PATCH and retain the detail record.

- [ ] **Step 3: Implement WhatsApp panel state machine**

```ts
type DeliveryUiState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'accepted'; message: 'Envio aceito' }
  | { kind: 'retryable'; message: string }
  | { kind: 'reconciling'; message: 'Reconciliação necessária' }
  | { kind: 'readonly'; message: string };
```

Default flow is `already-talking`.
No confirmation modal is added.
Disable retry for accepted/reconciling/read-only operations.
Show **PDF indisponível. Tentar novamente** only for safe pre-acceptance PDF failures.

- [ ] **Step 4: Wire detail emission through `/quotation-issues`**

Map the legacy draft detail to `QuotationDraftInput` and include `sourceQuotationId` and `sourceRevisionId` when appropriate.
After emission, reload detail by business number.
Do not call the old `set_status=enviado` action.

Add **Nova revisão** to copy the emitted revision into the existing draft-revision flow.
Use the canonical module so emitted content stays immutable.

- [ ] **Step 5: Restrict deletion and implement loss reason**

Hide and backend-block delete for non-drafts.
Submit:

```ts
apiPost(`/quotations?id=${encodeURIComponent(id)}&action=set_status`, {
  status: 'perdido',
  loss_reason: reason.trim(),
  concurrency_token: token,
});
```

- [ ] **Step 6: Verify GREEN**

Run: `TZ=UTC node --test tests/unit/communication-api.test.ts tests/unit/communication-send.test.ts`
Run: `npx playwright test tests/quotation-issue.spec.js tests/quotation-lifecycle.spec.js`
Expected: PASS.

- [ ] **Step 7: Commit only after authorization**

```bash
git add src/lib/communicationApi.ts src/components/WhatsAppSendPanel.tsx src/pages/AutoQuotePage.tsx src/pages/QuotationDetailPage.tsx tests/unit/communication-api.test.ts tests/quotation-issue.spec.js tests/quotation-lifecycle.spec.js
git commit -m "feat: separate quotation issue and delivery UI"
```

### Task 10: Full regression and operational evidence

**Files:**

- Modify only if a verified regression requires a focused fix.
- Do not modify `tests/quotation-cutover-staging.spec.js` credentials or external-provider guards.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: verification evidence and residual-risk report.

- [ ] **Step 1: Run focused unit corpus**

```bash
npm run build:api && TZ=UTC node --test \
  tests/unit/quotation-status.test.ts \
  tests/unit/quotation-schema.test.ts \
  tests/unit/quotation-preview.test.ts \
  tests/unit/quotation-issue-postgres.test.ts \
  tests/unit/quotation-issues.test.ts \
  tests/unit/quotation-delivery-postgres.test.ts \
  tests/unit/quotation-lifecycle-postgres.test.ts \
  tests/unit/public-quotation.test.ts \
  tests/unit/send-whatsapp.test.ts \
  tests/unit/send-whatsapp-idempotency.test.ts \
  tests/unit/whatsapp-send-status.test.ts \
  tests/unit/communication-api.test.ts \
  tests/unit/communication-send.test.ts \
  tests/unit/auto-quote-draft-storage.test.ts
```

Expected: all pass, zero skipped tests introduced for required behavior.

- [ ] **Step 2: Run all unit tests**

Run: `npm run test:unit`
Expected: PASS.
Record existing skips and warnings separately.

- [ ] **Step 3: Run static checks and build**

Run: `npm run check`
Expected: lint, type-check, Tailwind check and build pass.
Do not claim new warnings are pre-existing without comparing baseline evidence.

- [ ] **Step 4: Run focused E2E**

Run: `npx playwright test tests/quotation-issue.spec.js tests/quotation-lifecycle.spec.js tests/quotation-cutover.spec.js`
Expected: PASS.

- [ ] **Step 5: Run full E2E excluding real staging**

Run: `npx playwright test --grep-invert "staging"`
Expected: PASS.
Do not include `tests/quotation-cutover-staging.spec.js` without configured isolated staging credentials.

- [ ] **Step 6: Validate migration in disposable databases**

Test both:

1. clean database through `0019`;
2. database through `0018` containing `rascunho` and `enviado`, then `0019`.

Assert all expected relations, checks, indexes, status backfill and rerun no-op.
Do not apply migration to Production.

- [ ] **Step 7: Verify external-provider safety**

Run the existing no-legacy-provider guard and staging egress checks.
Use fake provider or `dry_run` only.
Assert zero Evolution calls for preview, issue, expired revision, invalid flow, PDF failure and active reconciliation.

- [ ] **Step 8: Run diagnostics**

Run `lsp_diagnostics` on changed TypeScript files, then `lens_diagnostics mode=all`.
Expected: no blocking errors.
Classify remaining hints with exact file and line evidence.

- [ ] **Step 9: Audit the complete diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff -- api src tests drizzle scripts
```

Confirm no secret, generated build artifact, `.env`, `aspen-vault` change or unrelated cleanup entered the diff.

- [ ] **Step 10: Request separate operational authorizations**

Request explicit approval independently for:

1. commits;
2. applying migration `0019`;
3. configuring Production `pagamento`;
4. deploying;
5. dry-run Production smoke;
6. controlled real WhatsApp send.

Do not bundle these approvals.
