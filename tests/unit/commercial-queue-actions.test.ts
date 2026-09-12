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
