import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import {
  deriveOpaqueQuotationOutboxIdempotencyKey,
  enqueueQuotationSentEvent,
  InMemoryQuotationOutboxRepository,
  QuotationOutboxDurabilityError,
  QuotationOutboxIdempotencyConflictError,
  QuotationOutboxOwnershipError,
  type EnqueueQuotationOutboxInput,
} from '../../api/_db/quotation-outbox-repository.js';
import {
  configuredQuotationOutboxProviders,
  createConfiguredQuotationOutboxProviderAdapters,
  createQuotationOutboxProviderAdapters,
  processQuotationOutbox,
  quotationOutboxProviderTimeoutMs,
} from '../../api/_functions/quotation-outbox-worker.js';
import { createFakeOutboxBridge } from '../fixtures/fake-outbox-bridge.mjs';
import { main as runOutboxWorker, requiredConfiguration } from '../../scripts/quotation-outbox-worker.mjs';
import { createPublicQuotationHandler } from '../../api/_functions/public-quotation.js';
import { getQuotationTemplate } from '../../api/_functions/lib/quotation-templates.js';
import * as schema from '../../api/_db/schema.js';
import { clients, quotations, quotationOutboxEvents } from '../../api/_db/schema.js';
import { enqueueQuotationOutboxEvent } from '../../api/_db/quotation-outbox-repository.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

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

test('PostgreSQL rollback removes aggregate and outbox together', { skip: !TEST_DATABASE_URL }, async () => {
  const client = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
  const database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.resolve('drizzle') });
  const clientId = randomUUID();
  const quotationId = randomUUID();
  const revisionId = randomUUID();
  const businessNumber = `ORC-${new Date().getUTCFullYear()}${Math.floor(Math.random() * 10_000).toString().padStart(4, '0')}`;
  try {
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.insert(clients).values({ id: clientId, nome: 'Atomic test', arquivado: false });
        await transaction.insert(quotations).values({
          id: quotationId,
          businessNumber,
          clientId,
          status: 'rascunho',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await enqueueQuotationOutboxEvent(transaction, {
          ...base,
          quotationId,
          revisionId,
          businessNumber,
          idempotencyKey: `atomic:${quotationId}`,
        });
        throw new Error('injected PostgreSQL transaction failure');
      }),
      /injected PostgreSQL transaction failure/,
    );
    const savedQuote = await database
      .select()
      .from(quotations)
      .where(eq(quotations.id, quotationId));
    const savedOutbox = await database
      .select()
      .from(quotationOutboxEvents)
      .where(eq(quotationOutboxEvents.aggregateId, quotationId));
    assert.equal(savedQuote.length, 0);
    assert.equal(savedOutbox.length, 0);
  } finally {
    await database.delete(quotationOutboxEvents).where(eq(quotationOutboxEvents.aggregateId, quotationId)).catch(() => undefined);
    await database.delete(quotations).where(eq(quotations.id, quotationId)).catch(() => undefined);
    await database.delete(clients).where(eq(clients.id, clientId)).catch(() => undefined);
    await client.end({ timeout: 5 });
  }
});

test('quotation producer queues created event inside aggregate transaction', async () => {
  const source = await readFile(new URL('../../api/_db/quote-repository.ts', import.meta.url), 'utf8');
  const transaction = source.indexOf('database.transaction(async (tx)');
  const enqueue = source.indexOf("eventType: 'quotation.created'");
  assert.ok(transaction >= 0);
  assert.ok(enqueue > transaction);
  assert.match(source.slice(enqueue, enqueue + 500), /quotationId|revisionId|businessNumber/);
});

test('outbox ignores exact duplicate keys but rejects conflicting references', async () => {
  const repository = new InMemoryQuotationOutboxRepository();
  const first = await repository.enqueue(base);
  const second = await repository.enqueue({ ...base, now: new Date('2026-08-05T11:00:00.000Z') });
  assert.equal(first.id, second.id);
  await assert.rejects(
    repository.enqueue({ ...base, quotationId: 'other-quote' }),
    QuotationOutboxIdempotencyConflictError,
  );
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

test('external idempotency keys become bounded opaque scoped hashes', () => {
  const emailKey = deriveOpaqueQuotationOutboxIdempotencyKey(
    'cliente@example.com:super-secret',
    'quotation.sent:crm:quote-1:revision-1',
    'quote-1:revision-1',
  );
  assert.match(emailKey, /^client:[0-9a-f]{64}$/);
  assert.equal(emailKey.includes('cliente@example.com'), false);
  assert.equal(emailKey.includes('super-secret'), false);
  assert.equal(
    deriveOpaqueQuotationOutboxIdempotencyKey(
      'cliente@example.com:super-secret',
      'fallback',
      'quote-1:revision-1',
    ),
    emailKey,
  );
  assert.equal(
    deriveOpaqueQuotationOutboxIdempotencyKey('  cliente@example.com:super-secret  ', 'fallback', 'quote-1:revision-1'),
    emailKey,
  );
  assert.equal(
    deriveOpaqueQuotationOutboxIdempotencyKey('   ', 'fallback', 'quote-1:revision-1'),
    'fallback',
  );
  assert.throws(
    () => deriveOpaqueQuotationOutboxIdempotencyKey({ secret: 'x' }, 'fallback', 'scope'),
    /inválida/,
  );
  assert.throws(
    () => deriveOpaqueQuotationOutboxIdempotencyKey(`  ${'x'.repeat(513)}  `, 'fallback', 'scope'),
    /inválida/,
  );
});

test('durability failure identifies provider acceptance without claiming durable success', () => {
  const error = new QuotationOutboxDurabilityError();
  assert.equal(error.statusCode, 503);
  assert.equal(error.providerAccepted, true);
  assert.equal(error.outboxDurable, false);
  assert.match(error.alertId, /^[0-9a-f-]{36}$/);
});

test('outbox worker is disabled without providers and does not claim events', async () => {
  const config = configuredQuotationOutboxProviders({ DATABASE_URL: 'postgres://internal.test/db' });
  assert.deepEqual(config, []);
  const env = { DATABASE_URL: 'postgres://internal.test/db' };
  assert.deepEqual(requiredConfiguration({}, env), []);
  let output = '';
  const originalLog = console.log;
  console.log = (value?: unknown) => { output = String(value); };
  try {
    assert.equal(await runOutboxWorker(env), 0);
  } finally {
    console.log = originalLog;
  }
  assert.match(output, /disabled/);

  const repository = await queued();
  const result = await processQuotationOutbox({
    repository,
    owner: 'worker-a',
    configuredProviders: ['n8n'],
    adapters: createQuotationOutboxProviderAdapters({ crm: async () => ({ accepted: true }) }),
  });
  assert.deepEqual(result, { claimed: 0, delivered: 0, retried: 0, deadLettered: 0, leaseLost: 0 });
  assert.equal((await repository.list())[0]?.status, 'pending');
});

test('worker claims only providers with configured adapters', async () => {
  const repository = new InMemoryQuotationOutboxRepository();
  await repository.enqueue(base);
  await repository.enqueue({
    ...base,
    provider: 'n8n',
    idempotencyKey: 'created:quote-1:revision-1:n8n',
  });
  const result = await processQuotationOutbox({
    repository,
    owner: 'worker-a',
    configuredProviders: ['crm'],
    adapters: createQuotationOutboxProviderAdapters({ crm: async () => ({ accepted: true }) }),
  });
  assert.deepEqual(result, { claimed: 1, delivered: 1, retried: 0, deadLettered: 0, leaseLost: 0 });
  assert.equal((await repository.list()).find((event) => event.provider === 'n8n')?.status, 'pending');
});

test('fake bridge accepts only canonical references and deduplicates idempotency', async () => {
  const bridge = await createFakeOutboxBridge();
  try {
    const adapters = createConfiguredQuotationOutboxProviderAdapters({
      crmUrl: `${bridge.url}/events`,
    });
    const context = {
      eventType: 'quotation.sent' as const,
      provider: 'crm' as const,
      reference: base,
      idempotencyKey: 'opaque-key',
    };
    assert.deepEqual(await adapters.crm.deliver(context), { accepted: true, providerMessageId: 'fake-1' });
    assert.deepEqual(await adapters.crm.deliver(context), { accepted: true, providerMessageId: 'fake-1' });
    assert.equal(bridge.requests.length, 2);
    assert.deepEqual(bridge.requests[0], {
      event_type: 'quotation.sent',
      provider: 'crm',
      quotation_id: 'quote-1',
      revision_id: 'revision-1',
      business_number: 'ORC-20260001',
      idempotency_key: 'opaque-key',
    });
    assert.equal('email' in bridge.requests[0], false);
    assert.equal('token' in bridge.requests[0], false);
    assert.equal('legacy_payload' in bridge.requests[0], false);
  } finally {
    await bridge.close();
  }
});

test('fake bridge exposes health and controlled provider failures', async () => {
  const healthy = await createFakeOutboxBridge();
  try {
    assert.equal((await fetch(`${healthy.url}/health`)).status, 200);
  } finally {
    await healthy.close();
  }

  const failed = await createFakeOutboxBridge({ mode: 'error' });
  try {
    const adapter = createConfiguredQuotationOutboxProviderAdapters({ crmUrl: `${failed.url}/events` }).crm;
    await assert.rejects(() => adapter.deliver({
      eventType: 'quotation.sent',
      provider: 'crm',
      reference: base,
      idempotencyKey: 'error-key',
    }), /rejeitou/);
  } finally {
    await failed.close();
  }

  const timedOut = await createFakeOutboxBridge({ mode: 'timeout', delayMs: 40 });
  try {
    const adapter = createConfiguredQuotationOutboxProviderAdapters({ crmUrl: `${timedOut.url}/events` }).crm;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(() => adapter.deliver({
      eventType: 'quotation.sent',
      provider: 'crm',
      reference: base,
      idempotencyKey: 'timeout-key',
      signal: controller.signal,
    }));
  } finally {
    await timedOut.close();
  }
});

test('configured provider adapters post canonical references without PII', async () => {
  let request: RequestInit | undefined;
  const adapters = createConfiguredQuotationOutboxProviderAdapters({
    n8nUrl: 'https://n8n.example.test/outbox',
    evolutionUrl: 'https://evolution.example.test/outbox',
    crmUrl: 'https://crm.example.test/outbox',
    n8nToken: 'runtime-only-secret',
    fetcher: async (_url, init) => {
      request = init;
      return new Response(JSON.stringify({ message_id: 'provider-1' }), { status: 202 });
    },
  });
  const result = await adapters.n8n.deliver({
    eventType: 'quotation.sent',
    provider: 'n8n',
    reference: base,
    idempotencyKey: 'sent:quote-1:revision-1',
  });
  assert.deepEqual(result, { accepted: true, providerMessageId: 'provider-1' });
  const body = JSON.parse(String(request?.body));
  assert.equal(body.quotation_id, 'quote-1');
  assert.equal('email' in body, false);
  assert.equal('telefone' in body, false);
  assert.equal(String(request?.body).includes('runtime-only-secret'), false);
});

test('quotation.sent rejects a revision not owned by the PostgreSQL quotation', async () => {
  const database = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    }),
  } as any;
  await assert.rejects(
    enqueueQuotationSentEvent(database, {
      provider: 'crm',
      quotationId: 'quote-1',
      revisionId: 'revision-other',
      businessNumber: 'ORC-20260001',
    }),
    QuotationOutboxOwnershipError,
  );
});

test('expired leases are reclaimable at the boundary and stale owners cannot acknowledge', async () => {
  const repository = await queued();
  const claimedAt = new Date('2026-08-05T10:00:00.000Z');
  const [claimed] = await repository.claimDueEvents({ owner: 'worker-a', now: claimedAt, leaseMs: 1_000 });
  assert.equal(
    await repository.markDelivered(
      claimed.id,
      'worker-b',
      'wrong-owner',
      new Date('2026-08-05T10:00:00.500Z'),
    ),
    null,
  );
  const [reclaimed] = await repository.claimDueEvents({
    owner: 'worker-b',
    now: new Date('2026-08-05T10:00:01.000Z'),
    leaseMs: 1_000,
  });
  assert.equal(reclaimed?.leaseOwner, 'worker-b');
  assert.equal(
    await repository.markDelivered(
      reclaimed.id,
      'worker-a',
      undefined,
      new Date('2026-08-05T10:00:01.500Z'),
    ),
    null,
  );
  assert.equal(
    (await repository.markDelivered(
      reclaimed.id,
      'worker-b',
      undefined,
      new Date('2026-08-05T10:00:01.500Z'),
    ))?.status,
    'delivered',
  );
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

test('worker failure preserves an aggregate created in the same transaction', async () => {
  const repository = new InMemoryQuotationOutboxRepository();
  const savedQuotations = new Map<string, { status: string }>();
  const seen: unknown[] = [];
  const aggregateTransaction = async (callback: (transaction: Parameters<InMemoryQuotationOutboxRepository['enqueueInTransaction']>[0]) => Promise<void>) => {
    const before = new Map(savedQuotations);
    try {
      return await repository.transaction(callback);
    } catch (error) {
      savedQuotations.clear();
      for (const [id, value] of before) savedQuotations.set(id, value);
      throw error;
    }
  };
  await aggregateTransaction(async (transaction) => {
    savedQuotations.set('quote-1', { status: 'rascunho' });
    await repository.enqueueInTransaction(transaction, base);
  });
  assert.deepEqual(savedQuotations.get('quote-1'), { status: 'rascunho' });
  await assert.rejects(
    aggregateTransaction(async (transaction) => {
      savedQuotations.set('quote-rollback', { status: 'rascunho' });
      await repository.enqueueInTransaction(transaction, {
        ...base,
        quotationId: 'quote-rollback',
        revisionId: 'revision-rollback',
        idempotencyKey: 'created:quote-rollback:revision-rollback',
      });
      throw new Error('injected aggregate failure');
    }),
    /injected aggregate failure/,
  );
  assert.equal(savedQuotations.has('quote-rollback'), false);
  // The outbox transaction itself must have rolled back its staged event.
  assert.equal(
    (await repository.list()).some((event) => event.payloadReference.quotationId === 'quote-rollback'),
    false,
  );
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
  assert.deepEqual(savedQuotations, new Map([['quote-1', { status: 'rascunho' }]]));
  assert.equal(seen.length, 1);
  const [seenContext] = seen as Array<Record<string, unknown>>;
  assert.deepEqual({
    eventType: seenContext.eventType,
    provider: seenContext.provider,
    reference: seenContext.reference,
    idempotencyKey: seenContext.idempotencyKey,
  }, {
    eventType: 'quotation.created',
    provider: 'crm',
    reference: {
      quotationId: 'quote-1',
      revisionId: 'revision-1',
      businessNumber: 'ORC-20260001',
    },
    idempotencyKey: 'created:quote-1:revision-1',
  });
  assert.equal(seenContext.signal instanceof AbortSignal, true);
});

test('provider timeout uses each event lease after batch claim latency', async () => {
  const startMs = Date.parse('2026-08-05T10:00:00.000Z');
  const leaseExpiresAt = new Date(startMs + 100);
  assert.equal(quotationOutboxProviderTimeoutMs(leaseExpiresAt, new Date(startMs), 80), 80);
  assert.equal(quotationOutboxProviderTimeoutMs(leaseExpiresAt, new Date(startMs + 60), 80), 39);
  assert.throws(
    () => quotationOutboxProviderTimeoutMs(leaseExpiresAt, new Date(startMs + 99), 80),
    /expirou/,
  );

  const repository = new InMemoryQuotationOutboxRepository();
  await repository.enqueue(base);
  await repository.enqueue({
    ...base,
    quotationId: 'quote-2',
    revisionId: 'revision-2',
    businessNumber: 'ORC-20260002',
    idempotencyKey: 'created:quote-2:revision-2',
  });
  let clockMs = startMs;
  let calls = 0;
  let secondElapsedMs = 0;
  const result = await processQuotationOutbox({
    repository,
    owner: 'worker-a',
    limit: 2,
    leaseMs: 100,
    providerTimeoutMs: 80,
    now: () => new Date(clockMs),
    adapters: createQuotationOutboxProviderAdapters({
      crm: async ({ signal }) => {
        calls += 1;
        if (calls === 1) {
          clockMs += 60;
          return { accepted: true };
        }
        const started = Date.now();
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            secondElapsedMs = Date.now() - started;
            reject(new Error('aborted'));
          }, { once: true });
        });
      },
    }),
  });
  assert.deepEqual(result, {
    claimed: 2,
    delivered: 1,
    retried: 1,
    deadLettered: 0,
    leaseLost: 0,
  });
  assert.equal(calls, 2);
  assert.ok(secondElapsedMs >= 20, `second event timed out too early: ${secondElapsedMs}ms`);
  assert.ok(secondElapsedMs < 200, `second event timeout exceeded lease guard: ${secondElapsedMs}ms`);
});

test('short leases do not invoke a provider without a safe timeout window', async () => {
  const repository = await queued({ maxAttempts: 2 });
  let invoked = false;
  const result = await processQuotationOutbox({
    repository,
    owner: 'worker-a',
    leaseMs: 1,
    providerTimeoutMs: 10,
    now: () => new Date('2026-08-05T10:00:01.000Z'),
    adapters: createQuotationOutboxProviderAdapters({
      crm: async () => {
        invoked = true;
        return { accepted: true };
      },
    }),
  });
  assert.deepEqual(result, {
    claimed: 1,
    delivered: 0,
    retried: 1,
    deadLettered: 0,
    leaseLost: 0,
  });
  assert.equal(invoked, false);
  const [event] = await repository.list();
  assert.equal(event?.lastErrorClass, 'QuotationOutboxLeaseExpiredError');
  assert.equal(event?.leaseOwner, null);
});

test('provider timeout aborts invocation before lease expiry and releases ownership', async () => {
  const repository = await queued({ maxAttempts: 2 });
  let aborted = false;
  const result = await processQuotationOutbox({
    repository,
    owner: 'worker-a',
    leaseMs: 100,
    providerTimeoutMs: 10,
    now: () => new Date('2026-08-05T10:00:01.000Z'),
    adapters: createQuotationOutboxProviderAdapters({
      crm: async ({ signal }) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason || new Error('aborted'));
        }, { once: true });
      }),
    }),
  });
  assert.deepEqual(result, {
    claimed: 1,
    delivered: 0,
    retried: 1,
    deadLettered: 0,
    leaseLost: 0,
  });
  assert.equal(aborted, true);
  const [event] = await repository.list();
  assert.equal(event?.lastErrorClass, 'QuotationOutboxProviderTimeoutError');
  assert.equal(event?.leaseOwner, null);
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
