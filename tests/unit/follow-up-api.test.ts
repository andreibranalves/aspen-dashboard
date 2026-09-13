import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveFollowUp,
  dismissFollowUp,
  getFollowUp,
  FollowUpApiError,
  listFollowUps,
  parseFollowUpPage,
  type FollowUpView,
} from '../../src/lib/api/followUpApi.ts';

const timestamp = '2026-08-20T12:00:00.000Z';
const version = 'a'.repeat(64);

function fixture(overrides: Partial<FollowUpView> = {}): Record<string, unknown> {
  const item: FollowUpView = {
    quotationId: 'quotation-1',
    revisionId: 'revision-1',
    deliveryId: 'delivery-1',
    businessNumber: 'ORC-20260001',
    clientName: 'Cliente',
    amount: '1250.00',
    instance: 'instance-1',
    providerConversationId: 'conversation-1',
    canonicalPhone: '5511999990000',
    deliveryCreatedAt: timestamp,
    firstProviderReceiptAt: timestamp,
    dueAt: '2026-08-21T12:00:00.000Z',
    eligibilityVersion: version,
    state: 'ready',
    reason: 'ready',
    reasonLabel: 'Silêncio após o recibo',
    followUpId: null,
    messageSnapshot: null,
    closedReason: null,
    approvedAt: null,
    sentAt: null,
    updatedAt: timestamp,
    ...overrides,
  };
  return {
    follow_up_id: item.followUpId,
    quotation_id: item.quotationId,
    revision_id: item.revisionId,
    delivery_id: item.deliveryId,
    business_number: item.businessNumber,
    client_name: item.clientName,
    amount: item.amount,
    instance: item.instance,
    provider_conversation_id: item.providerConversationId,
    canonical_phone: item.canonicalPhone,
    delivery_created_at: item.deliveryCreatedAt,
    first_provider_receipt_at: item.firstProviderReceiptAt,
    due_at: item.dueAt,
    eligibility_version: item.eligibilityVersion,
    state: item.state,
    reason: item.reason,
    reason_label: item.reasonLabel,
    message_snapshot: item.messageSnapshot,
    closed_reason: item.closedReason,
    approved_at: item.approvedAt,
    sent_at: item.sentAt,
    updated_at: item.updatedAt,
  };
}
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('parses snake_case list response into camelCase view model', () => {
  const page = parseFollowUpPage({ data: [fixture()], total: 1, page: 1, page_size: 25 });
  assert.equal(page.data[0].quotationId, 'quotation-1');
  assert.equal(page.data[0].businessNumber, 'ORC-20260001');
  assert.equal(page.data[0].firstProviderReceiptAt, timestamp);
  assert.equal(page.data[0].messageSnapshot, null);
});

test('accepts a LID attention candidate without a canonical phone', () => {
  const page = parseFollowUpPage({
    data: [fixture({
      providerConversationId: 'abc123@lid',
      canonicalPhone: '',
      state: 'held',
      reason: 'identity_unresolved',
      reasonLabel: 'Contato sem telefone confiável',
    })],
    total: 1,
    page: 1,
    page_size: 25,
  });
  assert.equal(page.data[0].providerConversationId, 'abc123@lid');
  assert.equal(page.data[0].canonicalPhone, '');
});

test('keeps newlines in the follow-up message snapshot', () => {
  const page = parseFollowUpPage({
    data: [fixture({ messageSnapshot: 'Olá, Cliente.\n\nPassando para saber.' })],
    total: 1,
    page: 1,
    page_size: 25,
  });
  assert.match(page.data[0].messageSnapshot || '', /\n\n/);
});

test('rejects malformed list response and unsupported state', () => {
  assert.throws(() => parseFollowUpPage({ data: [], total: 0, page: 0, page_size: 25 }), FollowUpApiError);
  assert.throws(
    () => parseFollowUpPage({ data: [fixture({ state: 'unknown' as FollowUpView['state'] })], total: 1, page: 1, page_size: 25 }),
    /Resposta inválida/
  );
});

test('uses snake_case requests for listing, approve, and dismiss', async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (init.method === 'POST') return response({ follow_up_id: 'follow-up-1', state: 'approved' }, 201);
    if (init.method === 'PATCH') return response({ follow_up_id: 'follow-up-1', state: 'dismissed' });
    return response({ data: [fixture()], total: 1, page: 1, page_size: 25 });
  };
  try {
    await listFollowUps({ view: 'ready', page: 1, pageSize: 25 });
    await approveFollowUp({ quotationId: 'quotation-1', eligibilityVersion: version, message: 'Olá.' });
    await dismissFollowUp({ quotationId: 'quotation-1', eligibilityVersion: version, reason: 'other' });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.match(calls[0].url, /view=ready/);
  assert.deepEqual(calls[1].body, {
    quotation_id: 'quotation-1',
    eligibility_version: version,
    message: 'Olá.',
  });
  assert.deepEqual(calls[2].body, {
    quotation_id: 'quotation-1',
    eligibility_version: version,
    reason: 'other',
  });
});

test('loads a follow-up by quotation and binds the read-only GET to opportunity and action', async () => {
  let request: { url: string; method: string } | undefined;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), method: String(init.method || 'GET') };
    return response({ data: fixture({ followUpId: 'follow-up-source' }) });
  };
  try {
    const loaded = await getFollowUp({
      quotationId: 'quotation-source',
      expectedOpportunityId: 'opportunity-source',
      expectedActionId: 'action-source',
    });
    assert.equal(loaded.followUpId, 'follow-up-source');
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(request?.method, 'GET');
  assert.match(request?.url || '', /quotation_id=quotation-source/);
  assert.match(request?.url || '', /opportunity_id=opportunity-source/);
  assert.match(request?.url || '', /action_id=action-source/);
});

test('dismiss sends an empty eligibility version for awaiting receipt', async () => {
  let requestBody: unknown;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init = {}) => {
    requestBody = JSON.parse(String(init.body));
    return response({ follow_up_id: 'follow-up-1', state: 'dismissed' });
  };
  try {
    await dismissFollowUp({ quotationId: 'quotation-1', eligibilityVersion: null, reason: 'other' });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(requestBody, {
    quotation_id: 'quotation-1',
    eligibility_version: '',
    reason: 'other',
  });
});

test('surfaces Portuguese HTTP error and status', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ error: 'A fila mudou. Recarregue e tente novamente.' }, 409);
  try {
    await assert.rejects(
      () => listFollowUps({ view: 'ready' }),
      (error: unknown) => error instanceof FollowUpApiError && error.status === 409 && error.message.includes('A fila mudou')
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
