import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommercialQueueHandler } from '../../api/_modules/commercial-queue.js';
import type {
  OpportunityActionRepository,
  OpportunityQueuePage,
} from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';

function event(
  httpMethod: string,
  query: Record<string, string> = {}
): {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string>;
  body: string;
} {
  return { httpMethod, headers: {}, queryStringParameters: query, body: '' };
}

function item(overrides: Partial<OpportunityQueuePage['data'][number]> = {}) {
  return {
    actionId: '00000000-0000-4000-8000-00000000000a',
    opportunityId: '00000000-0000-4000-8000-00000000000b',
    kind: 'first_contact' as const,
    reasonCode: 'new_lead',
    origin: 'automatic' as const,
    state: 'active' as const,
    dueAt: '2026-09-11T12:00:00.000Z',
    demandSummary: 'Cangas 100 unidades',
    contactName: 'Cliente Sintético',
    contactPhone: '5521999990000',
    contactEmail: null,
    clientId: null,
    clientName: null,
    proposals: [],
    ...overrides,
  };
}

function repository(
  overrides: Partial<OpportunityActionRepository> = {}
): OpportunityActionRepository {
  return {
    listActive: async () => ({ data: [item()], total: 1, page: 1, pageSize: 25 }),
    ...overrides,
  };
}

test('GET /api/commercial-queue returns the prioritized page in snake_case', async () => {
  const handler = createCommercialQueueHandler({ repository: repository() });
  const result = await handler(event('GET', { page: '1', page_size: '25' }));

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body || '{}');
  assert.equal(body.total, 1);
  assert.equal(body.page, 1);
  assert.equal(body.page_size, 25);

  const [row] = body.data;
  assert.equal(row.action_id, '00000000-0000-4000-8000-00000000000a');
  assert.equal(row.opportunity_id, '00000000-0000-4000-8000-00000000000b');
  assert.equal(row.kind, 'first_contact');
  assert.equal(row.reason_code, 'new_lead');
  assert.equal(row.reason_label, 'Primeiro atendimento');
  assert.equal(row.origin, 'automatic');
  assert.equal(row.state, 'active');
  assert.equal(row.due_at, '2026-09-11T12:00:00.000Z');
  assert.equal(row.demand_summary, 'Cangas 100 unidades');
  assert.equal(row.contact_name, 'Cliente Sintético');
  assert.equal(row.contact_phone, '5521999990000');
  assert.equal(row.contact_email, null);
  assert.equal(row.client_id, null);
  assert.equal(row.client_name, null);
  assert.deepEqual(row.proposals, []);
});

test('GET /api/commercial-queue exposes every linked proposal with value and state', async () => {
  const handler = createCommercialQueueHandler({
    repository: repository({
      listActive: async () => ({
        data: [
          item({
            proposals: [
              {
                quotationId: '00000000-0000-4000-8000-0000000000a1',
                businessNumber: 'ORC-20260001',
                status: 'rascunho',
                total: '250.00',
                createdAt: '2026-09-11T12:00:00.000Z',
              },
              {
                quotationId: '00000000-0000-4000-8000-0000000000b2',
                businessNumber: 'ORC-20260002',
                status: 'emitido',
                total: '310.50',
                createdAt: '2026-09-11T13:00:00.000Z',
              },
            ],
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      }),
    }),
  });
  const result = await handler(event('GET'));
  const body = JSON.parse(result.body || '{}');
  assert.deepEqual(body.data[0].proposals, [
    {
      quotation_id: '00000000-0000-4000-8000-0000000000a1',
      business_number: 'ORC-20260001',
      status: 'rascunho',
      total: '250.00',
    },
    {
      quotation_id: '00000000-0000-4000-8000-0000000000b2',
      business_number: 'ORC-20260002',
      status: 'emitido',
      total: '310.50',
    },
  ]);
});

test('GET /api/commercial-queue forwards the client context once linked', async () => {
  const handler = createCommercialQueueHandler({
    repository: repository({
      listActive: async () => ({
        data: [
          item({
            clientId: '00000000-0000-4000-8000-00000000000c',
            clientName: 'Empresa Sintética',
            contactEmail: 'synthetic@example.invalid',
          }),
        ],
        total: 1,
        page: 2,
        pageSize: 10,
      }),
    }),
  });
  const result = await handler(event('GET', { page: '2', page_size: '10' }));

  const body = JSON.parse(result.body || '{}');
  assert.equal(body.page, 2);
  assert.equal(body.page_size, 10);
  assert.equal(body.data[0].client_id, '00000000-0000-4000-8000-00000000000c');
  assert.equal(body.data[0].client_name, 'Empresa Sintética');
  assert.equal(body.data[0].contact_email, 'synthetic@example.invalid');
});

test('GET /api/commercial-queue rejects invalid pagination in Portuguese', async () => {
  const handler = createCommercialQueueHandler({ repository: repository() });
  for (const query of [{ page: '0' }, { page: 'abc' }, { page_size: '-1' }]) {
    const result = await handler(event('GET', query));
    assert.equal(result.statusCode, 400);
    assert.deepEqual(Object.keys(JSON.parse(result.body || '{}')), ['error']);
  }
});

test('GET /api/commercial-queue never leaks repository failures', async () => {
  const handler = createCommercialQueueHandler({
    repository: repository({
      listActive: async () => {
        throw new Error('relation "opportunity_next_actions" does not exist');
      },
    }),
  });
  const result = await handler(event('GET'));

  assert.equal(result.statusCode, 503);
  const raw = result.body || '';
  assert.equal(raw.includes('opportunity_next_actions'), false);
  assert.deepEqual(JSON.parse(raw), { error: 'Não foi possível carregar a fila comercial.' });
});

test('GET /api/commercial-queue rejects other methods', async () => {
  const handler = createCommercialQueueHandler({ repository: repository() });
  const result = await handler(event('POST'));
  assert.equal(result.statusCode, 405);
  assert.equal(result.headers?.Allow, 'GET');
});
