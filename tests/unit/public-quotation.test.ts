import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createPublicQuotationHandler,
  isRevisionBoundPublicQuotationUrl,
} from '../../api/_functions/public-quotation.js';
import { getQuotationTemplate } from '../../api/_functions/lib/quotation-templates.js';

process.env.CRM_CORE_QUOTES_ENABLED = 'true';
process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
const template = getQuotationTemplate('padrao')!;
const versionedTemplate = getQuotationTemplate('minimalista')!;
const now = Date.parse('2026-08-07T12:00:00.000Z');

function snapshot(status = 'enviado', templateVersion: unknown = null) {
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
    templateVersion,
    sectionsSnapshot: {},
    items: [],
  } as any;
}

type StoreWrite = { key: string; value: unknown; options?: { ex?: number } };

function store(clock: () => number = () => now) {
  const values = new Map<string, { value: unknown; expiresAt?: number }>();
  const writes: StoreWrite[] = [];
  return {
    values,
    writes,
    async get<T>(key: string) {
      const entry = values.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== undefined && entry.expiresAt <= clock()) {
        values.delete(key);
        return null;
      }
      return entry.value as T;
    },
    async set(key: string, value: unknown, options?: { ex?: number }) {
      writes.push({ key, value, options });
      values.set(key, {
        value,
        expiresAt: options?.ex ? clock() + options.ex * 1000 : undefined,
      });
      return 'OK';
    },
    async del(key: string) {
      values.delete(key);
      return 1;
    },
  };
}

function event(httpMethod: string, queryStringParameters: Record<string, string> = {}, body = '') {
  return { httpMethod, headers: {}, queryStringParameters, body } as any;
}

test('accepts only revision-bound public quotation URLs', () => {
  assert.equal(isRevisionBoundPublicQuotationUrl('/api/view?q=ORC-1'), false);
  assert.equal(isRevisionBoundPublicQuotationUrl('/api/public-quotation?token=' + 'A'.repeat(32)), true);
  assert.equal(isRevisionBoundPublicQuotationUrl('/api/public-quotation?token=short'), false);
  assert.equal(isRevisionBoundPublicQuotationUrl('https://evil.example/?token=' + 'A'.repeat(32)), false);
});

test('issues a hashed revision-bound token and renders immutable HTML without Frappe fetches', async () => {
  const fakeStore = store();
  const repository = { get: async (id: string) => id === '22222222-2222-4222-8222-222222222222' ? snapshot() : null };
  const token = 'A'.repeat(32);
  const handler = createPublicQuotationHandler({ repository: repository as any, store: fakeStore, token: () => token, now: () => now });
  const issued = await handler(event('POST', {}, JSON.stringify({ revisionId: '22222222-2222-4222-8222-222222222222' })));
  assert.equal(issued.statusCode, 201);
  assert.equal(fakeStore.writes.length, 1);
  assert.equal(fakeStore.writes[0].key, `aspen:public-quotation:${createHash('sha256').update(token).digest('hex')}`);
  assert.equal(fakeStore.writes[0].options?.ex, 7 * 24 * 60 * 60);
  assert.doesNotMatch(JSON.stringify(fakeStore.writes[0].value), new RegExp(token));

  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls += 1;
    throw new Error(`unexpected Frappe fetch: ${String(input)}`);
  }) as typeof fetch;
  try {
    const response = await handler(event('GET', { token }));
    assert.equal(response.statusCode, 200);
    assert.match(response.body!, /Cliente Teste/);
    assert.equal(fetchCalls, 0);
    assert.ok(!response.body!.includes('ERPNEXT_TOKEN'));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('renders the immutable PostgreSQL snapshot with its versioned template', async () => {
  const fakeStore = store();
  const selectedVersion = {
    id: '33333333-3333-4333-8333-333333333333',
    version: 7,
    source: versionedTemplate.source,
    sourceHash: versionedTemplate.hash,
    template: { key: versionedTemplate.key, name: versionedTemplate.name },
  };
  const token = 'V'.repeat(32);
  const handler = createPublicQuotationHandler({
    repository: { get: async () => snapshot('enviado', selectedVersion) } as any,
    store: fakeStore,
    token: () => token,
    now: () => now,
  });
  await handler(event('POST', {}, JSON.stringify({ quotationId: 'q' })));
  const response = await handler(event('GET', { token }));
  assert.equal(response.statusCode, 200);
  assert.match(response.body!, /Proposta comercial/);
  assert.equal(response.headers?.['X-Quotation-Template-Key'], versionedTemplate.key);
  assert.equal(response.headers?.['X-Quotation-Template-Version'], '7');
  assert.equal(response.headers?.['X-Quotation-Template-Hash'], versionedTemplate.hash);
});

test('sanitizes KV failures at the public handler boundary', async () => {
  const providerError = new Error('secret provider credentials leaked');
  const handler = createPublicQuotationHandler({
    repository: { get: async () => snapshot() } as any,
    store: {
      get: async () => { throw providerError; },
      set: async () => { throw providerError; },
      del: async () => 1,
    },
    now: () => now,
  });
  const response = await handler(event('GET', { token: 'K'.repeat(32) }));
  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body!, /secret provider credentials leaked/);
  assert.match(response.body!, /Tente novamente/);
});

test('rejects invalid, expired, revoked and draft links', async () => {
  const fakeStore = store();
  const repository = { get: async () => snapshot() };
  const handler = createPublicQuotationHandler({ repository: repository as any, store: fakeStore, token: () => 'B'.repeat(32), now: () => now });
  assert.equal((await handler(event('GET', { token: 'invalid-token' }))).statusCode, 401);
  const issued = await handler(event('POST', {}, JSON.stringify({ quotationId: 'q' })));
  const token = JSON.parse(issued.body!).token;
  assert.equal((await handler(event('DELETE', { token }))).statusCode, 204);
  assert.equal(fakeStore.writes.at(-1)?.options?.ex, 24 * 60 * 60);
  assert.equal((await handler(event('GET', { token }))).statusCode, 404);
  const expiredHandler = createPublicQuotationHandler({ repository: repository as any, store: fakeStore, token: () => 'C'.repeat(32), now: () => now + 8 * 24 * 60 * 60 * 1000 });
  const expired = await handler(event('POST', {}, JSON.stringify({ quotationId: 'q' })));
  assert.equal((await expiredHandler(event('GET', { token: JSON.parse(expired.body!).token }))).statusCode, 410);
  let storageNow = now;
  const expiringStore = store(() => storageNow);
  await expiringStore.set('expiring', { ok: true }, { ex: 60 });
  storageNow += 61 * 1000;
  assert.equal(await expiringStore.get('expiring'), null);
  const draftHandler = createPublicQuotationHandler({ repository: { get: async () => snapshot('rascunho') } as any, store: store(), token: () => 'D'.repeat(32), now: () => now });
  assert.equal((await draftHandler(event('POST', {}, JSON.stringify({ quotationId: 'q' })))).statusCode, 409);
});

test('keeps a public token bound to its original revision after a newer revision exists', async () => {
  const fakeStore = store();
  const oldRevisionId = '44444444-4444-4444-8444-444444444444';
  const newRevisionId = '55555555-5555-4555-8555-555555555555';
  const oldSnapshot = snapshot();
  oldSnapshot.revision.id = oldRevisionId;
  oldSnapshot.revision.total = '10.00';
  const newSnapshot = snapshot();
  newSnapshot.revision.id = newRevisionId;
  newSnapshot.revision.total = '20.00';
  const repository = {
    get: async (id: string) => id === oldRevisionId ? oldSnapshot : id === newRevisionId ? newSnapshot : null,
  };
  const token = 'R'.repeat(32);
  const handler = createPublicQuotationHandler({
    repository: repository as any,
    store: fakeStore,
    token: () => token,
    now: () => now,
  });
  const issued = await handler(event('POST', {}, JSON.stringify({ revisionId: oldRevisionId })));
  assert.equal(issued.statusCode, 201);
  const response = await handler(event('GET', { token }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['X-Document-Revision'], oldRevisionId);
  assert.match(response.body!, /10,00/);
  assert.doesNotMatch(response.body!, /20,00/);
});

test('keeps an issued revision PDF and checksum immutable after a source change', async () => {
  const fakeStore = store();
  const oldRevisionId = '66666666-6666-4666-8666-666666666666';
  const newRevisionId = '77777777-7777-4777-8777-777777777777';
  const oldSnapshot = snapshot();
  oldSnapshot.revision.id = oldRevisionId;
  oldSnapshot.revision.total = '10.00';
  const newSnapshot = snapshot();
  newSnapshot.revision.id = newRevisionId;
  newSnapshot.revision.total = '20.00';
  const snapshots = new Map([[oldRevisionId, oldSnapshot], [newRevisionId, newSnapshot]]);
  const token = 'P'.repeat(32);
  const renderPdf = async (html: string) => Buffer.from(`%PDF-1.7\\n${html}\\n%%EOF`);
  const handler = createPublicQuotationHandler({
    repository: { get: async (id: string) => snapshots.get(id) || null } as any,
    store: fakeStore,
    token: () => token,
    now: () => now,
    renderPdf,
  });
  await handler(event('POST', {}, JSON.stringify({ revisionId: oldRevisionId })));
  const oldPdf = await handler(event('GET', { token, format: 'pdf' }));
  assert.equal(oldPdf.statusCode, 200);
  assert.equal(oldPdf.headers?.['X-Document-Revision'], oldRevisionId);
  const oldBody = Buffer.from(oldPdf.body!, 'base64');
  assert.match(oldBody.toString(), /10,00/);
  assert.equal(oldPdf.headers?.['X-Document-Checksum'], createHash('sha256').update(oldBody).digest('hex'));
  assert.doesNotMatch(oldBody.toString(), /20,00/);
});

test('returns PDF signature, checksum, size and deterministic revision/template metadata', async () => {
  const fakeStore = store();
  const pdf = Buffer.from('%PDF-1.7\nbody\n%%EOF');
  const token = 'E'.repeat(32);
  const handler = createPublicQuotationHandler({
    repository: { get: async () => snapshot() } as any,
    store: fakeStore,
    token: () => token,
    now: () => now,
    renderPdf: async () => pdf,
  });
  const issued = await handler(event('POST', {}, JSON.stringify({ quotationId: 'q' })));
  const response = await handler(event('GET', { token: JSON.parse(issued.body!).token, format: 'pdf' }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'application/pdf');
  assert.equal(response.headers?.['X-Document-Revision'], snapshot().revision.id);
  assert.equal(response.headers?.['X-Quotation-Template-Key'], template.key);
  assert.equal(response.headers?.['X-Quotation-Template-Version'], 'legacy');
  assert.equal(response.headers?.['X-Quotation-Template-Hash'], template.hash);
  assert.equal(response.headers?.['Content-Length'], String(pdf.length));
  assert.equal(response.headers?.['X-Document-Size'], String(pdf.length));
  assert.equal(response.headers?.['X-Document-Checksum'], createHash('sha256').update(pdf).digest('hex'));
  assert.match(response.headers?.['X-Document-Checksum'] || '', /^[0-9a-f]{64}$/);
  assert.equal(Buffer.from(response.body!, 'base64').toString(), pdf.toString());
  assert.equal(response.isBase64Encoded, true);
});
