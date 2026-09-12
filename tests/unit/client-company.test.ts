import test from 'node:test';
import assert from 'node:assert/strict';

import type { FunctionEvent } from '../../api/_http/types.js';
import { createHandler as createLeadsHandler } from '../../api/_modules/leads-clients.js';
import {
  createHandler as createClientDetailHandler,
  type ClientCommercialRepository,
} from '../../api/_modules/client-detail.js';
import { createMemoryClientRepository } from '../../api/_modules/client-repository.js';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

function event(
  method: FunctionEvent['httpMethod'],
  body: Record<string, unknown>,
  queryStringParameters: Record<string, string> = {},
): FunctionEvent {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters,
    body: JSON.stringify(body),
  };
}

function parse(result: { statusCode?: number; body?: string }) {
  return { statusCode: result.statusCode, body: JSON.parse(result.body || '{}') };
}

const commercial: ClientCommercialRepository = {
  latestQuotation: async () => null,
  activeDeal: async () => null,
  orders: async () => [],
};

test('empresa é opcional ao criar o cliente e pode ser adicionada depois pela API', async () => {
  const repository = createMemoryClientRepository({
    idFactory: () => CLIENT_ID,
    now: () => new Date('2026-09-11T12:00:00.000Z'),
  });
  const createClient = createLeadsHandler({ repository });
  const clientDetail = createClientDetailHandler({ repository, commercial });

  const created = parse(await createClient(event('POST', { nome: 'Maria Cliente' })));
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.data.empresa, null);

  const updated = parse(
    await clientDetail(
      event('PUT', { empresa: '  Empresa Exemplo  ' }, { name: CLIENT_ID }),
    ),
  );
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.empresa, 'Empresa Exemplo');

  const fetched = parse(
    await clientDetail(event('GET', {}, { name: CLIENT_ID })),
  );
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.body.empresa, 'Empresa Exemplo');
});

test('POST /leads-clients only creates clients and refuses tipo=lead', async () => {
  const repository = createMemoryClientRepository({
    idFactory: () => CLIENT_ID,
    now: () => new Date('2026-09-11T12:00:00.000Z'),
  });
  const createClient = createLeadsHandler({ repository });

  const lead = parse(
    await createClient(event('POST', { nome: 'Fulano Lead', tipo: 'lead' })),
  );
  assert.equal(lead.statusCode, 400);
  // The refusal must name the real capture channels instead of claiming every
  // lead comes from a proposal.
  assert.match(String(lead.body.error), /cadastra clientes/i);
  assert.match(String(lead.body.error), /site/i);
  assert.match(String(lead.body.error), /WhatsApp/i);
  assert.doesNotMatch(String(lead.body.error), /propostas/i);
  assert.equal(
    (await repository.list({})).data.length,
    0,
    'a refused lead must not create a client record'
  );

  const client = parse(
    await createClient(event('POST', { nome: 'Fulano Cliente', tipo: 'cliente' })),
  );
  assert.equal(client.statusCode, 201);
  assert.equal(client.body.data.tipo, 'cliente');

  const invalid = parse(
    await createClient(event('POST', { nome: 'Fulano Outro', tipo: 'parceiro' })),
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal((await repository.list({})).data.length, 1);
});
