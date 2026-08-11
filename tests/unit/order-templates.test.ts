import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeOrderTemplateInput,
  OrderTemplateConflictError,
  OrderTemplateInputError,
  type OrderTemplateRecord,
  type OrderTemplateRepository,
} from '../../api/_db/order-template-repository.js';

interface MemoryProduct {
  sku: string;
  name: string;
  active: boolean;
}

class MemoryOrderTemplateRepository implements OrderTemplateRepository {
  private readonly products: MemoryProduct[];
  private readonly records: OrderTemplateRecord[] = [];

  constructor(products: MemoryProduct[]) {
    this.products = products;
  }

  async list(): Promise<OrderTemplateRecord[]> {
    return this.records.filter((record) => !record.archived).map(cloneRecord);
  }

  async get(id: string): Promise<OrderTemplateRecord | null> {
    const record = this.records.find((candidate) => candidate.id === id);
    return record ? cloneRecord(record) : null;
  }

  async getForExtraction(id: string): Promise<OrderTemplateRecord> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) throw new Error('Template de pedido não encontrado.');
    if (record.archived) throw new Error('O template de pedido selecionado foi arquivado.');
    if (
      record.items.some(
        (item) => !this.products.find((product) => product.sku === item.sku)?.active
      )
    ) {
      throw new Error('O template de pedido contém um produto arquivado.');
    }
    return cloneRecord(record);
  }

  async create(input: { name: string; skus: string[] }): Promise<{ id: string }> {
    const normalized = normalizeOrderTemplateInput(input);
    if (
      this.records.some(
        (record) =>
          !record.archived &&
          record.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase()
      )
    ) {
      throw new OrderTemplateConflictError('Já existe um template de pedido com este nome.');
    }
    assertProducts(this.products, normalized.skus);
    const id = `template-${this.records.length + 1}`;
    const now = '2026-08-11T00:00:00.000Z';
    this.records.push({
      id,
      name: normalized.name,
      archived: false,
      items: normalized.skus.map((sku, position) => ({
        sku,
        name: this.products.find((product) => product.sku === sku)!.name,
        position,
      })),
      created_at: now,
      updated_at: now,
    });
    return { id };
  }

  async update(id: string, input: { name: string; skus: string[] }): Promise<{ id: string }> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) throw new Error('Template de pedido não encontrado.');
    const normalized = normalizeOrderTemplateInput(input);
    if (
      this.records.some(
        (candidate) =>
          candidate.id !== id &&
          !candidate.archived &&
          candidate.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase()
      )
    ) {
      throw new OrderTemplateConflictError('Já existe um template de pedido com este nome.');
    }
    assertProducts(this.products, normalized.skus);
    record.name = normalized.name;
    record.items = normalized.skus.map((sku, position) => ({
      sku,
      name: this.products.find((product) => product.sku === sku)!.name,
      position,
    }));
    return { id };
  }

  async archive(id: string): Promise<{ archived: true }> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) throw new Error('Template de pedido não encontrado.');
    record.archived = true;
    return { archived: true };
  }
}

function assertProducts(products: MemoryProduct[], skus: string[]): void {
  const missing = skus.find((sku) => !products.find((product) => product.sku === sku)?.active);
  if (missing) throw new Error(`SKU inexistente ou arquivado: ${missing}.`);
}

function cloneRecord(record: OrderTemplateRecord): OrderTemplateRecord {
  return { ...record, items: record.items.map((item) => ({ ...item })) };
}

describe('order template input', () => {
  it('trims a name, preserves SKU order, and rejects duplicate SKUs', () => {
    assert.deepEqual(
      normalizeOrderTemplateInput({ name: ' Todos os lenços ', skus: [' LNC-A ', 'LNC-B'] }),
      { name: 'Todos os lenços', skus: ['LNC-A', 'LNC-B'] }
    );
    assert.throws(
      () => normalizeOrderTemplateInput({ name: 'Pack', skus: ['LNC-A', 'LNC-A'] }),
      OrderTemplateInputError
    );
  });

  it('rejects blank names and empty SKU lists', () => {
    assert.throws(
      () => normalizeOrderTemplateInput({ name: ' ', skus: ['LNC-A'] }),
      /Informe o nome do template de pedido/
    );
    assert.throws(
      () => normalizeOrderTemplateInput({ name: 'Pack', skus: [] }),
      /Adicione pelo menos um produto/
    );
  });

  it('exposes a conflict error for duplicate active names', () => {
    assert.equal(new OrderTemplateConflictError('Nome já utilizado.').statusCode, 409);
  });
});

describe('memory order template repository contract', () => {
  const products = [
    { sku: 'LNC-A', name: 'Lenço A', active: true },
    { sku: 'LNC-B', name: 'Lenço B', active: true },
    { sku: 'LNC-OLD', name: 'Lenço arquivado', active: false },
  ];

  it('creates, updates, lists, archives, and protects active names', async () => {
    const repository = new MemoryOrderTemplateRepository(products);
    const created = await repository.create({ name: 'Todos os lenços', skus: ['LNC-A', 'LNC-B'] });
    assert.equal((await repository.list())[0].items[1].sku, 'LNC-B');
    await assert.rejects(
      repository.create({ name: ' todos OS LENÇOS ', skus: ['LNC-A'] }),
      OrderTemplateConflictError
    );
    await repository.update(created.id, { name: 'Pack lenços', skus: ['LNC-B'] });
    assert.deepEqual(
      (await repository.get(created.id))?.items.map((item) => item.sku),
      ['LNC-B']
    );
    await repository.archive(created.id);
    assert.deepEqual(await repository.list(), []);
  });

  it('rejects missing and archived products', async () => {
    const repository = new MemoryOrderTemplateRepository(products);
    await assert.rejects(
      repository.create({ name: 'Ausente', skus: ['MISSING'] }),
      /SKU inexistente ou arquivado/
    );
    await assert.rejects(
      repository.create({ name: 'Arquivado', skus: ['LNC-OLD'] }),
      /SKU inexistente ou arquivado/
    );
  });

  it('rejects missing or archived templates during extraction', async () => {
    const repository = new MemoryOrderTemplateRepository(products);
    await assert.rejects(
      repository.getForExtraction('missing'),
      /Template de pedido não encontrado/
    );
    const { id } = await repository.create({ name: 'Pack', skus: ['LNC-A'] });
    await repository.archive(id);
    await assert.rejects(
      repository.getForExtraction(id),
      /template de pedido selecionado foi arquivado/
    );
  });
});
