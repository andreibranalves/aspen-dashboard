import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../api/infrastructure/db/schema.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/modules/quotation-template-catalog.js';
import { createQuotationIssueRepository, QuotationIssueInputError, quotationIssueFailureOwnershipMatches, quotationIssueFingerprint, quotationIssueLeaseDecision, type QuotationIssueInput } from '../../api/infrastructure/db/repositories/quotation-issue-repository.js';
import { createPostgresQuoteDraftManagementRepository } from '../../api/infrastructure/db/repositories/quote-draft-management-repository.js';
import { createPostgresQuoteDraftRepository } from '../../api/infrastructure/db/repositories/quote-repository.js';
import { createPostgresQuotationLifecycleRepository } from '../../api/infrastructure/db/repositories/quotation-lifecycle-repository.js';
import type { AppDatabase } from '../../api/infrastructure/db/client.js';

const TEST_DATABASE_URL = process.env.TEST_QUOTE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
const NOW = new Date('2026-08-10T12:00:00.000Z');
const VALID_PDF = Buffer.from('%PDF-1.4\n% task4\n%%EOF', 'utf8');

function eventInput(key: string, content: Record<string, unknown> = draft()): QuotationIssueInput { return { idempotencyKey: key, draft: content }; }
function draft(rate = 12.3): Record<string, unknown> { return { extracted: { nome: 'Cliente emissão', email: 'cliente@teste.com', frete: '1.00', items: [{ item_code: 'TASK4-SKU', item_name: 'Produto teste', qty: 2, rate }] } }; }
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
  await db.delete(schema.quotationTemplateVersions).where(eq(schema.quotationTemplateVersions.sourceHash, DEFAULT_QUOTATION_TEMPLATE.hash));
  await db.delete(schema.quotationTemplates).where(eq(schema.quotationTemplates.key, DEFAULT_QUOTATION_TEMPLATE.key));
  await db.insert(schema.appSettings).values({ singletonId: 1, pagamento: 'À vista', templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key }).onConflictDoUpdate({ target: schema.appSettings.singletonId, set: { pagamento: 'À vista', templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key } });
  await db.insert(schema.products).values({ sku: 'TASK4-SKU', nome: 'Produto teste', descricao: '', unidade: 'Und', precoBase: '12.30', ativo: true });
  await db.insert(schema.quotationTemplates).values({ id: randomUUID(), key: DEFAULT_QUOTATION_TEMPLATE.key, name: 'Padrão', archived: false });
  const [template] = await db.select().from(schema.quotationTemplates).where(eq(schema.quotationTemplates.key, DEFAULT_QUOTATION_TEMPLATE.key));
  await db.insert(schema.quotationTemplateVersions).values({ id: randomUUID(), templateId: template.id, version: 1, source: DEFAULT_QUOTATION_TEMPLATE.source, sourceHash: DEFAULT_QUOTATION_TEMPLATE.hash });
}

const gated = (name: string, fn: () => Promise<void>) => test(name, { skip: !TEST_DATABASE_URL, concurrency: false }, fn);

// Real repository.issue integration coverage. These tests require TEST_DATABASE_URL.
gated('repository issue replays same key and rejects fingerprint conflict', async () => withDatabase(async (db) => {
  await seed(db); const key = randomUUID(); const ids = [randomUUID(), randomUUID(), randomUUID()];
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, idFactory: () => ids.shift() || randomUUID(), renderPdf: async () => VALID_PDF });
  const first = await repository.issue(eventInput(key));
  const replay = await repository.issue(eventInput(key));
  assert.deepEqual(replay, first);
  await assert.rejects(repository.issue(eventInput(key, draft(99))), /conteúdo diferente/i);
  assert.equal((await db.select().from(schema.quotations)).length, 1);
  assert.equal((await db.select().from(schema.quoteRevisions)).length, 1);
}));

gated('detail draft issue consumes source revision and preserves reviewed validity for the next revision', async () => withDatabase(async (db) => {
  await seed(db);
  const clientId = randomUUID();
  await db.insert(schema.clients).values({ id: clientId, nome: 'Cliente emissão', email: 'cliente@teste.com', arquivado: false });
  await db.update(schema.appSettings).set({ validadeDias: 15 }).where(eq(schema.appSettings.singletonId, 1));
  const drafts = createPostgresQuoteDraftRepository(() => db, { now: () => NOW });
  const source = await drafts.createDraft({
    client_id: clientId,
    items: [{ item_code: 'TASK4-SKU', item_name: 'Produto teste', qty: '2.000', rate: '12.30', manual_rate: true }],
  });
  const reviewedValidity = 42;
  await db.update(schema.quoteRevisions).set({ validadeDias: reviewedValidity }).where(eq(schema.quoteRevisions.id, source.revision_id));
  const management = createPostgresQuoteDraftManagementRepository(() => db);
  const sourceDetail = await management.get!(source.quotation_name);
  assert.ok(sourceDetail);
  assert.ok(sourceDetail.secoes);
  const suppliedSections = JSON.parse(JSON.stringify(sourceDetail.secoes)) as NonNullable<typeof sourceDetail.secoes>;
  const sourceBasePaymentTitle = sourceDetail.secoes.pagamento.base.title;
  suppliedSections.pagamento.base.title = 'Base adulterada pelo cliente';
  suppliedSections.pagamento.current.title = 'Pagamento revisado';
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  const issued = await repository.issue({
    idempotencyKey: randomUUID(),
    sourceQuotationId: source.quotation_uuid,
    sourceRevisionId: source.revision_id,
    draft: { extracted: { ...draft().extracted as Record<string, unknown>, validade_dias: reviewedValidity, pagamento: 'Pagamento revisado', secoes: suppliedSections } },
  });
  assert.equal(issued.revisionId, source.revision_id);
  assert.equal(issued.revisionNumber, 1);
  assert.equal(issued.validUntil, '2026-09-21');
  const revisions = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.quotationId, source.quotation_uuid));
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0]?.status, 'emitido');
  assert.equal(revisions[0]?.validadeDias, reviewedValidity);
  assert.equal(revisions[0]?.sectionsSnapshot?.pagamento.base.title, sourceBasePaymentTitle);
  assert.equal(revisions[0]?.sectionsSnapshot?.pagamento.current.title, 'Pagamento revisado');
  assert.ok(revisions[0]?.issuedAt);

  const issuedDetail = await management.get!(source.quotation_name);
  assert.ok(issuedDetail);
  const lifecycle = createPostgresQuotationLifecycleRepository(() => db, { now: () => new Date('2026-08-11T12:00:00.000Z') });
  const next = await lifecycle.createRevision(source.quotation_name, {
    source_revision_id: issued.revisionId,
    concurrency_token: issuedDetail.concurrency_token,
  });
  assert.equal(next.revision_number, 2);
  assert.equal(next.status_canonical, 'rascunho');
  assert.equal(next.validade_dias, reviewedValidity);
  assert.equal((await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.quotationId, source.quotation_uuid))).length, 2);
}));

gated('repository rejects malformed supplied section snapshots instead of falling back to the source', async () => withDatabase(async (db) => {
  await seed(db);
  const clientId = randomUUID();
  await db.insert(schema.clients).values({ id: clientId, nome: 'Cliente emissão', email: 'cliente@teste.com', arquivado: false });
  const drafts = createPostgresQuoteDraftRepository(() => db, { now: () => NOW });
  const source = await drafts.createDraft({
    client_id: clientId,
    items: [{ item_code: 'TASK4-SKU', item_name: 'Produto teste', qty: '2.000', rate: '12.30', manual_rate: true }],
  });
  const management = createPostgresQuoteDraftManagementRepository(() => db);
  const sourceDetail = await management.get!(source.quotation_name);
  assert.ok(sourceDetail?.secoes);
  const malformedSections = JSON.parse(JSON.stringify(sourceDetail.secoes)) as Record<string, unknown>;
  delete (malformedSections.pagamento as Record<string, unknown>).current;
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => VALID_PDF });
  await assert.rejects(
    repository.issue({
      idempotencyKey: randomUUID(),
      sourceQuotationId: source.quotation_uuid,
      sourceRevisionId: source.revision_id,
      draft: { extracted: { ...draft().extracted as Record<string, unknown>, secoes: malformedSections } },
    }),
    (error: unknown) => error instanceof QuotationIssueInputError && /snapshot.*inválido/i.test(error.message),
  );
  const invalidCurrentSections = JSON.parse(JSON.stringify(sourceDetail.secoes)) as Record<string, unknown>;
  const invalidPayment = invalidCurrentSections.pagamento as Record<string, unknown>;
  invalidPayment.current = { ...(invalidPayment.current as Record<string, unknown>), body: 123 };
  await assert.rejects(
    repository.issue({
      idempotencyKey: randomUUID(),
      sourceQuotationId: source.quotation_uuid,
      sourceRevisionId: source.revision_id,
      draft: { extracted: { ...draft().extracted as Record<string, unknown>, secoes: invalidCurrentSections } },
    }),
    (error: unknown) => error instanceof QuotationIssueInputError && error.statusCode === 400 && /body.*string/i.test(error.message),
  );
  const [revision] = await db.select().from(schema.quoteRevisions).where(eq(schema.quoteRevisions.id, source.revision_id));
  assert.equal(revision?.status, 'rascunho');
}));

gated('repository PDF failure rolls back commercial writes and leaves retryable request', async () => withDatabase(async (db) => {
  await seed(db); const key = randomUUID(); const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => { throw new Error('renderer down'); } });
  await assert.rejects(repository.issue(eventInput(key)), /PDF/i);
  assert.equal((await db.select().from(schema.quotations)).length, 0);
  assert.equal((await db.select().from(schema.quoteRevisions)).length, 0);
  assert.equal((await db.select().from(schema.clients)).filter((row) => row.email === 'cliente@teste.com').length, 0);
  assert.equal((await db.select().from(schema.quoteSequences)).length, 0);
  assert.equal((await repository.read(key))?.state, 'retryable');
}));

gated('repository active and stale leases are enforced by issue', async () => withDatabase(async (db) => {
  await seed(db); const activeKey = randomUUID(); const staleKey = randomUUID(); const fingerprint = quotationIssueFingerprint(eventInput(activeKey));
  await db.insert(schema.quotationIssueRequests).values([{ id: randomUUID(), idempotencyKey: activeKey, fingerprint, state: 'processing', leaseExpiresAt: new Date(NOW.getTime() + 60000), createdAt: NOW, updatedAt: NOW }, { id: randomUUID(), idempotencyKey: staleKey, fingerprint: quotationIssueFingerprint(eventInput(staleKey)), state: 'processing', leaseExpiresAt: new Date(NOW.getTime() - 60000), createdAt: NOW, updatedAt: NOW }]);
  const repository = createQuotationIssueRepository(() => db, { now: () => NOW, renderPdf: async () => { throw new Error('expected validation after stale claim'); } });
  await assert.rejects(repository.issue(eventInput(activeKey)), /processamento/i);
  await assert.rejects(repository.issue(eventInput(staleKey)), /PDF|Pagamento/i);
  assert.equal((await repository.read(activeKey))?.state, 'processing');
}));

test('fingerprint sorts object keys while preserving item order and source identity', () => {
  const input = eventInput(randomUUID());
  assert.equal(quotationIssueFingerprint(input), quotationIssueFingerprint({ ...input, draft: { extracted: { items: [{ qty: 2, item_code: 'TASK4-SKU', item_name: 'Produto teste', rate: 12.3 }], email: 'cliente@teste.com', nome: 'Cliente emissão', frete: '1.00' } } }));
  assert.notEqual(quotationIssueFingerprint(input), quotationIssueFingerprint(eventInput(input.idempotencyKey, draft(99))));
  assert.notEqual(quotationIssueFingerprint(input), quotationIssueFingerprint({ ...input, sourceLeadId: randomUUID() }));
  assert.notEqual(quotationIssueFingerprint(input), quotationIssueFingerprint({ ...input, sourceQuotationId: randomUUID() }));
  assert.notEqual(quotationIssueFingerprint(input), quotationIssueFingerprint({ ...input, sourceRevisionId: randomUUID() }));
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
