import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCoreHandler } from '../../api/_functions/quotations-core.js';
import { QuoteManagementConflictError } from '../../api/_db/quote-draft-management-repository.js';

function event(method: string, id: string, body: Record<string, unknown>) {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters: { id },
    body: JSON.stringify(body),
  } as const;
}

function listEvent(status: string) {
  return {
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { status },
    body: '',
  } as const;
}

const detail = {
  id: 'ORC-20260001',
  status: 'Enviado',
  status_canonical: 'enviado',
  concurrency_token: '2026-07-01T12:00:00.000Z',
  revision_id: '11111111-1111-4111-8111-111111111111',
  revision_history: [],
};

test('core lifecycle actions forward canonical status and revision payloads', async () => {
  const calls: unknown[][] = [];
  const lifecycle = {
    setStatus: async (id: string, input: unknown) => {
      calls.push(['set_status', id, input]);
      return { ...detail, status: 'Aprovado', status_canonical: 'aprovado' };
    },
    createRevision: async (id: string, input: unknown) => {
      calls.push(['create_revision', id, input]);
      return { ...detail, status: 'Rascunho', status_canonical: 'rascunho', revision: 2 };
    },
  };
  const handler = createCoreHandler({
    lifecycleRepository: lifecycle,
    repository: {
      list: async () => ({ rows: [], total: 0, page: 1, limit: 50, statusSummary: {} }),
      get: async () => detail,
      update: async () => detail,
    },
  });

  const statusResponse = await handler(event('POST', detail.id, {
    action: 'set_status',
    status: 'aprovado',
    concurrency_token: detail.concurrency_token,
  }));
  assert.equal(statusResponse.statusCode, 200);
  assert.equal(JSON.parse(statusResponse.body || '{}').status_canonical, 'aprovado');

  const revisionResponse = await handler(event('POST', detail.id, {
    action: 'create_revision',
    source_revision_id: detail.revision_id,
    concurrency_token: detail.concurrency_token,
  }));
  assert.equal(revisionResponse.statusCode, 200);
  assert.equal(JSON.parse(revisionResponse.body || '{}').revision, 2);
  assert.deepEqual(calls.map((call) => call[0]), ['set_status', 'create_revision']);
});

test('core lifecycle rejects invalid actions and preserves 409 conflicts', async () => {
  const handler = createCoreHandler({
    lifecycleRepository: {
      setStatus: async () => { throw new QuoteManagementConflictError('Token desatualizado.'); },
      createRevision: async () => detail,
    },
    repository: {
      list: async () => ({ rows: [], total: 0, page: 1, limit: 50, statusSummary: {} }),
      get: async () => detail,
      update: async () => detail,
    },
  });

  const invalid = await handler(event('POST', detail.id, { action: 'set_status', status: 'vencido', concurrency_token: 't' }));
  assert.equal(invalid.statusCode, 400);
  const conflict = await handler(event('POST', detail.id, { action: 'set_status', status: 'perdido', concurrency_token: 't' }));
  assert.equal(conflict.statusCode, 409);
  assert.equal(JSON.parse(conflict.body || '{}').error, 'Token desatualizado.');
});

test('core list accepts trimmed/case-insensitive legacy aliases and rejects unknown statuses', async () => {
  const calls: string[] = [];
  const handler = createCoreHandler({
    repository: {
      list: async (options) => {
        calls.push(options.status || '');
        return { rows: [], total: 0, page: 1, limit: 50, statusSummary: {} };
      },
      get: async () => detail,
      update: async () => detail,
    },
  });
  const aliases = [
    ' Draft ',
    'dRaFt',
    ' iSsUeD ',
    ' open ',
    'rEpLiEd',
    ' expired ',
    ' EMITIDO ',
    ' ordered ',
    ' LOST ',
    ' cancelled ',
    ' RASCUNHO ',
    ' enviado ',
    ' APROVADO ',
    ' perdido ',
    ' aLl ',
  ];
  for (const alias of aliases) {
    const response = await handler(listEvent(alias));
    assert.equal(response.statusCode, 200, `status alias ${alias} should be accepted`);
  }
  assert.deepEqual(calls, aliases.map((alias) => alias.trim()));
  const invalid = await handler(listEvent('not-a-status'));
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.length, aliases.length);
});
