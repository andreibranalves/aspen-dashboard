import assert from 'node:assert/strict';
import test from 'node:test';

import type { FunctionEvent } from '../../api/_http/types.js';
import {
  createCommunicationSendEventsHandler,
  type CommunicationSendEventsList,
} from '../../api/_modules/communication-send-events.js';
import type { DeliveryAggregate } from '../../api/_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';

const createdAt = new Date('2026-08-31T10:00:00.000Z');

function delivery(
  overrides: Partial<DeliveryAggregate> & Pick<DeliveryAggregate, 'id' | 'state'>,
): DeliveryAggregate {
  return {
    id: overrides.id,
    revisionId: 'revision-1',
    businessNumber: 'ORC-20260001',
    clientName: 'Cliente',
    phone: '5511999999999',
    flowId: 'flow-1',
    flowName: 'Fluxo comercial',
    state: overrides.state,
    completionSource: null,
    publicError: null,
    nextAttemptAt: null,
    actionDeadline: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt,
    updatedAt: createdAt,
    steps: [
      {
        id: `${overrides.id}-step-1`,
        position: 0,
        type: 'text',
        state: overrides.state === 'delivered' ? 'delivered' : overrides.state === 'failed' ? 'failed' : 'queued',
        attemptCount: 1,
        publicError: overrides.state === 'failed' ? 'Falha no provedor.' : null,
        nextAttemptAt: null,
        acceptedAt: null,
        deliveredAt: overrides.state === 'delivered' ? createdAt : null,
        readAt: null,
        updatedAt: createdAt,
      },
      {
        id: `${overrides.id}-step-2`,
        position: 1,
        type: 'text',
        state: overrides.state === 'delivered' ? 'read' : overrides.state === 'failed' ? 'failed' : 'queued',
        attemptCount: 1,
        publicError: overrides.state === 'failed' ? 'Falha no provedor.' : null,
        nextAttemptAt: null,
        acceptedAt: null,
        deliveredAt: overrides.state === 'delivered' ? createdAt : null,
        readAt: overrides.state === 'delivered' ? createdAt : null,
        updatedAt: createdAt,
      },
    ],
    ...overrides,
  };
}

function event(method: string, queryStringParameters: Record<string, string | undefined> = {}): FunctionEvent {
  return { httpMethod: method, headers: {}, queryStringParameters, body: '' };
}

function parse(result: { body?: string }): Record<string, unknown> {
  return JSON.parse(result.body || '{}') as Record<string, unknown>;
}

test('lists mixed outbox states using the historical item shape and newest first', async () => {
  const deliveries = [
    delivery({ id: 'queued', state: 'queued', createdAt: new Date('2026-08-31T12:00:00.000Z') }),
    delivery({ id: 'failed', state: 'failed', publicError: 'Número inválido.', createdAt: new Date('2026-08-31T11:00:00.000Z') }),
    delivery({ id: 'sent', state: 'delivered', deliveredAt: new Date('2026-08-31T10:00:00.000Z'), createdAt }),
  ];
  const list: CommunicationSendEventsList = async () => ({
    data: deliveries,
    total: deliveries.length,
    summary: { active: 1, requiresAction: 0, retryScheduled: 0, delayed: 0, deliveredLast24Hours: 1 },
  });

  const response = await createCommunicationSendEventsHandler({ list })(event('GET'));
  const body = parse(response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual((body.items as Array<Record<string, unknown>>).map((item) => [item.id, item.status]), [
    ['queued', 'pending'],
    ['failed', 'failed'],
    ['sent', 'sent'],
  ]);
  assert.equal((body.items as Array<Record<string, unknown>>)[1]?.error_message, 'Número inválido.');
  assert.equal((body.items as Array<Record<string, unknown>>)[0]?.steps_sent, 0);
  assert.equal((body.items as Array<Record<string, unknown>>)[0]?.steps_planned, 2);
});

test('returns an empty successful response without reading KV', async () => {
  let calls = 0;
  const response = await createCommunicationSendEventsHandler({
    list: async () => {
      calls += 1;
      return { data: [], total: 0, summary: { active: 0, requiresAction: 0, retryScheduled: 0, delayed: 0, deliveredLast24Hours: 0 } };
    },
  })(event('GET'));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(parse(response), { success: true, items: [], total: 0, source: 'postgres' });
  assert.equal(calls, 1);
});

test('applies quotation, phone, flow, status and capped limit filters', async () => {
  const deliveries = [
    delivery({ id: 'match', state: 'provider_accepted', businessNumber: 'ORC-20260002', phone: '5511888888888', flowId: 'flow-2' }),
    delivery({ id: 'other', state: 'failed', businessNumber: 'ORC-20260003', phone: '5511777777777', flowId: 'flow-3' }),
  ];
  let received: unknown;
  const response = await createCommunicationSendEventsHandler({
    list: async (filters) => {
      received = filters;
      return { data: deliveries, total: deliveries.length, summary: { active: 1, requiresAction: 0, retryScheduled: 0, delayed: 0, deliveredLast24Hours: 0 } };
    },
  })(event('GET', {
    quotation_id: 'ORC-20260002',
    phone: '5511888888888',
    flow_id: 'flow-2',
    status: 'pending',
    limit: '999',
  }));
  const body = parse(response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual((body.items as Array<Record<string, unknown>>).map((item) => item.id), ['match']);
  assert.equal((received as { pageSize: number }).pageSize, 100);
  assert.deepEqual((received as { states: string[] }).states, [
    'queued', 'processing', 'provider_accepted', 'reconciling', 'retry_scheduled', 'needs_review',
  ]);
});

test('defaults to 50 rows and caps the request at 200 rows', async () => {
  const deliveries = Array.from({ length: 205 }, (_, index) =>
    delivery({
      id: `delivery-${String(index).padStart(3, '0')}`,
      state: 'queued',
      createdAt: new Date(createdAt.getTime() + index * 1_000),
    }),
  );
  const list: CommunicationSendEventsList = async (filters) => ({
    data: deliveries.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize),
    total: deliveries.length,
    summary: { active: deliveries.length, requiresAction: 0, retryScheduled: 0, delayed: 0, deliveredLast24Hours: 0 },
  });
  const handler = createCommunicationSendEventsHandler({ list });

  const defaultResponse = await handler(event('GET'));
  assert.equal((parse(defaultResponse).items as unknown[]).length, 50);
  const cappedResponse = await handler(event('GET', { limit: '999' }));
  assert.equal((parse(cappedResponse).items as unknown[]).length, 200);
});

test('keeps POST unsupported', async () => {
  const response = await createCommunicationSendEventsHandler({ list: async () => { throw new Error('must not list'); } })(event('POST'));
  assert.equal(response.statusCode, 405);
  assert.deepEqual(parse(response), { error: 'Método não permitido.' });
});
