import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { QUOTATION_WRITE_LOCK_KEY } from '../../api/_infrastructure/db/quotation-write-lock.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_modules/quotation-template-catalog.js';
import { renderQuotationDocument } from '../../api/_modules/quotation-document.js';
import {
  createQuotationIssueRepository,
  QuotationIssueConflictError,
  quotationIssueFailureOwnershipMatches,
  quotationIssueFingerprint,
  quotationIssueLeaseDecision,
  type QuotationIssueInput,
} from '../../api/_infrastructure/db/repositories/quotation-issue-repository.js';
import type { QuotationTemplateSnapshot } from '../../api/_infrastructure/db/repositories/quotation-template-repository.js';
import { readQuotationTemplateSnapshot } from '../../api/_infrastructure/db/repositories/quotation-template-repository.js';
import { createPostgresQuoteDraftManagementRepository, QuoteManagementConflictError } from '../../api/_infrastructure/db/repositories/quote-draft-management-repository.js';
import { createPostgresQuoteDraftRepository } from '../../api/_infrastructure/db/repositories/quote-repository.js';
import { ensureFirstContactAction } from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import type { AppDatabase } from '../../api/_infrastructure/db/client.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env, ['TEST_QUOTE_DATABASE_URL', 'TEST_DATABASE_URL']);
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
const NOW = new Date('2026-08-10T12:00:00.000Z');
const VALID_PDF = Buffer.from('%PDF-1.4\n% task4\n%%EOF', 'utf8');

let migrationPromise: Promise<void> | undefined;
async function clearIssueFixtures(db: AppDatabase) {
  await db.update(schema.quoteLeads).set({ crmDealId: null, quotationId: null });
  await db.delete(schema.quotationFollowUps);
  await db.delete(schema.opportunityDeliveryAnchors);
  await db.delete(schema.manualContactEvents);
  await db.delete(schema.opportunityNextActions);
  await db.delete(schema.crmDeals);
  await db.delete(schema.quoteLeads);
  await db.delete(schema.quotationIssueRequests);
  await db.delete(schema.quotations);
  await db.delete(schema.clients).where(eq(schema.clients.email, 'cliente@teste.com'));
}
async function withDatabase<T>(callback: (db: AppDatabase) => Promise<T>): Promise<T> {
  const client = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
  const db = drizzle(client, { schema }) as AppDatabase;
  try {
    migrationPromise ||= migrate(db, { migrationsFolder }).then(() => undefined);
    await migrationPromise;
    return await callback(db);
  } finally {
    try {
      await clearIssueFixtures(db);
    } finally {
      await client.end({ timeout: 5 });
    }
  }
}
/** A second operator on its own connection. The short lock_timeout turns
 * "blocked behind the issuance" into an error instead of a hung test. */
async function withOtherOperator<T>(callback: (db: AppDatabase) => Promise<T>): Promise<T> {
  const client = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => undefined, connection: { lock_timeout: 2000 } });
  try {
    return await callback(drizzle(client, { schema }) as AppDatabase);
  } finally {
    await client.end({ timeout: 5 });
  }
}
/** Which quotation locks another connection finds taken at this moment. */
async function locksTakenFromOutside(draft: PersistedDraft) {
  return withOtherOperator((other) => other.transaction(async (tx) => {
    const [probe] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(${QUOTATION_WRITE_LOCK_KEY}::bigint) as acquired`);
    const revision = await tx.select({ id: schema.quoteRevisions.id }).from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId)).for('update', { skipLocked: true });
    const quotation = await tx.select({ id: schema.quotations.id }).from(schema.quotations).where(eq(schema.quotations.id, draft.quotationUuid)).for('update', { skipLocked: true });
    return { writeLock: !probe?.acquired, revisionRow: revision.length === 0, quotationRow: quotation.length === 0 };
  }));
}
async function seed(db: AppDatabase) {
  await clearIssueFixtures(db);
  await db.delete(schema.quoteSequences);
  await db.delete(schema.quoteRevisionItems).where(eq(schema.quoteRevisionItems.productSku, 'TASK4-SKU'));
  await db.delete(schema.productActivityEvents).where(eq(schema.productActivityEvents.productSku, 'TASK4-SKU'));
  await db.delete(schema.productPricingTiers).where(eq(schema.productPricingTiers.productSku, 'TASK4-SKU'));
  await db.delete(schema.products).where(eq(schema.products.sku, 'TASK4-SKU'));
  const [existingTemplate] = await db
    .select({ id: schema.quotationTemplates.id })
    .from(schema.quotationTemplates)
    .where(eq(schema.quotationTemplates.key, DEFAULT_QUOTATION_TEMPLATE.key));
  if (existingTemplate) {
    await db.delete(schema.quotationTemplateVersions).where(eq(schema.quotationTemplateVersions.templateId, existingTemplate.id));
    await db.delete(schema.quotationTemplates).where(eq(schema.quotationTemplates.id, existingTemplate.id));
  }
  await db.insert(schema.appSettings).values({ singletonId: 1, pagamento: 'À vista', templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key }).onConflictDoUpdate({ target: schema.appSettings.singletonId, set: { pagamento: 'À vista', templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key } });
  await db.insert(schema.products).values({ sku: 'TASK4-SKU', nome: 'Produto teste', descricao: '', unidade: 'Und', precoBase: '12.30', ativo: true });
  await db.insert(schema.quotationTemplates).values({ id: randomUUID(), key: DEFAULT_QUOTATION_TEMPLATE.key, name: 'Padrão', archived: false });
  const [template] = await db.select().from(schema.quotationTemplates).where(eq(schema.quotationTemplates.key, DEFAULT_QUOTATION_TEMPLATE.key));
  await db.insert(schema.quotationTemplateVersions).values({ id: randomUUID(), templateId: template.id, version: 2, source: DEFAULT_QUOTATION_TEMPLATE.source, sourceHash: DEFAULT_QUOTATION_TEMPLATE.hash, contractVersion: 2 });
}

interface PersistedDraft {
  quotationUuid: string;
  revisionId: string;
  concurrencyToken: string;
  businessNumber: string;
}

async function createPersistedDraft(db: AppDatabase): Promise<PersistedDraft> {
  const clientId = randomUUID();
  await db.insert(schema.clients).values({ id: clientId, nome: 'Cliente emissão', email: 'cliente@teste.com', arquivado: false });
  const drafts = createPostgresQuoteDraftRepository(() => db, { now: () => NOW });
  const created = await drafts.createDraft({
    client_id: clientId,
    items: [{ item_code: 'TASK4-SKU', item_name: 'Produto teste', qty: '2.000', rate: '12.30', manual_rate: true }],
  });
  return {
    quotationUuid: created.quotation_uuid,
    revisionId: created.revision_id,
    concurrencyToken: created.concurrency_token,
    businessNumber: created.quotation_name,
  };
}

function issueInput(key: string, draft: PersistedDraft, tokenOverride?: string): QuotationIssueInput {
  return { idempotencyKey: key, revisionId: draft.revisionId, concurrencyToken: tokenOverride ?? draft.concurrencyToken };
}

const gated = (name: string, fn: () => Promise<void>) => test(name, { skip: !TEST_DATABASE_URL, concurrency: false }, fn);

// Real repository.issue integration coverage. These tests require TEST_DATABASE_URL.

gated('issuing a persisted draft loads everything from the stored revision and ignores browser fields', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  // Live catalog price changes after the draft was saved must not leak into
  // the issuance: the persisted item prices are authoritative.
  await db.update(schema.products).set({ precoBase: '999.00' }).where(eq(schema.products.sku, 'TASK4-SKU'));

  let issuedHtml = '';
  const repository = createQuotationIssueRepository(() => db, {
    now: () => NOW,
    renderPdf: async (html) => { issuedHtml = html; return VALID_PDF; },
  });
  const result = await repository.issue(issueInput(randomUUID(), draft));

  assert.equal(result.revisionId, draft.revisionId);
  assert.equal(result.businessNumber, draft.businessNumber);
  assert.equal(result.status, 'emitido');
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
  assert.equal(revision?.status, 'emitido');
  assert.ok(revision?.issuedAt);
  // Totals come from the persisted revision snapshot (2 × R$ 12,30), untouched
  // by the catalog change or anything a browser might resend.
  assert.equal(revision?.subtotal, '24.60');
  const [item] = await db.select().from(schema.quoteRevisionItems).where(eq(schema.quoteRevisionItems.revisionId, draft.revisionId));
  assert.equal(item?.precoAplicado, '12.30');

  const [quotation] = await db.select().from(schema.quotations).where(eq(schema.quotations.id, draft.quotationUuid));
  assert.equal(quotation?.status, 'emitido');

  // Issued HTML matches the persisted preview seam exactly.
  const previewSnapshot = (await readQuotationTemplateSnapshot(db, draft.quotationUuid)) as QuotationTemplateSnapshot;
  assert.equal(renderQuotationDocument(previewSnapshot).html, issuedHtml);
}));

gated('stale concurrency token blocks issuance with a safe Portuguese message', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  let renders = 0;
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => { renders += 1; return VALID_PDF; } });
  await assert.rejects(
    repository.issue(issueInput(randomUUID(), draft, '2020-01-01T00:00:00.000Z')),
    (error: unknown) => error instanceof QuotationIssueConflictError
      && error.statusCode === 409
      && /alterado por outro usuário/i.test(error.message)
      && !/\b(sql|postgres|stack|uuid)\b/i.test(error.message),
  );
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
  assert.equal(revision?.status, 'rascunho');
  assert.equal(renders, 0, 'a request that cannot issue never starts the PDF render');
  assert.equal((await repository.read(randomUUID())) ?? null, null);
}));

gated('repeating the same idempotency key returns one single issuance result', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  let renders = 0;
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => { renders += 1; return VALID_PDF; } });
  const key = randomUUID();
  const first = await repository.issue(issueInput(key, draft));
  const replay = await repository.issue(issueInput(key, draft));
  assert.deepEqual(replay, first);
  assert.equal(renders, 1, 'the replay returns the stored result without rendering again');
  assert.equal((await db.select().from(schema.quoteRevisions)).length, 1);
  const deals = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.quotationId, draft.quotationUuid));
  assert.equal(deals.length, 1);
  // The document alone never claims the commercial stage.
  assert.equal(deals[0]?.status, 'Novo Lead');

  // A different key against the same already-issued revision is refused.
  await assert.rejects(
    repository.issue(issueInput(randomUUID(), draft)),
    (error: unknown) => error instanceof QuotationIssueConflictError && /rascunho/i.test(error.message),
  );
}));

gated('issued revisions become immutable: mutation attempts fail after issue', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  await repository.issue(issueInput(randomUUID(), draft));

  const management = createPostgresQuoteDraftManagementRepository(() => db);
  await assert.rejects(
    management.update!(draft.businessNumber, {
      concurrency_token: draft.concurrencyToken,
      items: [{ sku: 'TASK4-SKU', qty: '5.000', rate: '12.30', manual_rate: true }],
    }),
    (error: unknown) => error instanceof QuoteManagementConflictError
      && /Somente orçamentos em rascunho podem ser editados\./.test(error.message),
  );

  // A second issuance attempt on the same revision is also refused.
  const second = await createPersistedDraft(db);
  assert.notEqual(second.revisionId, draft.revisionId);
  await assert.rejects(
    repository.issue(issueInput(randomUUID(), draft)),
    /rascunho/i,
  );
}));

gated('PDF failure rolls back the status flip and leaves a retryable request', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => { throw new Error('renderer down'); } });
  const key = randomUUID();
  await assert.rejects(repository.issue(issueInput(key, draft)), /PDF/i);
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
  assert.equal(revision?.status, 'rascunho');
  const [quotation] = await db.select().from(schema.quotations).where(eq(schema.quotations.id, draft.quotationUuid));
  assert.equal(quotation?.status, 'rascunho');
  assert.equal((await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.quotationId, draft.quotationUuid))).length, 0);
  assert.equal((await repository.read(key))?.state, 'retryable');

  const invalid = createQuotationIssueRepository(() => db, { now: () => new Date(NOW.getTime() + 60000), renderPdf: async () => Buffer.from('not a pdf') });
  await assert.rejects(invalid.issue(issueInput(key, draft)), /PDF inválido/i);
  assert.equal((await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId)))[0]?.status, 'rascunho');

  // The same key can be reclaimed after the failure and succeeds.
  const recovered = createQuotationIssueRepository(() => db, { now: () => new Date(NOW.getTime() + 120000), renderPdf: async () => VALID_PDF });
  const retry = await recovered.issue(issueInput(key, draft));
  assert.equal(retry.revisionId, draft.revisionId);
}));

gated('the PDF renders without holding the quotation write lock or the draft rows', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  let taken: Awaited<ReturnType<typeof locksTakenFromOutside>> | undefined;
  const repository = createQuotationIssueRepository(() => db, {
    now: () => NOW,
    renderPdf: async () => { taken = await locksTakenFromOutside(draft); return VALID_PDF; },
  });
  const result = await repository.issue(issueInput(randomUUID(), draft));
  assert.equal(result.status, 'emitido');
  assert.deepEqual(taken, { writeLock: false, revisionRow: false, quotationRow: false });
}));

gated('a same-key retry while the PDF renders up to the Function limit waits for the running attempt', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const key = randomUUID();
  const retry = createQuotationIssueRepository(() => db, { now: () => new Date(NOW.getTime() + 59_000), renderPdf: async () => VALID_PDF });
  const repository = createQuotationIssueRepository(() => db, {
    now: () => NOW,
    renderPdf: async () => {
      await assert.rejects(retry.issue(issueInput(key, draft)), /processamento/i);
      return VALID_PDF;
    },
  });
  const result = await repository.issue(issueInput(key, draft));
  assert.equal(result.status, 'emitido');
  assert.equal((await repository.read(key))?.state, 'completed');
}));

gated('two keys racing through the PDF render issue the revision once', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const [firstKey, secondKey] = [randomUUID(), randomUUID()];
  const second = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  const first = createQuotationIssueRepository(() => db, {
    now: () => NOW,
    renderPdf: async () => {
      await second.issue(issueInput(secondKey, draft));
      return VALID_PDF;
    },
  });
  await assert.rejects(
    first.issue(issueInput(firstKey, draft)),
    (error: unknown) => error instanceof QuotationIssueConflictError && /não está mais em rascunho/i.test(error.message),
  );
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
  assert.equal(revision?.status, 'emitido');
  assert.equal((await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.quotationId, draft.quotationUuid))).length, 1);
  assert.equal((await first.read(secondKey))?.state, 'completed');
  assert.equal((await first.read(firstKey))?.state, 'retryable');
}));

gated('a draft edit saved while the PDF renders turns the issuance into a conflict', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const key = randomUUID();
  const repository = createQuotationIssueRepository(() => db, {
    now: () => NOW,
    renderPdf: async () => {
      await withOtherOperator((other) => createPostgresQuoteDraftManagementRepository(() => other).update!(draft.businessNumber, {
        concurrency_token: draft.concurrencyToken,
        items: [{ sku: 'TASK4-SKU', qty: '5.000', rate: '12.30', manual_rate: true }],
      }));
      return VALID_PDF;
    },
  });
  await assert.rejects(
    repository.issue(issueInput(key, draft)),
    (error: unknown) => error instanceof QuotationIssueConflictError && /alterado por outro usuário/i.test(error.message),
  );
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
  assert.equal(revision?.status, 'rascunho');
  const [item] = await db.select().from(schema.quoteRevisionItems).where(eq(schema.quoteRevisionItems.revisionId, draft.revisionId));
  assert.equal(item?.quantidade, '5.000', 'the concurrent edit is kept');
  assert.equal((await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.quotationId, draft.quotationUuid))).length, 0);
  assert.equal((await repository.read(key))?.state, 'retryable');
}));

gated('manual and automatic flows converge on the same draft-to-issued transition', async () => withDatabase(async (db) => {
  await seed(db);
  // Both shapes persist a draft first (manual form POST /orcamento and the
  // automatic extraction save) and then issue through this one operation.
  const manualDraft = await createPersistedDraft(db);
  const automaticDraft = await createPersistedDraft(db);
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });

  const manualResult = await repository.issue(issueInput(randomUUID(), manualDraft));
  const automaticResult = await repository.issue(issueInput(randomUUID(), automaticDraft));

  assert.deepEqual(
    { ...manualResult, quotationId: null, revisionId: null, businessNumber: null, pdfUrl: null },
    { ...automaticResult, quotationId: null, revisionId: null, businessNumber: null, pdfUrl: null },
  );
  for (const draft of [manualDraft, automaticDraft]) {
    const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
    assert.equal(revision?.status, 'emitido');
  }
}));

gated('repository active and stale leases are enforced by issue', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const activeKey = randomUUID();
  await db.insert(schema.quotationIssueRequests).values({
    id: randomUUID(),
    idempotencyKey: activeKey,
    fingerprint: quotationIssueFingerprint({ revisionId: draft.revisionId }),
    state: 'processing',
    leaseExpiresAt: new Date(NOW.getTime() + 60000),
    createdAt: NOW,
    updatedAt: NOW,
  });
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  await assert.rejects(repository.issue(issueInput(activeKey, draft)), /processamento/i);
  assert.equal((await repository.read(activeKey))?.state, 'processing');
}));


gated('issuing a draft without a deal creates one opportunity in the initial stage', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  await repository.issue(issueInput(randomUUID(), draft));
  const [quotation] = await db.select().from(schema.quotations).where(eq(schema.quotations.id, draft.quotationUuid));
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
  const deals = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.quotationId, draft.quotationUuid));
  assert.equal(deals.length, 1);
  assert.equal(deals[0]?.status, 'Novo Lead');
  assert.equal(deals[0]?.quotationId, draft.quotationUuid);
  assert.equal(deals[0]?.clientId, quotation?.clientId);
  assert.equal(deals[0]?.nome, revision?.clienteNome);
  assert.equal(deals[0]?.email, revision?.clienteEmail);
}));

gated('issuing reuses the quote lead deal without claiming the commercial stage', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const leadId = randomUUID();
  const dealId = randomUUID();
  await db.insert(schema.quoteLeads).values({
    id: leadId,
    identityKey: `issue-lead-${leadId}`,
    nome: 'Cliente emissão',
    email: 'cliente@teste.com',
    telefone: '5511999990000',
    source: 'typebot',
    status: 'converted',
    quotationId: draft.quotationUuid,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(schema.crmDeals).values({
    id: dealId,
    quoteLeadId: leadId,
    nome: 'Cliente emissão',
    email: 'cliente@teste.com',
    telefone: '5511999990000',
    status: 'Novo Lead',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.update(schema.quoteLeads).set({ crmDealId: dealId }).where(eq(schema.quoteLeads.id, leadId));
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  await repository.issue(issueInput(randomUUID(), draft));
  const deals = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.id, dealId));
  assert.equal(deals.length, 1);
  assert.equal(deals[0]?.id, dealId);
  assert.equal(deals[0]?.quotationId, draft.quotationUuid);
  assert.equal(deals[0]?.status, 'Novo Lead');
  const [lead] = await db.select().from(schema.quoteLeads).where(eq(schema.quoteLeads.id, leadId));
  assert.equal(lead?.crmDealId, dealId);
}));

gated('issuing preserves an already advanced CRM stage', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const [quotation] = await db.select().from(schema.quotations).where(eq(schema.quotations.id, draft.quotationUuid));
  const dealId = randomUUID();
  await db.insert(schema.crmDeals).values({
    id: dealId,
    clientId: quotation!.clientId,
    quotationId: draft.quotationUuid,
    nome: 'Cliente emissão',
    email: 'cliente@teste.com',
    telefone: '5511999990000',
    status: 'Em Negociacao',
    createdAt: NOW,
    updatedAt: NOW,
  });
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  await repository.issue(issueInput(randomUUID(), draft));
  const [deal] = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.id, dealId));
  assert.equal(deal?.status, 'Em Negociacao');
  assert.equal((await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.quotationId, draft.quotationUuid))).length, 1);
}));

gated('CRM upsert failure rolls back issuance and leaves no deal', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const key = randomUUID();
  const repository = createQuotationIssueRepository(() => db, {
    now: () => NOW,
    renderPdf: async () => VALID_PDF,
    upsertCrmDeal: async () => { throw new Error('crm down'); },
  });
  await assert.rejects(repository.issue(issueInput(key, draft)), /emitir o orçamento/i);
  const [quotation] = await db.select().from(schema.quotations).where(eq(schema.quotations.id, draft.quotationUuid));
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
  assert.equal(quotation?.status, 'rascunho');
  assert.equal(revision?.status, 'rascunho');
  assert.equal((await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.quotationId, draft.quotationUuid))).length, 0);
  assert.equal((await repository.read(key))?.state, 'retryable');
}));

gated('issuing does not reopen a lost deal or create a second active opportunity', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const [quotation] = await db.select().from(schema.quotations).where(eq(schema.quotations.id, draft.quotationUuid));
  const dealId = randomUUID();
  await db.insert(schema.crmDeals).values({
    id: dealId,
    clientId: quotation!.clientId,
    quotationId: draft.quotationUuid,
    nome: 'Cliente emissão',
    email: 'cliente@teste.com',
    telefone: '5511999990000',
    status: 'Perdido',
    lostReason: 'Sem resposta após 30 dias.',
    createdAt: NOW,
    updatedAt: NOW,
  });
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  const result = await repository.issue(issueInput(randomUUID(), draft));
  assert.equal(result.status, 'emitido');
  const deals = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.quotationId, draft.quotationUuid));
  assert.equal(deals.length, 1);
  assert.equal(deals[0]?.id, dealId);
  assert.equal(deals[0]?.status, 'Perdido');
}));

gated('issuing proposals linked to one demand reuses the opportunity instead of inserting another', async () => withDatabase(async (db) => {
  await seed(db);
  const clientId = randomUUID();
  await db.insert(schema.clients).values({ id: clientId, nome: 'Cliente emissão', email: 'cliente@teste.com', arquivado: false });
  const opportunityId = randomUUID();
  const drafts = createPostgresQuoteDraftRepository(() => db, { now: () => NOW });
  // A legacy pointer that resolves to a different proposal must not drive the
  // emission cardinality: the quotation's own opportunity_id does.
  const decoy = await drafts.createDraft({
    client_id: clientId,
    items: [{ item_code: 'TASK4-SKU', item_name: 'Produto teste', qty: '1.000', rate: '12.30', manual_rate: true }],
  });
  await db.insert(schema.crmDeals).values({
    id: opportunityId,
    clientId,
    quotationId: decoy.quotation_uuid,
    nome: 'Cliente emissão',
    email: 'cliente@teste.com',
    status: 'Novo Lead',
    demandSummary: 'Cangas 100',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await ensureFirstContactAction(db, { opportunityId, dueAt: NOW, idFactory: () => randomUUID() });

  const first = await drafts.createDraft({
    client_id: clientId,
    opportunity_id: opportunityId,
    items: [{ item_code: 'TASK4-SKU', item_name: 'Produto teste', qty: '2.000', rate: '12.30', manual_rate: true }],
  });
  const second = await drafts.createDraft({
    client_id: clientId,
    opportunity_id: opportunityId,
    items: [{ item_code: 'TASK4-SKU', item_name: 'Produto teste', qty: '3.000', rate: '12.30', manual_rate: true }],
  });
  assert.equal(first.quotation_uuid === decoy.quotation_uuid, false);

  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  await repository.issue({ idempotencyKey: randomUUID(), revisionId: first.revision_id, concurrencyToken: first.concurrency_token });
  await repository.issue({ idempotencyKey: randomUUID(), revisionId: second.revision_id, concurrencyToken: second.concurrency_token });

  const deals = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.clientId, clientId));
  assert.equal(deals.length, 1, 'the demand keeps exactly one opportunity after two emissions');
  assert.equal(deals[0]?.id, opportunityId);
  assert.equal(deals[0]?.status, 'Novo Lead');
  // The legacy single pointer stays where it was: it is not the cardinality
  // source and the new emission path never rewrites it.
  assert.equal(deals[0]?.quotationId, decoy.quotation_uuid);

  const actions = await db.select().from(schema.opportunityNextActions).where(eq(schema.opportunityNextActions.opportunityId, opportunityId));
  assert.equal(actions.length, 1, 'the shared demand keeps a single first-contact action');

  const linked = await db.select().from(schema.quotations).where(eq(schema.quotations.opportunityId, opportunityId));
  assert.equal(linked.length, 2, 'both proposals stay linked to the same demand');
}));

test('fingerprint binds the idempotency key to the revision reference', () => {
  const revisionId = randomUUID();
  assert.equal(quotationIssueFingerprint({ revisionId }), quotationIssueFingerprint({ revisionId }));
  assert.notEqual(quotationIssueFingerprint({ revisionId }), quotationIssueFingerprint({ revisionId: randomUUID() }));
});

test('stale worker cannot overwrite a newer completed request lease', () => {
  const claimed = new Date('2026-08-10T12:00:30.000Z');
  const newer = new Date('2026-08-10T12:01:00.000Z');
  assert.equal(quotationIssueFailureOwnershipMatches('completed', claimed, claimed, claimed, claimed), false);
  assert.equal(quotationIssueFailureOwnershipMatches('processing', newer, newer, claimed, claimed), false);
  assert.equal(quotationIssueFailureOwnershipMatches('processing', claimed, claimed, claimed, claimed), true);
});

test('lease decisions cover replay, conflict, active, and stale claims', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  assert.equal(quotationIssueLeaseDecision('completed', 'same', 'same', null, now), 'replay');
  assert.equal(quotationIssueLeaseDecision('completed', 'old', 'new', null, now), 'conflict');
  assert.equal(quotationIssueLeaseDecision('processing', 'same', 'same', new Date(now.getTime() + 1), now), 'active');
  assert.equal(quotationIssueLeaseDecision('processing', 'same', 'same', new Date(now.getTime() - 1), now), 'claim');
});

gated('issuing a proposal whose linked demand closed meanwhile is rejected before officializing', async () => withDatabase(async (db) => {
  await seed(db);
  const clientId = randomUUID();
  await db.insert(schema.clients).values({ id: clientId, nome: 'Cliente encerrado', email: 'cliente@teste.com', arquivado: false });
  const opportunityId = randomUUID();
  await db.insert(schema.crmDeals).values({
    id: opportunityId,
    clientId,
    nome: 'Cliente encerrado',
    status: 'Novo Lead',
    createdAt: NOW,
    updatedAt: NOW,
  });
  const drafts = createPostgresQuoteDraftRepository(() => db, { now: () => NOW });
  const created = await drafts.createDraft({
    client_id: clientId,
    opportunity_id: opportunityId,
    items: [{ item_code: 'TASK4-SKU', item_name: 'Produto teste', qty: '2.000', rate: '12.30', manual_rate: true }],
  });
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });

  for (const status of ['Pedido Fechado', 'Perdido']) {
    await db.update(schema.crmDeals).set({ status }).where(eq(schema.crmDeals.id, opportunityId));
    await assert.rejects(
      repository.issue({ idempotencyKey: randomUUID(), revisionId: created.revision_id, concurrencyToken: created.concurrency_token }),
      (error: unknown) => error instanceof QuotationIssueConflictError
        && error.statusCode === 409
        && /encerrada/i.test(error.message)
        && !/\b(sql|postgres|stack|uuid)\b/i.test(error.message),
    );
    const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, created.revision_id));
    assert.equal(revision?.status, 'rascunho', 'no status flip or PDF is officialized for a closed demand');
    const [quotation] = await db.select().from(schema.quotations).where(eq(schema.quotations.id, created.quotation_uuid));
    assert.equal(quotation?.status, 'rascunho');
  }
}));

gated('a demand closed while the PDF renders is rejected before officializing', async () => withDatabase(async (db) => {
  await seed(db);
  const clientId = randomUUID();
  await db.insert(schema.clients).values({ id: clientId, nome: 'Cliente encerrado', email: 'cliente@teste.com', arquivado: false });
  const opportunityId = randomUUID();
  await db.insert(schema.crmDeals).values({ id: opportunityId, clientId, nome: 'Cliente encerrado', status: 'Novo Lead', createdAt: NOW, updatedAt: NOW });
  const drafts = createPostgresQuoteDraftRepository(() => db, { now: () => NOW });
  const created = await drafts.createDraft({
    client_id: clientId,
    opportunity_id: opportunityId,
    items: [{ item_code: 'TASK4-SKU', item_name: 'Produto teste', qty: '2.000', rate: '12.30', manual_rate: true }],
  });
  const repository = createQuotationIssueRepository(() => db, {
    now: () => NOW,
    renderPdf: async () => {
      await withOtherOperator((other) => other.update(schema.crmDeals).set({ status: 'Perdido' }).where(eq(schema.crmDeals.id, opportunityId)));
      return VALID_PDF;
    },
  });
  await assert.rejects(
    repository.issue({ idempotencyKey: randomUUID(), revisionId: created.revision_id, concurrencyToken: created.concurrency_token }),
    (error: unknown) => error instanceof QuotationIssueConflictError && /encerrada/i.test(error.message),
  );
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, created.revision_id));
  assert.equal(revision?.status, 'rascunho');
}));

gated('a document change the concurrency token does not cover still blocks the issuance', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const repository = createQuotationIssueRepository(() => db, {
    now: () => NOW,
    renderPdf: async () => {
      // A write that bypasses the draft repository leaves updatedAt intact.
      await withOtherOperator((other) => other.update(schema.quoteRevisionItems).set({ produtoNome: 'Produto renomeado' }).where(eq(schema.quoteRevisionItems.revisionId, draft.revisionId)));
      return VALID_PDF;
    },
  });
  await assert.rejects(
    repository.issue(issueInput(randomUUID(), draft)),
    (error: unknown) => error instanceof QuotationIssueConflictError && /alterado por outro usuário/i.test(error.message),
  );
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
  assert.equal(revision?.status, 'rascunho');
}));
