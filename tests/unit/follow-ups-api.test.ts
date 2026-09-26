import assert from 'node:assert/strict';
import test from 'node:test';
import { createFollowUpsHandler } from '../../api/_modules/follow-ups.js';
import { ConflictError, type QuotationFollowUpModule } from '../../api/_modules/quotation-follow-ups.js';

const version = 'a'.repeat(64);
const quotationId = '00000000-0000-4000-8000-000000000001';
const followUpId = '00000000-0000-4000-8000-000000000004';
const now = new Date('2026-08-31T12:00:00.000Z');

function event(httpMethod: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  return {
    httpMethod,
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    queryStringParameters: query,
    body: JSON.stringify(body),
  };
}

function row() {
  return {
    quotationId,
    revisionId: '00000000-0000-4000-8000-000000000002',
    deliveryId: '00000000-0000-4000-8000-000000000003',
    businessNumber: 'ORC-20260001',
    clientName: 'Cliente',
    amount: '100.00',
    instance: 'instance-1',
    providerConversationId: '5511999990000@s.whatsapp.net',
    canonicalPhone: '5511999990000',
    deliveryCreatedAt: now,
    firstProviderReceiptAt: now,
    dueAt: new Date('2026-09-01T12:00:00.000Z'),
    eligibilityVersion: version,
    state: 'ready' as const,
    followUpId: null,
    messageSnapshot: 'Olá.',
    closedReason: null,
    approvedAt: null,
    sentAt: null,
    updatedAt: now,
  };
}

function module(overrides: Partial<QuotationFollowUpModule> = {}): QuotationFollowUpModule {
  return {
    list: async () => ({ data: [row()], total: 1, page: 1, pageSize: 25 }),
    get: async () => row(),
    approve: async () => ({ ...row(), state: 'approved', followUpId }),
    dismiss: async () => ({ ...row(), state: 'dismissed', followUpId, closedReason: 'other' }),
    claimApproved: async () => null,
    markTransportStarted: async () => true,
    completeSent: async () => null,
    completeFailed: async () => null,
    completeNeedsReview: async () => null,
    reapExpiredLeases: async () => 0,
    countApprovalsTodayUtc: async () => 1,
    ...overrides,
  };
}

const enabledEnv = {
  APP_ENV: 'production',
  EXTERNAL_WRITES_ENABLED: '1',
  QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '1',
};

test('GET /api/follow-ups returns snake_case page', async () => {
  const handler = createFollowUpsHandler({ followUpModule: module() });
  const result = await handler(event('GET', {}, { view: 'ready', page: '1', page_size: '25' }));
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body || '{}');
  assert.equal(body.total, 1);
  assert.equal(body.page_size, 25);
  assert.equal(body.data[0].quotation_id, quotationId);
  assert.equal(body.data[0].business_number, 'ORC-20260001');
  assert.equal(body.data[0].eligibility_version, version);
});

test('GET /api/follow-ups validates the source opportunity and action without writing', async () => {
  let request: { quotationId: string; expectedOpportunityId?: string; expectedActionId?: string } | undefined;
  const handler = createFollowUpsHandler({
    followUpModule: module({
      get: async (quotation, options) => {
        request = { quotationId: quotation, ...options };
        return row();
      },
    }),
  });
  const result = await handler(event('GET', {}, {
    quotation_id: quotationId,
    opportunity_id: '00000000-0000-4000-8000-000000000005',
    action_id: '00000000-0000-4000-8000-000000000006',
  }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(request, {
    quotationId,
    expectedOpportunityId: '00000000-0000-4000-8000-000000000005',
    expectedActionId: '00000000-0000-4000-8000-000000000006',
  });
  assert.equal(JSON.parse(result.body || '{}').data.quotation_id, quotationId);
});

test('GET /api/follow-ups rejects a source request without its action binding', async () => {
  const handler = createFollowUpsHandler({ followUpModule: module() });
  const result = await handler(event('GET', {}, {
    quotation_id: quotationId,
    opportunity_id: '00000000-0000-4000-8000-000000000005',
  }));
  assert.equal(result.statusCode, 400);
});

test('GET /api/follow-ups keeps a relinked source out of the approvable drawer', async () => {
  const handler = createFollowUpsHandler({
    followUpModule: module({
      get: async () => {
        throw new ConflictError('A fila mudou. Recarregue e tente novamente.');
      },
    }),
  });
  const result = await handler(event('GET', {}, {
    quotation_id: quotationId,
    opportunity_id: '00000000-0000-4000-8000-000000000005',
    action_id: '00000000-0000-4000-8000-000000000006',
  }));
  assert.equal(result.statusCode, 409);
  assert.equal(JSON.parse(result.body || '{}').error, 'A fila mudou. Recarregue e tente novamente.');
});

test('POST approve is blocked when the kill switch is off', async () => {
  const handler = createFollowUpsHandler({
    followUpModule: module(),
    environment: { QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '0' },
  });
  const result = await handler(
    event('POST', { quotation_id: quotationId, eligibility_version: version, message: 'Olá.' }),
  );
  assert.equal(result.statusCode, 409);
  assert.equal(JSON.parse(result.body || '{}').error, 'Envio automático desativado');
});

test('POST approve wakes the worker after insert and reports a refused wake', async () => {
  let wakes = 0;
  const handler = createFollowUpsHandler({
    followUpModule: module(),
    environment: enabledEnv,
    wakeWorker: async () => {
      wakes += 1;
      return 'failed';
    },
  });
  const result = await handler(
    event('POST', { quotation_id: quotationId, eligibility_version: version, message: 'Olá.' }),
  );
  assert.equal(result.statusCode, 201);
  assert.deepEqual(JSON.parse(result.body || '{}'), {
    follow_up_id: followUpId,
    state: 'approved',
    worker_wake: 'failed',
  });
  assert.equal(wakes, 1);
});

test('PATCH dismiss returns dismissed even when writes are off', async () => {
  const handler = createFollowUpsHandler({
    followUpModule: module(),
    environment: { QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '0' },
  });
  const result = await handler(
    event('PATCH', { quotation_id: quotationId, eligibility_version: version, reason: 'already_handled' }),
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), { follow_up_id: followUpId, state: 'dismissed' });
});

test('PATCH dismiss accepts a missing eligibility version for awaiting receipt', async () => {
  let receivedVersion: string | undefined;
  const handler = createFollowUpsHandler({
    followUpModule: module({
      dismiss: async (input) => {
        receivedVersion = input.eligibilityVersion;
        return { ...row(), state: 'dismissed', followUpId, closedReason: 'other' };
      },
    }),
    environment: { QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '0' },
  });
  const result = await handler(
    event('PATCH', { quotation_id: quotationId, eligibility_version: null, reason: 'other' }),
  );
  assert.equal(result.statusCode, 200);
  assert.equal(receivedVersion, '');
});

test('stale eligibility becomes Portuguese 409', async () => {
  const handler = createFollowUpsHandler({
    followUpModule: module({
      approve: async () => {
        const error = new Error('A fila mudou. Recarregue e tente novamente.') as Error & { statusCode: number };
        error.statusCode = 409;
        throw error;
      },
    }),
    environment: enabledEnv,
  });
  const result = await handler(
    event('POST', { quotation_id: quotationId, eligibility_version: version, message: 'Olá.' }),
  );
  assert.equal(result.statusCode, 409);
  assert.equal(JSON.parse(result.body || '{}').error, 'A fila mudou. Recarregue e tente novamente.');
});
