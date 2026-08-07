import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicQuotationHandler } from '../../api/_functions/public-quotation.js';
import { getQuotationTemplate } from '../../api/_functions/lib/quotation-templates.js';

process.env.CRM_CORE_QUOTES_ENABLED = 'true';
process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
const template = getQuotationTemplate('padrao')!;
const now = Date.parse('2026-08-07T12:00:00.000Z');

function snapshot(status = 'enviado') {
  return {
    quotation: {
      id: '11111111-1111-4111-8111-111111111111',
      businessNumber: 'ORC-20260001',
    },
    revision: {
      id: '22222222-2222-4222-8222-222222222222',
      status,
      templatePadrao: template.key,
      templateHash: template.hash,
      validadeDias: 15,
      createdAt: new Date(now),
      clienteNome: 'Cliente Teste',
      clienteDocumento: null,
      clienteEmail: null,
      clienteTelefone: null,
      clienteEndereco: null,
      clienteNumero: null,
      clienteBairro: null,
      clienteComplemento: null,
      clienteMunicipio: null,
      clienteUf: null,
      clienteCep: null,
      clienteNotas: null,
      subtotal: '10.00',
      frete: '0.00',
      total: '10.00',
      fretePadrao: '0.00',
      secoesSnapshot: {},
    },
    templateVersion: null,
    sectionsSnapshot: {},
    items: [],
  } as any;
}

function store() {
  const values = new Map<string, unknown>();
  return {
    values,
    async get<T>(key: string) { return (values.get(key) as T) || null; },
    async set(key: string, value: unknown) { values.set(key, value); return 'OK'; },
    async del(key: string) { values.delete(key); return 1; },
  };
}

function event(httpMethod: string, queryStringParameters: Record<string, string> = {}, body = '') {
  return { httpMethod, headers: {}, queryStringParameters, body } as any;
}

test('issues a revision-bound token and renders immutable HTML without Frappe fetches', async () => {
  const fakeStore = store();
  const repository = { get: async (id: string) => id === '22222222-2222-4222-8222-222222222222' ? snapshot() : null };
  const handler = createPublicQuotationHandler({ repository: repository as any, store: fakeStore, token: () => 'A'.repeat(32), now: () => now });
  const issued = await handler(event('POST', {}, JSON.stringify({ revisionId: '22222222-2222-4222-8222-222222222222' })));
  assert.equal(issued.statusCode, 201);
  const token = JSON.parse(issued.body!).token;
  const response = await handler(event('GET', { token }));
  assert.equal(response.statusCode, 200);
  assert.match(response.body!, /Cliente Teste/);
  assert.ok(!response.body!.includes('ERPNEXT_TOKEN'));
});

test('rejects invalid, expired, revoked and draft links', async () => {
  const fakeStore = store();
  const repository = { get: async () => snapshot() };
  const handler = createPublicQuotationHandler({ repository: repository as any, store: fakeStore, token: () => 'B'.repeat(32), now: () => now });
  assert.equal((await handler(event('GET', { token: 'invalid-token' }))).statusCode, 401);
  const issued = await handler(event('POST', {}, JSON.stringify({ quotationId: 'q' })));
  const token = JSON.parse(issued.body!).token;
  assert.equal((await handler(event('DELETE', { token }))).statusCode, 204);
  assert.equal((await handler(event('GET', { token }))).statusCode, 404);
  const expiredHandler = createPublicQuotationHandler({ repository: repository as any, store: fakeStore, token: () => 'C'.repeat(32), now: () => now + 8 * 24 * 60 * 60 * 1000 });
  const expired = await handler(event('POST', {}, JSON.stringify({ quotationId: 'q' })));
  assert.equal((await expiredHandler(event('GET', { token: JSON.parse(expired.body!).token }))).statusCode, 410);
  const draftHandler = createPublicQuotationHandler({ repository: { get: async () => snapshot('rascunho') } as any, store: store(), token: () => 'D'.repeat(32), now: () => now });
  assert.equal((await draftHandler(event('POST', {}, JSON.stringify({ quotationId: 'q' })))).statusCode, 409);
});

test('returns PDF signature, checksum and deterministic revision metadata', async () => {
  const fakeStore = store();
  const pdf = Buffer.from('%PDF-1.7\nbody\n%%EOF');
  const handler = createPublicQuotationHandler({
    repository: { get: async () => snapshot() } as any,
    store: fakeStore,
    token: () => 'E'.repeat(32),
    now: () => now,
    renderPdf: async () => pdf,
  });
  const issued = await handler(event('POST', {}, JSON.stringify({ quotationId: 'q' })));
  const response = await handler(event('GET', { token: JSON.parse(issued.body!).token, format: 'pdf' }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'application/pdf');
  assert.equal(response.headers?.['X-Document-Revision'], snapshot().revision.id);
  assert.match(response.headers?.['X-Document-Checksum'] || '', /^[0-9a-f]{64}$/);
  assert.equal(response.isBase64Encoded, true);
});
