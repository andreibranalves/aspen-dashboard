import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_db/schema.js';
import { appSettings, clients, issuedDocuments, products, quotations, quoteRevisionItems, quoteRevisions } from '../../api/_db/schema.js';
import { createPostgresQuoteDraftRepository } from '../../api/_db/quote-repository.js';
import { createPostgresQuoteDraftManagementRepository } from '../../api/_db/quote-draft-management-repository.js';
import { createQuotationDocumentRepository } from '../../api/_db/quotation-document-repository.js';
import { createPostgresQuotationLifecycleRepository } from '../../api/_db/quotation-lifecycle-repository.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_functions/lib/quotation-templates.js';
import { quotationPdfChecksum } from '../../api/_functions/lib/quotation-document-storage.js';
import { issueQuotation } from '../../api/_functions/quotation-issue.js';

const TEST_DATABASE_URL = process.env.TEST_QUOTE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

test('PostgreSQL lifecycle copies issued snapshots and serializes draft creation', { skip: !TEST_DATABASE_URL }, async () => {
  // The singleton settings row is shared by PostgreSQL integration files.
  // Serialize the whole fixture lifetime so concurrent Node test files cannot
  // overwrite/restore it while another test is still creating drafts.
  const lockClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
  await lockClient`SELECT pg_advisory_lock(hashtext('aspen-quotation-postgres-tests'))`;
  const client = postgres(TEST_DATABASE_URL!, { max: 8, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sku = `LIFE-${suffix}`;
  const clientId = randomUUID();
  const quotationIds: string[] = [];
  let previousSettings: typeof appSettings.$inferSelect | undefined;
  let bodyError: unknown;
  try {
    await migrate(db, { migrationsFolder });
    [previousSettings] = await db.select().from(appSettings).where(eq(appSettings.singletonId, 1));
    await db.insert(appSettings).values({
      singletonId: 1,
      validadeDias: 15,
      pagamento: 'À vista',
      entrega: '10 dias',
      fretePadrao: '0.00',
      observacoes: 'snapshot',
      templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key,
    }).onConflictDoUpdate({ target: appSettings.singletonId, set: { templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key } });
    await db.insert(products).values({ sku, nome: 'Produto lifecycle', descricao: 'Snapshot', unidade: 'Und', precoBase: '10.00', ativo: true });
    await db.insert(clients).values({ id: clientId, nome: 'Cliente lifecycle', arquivado: false });

    const create = createPostgresQuoteDraftRepository(() => db, { now: () => new Date('2026-07-01T12:00:00.000Z') });
    const draft = await create.createDraft({ client_id: clientId, items: [{ item_code: sku, qty: '2.000', manual_rate: true, rate: '12.00' }] });
    quotationIds.push(draft.quotation_uuid);
    const documents = createQuotationDocumentRepository(() => db, { now: () => new Date('2026-07-02T12:00:00.000Z') });
    const renderedHtml: string[] = [];
    const archivedPdfs: Array<{ pathname: string; buffer: Buffer }> = [];
    const storage = {
      archive: async (pathname: string, buffer: Buffer) => {
        archivedPdfs.push({ pathname, buffer: Buffer.from(buffer) });
        return { pathname, sizeBytes: buffer.length, checksumSha256: quotationPdfChecksum(buffer) };
      },
      read: async () => null,
    };
    const renderPdf = async (html: string) => {
      renderedHtml.push(html);
      // Keep the semantic HTML in the fixture PDF so the archive assertion
      // exercises the same rendered bytes that production stores.
      return Buffer.from(`%PDF-1.7\n${html}\n%%EOF`);
    };
    const firstIssued = await issueQuotation(draft.quotation_name, { repository: documents, storage, renderPdf });
    assert.equal(firstIssued.alreadyIssued, false);
    assert.equal(firstIssued.document.revisionId, draft.revision_id);

    const management = createPostgresQuoteDraftManagementRepository(() => db, { now: () => new Date('2026-07-02T12:00:00.000Z') });
    const sent = await management.get(draft.quotation_name);
    assert.ok(sent);
    assert.equal(sent.status_canonical, 'enviado');
    assert.ok(sent.revision_history[0].issued_document?.id);
    const lifecycle = createPostgresQuotationLifecycleRepository(() => db, { now: () => new Date('2026-07-03T12:00:00.000Z') });
    const approved = await lifecycle.setStatus(draft.quotation_name, {
      status: 'aprovado',
      concurrency_token: sent.concurrency_token,
    });
    assert.equal(approved.status_canonical, 'aprovado');
    assert.equal(approved.revision_history[0].status_canonical, 'aprovado');

    const [sourceRevision] = await db.select().from(quoteRevisions).where(eq(quoteRevisions.id, draft.revision_id));
    const sourceItems = await db.select().from(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, draft.revision_id));
    assert.ok(sourceRevision);
    const concurrent = await Promise.allSettled([
      lifecycle.createRevision(draft.quotation_name, { source_revision_id: draft.revision_id, concurrency_token: approved.concurrency_token }),
      lifecycle.createRevision(draft.quotation_name, { source_revision_id: draft.revision_id, concurrency_token: approved.concurrency_token }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
    const created = concurrent.find((result): result is PromiseFulfilledResult<typeof approved> => result.status === 'fulfilled')!.value;
    assert.equal(created.revision, 2);
    assert.equal(created.status_canonical, 'rascunho');
    assert.equal(created.quotation_id, draft.quotation_name);
    assert.equal(created.issued_document, null);
    const [copiedRevision] = await db.select().from(quoteRevisions).where(eq(quoteRevisions.id, created.revision_id));
    const copiedItems = await db.select().from(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, created.revision_id));
    assert.equal(copiedRevision?.templateHash, sourceRevision.templateHash);
    assert.equal(copiedRevision?.total, sourceRevision.total);
    assert.deepEqual(copiedItems.map((item) => item.totalLinha), sourceItems.map((item) => item.totalLinha));
    assert.notEqual(copiedItems[0]?.id, sourceItems[0]?.id);
    assert.equal((await db.select().from(issuedDocuments).where(eq(issuedDocuments.revisionId, created.revision_id))).length, 0);
    assert.equal((await db.select().from(quotations).where(eq(quotations.id, draft.quotation_uuid)))[0]?.businessNumber, draft.quotation_name);
    const firstDocumentBefore = (await db.select().from(issuedDocuments).where(eq(issuedDocuments.revisionId, draft.revision_id)))[0];
    assert.ok(firstDocumentBefore);
    const secondIssued = await issueQuotation(draft.quotation_name, { repository: documents, storage, renderPdf });
    assert.equal(secondIssued.alreadyIssued, false);
    assert.equal(secondIssued.document.revisionId, created.revision_id);
    assert.notEqual(secondIssued.document.id, firstIssued.document.id);
    assert.equal(secondIssued.document.fileName, `${draft.quotation_name}-R2.pdf`);
    assert.equal(renderedHtml.length, 2);
    assert.match(renderedHtml[0], /16\/07\/2026/);
    assert.doesNotMatch(renderedHtml[0], /18\/07\/2026/);
    assert.match(renderedHtml[1], /18\/07\/2026/);
    assert.doesNotMatch(renderedHtml[1], /16\/07\/2026/);
    assert.equal(archivedPdfs.length, 2);
    assert.match(archivedPdfs[0].buffer.toString('utf8'), /16\/07\/2026/);
    assert.match(archivedPdfs[1].buffer.toString('utf8'), /18\/07\/2026/);
    const firstDocumentAfter = (await db.select().from(issuedDocuments).where(eq(issuedDocuments.revisionId, draft.revision_id)))[0];
    const secondDocument = (await db.select().from(issuedDocuments).where(eq(issuedDocuments.revisionId, created.revision_id)))[0];
    assert.deepEqual(firstDocumentAfter, firstDocumentBefore);
    assert.ok(secondDocument);
    assert.equal(secondDocument?.fileName, `${draft.quotation_name}-R2.pdf`);
    assert.notEqual(secondDocument?.id, firstDocumentBefore.id);
  } catch (error) {
    bodyError = error;
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
      // Discover by client_id as well as using local bookkeeping: a failure
      // between INSERT and quotationIds.push must still remove FK dependents.
      const owned = await db
        .select({ id: quotations.id })
        .from(quotations)
        .where(eq(quotations.clientId, clientId));
      const ids = [...new Set([...quotationIds, ...owned.map((row) => row.id)])];
      if (ids.length) await db.delete(quotations).where(inArray(quotations.id, ids));
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.delete(products).where(eq(products.sku, sku));
      if (previousSettings) {
        await db.update(appSettings).set({
          validadeDias: previousSettings.validadeDias,
          pagamento: previousSettings.pagamento,
          entrega: previousSettings.entrega,
          fretePadrao: previousSettings.fretePadrao,
          observacoes: previousSettings.observacoes,
          templatePadrao: previousSettings.templatePadrao,
        }).where(eq(appSettings.singletonId, 1));
      } else {
        await db.delete(appSettings).where(eq(appSettings.singletonId, 1));
      }
    } catch (error) {
      cleanupError = error;
      console.error(`[quotation-lifecycle-test] cleanup failed (${error instanceof Error ? error.message : String(error)})`);
    }
    await client.end({ timeout: 5 });
    await lockClient`SELECT pg_advisory_unlock(hashtext('aspen-quotation-postgres-tests'))`;
    await lockClient.end({ timeout: 5 });
    if (cleanupError && !bodyError) throw cleanupError;
  }
});
