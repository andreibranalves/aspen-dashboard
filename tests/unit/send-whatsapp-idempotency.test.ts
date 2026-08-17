import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as sendWhatsappFlow } from '../../api/_functions/send-whatsapp-flow.js';

const quotationId = 'ORC-20260001';
const revisionId = 'revision-0000-0000-4000-8000-000000000001';

function event(flowId: string) {
  return {
    httpMethod: 'POST',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ quotation_id: quotationId, revision_id: revisionId, flow_id: flowId }),
  } as any;
}

function durableDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-outbox',
    revisionId,
    businessNumber: quotationId,
    clientName: 'Cliente Teste',
    phone: '5511999990000',
    flowId: 'flow-outbox',
    flowName: 'Fluxo outbox',
    state: 'provider_accepted',
    completionSource: null,
    publicError: null,
    nextAttemptAt: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt: new Date('2026-08-17T12:00:00.000Z'),
    updatedAt: new Date('2026-08-17T12:00:00.000Z'),
    steps: [],
    ...overrides,
  } as any;
}

test('PostgreSQL revision and flow identity leave transport idempotency to the outbox', async () => {
  const identities: Array<{ revisionId: string; flowId: string }> = [];
  const records = new Map<string, any>();
  let transportCalls = 0;
  const deliveryModule = {
    async enqueue(input: { revisionId: string; flowId: string }) {
      identities.push(input);
      const key = `${input.revisionId}:${input.flowId}`;
      let delivery = records.get(key);
      if (!delivery) {
        transportCalls += 1;
        delivery = durableDelivery({ flowId: input.flowId });
        records.set(key, delivery);
      }
      return delivery;
    },
  } as any;

  const first = await sendWhatsappFlow(event('flow-same'), { deliveryModule });
  const replay = await sendWhatsappFlow(event('flow-same'), { deliveryModule });

  assert.equal(first.statusCode, 202);
  assert.equal(replay.statusCode, 202);
  assert.deepEqual(identities, [
    { revisionId, flowId: 'flow-same' },
    { revisionId, flowId: 'flow-same' },
  ]);
  assert.equal(transportCalls, 1);
  assert.equal(JSON.parse(replay.body || '{}').phone, undefined);
});

test('existing failed outbox delivery returns a safe terminal response without transport success', async () => {
  let enqueueCalls = 0;
  let transportCalls = 0;
  const deliveryModule = {
    async enqueue() {
      enqueueCalls += 1;
      return durableDelivery({
        state: 'failed',
        publicError: 'A revisão do orçamento não está disponível para envio.',
      });
    },
  } as any;

  const first = await sendWhatsappFlow(event('flow-failed'), { deliveryModule });
  const replay = await sendWhatsappFlow(event('flow-failed'), {
    deliveryModule: {
      async enqueue() {
        enqueueCalls += 1;
        return durableDelivery({
          state: 'failed',
          publicError: 'A revisão do orçamento não está disponível para envio.',
        });
      },
    } as any,
  });

  assert.equal(first.statusCode, 400);
  assert.equal(replay.statusCode, 400);
  assert.equal(JSON.parse(first.body || '{}').success, undefined);
  assert.equal(JSON.parse(replay.body || '{}').send_status, 'failed');
  assert.equal(enqueueCalls, 2);
  assert.equal(transportCalls, 0);
});
