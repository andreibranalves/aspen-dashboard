import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommercialQueueHandler } from '../../api/_modules/commercial-queue.js';
import type {
  OpportunityActionRepository,
  OpportunityQueuePage,
} from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';

const resultActionId = '00000000-0000-4000-8000-00000000000a';
const resultOpportunityId = '00000000-0000-4000-8000-00000000000b';

function event(
  httpMethod: string,
  query: Record<string, string> = {},
  body: Record<string, unknown> = {}
): {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string>;
  body: string;
} {
  return { httpMethod, headers: {}, queryStringParameters: query, body: JSON.stringify(body) };
}

function item(overrides: Partial<OpportunityQueuePage['data'][number]> = {}) {
  return {
    actionId: '00000000-0000-4000-8000-00000000000a',
    opportunityId: '00000000-0000-4000-8000-00000000000b',
    kind: 'first_contact' as const,
    kindLabel: 'Primeiro contato',
    reasonCode: 'new_lead',
    reason: 'Primeiro atendimento',
    origin: 'automatic' as const,
    state: 'active' as const,
    dueAt: '2026-09-11T12:00:00.000Z',
    dueDate: '2026-09-11',
    dueTime: '09:00',
    scheduleType: 'timed' as const,
    dueStatus: 'overdue' as const,
    version: 1,
    actor: 'system',
    isUrgent: false,
    priority: 4,
    opportunityStatus: 'Novo Lead',
    terminalStatus: null,
    terminalReason: null,
    terminalAt: null,
    contactContext: {
      status: 'unavailable' as const,
      lastContactAt: null,
      lastContactDirection: null,
      blockers: [],
    },
    whatsappHref: 'https://wa.me/5521999990000',
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
    setUrgency: async () => ({
      opportunityId: resultOpportunityId,
      actionId: resultActionId,
      version: 1,
      isUrgent: false,
    }),
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
  assert.equal(row.kind_label, 'Primeiro contato');
  assert.equal(row.reason_code, 'new_lead');
  assert.equal(row.reason_label, 'Primeiro atendimento');
  assert.equal(row.reason, 'Primeiro atendimento');
  assert.equal(row.origin, 'automatic');
  assert.equal(row.state, 'active');
  assert.equal(row.due_at, '2026-09-11T12:00:00.000Z');
  assert.equal(row.due_date, '2026-09-11');
  assert.equal(row.due_time, '09:00');
  assert.equal(row.schedule_type, 'timed');
  assert.equal(row.due_status, 'overdue');
  assert.equal(row.version, 1);
  assert.equal(row.actor, 'system');
  assert.equal(row.terminal_status, null);
  assert.equal(row.terminal_reason, null);
  assert.equal(row.terminal_at, null);
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
  const result = await handler(event('PUT'));
  assert.equal(result.statusCode, 405);
  assert.equal(result.headers?.Allow, 'GET, POST');
});

test('GET /api/commercial-queue forwards the cut and exposes queue context', async () => {
  let received: Record<string, unknown> | undefined;
  const handler = createCommercialQueueHandler({
    repository: repository({
      listActive: async (options) => {
        received = options as unknown as Record<string, unknown>;
        return { data: [item()], total: 1, page: 1, pageSize: 25 };
      },
    }),
  });
  const result = await handler(event('GET', { filter: 'overdue', page: '1', page_size: '25' }));

  assert.equal(result.statusCode, 200);
  assert.equal(received?.filter, 'overdue');
  const row = JSON.parse(result.body || '{}').data[0];
  assert.equal(row.is_urgent, false);
  assert.equal(row.priority, 4);
  assert.deepEqual(row.contact_context, {
    status: 'unavailable',
    last_contact_at: null,
    last_contact_direction: null,
    blockers: [],
  });
  assert.equal(row.whatsapp_href, 'https://wa.me/5521999990000');
});

test('GET /api/commercial-queue keeps terminal context separate from action reason', async () => {
  const handler = createCommercialQueueHandler({
    repository: repository({
      listActive: async () => ({
        data: [
          item({
            state: 'active',
            dueStatus: 'closed',
            opportunityStatus: 'Perdido',
            terminalStatus: 'Perdido',
            terminalReason: 'Cliente escolheu outro fornecedor',
            terminalAt: '2026-09-11T14:00:00.000Z',
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      }),
    }),
  });
  const result = await handler(event('GET', { filter: 'closed' }));
  const row = JSON.parse(result.body || '{}').data[0];

  assert.equal(row.state, 'active');
  assert.equal(row.reason, 'Primeiro atendimento');
  assert.equal(row.terminal_status, 'Perdido');
  assert.equal(row.terminal_reason, 'Cliente escolheu outro fornecedor');
  assert.equal(row.terminal_at, '2026-09-11T14:00:00.000Z');
});

test('POST /api/commercial-queue encaminha a urgência do negócio com token da ação', async () => {
  let received: Record<string, unknown> | undefined;
  const handler = createCommercialQueueHandler({
    repository: repository({
      setUrgency: async (input) => {
        received = input as unknown as Record<string, unknown>;
        return {
          opportunityId: resultOpportunityId,
          actionId: resultActionId,
          version: 2,
          isUrgent: true,
        };
      },
    }),
  });
  const response = await handler(
    event('POST', {}, {
      command: 'set_urgency',
      opportunity_id: resultOpportunityId,
      action_id: resultActionId,
      expected_version: 1,
      is_urgent: true,
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal(received?.opportunityId, resultOpportunityId);
  assert.equal(received?.actionId, resultActionId);
  assert.equal(received?.expectedVersion, 1);
  assert.equal(received?.isUrgent, true);
  assert.deepEqual(JSON.parse(response.body || '{}'), {
    opportunity_id: resultOpportunityId,
    action_id: resultActionId,
    version: 2,
    is_urgent: true,
  });
});
