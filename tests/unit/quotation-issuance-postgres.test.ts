import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { createQuotationDocumentRepository, QuotationDocumentConflictError, QuotationDocumentRepositoryError } from '../../api/_db/quotation-document-repository.js';
import { createPostgresQuoteDraftRepository } from '../../api/_db/quote-repository.js';
import { appSettings, clients, issuedDocuments, products, quoteRevisions, quotations } from '../../api/_db/schema.js';
import * as schema from '../../api/_db/schema.js';
import { quotationPdfChecksum, quotationPdfPathname } from '../../api/_functions/lib/quotation-document-storage.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_functions/lib/quotation-templates.js';

const TEST_DATABASE_URL = process.env.TEST_QUOTE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');

test('PostgreSQL issuance commits document/status atomically and retries without duplicates', { skip: !TEST_DATABASE_URL }, async () => {
  // Keep the app_settings singleton deterministic when Node runs this file
  // concurrently with the lifecycle PostgreSQL test.
  const lockClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
  await lockClient`SELECT pg_advisory_lock(hashtext('aspen-quotation-postgres-tests'))`;
  const client = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sku = `ISSUE-${suffix}`;
  const clientId = randomUUID();
  let previousSettings: typeof appSettings.$inferSelect | undefined;
  const quotationIds: string[] = [];
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
      observacoes: '',
      templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key,
    }).onConflictDoUpdate({
      target: appSettings.singletonId,
      set: { templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key },
    });
    await db.insert(products).values({ sku, nome: 'Produto emissão', unidade: 'Und', precoBase: '10.00', ativo: true });
    await db.insert(clients).values({ id: clientId, nome: 'Cliente emissão', arquivado: false });

    const create = createPostgresQuoteDraftRepository(() => db, { now: () => new Date('2026-07-01T12:00:00.000Z') });
    const first = await create.createDraft({ client_id: clientId, items: [{ item_code: sku, qty: '1.000' }] });
    const second = await create.createDraft({ client_id: clientId, items: [{ item_code: sku, qty: '2.000' }] });
    quotationIds.push(first.quotation_uuid, second.quotation_uuid);
    const repository = createQuotationDocumentRepository(() => db, { now: () => new Date('2026-07-01T12:05:00.000Z') });

    const firstSource = await repository.prepare(first.quotation_name);
    assert.ok(firstSource);
    assert.equal(firstSource.document, null);
    const firstInput = {
      quotationId: firstSource.snapshot.quotation.id,
      revisionId: firstSource.snapshot.revision.id,
      expectedUpdatedAt: firstSource.snapshot.quotation.updatedAt.toISOString(),
      blobPathname: quotationPdfPathname(first.quotation_name, firstSource.snapshot.revision.version, firstSource.snapshot.revision.templateHash, 'b'.repeat(64)),
      fileName: `${first.quotation_name}-R1.pdf`,
      mimeType: 'application/pdf' as const,
      sizeBytes: PDF.length,
      checksumSha256: quotationPdfChecksum(PDF),
      templateKey: firstSource.snapshot.revision.templatePadrao,
      templateHash: firstSource.snapshot.revision.templateHash,
    };
    const issued = await repository.complete(firstInput);
    const repeated = await repository.complete(firstInput);
    assert.equal(repeated.id, issued.id);
    const firstRows = await db.select().from(issuedDocuments).where(eq(issuedDocuments.revisionId, first.revision_id));
    assert.equal(firstRows.length, 1);
    const [firstQuote] = await db.select().from(quotations).where(eq(quotations.id, first.quotation_uuid));
    const [firstRevision] = await db.select().from(quoteRevisions).where(eq(quoteRevisions.id, first.revision_id));
    assert.equal(firstQuote.status, 'enviado');
    assert.equal(firstRevision.status, 'enviado');

    const secondSource = await repository.prepare(second.quotation_name);
    assert.ok(secondSource);
    const secondInput = {
      quotationId: secondSource.snapshot.quotation.id,
      revisionId: secondSource.snapshot.revision.id,
      expectedUpdatedAt: secondSource.snapshot.quotation.updatedAt.toISOString(),
      blobPathname: quotationPdfPathname(second.quotation_name, secondSource.snapshot.revision.version, secondSource.snapshot.revision.templateHash, 'c'.repeat(64)),
      fileName: `${second.quotation_name}-R1.pdf`,
      mimeType: 'application/pdf' as const,
      sizeBytes: PDF.length,
      checksumSha256: 'checksum-invalido',
      templateKey: secondSource.snapshot.revision.templatePadrao,
      templateHash: secondSource.snapshot.revision.templateHash,
    };
    await assert.rejects(
      () => repository.complete(secondInput),
      (error: unknown) => error instanceof QuotationDocumentRepositoryError,
    );
    const [secondQuoteAfterFailure] = await db.select().from(quotations).where(eq(quotations.id, second.quotation_uuid));
    const [secondRevisionAfterFailure] = await db.select().from(quoteRevisions).where(eq(quoteRevisions.id, second.revision_id));
    const secondRowsAfterFailure = await db.select().from(issuedDocuments).where(eq(issuedDocuments.revisionId, second.revision_id));
    assert.equal(secondQuoteAfterFailure.status, 'rascunho');
    assert.equal(secondRevisionAfterFailure.status, 'rascunho');
    assert.equal(secondRowsAfterFailure.length, 0);

    await db.update(quotations).set({ updatedAt: new Date('2026-07-01T12:03:00.000Z') }).where(eq(quotations.id, second.quotation_uuid));
    await assert.rejects(
      () => repository.complete({ ...secondInput, checksumSha256: quotationPdfChecksum(PDF) }),
      (error: unknown) => error instanceof QuotationDocumentConflictError,
    );
    const refreshedSecondSource = await repository.prepare(second.quotation_name);
    assert.ok(refreshedSecondSource);
    const retried = await repository.complete({
      ...secondInput,
      expectedUpdatedAt: refreshedSecondSource.snapshot.quotation.updatedAt.toISOString(),
      checksumSha256: quotationPdfChecksum(PDF),
    });
    assert.equal(retried.revisionId, second.revision_id);
    const secondRowsAfterRetry = await db.select().from(issuedDocuments).where(eq(issuedDocuments.revisionId, second.revision_id));
    assert.equal(secondRowsAfterRetry.length, 1);
  } catch (error) {
    bodyError = error;
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
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
      console.error(`[quotation-issuance-test] cleanup failed (${error instanceof Error ? error.message : String(error)})`);
    }
    await client.end({ timeout: 5 });
    await lockClient`SELECT pg_advisory_unlock(hashtext('aspen-quotation-postgres-tests'))`;
    await lockClient.end({ timeout: 5 });
    if (cleanupError && !bodyError) throw cleanupError;
  }
});
