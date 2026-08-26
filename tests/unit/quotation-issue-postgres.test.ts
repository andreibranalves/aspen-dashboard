import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../api/_infrastructure/db/schema.js';
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
import type { AppDatabase } from '../../api/_infrastructure/db/client.js';

const TEST_DATABASE_URL = process.env.TEST_QUOTE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
const NOW = new Date('2026-08-10T12:00:00.000Z');
const VALID_PDF = Buffer.from('%PDF-1.4\n% task4\n%%EOF', 'utf8');

let migrationPromise: Promise<void> | undefined;
async function withDatabase<T>(callback: (db: AppDatabase) => Promise<T>): Promise<T> {
  const client = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
  const db = drizzle(client, { schema }) as AppDatabase;
  try {
    migrationPromise ||= migrate(db, { migrationsFolder }).then(() => undefined);
    await migrationPromise;
    return await callback(db);
  } finally { await client.end({ timeout: 5 }); }
}
async function seed(db: AppDatabase) {
  await db.delete(schema.quotationIssueRequests);
  await db.delete(schema.quotations);
  await db.delete(schema.clients).where(eq(schema.clients.email, 'cliente@teste.com'));
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
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  await assert.rejects(
    repository.issue(issueInput(randomUUID(), draft, '2020-01-01T00:00:00.000Z')),
    (error: unknown) => error instanceof QuotationIssueConflictError
      && error.statusCode === 409
      && /alterado por outro usuário/i.test(error.message)
      && !/\b(sql|postgres|stack|uuid)\b/i.test(error.message),
  );
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, draft.revisionId));
  assert.equal(revision?.status, 'rascunho');
  assert.equal((await repository.read(randomUUID())) ?? null, null);
}));

gated('repeating the same idempotency key returns one single issuance result', async () => withDatabase(async (db) => {
  await seed(db);
  const draft = await createPersistedDraft(db);
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  const key = randomUUID();
  const first = await repository.issue(issueInput(key, draft));
  const replay = await repository.issue(issueInput(key, draft));
  assert.deepEqual(replay, first);
  assert.equal((await db.select().from(schema.quoteRevisions)).length, 1);

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
  assert.equal((await repository.read(key))?.state, 'retryable');

  // The same key can be reclaimed after the failure and succeeds.
  const recovered = createQuotationIssueRepository(() => db, { now: () => new Date(NOW.getTime() + 60000), renderPdf: async () => VALID_PDF });
  const retry = await recovered.issue(issueInput(key, draft));
  assert.equal(retry.revisionId, draft.revisionId);
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
