import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CommunicationSendError,
  executeFlow,
} from '../../src/lib/communicationApi.ts';

const payload = {
  quotation_id: 'ORC-20260001',
  revision_id: 'revision-1',
  flow_id: 'flow-1',
};

const validResponse = {
  success: true,
  dry_run: false,
  send_status: 'completed',
  duplicate_warning: false,
  duplicate_message: '',
  flow_id: 'flow-1',
  flow_name: 'Fluxo',
  quotation_id: 'ORC-20260001',
  deal_id: null,
  phone: '5511999990000',
  product_summary: 'cangas',
  categories: ['canga'],
  steps_count: 1,
  steps: [],
  send_event_id: 'event-1',
};

test('executeFlow rejects malformed HTTP 2xx instead of rendering sent', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), (error: unknown) => {
      assert.match(String((error as Error).message), /Resposta inválida|envio de WhatsApp/i);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow accepts only a complete neutral successful shape', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(validResponse), { status: 200 })) as typeof fetch;
  try {
    const response = await executeFlow(payload);
    assert.equal(response.success, true);
    assert.equal((response as unknown as { send_status: string }).send_status, 'completed');
    assert.deepEqual(response.steps, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow accepts a strictly shaped completed replay without recipient PII', async () => {
  const originalFetch = globalThis.fetch;
  const replay = { ...validResponse };
  delete (replay as Partial<typeof validResponse>).phone;
  globalThis.fetch = (async () => new Response(JSON.stringify(replay), { status: 200 })) as typeof fetch;
  try {
    const response = await executeFlow(payload);
    assert.equal(response.success, true);
    assert.equal(response.phone, undefined);
    assert.equal(response.send_status, 'completed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow rejects malformed phone values instead of rendering a replay', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ...validResponse, phone: 123 }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), /Resposta inválida|envio de WhatsApp/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow maps accepted partial responses only at the boundary', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: 'O transporte foi aceito e aguarda reconciliação.',
    send_status: 'accepted_partial',
    accepted_partial: true,
    provider_accepted: true,
  }), { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), (error: unknown) => {
      assert.ok(error instanceof CommunicationSendError);
      assert.equal((error as CommunicationSendError).deliveryAccepted, true);
      assert.equal((error as CommunicationSendError & { sendStatus?: string }).sendStatus, 'accepted_partial');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow maps reserved responses to a neutral in-progress status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: 'Já existe uma reserva para esta revisão e fluxo. Aguarde a reconciliação.',
    send_status: 'reserved',
    reconciliation_required: true,
  }), { status: 409 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), (error: unknown) => {
      assert.ok(error instanceof CommunicationSendError);
      assert.equal((error as CommunicationSendError).deliveryAccepted, false);
      assert.equal((error as CommunicationSendError & { sendStatus?: string }).sendStatus, 'reserved');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow rejects 2xx provider markers without success contract', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ provider_accepted: true }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), /Resposta inválida|envio de WhatsApp/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
