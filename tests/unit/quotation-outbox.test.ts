import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  InMemoryQuotationOutboxRepository,
  type EnqueueQuotationOutboxInput,
} from '../../api/_db/quotation-outbox-repository.js';
import {
  createQuotationOutboxProviderAdapters,
  processQuotationOutbox,
} from '../../api/_functions/quotation-outbox-worker.js';
import { createPublicQuotationHandler } from '../../api/_functions/public-quotation.js';
import { getQuotationTemplate } from '../../api/_functions/lib/quotation-templates.js';

const base: EnqueueQuotationOutboxInput = {
  eventType: 'quotation.created',
  provider: 'crm',
  quotationId: 'quote-1',
  revisionId: 'revision-1',
  businessNumber: 'ORC-20260001',
  idempotencyKey: 'created:quote-1:revision-1',
  now: new Date('2026-08-05T10:00:00.000Z'),
};

async function queued(options: ConstructorParameters<typeof InMemoryQuotationOutboxRepository>[0] = {}) {
  const repository = new InMemoryQuotationOutboxRepository(options);
  await repository.enqueue(base);
  return repository;
}

test('quotation producer queues created event inside aggregate transaction', async () => {
  const source = await readFile(new URL('../../api/_db/quote-repository.ts', import.meta.url), 'utf8');
  const transaction = source.indexOf('database.transaction(async (tx)');
  const enqueue = source.indexOf("eventType: 'quotation.created'");
  assert.ok(transaction >= 0);
  assert.ok(enqueue > transaction);
  assert.match(source.slice(enqueue, enqueue + 500), /quotationId|revisionId|businessNumber/);
});

test('outbox ignores duplicate idempotency keys and persists canonical references only', async () => {
  const repository = new InMemoryQuotationOutboxRepository();
  const first = await repository.enqueue(base);
  const second = await repository.enqueue({ ...base, now: new Date('2026-08-05T11:00:00.000Z') });
  assert.equal(first.id, second.id);
  assert.equal((await repository.list()).length, 1);
  assert.deepEqual(first.payloadReference, {
    quotationId: 'quote-1',
    revisionId: 'revision-1',
    businessNumber: 'ORC-20260001',
  });
  assert.equal('email' in first.payloadReference, false);
  assert.equal('telefone' in first.payloadReference, false);
  assert.equal('secret' in first.payloadReference, false);
});

test('lease prevents a second worker from claiming an event concurrently', async () => {
  const repository = await queued();
  const now = new Date('2026-08-05T10:00:01.000Z');
  const first = await repository.claimDueEvents({ owner: 'worker-a', now, leaseMs: 30_000 });
  const second = await repository.claimDueEvents({ owner: 'worker-b', now, leaseMs: 30_000 });
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(first[0]?.leaseOwner, 'worker-a');
});

test('failed delivery increments attempts and schedules exponential backoff', async () => {
  const repository = await queued({ retryBaseMs: 1000, retryMaxMs: 10_000, maxAttempts: 3 });
  const now = new Date('2026-08-05T10:00:01.000Z');
  const [event] = await repository.claimDueEvents({ owner: 'worker-a', now, leaseMs: 30_000 });
  const failed = await repository.markFailed(event.id, 'worker-a', new Error('provider details'), now);
  assert.equal(failed?.status, 'retry');
  assert.equal(failed?.attempts, 1);
  assert.equal(failed?.lastErrorClass, 'Error');
  assert.equal(failed?.nextAttemptAt.toISOString(), '2026-08-05T10:00:02.000Z');
  assert.equal(failed && String(failed.lastErrorClass).includes('provider details'), false);
});

test('exhausted delivery becomes observable dead-letter state', async () => {
  const repository = await queued({ retryBaseMs: 1, maxAttempts: 2 });
  let now = new Date('2026-08-05T10:00:01.000Z');
  let [event] = await repository.claimDueEvents({ owner: 'worker-a', now, leaseMs: 30_000 });
  await repository.markFailed(event.id, 'worker-a', new Error('first'), now);
  now = new Date('2026-08-05T10:00:02.000Z');
  [event] = await repository.claimDueEvents({ owner: 'worker-a', now, leaseMs: 30_000 });
  const dead = await repository.markFailed(event.id, 'worker-a', new Error('second'), now);
  assert.equal(dead?.status, 'dead_letter');
  assert.equal(dead?.attempts, 2);
  assert.equal(dead?.leaseOwner, null);
});

test('worker marks success only after provider accepts and never deletes saved quotation', async () => {
  const repository = await queued();
  const savedQuotations = new Map([['quote-1', { status: 'rascunho' }]]);
  const seen: unknown[] = [];
  const workerResult = await processQuotationOutbox({
    repository,
    owner: 'worker-a',
    now: () => new Date('2026-08-05T10:00:01.000Z'),
    adapters: createQuotationOutboxProviderAdapters({
      crm: async (context) => {
        seen.push(context);
        throw new Error('CRM unavailable');
      },
    }),
  });
  assert.deepEqual(workerResult, {
    claimed: 1,
    delivered: 0,
    retried: 1,
    deadLettered: 0,
    leaseLost: 0,
  });
  assert.deepEqual(savedQuotations.get('quote-1'), { status: 'rascunho' });
  assert.deepEqual(seen, [{
    eventType: 'quotation.created',
    provider: 'crm',
    reference: {
      quotationId: 'quote-1',
      revisionId: 'revision-1',
      businessNumber: 'ORC-20260001',
    },
    idempotencyKey: 'created:quote-1:revision-1',
  }]);
});

test('worker records provider acceptance and message id', async () => {
  const repository = await queued();
  const result = await processQuotationOutbox({
    repository,
    owner: 'worker-a',
    now: () => new Date('2026-08-05T10:00:01.000Z'),
    adapters: createQuotationOutboxProviderAdapters({
      crm: async () => ({ accepted: true, providerMessageId: 'crm-effect-1' }),
    }),
  });
  assert.equal(result.delivered, 1);
  const [event] = await repository.list();
  assert.equal(event?.status, 'delivered');
  assert.equal(event?.providerMessageId, 'crm-effect-1');
});

test('issued event is queued only after immutable document rendering succeeds', async () => {
  process.env.CRM_CORE_QUOTES_ENABLED = 'true';
  process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
  const outbox = new InMemoryQuotationOutboxRepository();
  const template = getQuotationTemplate('padrao')!;
  const revision = {
    id: 'revision-1',
    status: 'enviado',
    templatePadrao: template.key,
    templateHash: template.hash,
    validadeDias: 15,
    createdAt: new Date('2026-08-05T10:00:00.000Z'),
    clienteNome: 'Cliente',
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
  };
  const snapshot = {
    quotation: { id: 'quote-1', businessNumber: 'ORC-20260001' },
    revision,
    templateVersion: null,
    sectionsSnapshot: {},
    items: [],
  } as any;
  const values = new Map<string, unknown>();
  const store = {
    async get<T>(key: string) { return (values.get(key) as T | undefined) ?? null; },
    async set(key: string, value: unknown) { values.set(key, value); return 'OK'; },
    async del(key: string) { values.delete(key); return 1; },
  };
  const handler = createPublicQuotationHandler({
    repository: { get: async () => snapshot } as any,
    store,
    token: () => 'Z'.repeat(32),
    now: () => Date.parse('2026-08-05T10:00:00.000Z'),
    outbox,
    renderPdf: async () => { throw new Error('render failed'); },
  });
  await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{"quotationId":"quote-1"}' } as any);
  const failed = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { token: 'Z'.repeat(32), format: 'pdf' }, body: '' } as any);
  assert.equal(failed.statusCode, 503);
  assert.equal((await outbox.list()).length, 0);

  const successHandler = createPublicQuotationHandler({
    repository: { get: async () => snapshot } as any,
    store,
    token: () => 'Y'.repeat(32),
    now: () => Date.parse('2026-08-05T10:00:00.000Z'),
    outbox,
    renderPdf: async () => Buffer.from('%PDF-1.7\\nbody\\n%%EOF'),
  });
  await successHandler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{"quotationId":"quote-1"}' } as any);
  const response = await successHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { token: 'Y'.repeat(32), format: 'pdf' }, body: '' } as any);
  assert.equal(response.statusCode, 200);
  const [event] = await outbox.list();
  assert.equal(event?.eventType, 'quotation.issued');
  assert.equal(event?.provider, 'n8n');
});

test('provider rejection is retried instead of being marked delivered', async () => {
  const repository = await queued({ maxAttempts: 2 });
  const result = await processQuotationOutbox({
    repository,
    owner: 'worker-a',
    now: () => new Date('2026-08-05T10:00:01.000Z'),
    adapters: createQuotationOutboxProviderAdapters({
      crm: async () => ({ accepted: false }),
    }),
  });
  assert.equal(result.retried, 1);
  const [event] = await repository.list();
  assert.equal(event?.status, 'retry');
});
