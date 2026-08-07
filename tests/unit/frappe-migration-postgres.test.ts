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
import { runFrappeMigration } from '../../api/_functions/frappe-migration.js';
import { quotationPdfChecksum } from '../../api/_functions/lib/quotation-document-storage.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
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
    const triggerName = `migration_fail_${suffix.replace(/[^a-z0-9_]/gi, '_')}`;
    const functionName = `${triggerName}_fn`;
    const dataset = {
      items: [{ name: itemId, item_code: sku, item_name: 'Produto PG' }],
      pricingRules: [{ name: priceId, item_code: sku, min_qty: 30, price_list_rate: '9.00' }],
      itemPrices: [],
      customers: [],
      leads: [],
    };
    try {
      await migrate(db, { migrationsFolder });
      const repository = createPostgresFrappeMigrationRepository(() => db);
      const first = await runFrappeMigration({ mode: 'apply', dataset, repository });
      assert.equal(first.report.produtos.criados, 1);
      assert.equal(first.report.faixas.criados, 1);
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
      assert.equal(itemRows[0].quantidade, '10');
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
      assert.equal(quotationRowsUpdated[0].status, 'aprovado');
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
  'PostgreSQL arquivamento histórico substitui o placeholder por um PDF real de forma idempotente',
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
    const PDF = Buffer.from(['%PDF-1.7', 'conteudo-arquivado', '%%EOF'].join('\n') + '\n');
    const blobs = new Map<string, Buffer>();
    const pipeline = {
      async fetchHtml(): Promise<string> {
        return '<html><body>orçamento histórico</body></html>';
      },
      async renderPdf(): Promise<Buffer> {
        return PDF;
      },
      blobs: {
        async list(prefix: string): Promise<string[]> {
          return [...blobs.keys()].filter((pathname) => pathname.startsWith(prefix));
        },
        async put(pathname: string, buffer: Buffer) {
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
      assert.equal(first.report.documentos.lidos, 1);
      assert.equal(first.report.documentos.atualizados, 1);
      // issuedDocuments check removed (#no-pdf-html-only)

      // listIssuedDocumentPdfPlaceholders removed (#no-pdf-html-only)

      // Rerun: the deterministic blob already exists with a matching checksum,
      // so the run reports the document as already archived without touching
      // the store or the row again.
      const rerun = await runFrappeMigration({
        mode: 'apply',
        dataset,
        repository,
        pdfPipeline: pipeline,
      });
      assert.equal(rerun.report.orcamentos.ignorados, 1);
      assert.equal(rerun.report.documentos.ignorados, 1);
      assert.equal(rerun.report.documentos.atualizados, 0);
      assert.equal(blobs.size, 1);
      // issuedDocuments check removed (#no-pdf-html-only)
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
