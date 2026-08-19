import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import {
  createPostgresQuoteDraftRepository,
  QuoteDraftConflictError,
} from '../../api/_infrastructure/db/repositories/quote-repository.js';
import {
  clients,
  crmDeals,
  products,
  quoteRevisionItems,
  quoteRevisions,
  quoteSequences,
  quotationTemplateVersions,
  quotationTemplates,
  quotations,
} from '../../api/_infrastructure/db/schema.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { createHandler } from '../../api/_modules/duplicate-quotation.js';

const TEST_DATABASE_URL = process.env.TEST_DUPLICATE_DATABASE_URL;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

function isLocalDatabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
      ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function event(body: unknown) {
  return {
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(body),
    queryStringParameters: {},
  } as const;
}

function snapshotItem(row: typeof quoteRevisionItems.$inferSelect) {
  const { id: _id, revisionId: _revisionId, ...snapshot } = row;
  return snapshot;
}

test('maps number reservation conflicts to the defined Portuguese 409 response', async () => {
  const conflict = new QuoteDraftConflictError();
  const duplicate = async () => {
    throw conflict;
  };
  const handler = createHandler({
    repository: { duplicateDraft: duplicate, duplicateQuotation: duplicate },
  });
  const response = await handler(event({ quotation_id: 'ORC-20260001' }));

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body || '{}'), { error: conflict.message });
});

test(
  'duplicates a local quotation atomically without provider calls or copied external effects',
  { skip: !isLocalDatabaseUrl(TEST_DATABASE_URL) },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 4,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const fixtureClientId = randomUUID();
    const fixtureSku = `DUP-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    let sourceQuotationId: string | undefined;
    let duplicateQuotationId: string | undefined;
    let seededTemplateModelId: string | undefined;
    let seededTemplateVersionId: string | undefined;
    const now = new Date('2026-08-10T12:00:00.000Z');
    const year = now.getUTCFullYear();
    const create = createPostgresQuoteDraftRepository(() => db, { now: () => now });
    let sequenceBefore: typeof quoteSequences.$inferSelect | undefined;
    let templateModelIdsBefore = new Set<string>();
    let templateVersionIdsBefore = new Set<string>();

    try {
      await migrate(db, { migrationsFolder });
      [sequenceBefore] = await db
        .select()
        .from(quoteSequences)
        .where(eq(quoteSequences.year, year));
      templateModelIdsBefore = new Set(
        (await db.select({ id: quotationTemplates.id }).from(quotationTemplates)).map((row) => row.id),
      );
      templateVersionIdsBefore = new Set(
        (await db
          .select({ id: quotationTemplateVersions.id })
          .from(quotationTemplateVersions)).map((row) => row.id),
      );
      await db.insert(products).values({
        sku: fixtureSku,
        nome: 'Produto snapshot',
        descricao: 'Descrição snapshot',
        unidade: 'Und',
        categoria: 'Categoria',
        marca: 'Marca',
        precoBase: '12.30',
        ativo: true,
      });
      await db.insert(clients).values({
        id: fixtureClientId,
        nome: 'Cliente snapshot',
        documento: null,
        email: 'snapshot@example.com',
        telefone: '5511999990000',
        notes: 'Nota snapshot',
        endereco: 'Rua Snapshot',
        numero: '10',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01001000',
        arquivado: false,
      });

      const source = await create.createDraft({
        client_id: fixtureClientId,
        items: [
          { item_code: fixtureSku, qty: '30.000', manual_rate: true, rate: '10.00' },
          { item_code: fixtureSku, qty: '2.000', manual_rate: true, rate: '12.00' },
        ],
        frete: '1.25',
        observacoes: 'Observação da origem',
      });
      sourceQuotationId = source.quotation_uuid;

      const [sourceRevisionCreated] = await db
        .select()
        .from(quoteRevisions)
        .where(eq(quoteRevisions.id, source.revision_id));
      assert.ok(sourceRevisionCreated);
      if (
        sourceRevisionCreated.templateVersionId &&
        !templateVersionIdsBefore.has(sourceRevisionCreated.templateVersionId)
      ) {
        const [seededVersion] = await db
          .select({ templateId: quotationTemplateVersions.templateId })
          .from(quotationTemplateVersions)
          .where(eq(quotationTemplateVersions.id, sourceRevisionCreated.templateVersionId));
        if (seededVersion && !templateModelIdsBefore.has(seededVersion.templateId)) {
          seededTemplateVersionId = sourceRevisionCreated.templateVersionId;
          seededTemplateModelId = seededVersion.templateId;
        }
      }
      const customSnapshot = {
        schema_version: 1 as const,
        prazo_producao: {
          base: { enabled: false, title: 'Prazo persistido' },
          current: { enabled: true, title: 'Prazo customizado' },
        },
        pagamento: {
          base: { enabled: true, title: 'Pagamento persistido', body: 'Base persistida' },
          current: { enabled: false, title: 'Pagamento customizado', body: 'Corpo customizado' },
        },
        condicoes_gerais: {
          base: { enabled: true, title: 'Condições persistidas', body: 'Base persistida' },
          current: { enabled: true, title: 'Condições customizadas', body: 'Observação customizada' },
        },
      };
      await db
        .update(quoteRevisions)
        .set({ templateVersionId: null, sectionsSnapshot: customSnapshot })
        .where(eq(quoteRevisions.id, source.revision_id));

      const [sourceQuotationBefore] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, source.quotation_uuid));
      const [sourceRevisionBefore] = await db
        .select()
        .from(quoteRevisions)
        .where(eq(quoteRevisions.id, source.revision_id));
      const sourceItemsBefore = await db
        .select()
        .from(quoteRevisionItems)
        .where(eq(quoteRevisionItems.revisionId, source.revision_id))
        .orderBy(quoteRevisionItems.position);
      assert.ok(sourceQuotationBefore);
      assert.ok(sourceRevisionBefore);
      assert.equal(sourceItemsBefore.length, 2);

      const originalFetch = globalThis.fetch;
      let providerCalls = 0;
      globalThis.fetch = (async () => {
        providerCalls += 1;
        throw new Error('external provider must not be called');
      }) as typeof fetch;
      const localHandler = createHandler({ repository: create });
      let response;
      try {
        response = await localHandler(event({ quotation_id: source.quotation_name }));
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body || '{}').success, true);
      assert.equal(providerCalls, 0);
      const duplicateBusinessNumber = JSON.parse(response.body || '{}').new_id;
      assert.equal(typeof duplicateBusinessNumber, 'string');

      const [duplicateQuotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.businessNumber, duplicateBusinessNumber));
      assert.ok(duplicateQuotation);
      duplicateQuotationId = duplicateQuotation.id;
      assert.notEqual(duplicateQuotation.id, sourceQuotationBefore.id);
      assert.notEqual(duplicateQuotation.businessNumber, sourceQuotationBefore.businessNumber);
      assert.equal(duplicateQuotation.clientId, sourceQuotationBefore.clientId);
      assert.equal(duplicateQuotation.status, 'rascunho');

      const [duplicateRevision] = await db
        .select()
        .from(quoteRevisions)
        .where(eq(quoteRevisions.quotationId, duplicateQuotation.id));
      assert.ok(duplicateRevision);
      assert.notEqual(duplicateRevision.id, sourceRevisionBefore.id);
      assert.equal(duplicateRevision.version, 1);
      assert.equal(duplicateRevision.status, 'rascunho');
      assert.equal(duplicateRevision.clienteNome, sourceRevisionBefore.clienteNome);
      assert.equal(duplicateRevision.clienteEmail, sourceRevisionBefore.clienteEmail);
      assert.equal(duplicateRevision.clienteTelefone, sourceRevisionBefore.clienteTelefone);
      assert.equal(duplicateRevision.clienteEndereco, sourceRevisionBefore.clienteEndereco);
      assert.equal(duplicateRevision.clienteNotas, sourceRevisionBefore.clienteNotas);
      assert.equal(duplicateRevision.subtotal, sourceRevisionBefore.subtotal);
      assert.equal(duplicateRevision.total, sourceRevisionBefore.total);
      assert.equal(duplicateRevision.templateVersionId, null);
      assert.deepEqual(duplicateRevision.sectionsSnapshot, sourceRevisionBefore.sectionsSnapshot);

      const duplicateItems = await db
        .select()
        .from(quoteRevisionItems)
        .where(eq(quoteRevisionItems.revisionId, duplicateRevision.id))
        .orderBy(quoteRevisionItems.position);
      assert.equal(duplicateItems.length, sourceItemsBefore.length);
      assert.deepEqual(duplicateItems.map(snapshotItem), sourceItemsBefore.map(snapshotItem));
      assert.equal(new Set(duplicateItems.map((item) => item.id)).size, duplicateItems.length);
      assert.equal(
        duplicateItems.every((item) => !sourceItemsBefore.some((sourceItem) => sourceItem.id === item.id)),
        true,
      );

      const duplicateDeals = await db
        .select()
        .from(crmDeals)
        .where(eq(crmDeals.quotationId, duplicateQuotation.id));
      assert.equal(duplicateDeals.length, 1);
      assert.equal(duplicateDeals[0].clientId, fixtureClientId);
      assert.equal(duplicateDeals[0].status, 'Orcamento Enviado');


      const [sourceQuotationAfter] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, sourceQuotationBefore.id));
      const [sourceRevisionAfter] = await db
        .select()
        .from(quoteRevisions)
        .where(eq(quoteRevisions.id, sourceRevisionBefore.id));
      const sourceItemsAfter = await db
        .select()
        .from(quoteRevisionItems)
        .where(eq(quoteRevisionItems.revisionId, sourceRevisionBefore.id))
        .orderBy(quoteRevisionItems.position);
      assert.deepEqual(sourceQuotationAfter, sourceQuotationBefore);
      assert.deepEqual(sourceRevisionAfter, sourceRevisionBefore);
      assert.deepEqual(sourceItemsAfter, sourceItemsBefore);
    } finally {
      const ownedQuotations = await db
        .select({ id: quotations.id })
        .from(quotations)
        .where(eq(quotations.clientId, fixtureClientId));
      const quotationIds = [
        ...new Set([
          sourceQuotationId,
          duplicateQuotationId,
          ...ownedQuotations.map((quotation) => quotation.id),
        ].filter((id): id is string => Boolean(id))),
      ];
      if (quotationIds.length > 0) {
        await db.delete(crmDeals).where(inArray(crmDeals.quotationId, quotationIds));
        await db.delete(quotations).where(inArray(quotations.id, quotationIds));
      }
      await db.delete(clients).where(eq(clients.id, fixtureClientId));
      await db.delete(products).where(eq(products.sku, fixtureSku));
      if (seededTemplateVersionId) {
        await db
          .delete(quotationTemplateVersions)
          .where(eq(quotationTemplateVersions.id, seededTemplateVersionId));
      }
      if (seededTemplateModelId) {
        const remainingVersions = await db
          .select({ id: quotationTemplateVersions.id })
          .from(quotationTemplateVersions)
          .where(eq(quotationTemplateVersions.templateId, seededTemplateModelId));
        if (remainingVersions.length === 0) {
          await db
            .delete(quotationTemplates)
            .where(eq(quotationTemplates.id, seededTemplateModelId));
        }
      }
      if (sequenceBefore) {
        await db
          .insert(quoteSequences)
          .values(sequenceBefore)
          .onConflictDoUpdate({
            target: quoteSequences.year,
            set: { lastNumber: sequenceBefore.lastNumber },
          });
      } else {
        await db.delete(quoteSequences).where(eq(quoteSequences.year, year));
      }
      await client.end({ timeout: 5 });
    }
  },
);
