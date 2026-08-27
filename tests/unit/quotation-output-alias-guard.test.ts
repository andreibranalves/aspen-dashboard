import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoreHandler } from '../../api/_modules/quotations-core.js';

// Guarda #126: nomes duplicados de conceitos canônicos (#124) não podem voltar a
// aparecer no corpo HTTP; o envelope `canonical` é a única fonte desses conceitos.
const ALIAS_KEYS = [
  'quotation_name',
  'quote_id',
  'quote_revision_id',
  'revision_number',
  'client_id',
  'cliente_id',
  'validity_date',
  'derived_expired',
  'expiration_derived',
  'is_expired',
  'expirada',
  'updatedAt',
  'version_token',
  'optimistic_concurrency_token',
] as const;

const detail = {
  id: 'ORC-20260001',
  quotation_id: 'ORC-20260001',
  quotation_uuid: '11111111-1111-4111-8111-111111111111',
  revision_id: '22222222-2222-4222-8222-222222222222',
  revision: 1,
  status: 'rascunho' as const,
  cliente: 'Cliente teste',
  validade_dias: 15,
  frete: '0.00',
  subtotal: '90.00',
  total: '90.00',
  items: [],
  updated_at: '2026-07-01T12:00:00.000Z',
} as never;

function fakeDependencies(detailResponse: unknown) {
  return {
    repository: {
      get: async () => detailResponse,
      update: async () => detailResponse as never,
      list: async () => ({
        rows: [detailResponse as never],
        page: 1,
        limit: 50,
        total: 1,
        statusSummary: {},
      }),
    },
  };
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}') as Record<string, unknown>;
}

test('GET detail omits duplicate alias keys and keeps the canonical envelope', async () => {
  const handler = createCoreHandler(fakeDependencies({ ...detail }) as never);
  const result = await handler({ httpMethod: 'GET', queryStringParameters: { id: 'ORC-20260001' } });
  const body = parse(result);
  for (const alias of ALIAS_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(body, alias), false, `alias ${alias} não pode ser emitido`);
  }
  const canonical = body.canonical as Record<string, unknown>;
  assert.equal(canonical.businessNumber, 'ORC-20260001');
  assert.equal(canonical.concurrencyToken, '');
});

test('GET list rows omit duplicate alias keys and keep the canonical envelope', async () => {
  const handler = createCoreHandler(fakeDependencies({ ...detail }) as never);
  const result = await handler({ httpMethod: 'GET', queryStringParameters: {} });
  const body = parse(result);
  const [row] = body.data as Array<Record<string, unknown>>;
  for (const alias of ALIAS_KEYS) {
    if (alias === 'updatedAt') continue;
    assert.equal(Object.prototype.hasOwnProperty.call(row, alias), false, `alias ${alias} não pode ser emitido`);
  }
  const canonical = row.canonical as Record<string, unknown>;
  assert.equal(canonical.id, '11111111-1111-4111-8111-111111111111');
});

test('PUT response omits duplicate alias keys and keeps the canonical envelope', async () => {
  const handler = createCoreHandler(fakeDependencies({ ...detail }) as never);
  const result = await handler({
    httpMethod: 'PUT',
    queryStringParameters: { id: 'ORC-20260001' },
    body: '{}',
  });
  const body = parse(result);
  for (const alias of ALIAS_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(body, alias), false, `alias ${alias} não pode ser emitido`);
  }
});
