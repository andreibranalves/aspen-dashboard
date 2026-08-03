import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveProductPrice } from '../../api/_functions/pricing-core.js';
import {
  canonicalHash,
  readFrappeDataset,
  runFrappeMigration,
  type FrappeDataset,
} from '../../api/_functions/frappe-migration.js';
import { MemoryFrappeMigrationRepository } from '../../api/_db/frappe-migration-repository.js';
import { LEGACY_PRICING_FIXTURES } from '../fixtures/legacy-pricing-fixtures.ts';
import {
  createFrappeDuplicateFixture,
  createFrappeIncompleteFixture,
  createFrappeMigrationFixture,
} from '../fixtures/frappe-migration-fixtures.ts';

describe('migração Frappe CRM', () => {
  it('pagina fonte com ordenação estável e lê todos os documentos', async () => {
    const calls: Array<{ doctype: string; start: number; order_by: string }> = [];
    const source = {
      async list(doctype: string, options: { limit: number; start: number; order_by: string }) {
        calls.push({ doctype, start: options.start, order_by: options.order_by });
        const values = doctype === 'Item'
          ? [{ name: 'ITEM-1', item_code: 'SKU-1', item_name: 'Um' }, { name: 'ITEM-2', item_code: 'SKU-2', item_name: 'Dois' }]
          : [];
        return options.start === 0 ? values : [];
      },
    };
    const result = await readFrappeDataset(source, 2);
    assert.equal(result.dataset.items.length, 2);
    assert.ok(calls.every((call) => call.order_by === 'creation asc, name asc'));
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
    assert.equal(repository.snapshot().lineage.filter((row) => row.entityType === 'cliente').length, 2);
  });

  it('separa atualização, divergência, entrada inválida e retomada após falha', async () => {
    const repository = new MemoryFrappeMigrationRepository({ failProductSku: 'LNC-SED-70-30' });
    const first = await runFrappeMigration({ mode: 'apply', dataset: createFrappeMigrationFixture(), repository });
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
    assert.equal(repository.snapshot().products.filter((row) => row.sku === 'LNC-SED-70-30').length, 1);
    assert.equal(repository.snapshot().products.length, 2);

    const duplicate = await runFrappeMigration({ mode: 'dry-run', dataset: createFrappeDuplicateFixture(), repository });
    assert.equal(duplicate.report.produtos.divergentes, 2);
    const incomplete = await runFrappeMigration({ mode: 'dry-run', dataset: createFrappeIncompleteFixture(), repository });
    assert.ok(incomplete.report.produtos.erros >= 1);
    assert.ok(incomplete.report.clientes.erros >= 1);
  });

  it('bloqueia remapeamento de linhagem Item/faixa e vínculos Customer/Lead', async () => {
    const dataset = createFrappeMigrationFixture();
    const itemRepository = new MemoryFrappeMigrationRepository({ state: {
      lineage: [{ sourceDoctype: 'Item', sourceId: 'ITEM-001', entityType: 'produto', localKey: 'OUTRO-SKU', canonicalHash: 'a'.repeat(64), legacyPayload: {} }],
    } });
    const itemResult = await runFrappeMigration({ mode: 'apply', dataset, repository: itemRepository });
    assert.equal(itemResult.report.produtos.divergentes, 1);
    assert.equal(itemRepository.snapshot().products.length, 1);

    const priceRepository = new MemoryFrappeMigrationRepository({ state: {
      lineage: [{ sourceDoctype: 'Pricing Rule', sourceId: 'PR-LNC', entityType: 'faixa', localKey: 'OUTRO-SKU', canonicalHash: 'b'.repeat(64), legacyPayload: {} }],
    } });
    const priceResult = await runFrappeMigration({ mode: 'apply', dataset, repository: priceRepository });
    assert.equal(priceResult.report.produtos.divergentes, 1);
    assert.equal(priceRepository.snapshot().products.length, 1);

    const corruptRepository = new MemoryFrappeMigrationRepository({ state: {
      lineage: [{ sourceDoctype: 'Item', sourceId: 'ITEM-001', entityType: 'cliente', localKey: 'LNC-SED-70-30', canonicalHash: 'e'.repeat(64), legacyPayload: {} }],
    } });
    const corruptResult = await runFrappeMigration({ mode: 'apply', dataset, repository: corruptRepository });
    assert.equal(corruptResult.report.produtos.divergentes, 1);
    assert.equal(corruptRepository.snapshot().products.length, 1);

    const clientRepository = new MemoryFrappeMigrationRepository({ state: {
      clients: [
        { id: '00000000-0000-4000-8000-000000000001', nome: 'A', documento: '12345678909' },
        { id: '00000000-0000-4000-8000-000000000002', nome: 'B', documento: '12345678909' },
      ],
      lineage: [
        { sourceDoctype: 'Customer', sourceId: 'CUST-001', entityType: 'cliente', localKey: '00000000-0000-4000-8000-000000000001', canonicalHash: 'c'.repeat(64), legacyPayload: {} },
        { sourceDoctype: 'Lead', sourceId: 'LEAD-001', entityType: 'cliente', localKey: '00000000-0000-4000-8000-000000000002', canonicalHash: 'd'.repeat(64), legacyPayload: {} },
      ],
    } });
    const clientResult = await runFrappeMigration({ mode: 'apply', dataset, repository: clientRepository });
    assert.equal(clientResult.report.clientes.divergentes, 1);
    assert.equal(clientRepository.writes.clients, 0);

    const multiSkuDataset: FrappeDataset = {
      items: [
        { name: 'ITEM-M1', item_code: 'MULTI-A', item_name: 'A' },
        { name: 'ITEM-M2', item_code: 'MULTI-B', item_name: 'B' },
      ],
      pricingRules: [{ name: 'PR-MULTI', items: [
        { item_code: 'MULTI-A', min_qty: 30, rate: '1.00' },
        { item_code: 'MULTI-B', min_qty: 30, rate: '2.00' },
      ] }],
    };
    const multiRepository = new MemoryFrappeMigrationRepository();
    const multiResult = await runFrappeMigration({ mode: 'apply', dataset: multiSkuDataset, repository: multiRepository });
    assert.equal(multiResult.report.produtos.divergentes, 2);
    assert.equal(multiRepository.writes.products, 0);
  });

  it('não adota SKU local sem linhagem quando apenas o preço diverge', async () => {
    const repository = new MemoryFrappeMigrationRepository({ state: {
      products: [{ sku: 'PRICE-COLLISION', nome: 'Produto', descricao: '', unidade: 'Und', categoria: null, marca: null, ativo: true, precoBase: null, precos: [{ minimum_quantity: '30', unit_price: '5.00' }] }],
    } });
    const result = await runFrappeMigration({ mode: 'apply', repository, dataset: {
      items: [{ name: 'ITEM-PRICE-COLLISION', item_code: 'PRICE-COLLISION', item_name: 'Produto', description: '', stock_uom: 'Und' }],
      pricingRules: [{ name: 'PR-PRICE-COLLISION', item_code: 'PRICE-COLLISION', min_qty: 30, price_list_rate: '4.00' }],
      itemPrices: [],
    } });
    assert.equal(result.report.produtos.divergentes, 1);
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.snapshot().products[0].precos?.[0].unit_price, '5.00');
  });

  it('não cria erro de faixa quando falha produto sem fonte de preço', async () => {
    const repository = new MemoryFrappeMigrationRepository({ failProductSku: 'NO-PRICE' });
    const result = await runFrappeMigration({ mode: 'apply', repository, dataset: {
      items: [{ name: 'ITEM-NO-PRICE', item_code: 'NO-PRICE', item_name: 'Sem preço' }],
      pricingRules: [],
      itemPrices: [],
    } });
    assert.equal(result.report.produtos.erros, 1);
    assert.equal(result.report.faixas.erros, 0);
  });

  it('mantém cada combinação SKU × faixa da fixture legada', async () => {
    const dataset: FrappeDataset = {
      items: LEGACY_PRICING_FIXTURES.map((fixture, index) => ({ name: `ITEM-${index}`, item_code: fixture.sku, item_name: fixture.sku })),
      pricingRules: LEGACY_PRICING_FIXTURES.flatMap((fixture) => fixture.tiers.map((tier, index) => ({
        name: `PR-${fixture.sku}-${index}`,
        item_code: fixture.sku,
        min_qty: tier.minimum_quantity,
        price_list_rate: tier.unit_price,
      }))),
      itemPrices: [],
    };
    const repository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    for (const fixture of LEGACY_PRICING_FIXTURES) {
      const product = repository.snapshot().products.find((row) => row.sku === fixture.sku);
      assert.ok(product);
      for (const tier of fixture.tiers) {
        assert.equal(resolveProductPrice({ preco_base: product.precoBase || null, precos: product.precos || [] }, tier.minimum_quantity).rate, tier.unit_price);
      }
    }
  });

  it('é compatível com Pricing Rule legado por title/rate em todas as faixas', async () => {
    const dataset: FrappeDataset = {
      items: LEGACY_PRICING_FIXTURES.map((fixture, index) => ({ name: `LEGACY-ITEM-${index}`, item_code: fixture.sku, item_name: fixture.sku })),
      pricingRules: LEGACY_PRICING_FIXTURES.flatMap((fixture) => fixture.tiers.map((tier) => ({
        name: `${fixture.sku}-${tier.minimum_quantity}`,
        title: `${fixture.sku}-${tier.minimum_quantity}`,
        rate: tier.unit_price,
      }))),
      itemPrices: [],
    };
    const repository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset, repository });
    for (const fixture of LEGACY_PRICING_FIXTURES) {
      const product = repository.snapshot().products.find((row) => row.sku === fixture.sku);
      assert.ok(product);
      for (let index = 0; index < fixture.tiers.length; index += 1) {
        const boundary = Number(fixture.tiers[index].minimum_quantity);
        const expectedBelow = index === 0 ? fixture.tiers[0].unit_price : fixture.tiers[index - 1].unit_price;
        assert.equal(resolveProductPrice({ preco_base: product.precoBase || null, precos: product.precos || [] }, String(Math.max(0.001, boundary - 0.001))).rate, expectedBelow);
        assert.equal(resolveProductPrice({ preco_base: product.precoBase || null, precos: product.precos || [] }, String(boundary)).rate, fixture.tiers[index].unit_price);
        assert.equal(resolveProductPrice({ preco_base: product.precoBase || null, precos: product.precos || [] }, String(boundary + 0.001)).rate, fixture.tiers[index].unit_price);
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
      const repository = mode === 'apply'
        ? new MemoryFrappeMigrationRepository({ failClientKey: `documento:${normalized}` })
        : new MemoryFrappeMigrationRepository();
      const result = await runFrappeMigration({ mode, repository, dataset: {
        items: [],
        customers: [{ name: 'CUST-PII', customer_name: 'Cliente PII', tax_id: formatted }],
        leads: [],
      } });
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
      `cliente:${canonicalHash(`Customer:${customerSourceId}`).slice(0, 12)}`,
      `cliente:${canonicalHash(`Lead:${leadSourceId}`).slice(0, 12)}`,
    ];
    for (const mode of ['dry-run', 'apply'] as const) {
      const repository = new MemoryFrappeMigrationRepository();
      const result = await runFrappeMigration({ mode, repository, dataset: {
        items: [],
        customers: [{ name: customerSourceId, customer_name: 'Cliente CPF', tax_id: documents[0] }],
        leads: [{ name: leadSourceId, lead_name: 'Lead e-mail', tax_id: documents[1] }],
      } });
      const serialized = JSON.stringify(result);
      assert.equal(Object.prototype.hasOwnProperty.call(result, 'dataset'), false);
      assert.equal(serialized.includes(customerSourceId), false);
      assert.equal(serialized.includes(leadSourceId), false);
      for (const document of documents) assert.equal(serialized.includes(document), false);
      const reportSourceIds = result.report.clientes.detalhes.map((detail) => detail.source_id);
      assert.deepEqual(reportSourceIds.sort(), expectedSourceIds.sort());
      assert.equal(result.report.clientes.detalhes.every((detail) => detail.local_key === undefined), true);
      assert.equal(result.report.clientes.criados, 2);
      if (mode === 'apply') {
        const lineage = repository.snapshot().lineage.filter((entry) => entry.entityType === 'cliente');
        assert.equal(lineage.some((entry) => entry.sourceId === customerSourceId && entry.legacyPayload.tax_id === documents[0]), true);
        assert.equal(lineage.some((entry) => entry.sourceId === leadSourceId && entry.legacyPayload.tax_id === documents[1]), true);
      }
    }
  });

  it('usa regra flat/tiered antes de Item Price e não usa standard_rate como atalho', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({ mode: 'apply', repository, dataset: {
      items: [
        { name: 'ITEM-FLAT', item_code: 'FLAT-SKU', item_name: 'Flat', standard_rate: '99.00' },
        { name: 'ITEM-FALLBACK', item_code: 'FALLBACK-SKU', item_name: 'Fallback', standard_rate: '99.00' },
      ],
      pricingRules: [{ name: 'PR-FLAT', title: 'FLAT-SKU', rate: '7.00' }],
      itemPrices: [
        { name: 'IP-FLAT', item_code: 'FLAT-SKU', price_list: 'Standard Selling', price_list_rate: '8.00' },
        { name: 'IP-OTHER', item_code: 'FALLBACK-SKU', price_list: 'Other', price_list_rate: '3.00' },
        { name: 'IP-FALLBACK', item_code: 'FALLBACK-SKU', price_list: 'Standard Selling', price_list_rate: '6.00' },
      ],
    } });
    assert.equal(result.report.produtos.criados, 2);
    const flat = repository.snapshot().products.find((row) => row.sku === 'FLAT-SKU');
    const fallback = repository.snapshot().products.find((row) => row.sku === 'FALLBACK-SKU');
    assert.ok(flat && fallback);
    assert.equal(resolveProductPrice({ preco_base: flat.precoBase || null, precos: flat.precos || [] }, 30).rate, '7.00');
    assert.equal(resolveProductPrice({ preco_base: fallback.precoBase || null, precos: fallback.precos || [] }, 30).rate, '6.00');
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
          { name: 'IP-SPECIFIC-100', item_code: 'SPECIFIC-100', min_qty: 100, price_list: 'Standard Selling', price_list_rate: '7.00' },
        ],
        expected: ['7.00', '7.00', '7.00', '5.00', '5.00'],
      },
      {
        sku: 'FLAT-WINS',
        pricingRules: [
          { name: 'PR-FLAT-WINS', title: 'FLAT-WINS', rate: '7.00' },
        ],
        itemPrices: [
          { name: 'IP-FLAT-WINS', item_code: 'FLAT-WINS', min_qty: 100, price_list: 'Standard Selling', price_list_rate: '5.00' },
        ],
        expected: ['7.00', '7.00', '7.00', '7.00', '7.00'],
      },
      {
        sku: 'FLAT-SPECIFIC-100',
        pricingRules: [
          { name: 'PR-FLAT-SPECIFIC-100-BASE', title: 'FLAT-SPECIFIC-100', rate: '7.00' },
          { name: 'PR-FLAT-SPECIFIC-100-TIER', item_code: 'FLAT-SPECIFIC-100', min_qty: 100, rate: '5.00' },
        ],
        itemPrices: [
          { name: 'IP-FLAT-SPECIFIC-100', item_code: 'FLAT-SPECIFIC-100', min_qty: 100, price_list: 'Standard Selling', price_list_rate: '9.00' },
        ],
        expected: ['7.00', '7.00', '7.00', '5.00', '5.00'],
      },
    ];
    const quantities = [1, 30, 99.999, 100, 100.001];
    for (const fixture of cases) {
      const repository = new MemoryFrappeMigrationRepository();
      await runFrappeMigration({ mode: 'apply', repository, dataset: {
        items: [{ name: `ITEM-${fixture.sku}`, item_code: fixture.sku, item_name: fixture.sku }],
        pricingRules: fixture.pricingRules || [],
        itemPrices: fixture.itemPrices || [],
      } });
      const product = repository.snapshot().products.find((row) => row.sku === fixture.sku);
      assert.ok(product);
      assert.deepEqual(
        quantities.map((quantity) => resolveProductPrice({ preco_base: product.precoBase || null, precos: product.precos || [] }, quantity).rate),
        fixture.expected,
      );
      for (const price of fixture.itemPrices || []) {
        assert.equal(repository.snapshot().lineage.some((entry) => entry.sourceId === price.name && entry.sourceDoctype === 'Item Price'), true);
      }
    }
  });

  it('reporta divergência para múltiplos Item Price Standard Selling conflitantes', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({ mode: 'apply', repository, dataset: {
      items: [{ name: 'ITEM-IP-CONFLICT', item_code: 'IP-CONFLICT', item_name: 'Conflito' }],
      pricingRules: [],
      itemPrices: [
        { name: 'IP-CONFLICT-A', item_code: 'IP-CONFLICT', min_qty: 30, price_list: 'Standard Selling', price_list_rate: '7.00' },
        { name: 'IP-CONFLICT-B', item_code: 'IP-CONFLICT', min_qty: 100, price_list: 'Standard Selling', price_list_rate: '6.00' },
      ],
    } });
    assert.equal(result.report.produtos.divergentes, 1);
    assert.equal(result.report.faixas.divergentes, 1);
    assert.equal(result.report.faixas.detalhes[0].source_id, 'IP-CONFLICT-A');
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.snapshot().lineage.some((entry) => entry.sourceId === 'IP-CONFLICT-A' || entry.sourceId === 'IP-CONFLICT-B'), false);
  });

  it('bloqueia faixa órfã sem criar sua linhagem', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({ mode: 'apply', repository, dataset: {
      items: [{ name: 'ITEM-KNOWN', item_code: 'KNOWN-SKU', item_name: 'Conhecido' }],
      pricingRules: [{ name: 'PR-ORPHAN', item_code: 'UNKNOWN-SKU', min_qty: 30, rate: '4.00' }],
      itemPrices: [],
    } });
    assert.equal(result.report.faixas.erros, 1);
    assert.match(result.report.faixas.detalhes[0].mensagem, /UNKNOWN-SKU/);
    assert.equal(repository.writes.products, 1);
    assert.equal(repository.snapshot().lineage.some((entry) => entry.sourceId === 'PR-ORPHAN'), false);
  });

  it('bloqueia documento de preço misto conhecido/órfão como unidade inteira', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({ mode: 'apply', repository, dataset: {
      items: [{ name: 'ITEM-MIXED', item_code: 'KNOWN-SKU', item_name: 'Conhecido' }],
      pricingRules: [{ name: 'PR-MIXED', items: [
        { item_code: 'KNOWN-SKU', min_qty: 30, rate: '4.00' },
        { item_code: 'UNKNOWN-SKU', min_qty: 30, rate: '5.00' },
      ] }],
      itemPrices: [],
    } });
    assert.equal(result.report.faixas.erros, 1);
    assert.equal(result.report.faixas.divergentes, 1);
    assert.equal(result.report.produtos.divergentes, 1);
    assert.match(result.report.faixas.detalhes.find((detail) => detail.status === 'erros')?.mensagem || '', /UNKNOWN-SKU/);
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.snapshot().lineage.some((entry) => entry.sourceId === 'PR-MIXED'), false);
  });

  it('não consolida Customer/Lead pelo nome sem documento ou vínculo explícito', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({ mode: 'apply', repository, dataset: {
      items: [],
      customers: [{ name: 'CUST-SAME-NAME', customer_name: 'Pessoa Sem Documento' }],
      leads: [{ name: 'LEAD-SAME-NAME', lead_name: 'Pessoa Sem Documento' }],
    } });
    assert.equal(result.report.clientes.divergentes, 1);
    assert.match(result.report.clientes.detalhes[0].mensagem, /Identidade ambígua/);
    assert.equal(repository.writes.clients, 0);
    assert.equal(repository.snapshot().clients.length, 0);
  });

  it('consolida Customer/Lead somente por referência explícita compartilhada', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({ mode: 'apply', repository, dataset: {
      items: [],
      customers: [{ name: 'CUST-LINKED', customer_name: 'Pessoa Vinculada', customer: 'CRM-PERSON-1' }],
      leads: [{ name: 'LEAD-LINKED', lead_name: 'Pessoa Vinculada', lead: 'CRM-PERSON-1' }],
    } });
    assert.equal(result.report.clientes.criados, 1);
    assert.equal(result.report.clientes.divergentes, 0);
    assert.equal(repository.writes.clients, 1);
    assert.equal(repository.snapshot().lineage.filter((entry) => entry.entityType === 'cliente').length, 2);
  });
});
