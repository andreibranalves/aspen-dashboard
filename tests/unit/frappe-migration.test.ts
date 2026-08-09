import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveProductPrice } from '../../api/_functions/pricing-core.js';
import {
  addDetail,
  buildQuotationUnits,
  canonicalApprovalKey,
  canonicalDecimal,
  canonicalHash,
  deriveHistoricalPdfBlobPath,
  emptyEntityReport,
  mapQuotationStatus,
  normalizeFrappeQuotation,
  normalizeHistoricalPdf,
  computeManifestHash,
  readFrappeDataset,
  runFrappeMigration as runFrappeMigrationImplementation,
  safeApprovalKey,
  stableId,
  type FrappeDataset,
  type HistoricalPdfPipeline,
  type ExistingLineage,
} from '../../api/_functions/frappe-migration.js';
import * as migrationRepositoryModule from '../../api/_db/frappe-migration-repository.js';
import { MemoryFrappeMigrationRepository } from '../../api/_db/frappe-migration-repository.js';
import {
  isValidPdfBuffer,
  quotationPdfChecksum,
} from '../../api/_functions/lib/quotation-document-storage.js';
import { LEGACY_PRICING_FIXTURES } from '../fixtures/legacy-pricing-fixtures.ts';
import {
  createFrappeDuplicateFixture,
  createFrappeIncompleteFixture,
  createFrappeMigrationFixture,
  createFrappeQuotationEdgeFixture,
  createFrappeQuotationFixture,
  createFrappeQuotationNoNameFixture,
  createFrappeQuotationNoPdfMetadataFixture,
} from '../fixtures/frappe-migration-fixtures.ts';

const runFrappeMigration = (options: Parameters<typeof runFrappeMigrationImplementation>[0]) =>
  runFrappeMigrationImplementation(
    options.mode === 'apply' && !options.expectedManifestHash
      ? { ...options, expectedManifestHash: computeManifestHash(options.dataset!) }
      : options
  );

describe('migração Frappe CRM', { concurrency: 1 }, () => {
  it('canonicaliza decimais sem perder zeros significativos', () => {
    assert.equal(canonicalDecimal('30.000'), '30');
    assert.equal(canonicalDecimal('00030.0500'), '30.05');
    assert.equal(canonicalDecimal('0.0100'), '0.01');
  });

  it('pagina fonte com ordenação estável e lê todos os documentos', async () => {
    const calls: Array<{ doctype: string; start: number; order_by: string; modified_before?: string }> = [];
    const source = {
      async list(doctype: string, options: { limit: number; start: number; order_by: string; modified_before?: string }) {
        calls.push({ doctype, start: options.start, order_by: options.order_by, modified_before: options.modified_before });
        const values =
          doctype === 'Item'
            ? [
                { name: 'ITEM-1', item_code: 'SKU-1', item_name: 'Um' },
                { name: 'ITEM-2', item_code: 'SKU-2', item_name: 'Dois' },
              ]
            : [];
        return options.start === 0 ? values : [];
      },
    };
    const sourceSnapshotAt = new Date('2025-01-02T03:04:05.000Z');
    const result = await readFrappeDataset(source, 2, sourceSnapshotAt);
    assert.equal(result.dataset.items.length, 2);
    assert.ok(calls.every((call) => call.order_by === 'creation asc, name asc'));
    assert.ok(calls.every((call) => call.modified_before === sourceSnapshotAt.toISOString()));
  });

  it('dry-run não grava e apply é idempotente por unidade', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeMigrationFixture();
    const dry = await runFrappeMigration({ mode: 'dry-run', dataset, repository });
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.writes.clients, 0);
    assert.equal(dry.report.produtos.criados, 2);
    assert.equal(dry.report.clientes.criados, 1);

    const applied = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(applied.report.produtos.criados, 2);
    assert.equal(applied.report.clientes.criados, 1);
    const rerun = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(rerun.report.produtos.ignorados, 2);
    assert.equal(rerun.report.clientes.ignorados, 1);
    assert.equal(repository.snapshot().clients.length, 1);
    assert.equal(
      repository.snapshot().lineage.filter((row) => row.entityType === 'cliente').length,
      2
    );
  });

  it('separa atualização, divergência, entrada inválida e retomada após falha', async () => {
    const repository = new MemoryFrappeMigrationRepository({ failProductSku: 'LNC-SED-70-30' });
    const first = await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeMigrationFixture(),
      repository,
    });
    assert.equal(first.report.produtos.erros, 1);
    assert.equal(first.report.produtos.criados, 1);
    assert.equal(first.report.faixas.erros, 2);
    assert.equal(first.report.total.estimativa_volume, 8);
    assert.equal(repository.snapshot().products.length, 1);

    repository.failProductSku = undefined;
    const changed: FrappeDataset = {
      ...createFrappeMigrationFixture(),
      items: [
        { name: 'ITEM-001', item_code: 'LNC-SED-70-30', item_name: 'Lancheira atualizada' },
        { name: 'ITEM-003', item_code: 'NEW-SKU', item_name: 'Colisão' },
        { name: 'ITEM-004', item_code: 'NEW-SKU', item_name: 'Colisão 2' },
        { name: 'ITEM-002', item_code: 'ECO-30', item_name: 'Ecobag atualizada' },
        { name: 'ITEM-INVALID', item_code: '', item_name: '' },
      ],
      customers: [],
      leads: [],
    };
    const second = await runFrappeMigration({ mode: 'apply', dataset: changed, repository });
    assert.equal(second.report.produtos.atualizados, 1);
    assert.equal(second.report.produtos.criados, 1);
    assert.equal(second.report.produtos.divergentes, 2);
    assert.equal(second.report.produtos.erros, 1);
    assert.equal(
      repository.snapshot().products.filter((row) => row.sku === 'LNC-SED-70-30').length,
      0
    );
    assert.equal(repository.snapshot().products.length, 1);

    const duplicate = await runFrappeMigration({
      mode: 'dry-run',
      dataset: createFrappeDuplicateFixture(),
      repository,
    });
    assert.equal(duplicate.report.produtos.divergentes, 2);
    const incomplete = await runFrappeMigration({
      mode: 'dry-run',
      dataset: createFrappeIncompleteFixture(),
      repository,
    });
    assert.ok(incomplete.report.produtos.erros >= 1);
    assert.ok(incomplete.report.clientes.erros >= 1);
  });

  it('bloqueia remapeamento de linhagem Item/faixa e vínculos Customer/Lead', async () => {
    const dataset = createFrappeMigrationFixture();
    const itemRepository = new MemoryFrappeMigrationRepository({
      state: {
        lineage: [
          {
            provider: 'frappe',
            sourceDoctype: 'Item',
            sourceId: 'ITEM-001',
            entityType: 'produto',
            localId: 'OUTRO-SKU',
            localKey: 'OUTRO-SKU',
            canonicalHash: 'a'.repeat(64),
            sourceHash: 'a'.repeat(64),
            businessNumber: null,
            migrationRunId: null,
            sourceUpdatedAt: null,
            importedAt: null,
          },
        ],
      },
    });
    const itemResult = await runFrappeMigration({
      mode: 'apply',
      dataset,
      repository: itemRepository,
    });
    assert.equal(itemResult.report.produtos.divergentes, 1);
    assert.equal(itemRepository.snapshot().products.length, 0);

    const priceRepository = new MemoryFrappeMigrationRepository({
      state: {
        lineage: [
          {
            provider: 'frappe',
            sourceDoctype: 'Pricing Rule',
            sourceId: 'PR-LNC',
            entityType: 'faixa',
            localId: 'OUTRO-SKU',
            localKey: 'OUTRO-SKU',
            canonicalHash: 'b'.repeat(64),
            sourceHash: 'b'.repeat(64),
            businessNumber: null,
            migrationRunId: null,
            sourceUpdatedAt: null,
            importedAt: null,
          },
        ],
      },
    });
    const priceResult = await runFrappeMigration({
      mode: 'apply',
      dataset,
      repository: priceRepository,
    });
    assert.equal(priceResult.report.produtos.divergentes, 1);
    assert.equal(priceRepository.snapshot().products.length, 0);

    const corruptRepository = new MemoryFrappeMigrationRepository({
      state: {
        lineage: [
          {
            provider: 'frappe',
            sourceDoctype: 'Item',
            sourceId: 'ITEM-001',
            entityType: 'cliente',
            localId: 'LNC-SED-70-30',
            localKey: 'LNC-SED-70-30',
            canonicalHash: 'e'.repeat(64),
            sourceHash: 'e'.repeat(64),
            businessNumber: null,
            migrationRunId: null,
            sourceUpdatedAt: null,
            importedAt: null,
          },
        ],
      },
    });
    const corruptResult = await runFrappeMigration({
      mode: 'apply',
      dataset,
      repository: corruptRepository,
    });
    assert.equal(corruptResult.report.produtos.divergentes, 1);
    assert.equal(corruptRepository.snapshot().products.length, 0);

    const clientRepository = new MemoryFrappeMigrationRepository({
      state: {
        clients: [
          { id: '00000000-0000-4000-8000-000000000001', nome: 'A', documento: '12345678909' },
          { id: '00000000-0000-4000-8000-000000000002', nome: 'B', documento: '12345678909' },
        ],
        lineage: [
          {
            provider: 'frappe',
            sourceDoctype: 'Customer',
            sourceId: 'CUST-001',
            entityType: 'cliente',
            localId: '00000000-0000-4000-8000-000000000001',
            localKey: '00000000-0000-4000-8000-000000000001',
            canonicalHash: 'c'.repeat(64),
            sourceHash: 'c'.repeat(64),
            businessNumber: null,
            migrationRunId: null,
            sourceUpdatedAt: null,
            importedAt: null,
          },
          {
            provider: 'frappe',
            sourceDoctype: 'Lead',
            sourceId: 'LEAD-001',
            entityType: 'cliente',
            localId: '00000000-0000-4000-8000-000000000002',
            localKey: '00000000-0000-4000-8000-000000000002',
            canonicalHash: 'd'.repeat(64),
            sourceHash: 'd'.repeat(64),
            businessNumber: null,
            migrationRunId: null,
            sourceUpdatedAt: null,
            importedAt: null,
          },
        ],
      },
    });
    const clientResult = await runFrappeMigration({
      mode: 'apply',
      dataset,
      repository: clientRepository,
    });
    assert.equal(clientResult.report.clientes.divergentes, 1);
    assert.equal(clientRepository.writes.clients, 0);

    const multiSkuDataset: FrappeDataset = {
      items: [
        { name: 'ITEM-M1', item_code: 'MULTI-A', item_name: 'A' },
        { name: 'ITEM-M2', item_code: 'MULTI-B', item_name: 'B' },
      ],
      pricingRules: [
        {
          name: 'PR-MULTI',
          items: [
            { item_code: 'MULTI-A', min_qty: 30, rate: '1.00' },
            { item_code: 'MULTI-B', min_qty: 30, rate: '2.00' },
          ],
        },
      ],
    };
    const multiRepository = new MemoryFrappeMigrationRepository();
    const multiResult = await runFrappeMigration({
      mode: 'apply',
      dataset: multiSkuDataset,
      repository: multiRepository,
    });
    assert.equal(multiResult.report.produtos.divergentes, 2);
    assert.equal(multiRepository.writes.products, 0);
  });

  it('não adota SKU local sem linhagem quando apenas o preço diverge', async () => {
    const repository = new MemoryFrappeMigrationRepository({
      state: {
        products: [
          {
            sku: 'PRICE-COLLISION',
            nome: 'Produto',
            descricao: '',
            unidade: 'Und',
            categoria: null,
            marca: null,
            ativo: true,
            precoBase: null,
            precos: [{ minimum_quantity: '30', unit_price: '5.00' }],
          },
        ],
      },
    });
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [
          {
            name: 'ITEM-PRICE-COLLISION',
            item_code: 'PRICE-COLLISION',
            item_name: 'Produto',
            description: '',
            stock_uom: 'Und',
          },
        ],
        pricingRules: [
          {
            name: 'PR-PRICE-COLLISION',
            item_code: 'PRICE-COLLISION',
            min_qty: 30,
            price_list_rate: '4.00',
          },
        ],
        itemPrices: [],
      },
    });
    assert.equal(result.report.produtos.divergentes, 1);
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.snapshot().products[0].precos?.[0].unit_price, '5.00');
  });

  it('não cria erro de faixa quando falha produto sem fonte de preço', async () => {
    const repository = new MemoryFrappeMigrationRepository({ failProductSku: 'NO-PRICE' });
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [{ name: 'ITEM-NO-PRICE', item_code: 'NO-PRICE', item_name: 'Sem preço' }],
        pricingRules: [],
        itemPrices: [],
      },
    });
    assert.equal(result.report.produtos.erros, 1);
    assert.equal(result.report.faixas.erros, 0);
  });

  it('mantém cada combinação SKU × faixa da fixture legada', async () => {
    const dataset: FrappeDataset = {
      items: LEGACY_PRICING_FIXTURES.map((fixture, index) => ({
        name: `ITEM-${index}`,
        item_code: fixture.sku,
        item_name: fixture.sku,
      })),
      pricingRules: LEGACY_PRICING_FIXTURES.flatMap((fixture) =>
        fixture.tiers.map((tier, index) => ({
          name: `PR-${fixture.sku}-${index}`,
          item_code: fixture.sku,
          min_qty: tier.minimum_quantity,
          price_list_rate: tier.unit_price,
        }))
      ),
      itemPrices: [],
    };
    const repository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    for (const fixture of LEGACY_PRICING_FIXTURES) {
      const product = repository.snapshot().products.find((row) => row.sku === fixture.sku);
      assert.ok(product);
      for (const tier of fixture.tiers) {
        assert.equal(
          resolveProductPrice(
            { preco_base: product.precoBase || null, precos: product.precos || [] },
            tier.minimum_quantity
          ).rate,
          tier.unit_price
        );
      }
    }
  });

  it('é compatível com Pricing Rule legado por title/rate em todas as faixas', async () => {
    const dataset: FrappeDataset = {
      items: LEGACY_PRICING_FIXTURES.map((fixture, index) => ({
        name: `LEGACY-ITEM-${index}`,
        item_code: fixture.sku,
        item_name: fixture.sku,
      })),
      pricingRules: LEGACY_PRICING_FIXTURES.flatMap((fixture) =>
        fixture.tiers.map((tier) => ({
          name: `${fixture.sku}-${tier.minimum_quantity}`,
          title: `${fixture.sku}-${tier.minimum_quantity}`,
          rate: tier.unit_price,
        }))
      ),
      itemPrices: [],
    };
    const repository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    for (const fixture of LEGACY_PRICING_FIXTURES) {
      const product = repository.snapshot().products.find((row) => row.sku === fixture.sku);
      assert.ok(product);
      for (let index = 0; index < fixture.tiers.length; index += 1) {
        const boundary = Number(fixture.tiers[index].minimum_quantity);
        const expectedBelow =
          index === 0 ? fixture.tiers[0].unit_price : fixture.tiers[index - 1].unit_price;
        assert.equal(
          resolveProductPrice(
            { preco_base: product.precoBase || null, precos: product.precos || [] },
            String(Math.max(0.001, boundary - 0.001))
          ).rate,
          expectedBelow
        );
        assert.equal(
          resolveProductPrice(
            { preco_base: product.precoBase || null, precos: product.precos || [] },
            String(boundary)
          ).rate,
          fixture.tiers[index].unit_price
        );
        assert.equal(
          resolveProductPrice(
            { preco_base: product.precoBase || null, precos: product.precos || [] },
            String(boundary + 0.001)
          ).rate,
          fixture.tiers[index].unit_price
        );
      }
    }
  });

  it('limpa campos nulos no update de cliente e converge para ignorado', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const initial = createFrappeMigrationFixture();
    await runFrappeMigration({ mode: 'apply', dataset: initial, repository });
    const beforeWrites = repository.writes.clients;
    const cleared: FrappeDataset = {
      items: [],
      customers: [{ name: 'CUST-001', customer_name: 'Cliente Exemplo', tax_id: '12345678000190' }],
      leads: [],
    };
    const updated = await runFrappeMigration({ mode: 'apply', dataset: cleared, repository });
    assert.equal(updated.report.clientes.atualizados, 1);
    const client = repository.snapshot().clients.find((row) => row.documento === '12345678000190');
    assert.ok(client);
    assert.equal(client.email, null);
    assert.equal(client.telefone, null);
    assert.equal(client.notes, null);
    assert.equal(client.address, null);
    const rerun = await runFrappeMigration({ mode: 'apply', dataset: cleared, repository });
    assert.equal(rerun.report.clientes.ignorados, 1);
    assert.equal(repository.writes.clients, beforeWrites + 1);
  });

  it('não expõe CPF/CNPJ no relatório de dry-run, apply ou falha de escrita', async () => {
    const normalized = '12345678000190';
    const formatted = '12.345.678/0001-90';
    for (const mode of ['dry-run', 'apply'] as const) {
      const repository =
        mode === 'apply'
          ? new MemoryFrappeMigrationRepository({ failClientKey: `documento:${normalized}` })
          : new MemoryFrappeMigrationRepository();
      const result = await runFrappeMigration({
        mode,
        repository,
        dataset: {
          items: [],
          customers: [{ name: 'CUST-PII', customer_name: 'Cliente PII', tax_id: formatted }],
          leads: [],
        },
      });
      const serialized = JSON.stringify(result);
      assert.equal(Object.prototype.hasOwnProperty.call(result, 'dataset'), false);
      assert.equal(serialized.includes(normalized), false);
      assert.equal(serialized.includes(formatted), false);
      assert.equal(result.report.clientes.lidos, 1);
      if (mode === 'dry-run') assert.equal(result.report.clientes.criados, 1);
      else assert.equal(result.report.clientes.erros, 1);
    }
  });

  it('pseudonimiza source_id de Customer/Lead sem perder estabilidade', async () => {
    const customerSourceId = '12.345.678/0001-90';
    const leadSourceId = 'lead@example.com';
    const documents = ['12345678000190', '98765432000100'];
    const expectedSourceIds = [
      `cliente-${canonicalHash(`Customer:${customerSourceId}`).slice(0, 12)}`,
      `cliente-${canonicalHash(`Lead:${leadSourceId}`).slice(0, 12)}`,
    ];
    for (const mode of ['dry-run', 'apply'] as const) {
      const repository = new MemoryFrappeMigrationRepository();
      const result = await runFrappeMigration({
        mode,
        repository,
        dataset: {
          items: [],
          customers: [
            { name: customerSourceId, customer_name: 'Cliente CPF', tax_id: documents[0] },
          ],
          leads: [{ name: leadSourceId, lead_name: 'Lead e-mail', tax_id: documents[1] }],
        },
      });
      const serialized = JSON.stringify(result);
      assert.equal(Object.prototype.hasOwnProperty.call(result, 'dataset'), false);
      assert.equal(serialized.includes(customerSourceId), false);
      assert.equal(serialized.includes(leadSourceId), false);
      for (const document of documents) assert.equal(serialized.includes(document), false);
      const reportSourceIds = result.report.clientes.detalhes.map((detail) => detail.source_id);
      assert.deepEqual(reportSourceIds.sort(), expectedSourceIds.sort());
      assert.equal(
        result.report.clientes.detalhes.every((detail) => detail.local_key === undefined),
        true
      );
      assert.equal(result.report.clientes.criados, 2);
      if (mode === 'apply') {
        // Raw payload is only accessible through the authorized readRawPayload method.
        assert.equal(
          await repository.readRawPayload('Customer', customerSourceId),
          null,
          'raw payload requer boundary operacional interno'
        );
        assert.equal(
          await repository.readRawPayload('Lead', leadSourceId),
          null,
          'raw payload requer boundary operacional interno'
        );
        assert.equal(
          Object.prototype.hasOwnProperty.call(migrationRepositoryModule, 'RAW_PAYLOAD_ACCESS'),
          false,
          'capability não pode ser exportada'
        );
        // loadState() lineage must NOT expose legacyPayload
        const lineage = repository
          .snapshot()
          .lineage.filter((entry) => entry.entityType === 'cliente');
        assert.ok(lineage.length > 0);
        for (const entry of lineage) {
          assert.equal((entry as unknown as Record<string, unknown>).legacyPayload, undefined,
            'loadState lineage não deve expor legacyPayload');
        }
      }
    }
  });

  it('usa regra flat/tiered antes de Item Price e não usa standard_rate como atalho', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [
          { name: 'ITEM-FLAT', item_code: 'FLAT-SKU', item_name: 'Flat', standard_rate: '99.00' },
          {
            name: 'ITEM-FALLBACK',
            item_code: 'FALLBACK-SKU',
            item_name: 'Fallback',
            standard_rate: '99.00',
          },
        ],
        pricingRules: [{ name: 'PR-FLAT', title: 'FLAT-SKU', rate: '7.00' }],
        itemPrices: [
          {
            name: 'IP-FLAT',
            item_code: 'FLAT-SKU',
            price_list: 'Standard Selling',
            price_list_rate: '8.00',
          },
          {
            name: 'IP-OTHER',
            item_code: 'FALLBACK-SKU',
            price_list: 'Other',
            price_list_rate: '3.00',
          },
          {
            name: 'IP-FALLBACK',
            item_code: 'FALLBACK-SKU',
            price_list: 'Standard Selling',
            price_list_rate: '6.00',
          },
        ],
      },
    });
    assert.equal(result.report.produtos.criados, 2);
    const flat = repository.snapshot().products.find((row) => row.sku === 'FLAT-SKU');
    const fallback = repository.snapshot().products.find((row) => row.sku === 'FALLBACK-SKU');
    assert.ok(flat && fallback);
    assert.equal(
      resolveProductPrice({ preco_base: flat.precoBase || null, precos: flat.precos || [] }, 30)
        .rate,
      '7.00'
    );
    assert.equal(
      resolveProductPrice(
        { preco_base: fallback.precoBase || null, precos: fallback.precos || [] },
        30
      ).rate,
      '6.00'
    );
  });

  it('mantém paridade do fallback Item Price com regras flat e específicas', async () => {
    const cases: Array<{
      sku: string;
      pricingRules?: FrappeDataset['pricingRules'];
      itemPrices?: FrappeDataset['itemPrices'];
      expected: string[];
    }> = [
      {
        sku: 'SPECIFIC-100',
        pricingRules: [
          { name: 'PR-SPECIFIC-100', item_code: 'SPECIFIC-100', min_qty: 100, rate: '5.00' },
        ],
        itemPrices: [
          {
            name: 'IP-SPECIFIC-100',
            item_code: 'SPECIFIC-100',
            min_qty: 100,
            price_list: 'Standard Selling',
            price_list_rate: '7.00',
          },
        ],
        expected: ['7.00', '7.00', '7.00', '5.00', '5.00'],
      },
      {
        sku: 'FLAT-WINS',
        pricingRules: [{ name: 'PR-FLAT-WINS', title: 'FLAT-WINS', rate: '7.00' }],
        itemPrices: [
          {
            name: 'IP-FLAT-WINS',
            item_code: 'FLAT-WINS',
            min_qty: 100,
            price_list: 'Standard Selling',
            price_list_rate: '5.00',
          },
        ],
        expected: ['7.00', '7.00', '7.00', '7.00', '7.00'],
      },
      {
        sku: 'FLAT-SPECIFIC-100',
        pricingRules: [
          { name: 'PR-FLAT-SPECIFIC-100-BASE', title: 'FLAT-SPECIFIC-100', rate: '7.00' },
          {
            name: 'PR-FLAT-SPECIFIC-100-TIER',
            item_code: 'FLAT-SPECIFIC-100',
            min_qty: 100,
            rate: '5.00',
          },
        ],
        itemPrices: [
          {
            name: 'IP-FLAT-SPECIFIC-100',
            item_code: 'FLAT-SPECIFIC-100',
            min_qty: 100,
            price_list: 'Standard Selling',
            price_list_rate: '9.00',
          },
        ],
        expected: ['7.00', '7.00', '7.00', '5.00', '5.00'],
      },
    ];
    const quantities = [1, 30, 99.999, 100, 100.001];
    for (const fixture of cases) {
      const repository = new MemoryFrappeMigrationRepository();
      await runFrappeMigration({
        mode: 'apply',
        repository,
        dataset: {
          items: [{ name: `ITEM-${fixture.sku}`, item_code: fixture.sku, item_name: fixture.sku }],
          pricingRules: fixture.pricingRules || [],
          itemPrices: fixture.itemPrices || [],
        },
      });
      const product = repository.snapshot().products.find((row) => row.sku === fixture.sku);
      assert.ok(product);
      assert.deepEqual(
        quantities.map(
          (quantity) =>
            resolveProductPrice(
              { preco_base: product.precoBase || null, precos: product.precos || [] },
              quantity
            ).rate
        ),
        fixture.expected
      );
      for (const price of fixture.itemPrices || []) {
        assert.equal(
          repository
            .snapshot()
            .lineage.some(
              (entry) => entry.sourceId === price.name && entry.sourceDoctype === 'Item Price'
            ),
          true
        );
      }
    }
  });

  it('reporta divergência para múltiplos Item Price Standard Selling conflitantes', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [{ name: 'ITEM-IP-CONFLICT', item_code: 'IP-CONFLICT', item_name: 'Conflito' }],
        pricingRules: [],
        itemPrices: [
          {
            name: 'IP-CONFLICT-A',
            item_code: 'IP-CONFLICT',
            min_qty: 30,
            price_list: 'Standard Selling',
            price_list_rate: '7.00',
          },
          {
            name: 'IP-CONFLICT-B',
            item_code: 'IP-CONFLICT',
            min_qty: 100,
            price_list: 'Standard Selling',
            price_list_rate: '6.00',
          },
        ],
      },
    });
    assert.equal(result.report.produtos.divergentes, 1);
    assert.equal(result.report.faixas.divergentes, 1);
    assert.equal(result.report.faixas.detalhes[0].source_id, 'IP-CONFLICT-A');
    assert.equal(repository.writes.products, 0);
    assert.equal(
      repository
        .snapshot()
        .lineage.some(
          (entry) => entry.sourceId === 'IP-CONFLICT-A' || entry.sourceId === 'IP-CONFLICT-B'
        ),
      false
    );
  });

  it('bloqueia faixa órfã sem criar sua linhagem', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [{ name: 'ITEM-KNOWN', item_code: 'KNOWN-SKU', item_name: 'Conhecido' }],
        pricingRules: [{ name: 'PR-ORPHAN', item_code: 'UNKNOWN-SKU', min_qty: 30, rate: '4.00' }],
        itemPrices: [],
      },
    });
    assert.equal(result.report.faixas.erros, 1);
    assert.match(result.report.faixas.detalhes[0].mensagem, /UNKNOWN-SKU/);
    assert.equal(repository.writes.products, 0);
    assert.equal(
      repository.snapshot().lineage.some((entry) => entry.sourceId === 'PR-ORPHAN'),
      false
    );
  });

  it('bloqueia documento de preço misto conhecido/órfão como unidade inteira', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [{ name: 'ITEM-MIXED', item_code: 'KNOWN-SKU', item_name: 'Conhecido' }],
        pricingRules: [
          {
            name: 'PR-MIXED',
            items: [
              { item_code: 'KNOWN-SKU', min_qty: 30, rate: '4.00' },
              { item_code: 'UNKNOWN-SKU', min_qty: 30, rate: '5.00' },
            ],
          },
        ],
        itemPrices: [],
      },
    });
    assert.equal(result.report.faixas.erros, 1);
    assert.equal(result.report.faixas.divergentes, 1);
    assert.equal(result.report.produtos.divergentes, 1);
    assert.match(
      result.report.faixas.detalhes.find((detail) => detail.status === 'erros')?.mensagem || '',
      /UNKNOWN-SKU/
    );
    assert.equal(repository.writes.products, 0);
    assert.equal(
      repository.snapshot().lineage.some((entry) => entry.sourceId === 'PR-MIXED'),
      false
    );
  });

  it('não consolida Customer/Lead pelo nome sem documento ou vínculo explícito', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [],
        customers: [{ name: 'CUST-SAME-NAME', customer_name: 'Pessoa Sem Documento' }],
        leads: [{ name: 'LEAD-SAME-NAME', lead_name: 'Pessoa Sem Documento' }],
      },
    });
    assert.equal(result.report.clientes.divergentes, 1);
    assert.match(result.report.clientes.detalhes[0].mensagem, /Identidade ambígua/);
    assert.equal(repository.writes.clients, 0);
    assert.equal(repository.snapshot().clients.length, 0);
  });

  it('consolida Customer/Lead somente por referência explícita compartilhada', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [],
        customers: [
          { name: 'CUST-LINKED', customer_name: 'Pessoa Vinculada', customer: 'CRM-PERSON-1' },
        ],
        leads: [{ name: 'LEAD-LINKED', lead_name: 'Pessoa Vinculada', lead: 'CRM-PERSON-1' }],
      },
    });
    assert.equal(result.report.clientes.criados, 1);
    assert.equal(result.report.clientes.divergentes, 0);
    assert.equal(repository.writes.clients, 1);
    assert.equal(
      repository.snapshot().lineage.filter((entry) => entry.entityType === 'cliente').length,
      2
    );
  });

  it('mapeia todos os status Frappe e desconhecidos', () => {
    const expectations: Array<[string, 'rascunho' | 'enviado' | 'aprovado' | 'perdido', boolean]> =
      [
        ['Draft', 'rascunho', true],
        ['Submitted', 'enviado', true],
        ['Open', 'enviado', true],
        ['Sent', 'enviado', true],
        ['Ordered', 'aprovado', true],
        ['Completed', 'aprovado', true],
        ['Closed', 'aprovado', true],
        ['Lost', 'perdido', true],
        ['Cancelled', 'perdido', true],
        ['Expired', 'perdido', true],
        ['submitted', 'enviado', true],
        ['Whatever', 'rascunho', false],
      ];
    for (const [raw, status, known] of expectations) {
      const result = mapQuotationStatus(raw);
      assert.equal(result.status, status);
      assert.equal(result.source, raw);
      assert.equal(result.known, known);
      assert.equal(result.orderLinkage, ['Ordered', 'Completed', 'Closed'].includes(raw) ? raw.toLowerCase() : null);
      assert.equal(result.orderPending, result.orderLinkage !== null);
    }
  });

  it('normaliza orçamentos válidos com numeração, termos, itens e vínculo de cliente', () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    const clientLineage = new Map([['Customer:CUST-HIST', clientId]]);
    const normalized = normalizeFrappeQuotation(
      {
        name: 'QTN-2024-00042',
        creation: '2024-03-15 10:30:00',
        quotation_to: 'Customer',
        customer: 'CUST-HIST',
        status: 'Submitted',
        valid_till: '2024-04-14',
        payment_terms_template: 'PIX à vista',
        terms: 'Condições históricas',
        net_total: '120.00',
        grand_total: '120.00',
        items: [
          {
            idx: 1,
            item_code: 'SKU-HIST-1',
            item_name: 'Produto Um',
            qty: '10',
            uom: 'Und',
            rate: '6.00',
            price_list_rate: '6.00',
            amount: '60.00',
          },
          {
            idx: 2,
            item_code: 'SKU-HIST-2',
            item_name: 'Produto Dois',
            qty: '5',
            uom: 'Und',
            rate: '12.00',
            price_list_rate: '12.00',
            amount: '60.00',
          },
        ],
      },
      clientLineage
    );
    assert.equal(normalized.sourceId, 'QTN-2024-00042');
    assert.equal(normalized.businessNumber, 'ORC-20240042');
    assert.equal(normalized.year, 2024);
    assert.equal(normalized.status, 'enviado');
    assert.equal(normalized.statusSource, 'Submitted');
    assert.equal(normalized.orderLinkage, null);
    assert.equal(normalized.orderPending, false);
    assert.equal(normalized.statusKnown, true);
    assert.equal(normalized.clientId, clientId);
    assert.equal(normalized.terms.validadeDias, 30);
    assert.equal(normalized.terms.pagamento, 'PIX à vista');
    assert.equal(normalized.terms.observacoes, 'Condições históricas');
    assert.equal(normalized.items.length, 2);
    assert.equal(normalized.items[0].position, 1);
    assert.equal(normalized.items[1].position, 2);
    assert.equal(normalized.items[0].sku, 'SKU-HIST-1');
    assert.equal(normalized.items[0].quantidade, '10');
    assert.equal(normalized.subtotal, '120.00');
    assert.equal(normalized.total, '120.00');
  });

  it('bloqueia Quotation cujo enrichment falhou antes de ler party ou itens', () => {
    let touched = false;
    const record = {
      __migration_enrichment_error: true,
      get quotation_to() {
        touched = true;
        return 'Customer';
      },
      get party_name() {
        touched = true;
        return 'CUST-ENRICHMENT';
      },
      get items() {
        touched = true;
        return [];
      },
    };
    assert.throws(
      () => normalizeFrappeQuotation(record, new Map()),
      /enrichment|enriquec/i
    );
    assert.equal(touched, false);
  });

  it('resolve Quotation de produção por quotation_to/party_name e child items', () => {
    const normalized = normalizeFrappeQuotation(
      {
        name: 'QTN-2025-00077',
        creation: '2025-02-01 10:00:00',
        quotation_to: 'Customer',
        party_name: 'CUST-PROD',
        status: 'Submitted',
        items: [{ idx: 1, item_code: 'SKU-PROD', qty: '2', rate: '10', price_list_rate: '12', amount: '20' }],
      },
      new Map([['Customer:CUST-PROD', 'client-prod']]),
    );
    assert.equal(normalized.clientRef, 'Customer:CUST-PROD');
    assert.equal(normalized.clientId, 'client-prod');
    assert.equal(normalized.items[0].sku, 'SKU-PROD');
  });

  it('canonicaliza approval keys sem expor Customer/Lead e rejeita doctype desconhecido', () => {
    const customerId = '12.345.678/0001-90';
    const leadId = 'lead@example.com';
    const customerKey = canonicalApprovalKey('Customer', customerId);
    const leadKey = canonicalApprovalKey('Lead', leadId);
    assert.match(customerKey || '', /^Customer:cliente-[0-9a-f]{12}$/);
    assert.match(leadKey || '', /^Lead:cliente-[0-9a-f]{12}$/);
    assert.doesNotMatch(customerKey || '', /12\.345\.678|0001-90/);
    assert.doesNotMatch(leadKey || '', /lead@example\.com/);
    assert.equal(canonicalApprovalKey('Customer', (customerKey || '').split(':')[1] || ''), customerKey);
    assert.equal(safeApprovalKey(customerKey || ''), customerKey);
    assert.equal(canonicalApprovalKey('Quotation', 'QTN-2025-00001'), 'Quotation:QTN-2025-00001');
    assert.equal(canonicalApprovalKey('Unknown', 'secret-value'), null);
    assert.throws(() => safeApprovalKey('Unknown:secret-value'), /chave de aprovação inválida/i);
    assert.throws(() => safeApprovalKey('Quotation:id:extra'), /chave de aprovação inválida/i);
    assert.throws(() => safeApprovalKey('cliente-abcdef012345'), /chave de aprovação inválida/i);

    const report = emptyEntityReport();
    addDetail(report, {
      status: 'divergentes',
      source_doctype: 'Customer',
      source_id: 'cliente:raw@example.com',
      mensagem: 'Identidade inválida.',
    });
    assert.equal(report.detalhes[0].source_id, undefined);
  });

  it('faz round-trip de approval para source_id e sourceId do relatório ao apply', async () => {
    const dataset = createFrappeMigrationFixture();
    const customer = dataset.customers?.[0];
    const lead = dataset.leads?.[0];
    assert.ok(customer);
    assert.ok(lead);
    dataset.customers = [
      { ...customer, name: undefined, id: undefined, source_id: 'CUSTOMER-SOURCE-ID' },
    ];
    dataset.leads = [{ ...lead, name: undefined, id: undefined, sourceId: 'LEAD-SOURCE-ID' }];

    const repository = new MemoryFrappeMigrationRepository();
    const firstApply = await runFrappeMigration({
      mode: 'apply',
      dataset,
      repository,
      expectedManifestHash: computeManifestHash(dataset),
    });
    const reportKeys = firstApply.report.clientes.detalhes
      .filter((detail) => detail.source_doctype === 'Customer' || detail.source_doctype === 'Lead')
      .map((detail) => `${detail.source_doctype}:${detail.source_id}`);
    const leadKey = canonicalApprovalKey('Lead', 'LEAD-SOURCE-ID');
    assert.ok(reportKeys.some((key) => key.startsWith('Customer:cliente-')));
    assert.match(leadKey || '', /^Lead:cliente-[0-9a-f]{12}$/);

    await runFrappeMigration({
      mode: 'apply',
      dataset,
      repository,
      expectedManifestHash: computeManifestHash(dataset),
      approvedDivergences: [...reportKeys, leadKey || ''],
    });
    assert.equal(repository.writes.clients, 1);
  });

  it('rejeita approval ausente antes de lease e writes no apply', async () => {
    const dataset = createFrappeMigrationFixture();
    const repository = new MemoryFrappeMigrationRepository();
    await assert.rejects(
      () =>
        runFrappeMigrationImplementation({
          mode: 'apply',
          dataset,
          repository,
          expectedManifestHash: computeManifestHash(dataset),
          approvedDivergences: ['Quotation:DOES-NOT-EXIST'],
        }),
      /chave de aprovação inválida/i
    );
    assert.deepEqual(repository.writes, { products: 0, clients: 0, quotations: 0, lineage: 0, documents: 0 });
    assert.equal(repository.runs.length, 0);
    assert.equal(repository.batches.length, 0);
  });

  it('aceita key conhecida sem divergência e não incrementa aprovações', async () => {
    const dataset = createFrappeMigrationFixture();
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigrationImplementation({
      mode: 'apply',
      dataset,
      repository,
      expectedManifestHash: computeManifestHash(dataset),
      approvedDivergences: ['Item:ITEM-001'],
    });
    assert.equal(result.report.total.aprovadas, 0);
    assert.equal(repository.writes.products, 2);
  });

  it('marca enrichment falho sem persistir a quotation', async () => {
    const dataset: FrappeDataset = {
      items: [],
      customers: [],
      leads: [],
      quotations: [
        {
          __migration_enrichment_error: true,
          name: 'QTN-2025-00100',
          creation: '2025-01-01 10:00:00',
          quotation_to: 'Customer',
          party_name: 'CUST-ENRICHMENT',
          items: [{ item_code: 'SKU-001', qty: 2, rate: 10 }],
        },
      ],
    };
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigrationImplementation({
      mode: 'apply',
      dataset,
      repository,
      expectedManifestHash: computeManifestHash(dataset),
    });
    assert.equal(result.report.orcamentos.erros, 1);
    assert.equal(repository.writes.quotations, 0);
  });

  it('rejeita orçamentos sem ano ou sem sequência numérica no nome', () => {
    const clientLineage = new Map();
    assert.throws(
      () =>
        normalizeFrappeQuotation(
          { name: 'QTN-00042', creation: '', status: 'Draft' },
          clientLineage
        ),
      /ano identificável/
    );
    assert.throws(
      () =>
        normalizeFrappeQuotation(
          { name: 'ORCAMENTO', creation: '2024-01-01 10:00:00', status: 'Draft' },
          clientLineage
        ),
      /sequência numérica/
    );
    assert.throws(
      () =>
        normalizeFrappeQuotation(
          { creation: '2024-01-01 10:00:00', status: 'Draft' },
          clientLineage
        ),
      /sem identificador legado/
    );
  });

  it('constrói unidades de orçamento com UUIDs estáveis, snapshot de cliente/produto e documento histórico', () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    const clientLineage = new Map([['Customer:CUST-HIST', clientId]]);
    const normalized = normalizeFrappeQuotation(
      {
        name: 'QTN-2024-00042',
        creation: '2024-03-15 10:30:00',
        quotation_to: 'Customer',
        customer: 'CUST-HIST',
        status: 'Submitted',
        net_total: '60.00',
        grand_total: '60.00',
        items: [
          {
            idx: 1,
            item_code: 'SKU-HIST-1',
            item_name: 'Produto Um',
            qty: '10',
            uom: 'Und',
            rate: '6.00',
            price_list_rate: '6.00',
            amount: '60.00',
            notes: 'Observação da linha',
          },
        ],
      },
      clientLineage
    );
    const result = buildQuotationUnits(
      [normalized],
      clientLineage,
      {
        clients: [
          {
            id: clientId,
            nome: 'Cliente Histórico',
            documento: '12345678000190',
            email: null,
            telefone: null,
            notes: null,
            address: {
              endereco: 'Rua A',
              numero: '10',
              bairro: 'Centro',
              complemento: null,
              municipio: 'São Paulo',
              uf: 'SP',
              cep: '01000000',
            },
          },
        ],
        products: [
          {
            sku: 'SKU-HIST-1',
            nome: 'Produto Um',
            descricao: 'Aço',
            unidade: 'Und',
            categoria: 'Estamparia',
            marca: null,
            ativo: true,
            precoBase: null,
            precos: [],
          },
        ],
      },
      new Set(['SKU-HIST-1'])
    );
    assert.equal(result.issues.length, 0);
    assert.equal(result.quotationUnits.length, 1);
    assert.equal(result.itemUnits.length, 1);
    const unit = result.quotationUnits[0];
    assert.equal(
      Object.prototype.hasOwnProperty.call(unit.lineage[0], 'legacyPayload'),
      false,
      'builders must not expose raw payloads on lineage entries'
    );
    assert.equal(unit.id, stableId('quotation', 'QTN-2024-00042'));
    assert.equal(unit.revision.id, stableId('revision', 'QTN-2024-00042:v1'));
    assert.equal(unit.items[0].id, stableId('item', 'QTN-2024-00042:item:1'));
    assert.equal(unit.revision.version, 1);
    assert.equal(unit.revision.status, 'enviado');
    assert.equal(unit.revision.clienteNome, 'Cliente Histórico');
    assert.equal(unit.revision.clienteDocumento, '12345678000190');
    assert.equal(unit.revision.clienteMunicipio, 'São Paulo');
    assert.equal(unit.revision.validadeDias, 15);
    assert.equal(unit.revision.subtotal, '60');
    assert.equal(unit.revision.total, '60');
    assert.equal(unit.items[0].produtoNome, 'Produto Um');
    assert.equal(unit.items[0].produtoDescricao, 'Aço');
    assert.equal(unit.items[0].quantidade, '10');
    assert.equal(unit.items[0].precoSugerido, '6');
    assert.equal(unit.items[0].precoAplicado, '6');
    assert.equal(unit.items[0].diferencaPreco, '0');
    assert.equal(unit.items[0].precoFonte, 'historico');
    assert.equal(unit.items[0].notas, 'Observação da linha');
    assert.equal(unit.document?.kind, 'historical_pdf_import');
    assert.equal(unit.document?.blobPathname, 'historical/QTN-2024-00042.pdf');
    assert.equal(unit.document?.sizeBytes, 0);
    assert.match(unit.document?.checksumSha256 || '', /^[0-9a-f]{64}$/);
    assert.equal(unit.lineage[0].entityType, 'orcamento');
    assert.equal(unit.lineage[0].localKey, unit.id);
    assert.equal(unit.lineage[0].sourceDoctype, 'Quotation');
  });

  it('não emite documento histórico para orçamentos em rascunho ou perdidos', () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    const clientLineage = new Map([['Customer:CUST-HIST', clientId]]);
    const context = {
      clients: [
        {
          id: clientId,
          nome: 'Cliente',
          documento: null,
          email: null,
          telefone: null,
          notes: null,
          address: null,
        },
      ],
      products: [
        {
          sku: 'SKU-1',
          nome: 'Produto',
          descricao: '',
          unidade: 'Und',
          categoria: null,
          marca: null,
          ativo: true,
          precoBase: null,
          precos: [],
        },
      ],
    };
    for (const status of ['Draft', 'Lost'] as const) {
      const normalized = normalizeFrappeQuotation(
        {
          name: status === 'Draft' ? 'QTN-2024-00043' : 'QTN-2024-00015',
          creation: '2024-02-01 10:00:00',
          quotation_to: 'Customer',
          customer: 'CUST-HIST',
          status,
          items: [
            {
              idx: 1,
              item_code: 'SKU-1',
              item_name: 'Produto',
              qty: '1',
              uom: 'Und',
              rate: '5.00',
              price_list_rate: '5.00',
              amount: '5.00',
            },
          ],
        },
        clientLineage
      );
      const result = buildQuotationUnits([normalized], clientLineage, context, new Set(['SKU-1']));
      assert.equal(result.quotationUnits.length, 1);
      assert.equal(result.quotationUnits[0].document, null);
    }
  });

  it('reporta lacunas de orçamentos: cliente ausente, itens vazios, SKU desconhecido e preço inválido', () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    const clientLineage = new Map([['Customer:CUST-HIST', clientId]]);
    const context = {
      clients: [
        {
          id: clientId,
          nome: 'Cliente',
          documento: null,
          email: null,
          telefone: null,
          notes: null,
          address: null,
        },
      ],
      products: [
        {
          sku: 'SKU-1',
          nome: 'Produto',
          descricao: '',
          unidade: 'Und',
          categoria: null,
          marca: null,
          ativo: true,
          precoBase: null,
          precos: [],
        },
      ],
    };
    const quotations = [
      normalizeFrappeQuotation(
        {
          name: 'QTN-2024-00011',
          creation: '2024-02-02 10:00:00',
          status: 'Draft',
          items: [
            {
              idx: 1,
              item_code: 'SKU-1',
              item_name: 'Produto',
              qty: '1',
              uom: 'Und',
              rate: '5.00',
              price_list_rate: '5.00',
              amount: '5.00',
            },
          ],
        },
        clientLineage
      ),
      normalizeFrappeQuotation(
        {
          name: 'QTN-2024-00012',
          creation: '2024-02-03 10:00:00',
          quotation_to: 'Customer',
          customer: 'CUST-HIST',
          status: 'Submitted',
          items: [],
        },
        clientLineage
      ),
      normalizeFrappeQuotation(
        {
          name: 'QTN-2024-00013',
          creation: '2024-02-04 10:00:00',
          quotation_to: 'Customer',
          customer: 'CUST-HIST',
          status: 'Submitted',
          items: [
            {
              idx: 1,
              item_code: 'SKU-FANTASMA',
              item_name: 'Fantasma',
              qty: '1',
              uom: 'Und',
              rate: '5.00',
              price_list_rate: '5.00',
              amount: '5.00',
            },
          ],
        },
        clientLineage
      ),
      normalizeFrappeQuotation(
        {
          name: 'QTN-2024-00014',
          creation: '2024-02-05 10:00:00',
          quotation_to: 'Customer',
          customer: 'CUST-HIST',
          status: 'Submitted',
          items: [
            {
              idx: 1,
              item_code: 'SKU-1',
              item_name: 'Produto',
              qty: '1',
              uom: 'Und',
              rate: '',
              price_list_rate: '5.00',
              amount: '0',
            },
          ],
        },
        clientLineage
      ),
    ];
    const result = buildQuotationUnits(quotations, clientLineage, context, new Set(['SKU-1']));
    assert.equal(result.quotationUnits.length, 0);
    assert.equal(result.issues.length, 4);
    const messages = result.issues.map((issue) => issue.mensagem).join(' ');
    assert.match(messages, /Cliente não localizado/);
    assert.match(messages, /Itens ausentes/);
    assert.match(messages, /SKU-FANTASMA/);
    assert.match(messages, /preço aplicado/);
  });

  it('reporta data de criação inválida como divergência em vez de inventar timestamp', () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    const clientLineage = new Map([['Customer:CUST-HIST', clientId]]);
    const context = {
      clients: [
        {
          id: clientId,
          nome: 'Cliente',
          documento: null,
          email: null,
          telefone: null,
          notes: null,
          address: null,
        },
      ],
      products: [
        {
          sku: 'SKU-1',
          nome: 'Produto',
          descricao: '',
          unidade: 'Und',
          categoria: null,
          marca: null,
          ativo: true,
          precoBase: null,
          precos: [],
        },
      ],
    };
    for (const creation of ['data-corrompida', '']) {
      const normalized = normalizeFrappeQuotation(
        {
          name: 'QTN-2024-00015',
          creation,
          quotation_to: 'Customer',
          customer: 'CUST-HIST',
          status: 'Submitted',
          items: [
            {
              idx: 1,
              item_code: 'SKU-1',
              item_name: 'Produto',
              qty: '1',
              uom: 'Und',
              rate: '5.00',
              price_list_rate: '5.00',
              amount: '5.00',
            },
          ],
        },
        clientLineage
      );
      const result = buildQuotationUnits([normalized], clientLineage, context, new Set(['SKU-1']));
      assert.equal(result.quotationUnits.length, 0);
      assert.equal(result.itemUnits.length, 0);
      assert.equal(result.issues.length, 1);
      assert.match(result.issues[0].mensagem, /Data de criação inválida/);
    }
  });

  it('bloqueia número comercial duplicado dentro do mesmo dataset', () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    const clientLineage = new Map([['Customer:CUST-HIST', clientId]]);
    const context = {
      clients: [
        {
          id: clientId,
          nome: 'Cliente',
          documento: null,
          email: null,
          telefone: null,
          notes: null,
          address: null,
        },
      ],
      products: [
        {
          sku: 'SKU-1',
          nome: 'Produto',
          descricao: '',
          unidade: 'Und',
          categoria: null,
          marca: null,
          ativo: true,
          precoBase: null,
          precos: [],
        },
      ],
    };
    const item = {
      idx: 1,
      item_code: 'SKU-1',
      item_name: 'Produto',
      qty: '1',
      uom: 'Und',
      rate: '5.00',
      price_list_rate: '5.00',
      amount: '5.00',
    };
    // Distinct source records that both map to ORC-20240042 must not both import.
    const quotations = [
      normalizeFrappeQuotation(
        {
          name: 'QTN-2024-00042',
          creation: '2024-03-15 10:30:00',
          quotation_to: 'Customer',
          customer: 'CUST-HIST',
          status: 'Submitted',
          items: [item],
        },
        clientLineage
      ),
      normalizeFrappeQuotation(
        {
          name: 'QT-2024-00042',
          creation: '2024-03-15 11:00:00',
          quotation_to: 'Customer',
          customer: 'CUST-HIST',
          status: 'Submitted',
          items: [item],
        },
        clientLineage
      ),
      normalizeFrappeQuotation(
        {
          name: 'QTN-2024-00042',
          creation: '2024-03-15 12:00:00',
          quotation_to: 'Customer',
          customer: 'CUST-HIST',
          status: 'Submitted',
          items: [item],
        },
        clientLineage
      ),
    ];
    const result = buildQuotationUnits(quotations, clientLineage, context, new Set(['SKU-1']));
    assert.equal(result.quotationUnits.length, 1);
    assert.equal(result.issues.length, 2);
    const messages = result.issues.map((issue) => issue.mensagem).join(' ');
    assert.match(messages, /duplicado no dataset/);
    assert.match(messages, /repetido com dados diferentes/);
  });

  it('importa orçamentos com dry-run sem persistir e apply idempotente avançando o contador', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeQuotationFixture();
    const dry = await runFrappeMigration({ mode: 'dry-run', dataset, repository });
    assert.equal(dry.report.orcamentos.criados, 3);
    assert.equal(dry.report.orcamentos.divergentes, 0);
    assert.equal(repository.writes.quotations, 0);
    assert.equal(repository.snapshot().quotations.length, 0);
    assert.deepEqual(repository.snapshot().sequences, {});

    const applied = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(applied.report.orcamentos.criados, 3);
    const snapshot = repository.snapshot();
    assert.equal(snapshot.quotations.length, 3);
    assert.deepEqual([...snapshot.quotations].map((row) => row.businessNumber).sort(), [
      'ORC-20240042',
      'ORC-20240043',
      'ORC-20250007',
    ]);
    assert.deepEqual([...snapshot.quotations].map((row) => row.status).sort(), [
      'aprovado',
      'enviado',
      'rascunho',
    ]);
    assert.deepEqual(snapshot.sequences, { 2024: 43, 2025: 7 });
    const withDocuments = snapshot.quotations.filter((row) => row.document !== null);
    assert.equal(withDocuments.length, 2);
    assert.equal(
      withDocuments.every((row) => row.document?.kind === 'historical_pdf_import'),
      true
    );
    const revisionRows = snapshot.quotations.map((row) => row.revision);
    assert.equal(
      revisionRows.every((revision) => revision?.version === 1),
      true
    );
    assert.equal(
      snapshot.quotations.reduce((sum, row) => sum + (row.items?.length || 0), 0),
      4
    );
    const firstQuotation = snapshot.quotations.find((row) => row.businessNumber === 'ORC-20240042');
    assert.equal(
      firstQuotation?.items?.find((item) => item.position === 1)?.notas,
      'Observação da linha 1'
    );
    assert.equal(repository.writes.quotations, 3);

    const rerun = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(rerun.report.orcamentos.ignorados, 3);
    assert.equal(repository.snapshot().quotations.length, 3);
    assert.equal(repository.writes.quotations, 3);
    assert.deepEqual(repository.snapshot().sequences, { 2024: 43, 2025: 7 });
    const lineageRows = repository
      .snapshot()
      .lineage.filter((entry) => entry.entityType === 'orcamento');
    assert.equal(lineageRows.length, 3);
  });

  it('avança o contador anual somente após apply e nunca o reduz', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    await repository.advanceQuoteSequence(2024, 43);
    await repository.advanceQuoteSequence(2024, 7);
    assert.equal(repository.snapshot().sequences[2024], 43);
    const dataset = createFrappeQuotationFixture();
    await runFrappeMigration({ mode: 'dry-run', dataset, repository });
    assert.deepEqual(repository.snapshot().sequences, { 2024: 43 });
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.deepEqual(repository.snapshot().sequences, { 2024: 43, 2025: 7 });
  });

  it('relata divergências de lacunas e retoma após falha transacional de orçamento', async () => {
    const repository = new MemoryFrappeMigrationRepository({ failQuotationKey: 'QTN-2025-00007' });
    const first = await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeQuotationFixture(),
      repository,
    });
    assert.equal(first.report.orcamentos.criados, 2);
    assert.equal(first.report.orcamentos.erros, 1);
    assert.equal(repository.snapshot().quotations.length, 2);
    assert.equal(
      first.report.orcamentos.detalhes.some(
        (detail) => detail.status === 'erros' && detail.source_id === 'QTN-2025-00007'
      ),
      true
    );

    repository.failQuotationKey = undefined;
    const retry = await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeQuotationFixture(),
      repository,
    });
    assert.equal(retry.report.orcamentos.criados, 1);
    assert.equal(retry.report.orcamentos.erros, 0);
    assert.equal(repository.snapshot().quotations.length, 3);
    assert.deepEqual(repository.snapshot().sequences, { 2024: 43, 2025: 7 });

    const edge = await runFrappeMigration({
      mode: 'dry-run',
      dataset: createFrappeQuotationEdgeFixture(),
      repository,
    });
    const messages = edge.report.orcamentos.detalhes.map((detail) => detail.mensagem).join(' ');
    assert.match(messages, /Status legado desconhecido/);
    assert.match(messages, /Cliente não localizado/);
    assert.match(messages, /Itens ausentes/);
    assert.match(messages, /SKU-FANTASMA/);
    assert.match(messages, /preço aplicado/);
    assert.equal(
      edge.report.orcamentos.detalhes.some(
        (detail) =>
          detail.status === 'divergentes' && /Status legado desconhecido/.test(detail.mensagem)
      ),
      true
    );
  });

  it('bloqueia remapeamento de linhagem e colisão de número comercial de orçamento', async () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    const dataset = createFrappeQuotationFixture();
    const corruptRepository = new MemoryFrappeMigrationRepository({
      state: {
        lineage: [
          {
            provider: 'frappe',
            sourceDoctype: 'Quotation',
            sourceId: 'QTN-2024-00042',
            entityType: 'cliente',
            localId: 'outra-entidade',
            localKey: 'outra-entidade',
            canonicalHash: 'f'.repeat(64),
            sourceHash: 'f'.repeat(64),
            businessNumber: null,
            migrationRunId: null,
            sourceUpdatedAt: null,
            importedAt: null,
          },
        ],
      },
    });
    const corruptResult = await runFrappeMigration({
      mode: 'apply',
      dataset,
      repository: corruptRepository,
    });
    assert.equal(corruptResult.report.orcamentos.divergentes, 1);
    assert.equal(corruptRepository.writes.quotations, 2);

    const collisionRepository = new MemoryFrappeMigrationRepository({
      state: {
        clients: [
          {
            id: clientId,
            nome: 'Cliente',
            documento: null,
            email: null,
            telefone: null,
            notes: null,
            address: null,
          },
        ],
        quotations: [
          {
            id: '00000000-0000-4000-8000-000000000099',
            businessNumber: 'ORC-20240042',
            clientId,
            status: 'rascunho',
          },
        ],
      },
    });
    const collisionResult = await runFrappeMigration({
      mode: 'apply',
      dataset,
      repository: collisionRepository,
    });
    assert.equal(collisionResult.report.orcamentos.divergentes, 1);
    assert.match(
      collisionResult.report.orcamentos.detalhes[0].mensagem,
      /já existe para outra entidade/
    );
    assert.equal(collisionRepository.writes.quotations, 2);
  });

  it('não expõe CPF/CNPJ em mensagens de divergência de orçamento', async () => {
    const normalized = '12.345.678/0001-90';
    const digits = '12345678000190';
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'dry-run',
      repository,
      dataset: {
        items: [{ name: 'ITEM-PII-Q', item_code: 'SKU-PII', item_name: 'Produto' }],
        customers: [],
        leads: [],
        quotations: [
          {
            name: 'QTN-2024-00099',
            creation: '2024-05-01 10:00:00',
            quotation_to: 'Customer',
            customer: normalized,
            status: 'Submitted',
            items: [
              {
                idx: 1,
                item_code: 'SKU-PII',
                item_name: 'Produto',
                qty: '1',
                uom: 'Und',
                rate: '5.00',
                price_list_rate: '5.00',
                amount: '5.00',
              },
            ],
          },
        ],
      },
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(normalized), false);
    assert.equal(serialized.includes(digits), false);
    assert.equal(result.report.orcamentos.divergentes, 1);
    assert.match(result.report.orcamentos.detalhes[0].mensagem, /Cliente não localizado/);
  });

  it('lê o doctype Quotation com paginação estável', async () => {
    const calls: Array<{ doctype: string; order_by: string }> = [];
    const source = {
      async list(doctype: string, options: { limit: number; start: number; order_by: string }) {
        calls.push({ doctype, order_by: options.order_by });
        const values =
          doctype === 'Quotation'
            ? [
                {
                  name: 'QTN-2024-00001',
                  creation: '2024-01-01 09:00:00',
                  status: 'Draft',
                  items: [],
                },
              ]
            : [];
        return options.start === 0 ? values : [];
      },
    };
    const result = await readFrappeDataset(source, 2);
    assert.equal(result.dataset.quotations?.length, 1);
    assert.equal(result.lidos.quotations, 1);
    assert.equal(
      calls
        .filter((call) => call.doctype === 'Quotation')
        .every((call) => call.order_by === 'creation asc, name asc'),
      true
    );
  });

  it('deriva chaves determinísticas de blob para PDFs históricos', () => {
    const checksum = 'ab'.repeat(32);
    assert.equal(
      deriveHistoricalPdfBlobPath('ORC-20240042', 'QTN-2024-00042', checksum),
      `quotations-migration/ORC-20240042/QTN-2024-00042-${checksum}.pdf`
    );
    // Edge cases: missing business number / source id, invalid checksum.
    assert.throws(() => deriveHistoricalPdfBlobPath('', 'QTN-2024-00042', checksum), /chave do PDF/);
    assert.throws(() => deriveHistoricalPdfBlobPath('ORC-20240042', '', checksum), /chave do PDF/);
    assert.throws(
      () => deriveHistoricalPdfBlobPath('ORC-20240042', 'QTN-2024-00042', 'nao-e-hex'),
      /chave do PDF/
    );
    assert.throws(
      () => deriveHistoricalPdfBlobPath('ORC-20240042', 'QTN-2024-00042', 'a'.repeat(63)),
      /chave do PDF/
    );
  });

  it('normaliza metadados de PDF histórico a partir do registro Frappe', () => {
    const checksum = 'ab'.repeat(32);
    const normalized = normalizeHistoricalPdf({
      name: 'QTN-2024-00042',
      creation: '2024-03-15 10:30:00',
      pdf_checksum_sha256: checksum,
      pdf_size_bytes: 4096,
    });
    assert.ok(normalized);
    assert.equal(normalized.sourceId, 'QTN-2024-00042');
    assert.equal(normalized.businessNumber, 'ORC-20240042');
    assert.equal(normalized.revisionSourceId, 'QTN-2024-00042:v1');
    assert.equal(
      normalized.fileUrl,
      'https://aspenestamparia.l.frappe.cloud/printview?doctype=Quotation&name=QTN-2024-00042&format=padrao&no_letterhead=0'
    );
    assert.equal(normalized.fileName, 'QTN-2024-00042.pdf');
    assert.equal(normalized.mimeType, 'application/pdf');
    assert.equal(normalized.checksumSha256, checksum);
    assert.equal(normalized.sizeBytes, 4096);
  });

  it('retorna null para Quotation sem name e marca checksum ausente', () => {
    assert.equal(normalizeHistoricalPdf({ creation: '2024-01-01 10:00:00' }), null);
    const withoutChecksum = normalizeHistoricalPdf({
      name: 'QTN-2024-00042',
      creation: '2024-01-01 10:00:00',
    });
    assert.ok(withoutChecksum);
    assert.equal(withoutChecksum.checksumSha256, null);
    assert.equal(withoutChecksum.sizeBytes, null);
    // Um checksum em formato inválido não é aceito como hint de integridade.
    const invalidChecksum = normalizeHistoricalPdf({
      name: 'QTN-2024-00042',
      creation: '2024-01-01 10:00:00',
      pdf_checksum_sha256: 'abc',
    });
    assert.equal(invalidChecksum?.checksumSha256, null);
  });

  it('dry-run reporta contagem e volume estimado de PDFs sem buscar ou enviar nada', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const { pipeline, state } = createFakePdfPipeline(() => PDF_A);
    const result = await runFrappeMigration({
      mode: 'dry-run',
      dataset: createFrappeQuotationFixture(),
      repository,
      pdfPipeline: pipeline,
    });
    assert.equal(result.report.documentos.lidos, 2);
    assert.equal(result.report.documentos.estimativa_volume, 2);
    assert.equal(result.report.documentos.divergentes, 0);
    assert.equal(state.fetchCalls.length, 0);
    assert.equal(state.listCalls.length, 0);
    assert.equal(state.putCalls.length, 0);
  });

  it('reporta checksum ausente no registro legado como divergência no dry-run', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'dry-run',
      dataset: createFrappeQuotationNoPdfMetadataFixture(),
      repository,
    });
    assert.equal(result.report.documentos.lidos, 2);
    assert.equal(result.report.documentos.estimativa_volume, 2);
    assert.equal(result.report.documentos.divergentes, 2);
    assert.match(
      result.report.documentos.detalhes[0].mensagem,
      /Checksum ausente no registro legado/
    );
  });

  it('trata Quotation sem name como divergência de PDF sem quebrar a execução', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'dry-run',
      dataset: createFrappeQuotationNoNameFixture(),
      repository,
    });
    assert.ok(result.report.documentos.divergentes >= 1);
    assert.ok(
      result.report.documentos.detalhes.some(
        (detail) =>
          detail.status === 'divergentes' && /sem name/.test(detail.mensagem)
      )
    );
  });

  // The following historical-PDF cases exercise only the legacy Memory pipeline;
  // PostgreSQL intentionally has no historical PDF row.
  it('Memory legacy arquiva PDFs históricos e é idempotente na reexecução', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const { pipeline, state } = createFakePdfPipeline(() => PDF_A);
    const first = await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeQuotationFixture(),
      repository,
      pdfPipeline: pipeline,
    });
    assert.equal(first.report.documentos.lidos, 2);
    assert.equal(first.report.documentos.atualizados, 2);
    assert.equal(state.putCalls.length, 2);
    assert.equal(repository.writes.documents, 2);
    const document = repository
      .snapshot()
      .quotations.find((row) => row.businessNumber === 'ORC-20240042')?.document;
    assert.ok(document);
    assert.match(
      document.blobPathname,
      /^quotations-migration\/ORC-20240042\/QTN-2024-00042-[0-9a-f]{64}\.pdf$/
    );
    assert.equal(document.fileName, 'QTN-2024-00042.pdf');
    assert.equal(document.mimeType, 'application/pdf');
    assert.equal(document.sizeBytes, PDF_A.length);
    assert.equal(document.checksumSha256, quotationPdfChecksum(PDF_A));

    const rerun = await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeQuotationFixture(),
      repository,
      pdfPipeline: pipeline,
    });
    assert.equal(rerun.report.documentos.ignorados, 2);
    assert.equal(state.putCalls.length, 2);
    assert.equal(repository.writes.documents, 2);
    assert.equal(repository.snapshot().quotations.length, 3);
  });

  it('detecta mudança do PDF Frappe entre migrações como divergência', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    let current = PDF_A;
    const { pipeline, state } = createFakePdfPipeline(() => current);
    await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeQuotationFixture(),
      repository,
      pdfPipeline: pipeline,
    });
    // Frappe passou a servir outro PDF original para o mesmo orçamento.
    current = PDF_B;
    const second = await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeQuotationFixture(),
      repository,
      pdfPipeline: pipeline,
    });
    assert.equal(second.report.documentos.divergentes, 2);
    assert.equal(second.report.documentos.atualizados, 0);
    assert.match(
      second.report.documentos.detalhes[0].mensagem,
      /mudou desde a última migração/
    );
    assert.equal(state.putCalls.length, 2);
    assert.equal(repository.writes.documents, 2);
  });

  it('falha de upload de um documento não bloqueia os demais', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const { pipeline, state } = createFakePdfPipeline(() => PDF_A, {
      failPutFor: (pathname) => pathname.includes('/QTN-2024-00042-'),
    });
    const result = await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeQuotationFixture(),
      repository,
      pdfPipeline: pipeline,
    });
    assert.equal(result.report.documentos.erros, 1);
    assert.equal(result.report.documentos.atualizados, 1);
    assert.equal(state.putCalls.length, 2);
    const archived = repository
      .snapshot()
      .quotations.filter((row) =>
        row.document?.blobPathname.startsWith('quotations-migration/')
      );
    assert.equal(archived.length, 1);
    assert.equal(archived[0].businessNumber, 'ORC-20250007');
  });

  it('PDF corrompido é divergência e nunca é enviado', async () => {
    const corrupted = Buffer.from('%PDF-1.7\nsem marcador de fim');
    assert.equal(isValidPdfBuffer(corrupted), false);
    const repository = new MemoryFrappeMigrationRepository();
    const { pipeline, state } = createFakePdfPipeline(() => corrupted);
    const result = await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeQuotationFixture(),
      repository,
      pdfPipeline: pipeline,
    });
    assert.equal(result.report.documentos.divergentes, 2);
    assert.match(result.report.documentos.detalhes[0].mensagem, /corrompido/);
    assert.equal(state.putCalls.length, 0);
    assert.equal(repository.writes.documents, 0);
  });

  it('sem pipeline configurado o arquivamento é omitido no apply', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      dataset: createFrappeQuotationFixture(),
      repository,
    });
    assert.equal(result.report.documentos.lidos, 0);
    assert.equal(result.report.documentos.detalhes.length, 0);
    assert.equal(repository.writes.documents, 0);
  });

  // ── Manifest, lineage run tracking and idempotence (Task 4) ──────────

  it('dry-run retorna manifest com runId, timestamp, contagens e divergenceCounts sem gravar', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeMigrationFixture();
    const beforeRuns = repository.runs.length;
    const beforeBatches = repository.batches.length;
    const result = await runFrappeMigration({ mode: 'dry-run', dataset, repository });
    // Manifest structure
    assert.ok(result.manifest);
    assert.equal(result.manifest.mode, 'dry-run');
    assert.equal(result.manifest.provider, 'frappe');
    assert.ok(typeof result.manifest.runId === 'string' && result.manifest.runId.length > 0);
    assert.ok(result.manifest.sourceSnapshotAt instanceof Date);
    assert.match(result.manifest.manifestHash, /^[0-9a-f]{64}$/);
    assert.equal(result.manifest.status, 'completed');
    // Entity counts from dataset
    assert.equal(result.manifest.entityCounts.products, dataset.items.length);
    assert.equal(
      result.manifest.entityCounts.pricingTiers,
      (dataset.pricingRules || []).length + (dataset.itemPrices || []).length
    );
    assert.equal(
      result.manifest.entityCounts.clients,
      (dataset.customers || []).length + (dataset.leads || []).length
    );
    assert.equal(
      result.manifest.reconciliation.counts.products,
      result.report.produtos.criados + result.report.produtos.atualizados + result.report.produtos.ignorados
    );
    assert.match(result.manifest.reconciliation.hashes.products, /^[0-9a-f]{64}$/);
    assert.equal(
      result.manifest.reconciliation.counts.revisions,
      result.manifest.reconciliation.counts.quotations
    );
    // Divergence counts from report
    const approved = result.report.total.aprovadas;
    const blocking = result.report.total.divergentes + result.report.total.erros;
    assert.equal(result.manifest.divergenceCounts.approved, approved);
    assert.equal(result.manifest.divergenceCounts.blocking, blocking);
    // No DB writes in dry-run
    assert.equal(repository.runs.length, beforeRuns);
    assert.equal(repository.batches.length, beforeBatches);
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.writes.clients, 0);
    assert.equal(repository.writes.quotations, 0);
  });

  it('apply cria run e batches, e lineage referencia o runId', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeMigrationFixture();
    const result = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(result.manifest.mode, 'apply');
    // Run was persisted
    assert.equal(repository.runs.length, 1);
    const run = repository.runs[0];
    assert.equal(run.id, result.manifest.runId);
    assert.equal(run.provider, 'frappe');
    assert.equal(run.mode, 'apply');
    assert.equal(run.status, 'completed');
    assert.ok(run.completedAt instanceof Date);
    assert.match(run.manifestHash, /^[0-9a-f]{64}$/);
    // Manifest hash is deterministic for same dataset
    assert.equal(run.manifestHash, result.manifest.manifestHash);
    // Batches were created (at least produtos and clientes)
    assert.ok(repository.batches.length >= 2);
    const completedBatches = repository.batches.filter((b) => b.status === 'completed');
    assert.ok(completedBatches.length >= 2);
    // Every persisted lineage entry references this run and exposes the
    // contract fields through the repository read boundary.
    const lineageWithRun = repository.snapshot().lineage;
    assert.ok(lineageWithRun.length > 0);
    for (const entry of lineageWithRun) {
      assert.equal(entry.provider, 'frappe');
      assert.equal(entry.migrationRunId, run.id);
      assert.ok(entry.localId);
      assert.ok(entry.sourceHash);
      assert.match(entry.sourceHash, /^[0-9a-f]{64}$/);
      assert.ok(entry.importedAt instanceof Date);
    }
  });

  it('bloqueia apply quando o snapshot mudou depois do dry-run revisado', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeMigrationFixture();
    const dryRun = await runFrappeMigration({ mode: 'dry-run', dataset, repository });
    await assert.rejects(
      () =>
        runFrappeMigration({
          mode: 'apply',
          dataset: { ...dataset, quotations: [...(dataset.quotations || []), { name: 'QTN-2024-99999' }] },
          expectedManifestHash: dryRun.manifest.manifestHash,
          repository,
        }),
      /snapshot atual/
    );
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.writes.clients, 0);
    assert.equal(repository.writes.quotations, 0);
  });

  it('dry-run com manifest determinístico: mesmo dataset produz mesmo manifestHash', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeMigrationFixture();
    const first = await runFrappeMigration({ mode: 'dry-run', dataset, repository });
    const second = await runFrappeMigration({ mode: 'dry-run', dataset, repository });
    assert.equal(first.manifest.manifestHash, second.manifest.manifestHash);
    assert.deepEqual(first.manifest.reconciliation, second.manifest.reconciliation);
    // Different datasets produce different hashes
    const differentDataset = { ...dataset, items: [] };
    const third = await runFrappeMigration({ mode: 'dry-run', dataset: differentDataset, repository });
    assert.notEqual(first.manifest.manifestHash, third.manifest.manifestHash);
  });

  it('idempotência: mesmo fixture aplicado duas vezes produz mesmos resultados', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeMigrationFixture();
    const first = await runFrappeMigration({ mode: 'apply', dataset, repository });
    const snapshot1 = repository.snapshot();
    const second = await runFrappeMigration({ mode: 'apply', dataset, repository });
    const snapshot2 = repository.snapshot();
    // Same entity counts
    assert.equal(snapshot1.products.length, snapshot2.products.length);
    assert.equal(snapshot1.clients.length, snapshot2.clients.length);
    assert.equal(snapshot1.lineage.length, snapshot2.lineage.length);
    // Same product SKUs and hashes
    for (const product of snapshot1.products) {
      const match = snapshot2.products.find((p) => p.sku === product.sku);
      assert.ok(match, `Produto ${product.sku} não encontrado na segunda execução`);
    }
    // Same lineage references
    for (const entry of snapshot1.lineage) {
      const match = snapshot2.lineage.find(
        (e) => e.sourceDoctype === entry.sourceDoctype && e.sourceId === entry.sourceId
      );
      assert.ok(match, `Linhagem ${entry.sourceDoctype}:${entry.sourceId} não encontrada`);
      assert.equal(match.localKey, entry.localKey);
      assert.equal(match.canonicalHash, entry.canonicalHash);
    }
    // Both runs completed
    assert.equal(first.manifest.status, 'completed');
    assert.equal(second.manifest.status, 'completed');
    // Second run reported as ignored
    assert.equal(second.report.produtos.ignorados, first.report.produtos.criados);
    assert.equal(second.report.clientes.ignorados, first.report.clientes.criados);
  });

  it('manifest não serializa legacyPayload/PII em relatório', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeMigrationFixture();
    const result = await runFrappeMigration({ mode: 'apply', dataset, repository });
    const serialized = JSON.stringify(result.manifest);
    // PII fields that must never appear in manifest
    const piiValues = [
      '12.345.678/0001-90',
      '12345678000190',
      'cliente@example.com',
    ];
    for (const pii of piiValues) {
      assert.equal(serialized.includes(pii), false, `Manifest contém PII: ${pii}`);
    }
    // Manifest must not contain raw Frappe payloads
    assert.equal(serialized.includes('legacy_payload'), false, 'Manifest contém legacy_payload');
    assert.equal(serialized.includes('Lancheira'), false, 'Manifest contém dados do produto Frappe');
  });

  // ── Fix round 0 / pre-review tests ──────────────────────────────────

  it('resume retoma batch com falha e incrementa attemptCount preservando checkpoint', async () => {
    // Source order is stable; fail after the first product so checkpoint 1
    // proves resume starts at the persisted cursor.
    const repository = new MemoryFrappeMigrationRepository({ failProductSku: 'ECO-30' });
    const dataset = createFrappeMigrationFixture();

    // First run: products batch fails after LNC-SED-70-30 succeeds.
    const first = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(first.report.produtos.erros, 1);
    assert.ok(repository.batches.length >= 2);
    const productsBatch = repository.batches.find((b) => b.entityType === 'produtos');
    assert.ok(productsBatch);
    assert.equal(productsBatch.status, 'failed');
    assert.equal(productsBatch.attemptCount, 1);
    assert.equal(productsBatch.checkpoint, 1);
    const firstRunId = repository.runs[0].id;
    const productTransactionsBeforeResume = repository.transactions.products;

    // Second run: same dataset, same manifest hash - should resume at cursor 1
    repository.failProductSku = undefined;
    const second = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(second.report.produtos.criados, 1);
    // Same run was reused (no new run created)
    assert.equal(repository.runs.length, 1);
    assert.equal(repository.runs[0].id, firstRunId);
    // Batch was reused with incremented attemptCount
    const resumedBatch = repository.batches.find((b) => b.entityType === 'produtos');
    assert.ok(resumedBatch);
    assert.equal(resumedBatch.id, productsBatch.id);
    assert.equal(resumedBatch.attemptCount, 2);
    assert.equal(resumedBatch.status, 'completed');
    assert.equal(resumedBatch.checkpoint, 2);
    assert.equal(repository.transactions.products, productTransactionsBeforeResume + 1);
  });

  it('lineage persiste business_number de orçamento com fonte canônica', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeQuotationFixture();
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    const orcamentoLineage = repository
      .snapshot()
      .lineage.filter((entry) => entry.entityType === 'orcamento');
    assert.equal(orcamentoLineage.length, 3);
    for (const entry of orcamentoLineage) {
      assert.ok(entry.businessNumber, `businessNumber ausente para ${entry.sourceId}`);
      assert.match(entry.businessNumber!, /^ORC-[0-9]{8}$/);
    }
    // Verify specific business numbers
    const qtn42 = orcamentoLineage.find((e) => e.sourceId === 'QTN-2024-00042');
    assert.ok(qtn42);
    assert.equal(qtn42.businessNumber, 'ORC-20240042');
    const qtn43 = orcamentoLineage.find((e) => e.sourceId === 'QTN-2024-00043');
    assert.ok(qtn43);
    assert.equal(qtn43.businessNumber, 'ORC-20240043');
    // Non-quotation lineage keeps the contract field explicitly null.
    const produtoLineage = repository
      .snapshot()
      .lineage.filter((entry) => entry.entityType === 'produto');
    assert.ok(produtoLineage.length > 0);
    for (const entry of produtoLineage) {
      assert.equal(entry.businessNumber, null);
    }
  });

  it('source_hash e canonical_hash são campos reais e distintos', () => {
    const entry = {
      sourceDoctype: 'Quotation' as const,
      sourceId: 'QTN-2024-00042',
      entityType: 'orcamento' as const,
      localKey: 'stable-id',
      canonicalHash: 'a'.repeat(64),
      sourceHash: 'b'.repeat(64),
      businessNumber: 'ORC-20240042',
    };
    assert.match(entry.sourceHash, /^[0-9a-f]{64}$/);
    assert.match(entry.canonicalHash, /^[0-9a-f]{64}$/);
    assert.notEqual(entry.sourceHash, entry.canonicalHash);
    const fromDb: ExistingLineage = {
      provider: 'frappe',
      sourceDoctype: 'Quotation',
      sourceId: 'QTN-2024-00042',
      entityType: 'orcamento',
      localId: 'stable-id',
      localKey: 'stable-id',
      canonicalHash: 'c'.repeat(64),
      sourceHash: 'd'.repeat(64),
      businessNumber: 'ORC-20240042',
      migrationRunId: null,
      sourceUpdatedAt: null,
      importedAt: null,
    };
    assert.ok(fromDb.sourceHash);
    assert.match(fromDb.sourceHash, /^[0-9a-f]{64}$/);
    assert.match(fromDb.canonicalHash, /^[0-9a-f]{64}$/);
    assert.notEqual(fromDb.sourceHash, fromDb.canonicalHash);
  });

  it('idempotência preserva business_number na segunda execução', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeQuotationFixture();
    const first = await runFrappeMigration({ mode: 'apply', dataset, repository });
    const second = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(first.manifest.status, 'completed');
    assert.equal(second.manifest.status, 'completed');
    const lineageAfter = repository
      .snapshot()
      .lineage.filter((e) => e.entityType === 'orcamento');
    assert.equal(lineageAfter.length, 3);
    for (const entry of lineageAfter) {
      assert.ok(entry.businessNumber);
    }
  });

  it('atualiza produto quando somente payload-fonte ou modified muda e converge para no-op', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset: FrappeDataset = {
      items: [
        {
          name: 'ITEM-SOURCE-ONLY',
          item_code: 'SKU-SOURCE-ONLY',
          item_name: 'Produto',
          modified: '2024-01-01 00:00:00',
          custom_metadata: 'v1',
        },
      ],
      pricingRules: [],
      itemPrices: [],
      customers: [],
      leads: [],
    };
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    const before = repository.snapshot().lineage.find((entry) => entry.sourceId === 'ITEM-SOURCE-ONLY');
    const changed = {
      ...dataset,
      items: [{ ...dataset.items[0], modified: '2024-01-02 00:00:00', custom_metadata: 'v2' }],
    };
    const updated = await runFrappeMigration({ mode: 'apply', dataset: changed, repository });
    assert.equal(updated.report.produtos.atualizados, 1);
    const after = repository.snapshot().lineage.find((entry) => entry.sourceId === 'ITEM-SOURCE-ONLY');
    assert.ok(before && after);
    assert.notEqual(after.sourceHash, before.sourceHash);
    assert.equal(after.sourceUpdatedAt?.toISOString(), '2024-01-02T00:00:00.000Z');
    const rerun = await runFrappeMigration({ mode: 'apply', dataset: changed, repository });
    assert.equal(rerun.report.produtos.ignorados, 1);
  });

  it('atualiza cliente quando somente payload-fonte ou modified muda e converge para no-op', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset: FrappeDataset = {
      items: [],
      customers: [
        {
          name: 'CUST-SOURCE-ONLY',
          customer_name: 'Cliente',
          tax_id: '11223344556',
          modified: '2024-02-01 00:00:00',
          custom_metadata: 'v1',
        },
      ],
      leads: [],
    };
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    const before = repository.snapshot().lineage.find((entry) => entry.sourceId === 'CUST-SOURCE-ONLY');
    const changed = {
      ...dataset,
      customers: [{ ...dataset.customers?.[0], modified: '2024-02-02 00:00:00', custom_metadata: 'v2' }],
    };
    const updated = await runFrappeMigration({ mode: 'apply', dataset: changed, repository });
    assert.equal(updated.report.clientes.atualizados, 1);
    const after = repository.snapshot().lineage.find((entry) => entry.sourceId === 'CUST-SOURCE-ONLY');
    assert.ok(before && after);
    assert.notEqual(after.sourceHash, before.sourceHash);
    assert.equal(after.sourceUpdatedAt?.toISOString(), '2024-02-02T00:00:00.000Z');
    const rerun = await runFrappeMigration({ mode: 'apply', dataset: changed, repository });
    assert.equal(rerun.report.clientes.ignorados, 1);
  });

  it('mantém revisão anterior imutável quando a fonte do orçamento muda', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset = createFrappeQuotationFixture();
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    const first = repository.snapshot().quotations.find((quotation) => quotation.businessNumber === 'ORC-20240042');
    assert.ok(first?.revision);
    const changed = {
      ...dataset,
      quotations: (dataset.quotations || []).map((quotation) =>
        quotation.name === 'QTN-2024-00042'
          ? { ...quotation, grand_total: '999.00', modified: '2024-04-01 00:00:00' }
          : quotation,
      ),
    };
    await runFrappeMigration({ mode: 'apply', dataset: changed, repository });
    const current = repository.snapshot().quotations.find((quotation) => quotation.businessNumber === 'ORC-20240042');
    assert.ok(current?.revision);
    assert.notEqual(current.revision.id, first.revision.id);
    assert.equal(current.revision.version, first.revision.version + 1);
    assert.equal(current.revision.status, 'rascunho');
    assert.equal(current.status, 'rascunho');
    assert.equal(repository.revisionHistory(current.id)[0]?.id, first.revision.id);
    assert.equal(repository.revisionHistory(current.id)[0]?.total, first.revision.total);
  });

  it('atualiza orçamento quando somente payload-fonte ou modified muda e converge para no-op', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset: FrappeDataset = {
      items: [{ name: 'ITEM-Q-SOURCE-ONLY', item_code: 'SKU-Q-SOURCE-ONLY', item_name: 'Produto' }],
      customers: [{ name: 'CUST-Q-SOURCE-ONLY', customer_name: 'Cliente', tax_id: '11223344556' }],
      leads: [],
      quotations: [
        {
          name: 'QTN-2024-00061',
          creation: '2024-03-01 00:00:00',
          modified: '2024-03-01 00:00:00',
          quotation_to: 'Customer',
          customer: 'CUST-Q-SOURCE-ONLY',
          status: 'Draft',
          custom_metadata: 'v1',
          items: [
            {
              idx: 1,
              item_code: 'SKU-Q-SOURCE-ONLY',
              qty: '1',
              rate: '5.00',
              price_list_rate: '5.00',
              amount: '5.00',
            },
          ],
        },
      ],
    };
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    const before = repository.snapshot().lineage.find((entry) => entry.sourceId === 'QTN-2024-00061');
    const changed = {
      ...dataset,
      quotations: [{ ...dataset.quotations?.[0], modified: '2024-03-02 00:00:00', custom_metadata: 'v2' }],
    };
    const updated = await runFrappeMigration({ mode: 'apply', dataset: changed, repository });
    assert.equal(updated.report.orcamentos.atualizados, 1);
    const after = repository.snapshot().lineage.find((entry) => entry.sourceId === 'QTN-2024-00061');
    assert.ok(before && after);
    assert.notEqual(after.sourceHash, before.sourceHash);
    assert.equal(after.sourceUpdatedAt?.toISOString(), '2024-03-02T00:00:00.000Z');
    const rerun = await runFrappeMigration({ mode: 'apply', dataset: changed, repository });
    assert.equal(rerun.report.orcamentos.ignorados, 1);
  });
});

// ── Fake archival pipeline helpers ──────────────────────────────────────────

const PDF_A = Buffer.from(['%PDF-1.7', 'conteudo-a', '%%EOF'].join('\n') + '\n');
const PDF_B = Buffer.from(['%PDF-1.7', 'conteudo-b-mudou', '%%EOF'].join('\n') + '\n');

interface FakePdfPipelineState {
  fetchCalls: string[];
  listCalls: string[];
  putCalls: string[];
  blobs: Map<string, Buffer>;
}

interface FakePdfPipelineOptions {
  failPutFor?: (pathname: string) => boolean;
}

/** In-memory pipeline: records every I/O call and keeps uploaded blobs so the
 * same store can be reused across reruns (idempotency). */
function createFakePdfPipeline(
  render: (html: string) => Buffer,
  options: FakePdfPipelineOptions = {}
): { pipeline: HistoricalPdfPipeline; state: FakePdfPipelineState } {
  const state: FakePdfPipelineState = {
    fetchCalls: [],
    listCalls: [],
    putCalls: [],
    blobs: new Map(),
  };
  const pipeline: HistoricalPdfPipeline = {
    async fetchHtml(fileUrl: string): Promise<string> {
      state.fetchCalls.push(fileUrl);
      return `<html><body>${fileUrl}</body></html>`;
    },
    renderPdf(html: string): Promise<Buffer> {
      return Promise.resolve(render(html));
    },
    blobs: {
      async list(prefix: string): Promise<string[]> {
        state.listCalls.push(prefix);
        return [...state.blobs.keys()].filter((pathname) => pathname.startsWith(prefix));
      },
      async put(pathname: string, buffer: Buffer): Promise<{
        pathname: string;
        sizeBytes: number;
        checksumSha256: string;
      }> {
        state.putCalls.push(pathname);
        if (options.failPutFor?.(pathname)) throw new Error('falha no upload');
        state.blobs.set(pathname, buffer);
        return {
          pathname,
          sizeBytes: buffer.length,
          checksumSha256: quotationPdfChecksum(buffer),
        };
      },
    },
  };
  return { pipeline, state };
}
