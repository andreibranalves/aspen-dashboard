import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommercialQueueHandler } from '../../api/_modules/commercial-queue.js';
import { ActionConflictError } from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import type {
  OpportunityActionCommandResult,
  OpportunityActionHistoryEntry,
  OpportunityActionRepository,
  OpportunityQueuePage,
} from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';

function event(
  httpMethod: string,
  body: Record<string, unknown> = {},
  queryStringParameters: Record<string, string> = {}
): {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string>;
  body: string;
} {
  return {
    httpMethod,
    headers: {},
    queryStringParameters,
    body: JSON.stringify(body),
  };
}

const page: OpportunityQueuePage = { data: [], total: 0, page: 1, pageSize: 25 };
const result: OpportunityActionCommandResult = {
  actionId: '11111111-1111-4111-8111-111111111111',
  opportunityId: '22222222-2222-4222-8222-222222222222',
  state: 'superseded',
  version: 2,
  action: null,
  successor: null,
  closed: false,
};

function repository(
  overrides: Partial<OpportunityActionRepository> = {}
): OpportunityActionRepository {
  return {
    listActive: async () => page,
    createAction: async () => result,
    rescheduleAction: async () => result,
    completeAction: async () => result,
    recordManualContact: async () => ({
      ...result,
      eventId: 'manual-event',
      commandId: 'manual-command',
      contactType: 'phone_call' as const,
      occurredAt: '2026-09-11T12:00:00.000Z',
      note: null,
      resultCode: 'other' as const,
      countsAsFollowUp: false,
      continuationType: 'wait' as const,
      source: 'operator_statement' as const,
    }),
    listHistory: async () => [],
    ...overrides,
  };
}

test('POST /api/commercial-queue encaminha reagendamento com versão e ator auditável', async () => {
  let received: Record<string, unknown> | undefined;
  const handler = createCommercialQueueHandler({
    repository: repository({
      rescheduleAction: async (input) => {
        received = input as unknown as Record<string, unknown>;
        return result;
      },
    }),
  });
  const response = await handler(
    event('POST', {
      command: 'reschedule',
      action_id: result.actionId,
      expected_version: 1,
      kind: 'internal',
      due_date: '2026-09-15',
      due_time: null,
      reason: 'Separar amostras',
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal(received?.actionId, result.actionId);
  assert.equal(received?.expectedVersion, 1);
  assert.equal(received?.actor, 'authenticated-operator');
  assert.equal(received?.dueDate, '2026-09-15');
  assert.equal(JSON.parse(response.body || '{}').version, 2);
});

test('POST /api/commercial-queue exige sucessor ou fechamento ao concluir', async () => {
  const handler = createCommercialQueueHandler({ repository: repository() });
  const response = await handler(
    event('POST', {
      command: 'complete',
      action_id: result.actionId,
      expected_version: 1,
    })
  );
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body || '{}').error, /sucessora|fechar/i);
});

test('POST /api/commercial-queue registra contato manual e continuidade sem transporte', async () => {
  let received: Record<string, unknown> | undefined;
  const handler = createCommercialQueueHandler({
    repository: repository({
      recordManualContact: async (input) => {
        received = input as unknown as Record<string, unknown>;
        return {
          ...result,
          state: 'completed',
          eventId: 'manual-event',
          commandId: 'manual-command',
          contactType: 'phone_call',
          occurredAt: '2026-09-12T11:30:00.000Z',
          note: 'Cliente confirmou interesse.',
          resultCode: 'follow_up_agreed',
          countsAsFollowUp: true,
          continuationType: 'successor',
          source: 'operator_statement',
        };
      },
    }),
  });
  const response = await handler(
    event('POST', {
      command: 'manual_contact',
      command_id: 'manual-command',
      opportunity_id: result.opportunityId,
      action_id: result.actionId,
      expected_version: 1,
      contact_type: 'phone_call',
      occurred_at: '2026-09-12T11:30:00.000Z',
      note: 'Cliente confirmou interesse.',
      result_code: 'follow_up_agreed',
      counts_as_follow_up: true,
      continuation: {
        type: 'successor',
        schedule: {
          kind: 'review',
          due_date: '2026-09-15',
          due_time: '14:00',
          reason: 'Revisar retorno',
        },
      },
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal(received?.commandId, 'manual-command');
  assert.equal(received?.actor, 'authenticated-operator');
  assert.equal(received?.countsAsFollowUp, true);
  assert.deepEqual(received?.continuation, {
    type: 'successor',
    schedule: {
      kind: 'review',
      dueDate: '2026-09-15',
      dueTime: '14:00',
      reason: 'Revisar retorno',
    },
  });
  assert.deepEqual(JSON.parse(response.body || '{}'), {
    action_id: result.actionId,
    opportunity_id: result.opportunityId,
    state: 'completed',
    version: result.version,
    closed: false,
    successor: null,
    event_id: 'manual-event',
    command_id: 'manual-command',
    contact_type: 'phone_call',
    occurred_at: '2026-09-12T11:30:00.000Z',
    note: 'Cliente confirmou interesse.',
    result_code: 'follow_up_agreed',
    result_label: 'Próximo passo combinado',
    counts_as_follow_up: true,
    continuation_type: 'successor',
    source: 'operator_statement',
  });
});

test('POST /api/commercial-queue exige continuidade no contato manual', async () => {
  let calls = 0;
  const handler = createCommercialQueueHandler({
    repository: repository({
      recordManualContact: async () => {
        calls += 1;
        throw new Error('não deveria chamar o repositório');
      },
    }),
  });
  const response = await handler(
    event('POST', {
      command: 'manual_contact',
      command_id: 'manual-command',
      opportunity_id: result.opportunityId,
      action_id: result.actionId,
      expected_version: 1,
      contact_type: 'phone_call',
      occurred_at: '2026-09-12T11:30:00.000Z',
      result_code: 'other',
      counts_as_follow_up: false,
    })
  );
  assert.equal(response.statusCode, 400);
  assert.match(
    JSON.parse(response.body || '{}').error,
    /continuidade|sucessora|aguardar|fechamento/i
  );
  assert.equal(calls, 0);
});

test('POST /api/commercial-queue rejeita data impossível antes do repositório', async () => {
  let calls = 0;
  const handler = createCommercialQueueHandler({
    repository: repository({
      recordManualContact: async () => {
        calls += 1;
        return {
          ...result,
          state: 'completed',
          eventId: 'manual-event',
          commandId: 'manual-command',
          contactType: 'phone_call',
          occurredAt: '2026-02-31T10:00:00-03:00',
          note: null,
          resultCode: 'not_interested',
          countsAsFollowUp: false,
          continuationType: 'close',
          source: 'operator_statement',
        };
      },
    }),
  });
  const response = await handler(
    event('POST', {
      command: 'manual_contact',
      command_id: 'manual-command',
      opportunity_id: result.opportunityId,
      action_id: result.actionId,
      expected_version: 1,
      contact_type: 'phone_call',
      occurred_at: '2026-02-31T10:00:00-03:00',
      result_code: 'not_interested',
      counts_as_follow_up: false,
      continuation: { type: 'close', reason: 'Cliente não prosseguiu.' },
    })
  );

  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body || '{}').error, /data e hora|inválid/i);
  assert.equal(calls, 0);
});

test('POST /api/commercial-queue retorna conflito seguro sem vazar erro do banco', async () => {
  const handler = createCommercialQueueHandler({
    repository: repository({
      rescheduleAction: async () => {
        throw new ActionConflictError();
      },
    }),
  });
  const response = await handler(
    event('POST', {
      command: 'reschedule',
      action_id: result.actionId,
      expected_version: 1,
      kind: 'review',
      due_date: '2026-09-15',
      reason: 'Atualizar revisão',
    })
  );
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body || '{}'), {
    error: 'A fila mudou. Recarregue e tente novamente.',
  });
});

test('GET /api/commercial-queue expõe histórico com tipo, ator, origem e motivo', async () => {
  const history: OpportunityActionHistoryEntry[] = [
    {
      eventId: 'action:created',
      actionId: result.actionId,
      type: 'created',
      actor: 'system',
      timestamp: '2026-09-11T12:00:00.000Z',
      origin: 'automatic',
      reason: 'Primeiro atendimento',
      state: 'active',
      replacementActionId: null,
    },
  ];
  const handler = createCommercialQueueHandler({
    repository: repository({ listHistory: async () => history }),
  });
  const response = await handler(
    event('GET', {}, { opportunity_id: result.opportunityId, view: 'history' })
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body || '{}'), {
    opportunity_id: result.opportunityId,
    data: [
      {
        event_id: 'action:created',
        action_id: result.actionId,
        type: 'created',
        actor: 'system',
        timestamp: '2026-09-11T12:00:00.000Z',
        origin: 'automatic',
        reason: 'Primeiro atendimento',
        state: 'active',
        replacement_action_id: null,
      },
    ],
  });
});
