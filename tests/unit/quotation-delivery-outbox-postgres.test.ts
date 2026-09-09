import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  ensureFixtureTemplateVersion,
  type FixtureRevisionFields,
} from '../fixtures/quotation-revision-seeds.ts';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  clients,
  quoteRevisions,
  quotations,
  quotationDeliveries,
  quotationDeliverySteps,
} from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresQuotationDeliveryOutboxRepository,
  QuotationDeliveryOutboxConflictError,
  type EnqueueDeliveryRecord,
  type FrozenDeliveryStep,
} from '../../api/_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';
import {
  createPostgresQuotationDeliveryRepository,
  QuotationDeliveryConflictError,
} from '../../api/_infrastructure/db/repositories/quotation-delivery-repository.js';
import { EvolutionTransportError } from '../../api/_modules/evolution-transport.js';
import { createQuotationDeliveryModule } from '../../api/_modules/quotation-delivery-outbox.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const now = new Date();
const old = new Date(now.getTime() - 2 * 86_400_000);
const databaseSkip = 'TEST_DATABASE_URL is required for PostgreSQL-backed outbox tests.';

function databaseTest(name: string, optionsOrFn: any, maybeFn?: any) {
  const options = typeof optionsOrFn === 'function' ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
  return test(
    name,
    { ...options, ...(TEST_DATABASE_URL ? {} : { skip: databaseSkip }) },
    fn,
  );
}

const ids = {
  client: randomUUID(),
  quotation: randomUUID(),
  revision: randomUUID(),
};
const businessNumber = `ORC-${String(Date.now()).slice(-8)}`;

let sqlClient: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createPostgresQuotationDeliveryOutboxRepository>;
let integrationClock: Date;
let integrationRepository: ReturnType<typeof createPostgresQuotationDeliveryOutboxRepository>;
let fixtureFields: FixtureRevisionFields;
let nextRevisionVersion = 1;
const testRevisionIds = new Set([ids.revision]);

const textStep = (position = 0, text = `step-${position}`) => ({
  position,
  type: 'text' as const,
  payload: { text },
  delayMs: 0,
});

function input(
  options: Partial<Pick<EnqueueDeliveryRecord, 'revisionId' | 'flowId' | 'flowName' | 'phone' | 'steps'>> = {}
): EnqueueDeliveryRecord {
  const flowId = options.flowId || `flow-${randomUUID().slice(0, 8)}`;
  return {
    revisionId: options.revisionId || ids.revision,
    phone: options.phone || '5511999999999',
    flowId,
    flowName: options.flowName || `Flow ${flowId}`,
    steps: options.steps || [textStep(0), textStep(1)],
  };
}

async function createIssuedRevision(): Promise<string> {
  const revisionId = randomUUID();
  nextRevisionVersion += 1;
  await db.insert(quoteRevisions).values({
    ...fixtureFields,
    id: revisionId,
    quotationId: ids.quotation,
    version: nextRevisionVersion,
    status: 'emitido',
    issuedAt: now,
    validadeDias: 15,
    entrega: '',
    fretePadrao: '0.00',
    frete: '0.00',
    clienteNome: 'Cliente outbox',
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    subtotal: '0.00',
    total: '0.00',
    createdAt: now,
  });
  testRevisionIds.add(revisionId);
  return revisionId;
}

async function setDelivery(id: string, values: Record<string, unknown>) {
  await db
    .update(quotationDeliveries)
    .set(values as never)
    .where(eq(quotationDeliveries.id, id));
}

async function setStep(id: string, values: Record<string, unknown>) {
  await db
    .update(quotationDeliverySteps)
    .set(values as never)
    .where(eq(quotationDeliverySteps.id, id));
}

test.before(async () => {
  if (!TEST_DATABASE_URL) return;
  sqlClient = postgres(TEST_DATABASE_URL, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });
  db = drizzle(sqlClient, { schema });
  await migrate(db, { migrationsFolder });
  await db.insert(clients).values({ id: ids.client, nome: 'Cliente outbox' });
  await db.insert(quotations).values({
    id: ids.quotation,
    businessNumber,
    clientId: ids.client,
    status: 'emitido',
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  fixtureFields = await ensureFixtureTemplateVersion(db as any);
  await db.insert(quoteRevisions).values({
    ...fixtureFields,
    id: ids.revision,
    quotationId: ids.quotation,
    version: 1,
    status: 'emitido',
    issuedAt: now,
    validadeDias: 15,
    entrega: '',
    fretePadrao: '0.00',
    frete: '0.00',
    clienteNome: 'Cliente outbox',
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    subtotal: '0.00',
    total: '0.00',
    createdAt: now,
  });
  repository = createPostgresQuotationDeliveryOutboxRepository(() => db, { now: () => now });
  integrationClock = new Date(now);
  integrationRepository = createPostgresQuotationDeliveryOutboxRepository(() => db, {
    now: () => new Date(integrationClock),
  });
});

test.beforeEach(async () => {
  if (!TEST_DATABASE_URL || !db) return;
  for (const revisionId of testRevisionIds) {
    await db.delete(quotationDeliveries).where(eq(quotationDeliveries.revisionId, revisionId));
    if (revisionId !== ids.revision) {
      await db.delete(quoteRevisions).where(eq(quoteRevisions.id, revisionId));
    }
  }
  testRevisionIds.clear();
  testRevisionIds.add(ids.revision);
});

test.after(async () => {
  if (!TEST_DATABASE_URL || !db || !sqlClient) return;
  for (const revisionId of testRevisionIds) {
    await db.delete(quotationDeliveries).where(eq(quotationDeliveries.revisionId, revisionId));
  }
  await db.delete(quoteRevisions).where(eq(quoteRevisions.quotationId, ids.quotation));
  await db.delete(quotations).where(eq(quotations.id, ids.quotation));
  await db.delete(clients).where(eq(clients.id, ids.client));
  await sqlClient.end({ timeout: 5 });
});

databaseTest('enqueue is idempotent by revision and rejects a second flow', async () => {
  const first = await repository.enqueue(input({ flowId: 'flow-a', flowName: 'Flow A' }));
  const replay = await repository.enqueue(input({ flowId: 'flow-a', flowName: 'Flow A' }));
  assert.equal(replay.id, first.id);
  await assert.rejects(
    repository.enqueue(input({ flowId: 'flow-b', flowName: 'Flow B' })),
    QuotationDeliveryOutboxConflictError,
  );
  assert.equal((await repository.get(first.id))?.steps.length, 2);
  const changedInputReplay = await repository.enqueue(
    input({ flowId: 'flow-a', flowName: 'Flow A', phone: '5521999999999' })
  );
  assert.equal(changedInputReplay.id, first.id);
  await assert.rejects(
    repository.enqueue({
      ...input({ flowId: 'invalid-top-level', flowName: 'Invalid top level' }),
      steps: [
        { ...textStep(), secret: 'provider-payload' },
      ] as unknown as EnqueueDeliveryRecord['steps'],
    })
  );
  await assert.rejects(
    repository.enqueue({
      ...input({ flowId: 'invalid-payload-key', flowName: 'Invalid payload key' }),
      steps: [
        { ...textStep(), payload: { text: 'safe', secret: 'provider-payload' } },
      ] as unknown as EnqueueDeliveryRecord['steps'],
    })
  );
});

databaseTest('single-revision policy atomically rejects concurrent cross-flow enqueue', async () => {
  await db.delete(quotationDeliveries).where(eq(quotationDeliveries.revisionId, ids.revision));
  const results = await Promise.allSettled([
    repository.enqueue(input({ flowId: 'guarded-a' })),
    repository.enqueue(input({ flowId: 'guarded-b' })),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof QuotationDeliveryOutboxConflictError);
});

databaseTest('single-revision policy is atomic across current and legacy send repositories', async () => {
  await db.delete(quotationDeliveries).where(eq(quotationDeliveries.revisionId, ids.revision));
  const legacyRepository = createPostgresQuotationDeliveryRepository(() => db, { now: () => now });
  const results = await Promise.allSettled([
    repository.enqueue(input({ flowId: 'current-flow' })),
    legacyRepository.reserve({
      revisionId: ids.revision,
      phone: '5511999999999',
      flowId: 'legacy-flow',
    }),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(
    (rejected[0] as PromiseRejectedResult).reason instanceof QuotationDeliveryOutboxConflictError
      || (rejected[0] as PromiseRejectedResult).reason instanceof QuotationDeliveryConflictError,
  );
});

databaseTest('claim and markAccepted enforce ordered predecessor gating after unsafe outcomes', async () => {
  for (const [suffix, kind] of [
    ['retry', 'transient_pre_transport'],
    ['failed', 'permanent_pre_transport'],
    ['ambiguous', 'ambiguous'],
  ] as const) {
    const revisionId = await createIssuedRevision();
    const delivery = await repository.enqueue(
      input({
        revisionId,
        flowId: `ordered-${suffix}`,
        steps: [textStep(0), textStep(1)],
      })
    );
    const first = await repository.claim({ deliveryId: delivery.id });
    assert.ok(first);
    await repository.markFailure({
      deliveryId: delivery.id,
      stepId: first.step.id,
      leaseToken: first.leaseToken,
      kind,
      code: `ORDERED_${suffix.toUpperCase()}`,
      publicError: 'Falha segura antes da próxima etapa.',
    });
    await setStep(delivery.steps[1]!.id, {
      nextAttemptAt: new Date(now.getTime() - 1_000),
    });
    assert.equal(await repository.claim({ deliveryId: delivery.id }), null);
  }

  const manualRevisionId = await createIssuedRevision();
  const manual = await repository.enqueue(
    input({
      revisionId: manualRevisionId,
      flowId: 'ordered-mark-accepted',
      steps: [textStep(0), textStep(1)],
    })
  );
  const leaseToken = randomUUID();
  await setDelivery(manual.id, {
    state: 'processing',
    leaseToken,
    leaseUntil: new Date(now.getTime() + 90_000),
  });
  await setStep(manual.steps[1]!.id, { state: 'sending', attemptCount: 1 });
  await assert.rejects(
    repository.markAccepted({
      deliveryId: manual.id,
      stepId: manual.steps[1]!.id,
      leaseToken,
      providerMessageId: 'ordered-mark-accepted-provider',
    })
  );
});

databaseTest('module integration persists frozen delay and waits for the due predecessor', async () => {
  const flowId = 'module-postgres-delay';
  const steps: FrozenDeliveryStep[] = [textStep(0), { ...textStep(1), delayMs: 60_000 }];
  const calls: number[] = [];
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    planner: async () => ({
      revisionId: ids.revision,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId,
      flowName: 'Module PostgreSQL delay',
      steps,
    }),
    transport: async ({ step }) => {
      calls.push(step.position);
      return { accepted: true as const, providerMessageId: `module-provider-${calls.length}` };
    },
    now: () => new Date(integrationClock),
    logger: () => {},
  });

  const first = await module.enqueue({ revisionId: ids.revision, flowId });
  assert.deepEqual(calls, [0]);
  assert.equal(first.state, 'queued');
  assert.equal(first.steps[1]?.nextAttemptAt?.getTime(), integrationClock.getTime() + 60_000);
  const stored = await db
    .select({
      position: quotationDeliverySteps.position,
      nextAttemptAt: quotationDeliverySteps.nextAttemptAt,
    })
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.deliveryId, first.id))
    .orderBy(quotationDeliverySteps.position);
  assert.equal(stored[1]?.nextAttemptAt?.getTime(), integrationClock.getTime() + 60_000);

  const blocked = await module.process(first.id);
  assert.equal(blocked?.state, 'queued');
  assert.deepEqual(calls, [0]);

  integrationClock = new Date(integrationClock.getTime() + 60_000);
  const completed = await module.process(first.id);
  assert.equal(completed?.state, 'provider_accepted');
  assert.deepEqual(calls, [0, 1]);
});

databaseTest('accepted step followed by a retryable next step preserves order and call count', async () => {
  integrationClock = new Date(now);
  const flowId = 'accepted-then-retryable-postgres';
  const steps: FrozenDeliveryStep[] = [textStep(0), textStep(1)];
  let transportCalls = 0;
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    planner: async () => ({
      revisionId: ids.revision,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId,
      flowName: 'Accepted then retryable',
      steps,
    }),
    transport: async () => {
      transportCalls += 1;
      if (transportCalls === 2) {
        throw new EvolutionTransportError(
          'Tente novamente.',
          'transient_pre_transport',
          'EVOLUTION_RATE_LIMIT',
        );
      }
      return { accepted: true as const, providerMessageId: `provider-accepted-retry-${transportCalls}` };
    },
    now: () => new Date(integrationClock),
    logger: () => {},
  });

  const retry = await module.enqueue({ revisionId: ids.revision, flowId });
  assert.equal(retry.state, 'retry_scheduled');
  assert.equal(retry.steps[0]?.state, 'server_ack');
  assert.equal(retry.steps[1]?.state, 'retry_scheduled');
  assert.equal(transportCalls, 2);
  integrationClock = new Date(integrationClock.getTime() + 60_000);
  const completed = await module.process(retry.id);
  assert.equal(completed?.state, 'provider_accepted');
  assert.equal(completed?.steps[0]?.state, 'server_ack');
  assert.equal(completed?.steps[1]?.state, 'server_ack');
  assert.equal(transportCalls, 3);
});

databaseTest('two claims produce one lease and accepted steps never reclaim', async () => {
  const delivery = await repository.enqueue(
    input({
      flowId: 'claim-one',
      flowName: 'Claim one',
      steps: [textStep()],
    })
  );
  const [a, b] = await Promise.all([
    repository.claim({ deliveryId: delivery.id }),
    repository.claim({ deliveryId: delivery.id }),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
  const claim = a || b;
  assert.ok(claim);
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId: 'provider-one-claim',
  });
  assert.equal(await repository.claim({ deliveryId: delivery.id }), null);
});

databaseTest('two independent workers claim one due step and make one transport call', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'two-workers-postgres', steps: [textStep()] })
  );
  let transportCalls = 0;
  const makeModule = () =>
    createQuotationDeliveryModule({
      repository,
      transport: async () => {
        transportCalls += 1;
        return { accepted: true as const, providerMessageId: 'provider-two-workers' };
      },
      now: () => now,
      logger: () => {},
    });
  const [a, b] = await Promise.all([
    makeModule().process(delivery.id),
    makeModule().process(delivery.id),
  ]);
  assert.equal(transportCalls, 1);
  assert.equal((await repository.get(delivery.id))?.state, 'provider_accepted');
});

databaseTest('worker crash after claim before transport enters reconciliation without a provider call', async () => {
  const delivery = await repository.enqueue(
    input({
      flowId: 'claim-expired',
      flowName: 'Claim expired',
      steps: [textStep()],
    })
  );
  const first = await repository.claim({ deliveryId: delivery.id });
  assert.ok(first);
  let transportCalls = 0;
  await setDelivery(delivery.id, { leaseUntil: new Date(now.getTime() - 1_000) });
  assert.equal(await repository.claim({ deliveryId: delivery.id }), null);
  assert.equal(transportCalls, 0);
  assert.equal((await repository.get(delivery.id))?.state, 'reconciling');
  await setDelivery(delivery.id, { reconciliationDeadline: old });
  assert.equal(await repository.expireReconciliations(10), 1);
  assert.equal((await repository.get(delivery.id))?.state, 'needs_review');
});

databaseTest('worker crash after provider acceptance does not resend after lease expiry', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'claim-after-provider', steps: [textStep()] })
  );
  const claimed = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claimed);
  let transportCalls = 0;
  const providerResponse = {
    accepted: true as const,
    providerMessageId: 'provider-crash-after-acceptance',
  };
  const transport = async () => {
    transportCalls += 1;
    return providerResponse;
  };
  assert.equal((await transport()).accepted, true);
  assert.equal(transportCalls, 1);
  await setDelivery(delivery.id, { leaseUntil: new Date(now.getTime() - 1_000) });
  assert.equal(await repository.claim({ deliveryId: delivery.id }), null);
  const recovered = await repository.get(delivery.id);
  assert.equal(recovered?.state, 'reconciling');
  assert.equal(recovered?.steps[0]?.state, 'reconciling');
  const [stored] = await db
    .select({ providerMessageId: quotationDeliverySteps.providerMessageId })
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.id, delivery.steps[0]!.id));
  assert.equal(stored?.providerMessageId, null);
  assert.equal(providerResponse.providerMessageId, 'provider-crash-after-acceptance');
  assert.equal(transportCalls, 1);
});

databaseTest('providerMessageId is unique and invalid leases cannot update a step', async () => {
  const first = await repository.enqueue(
    input({
      flowId: 'provider-unique-a',
      flowName: 'Provider unique A',
      steps: [textStep()],
    })
  );
  const firstClaim = await repository.claim({ deliveryId: first.id });
  assert.ok(firstClaim);
  await assert.rejects(
    repository.markAccepted({
      deliveryId: first.id,
      stepId: firstClaim.step.id,
      leaseToken: randomUUID(),
      providerMessageId: 'provider-duplicate',
    })
  );
  await repository.markAccepted({
    deliveryId: first.id,
    stepId: firstClaim.step.id,
    leaseToken: firstClaim.leaseToken,
    providerMessageId: 'provider-duplicate',
  });

  const secondRevisionId = await createIssuedRevision();
  const second = await repository.enqueue(
    input({
      revisionId: secondRevisionId,
      flowId: 'provider-unique-b',
      flowName: 'Provider unique B',
      steps: [textStep()],
    })
  );
  const secondClaim = await repository.claim({ deliveryId: second.id });
  assert.ok(secondClaim);
  await assert.rejects(
    repository.markAccepted({
      deliveryId: second.id,
      stepId: secondClaim.step.id,
      leaseToken: secondClaim.leaseToken,
      providerMessageId: 'provider-duplicate',
    })
  );
});

databaseTest('duplicate SERVER_ACK receipts are monotonic without another transport call', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'duplicate-server-ack', steps: [textStep()] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  let transportCalls = 0;
  const transport = async () => {
    transportCalls += 1;
    return { accepted: true as const, providerMessageId: 'provider-duplicate-server-ack' };
  };
  const accepted = await transport();
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId: accepted.providerMessageId,
  });
  const first = await repository.applyReceipt({
    providerMessageId: 'provider-duplicate-server-ack',
    status: 'SERVER_ACK',
  });
  const second = await repository.applyReceipt({
    providerMessageId: 'provider-duplicate-server-ack',
    status: 'SERVER_ACK',
  });
  assert.equal(first?.state, 'provider_accepted');
  assert.deepEqual(second, first);
  assert.equal(transportCalls, 1);
  assert.equal((await repository.get(delivery.id))?.state, 'provider_accepted');
});

databaseTest('DELIVERY_ACK after needs_review resolves the persisted provider key', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'delayed-delivery-ack-postgres', steps: [textStep()] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  let transportCalls = 0;
  const transport = async () => {
    transportCalls += 1;
    return { accepted: true as const, providerMessageId: 'provider-delayed-delivery-ack' };
  };
  const accepted = await transport();
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId: accepted.providerMessageId,
  });
  await setStep(delivery.steps[0]!.id, {
    state: 'needs_review',
    publicError: 'Aguardando recibo.',
    updatedAt: now,
  });
  await setDelivery(delivery.id, { state: 'needs_review', publicError: 'Aguardando recibo.' });
  const resolved = await repository.applyReceipt({
    providerMessageId: 'provider-delayed-delivery-ack',
    status: 'DELIVERY_ACK',
  });
  assert.equal(resolved?.state, 'delivered');
  assert.equal(resolved?.steps[0]?.state, 'delivered');
  assert.equal(transportCalls, 1);
});

databaseTest('READ before DELIVERY_ACK remains delivered without another transport call', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'read-before-delivery-postgres', steps: [textStep()] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  let transportCalls = 0;
  const transport = async () => {
    transportCalls += 1;
    return { accepted: true as const, providerMessageId: 'provider-read-before-delivery' };
  };
  const accepted = await transport();
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId: accepted.providerMessageId,
  });
  const read = await repository.applyReceipt({
    providerMessageId: 'provider-read-before-delivery',
    status: 'READ',
  });
  const lateDelivery = await repository.applyReceipt({
    providerMessageId: 'provider-read-before-delivery',
    status: 'DELIVERY_ACK',
  });
  assert.equal(read?.state, 'delivered');
  assert.equal(lateDelivery?.state, 'delivered');
  assert.equal(lateDelivery?.steps[0]?.state, 'read');
  assert.equal(transportCalls, 1);
});

databaseTest('list supports filtering and pagination without provider payloads', async () => {
  const secondRevisionId = await createIssuedRevision();
  const thirdRevisionId = await createIssuedRevision();
  const deliveries = await Promise.all([
    repository.enqueue(
      input({ flowId: 'list-unique-a', flowName: 'List unique A', steps: [textStep()] })
    ),
    repository.enqueue(
      input({
        revisionId: secondRevisionId,
        flowId: 'list-unique-b',
        flowName: 'List unique B',
        steps: [textStep()],
      })
    ),
    repository.enqueue(
      input({
        revisionId: thirdRevisionId,
        flowId: 'list-unique-c',
        flowName: 'List unique C',
        steps: [textStep()],
      })
    ),
  ]);
  await setDelivery(deliveries[1].id, {
    state: 'needs_review',
    updatedAt: old,
    publicError: 'operator-safe',
  });
  await setDelivery(deliveries[2].id, { state: 'provider_accepted', updatedAt: old });
  const delayedAggregate = await repository.get(deliveries[2].id);
  assert.equal(
    delayedAggregate?.actionDeadline?.getTime(),
    old.getTime() + 86_400_000,
  );
  const page = await repository.list({ search: 'list-unique', page: 1, pageSize: 2 });
  assert.equal(page.total, 3);
  assert.equal(page.data.length, 2);
  assert.equal(JSON.stringify(page.data).includes('provider-'), false);
  assert.equal(JSON.stringify(page.data).includes('payloadSnapshot'), false);
  const secondPage = await repository.list({ search: 'list-unique', page: 2, pageSize: 2 });
  assert.equal(secondPage.data.length, 1);
  const actionable = await repository.list({
    search: 'list-unique',
    requiresAction: true,
    page: 1,
    pageSize: 10,
  });
  assert.deepEqual(
    actionable.data.map((delivery) => delivery.id),
    [deliveries[1].id]
  );
  const delayed = await repository.list({
    search: 'list-unique',
    delayed: true,
    page: 1,
    pageSize: 10,
  });
  assert.deepEqual(
    delayed.data.map((delivery) => delivery.id),
    [deliveries[2].id]
  );
});

databaseTest('markFailure schedules safe retries and expires ambiguous reconciliation', async () => {
  const retryDelivery = await repository.enqueue(
    input({
      flowId: 'failure-retry',
      flowName: 'Failure retry',
      steps: [textStep()],
    })
  );
  const retryClaim = await repository.claim({ deliveryId: retryDelivery.id });
  assert.ok(retryClaim);
  const retry = await repository.markFailure({
    deliveryId: retryDelivery.id,
    stepId: retryClaim.step.id,
    leaseToken: retryClaim.leaseToken,
    kind: 'transient_pre_transport',
    code: 'RATE_LIMIT',
    publicError: 'Nova tentativa agendada.',
  });
  assert.equal(retry.state, 'retry_scheduled');
  assert.equal(retry.steps[0]?.state, 'retry_scheduled');
  assert.equal(retry.steps[0]?.nextAttemptAt?.getTime(), now.getTime() + 60_000);

  const ambiguousRevisionId = await createIssuedRevision();
  const ambiguousDelivery = await repository.enqueue(
    input({
      revisionId: ambiguousRevisionId,
      flowId: 'failure-ambiguous',
      flowName: 'Failure ambiguous',
      steps: [textStep()],
    })
  );
  const ambiguousClaim = await repository.claim({ deliveryId: ambiguousDelivery.id });
  assert.ok(ambiguousClaim);
  const ambiguous = await repository.markFailure({
    deliveryId: ambiguousDelivery.id,
    stepId: ambiguousClaim.step.id,
    leaseToken: ambiguousClaim.leaseToken,
    kind: 'ambiguous',
    code: 'SOCKET_CLOSED',
    publicError: 'Entrega em reconciliação.',
  });
  assert.equal(ambiguous.state, 'reconciling');
  await setDelivery(ambiguousDelivery.id, { reconciliationDeadline: old });
  assert.equal(await repository.expireReconciliations(10), 1);
  assert.equal((await repository.get(ambiguousDelivery.id))?.state, 'needs_review');
});

databaseTest('cancelPending cancels only queued retries and preserves sent work', async () => {
  const processingRevisionId = await createIssuedRevision();
  const acceptedRevisionId = await createIssuedRevision();
  const pending = await repository.enqueue(
    input({ flowId: 'cancel-pending-postgres', steps: [textStep()] })
  );
  const processing = await repository.enqueue(
    input({
      revisionId: processingRevisionId,
      flowId: 'cancel-processing-postgres',
      steps: [textStep()],
    })
  );
  assert.ok(await repository.claim({ deliveryId: processing.id }));

  const accepted = await repository.enqueue(
    input({
      revisionId: acceptedRevisionId,
      flowId: 'cancel-accepted-postgres',
      steps: [textStep()],
    })
  );
  const acceptedClaim = await repository.claim({ deliveryId: accepted.id });
  assert.ok(acceptedClaim);
  await repository.markAccepted({
    deliveryId: accepted.id,
    stepId: acceptedClaim.step.id,
    leaseToken: acceptedClaim.leaseToken,
    providerMessageId: 'provider-cancel-accepted',
  });

  assert.ok((await repository.cancelPending()) >= 1);
  const cancelled = await repository.get(pending.id);
  assert.equal(cancelled?.state, 'failed');
  assert.equal(cancelled?.completionSource, 'operator');
  assert.equal(cancelled?.publicError, 'Cancelada pelo operador.');
  assert.equal((await repository.get(processing.id))?.state, 'processing');
  assert.equal((await repository.get(accepted.id))?.state, 'provider_accepted');
});

databaseTest('confirmed_received records operator completion', async () => {
  const delivery = await repository.enqueue(
    input({
      flowId: 'resolve-received',
      flowName: 'Resolve received',
      steps: [textStep()],
    })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId: 'provider-resolve-received',
  });
  await setDelivery(delivery.id, { state: 'provider_accepted', updatedAt: now });
  await assert.rejects(
    repository.resolve({
      deliveryId: delivery.id,
      decision: 'confirmed_received',
      note: 'Ainda aguardando o prazo mínimo.',
      resolvedBy: 'authenticated-operator',
    }),
    /prazo de resolução/,
  );
  await setDelivery(delivery.id, { updatedAt: old });
  const resolved = await repository.resolve({
    deliveryId: delivery.id,
    decision: 'confirmed_received',
    note: 'Cliente confirmou recebimento.',
    resolvedBy: 'authenticated-operator',
  });
  assert.equal(resolved.state, 'delivered');
  assert.equal(resolved.completionSource, 'operator');
  assert.equal(resolved.steps[0]?.state, 'delivered');
});

databaseTest('legacy delivery without steps can be confirmed received without becoming queued', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'resolve-legacy-no-steps', steps: [textStep(0)] })
  );
  await db.delete(quotationDeliverySteps).where(eq(quotationDeliverySteps.deliveryId, delivery.id));
  await setDelivery(delivery.id, {
    state: 'needs_review',
    updatedAt: old,
    publicError: 'Confirmação de entrega indisponível.',
  });

  const resolved = await repository.resolve({
    deliveryId: delivery.id,
    decision: 'confirmed_received',
    note: 'Cliente confirmou recebimento do histórico legado.',
    resolvedBy: 'authenticated-operator',
  });
  assert.equal(resolved.state, 'delivered');
  assert.equal(resolved.completionSource, 'operator');
  assert.equal(resolved.steps.length, 0);

  const noRetryRevisionId = await createIssuedRevision();
  const noRetry = await repository.enqueue(
    input({
      revisionId: noRetryRevisionId,
      flowId: 'resolve-legacy-no-retry',
      steps: [textStep(0)],
    })
  );
  await db.delete(quotationDeliverySteps).where(eq(quotationDeliverySteps.deliveryId, noRetry.id));
  await setDelivery(noRetry.id, { state: 'needs_review', updatedAt: old });
  await assert.rejects(
    repository.resolve({
      deliveryId: noRetry.id,
      decision: 'confirmed_not_received',
      note: 'Não há etapas históricas para reenviar.',
      resolvedBy: 'authenticated-operator',
    }),
    /legada não possui etapas para reenvio/
  );
});

databaseTest('confirmed_not_received requeues every non-delivered step and clears stale provider correlation', async () => {
  const delivery = await repository.enqueue(
    input({
      flowId: 'resolve-not-received',
      flowName: 'Resolve not received',
    })
  );
  const [accepted, unresolved] = delivery.steps;
  await setStep(accepted.id, {
    state: 'server_ack',
    providerMessageId: 'provider-resolve-accepted',
    acceptedAt: old,
    updatedAt: old,
  });
  await setStep(unresolved.id, { state: 'needs_review', updatedAt: now });
  await setDelivery(delivery.id, { state: 'needs_review', updatedAt: now });
  const resolved = await repository.resolve({
    deliveryId: delivery.id,
    decision: 'confirmed_not_received',
    note: 'Etapa pendente será reenviada.',
    resolvedBy: 'authenticated-operator',
  });
  assert.equal(resolved.state, 'queued');
  assert.equal(resolved.steps.find((step) => step.id === accepted.id)?.state, 'queued');
  assert.equal(resolved.steps.find((step) => step.id === unresolved.id)?.state, 'queued');
  assert.equal(resolved.steps.find((step) => step.id === accepted.id)?.publicError, null);
  const stored = await db
    .select({
      providerMessageId: quotationDeliverySteps.providerMessageId,
      acceptedAt: quotationDeliverySteps.acceptedAt,
    })
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.id, accepted.id));
  assert.equal(stored[0]?.providerMessageId, null);
  assert.equal(stored[0]?.acceptedAt, null);

  let transportCalls = 0;
  const recovery = createQuotationDeliveryModule({
    repository,
    transport: async () => {
      transportCalls += 1;
      return {
        accepted: true as const,
        providerMessageId: `provider-resolve-requeued-${transportCalls}`,
      };
    },
    now: () => now,
    logger: () => {},
  });
  const requeued = await recovery.process(delivery.id);
  assert.equal(transportCalls, 2);
  assert.equal(requeued?.state, 'provider_accepted');
  assert.equal(requeued?.steps.find((step) => step.id === accepted.id)?.state, 'server_ack');
  assert.equal(requeued?.steps.find((step) => step.id === unresolved.id)?.state, 'server_ack');
});
