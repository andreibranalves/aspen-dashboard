import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeCommercialAction,
  createCommercialAction,
  getCommercialActionHistory,
  rescheduleCommercialAction,
  setCommercialUrgency,
} from '../../src/lib/api/commercialQueueApi.ts';

const actionId = '11111111-1111-4111-8111-111111111111';
const opportunityId = '22222222-2222-4222-8222-222222222222';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('cliente da fila envia criação e agenda civil sem converter data no navegador', async () => {
  const originalFetch = globalThis.fetch;
  let request: { method?: string; body?: string } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { method: init?.method, body: String(init?.body || '') };
    return response({
      action_id: actionId,
      opportunity_id: opportunityId,
      state: 'active',
      version: 1,
      closed: false,
    });
  };
  try {
    const result = await createCommercialAction({
      opportunityId,
      kind: 'internal',
      dueDate: '2026-09-15',
      dueTime: null,
      reason: 'Separar amostras',
    });
    assert.equal(result.version, 1);
    assert.equal(request?.method, 'POST');
    assert.deepEqual(JSON.parse(request!.body || ''), {
      command: 'create',
      opportunity_id: opportunityId,
      kind: 'internal',
      due_date: '2026-09-15',
      due_time: null,
      reason: 'Separar amostras',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cliente da fila encaminha reschedule e complete com contrato de sucessor/fechamento', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method?: string; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ method: init?.method, body: String(init?.body || '') });
    return response({
      action_id: actionId,
      opportunity_id: opportunityId,
      state: 'completed',
      version: 2,
      closed: false,
    });
  };
  try {
    await rescheduleCommercialAction({
      actionId,
      expectedVersion: 1,
      kind: 'review',
      dueDate: '2026-09-16',
      dueTime: '14:00',
      reason: 'Revisar retorno',
    });
    await completeCommercialAction({
      actionId,
      expectedVersion: 1,
      outcome: {
        successor: {
          kind: 'agreed_commitment',
          dueDate: '2026-09-17',
          dueTime: null,
          reason: 'Confirmar compromisso',
        },
      },
    });
    assert.deepEqual(JSON.parse(requests[0]!.body || ''), {
      command: 'reschedule',
      action_id: actionId,
      expected_version: 1,
      kind: 'review',
      due_date: '2026-09-16',
      due_time: '14:00',
      reason: 'Revisar retorno',
    });
    assert.deepEqual(JSON.parse(requests[1]!.body || ''), {
      command: 'complete',
      action_id: actionId,
      expected_version: 1,
      successor: {
        kind: 'agreed_commitment',
        due_date: '2026-09-17',
        due_time: null,
        reason: 'Confirmar compromisso',
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cliente da fila lê histórico da oportunidade', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return response({ opportunity_id: opportunityId, data: [] });
  };
  try {
    const history = await getCommercialActionHistory(opportunityId);
    assert.deepEqual(history, []);
    assert.match(requestedUrl, /commercial-queue/);
    assert.match(requestedUrl, /view=history/);
    assert.match(requestedUrl, /opportunity_id=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cliente da fila alterna urgência usando o token da ação ativa', async () => {
  const originalFetch = globalThis.fetch;
  let request: { body?: string } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { body: String(init?.body || '') };
    return response({
      opportunity_id: opportunityId,
      action_id: actionId,
      version: 1,
      is_urgent: true,
    });
  };
  try {
    const result = await setCommercialUrgency({
      opportunityId,
      actionId,
      expectedVersion: 1,
      isUrgent: true,
    });
    assert.equal(result.isUrgent, true);
    assert.deepEqual(JSON.parse(request!.body || ''), {
      command: 'set_urgency',
      opportunity_id: opportunityId,
      action_id: actionId,
      expected_version: 1,
      is_urgent: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
