import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { FunctionEvent } from '../../api/_http/types.js';
import { createHandler } from '../../api/_modules/client-detail.js';
import { createMemoryClientRepository, type ClientRepository } from '../../api/_modules/client-repository.js';
import { ClientDuplicateError } from '../../api/_modules/client-schema.js';
import type { ClientRecord } from '../../api/_modules/client-schema.js';
import type {
  ClientCommercialRepository,
  ClientDealSummary,
  ClientOrderSummary,
  ClientQuotationSummary,
} from '../../api/_modules/client-detail.js';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

const client: ClientRecord = {
  id: CLIENT_ID,
  nome: 'Maria Cliente',
  documento: null,
  email: 'maria@example.com',
  telefone: '5511999990000',
  notes: null,
  address: null,
  arquivado: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  archivedAt: null,
};

function repository(record: ClientRecord | null): ClientRepository {
  return {
    get: async () => record,
    list: async () => ({ data: record ? [record] : [], total: record ? 1 : 0, page: 1, limit: 50 }),
    create: async () => record!,
    update: async () => record!,
    archive: async () => record!,
    delete: async () => {},
  };
}

function event(method: FunctionEvent['httpMethod'] = 'GET', body = ''): FunctionEvent {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters: { name: CLIENT_ID },
    body,
  };
}

function parse(result: { statusCode?: number; body?: string }) {
  return { statusCode: result.statusCode, body: JSON.parse(result.body || '{}') };
}

const commercial: ClientCommercialRepository = {
  latestQuotation: async () => ({
    name: 'ORC-20260001',
    status: 'aprovado',
    date: '2026-08-03',
    grand_total: '1250.00',
  } satisfies ClientQuotationSummary),
  activeDeal: async () => ({
    name: 'Maria Cliente',
    status: 'Em Negociacao',
    next_step: 'Ligar amanhã',
  } satisfies ClientDealSummary),
  orders: async () => [
    {
      name: 'PED-2026-0001',
      status: 'To Deliver and Bill',
      date: '2026-08-04',
      grand_total: '900.00',
    } satisfies ClientOrderSummary,
  ],
};

describe('client-detail HTTP contract', () => {
  it('permanently deletes a client and reports not found on repeated deletion', async () => {
    const repo = createMemoryClientRepository({ initial: [client] });
    const handler = createHandler({ repository: repo, commercial });
    assert.equal((await handler(event('DELETE'))).statusCode, 200);
    assert.equal(await repo.get(CLIENT_ID), null);
    assert.equal((await handler(event('DELETE'))).statusCode, 404);
  });

  it('returns a safe conflict for linked clients', async () => {
    const repo = repository(client);
    repo.delete = async () => { throw new ClientDuplicateError('Cliente com histórico vinculado.'); };
    const response = parse(await createHandler({ repository: repo, commercial })(event('DELETE')));
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error, 'Cliente com histórico vinculado.');
  });
  it('returns UUID-scoped latest quotation, active deal, and orders', async () => {
    const response = parse(await createHandler({ repository: repository(client), commercial })(event()));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.latest_quotation, {
      name: 'ORC-20260001',
      status: 'aprovado',
      date: '2026-08-03',
      grand_total: '1250.00',
    });
    assert.deepEqual(response.body.deal, {
      name: 'Maria Cliente',
      status: 'Em Negociacao',
      next_step: 'Ligar amanhã',
    });
    assert.deepEqual(response.body.orders, [
      {
        name: 'PED-2026-0001',
        status: 'To Deliver and Bill',
        date: '2026-08-04',
        grand_total: '900.00',
      },
    ]);
    assert.equal(Object.hasOwn(response.body, 'quote'), false);
  });

  it('returns an empty commercial context without inventing objects', async () => {
    const empty: ClientCommercialRepository = {
      latestQuotation: async () => null,
      activeDeal: async () => null,
      orders: async () => [],
    };
    const response = parse(await createHandler({ repository: repository(client), commercial: empty })(event()));

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.latest_quotation, null);
    assert.equal(response.body.deal, null);
    assert.deepEqual(response.body.orders, []);
    assert.equal(Object.hasOwn(response.body, 'quote'), false);
  });

  it('keeps PATCH focused on client fields and ignores commercial payload fields', async () => {
    let received: Record<string, unknown> | undefined;
    const repo = repository(client);
    repo.update = async (_id, patch) => {
      received = patch as Record<string, unknown>;
      return client;
    };
    const response = parse(
      await createHandler({ repository: repo, commercial })(
        event('PATCH', JSON.stringify({ nome: 'Outro nome', latest_quotation: { name: 'fake' } }))
      )
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(received, { nome: 'Outro nome' });
    assert.equal(Object.hasOwn(response.body, 'quote'), false);
  });
});
