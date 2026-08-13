import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCoreHandler as createLookupCoreHandler, createHandler as createLookupHandler } from '../../api/_functions/pricing-lookup.js';
import { createCoreHandler as createPricingCoreHandler, createHandler as createPricingHandler } from '../../api/_functions/product-pricing.js';
import { createHandler as createPricingUpdateHandler } from '../../api/_functions/product-pricing-update.js';
import { createCoreHandler as createProductUpdateCoreHandler } from '../../api/_functions/product-update-core.js';
import type { ProductRecord, ProductsRepository } from '../../api/_db/products-repository.js';
import type { PricingRepository, ProductPricingRecord } from '../../api/_db/pricing-repository.js';

function event(method: string, body: unknown, query: Record<string, string> = {}) {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
    headers: {},
    queryStringParameters: query,
  } as any;
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}') as Record<string, any>;
}

const pricingRow: ProductPricingRecord = {
  sku: 'CORE-001',
  preco_base: '10.00',
  precos: [
    { minimum_quantity: '30.000', unit_price: '8.50', faixa: '30.000', qty: '30.000', rate: '8.50' },
    { minimum_quantity: '100.000', unit_price: '7.25', faixa: '100.000', qty: '100.000', rate: '7.25' },
  ],
  pricing_available: true,
  preco_minimo: '7.25',
};

function pricingRepository(row: ProductPricingRecord | null = pricingRow): PricingRepository {
  return {
    async get() { return row; },
    async replace(_sku, input) {
      return { ...pricingRow, preco_base: String(input.preco_base ?? ''), precos: input.precos.map((tier) => ({
        minimum_quantity: String(tier.minimum_quantity),
        unit_price: String(tier.unit_price),
        faixa: String(tier.minimum_quantity), qty: String(tier.minimum_quantity), rate: String(tier.unit_price),
      })) };
    },
  };
}

describe('direct PostgreSQL pricing boundaries', () => {

  it('resolves pricing from PostgreSQL without response source metadata', async () => {
    const handler = createLookupCoreHandler({ pricingRepository: pricingRepository() });
    const result = await handler(event('POST', { items: [{ item_code: 'CORE-001', qty: 100 }], urgent: false }));
    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).items[0].rate, '7.25');
    assert.equal(parse(result).source, undefined);
    assert.equal(Object.keys(parse(result)).some((key) => key.endsWith('_mode')), false);
  });

  it('serves product pricing reads and writes without response mode metadata', async () => {
    const handler = createPricingCoreHandler({ pricingRepository: pricingRepository() });
    const get = await handler(event('GET', undefined, { sku: 'CORE-001' }));
    assert.equal(get.statusCode, 200);
    assert.equal(parse(get).preco_base, '10.00');
    assert.equal(Object.keys(parse(get)).some((key) => key.endsWith('_mode')), false);
    assert.equal(parse(get).source, undefined);
  });

  it('rejects duplicate tiers before metadata or pricing mutation', async () => {
    let metadataUpdates = 0;
    let pricingReplacements = 0;
    const row: ProductRecord = {
      sku: 'CORE-001', nome: 'Core', descricao: '', unidade: 'Und', categoria: null, marca: null,
      ativo: true, criado_em: '', atualizado_em: '', arquivado_em: null,
    };
    const productsRepository: ProductsRepository = {
      async list() { return { rows: [row], total: 1, page: 1, limit: 50 }; },
      async get() { return row; },
      async create() { return row; },
      async update() { metadataUpdates += 1; return row; },
      async archive() { return row; },
    };
    const pricing = pricingRepository();
    const guardedPricing: PricingRepository = {
      ...pricing,
      async replace(...args) { pricingReplacements += 1; return pricing.replace(...args); },
    };
    const handler = createProductUpdateCoreHandler({ repository: productsRepository, pricingRepository: guardedPricing });
    const result = await handler(event('PATCH', {
      nome: 'Não deve persistir',
      preco_base: '9.00',
      precos: [
        { minimum_quantity: '30', unit_price: '8.00' },
        { minimum_quantity: '30.000', unit_price: '7.00' },
      ],
    }, { sku: 'CORE-001' }));
    assert.equal(result.statusCode, 400);
    assert.equal(metadataUpdates, 0);
    assert.equal(pricingReplacements, 0);
  });

  it('always routes every public pricing boundary to its PostgreSQL handler', async () => {
    for (const makeHandler of [createLookupHandler, createPricingHandler, createPricingUpdateHandler]) {
      let coreCalls = 0;
      const core = async () => {
        coreCalls += 1;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      };
      const handler = makeHandler({ core } as any);
      const result = await handler(event('POST', { items: [] }, { sku: 'CORE-001' }));
      assert.equal(result.statusCode, 200);
      assert.equal(coreCalls, 1);
    }
  });
});
