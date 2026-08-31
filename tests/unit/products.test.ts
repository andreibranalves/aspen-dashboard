import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHandler as createProductsBoundary } from '../../api/_modules/products.js';
import { createHandler as createDetailBoundary } from '../../api/_modules/product-detail.js';
import { createHandler as createUpdateBoundary } from '../../api/_modules/product-update.js';
import { createCoreHandler as createProductsCore } from '../../api/_modules/products-core.js';
import { createCoreHandler as createDetailCore } from '../../api/_modules/product-detail-core.js';
import { createCoreHandler as createUpdateCore } from '../../api/_modules/product-update-core.js';
import type {
  ProductCreateInput,
  ProductListOptions,
  ProductRecord,
  ProductUpdateInput,
  ProductStatus,
  ProductsRepository,
} from '../../api/_infrastructure/db/repositories/products-repository.js';
import {
  isDuplicateProductError,
  normalizeProductUpdateInput,
  ProductRepositoryError,
} from '../../api/_infrastructure/db/repositories/products-repository.js';

function event(method: string, body?: unknown, query: Record<string, string> = {}) {
  return {
    httpMethod: method,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {},
    queryStringParameters: query,
  } as any;
}

function parse(result: { body?: string }): any {
  return JSON.parse(result.body || '{}');
}

class MemoryProductsRepository implements ProductsRepository {
  private rows: ProductRecord[] = [];
  private now = 0;

  async list(options: ProductListOptions = {}) {
    const status: ProductStatus = options.status || 'active';
    let rows = this.rows.filter((row) =>
      status === 'all' || (status === 'active' ? row.ativo : !row.ativo)
    );
    if (options.categoria) rows = rows.filter((row) => row.categoria === options.categoria);
    if (options.search) {
      const term = options.search.toLowerCase();
      rows = rows.filter(
        (row) => row.sku.toLowerCase().includes(term) || row.nome.toLowerCase().includes(term)
      );
    }
    const order = (options.orderBy || 'modified desc').toLowerCase();
    rows = [...rows].sort((a, b) => {
      if (order.startsWith('item_name') || order.startsWith('nome')) return a.nome.localeCompare(b.nome);
      if (order.startsWith('item_code') || order.startsWith('sku')) return a.sku.localeCompare(b.sku);
      return b.atualizado_em.localeCompare(a.atualizado_em);
    });
    const page = options.page || 1;
    const limit = options.limit || 50;
    return { rows: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
  }

  async get(sku: string) {
    return this.rows.find((row) => row.sku === sku.trim()) || null;
  }

  async create(input: ProductCreateInput) {
    const sku = input.sku.trim();
    if (this.rows.some((row) => row.sku === sku)) {
      const error = Object.assign(new Error('SKU já cadastrado.'), { statusCode: 409 });
      throw error;
    }
    const now = `2026-01-01T00:00:0${this.now++}.000Z`;
    const row: ProductRecord = {
      sku,
      nome: input.nome.trim(),
      descricao: (input.descricao || '').trim(),
      unidade: (input.unidade || 'Und').trim() || 'Und',
      categoria: input.categoria || null,
      marca: input.marca || null,
      ativo: true,
      criado_em: now,
      atualizado_em: now,
      arquivado_em: null,
    };
    this.rows.push(row);
    return row;
  }

  async update(sku: string, patch: ProductUpdateInput) {
    const row = await this.get(sku);
    if (!row) return null;
    Object.assign(row, patch);
    if (patch.ativo === false) row.arquivado_em = new Date().toISOString();
    if (patch.ativo === true) row.arquivado_em = null;
    row.atualizado_em = new Date().toISOString();
    return row;
  }

  async archive(sku: string) {
    const row = await this.get(sku);
    if (!row) return null;
    if (row.ativo) await this.update(sku, { ativo: false });
    return row;
  }
}

describe('products direct PostgreSQL boundaries', () => {
  it('delegates to the PostgreSQL handler', async () => {
    let calls = 0;
    const handler = createProductsBoundary({
      core: async (request: any) => {
        calls += 1;
        return { statusCode: 200, body: JSON.stringify({ method: request.httpMethod }) };
      },
    });
    const result = await handler(event('GET'));
    assert.equal(result.statusCode, 200);
    assert.equal(calls, 1);
  });

  it('updates an empty product description through the only product handler', async () => {
    const repository = new MemoryProductsRepository();
    const products = createProductsCore({ repository });
    await products(event('POST', { sku: 'SKU-1', nome: 'Alpha', descricao: 'Original' }));
    const handler = createUpdateBoundary({
      core: createUpdateCore({ repository }),
    });
    const result = await handler(event('PATCH', { descricao: '' }, { sku: 'SKU-1' }));
    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).produto.descricao, '');
  });

  it('serves product details through the PostgreSQL boundary without metadata', async () => {
    const repository = new MemoryProductsRepository();
    const products = createProductsCore({ repository });
    await products(event('POST', { sku: 'SKU-1', nome: 'Alpha' }));
    const handler = createDetailBoundary({
      core: createDetailCore({ repository }),
    });
    const result = await handler(event('GET', undefined, { sku: 'SKU-1' }));
    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).produto.sku, 'SKU-1');
    assert.equal(Object.keys(parse(result)).some((key) => key.endsWith('_mode')), false);
    assert.equal(parse(result).source, undefined);
  });
});

describe('products repository duplicate classification', () => {
  it('follows Drizzle Error.cause to classify a PostgreSQL duplicate safely', () => {
    const nested = {
      message: 'Failed query: insert into products …',
      cause: {
        code: '23505',
        constraint_name: 'products_pkey',
        detail: 'Key (sku)=(CORE-001) already exists.',
      },
    };

    assert.equal(isDuplicateProductError(nested), true);
    assert.equal(isDuplicateProductError({ cause: { code: '42P01' } }), false);
  });
});

describe('products core handlers', () => {
  it('lists product categories for media selection', async () => {
    const repository = new MemoryProductsRepository();
    const products = createProductsCore({
      repository,
      listCategories: async () => ['Boné', 'Canga personalizada'],
    } as any);

    const result = await products(event('GET', undefined, { view: 'categories' }));

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parse(result).categories, ['Boné', 'Canga personalizada']);
  });

  it('creates, searches, paginates, archives/restores, and protects pricing/deletes', async () => {
    const repository = new MemoryProductsRepository();
    const products = createProductsCore({ repository });
    const detail = createDetailCore({ repository });
    const update = createUpdateCore({ repository });

    const first = await products(event('POST', { sku: ' SKU-1 ', nome: 'Alpha', categoria: 'A' }));
    assert.equal(first.statusCode, 201);
    assert.equal(parse(first).produto.sku, 'SKU-1');
    assert.equal(parse(first).produto.unidade, 'Und');
    assert.equal(Object.keys(parse(first)).some((key) => key.endsWith('_mode')), false);
    assert.equal(parse(first).source, undefined);

    const second = await products(event('POST', { sku: 'SKU-2', nome: 'Beta', categoria: 'B' }));
    assert.equal(second.statusCode, 201);
    assert.equal((await products(event('GET', undefined, { search: 'alp', limit: '1' }))).statusCode, 200);
    const listed = parse(await products(event('GET', undefined, { search: 'alp', limit: '1' })));
    assert.equal(listed.data[0].sku, 'SKU-1');
    assert.equal(listed.data[0].preco_minimo, null);
    assert.equal(listed.data[0].pricing_available, false);
    assert.equal(listed.pagination.total, 1);

    const duplicate = await products(event('POST', { sku: 'SKU-1', nome: 'Duplicado' }));
    assert.equal(duplicate.statusCode, 409);

    const archived = await products(event('DELETE', undefined, { id: 'SKU-1' }));
    assert.equal(archived.statusCode, 200);
    assert.equal(parse(archived).archived, true);
    assert.equal(parse(await detail(event('GET', undefined, { sku: 'SKU-1' }))).produto.ativo, false);
    assert.equal(parse(await products(event('GET'))).data.length, 1);
    assert.equal(parse(await products(event('GET', undefined, { status: 'archived' }))).data.length, 1);

    const restored = await update(event('PATCH', { ativo: true, nome: 'Alpha atualizado' }, { sku: 'SKU-1' }));
    assert.equal(restored.statusCode, 200);
    assert.equal(parse(restored).produto.nome, 'Alpha atualizado');

    const pricing = await update(event('PATCH', { precos: [] }, { sku: 'SKU-1' }));
    assert.equal(pricing.statusCode, 409);
    const hard = await products(event('DELETE', undefined, { id: 'SKU-1', permanent: 'true' }));
    assert.equal(hard.statusCode, 409);
    assert.equal((await products(event('DELETE', undefined, { id: 'missing' }))).statusCode, 404);
  });
});

describe('product unit cost', () => {
  it('accepts Brazilian comma for custo unitário', () => {
    assert.equal(normalizeProductUpdateInput({ custo_unitario: '12,5' }).custo_unitario, '12.50');
    assert.equal(normalizeProductUpdateInput({ custo_unitario: '12.50' }).custo_unitario, '12.50');
    assert.equal(normalizeProductUpdateInput({ custo_unitario: '' }).custo_unitario, null);
    assert.throws(
      () => normalizeProductUpdateInput({ custo_unitario: 'abc' }),
      (error: unknown) => error instanceof ProductRepositoryError && (error as ProductRepositoryError).statusCode === 400
    );
  });
});
