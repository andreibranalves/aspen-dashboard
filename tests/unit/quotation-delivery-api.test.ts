import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliveryPollDelay,
  enqueueDelivery,
  fetchDelivery,
  listDeliveries,
  projectDelivery,
  resolveDelivery,
  type DeliveryView,
} from '../../src/lib/quotationDeliveryApi.ts';

const updatedAt = '2026-08-17T12:00:00.000Z';

function fixture(overrides: Partial<DeliveryView> = {}): Record<string, unknown> {
  const delivery: DeliveryView = {
    id: 'delivery-1',
    revisionId: 'revision-1',
    businessNumber: 'ORC-20260001',
    clientName: 'Cliente',
    phone: '5511999990000',
    flowId: 'flow-1',
    flowName: 'Fluxo',
    state: 'queued',
    publicError: null,
    completionSource: null,
    progress: { delivered: 0, total: 1 },
    steps: [
      {
        id: 'step-1',
        position: 0,
        type: 'text',
        state: 'queued',
        attemptCount: 0,
        publicError: null,
        updatedAt,
      },
    ],
    nextAttemptAt: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    updatedAt,
    ...overrides,
  };
  return {
    id: delivery.id,
    revision_id: delivery.revisionId,
    business_number: delivery.businessNumber,
    client_name: delivery.clientName,
    phone: delivery.phone,
    flow_id: delivery.flowId,
    flow_name: delivery.flowName,
    state: delivery.state,
    public_error: delivery.publicError,
    completion_source: delivery.completionSource,
    progress: delivery.progress,
    steps: delivery.steps.map((step) => ({
      id: step.id,
      position: step.position,
      type: step.type,
      state: step.state,
      attempt_count: step.attemptCount,
      public_error: step.publicError,
      updated_at: step.updatedAt,
    })),
    next_attempt_at: delivery.nextAttemptAt,
    reconciliation_deadline: delivery.reconciliationDeadline,
    delivered_at: delivery.deliveredAt,
    updated_at: delivery.updatedAt,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('projector distinguishes provider acceptance from device delivery', () => {
  const providerAccepted = projectDelivery({
    ...fixture({ state: 'provider_accepted' }),
  } as unknown as DeliveryView);
  assert.equal(providerAccepted.label, 'Aceito pela Evolution');
  assert.equal(
    projectDelivery({ ...fixture({ state: 'delivered' }) } as unknown as DeliveryView).label,
    'Entregue'
  );
  assert.equal(
    projectDelivery({ ...fixture({ state: 'needs_review' }) } as unknown as DeliveryView)
      .requiresAction,
    true
  );
});

test('polling stops only for terminal states', () => {
  assert.equal(deliveryPollDelay('processing'), 1_500);
  assert.equal(deliveryPollDelay('provider_accepted'), 5_000);
  assert.equal(deliveryPollDelay('reconciling'), 5_000);
  assert.equal(deliveryPollDelay('retry_scheduled'), 15_000);
  assert.equal(deliveryPollDelay('delivered'), null);
  assert.equal(deliveryPollDelay('failed'), null);
  assert.equal(deliveryPollDelay('needs_review'), null);
});

test('fetchDelivery resolves identity through the compatibility status endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    if (requests.length === 1) {
      return response({
        delivery_id: 'delivery-1',
        revision_id: 'revision-1',
        flow_id: 'flow-1',
        phase: 'processing',
        error: null,
        updated_at: updatedAt,
      });
    }
    return response(fixture({ state: 'processing' }));
  }) as typeof fetch;
  try {
    const delivery = await fetchDelivery({ revisionId: 'revision-1', flowId: 'flow-1' });
    assert.equal(delivery?.state, 'processing');
    assert.match(requests[0], /whatsapp-send-status\?/);
    assert.match(requests[0], /revision_id=revision-1/);
    assert.match(requests[0], /flow_id=flow-1/);
    assert.match(requests[1], /quotation-deliveries\?id=delivery-1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('strict delivery parsing rejects missing IDs, unknown states, invalid steps, and timestamps', async () => {
  const originalFetch = globalThis.fetch;
  const invalidBodies = [
    { ...fixture(), id: '' },
    { ...fixture(), state: 'provider_unknown' },
    {
      ...fixture(),
      steps: [{ ...(fixture().steps as Record<string, unknown>[])[0], state: 'unknown' }],
    },
    { ...fixture(), updated_at: 'not-a-timestamp' },
  ];
  try {
    for (const body of invalidBodies) {
      globalThis.fetch = (async () => response(body)) as typeof fetch;
      await assert.rejects(fetchDelivery({ id: 'delivery-1' }), /Resposta inválida/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('listDeliveries rejects unbounded metadata before trusting the response', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return response({});
  }) as typeof fetch;
  try {
    await assert.rejects(listDeliveries({ page: 1, pageSize: 101 }), /Tamanho da página inválida/);
    await assert.rejects(listDeliveries({ page: 1, pageSize: 100 }), /Resposta inválida/);
    assert.equal(called, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('enqueueDelivery validates the durable response and sends stable identity fields', async () => {
  const originalFetch = globalThis.fetch;
  let request = { url: '', method: '', body: '' };
  globalThis.fetch = (async (input, init) => {
    request = {
      url: String(input),
      method: init?.method || 'GET',
      body: String(init?.body || ''),
    };
    return response(
      {
        success: true,
        delivery_id: 'delivery-1',
        send_status: 'queued',
        revision_id: 'revision-1',
        flow_id: 'flow-1',
        delivery: fixture({ state: 'queued' }),
      },
      202
    );
  }) as typeof fetch;
  try {
    const delivery = await enqueueDelivery({
      quotationId: 'quotation-1',
      revisionId: 'revision-1',
      flowId: 'flow-1',
    });
    assert.equal(delivery.id, 'delivery-1');
    assert.equal(request.url, '/api/send-whatsapp-flow');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.body || '{}'), {
      quotation_id: 'quotation-1',
      revision_id: 'revision-1',
      flow_id: 'flow-1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveDelivery sends a bounded Portuguese note and validates the result', async () => {
  const originalFetch = globalThis.fetch;
  let request = { url: '', method: '', body: '' };
  globalThis.fetch = (async (input, init) => {
    request = {
      url: String(input),
      method: init?.method || 'GET',
      body: String(init?.body || ''),
    };
    return response(fixture({ state: 'delivered', completionSource: 'operator' }));
  }) as typeof fetch;
  try {
    const delivery = await resolveDelivery(
      'delivery-1',
      'confirmed_received',
      ' Cliente confirmou. '
    );
    assert.equal(delivery.state, 'delivered');
    assert.equal(request.url, '/api/quotation-deliveries?id=delivery-1');
    assert.equal(request.method, 'PATCH');
    assert.deepEqual(JSON.parse(request.body || '{}'), {
      decision: 'confirmed_received',
      note: 'Cliente confirmou.',
    });
    await assert.rejects(
      resolveDelivery('delivery-1', 'confirmed_received', 'x'),
      /Justificativa inválida/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
