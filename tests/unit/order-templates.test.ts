import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createOrderTemplateRepository,
  normalizeOrderTemplateInput,
  OrderTemplateConflictError,
  OrderTemplateInputError,
  OrderTemplateNotFoundError,
  OrderTemplateRepositoryError,
  type OrderTemplateRecord,
  type OrderTemplateRepository,
} from '../../api/_db/order-template-repository.js';
import { createOrderTemplatesHandler } from '../../api/_functions/order-templates.js';

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
    if (record.archived) {
      throw new OrderTemplateConflictError(
        'Não é possível editar um template de pedido arquivado.'
      );
    }
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

  it('rejects updates and extraction for archived templates', async () => {
    const repository = new MemoryOrderTemplateRepository(products);
    await assert.rejects(
      repository.getForExtraction('missing'),
      /Template de pedido não encontrado/
    );
    const { id } = await repository.create({ name: 'Pack', skus: ['LNC-A'] });
    await repository.archive(id);
    await assert.rejects(
      repository.update(id, { name: 'Pack alterado', skus: ['LNC-B'] }),
      (error: unknown) =>
        error instanceof OrderTemplateConflictError &&
        error.statusCode === 409 &&
        /template de pedido arquivado/.test(error.message)
    );
    await assert.rejects(
      repository.getForExtraction(id),
      /template de pedido selecionado foi arquivado/
    );
  });
});

function event(method: string, query: Record<string, string> = {}, body?: unknown) {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters: query,
    body: body === undefined ? '' : JSON.stringify(body),
    url: '/api/order-templates',
  };
}

function parseBody(result: { body?: string }): Record<string, unknown> {
  return JSON.parse(result.body || '{}') as Record<string, unknown>;
}

describe('PostgreSQL order template repository', () => {
  it('rejects an archived template before replacing its items', async () => {
    const archivedTemplate = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Pack arquivado',
      archived: true,
      createdAt: new Date('2026-08-11T00:00:00.000Z'),
      updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    };
    const transaction = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({ limit: async () => [archivedTemplate] }),
          }),
        }),
      }),
    };
    const repository = createOrderTemplateRepository(
      () =>
        ({
          transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        }) as never
    );

    await assert.rejects(
      repository.update(archivedTemplate.id, { name: 'Pack alterado', skus: ['LNC-A'] }),
      (error: unknown) =>
        error instanceof OrderTemplateConflictError &&
        error.statusCode === 409 &&
        /template de pedido arquivado/.test(error.message)
    );
  });
});

describe('order templates HTTP handler', () => {
  it('routes GET, POST, PUT, and DELETE through the repository', async () => {
    const calls: Array<{ method: string; value: unknown }> = [];
    const repository: OrderTemplateRepository = {
      list: async () => {
        calls.push({ method: 'list', value: undefined });
        return [];
      },
      get: async () => null,
      getForExtraction: async () => {
        throw new Error('not used');
      },
      create: async (input) => {
        calls.push({ method: 'create', value: input });
        return { id: 'template-id' };
      },
      update: async (id, input) => {
        calls.push({ method: 'update', value: { id, input } });
        return { id };
      },
      archive: async (id) => {
        calls.push({ method: 'archive', value: id });
        return { archived: true };
      },
    };
    const handler = createOrderTemplatesHandler({ repository });

    const listed = await handler(event('GET'));
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.headers?.['Content-Type'], 'application/json; charset=utf-8');
    assert.deepEqual(parseBody(listed), { data: [] });

    const created = await handler(event('POST', {}, { name: 'Pack', skus: ['LNC-A', 7] }));
    assert.equal(created.statusCode, 201);
    assert.deepEqual(parseBody(created), { id: 'template-id' });

    const updated = await handler(
      event('PUT', { id: 'template-id' }, { name: 'Pack atualizado', skus: ['LNC-B'] })
    );
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(parseBody(updated), { id: 'template-id' });

    const archived = await handler(event('DELETE', { id: 'template-id' }));
    assert.equal(archived.statusCode, 200);
    assert.deepEqual(parseBody(archived), { archived: true });

    assert.deepEqual(calls, [
      { method: 'list', value: undefined },
      { method: 'create', value: { name: 'Pack', skus: ['LNC-A', '7'] } },
      {
        method: 'update',
        value: { id: 'template-id', input: { name: 'Pack atualizado', skus: ['LNC-B'] } },
      },
      { method: 'archive', value: 'template-id' },
    ]);
  });

  it('rejects malformed bodies, missing IDs, and unsupported methods', async () => {
    const repository: OrderTemplateRepository = {
      list: async () => [],
      get: async () => null,
      getForExtraction: async () => {
        throw new Error('not used');
      },
      create: async () => ({ id: 'template-id' }),
      update: async (id) => ({ id }),
      archive: async () => ({ archived: true }),
    };
    const handler = createOrderTemplatesHandler({ repository });

    assert.equal((await handler({ ...event('POST'), body: '{' })).statusCode, 400);
    assert.equal(
      (await handler(event('PUT', {}, { name: 'Pack', skus: ['LNC-A'] }))).statusCode,
      400
    );
    assert.equal((await handler(event('DELETE'))).statusCode, 400);
    assert.equal((await handler(event('PATCH'))).statusCode, 405);
  });

  it('preserves public repository statuses and hides infrastructure errors', async () => {
    const publicErrors: Array<Error> = [
      new OrderTemplateInputError('Dados inválidos.'),
      new OrderTemplateNotFoundError('Template ausente.'),
      new OrderTemplateConflictError('Nome duplicado.'),
    ];
    for (const error of publicErrors) {
      const repository: OrderTemplateRepository = {
        list: async () => {
          throw error;
        },
        get: async () => null,
        getForExtraction: async () => {
          throw error;
        },
        create: async () => ({ id: 'template-id' }),
        update: async (id) => ({ id }),
        archive: async () => ({ archived: true }),
      };
      const response = await createOrderTemplatesHandler({ repository })(event('GET'));
      assert.equal(response.statusCode, error.statusCode);
      assert.deepEqual(parseBody(response), { error: error.message });
    }

    const previousConsoleError = console.error;
    let logged = false;
    console.error = () => {
      logged = true;
    };
    try {
      const response = await createOrderTemplatesHandler({
        repository: {
          list: async () => {
            throw new OrderTemplateRepositoryError('database details must stay private');
          },
          get: async () => null,
          getForExtraction: async () => {
            throw new Error('not used');
          },
          create: async () => ({ id: 'template-id' }),
          update: async (id) => ({ id }),
          archive: async () => ({ archived: true }),
        },
      })(event('GET'));
      assert.equal(response.statusCode, 503);
      assert.deepEqual(parseBody(response), {
        error: 'Não foi possível processar os templates de pedido. Tente novamente.',
      });
      assert.equal(logged, true);
    } finally {
      console.error = previousConsoleError;
    }
  });
});
