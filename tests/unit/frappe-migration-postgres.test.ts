import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';

import { createPostgresFrappeMigrationRepository } from '../../api/_db/frappe-migration-repository.js';
import * as schema from '../../api/_db/schema.js';
import {
  computeManifestHash,
  normalizeFrappeQuotation,
  runFrappeMigration as runFrappeMigrationImplementation,
} from '../../api/_functions/frappe-migration.js';
import { quotationPdfChecksum } from '../../api/_functions/lib/quotation-document-storage.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const runFrappeMigration = (options: Parameters<typeof runFrappeMigrationImplementation>[0]) =>
  runFrappeMigrationImplementation(
    options.mode === 'apply' && !options.expectedManifestHash
      ? { ...options, expectedManifestHash: computeManifestHash(options.dataset!) }
      : options
  );
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);

test('PostgreSQL adapter mapeia contrato de linhagem sem banco externo', async () => {
  const sourceUpdatedAt = new Date('2024-01-05T03:04:05.000Z');
  const importedAt = new Date('2024-01-06T03:04:05.000Z');
  const lineageRow = {
    provider: 'frappe',
    sourceDoctype: 'Quotation',
    sourceId: 'QTN-ADAPTER',
    entityType: 'orcamento',
    localId: '00000000-0000-4000-8000-000000000001',
    localKey: '00000000-0000-4000-8000-000000000001',
    canonicalHash: 'a'.repeat(64),
    sourceHash: 'a'.repeat(64),
    businessNumber: 'ORC-20240001',
    migrationRunId: '00000000-0000-4000-8000-000000000002',
    sourceUpdatedAt,
    importedAt,
    lineageStatus: 'legacy-unverified',
  };
  const rowsFor = (table: unknown) =>
    table === schema.frappeImportLineage ? [lineageRow] : [];
  const fakeDb = {
    select() {
      return {
        from(table: unknown) {
          const rows = rowsFor(table);
          const query = Promise.resolve(rows) as any;
          query.orderBy = async () => rows;
          return query;
        },
      };
    },
  } as any;
  const repository = createPostgresFrappeMigrationRepository(() => fakeDb);
  const state = await repository.loadState();
  assert.deepEqual(state.lineage, [lineageRow]);
  assert.equal(state.lineage[0].provider, 'frappe');
  assert.equal(state.lineage[0].localId, lineageRow.localId);
  assert.equal(state.lineage[0].sourceHash, lineageRow.sourceHash);
  assert.equal(state.lineage[0].businessNumber, lineageRow.businessNumber);
  assert.equal(state.lineage[0].migrationRunId, lineageRow.migrationRunId);
  assert.equal(state.lineage[0].sourceUpdatedAt, sourceUpdatedAt);
  assert.equal(state.lineage[0].importedAt, importedAt);
});

test('PostgreSQL-shaped Quotation com enrichment falho é rejeitada antes da normalização', () => {
  let touched = false;
  const record = {
    __migration_enrichment_error: true,
    get party_name() {
      touched = true;
      return 'CUST-ENRICHMENT';
    },
    get items() {
      touched = true;
      return [];
    },
  };
  assert.throws(() => normalizeFrappeQuotation(record, new Map()), /enrichment|enriquec/i);
  assert.equal(touched, false);
});

test(
  'PostgreSQL importação aplica atomicamente, é idempotente e preserva linhagem',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sku = `MIGRATION-${suffix}`;
    const itemId = `ITEM-${suffix}`;
    const priceId = `PR-${suffix}`;
    const customerId = `CUST-${suffix}`;
    const customerDocument = `9${suffix.replace(/[^0-9]/g, '').slice(-10).padStart(10, '0')}`;
    const triggerName = `migration_fail_${suffix.replace(/[^a-z0-9_]/gi, '_')}`;
    const functionName = `${triggerName}_fn`;
    const dataset = {
      items: [{ name: itemId, item_code: sku, item_name: 'Produto PG' }],
      pricingRules: [{ name: priceId, item_code: sku, min_qty: 30, price_list_rate: '9.00' }],
      itemPrices: [],
      customers: [{ name: customerId, customer_name: `Cliente PG lineage ${suffix}`, tax_id: customerDocument }],
      leads: [],
    };
    try {
      await migrate(db, { migrationsFolder });
      const repository = createPostgresFrappeMigrationRepository(() => db);
      const first = await runFrappeMigration({ mode: 'apply', dataset, repository });
      assert.equal(first.report.produtos.criados, 1);
      assert.equal(first.report.faixas.criados, 1);
      assert.equal(first.report.clientes.criados, 1);
      const clientLineageRows = await db
        .select()
        .from(schema.frappeImportLineage)
        .where(eq(schema.frappeImportLineage.sourceId, customerId));
      assert.equal(clientLineageRows.length, 1);
      assert.match(clientLineageRows[0].legacyPayload?.customer_name || '', /^Cliente PG lineage /);
      assert.equal((await repository.loadState()).lineage.some((entry) => 'legacyPayload' in entry), false);
      // PostgreSQL numeric columns return fixed scales (30.000), while the
      // source normalizer emits canonical decimals (30); the rerun remains a
      // no-op rather than being misclassified as an update.
      const rerun = await runFrappeMigration({ mode: 'apply', dataset, repository });
      assert.equal(rerun.report.produtos.ignorados, 1);
      assert.equal(rerun.report.faixas.ignorados, 1);
      const lineageBefore = await db.select().from(schema.frappeImportLineage);
      assert.ok(lineageBefore.some((row) => row.sourceId === itemId));

      await client.unsafe(`
      CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'migration trigger failure'; END; $$;
      CREATE TRIGGER ${triggerName} BEFORE INSERT ON product_pricing_tiers
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `);
      try {
        const failed = await runFrappeMigration({
          mode: 'apply',
          dataset: {
            ...dataset,
            items: [{ name: itemId, item_code: sku, item_name: 'Produto PG atualizado' }],
          },
          repository,
        });
        assert.equal(failed.report.produtos.criados, 0);
        assert.equal(failed.report.produtos.atualizados, 0);
        assert.equal(failed.report.produtos.erros, 1);
        assert.equal(failed.report.faixas.erros, 1);
        const state = await repository.loadState();
        assert.equal(state.products.find((row) => row.sku === sku)?.nome, 'Produto PG');
      } finally {
        await client.unsafe(
          `DROP TRIGGER IF EXISTS ${triggerName} ON product_pricing_tiers; DROP FUNCTION IF EXISTS ${functionName}();`
        );
      }
    } finally {
      await client.unsafe('DELETE FROM frappe_import_lineage WHERE source_id LIKE $1', [
        `%${suffix}`,
      ]);
      await client.unsafe('DELETE FROM product_pricing_tiers WHERE product_sku LIKE $1', [
        `%${suffix}`,
      ]);
      await client.unsafe('DELETE FROM products WHERE sku LIKE $1', [`%${suffix}`]);
      await client.unsafe('DELETE FROM clients WHERE documento = $1', [customerDocument]);
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'PostgreSQL orçamentos importam com revisão, itens, documento histórico e contador',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sku = `SKU-QT-${suffix}`;
    const itemId = `ITEM-QT-${suffix}`;
    const customerId = `CUST-QT-${suffix}`;
    const document = String(Math.floor(1e10 + Math.random() * 9e10));
    const sequence = 1000 + Math.floor(Math.random() * 8000);
    const quotationId = `QTN-2024-${String(sequence).padStart(5, '0')}`;
    const expectedBusinessNumber = `ORC-2024${String(sequence).padStart(4, '0')}`;
    const dataset = {
      items: [{ name: itemId, item_code: sku, item_name: 'Produto PG', stock_uom: 'Und' }],
      pricingRules: [],
      itemPrices: [],
      customers: [{ name: customerId, customer_name: 'Cliente PG', tax_id: document }],
      leads: [],
      quotations: [
        {
          name: quotationId,
          creation: '2024-06-01 09:00:00',
          quotation_to: 'Customer',
          customer: customerId,
          status: 'Submitted',
          valid_till: '2024-07-01',
          payment_terms_template: 'PIX à vista',
          net_total: '50.00',
          grand_total: '50.00',
          items: [
            {
              idx: 1,
              item_code: sku,
              item_name: 'Produto PG',
              qty: '10',
              uom: 'Und',
              rate: '5.00',
              price_list_rate: '5.00',
              amount: '50.00',
              notes: 'Observação PG',
            },
          ],
        },
      ],
    };
    try {
      await migrate(db, { migrationsFolder });
      const repository = createPostgresFrappeMigrationRepository(() => db);
      const appliedUnits: Array<Parameters<typeof repository.applyQuotationUnit>[0]> = [];
      const applyQuotationUnit = repository.applyQuotationUnit.bind(repository);
      repository.applyQuotationUnit = async (unit) => {
        appliedUnits.push(unit);
        return applyQuotationUnit(unit);
      };
      const first = await runFrappeMigration({ mode: 'apply', dataset, repository });
      assert.equal(first.report.produtos.criados, 1);
      assert.equal(first.report.clientes.criados, 1);
      assert.equal(first.report.orcamentos.criados, 1);

      const quotationRows = await db
        .select()
        .from(schema.quotations)
        .where(sql`${schema.quotations.businessNumber} = ${expectedBusinessNumber}`);
      assert.equal(quotationRows.length, 1);
      assert.equal(quotationRows[0].status, 'enviado');
      const revisionRows = await db
        .select()
        .from(schema.quoteRevisions)
        .where(eq(schema.quoteRevisions.quotationId, quotationRows[0].id));
      assert.equal(revisionRows.length, 1);
      assert.equal(revisionRows[0].version, 1);
      assert.equal(revisionRows[0].validadeDias, 30);
      assert.equal(revisionRows[0].clienteNome, 'Cliente PG');
      const itemRows = await db
        .select()
        .from(schema.quoteRevisionItems)
        .where(eq(schema.quoteRevisionItems.revisionId, revisionRows[0].id));
      assert.equal(itemRows.length, 1);
      assert.equal(Number(itemRows[0].quantidade), 10);
      assert.equal(itemRows[0].precoAplicado, '5.00');
      assert.equal(itemRows[0].notas, 'Observação PG');
      // issuedDocuments check removed (#no-pdf-html-only)
      const sequenceRows = await db
        .select()
        .from(schema.quoteSequences)
        .where(eq(schema.quoteSequences.year, 2024));
      assert.ok(sequenceRows.length === 1 && Number(sequenceRows[0].lastNumber) >= sequence);
      const lineageRows = await db
        .select()
        .from(schema.frappeImportLineage)
        .where(eq(schema.frappeImportLineage.sourceId, quotationId));
      assert.equal(lineageRows.length, 1);
      assert.equal(lineageRows[0].entityType, 'orcamento');

      const rerun = await runFrappeMigration({ mode: 'apply', dataset, repository });
      assert.equal(rerun.report.orcamentos.ignorados, 1);
      const quotationRowsAfter = await db
        .select()
        .from(schema.quotations)
        .where(sql`${schema.quotations.businessNumber} = ${expectedBusinessNumber}`);
      assert.equal(quotationRowsAfter.length, 1);
      const itemRowsAfter = await db
        .select()
        .from(schema.quoteRevisionItems)
        .where(eq(schema.quoteRevisionItems.revisionId, revisionRows[0].id));
      assert.equal(itemRowsAfter.length, 1);
      // issuedDocuments check removed (#no-pdf-html-only)

      // A changed source quotation is updated in place without duplicating rows.
      const updated = await runFrappeMigration({
        mode: 'apply',
        dataset: {
          ...dataset,
          quotations: [{ ...dataset.quotations[0], status: 'Ordered' }],
        },
        repository,
      });
      assert.equal(updated.report.orcamentos.atualizados, 1);
      const quotationRowsUpdated = await db
        .select()
        .from(schema.quotations)
        .where(sql`${schema.quotations.businessNumber} = ${expectedBusinessNumber}`);
      assert.equal(quotationRowsUpdated.length, 1);
      assert.equal(quotationRowsUpdated[0].status, 'rascunho');
      const revisionsAfterAppend = await db
        .select()
        .from(schema.quoteRevisions)
        .where(eq(schema.quoteRevisions.quotationId, quotationRowsUpdated[0].id))
        .orderBy(schema.quoteRevisions.version);
      assert.equal(revisionsAfterAppend.length, 2);
      assert.equal(revisionsAfterAppend[0].status, 'enviado');
      assert.equal(revisionsAfterAppend[0].total, '50.00');
      assert.equal(revisionsAfterAppend[1].status, 'rascunho');
      assert.equal(revisionsAfterAppend[1].version, 2);
      const draftRevisionId = revisionsAfterAppend[1].id;
      const appendedUnit = appliedUnits.at(-1)!;
      const oldItemsBeforeReapply = await db
        .select()
        .from(schema.quoteRevisionItems)
        .where(eq(schema.quoteRevisionItems.revisionId, revisionsAfterAppend[0].id));
      await repository.applyQuotationUnit(appendedUnit);
      const revisionsAfterReapply = await db
        .select()
        .from(schema.quoteRevisions)
        .where(eq(schema.quoteRevisions.quotationId, quotationRowsUpdated[0].id))
        .orderBy(schema.quoteRevisions.version);
      const oldItemsAfterReapply = await db
        .select()
        .from(schema.quoteRevisionItems)
        .where(eq(schema.quoteRevisionItems.revisionId, revisionsAfterAppend[0].id));
      assert.equal(revisionsAfterReapply.length, 2);
      assert.deepEqual(oldItemsAfterReapply, oldItemsBeforeReapply);
      assert.equal(revisionsAfterReapply[0].total, '50.00');
      assert.equal(revisionsAfterReapply[1].id, draftRevisionId);

      const draftUpdate = await runFrappeMigration({
        mode: 'apply',
        dataset: {
          ...dataset,
          quotations: [{
            ...dataset.quotations[0],
            status: 'Ordered',
            net_total: '75.00',
            grand_total: '75.00',
            items: [{ ...dataset.quotations[0].items[0], rate: '7.50', amount: '75.00' }],
          }],
        },
        repository,
      });
      assert.equal(draftUpdate.report.orcamentos.atualizados, 1);
      const revisionsAfterDraftUpdate = await db
        .select()
        .from(schema.quoteRevisions)
        .where(eq(schema.quoteRevisions.quotationId, quotationRowsUpdated[0].id))
        .orderBy(schema.quoteRevisions.version);
      assert.equal(revisionsAfterDraftUpdate.length, 2);
      assert.equal(revisionsAfterDraftUpdate[1].id, draftRevisionId);
      assert.equal(revisionsAfterDraftUpdate[1].status, 'rascunho');
      const [quotationAfterDraftUpdate] = await db
        .select({ status: schema.quotations.status })
        .from(schema.quotations)
        .where(eq(schema.quotations.id, quotationRowsUpdated[0].id));
      assert.equal(quotationAfterDraftUpdate?.status, 'rascunho');
      assert.equal(revisionsAfterDraftUpdate[1].total, '75.00');
      assert.equal(revisionsAfterDraftUpdate[0].total, '50.00');
    } finally {
      // Only remove the sequence row when this test created it; a higher value
      // from another suite must not be destroyed.
      await client.unsafe('DELETE FROM quote_sequences WHERE year = $1 AND last_number <= $2', [
        2024,
        sequence,
      ]);
      await client.unsafe('DELETE FROM frappe_import_lineage WHERE source_id LIKE $1', [
        `%${suffix}`,
      ]);
      await client.unsafe('DELETE FROM quotations WHERE business_number LIKE $1', [
        `%${expectedBusinessNumber}`,
      ]);
      await client.unsafe('DELETE FROM clients WHERE nome LIKE $1', [`%${suffix}`]);
      await client.unsafe('DELETE FROM products WHERE sku LIKE $1', [`%${suffix}`]);
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'PostgreSQL mantém PDF histórico on-demand sem linha de documento arquivado',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sku = `SKU-ARCH-${suffix}`;
    const itemId = `ITEM-ARCH-${suffix}`;
    const customerId = `CUST-ARCH-${suffix}`;
    const document = String(Math.floor(1e10 + Math.random() * 9e10));
    const sequence = 2000 + Math.floor(Math.random() * 8000);
    const quotationId = `QTN-2024-${String(sequence).padStart(5, '0')}`;
    const expectedBusinessNumber = `ORC-2024${String(sequence).padStart(4, '0')}`;
    const blobs = new Map<string, Buffer>();
    let fetchHtmlCalls = 0;
    let renderPdfCalls = 0;
    let blobPutCalls = 0;
    const pipeline = {
      async fetchHtml(): Promise<string> {
        fetchHtmlCalls += 1;
        throw new Error('historical PDF fetch must not run for PostgreSQL on-demand policy');
      },
      async renderPdf(): Promise<Buffer> {
        renderPdfCalls += 1;
        throw new Error('historical PDF render must not run for PostgreSQL on-demand policy');
      },
      blobs: {
        async list(prefix: string): Promise<string[]> {
          return [...blobs.keys()].filter((pathname) => pathname.startsWith(prefix));
        },
        async put(pathname: string, buffer: Buffer) {
          blobPutCalls += 1;
          blobs.set(pathname, buffer);
          return {
            pathname,
            sizeBytes: buffer.length,
            checksumSha256: quotationPdfChecksum(buffer),
          };
        },
      },
    };
    const dataset = {
      items: [{ name: itemId, item_code: sku, item_name: 'Produto PG', stock_uom: 'Und' }],
      pricingRules: [],
      itemPrices: [],
      customers: [{ name: customerId, customer_name: 'Cliente PG', tax_id: document }],
      leads: [],
      quotations: [
        {
          name: quotationId,
          creation: '2024-06-01 09:00:00',
          quotation_to: 'Customer',
          customer: customerId,
          status: 'Submitted',
          items: [
            {
              idx: 1,
              item_code: sku,
              item_name: 'Produto PG',
              qty: '10',
              uom: 'Und',
              rate: '5.00',
              price_list_rate: '5.00',
              amount: '50.00',
            },
          ],
        },
      ],
    };
    try {
      await migrate(db, { migrationsFolder });
      const repository = createPostgresFrappeMigrationRepository(() => db);
      const first = await runFrappeMigration({
        mode: 'apply',
        dataset,
        repository,
        pdfPipeline: pipeline,
      });
      assert.equal(first.report.orcamentos.criados, 1);
      // Historical PDF rows were removed in the on-demand document policy.
      // The injected pipeline must remain unused by migration apply.
      assert.equal(first.report.documentos.lidos, 0);
      assert.equal(first.report.documentos.atualizados, 0);
      assert.equal(fetchHtmlCalls, 0);
      assert.equal(renderPdfCalls, 0);
      assert.equal(blobPutCalls, 0);
      assert.equal(blobs.size, 0);
      const [legacyTable] = await client.unsafe(
        "SELECT to_regclass('public.issued_documents') AS table_name"
      );
      let legacyBusinessColumn: string | undefined;
      if (legacyTable?.table_name) {
        const columns = await client.unsafe(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'issued_documents'"
        );
        const available = new Set(columns.map((row) => String(row.column_name)));
        legacyBusinessColumn = ['business_number', 'quotation_name', 'quotation', 'quotation_id'].find(
          (column) => available.has(column)
        );
        assert.ok(legacyBusinessColumn, 'issued_documents must expose a quotation reference');
        const value = legacyBusinessColumn === 'business_number' || legacyBusinessColumn === 'quotation_name' || legacyBusinessColumn === 'quotation'
          ? expectedBusinessNumber
          : (await client.unsafe(
              'SELECT id FROM quotations WHERE business_number = $1',
              [expectedBusinessNumber]
            ))[0]?.id;
        assert.ok(value, 'imported quotation must exist before legacy-row check');
        const [legacyRow] = await client.unsafe(
          `SELECT count(*)::int AS count FROM public.issued_documents WHERE ${legacyBusinessColumn} = $1`,
          [value]
        );
        assert.equal(Number(legacyRow?.count || 0), 0);
      }

      // Rerun remains idempotent without creating an archived-document row.
      const rerun = await runFrappeMigration({
        mode: 'apply',
        dataset,
        repository,
        pdfPipeline: pipeline,
      });
      assert.equal(rerun.report.orcamentos.ignorados, 1);
      assert.equal(rerun.report.documentos.ignorados, 0);
      assert.equal(rerun.report.documentos.atualizados, 0);
      assert.equal(fetchHtmlCalls, 0);
      assert.equal(renderPdfCalls, 0);
      assert.equal(blobPutCalls, 0);
      assert.equal(blobs.size, 0);
      if (legacyTable?.table_name && legacyBusinessColumn) {
        const legacyValue = legacyBusinessColumn === 'quotation_id'
          ? (await client.unsafe(
              'SELECT id FROM quotations WHERE business_number = $1',
              [expectedBusinessNumber]
            ))[0]?.id
          : expectedBusinessNumber;
        const [legacyRow] = await client.unsafe(
          `SELECT count(*)::int AS count FROM public.issued_documents WHERE ${legacyBusinessColumn} = $1`,
          [legacyValue]
        );
        assert.equal(Number(legacyRow?.count || 0), 0);
      }
    } finally {
      await client.unsafe('DELETE FROM quote_sequences WHERE year = $1 AND last_number <= $2', [
        2024,
        sequence,
      ]);
      await client.unsafe('DELETE FROM frappe_import_lineage WHERE source_id LIKE $1', [
        `%${suffix}`,
      ]);
      await client.unsafe('DELETE FROM quotations WHERE business_number LIKE $1', [
        `%${expectedBusinessNumber}`,
      ]);
      await client.unsafe('DELETE FROM clients WHERE nome LIKE $1', [`%${suffix}`]);
      await client.unsafe('DELETE FROM products WHERE sku LIKE $1', [`%${suffix}`]);
      await client.end({ timeout: 5 });
    }
  }
);
