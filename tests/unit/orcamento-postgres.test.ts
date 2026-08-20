import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { eq, inArray, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import {
  createPostgresQuoteDraftRepository,
  QuoteDraftInputError,
  QuoteDraftRepositoryError,
} from '../../api/_infrastructure/db/repositories/quote-repository.js';
import {
  appSettings,
  clients,
  productPricingTiers,
  products,
  quoteRevisionItems,
  quoteRevisions,
  quoteSequences,
  quotations,
} from '../../api/_infrastructure/db/schema.js';
import * as schema from '../../api/_infrastructure/db/schema.js';

const TEST_DATABASE_URL = process.env.TEST_QUOTE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

test('PostgreSQL quote drafts reserve sequential numbers and roll back every write atomically', { skip: !TEST_DATABASE_URL }, async () => {
  const client = postgres(TEST_DATABASE_URL!, {
    max: 12,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });
  const year = 2026;
  const suffix = `${Date.now()}`;
  const sku = `QUOTE-TEST-${suffix}`;
  const existingClientId = '44444444-4444-4444-8444-444444444444';
  const existingDocument = '12345678000195';
  const rollbackDocument = '98765432000198';
  const now = () => new Date(`${year}-07-15T12:00:00.000Z`);

  try {
    await migrate(db, { migrationsFolder });
    await db
      .update(appSettings)
      .set({ templatePadrao: 'padrao' })
      .where(eq(appSettings.singletonId, 1));

    // This test intentionally uses fixed client IDs/documents so its
    // aggregate can be removed narrowly when the same dedicated database is
    // reused. Deleting quotations first lets the revision/item cascades run;
    // no unrelated clients, products, or schemas are touched.
    const fixtureDocuments = [existingDocument, rollbackDocument, '24681357000190'];
    const fixtureClientRows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(or(eq(clients.id, existingClientId), inArray(clients.documento, fixtureDocuments)));
    const fixtureClientIds = fixtureClientRows.map((row) => row.id);
    if (fixtureClientIds.length > 0) {
      await db.delete(quotations).where(inArray(quotations.clientId, fixtureClientIds));
    }
    await db.delete(quoteSequences).where(eq(quoteSequences.year, year));
    await db.delete(clients).where(
      or(eq(clients.id, existingClientId), inArray(clients.documento, fixtureDocuments)),
    );

    await db.insert(products).values({
      sku,
      nome: 'Produto snapshot original',
      descricao: 'Descrição original',
      unidade: 'Und',
      categoria: 'Categoria original',
      marca: 'Marca original',
      precoBase: '12.30',
      ativo: true,
    }).onConflictDoNothing();
    await db.insert(productPricingTiers).values([
      { productSku: sku, minimumQuantity: '30.000', unitPrice: '9.00' },
      { productSku: sku, minimumQuantity: '100.000', unitPrice: '8.00' },
    ]).onConflictDoNothing();
    await db.insert(clients).values({
      id: existingClientId,
      nome: 'Cliente snapshot original',
      documento: existingDocument,
      email: 'snapshot@example.com',
      telefone: '5511999990000',
      notes: 'Nota original',
      endereco: 'Rua Original',
      numero: '10',
      municipio: 'São Paulo',
      uf: 'SP',
      cep: '01001000',
      arquivado: false,
    }).onConflictDoNothing();

    await db.delete(quoteSequences).where(eq(quoteSequences.year, year));
    const repository = createPostgresQuoteDraftRepository(() => db, { now });
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => repository.createDraft({
      client_id: existingClientId,
      items: [{ item_code: sku, qty: '30.001' }],
      frete: '0.00',
    })));
    const numbers = concurrent.map((result) => result.quotation_name).sort();
    assert.deepEqual(numbers, [1, 2, 3, 4].map((number) => `ORC-${year}${String(number).padStart(4, '0')}`));
    assert.equal(new Set(numbers).size, numbers.length);
    assert.equal(concurrent[0].items[0].suggested_unit_price, '9.00');
    assert.equal(concurrent[0].items[0].line_total, '270.01');
    assert.equal(concurrent[0].subtotal, '270.01');

    const customItemName = 'Lenço 100 x 100 cm';
    const manual = await repository.createDraft({
      client_id: existingClientId,
      items: [
        { item_code: sku, item_name: customItemName, qty: '30.001', manual_rate: true, rate: '10.00' },
        { item_code: sku, qty: '1.001', manual_rate: true, rate: '2.50' },
      ],
      frete: '1.25',
    });
    assert.equal(manual.quotation_name, `ORC-${year}0005`);
    assert.equal(manual.subtotal, '302.51');
    assert.equal(manual.frete, '1.25');
    assert.equal(manual.total, '303.76');
    assert.equal(manual.items[0].suggested_unit_price, '9.00');
    assert.equal(manual.items[0].applied_unit_price, '10.00');
    assert.equal(manual.items[0].price_difference, '1.00');
    assert.equal(manual.items[0].nome, customItemName);

    // Mutating source rows after creation must not change persisted snapshots.
    await db.update(products).set({
      nome: 'Produto alterado depois',
      descricao: 'Descrição alterada depois',
      unidade: 'Cx',
      categoria: 'Categoria alterada',
      marca: 'Marca alterada',
    }).where(eq(products.sku, sku));
    await db.update(clients).set({
      nome: 'Cliente alterado depois',
      notes: 'Nota alterada depois',
    }).where(eq(clients.id, existingClientId));
    const revisionRow = await db.select().from(quoteRevisions).where(eq(quoteRevisions.id, manual.revision_id));
    const itemRows = await db.select().from(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, manual.revision_id));
    assert.equal(revisionRow[0]?.clienteNome, 'Cliente snapshot original');
    assert.equal(revisionRow[0]?.clienteNotas, 'Nota original');
    assert.equal(itemRows[0]?.produtoNome, customItemName);
    assert.equal(itemRows[0]?.produtoDescricao, 'Descrição original');
    assert.equal(itemRows[0]?.produtoUnidade, 'Und');
    assert.equal(itemRows[0]?.quantidade, '30.001');

    await client.unsafe(`
      CREATE OR REPLACE FUNCTION quote_test_fail_revision() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'quote test failure'; END; $$;
      CREATE TRIGGER quote_test_fail_revision_trigger
      BEFORE INSERT ON quote_revisions FOR EACH ROW
      EXECUTE FUNCTION quote_test_fail_revision();
    `);
    const beforeFailureCounts = {
      clients: (await db.select().from(clients)).length,
      quotations: (await db.select().from(quotations)).length,
      revisions: (await db.select().from(quoteRevisions)).length,
      items: (await db.select().from(quoteRevisionItems)).length,
    };
    try {
      await assert.rejects(
        () => repository.createDraft({
          nome: 'Cliente que deve reverter',
          documento: rollbackDocument,
          email: 'rollback@example.com',
          telefone: '5511988880000',
          items: [{ item_code: sku, qty: '1.000' }],
        }),
        (error: unknown) => error instanceof QuoteDraftRepositoryError && error.statusCode === 503,
      );
      const [sequenceAfterFailure] = await db.select().from(quoteSequences).where(eq(quoteSequences.year, year));
      assert.equal(sequenceAfterFailure?.lastNumber, 5);
      assert.equal((await db.select().from(clients).where(eq(clients.documento, rollbackDocument))).length, 0);
      assert.equal((await db.select().from(quotations)).length, beforeFailureCounts.quotations);
      assert.equal((await db.select().from(quoteRevisions)).length, beforeFailureCounts.revisions);
      assert.equal((await db.select().from(quoteRevisionItems)).length, beforeFailureCounts.items);
      assert.equal((await db.select().from(clients)).length, beforeFailureCounts.clients);
    } finally {
      await client.unsafe('DROP TRIGGER IF EXISTS quote_test_fail_revision_trigger ON quote_revisions');
      await client.unsafe('DROP FUNCTION IF EXISTS quote_test_fail_revision()');
    }

    const afterRollback = await repository.createDraft({
      nome: 'Cliente após rollback',
      documento: rollbackDocument,
      email: 'after@example.com',
      telefone: '5511977770000',
      items: [{ item_code: sku, qty: '1.000' }],
    });
    assert.equal(afterRollback.quotation_name, `ORC-${year}0006`);

    const quoteObservations = 'Observação exclusiva da cotação';
    const inlineWithQuoteObservations = await repository.createDraft({
      nome: 'Cliente sem observação própria',
      documento: '24681357000190',
      items: [{ item_code: sku, qty: '1.000' }],
      observacoes: quoteObservations,
    });
    const [inlineClient] = await db
      .select()
      .from(clients)
      .where(eq(clients.documento, '24681357000190'));
    const [inlineRevision] = await db
      .select()
      .from(quoteRevisions)
      .where(eq(quoteRevisions.id, inlineWithQuoteObservations.revision_id));
    assert.equal(inlineClient?.notes, null);
    assert.equal(inlineRevision?.observacoes, quoteObservations);

    const boundaryCounts = {
      clients: (await db.select().from(clients)).length,
      quotations: (await db.select().from(quotations)).length,
      revisions: (await db.select().from(quoteRevisions)).length,
      items: (await db.select().from(quoteRevisionItems)).length,
    };
    const [boundarySequence] = await db.select().from(quoteSequences).where(eq(quoteSequences.year, year));

    const assertBoundaryRejects = async (
      input: Parameters<typeof repository.createDraft>[0],
      expectedMessage: RegExp,
    ) => {
      await assert.rejects(
        () => repository.createDraft(input),
        (error: unknown) => {
          assert.ok(error instanceof QuoteDraftInputError);
          assert.equal(error.statusCode, 400);
          assert.match(error.message, expectedMessage);
          return true;
        },
      );
      const [sequence] = await db.select().from(quoteSequences).where(eq(quoteSequences.year, year));
      assert.equal(sequence?.lastNumber, boundarySequence?.lastNumber);
      assert.equal((await db.select().from(clients)).length, boundaryCounts.clients);
      assert.equal((await db.select().from(quotations)).length, boundaryCounts.quotations);
      assert.equal((await db.select().from(quoteRevisions)).length, boundaryCounts.revisions);
      assert.equal((await db.select().from(quoteRevisionItems)).length, boundaryCounts.items);
    };

    await assertBoundaryRejects({
      client_id: existingClientId,
      items: [{ item_code: sku, item_name: 'N'.repeat(256), qty: '1.000' }],
      frete: '0.00',
    }, /Nome exibido no orçamento/);

    // Quantity and manual unit price are individually valid, but their rounded
    // line total would exceed numeric(20,2).
    await assertBoundaryRejects({
      client_id: existingClientId,
      items: [{ item_code: sku, qty: '99999999999.999', manual_rate: true, rate: '10000000.01' }],
      frete: '0.00',
    }, /Total da linha 1/);

    // Each line fits numeric(20,2), while their subtotal does not.
    await assertBoundaryRejects({
      client_id: existingClientId,
      items: [
        { item_code: sku, qty: '99999999999.999', manual_rate: true, rate: '6000000.00' },
        { item_code: sku, qty: '99999999999.999', manual_rate: true, rate: '6000000.00' },
      ],
      frete: '0.00',
    }, /Subtotal/);

    // The freight itself is valid at the maximum, but adding a positive line
    // would exceed the persisted total column.
    await assertBoundaryRejects({
      client_id: existingClientId,
      items: [{ item_code: sku, qty: '1.000' }],
      frete: '999999999999999999.99',
    }, /Total do orçamento/);
  } finally {
    await client.end({ timeout: 5 });
  }
});
