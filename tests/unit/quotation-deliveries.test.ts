import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handler as quotationDeliveries,
  toPublicDeliveryView,
} from '../../api/_modules/quotation-deliveries.js';
import { handler as sendWhatsappFlow } from '../../api/_modules/send-whatsapp-flow.js';
import { handler as whatsappSendStatus } from '../../api/_modules/whatsapp-send-status.js';

const now = new Date('2026-08-17T12:00:00.000Z');

function event(httpMethod: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  return {
    httpMethod,
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    queryStringParameters: query,
    body: JSON.stringify(body),
  } as any;
}

function aggregate(state = 'provider_accepted') {
  return {
    id: 'delivery-1',
    revisionId: 'revision-1',
    businessNumber: 'ORC-20260001',
    clientName: 'Cliente Teste',
    phone: '5511999990000',
    flowId: 'flow-1',
    flowName: 'Fluxo teste',
    state,
    completionSource: null,
    publicError: null,
    nextAttemptAt: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: 'step-1',
        position: 0,
        type: 'text',
        state: 'server_ack',
        attemptCount: 1,
        publicError: null,
        nextAttemptAt: null,
        acceptedAt: now,
        deliveredAt: null,
        readAt: null,
        updatedAt: now,
        providerMessageId: 'provider-secret',
        payloadSnapshot: { text: 'private payload' },
      },
      {
        id: 'step-2',
        position: 1,
        type: 'quotation_pdf',
        state: 'queued',
        attemptCount: 0,
        publicError: null,
        nextAttemptAt: now,
        acceptedAt: null,
        deliveredAt: null,
        readAt: null,
        updatedAt: now,
      },
    ],
  } as any;
}

function moduleFixture(state = 'provider_accepted') {
  const calls: Array<{ method: string; input: unknown }> = [];
  const current = aggregate(state);
  const deliveryModule = {
    async enqueue(input: unknown) {
      calls.push({ method: 'enqueue', input });
      return current;
    },
    async get(input: unknown) {
      calls.push({ method: 'get', input });
      return current;
    },
    async list(input: unknown) {
      calls.push({ method: 'list', input });
      return {
        data: [current],
        total: 1,
        summary: {
          active: 1,
          requiresAction: 2,
          retryScheduled: 3,
          delayed: 4,
          deliveredLast24Hours: 5,
        },
      };
    },
    async resolve(input: unknown) {
      calls.push({ method: 'resolve', input });
      return { ...current, state: 'delivered' };
    },
    async cancelPending() {
      calls.push({ method: 'cancelPending', input: undefined });
      return 3;
    },
  } as any;
  return { deliveryModule, calls };
}

test('POST send returns durable state and omits recipient/provider details', async () => {
  const { deliveryModule, calls } = moduleFixture();
  const result = await sendWhatsappFlow(
    event('POST', {
      quotation_id: 'quotation-1',
      revision_id: 'revision-1',
      flow_id: 'flow-1',
    }),
    { deliveryModule },
  );
  const body = JSON.parse(result.body || '{}');
  assert.equal(result.statusCode, 202);
  assert.equal(body.success, true);
  assert.equal(body.delivery_id, 'delivery-1');
  assert.equal(body.send_status, 'provider_accepted');
  assert.equal(body.delivery.state, 'provider_accepted');
  assert.equal(body.delivery.progress.total, 2);
  assert.equal(body.phone, undefined);
  assert.equal(body.delivery.phone, undefined);
  assert.equal(JSON.stringify(body).includes('provider-secret'), false);
  assert.equal(JSON.stringify(body).includes('private payload'), false);
  assert.deepEqual(calls[0], {
    method: 'enqueue',
    input: { revisionId: 'revision-1', flowId: 'flow-1' },
  });
});

test('production-shaped delayed accepted aggregates expose a distinct action deadline', () => {
  const updatedAt = new Date(now.getTime() - 2 * 86_400_000);
  const view = toPublicDeliveryView({
    ...aggregate('provider_accepted'),
    updatedAt,
    reconciliationDeadline: null,
  } as any);
  assert.equal(
    view.action_deadline,
    new Date(updatedAt.getTime() + 86_400_000).toISOString(),
  );
});

test('GET detail and list expose only sanitized delivery views and filters', async () => {
  const { deliveryModule, calls } = moduleFixture();
  const detail = await quotationDeliveries(event('GET', {}, { id: 'delivery-1' }), { deliveryModule });
  assert.equal(detail.statusCode, 200);
  const detailBody = JSON.parse(detail.body || '{}');
  assert.equal(detailBody.id, 'delivery-1');
  assert.equal(detailBody.phone, '5511999990000');
  assert.equal(detailBody.progress.total, 2);
  assert.equal(detailBody.steps[0].providerMessageId, undefined);

  const list = await quotationDeliveries(event('GET', {}, {
    state: 'needs_review,provider_accepted',
    search: 'ORC-20260001',
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-31T23:59:59.999Z',
    requires_action: 'true',
    include_active: 'false',
    delayed: 'true',
    revision_id: 'revision-1',
    page: '2',
    page_size: '10',
  }), { deliveryModule });
  assert.equal(list.statusCode, 200);
  const listBody = JSON.parse(list.body || '{}');
  assert.equal(listBody.page, 2);
  assert.equal(listBody.page_size, 10);
  assert.deepEqual(listBody.summary, {
    active: 1,
    requires_action: 2,
    retry_scheduled: 3,
    delayed: 4,
    delivered_last_24_hours: 5,
  });
  assert.deepEqual(calls.find((call) => call.method === 'list')?.input, {
    states: ['needs_review', 'provider_accepted'],
    search: 'ORC-20260001',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-08-31T23:59:59.999Z'),
    requiresAction: true,
    includeActive: false,
    delayed: true,
    revisionId: 'revision-1',
    page: 2,
    pageSize: 10,
  });
});

test('durable failed send replay returns an accepted failed projection', async () => {
  const { deliveryModule } = moduleFixture('failed');
  const result = await sendWhatsappFlow(
    event('POST', { quotation_id: 'quotation-1', revision_id: 'revision-1', flow_id: 'flow-1' }),
    { deliveryModule },
  );
  const body = JSON.parse(result.body || '{}');
  assert.equal(result.statusCode, 202);
  assert.equal(body.success, true);
  assert.equal(body.send_status, 'failed');
  assert.equal(body.delivery.state, 'failed');
  assert.equal(body.delivery.progress.delivered, 0);
});

test('GET rejects invalid filters and missing detail', async () => {
  const { deliveryModule } = moduleFixture();
  assert.equal(
    (await quotationDeliveries(event('GET', {}, { state: 'not-a-state' }), { deliveryModule })).statusCode,
    400,
  );
  assert.equal(
    (await quotationDeliveries(event('GET', {}, { page_size: '101' }), { deliveryModule })).statusCode,
    400,
  );
  const missing = {
    ...deliveryModule,
    async get() { return null; },
  } as any;
  assert.equal(
    (await quotationDeliveries(event('GET', {}, { id: 'missing' }), { deliveryModule: missing })).statusCode,
    404,
  );
});

test('POST cancel_pending cancels the safe queue through the durable module', async () => {
  const { deliveryModule, calls } = moduleFixture();
  const result = await quotationDeliveries(
    event('POST', { action: 'cancel_pending' }),
    { deliveryModule },
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), { cancelled: 3 });
  assert.deepEqual(calls.find((call) => call.method === 'cancelPending')?.input, undefined);

  const invalid = await quotationDeliveries(
    event('POST', { action: 'delete_everything' }),
    { deliveryModule },
  );
  assert.equal(invalid.statusCode, 400);
});

test('PATCH resolution injects fixed operator identity and validates note/decision', async () => {
  const { deliveryModule, calls } = moduleFixture();
  const result = await quotationDeliveries(event('PATCH', {
    id: 'delivery-1',
    decision: 'confirmed_received',
    note: ' Cliente confirmou pelo telefone. ',
    resolved_by: 'forged-user',
  }), { deliveryModule });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.find((call) => call.method === 'resolve')?.input, {
    deliveryId: 'delivery-1',
    decision: 'confirmed_received',
    note: 'Cliente confirmou pelo telefone.',
    resolvedBy: 'authenticated-operator',
  });

  assert.equal(
    (await quotationDeliveries(event('PATCH', { id: 'delivery-1', decision: 'confirmed_received' }), { deliveryModule })).statusCode,
    400,
  );
  assert.equal(
    (await quotationDeliveries(event('PATCH', { id: 'delivery-1', decision: 'unknown', note: 'ok' }), { deliveryModule })).statusCode,
    400,
  );
});

test('legacy status GET and PATCH use PostgreSQL module without Redis reads', async () => {
  const { deliveryModule, calls } = moduleFixture();
  const status = await whatsappSendStatus(event('GET', {}, {
    quotation_uuid: 'legacy-quotation',
    revision_id: 'revision-1',
    flow_id: 'flow-1',
  }), { deliveryModule });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(JSON.parse(status.body || '{}'), {
    delivery_id: 'delivery-1',
    revision_id: 'revision-1',
    flow_id: 'flow-1',
    phase: 'provider_accepted',
    error: null,
    updated_at: now.toISOString(),
  });

  const resolved = await whatsappSendStatus(event('PATCH', {
    revision_id: 'revision-1',
    flow_id: 'flow-1',
    decision: 'confirmed_received',
    note: 'Cliente confirmou recebimento.',
    resolved_by: 'forged-user',
  }), { deliveryModule });
  assert.equal(resolved.statusCode, 200);
  const resolveCall = calls.filter((call) => call.method === 'resolve').at(-1)?.input as any;
  assert.equal(resolveCall.resolvedBy, 'authenticated-operator');
});

test('handler errors are sanitized', async () => {
  const deliveryModule = {
    async enqueue() { throw new Error('provider secret and database password'); },
  } as any;
  const response = await sendWhatsappFlow(
    event('POST', { quotation_id: 'quotation-1', revision_id: 'revision-1', flow_id: 'flow-1' }),
    { deliveryModule },
  );
  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body || '', /provider secret|database password/i);
});
