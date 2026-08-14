import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../api/_functions/whatsapp-send-status.js';
import {
  canonicalWhatsappSendIdempotencyKey,
  WHATSAPP_SEND_RESOLUTION_CONFIRMATION,
} from '../../api/_functions/lib/whatsapp-send-reservation-store.js';
import type { QuotationDelivery } from '../../api/_db/quotation-delivery-repository.js';

const quotationId = 'quote-status';
const revisionId = 'revision-status';
const flowId = 'flow-status';
const key = canonicalWhatsappSendIdempotencyKey(quotationId, revisionId, flowId);

function record(phase: 'transporting' | 'accepted_partial' = 'accepted_partial') {
  const now = Date.now();
  return {
    schema: 3,
    key,
    quotationId,
    revisionId,
    flowId,
    stepsCount: 2,
    version: 4,
    owner: 'owner-secret',
    phase,
    createdAt: now - 1000,
    updatedAt: now,
    reservedAt: now - 1000,
    transportStartedAt: phase === 'transporting' ? now : undefined,
    currentStep: phase === 'transporting' ? 1 : 0,
    acceptedSteps: phase === 'transporting' ? [{ step: 0, kind: 'text', acceptedAt: now - 1 }] : [{ step: 0, kind: 'text', acceptedAt: now - 1 }],
  };
}

function event(method: string, body?: Record<string, unknown>, query: Record<string, string> = {}) {
  return {
    httpMethod: method,
    body: body ? JSON.stringify(body) : undefined,
    queryStringParameters: query,
  } as any;
}

function delivery(state: QuotationDelivery['state']): QuotationDelivery {
  return {
    id: 'delivery-status', revisionId, phone: '5511999990000', flowId, state,
    providerAcceptanceId: state === 'completed' ? 'accept-neutral' : null,
    publicError: null,
    diagnosticsExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    resumableUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(), updatedAt: new Date(), readOnly: false,
  };
}

function deliveryRepository(initial: QuotationDelivery | null) {
  let current = initial;
  return {
    async getByRevision(id: string) { return id === revisionId ? current : null; },
    async recordState(input: any) {
      if (!current) throw new Error('missing delivery');
      current = { ...current, state: input.state, updatedAt: new Date() };
      return current;
    },
  } as any;
}

function storeFor(initial: any) {
  let current = initial;
  return {
    async get() { return current; },
    async compareAndSet(input: any) {
      if (input.expectedVersion !== current.version || input.owner !== current.owner || input.from !== current.phase) {
        return { ok: false, reason: 'conflict', record: current };
      }
      current = {
        ...current,
        version: current.version + 1,
        phase: input.to,
        updatedAt: Date.now(),
        ...(input.to === 'retryable' ? { transportStartedAt: undefined, currentStep: undefined, acceptedSteps: [] } : {}),
      };
      return { ok: true, record: current };
    },
    async resolve(input: any) {
      if (input.expectedVersion !== current.version) return { ok: false, reason: 'conflict', record: current };
      const now = Date.now();
      current = {
        ...current,
        version: current.version + 1,
        phase: input.to,
        resolvedAt: now,
        updatedAt: now,
        transportStartedAt: undefined,
        currentStep: undefined,
        ...(input.to === 'completed' ? {
          result: {
            success: true,
            dry_run: false,
            send_status: 'completed',
            duplicate_warning: false,
            duplicate_message: '',
            flow_id: flowId,
            flow_name: 'Fluxo reconciliado',
            quotation_id: quotationId,
            deal_id: null,
            product_summary: 'produtos',
            categories: [],
            steps_count: current.acceptedSteps.length,
            steps: current.acceptedSteps.map((step: any) => ({ type: step.kind })),
            send_event_id: null,
          },
        } : { result: undefined }),
        resolution: input.to === 'completed' ? 'operator_completed' : 'operator_retryable',
      };
      return { ok: true, record: current };
    },
    async reserve() { throw new Error('unused'); },
    async cas() { throw new Error('unused'); },
    async transition() { throw new Error('unused'); },
  } as any;
}

test('PostgreSQL completed summary wins when KV is missing or stale', async () => {
  const response = await handler(event('GET', undefined, {
    quotation_id: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
  }), {
    reservationStore: storeFor(null),
    deliveryRepository: deliveryRepository(delivery('completed')),
  });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || '{}');
  assert.equal(body.phase, 'completed');
  assert.equal(body.phone, '5511999990000');
  assert.equal(body.acceptance_id, 'accept-neutral');
  assert.equal(body.provider_id, undefined);
});

test('PostgreSQL reconciling summary is never erased by a completed KV lease', async () => {
  const response = await handler(event('GET', undefined, {
    quotation_id: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
  }), {
    reservationStore: storeFor(null),
    deliveryRepository: deliveryRepository(delivery('reconciling')),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body || '{}').phase, 'reconciling');
});

test('status is neutral and method constrained', async () => {
  const store = storeFor(record());
  const response = await handler(event('GET', undefined, {
    quotation_id: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
  }), { reservationStore: store });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || '{}');
  assert.equal(body.phase, 'accepted_partial');
  assert.equal(body.steps_count, 2);
  assert.deepEqual(body.accepted_step_numbers, [0]);
  assert.equal(body.accepted_step_count, 1);
  assert.equal(body.owner, undefined);
  assert.equal(body.provider_id, undefined);
  assert.equal((await handler(event('PUT'), { reservationStore: store })).statusCode, 405);
});

test('completed status projects without intermediate progress fields', async () => {
  const now = Date.now();
  const completed = {
    ...record(),
    phase: 'completed',
    updatedAt: now,
    currentStep: null,
    transportStartedAt: null,
    acceptedSteps: [],
    result: {
      success: true,
      dry_run: false,
      send_status: 'completed',
      duplicate_warning: false,
      duplicate_message: '',
      flow_id: flowId,
      flow_name: 'Fluxo',
      quotation_id: quotationId,
      deal_id: null,
      product_summary: 'produtos',
      categories: [],
      steps_count: 0,
      steps: [],
      send_event_id: null,
    },
  };
  const response = await handler(event('GET', undefined, {
    quotation_id: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
  }), { reservationStore: storeFor(completed) });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || '{}');
  assert.equal(body.phase, 'completed');
  assert.equal(body.current_step, null);
  assert.deepEqual(body.accepted_step_numbers, []);
});

test('reconciliation requires conspicuous confirmation and version CAS', async () => {
  const store = storeFor(record('transporting'));
  const base = { quotation_id: quotationId, revision_id: revisionId, flow_id: flowId, expected_version: 4, resolution: 'completed' };
  const missing = await handler(event('PATCH', base), { reservationStore: store });
  assert.equal(missing.statusCode, 400);
  assert.match(missing.body || '', new RegExp(WHATSAPP_SEND_RESOLUTION_CONFIRMATION));

  const conflict = await handler(event('PATCH', { ...base, expected_version: 3, confirmation: WHATSAPP_SEND_RESOLUTION_CONFIRMATION }), { reservationStore: store });
  assert.equal(conflict.statusCode, 409);

  const resolved = await handler(event('PATCH', { ...base, confirmation: WHATSAPP_SEND_RESOLUTION_CONFIRMATION }), { reservationStore: store });
  assert.equal(resolved.statusCode, 200);
  const body = JSON.parse(resolved.body || '{}');
  assert.equal(body.phase, 'completed');
  assert.equal(body.owner, undefined);
});

test('PostgreSQL terminal status survives KV outage', async () => {
  const durable = delivery('completed');
  const response = await handler(event('GET', undefined, {
    quotation_id: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
  }), {
    reservationStore: { async get() { throw new Error('KV unavailable'); } } as any,
    deliveryRepository: deliveryRepository(durable),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body || '{}').phase, 'completed');
});

test('resolution does not finalize KV when PostgreSQL transition fails', async () => {
  const store = storeFor(record('transporting'));
  let resolveCalls = 0;
  const failingDelivery = {
    async getByRevision() { return delivery('reconciling'); },
    async recordState() { throw new Error('database unavailable'); },
  } as any;
  const response = await handler(event('PATCH', {
    quotation_id: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
    expected_version: 4,
    resolution: 'completed',
    confirmation: WHATSAPP_SEND_RESOLUTION_CONFIRMATION,
  }), {
    reservationStore: { ...store, async resolve(input: any) { resolveCalls += 1; return store.resolve(input); } } as any,
    deliveryRepository: failingDelivery,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(resolveCalls, 0);
});

test('resolution reports safe error when KV becomes unavailable after PostgreSQL transition', async () => {
  const state = record('transporting');
  let persisted: string | null = null;
  const response = await handler(event('PATCH', {
    quotation_id: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
    expected_version: 4,
    resolution: 'completed',
    confirmation: WHATSAPP_SEND_RESOLUTION_CONFIRMATION,
  }), {
    reservationStore: { ...storeFor(state), async resolve() { throw new Error('KV unavailable'); } } as any,
    deliveryRepository: {
      async getByRevision() { return delivery('reconciling'); },
      async recordState(input: any) { persisted = input.state; return { ...delivery('reconciling'), state: input.state }; },
    } as any,
  });
  assert.equal(response.statusCode, 503);
  assert.equal(persisted, 'reconciling');
  assert.match(response.body || '', /Reconciliação necessária/i);
});

test('malformed status record fails closed without projecting arbitrary fields', async () => {
  const malformed = { ...record(), result: { provider_id: 'secret' } };
  const response = await handler(event('GET', undefined, {
    quotation_id: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
  }), { reservationStore: storeFor(malformed) });
  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body || '', /provider_id|secret/);
});
