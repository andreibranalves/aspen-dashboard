import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../api/_functions/whatsapp-send-status.js';

const revisionId = 'revision-status';
const flowId = 'flow-status';
const now = new Date('2026-08-17T12:00:00.000Z');

function event(method: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
    queryStringParameters: query,
  } as any;
}

function delivery(state = 'provider_accepted') {
  return {
    id: 'delivery-status',
    revisionId,
    businessNumber: 'ORC-STATUS',
    clientName: 'Cliente',
    phone: '5511999990000',
    flowId,
    flowName: 'Fluxo',
    state,
    completionSource: null,
    publicError: null,
    nextAttemptAt: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
    steps: [],
  } as any;
}

function moduleFixture() {
  const calls: Array<{ method: string; input: unknown }> = [];
  const current = delivery();
  return {
    calls,
    deliveryModule: {
      async get(input: unknown) {
        calls.push({ method: 'get', input });
        return current;
      },
      async resolve(input: unknown) {
        calls.push({ method: 'resolve', input });
        return { ...current, state: 'delivered' };
      },
    } as any,
  };
}

test('GET projects durable PostgreSQL status by revision and flow', async () => {
  const { deliveryModule, calls } = moduleFixture();
  const response = await handler(event('GET', {}, {
    quotation_uuid: 'legacy-quotation',
    revision_id: revisionId,
    flow_id: flowId,
  }), { deliveryModule });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body || '{}'), {
    delivery_id: 'delivery-status',
    revision_id: revisionId,
    flow_id: flowId,
    phase: 'provider_accepted',
    error: null,
    updated_at: now.toISOString(),
  });
  assert.deepEqual(calls[0], {
    method: 'get',
    input: { identity: { revisionId, flowId } },
  });
});

test('PATCH delegates resolution with fixed server operator identity', async () => {
  const { deliveryModule, calls } = moduleFixture();
  const response = await handler(event('PATCH', {
    revision_id: revisionId,
    flow_id: flowId,
    decision: 'confirmed_received',
    note: 'Cliente confirmou recebimento.',
    resolved_by: 'forged-user',
  }), { deliveryModule });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body || '{}').phase, 'delivered');
  assert.deepEqual(calls.find((call) => call.method === 'resolve')?.input, {
    deliveryId: 'delivery-status',
    decision: 'confirmed_received',
    note: 'Cliente confirmou recebimento.',
    resolvedBy: 'authenticated-operator',
  });
});

test('status validates method and malformed resolution', async () => {
  const { deliveryModule } = moduleFixture();
  assert.equal((await handler(event('PUT'), { deliveryModule })).statusCode, 405);
  assert.equal((await handler(event('PATCH', { revision_id: revisionId, flow_id: flowId }), { deliveryModule })).statusCode, 400);
  assert.equal((await handler(event('PATCH', { revision_id: revisionId, flow_id: flowId, decision: 'invalid', note: 'ok' }), { deliveryModule })).statusCode, 400);
});

test('status errors are sanitized', async () => {
  const response = await handler(event('GET', {}, { revision_id: revisionId, flow_id: flowId }), {
    deliveryModule: {
      async get() { throw new Error('database password and provider token'); },
    } as any,
  });
  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body || '', /database password|provider token/i);
});
