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
import { and, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  clients,
  crmDeals,
  evolutionReceiptInbox,
  manualContactEvents,
  opportunityDeliveryAnchors,
  opportunityNextActions,
  quotationDeliveries,
  quotationDeliverySteps,
  quotationFollowUps,
  quoteRevisions,
  quotations,
  whatsappContactActivity,
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
import {
  createQuotationDeliveryModule,
  DELIVERY_LEASE_MS,
  FOLLOW_UP_RECONCILIATION_BATCH,
} from '../../api/_modules/quotation-delivery-outbox.js';
import {
  DELIVERY_INTERRUPTED_PUBLIC_ERROR,
  SEND_WINDOW_MS,
} from '../../api/_modules/quotation-delivery-state.js';
import { createPostgresQuotationFollowUpRepository } from '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.js';
import { createPostgresWhatsappContactActivityRepository } from '../../api/_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';
import { toPublicDeliveryView } from '../../api/_modules/quotation-deliveries.js';
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
  crm: randomUUID(),
  revision: randomUUID(),
};
const followUpInstance = 'instance-outbox-follow-up';
const businessNumber = `ORC-${String(Date.now()).slice(-8)}`;

let sqlClient: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createPostgresQuotationDeliveryOutboxRepository>;
let integrationClock: Date;
let integrationRepository: ReturnType<typeof createPostgresQuotationDeliveryOutboxRepository>;
let fixtureFields: FixtureRevisionFields;
let nextRevisionVersion = 1;
let followUpBusinessSequence = 60000000;
const followUpCleanupIds: Array<{
  clientId: string;
  quotationId: string;
  revisionId: string;
  crmDealId: string;
}> = [];
const testRevisionIds = new Set([ids.revision]);

const textStep = (position = 0, text = `step-${position}`) => ({
  position,
  type: 'text' as const,
  payload: { text },
  delayMs: 0,
});

const pdfStep = (position = 0, revisionId = ids.revision) => ({
  position,
  type: 'quotation_pdf' as const,
  payload: { revisionId, fileName: 'ORC.pdf', caption: '' },
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

// The request only records the envio; the worker sends it (ADR 0013).
async function enqueueAndProcess(
  module: ReturnType<typeof createQuotationDeliveryModule>,
  identity: { revisionId: string; flowId: string },
) {
  const queued = await module.enqueue(identity);
  return (await module.process(queued.id)) || queued;
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

async function backendIsWaiting(applicationName: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 AS waiting
    FROM pg_stat_activity
    WHERE application_name = ${applicationName}
      AND wait_event_type = 'Lock'
    LIMIT 1
  `);
  return Array.from(rows).length > 0;
}

async function waitForBackendLock(applicationName: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await backendIsWaiting(applicationName)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${applicationName} never reached a lock wait`);
}

async function waitForRenewalOutcome(
  applicationName: string,
  settled: () => boolean,
  timeoutMs = 10_000,
): Promise<'settled' | 'blocked'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (settled()) return 'settled';
    if (await backendIsWaiting(applicationName)) return 'blocked';
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`renewal on ${applicationName} neither settled nor blocked`);
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
  await db.insert(crmDeals).values({
    id: ids.crm,
    quotationId: ids.quotation,
    clientId: ids.client,
    nome: 'Cliente outbox',
    status: 'Orcamento Enviado',
    createdAt: now,
    updatedAt: now,
  });
  process.env.EVOLUTION_INSTANCE = followUpInstance;
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
  await db.delete(evolutionReceiptInbox);
  await db.delete(quotationFollowUps);
  await db.delete(opportunityDeliveryAnchors);
  await db.delete(manualContactEvents);
  await db.delete(opportunityNextActions);
  for (const { clientId, quotationId, revisionId, crmDealId } of followUpCleanupIds) {
    await db.delete(quotationDeliveries).where(eq(quotationDeliveries.revisionId, revisionId));
    await db.delete(quoteRevisions).where(eq(quoteRevisions.id, revisionId));
    await db.delete(crmDeals).where(eq(crmDeals.id, crmDealId));
    await db.delete(quotations).where(eq(quotations.id, quotationId));
    await db.delete(clients).where(eq(clients.id, clientId));
  }
  followUpCleanupIds.length = 0;
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
  await db.delete(evolutionReceiptInbox);
  await db.delete(quotationFollowUps);
  await db.delete(opportunityDeliveryAnchors);
  await db.delete(manualContactEvents);
  await db.delete(opportunityNextActions);
  // Seeded receipt-reconciliation fixtures must not survive a filtered run:
  // their `business_number` sequence restarts, so leftovers collide with the
  // next standalone invocation.
  for (const { clientId, quotationId, revisionId, crmDealId } of followUpCleanupIds) {
    await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, quotationId));
    await db.delete(quotationDeliveries).where(eq(quotationDeliveries.revisionId, revisionId));
    await db.delete(quoteRevisions).where(eq(quoteRevisions.id, revisionId));
    await db.delete(crmDeals).where(eq(crmDeals.id, crmDealId));
    await db.delete(quotations).where(eq(quotations.id, quotationId));
    await db.delete(clients).where(eq(clients.id, clientId));
  }
  followUpCleanupIds.length = 0;
  for (const revisionId of testRevisionIds) {
    await db.delete(quotationDeliveries).where(eq(quotationDeliveries.revisionId, revisionId));
  }
  await db.delete(quoteRevisions).where(eq(quoteRevisions.quotationId, ids.quotation));
  await db.delete(crmDeals).where(eq(crmDeals.id, ids.crm));
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

  const first = await enqueueAndProcess(module, { revisionId: ids.revision, flowId });
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

  const retry = await enqueueAndProcess(module, { revisionId: ids.revision, flowId });
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

function repositoryAt(at: Date) {
  return createPostgresQuotationDeliveryOutboxRepository(() => db, { now: () => new Date(at) });
}

async function acceptFirstStep(deliveryId: string) {
  const first = await repository.claim({ deliveryId });
  assert.ok(first);
  await repository.markAccepted({
    deliveryId,
    stepId: first.step.id,
    leaseToken: first.leaseToken,
    providerMessageId: `provider-window-${randomUUID()}`,
  });
  return first.step.id;
}

databaseTest('a step that comes due after the send window is interrupted instead of sent', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'window-expired', steps: [textStep(0), textStep(1), textStep(2)] })
  );
  const acceptedStepId = await acceptFirstStep(delivery.id);

  const late = repositoryAt(new Date(now.getTime() + SEND_WINDOW_MS + 1_000));
  const pendingFilter = { search: 'window-expired', requiresAction: true, page: 1, pageSize: 10 };
  const before = await late.list(pendingFilter);
  assert.equal(await late.claim({ deliveryId: delivery.id }), null);
  assert.equal(await late.claim(), null);

  // An interrupted envio waits for the operator in Pendências, not only in Histórico.
  const pending = await late.list(pendingFilter);
  assert.deepEqual(pending.data.map((item) => item.id), [delivery.id]);
  assert.equal(pending.summary.requiresAction, before.summary.requiresAction + 1);

  const interrupted = await late.get(delivery.id);
  assert.equal(interrupted?.state, 'failed');
  assert.equal(interrupted?.publicError, DELIVERY_INTERRUPTED_PUBLIC_ERROR);
  assert.equal(interrupted?.completionSource, null);
  const [accepted, second, third] = interrupted!.steps;
  assert.equal(accepted?.id, acceptedStepId);
  assert.equal(accepted?.state, 'server_ack');
  for (const step of [second, third]) {
    assert.equal(step?.state, 'failed');
    assert.equal(step?.failureKind, 'permanent_pre_transport');
    assert.equal(step?.publicError, DELIVERY_INTERRUPTED_PUBLIC_ERROR);
    assert.equal(step?.nextAttemptAt, null);
  }
});

databaseTest('a step that comes due inside the send window is still sent', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'window-open', steps: [textStep(0), textStep(1)] })
  );
  await acceptFirstStep(delivery.id);

  const inside = repositoryAt(new Date(now.getTime() + SEND_WINDOW_MS - 1_000));
  const claimed = await inside.claim({ deliveryId: delivery.id });
  assert.equal(claimed?.step.position, 1);
});

databaseTest('re-sending an interrupted delivery opens a new send window', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'window-retry', steps: [textStep(0), textStep(1)] })
  );
  await acceptFirstStep(delivery.id);
  const retryAt = new Date(now.getTime() + 2 * SEND_WINDOW_MS);
  const late = repositoryAt(retryAt);
  assert.equal(await late.claim({ deliveryId: delivery.id }), null);

  const resent = await late.resolve({
    deliveryId: delivery.id,
    decision: 'retry_same_revision',
    note: 'Cliente ainda aguarda o orçamento.',
    resolvedBy: 'authenticated-operator',
  });
  assert.equal(resent.state, 'queued');
  const pending = await late.list({ search: 'window-retry', requiresAction: true, page: 1, pageSize: 10 });
  assert.deepEqual(pending.data, []);
  const claimed = await repositoryAt(new Date(retryAt.getTime() + SEND_WINDOW_MS - 1_000)).claim({
    deliveryId: delivery.id,
  });
  assert.equal(claimed?.step.position, 1);
});

databaseTest('an envio re-sent before the window existed counts its window from the re-send', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'window-legacy-resend', steps: [textStep(0)] })
  );
  const resentAt = new Date(now.getTime() + 3 * SEND_WINDOW_MS);
  await setDelivery(delivery.id, { resumableUntil: null, resolvedAt: resentAt });

  const claimed = await repositoryAt(new Date(resentAt.getTime() + SEND_WINDOW_MS - 1_000)).claim({
    deliveryId: delivery.id,
  });
  assert.equal(claimed?.step.position, 0);
});

databaseTest('confirming a stale delivery was not received opens a new send window', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'window-not-received', steps: [textStep(0)] })
  );
  const [step] = delivery.steps;
  await setStep(step!.id, { state: 'needs_review' });
  await setDelivery(delivery.id, { state: 'needs_review' });
  const reviewAt = new Date(now.getTime() + 2 * SEND_WINDOW_MS);
  const late = repositoryAt(reviewAt);

  await late.resolve({
    deliveryId: delivery.id,
    decision: 'confirmed_not_received',
    note: 'Cliente não recebeu.',
    resolvedBy: 'authenticated-operator',
  });
  const claimed = await late.claim({ deliveryId: delivery.id });
  assert.equal(claimed?.step.id, step!.id);
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
  const first = await repository.receiveReceipt({
    providerMessageId: 'provider-duplicate-server-ack',
    status: 'SERVER_ACK',
  });
  const second = await repository.receiveReceipt({
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
  const resolved = await repository.receiveReceipt({
    providerMessageId: 'provider-delayed-delivery-ack',
    status: 'DELIVERY_ACK',
  });
  assert.equal(resolved?.state, 'delivered');
  assert.equal(resolved?.steps[0]?.state, 'delivered');
  // A successful delayed receipt must clear the stale step and delivery errors.
  assert.equal(resolved?.steps[0]?.publicError, null);
  assert.equal(resolved?.publicError, null);
  const view = toPublicDeliveryView(resolved!, { includePhone: true });
  assert.equal(view.public_error, null);
  assert.deepEqual(
    (view.steps as Array<Record<string, unknown>>).map((step) => step.public_error),
    [null],
  );
  const read = await repository.receiveReceipt({
    providerMessageId: 'provider-delayed-delivery-ack',
    status: 'READ',
  });
  assert.equal(read?.steps[0]?.state, 'read');
  assert.equal(read?.steps[0]?.publicError, null);
  assert.equal(read?.publicError, null);
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
  const read = await repository.receiveReceipt({
    providerMessageId: 'provider-read-before-delivery',
    status: 'READ',
  });
  const lateDelivery = await repository.receiveReceipt({
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

databaseTest('confirmed_received on a mixed partial delivery keeps the never-attempted remainder queued', async () => {
  const delivery = await repository.enqueue(
    input({
      flowId: 'resolve-mixed-partial',
      flowName: 'Resolve mixed partial',
      steps: [textStep(0), textStep(1), textStep(2)],
    })
  );
  const [attempted, ...remainder] = delivery.steps;
  await setStep(attempted.id, {
    state: 'server_ack',
    providerMessageId: 'provider-mixed-accepted',
    acceptedAt: old,
    attemptCount: 1,
    updatedAt: old,
  });
  for (const step of remainder) {
    await setStep(step.id, { state: 'queued', nextAttemptAt: null, attemptCount: 0, updatedAt: old });
  }
  await setDelivery(delivery.id, { state: 'needs_review', updatedAt: old });

  const resolved = await repository.resolve({
    deliveryId: delivery.id,
    decision: 'confirmed_received',
    note: 'Cliente confirmou o recebimento da mensagem já entregue.',
    resolvedBy: 'authenticated-operator',
  });

  assert.equal(resolved.steps.find((step) => step.id === attempted.id)?.state, 'delivered');
  assert.equal(resolved.state, 'queued');
  assert.equal(resolved.completionSource, null);
  const remaining = resolved.steps.filter((step) => step.id !== attempted.id);
  assert.deepEqual(remaining.map((step) => step.state), ['queued', 'queued']);
  assert.deepEqual(remaining.map((step) => step.attemptCount), [0, 0]);
  // Exactly the first legitimately remaining step is scheduled, with its delay.
  assert.ok(remaining[0]?.nextAttemptAt);
  assert.equal(remaining[1]?.nextAttemptAt, null);

  let transportCalls = 0;
  const recovery = createQuotationDeliveryModule({
    repository,
    transport: async () => {
      transportCalls += 1;
      return { accepted: true as const, providerMessageId: `provider-mixed-${transportCalls}` };
    },
    now: () => now,
    logger: () => {},
  });
  const resumed = await recovery.process(delivery.id);
  assert.equal(transportCalls, 2);
  assert.equal(resumed?.state, 'provider_accepted');
  assert.equal(resumed?.steps.find((step) => step.id === attempted.id)?.state, 'delivered');
});

databaseTest('resolution cannot reinterpret or revoke a live sending lease', async () => {
  integrationClock = new Date(now);
  const delivery = await repository.enqueue(
    input({ flowId: 'resolve-live-lease', steps: [textStep(0), textStep(1)] })
  );
  let transportCalls = 0;
  const enteredSecondStep = Promise.withResolvers<void>();
  const releaseSecondStep = Promise.withResolvers<void>();
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    plan: async () => ({
      revisionId: ids.revision,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId: 'resolve-live-lease',
      flowName: 'Resolve live lease',
      steps: [textStep(0), textStep(1)],
    }),
    transport: async ({ step }) => {
      transportCalls += 1;
      if (step.position === 1) {
        enteredSecondStep.resolve();
        await releaseSecondStep.promise;
      }
      return {
        accepted: true as const,
        providerMessageId: `provider-live-lease-${step.position}`,
      };
    },
    now: () => new Date(integrationClock),
    logger: () => {},
  });

  const running = module.process(delivery.id);
  await enteredSecondStep.promise;
  assert.equal(transportCalls, 2);

  // A late ERROR on the accepted first step must not disturb the in-flight second
  // step or revoke its live lease.
  const errored = await repository.receiveReceipt({
    providerMessageId: 'provider-live-lease-0',
    status: 'ERROR',
  });
  assert.equal(errored?.steps[0]?.state, 'needs_review');
  assert.equal(errored?.steps[1]?.state, 'sending');
  assert.equal(errored?.state, 'needs_review');
  const [lease] = await db
    .select({
      leaseToken: quotationDeliveries.leaseToken,
      leaseUntil: quotationDeliveries.leaseUntil,
    })
    .from(quotationDeliveries)
    .where(eq(quotationDeliveries.id, delivery.id));
  assert.ok(lease?.leaseToken);
  assert.ok(lease?.leaseUntil && lease.leaseUntil.getTime() > now.getTime());

  for (const decision of ['confirmed_received', 'confirmed_not_received'] as const) {
    await assert.rejects(
      repository.resolve({
        deliveryId: delivery.id,
        decision,
        note: 'Resolução durante envio ativo.',
        resolvedBy: 'authenticated-operator',
      }),
      /envio em andamento/i,
    );
  }
  const untouched = await repository.get(delivery.id);
  assert.equal(untouched?.steps[1]?.state, 'sending');
  assert.equal(untouched?.steps[1]?.attemptCount, 1);

  releaseSecondStep.resolve();
  const settled = await running;
  // Exactly one transport call per step: the held dispatch was neither repeated
  // nor revoked, and the manual attempt could not schedule another one. The
  // provider accepted the held step, but acceptance cannot be persisted while a
  // predecessor is `needs_review`, so the step honestly stays ambiguous.
  assert.equal(transportCalls, 2);
  assert.equal(settled?.steps[0]?.state, 'needs_review');
  assert.equal(settled?.steps[1]?.state, 'reconciling');
  assert.equal(settled?.state, 'needs_review');
  const afterSettle = await repository.get(delivery.id);
  assert.equal(afterSettle?.steps[1]?.state, 'reconciling');
  assert.equal(afterSettle?.steps[1]?.attemptCount, 1);

  const resolved = await repository.resolve({
    deliveryId: delivery.id,
    decision: 'confirmed_received',
    note: 'Cliente confirmou após o envio concluir.',
    resolvedBy: 'authenticated-operator',
  });
  assert.equal(resolved.state, 'delivered');
  assert.deepEqual(resolved.steps.map((step) => step.state), ['delivered', 'delivered']);
  assert.equal(transportCalls, 2);

  // The ordered-gate worker path still sees no claimable work.
  const followUpProcess = await module.process(delivery.id);
  assert.equal(followUpProcess?.state, 'delivered');
  assert.equal(transportCalls, 2);
});

databaseTest('resolution cannot clear an expired sending lease and leave the step orphaned', async () => {
  integrationClock = new Date(now);
  const delivery = await repository.enqueue(
    input({ flowId: 'resolve-expired-lease', steps: [textStep(0), textStep(1)] })
  );
  let transportCalls = 0;
  const enteredSecondStep = Promise.withResolvers<void>();
  const releaseSecondStep = Promise.withResolvers<void>();
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    plan: async () => ({
      revisionId: ids.revision,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId: 'resolve-expired-lease',
      flowName: 'Resolve expired lease',
      steps: [textStep(0), textStep(1)],
    }),
    transport: async ({ step }) => {
      transportCalls += 1;
      if (step.position === 1) {
        enteredSecondStep.resolve();
        await releaseSecondStep.promise;
      }
      return {
        accepted: true as const,
        providerMessageId: `provider-expired-lease-${step.position}`,
      };
    },
    now: () => new Date(integrationClock),
    logger: () => {},
  });

  const running = module.process(delivery.id);
  await enteredSecondStep.promise;
  const errored = await repository.receiveReceipt({
    providerMessageId: 'provider-expired-lease-0',
    status: 'ERROR',
  });
  assert.equal(errored?.steps[1]?.state, 'sending');
  assert.equal(errored?.state, 'needs_review');
  const [before] = await db
    .select({
      leaseToken: quotationDeliveries.leaseToken,
      leaseUntil: quotationDeliveries.leaseUntil,
    })
    .from(quotationDeliveries)
    .where(eq(quotationDeliveries.id, delivery.id));
  assert.ok(before?.leaseToken);

  // The worker is slow, not dead: its lease timestamp elapsed while the
  // transport is still gated, so the dispatch may still reach the provider.
  integrationClock = new Date(now.getTime() + DELIVERY_LEASE_MS + 60_000);

  for (const decision of ['confirmed_received', 'confirmed_not_received'] as const) {
    await assert.rejects(
      integrationRepository.resolve({
        deliveryId: delivery.id,
        decision,
        note: 'Resolução após o lease expirar.',
        resolvedBy: 'authenticated-operator',
      }),
      /envio em andamento/i,
    );
  }
  const untouched = await repository.get(delivery.id);
  assert.equal(untouched?.steps[1]?.state, 'sending');
  const [after] = await db
    .select({
      leaseToken: quotationDeliveries.leaseToken,
      leaseUntil: quotationDeliveries.leaseUntil,
    })
    .from(quotationDeliveries)
    .where(eq(quotationDeliveries.id, delivery.id));
  // Resolution neither cleared the lease nor reinterpreted the classification:
  // the step stays recoverable by the worker's own reconciliation.
  assert.equal(after?.leaseToken, before?.leaseToken);
  assert.equal(after?.leaseUntil?.getTime(), before?.leaseUntil?.getTime());
  assert.equal(transportCalls, 2);

  releaseSecondStep.resolve();
  const settled = await running;
  // Exactly one transport per step: the held dispatch was neither repeated nor
  // revoked. A predecessor is `needs_review`, so the acceptance cannot be
  // persisted and the step honestly lands ambiguous (`reconciling`).
  assert.equal(transportCalls, 2);
  assert.equal(settled?.steps[1]?.state, 'reconciling');
  assert.equal(settled?.state, 'needs_review');
  const stillSending = await repository.claim({ deliveryId: delivery.id });
  assert.equal(stillSending, null);

  const resolved = await integrationRepository.resolve({
    deliveryId: delivery.id,
    decision: 'confirmed_received',
    note: 'Cliente confirmou depois do envio concluir.',
    resolvedBy: 'authenticated-operator',
  });
  assert.equal(resolved.state, 'delivered');
  assert.deepEqual(resolved.steps.map((step) => step.state), ['delivered', 'delivered']);
  assert.equal(transportCalls, 2);
});

databaseTest('late receipts never reopen an operator-cancelled partial delivery', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'cancel-terminal-partial', steps: [textStep(0), textStep(1)] })
  );
  const first = await repository.claim({ deliveryId: delivery.id });
  assert.ok(first);
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: first.step.id,
    leaseToken: first.leaseToken,
    providerMessageId: 'provider-cancel-terminal',
  });
  assert.ok((await repository.cancelPending()) >= 1);
  const cancelled = await repository.get(delivery.id);
  assert.equal(cancelled?.state, 'failed');
  assert.equal(cancelled?.completionSource, 'operator');
  assert.deepEqual(cancelled?.steps.map((step) => step.state), ['server_ack', 'failed']);

  let transportCalls = 0;
  const module = createQuotationDeliveryModule({
    repository,
    transport: async () => {
      transportCalls += 1;
      return {
        accepted: true as const,
        providerMessageId: `provider-cancel-terminal-${transportCalls}`,
      };
    },
    now: () => now,
    logger: () => {},
  });

  const afterError = await repository.receiveReceipt({
    providerMessageId: 'provider-cancel-terminal',
    status: 'ERROR',
  });
  assert.equal(afterError?.state, 'failed');
  assert.equal(afterError?.completionSource, 'operator');
  assert.equal(afterError?.steps[0]?.state, 'needs_review');
  assert.equal(afterError?.steps[1]?.state, 'failed');

  const afterRead = await repository.receiveReceipt({
    providerMessageId: 'provider-cancel-terminal',
    status: 'READ',
  });
  assert.equal(afterRead?.state, 'failed');
  assert.equal(afterRead?.completionSource, 'operator');
  assert.equal(afterRead?.steps[0]?.state, 'read');
  assert.equal(afterRead?.steps[1]?.state, 'failed');
  assert.equal(afterRead?.steps[1]?.publicError, 'Cancelada pelo operador.');

  await assert.rejects(
    repository.resolve({
      deliveryId: delivery.id,
      decision: 'confirmed_not_received',
      note: 'Reenviar etapas canceladas.',
      resolvedBy: 'authenticated-operator',
    }),
    /não está disponível para resolução/,
  );
  const afterProcess = await module.process(delivery.id);
  assert.equal(afterProcess?.state, 'failed');
  assert.equal(transportCalls, 0);
});

databaseTest('confirmed_not_received never requeues a cancelled failed step', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'resolve-with-failed', steps: [textStep(0), textStep(1)] })
  );
  const [pendingStep, failedStep] = delivery.steps;
  await setStep(pendingStep!.id, { state: 'needs_review', updatedAt: old });
  await setStep(failedStep!.id, {
    state: 'failed',
    publicError: 'Cancelada pelo operador.',
    updatedAt: old,
  });
  await setDelivery(delivery.id, {
    state: 'needs_review',
    leaseToken: null,
    leaseUntil: null,
    updatedAt: old,
  });

  const resolved = await repository.resolve({
    deliveryId: delivery.id,
    decision: 'confirmed_not_received',
    note: 'Reenviar apenas a etapa pendente.',
    resolvedBy: 'authenticated-operator',
  });
  assert.equal(resolved.steps.find((step) => step.id === pendingStep!.id)?.state, 'queued');
  assert.equal(resolved.steps.find((step) => step.id === failedStep!.id)?.state, 'failed');
  assert.equal(
    resolved.steps.find((step) => step.id === failedStep!.id)?.publicError,
    'Cancelada pelo operador.',
  );
  assert.equal(resolved.state, 'failed');
});

databaseTest('duplicate provider callbacks stay monotonic and unknown ids never associate', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'duplicate-receipts', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId: 'provider-duplicate',
  });

  const first = await repository.receiveReceipt({
    providerMessageId: 'provider-duplicate',
    status: 'DELIVERY_ACK',
  });
  const second = await repository.receiveReceipt({
    providerMessageId: 'provider-duplicate',
    status: 'DELIVERY_ACK',
  });
  assert.equal(first?.state, 'delivered');
  assert.equal(second?.state, 'delivered');
  assert.equal(second?.steps[0]?.state, 'delivered');
  const lateServerAck = await repository.receiveReceipt({
    providerMessageId: 'provider-duplicate',
    status: 'SERVER_ACK',
  });
  assert.equal(lateServerAck?.steps[0]?.state, 'delivered');
  const lateError = await repository.receiveReceipt({
    providerMessageId: 'provider-duplicate',
    status: 'ERROR',
  });
  assert.equal(lateError?.state, 'delivered');
  assert.equal(
    await repository.receiveReceipt({ providerMessageId: 'provider-unknown', status: 'DELIVERY_ACK' }),
    null
  );
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

databaseTest('receipt before acceptance is stored durably and applied by markAccepted', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'early-receipt', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  const providerMessageId = `provider-early-${randomUUID()}`;

  // RED without the inbox: this receipt has no persisted provider id yet, so it
  // was dropped and the step stayed `server_ack`. Now it must be queued durably
  // and folded by the very transaction that persists the acceptance.
  const early = await repository.receiveReceipt({
    providerMessageId,
    status: 'DELIVERY_ACK',
  });
  assert.equal(early, null);
  const pending = await db
    .select()
    .from(evolutionReceiptInbox)
    .where(eq(evolutionReceiptInbox.providerMessageId, providerMessageId));
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.appliedAt, null);

  const accepted = await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId,
  });
  assert.equal(accepted.steps[0]?.state, 'delivered');
  assert.equal(accepted.state, 'delivered');
  assert.equal(accepted.completionSource, 'provider_receipt');
  const applied = await db
    .select()
    .from(evolutionReceiptInbox)
    .where(eq(evolutionReceiptInbox.providerMessageId, providerMessageId));
  assert.equal(applied.length, 1);
  assert.ok(applied[0]?.appliedAt);
});

databaseTest('early receipts fold in received order without regressing delivery', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'early-receipt-order', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  const providerMessageId = `provider-ordered-${randomUUID()}`;

  await repository.receiveReceipt({ providerMessageId, status: 'SERVER_ACK' });
  await repository.receiveReceipt({ providerMessageId, status: 'READ' });
  const accepted = await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId,
  });
  assert.equal(accepted.steps[0]?.state, 'read');
  assert.equal(accepted.state, 'delivered');
  const stored = await db
    .select({ status: evolutionReceiptInbox.status, appliedAt: evolutionReceiptInbox.appliedAt })
    .from(evolutionReceiptInbox)
    .where(eq(evolutionReceiptInbox.providerMessageId, providerMessageId));
  assert.equal(stored.length, 2);
  assert.equal(stored.every((row) => row.appliedAt !== null), true);
});

databaseTest('concurrent acceptance and early receipt converge on one delivered step', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'concurrent-receipt', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  const providerMessageId = `provider-race-${randomUUID()}`;

  await Promise.all([
    repository.receiveReceipt({ providerMessageId, status: 'DELIVERY_ACK' }),
    repository.markAccepted({
      deliveryId: delivery.id,
      stepId: claim.step.id,
      leaseToken: claim.leaseToken,
      providerMessageId,
    }),
  ]);

  const final = await repository.get(delivery.id);
  assert.equal(final?.steps[0]?.state, 'delivered');
  assert.equal(final?.steps[0]?.attemptCount, 1);
  assert.equal(final?.state, 'delivered');
  const rows = await db
    .select()
    .from(evolutionReceiptInbox)
    .where(eq(evolutionReceiptInbox.providerMessageId, providerMessageId));
  assert.equal(rows.length, 1);
  assert.ok(rows[0]?.appliedAt);
});

databaseTest('an early receipt folded by markAccepted projects the follow-up exactly once', async () => {
  integrationClock = new Date(now);
  const revisionId = await createIssuedRevision();
  const flowId = `early-follow-up-${randomUUID().slice(0, 8)}`;
  const providerMessageId = `provider-early-follow-up-${randomUUID()}`;
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  let receiptProjections = 0;
  const enteredTransport = Promise.withResolvers<void>();
  const releaseTransport = Promise.withResolvers<void>();

  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: {
      upsertAwaitingReceiptFromAcceptedDelivery: (value) =>
        followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value),
      upsertFromDeliveryReceipt: async (value) => {
        receiptProjections += 1;
        return followUp.upsertFromDeliveryReceipt!(value);
      },
      listAcceptedDeliveriesMissingFollowUp: (filter) =>
        followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
    },
    planner: async () => ({
      revisionId,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId,
      flowName: 'Early follow-up',
      steps: [textStep(0)],
    }),
    transport: async () => {
      enteredTransport.resolve();
      await releaseTransport.promise;
      return { accepted: true as const, providerMessageId };
    },
    now: () => new Date(integrationClock),
    instance: followUpInstance,
    logger: () => {},
  });

  const running = enqueueAndProcess(module, { revisionId, flowId });
  await enteredTransport.promise;

  // The receipt arrives before `markAccepted` persisted the provider id: it is
  // stored durably and cannot correlate yet.
  assert.equal(
    await module.applyEvolutionEvent({
      instance: followUpInstance,
      providerMessageId,
      fromMe: true,
      status: 'DELIVERY_ACK',
    }),
    null,
  );
  releaseTransport.resolve();
  const accepted = await running;
  assert.equal(accepted.state, 'delivered');
  assert.equal(accepted.completionSource, 'provider_receipt');
  assert.equal(receiptProjections, 1);

  const rows = await db
    .select()
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.state, 'waiting');
  assert.ok(rows[0]?.firstProviderReceiptAt);
  assert.equal(
    rows[0]?.dueAt?.getTime(),
    rows[0]!.firstProviderReceiptAt!.getTime() + 24 * 60 * 60 * 1000,
  );

  // No provider replay is required or expected: the projection already happened.
  await module.process(accepted.id);
  assert.equal(receiptProjections, 1);

  // A late replay of the same receipt re-projects idempotently: one row and the
  // original receipt clock, never a second delivery or a reset due time.
  await module.applyEvolutionEvent({
    instance: followUpInstance,
    providerMessageId,
    fromMe: true,
    status: 'DELIVERY_ACK',
  });
  const afterReplay = await db
    .select()
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(afterReplay.length, 1);
  assert.equal(
    afterReplay[0]?.firstProviderReceiptAt?.getTime(),
    rows[0]?.firstProviderReceiptAt?.getTime(),
  );
  assert.equal(afterReplay[0]?.dueAt?.getTime(), rows[0]?.dueAt?.getTime());
  assert.equal((await repository.get(accepted.id))?.steps[0]?.attemptCount, 1);
});

databaseTest('an early receipt keeps the durable inbox time, not the acceptance clock', async () => {
  integrationClock = new Date(now);
  const revisionId = await createIssuedRevision();
  const flowId = `early-receipt-clock-${randomUUID().slice(0, 8)}`;
  const providerMessageId = `provider-early-clock-${randomUUID()}`;
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  const enteredTransport = Promise.withResolvers<void>();
  const releaseTransport = Promise.withResolvers<void>();

  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: {
      upsertAwaitingReceiptFromAcceptedDelivery: (value) =>
        followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value),
      upsertFromDeliveryReceipt: (value) =>
        followUp.upsertFromDeliveryReceipt!(value),
      listAcceptedDeliveriesMissingFollowUp: (filter) =>
        followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
      listAwaitingReceiptWithCompletedDelivery: (filter) =>
        followUp.listAwaitingReceiptWithCompletedDelivery!(filter),
    },
    planner: async () => ({
      revisionId,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId,
      flowName: 'Early receipt clock',
      steps: [textStep(0)],
    }),
    transport: async () => {
      enteredTransport.resolve();
      await releaseTransport.promise;
      return { accepted: true as const, providerMessageId };
    },
    now: () => new Date(integrationClock),
    instance: followUpInstance,
    logger: () => {},
  });

  const running = enqueueAndProcess(module, { revisionId, flowId });
  await enteredTransport.promise;

  // The provider receipt lands first, at t0. The acceptance is only persisted
  // at t0 + 3h, so using the fold clock would lie about the receipt and shift
  // the follow-up due time three hours late.
  const receiptAt = new Date(integrationClock);
  assert.equal(
    await module.applyEvolutionEvent({
      instance: followUpInstance,
      providerMessageId,
      fromMe: true,
      status: 'DELIVERY_ACK',
    }),
    null,
  );
  integrationClock = new Date(receiptAt.getTime() + 3 * 3_600_000);
  releaseTransport.resolve();
  const accepted = await running;
  assert.equal(accepted.state, 'delivered');
  assert.equal(accepted.steps[0]?.state, 'delivered');

  const rows = await db
    .select()
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.firstProviderReceiptAt?.getTime(), receiptAt.getTime());
  assert.equal(
    rows[0]?.dueAt?.getTime(),
    rows[0]!.firstProviderReceiptAt!.getTime() + 24 * 60 * 60 * 1000,
  );
  assert.notEqual(rows[0]?.firstProviderReceiptAt?.getTime(), integrationClock.getTime());

  const [step] = await db
    .select({ deliveredAt: quotationDeliverySteps.deliveredAt })
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.deliveryId, accepted.id));
  assert.equal(step?.deliveredAt?.getTime(), receiptAt.getTime());
});

databaseTest('a rejected receipt projection is recovered by the worker without a duplicate webhook', async () => {
  integrationClock = new Date(now);
  const revisionId = await createIssuedRevision();
  const flowId = `receipt-retry-${randomUUID().slice(0, 8)}`;
  const providerMessageId = `provider-receipt-retry-${randomUUID()}`;
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  let projections = 0;
  let rejectNextProjection = true;
  let transportCalls = 0;

  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: {
      upsertAwaitingReceiptFromAcceptedDelivery: (value) =>
        followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value),
      upsertFromDeliveryReceipt: async (value) => {
        projections += 1;
        if (rejectNextProjection) {
          rejectNextProjection = false;
          throw new Error('transient projection failure');
        }
        return followUp.upsertFromDeliveryReceipt!(value);
      },
      listAcceptedDeliveriesMissingFollowUp: (filter) =>
        followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
      listAwaitingReceiptWithCompletedDelivery: (filter) =>
        followUp.listAwaitingReceiptWithCompletedDelivery!(filter),
    },
    planner: async () => ({
      revisionId,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId,
      flowName: 'Receipt retry',
      steps: [textStep(0)],
    }),
    transport: async () => {
      transportCalls += 1;
      return { accepted: true as const, providerMessageId };
    },
    now: () => new Date(integrationClock),
    instance: followUpInstance,
    logger: () => {},
  });

  const accepted = await enqueueAndProcess(module, { revisionId, flowId });
  assert.equal(accepted.state, 'provider_accepted');
  assert.equal(transportCalls, 1);

  // The receipt is folded durably, but the follow-up projection is rejected
  // once. The webhook acknowledges; no replay will ever come.
  const receiptAt = new Date(integrationClock);
  const receipt = await module.applyEvolutionEvent({
    instance: followUpInstance,
    providerMessageId,
    fromMe: true,
    status: 'DELIVERY_ACK',
  });
  assert.equal(receipt?.state, 'delivered');
  assert.equal(projections, 1);
  const [inboxRow] = await db
    .select()
    .from(evolutionReceiptInbox)
    .where(eq(evolutionReceiptInbox.providerMessageId, providerMessageId));
  assert.equal(inboxRow?.appliedAt != null, true);

  const failed = await db
    .select()
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.state, 'awaiting_receipt');
  assert.equal(failed[0]?.firstProviderReceiptAt, null);

  // Hours later the worker reconciles from the durable delivered row: no
  // webhook replay, no extra transport, exactly one follow-up.
  integrationClock = new Date(receiptAt.getTime() + 3 * 3_600_000);
  const recovered = await module.process(accepted.id);
  assert.equal(recovered?.state, 'delivered');
  assert.equal(projections, 2);
  const rows = await db
    .select()
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.state, 'waiting');
  assert.equal(rows[0]?.firstProviderReceiptAt?.getTime(), receiptAt.getTime());
  assert.equal(
    rows[0]?.dueAt?.getTime(),
    rows[0]!.firstProviderReceiptAt!.getTime() + 24 * 60 * 60 * 1000,
  );
  assert.equal(transportCalls, 1);

  // Idempotent: another pass changes nothing.
  await module.process(accepted.id);
  assert.equal(projections, 2);
  const after = await db
    .select()
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(after.length, 1);
  assert.equal(after[0]?.state, 'waiting');
  assert.equal(after[0]?.firstProviderReceiptAt?.getTime(), receiptAt.getTime());
  assert.equal(after[0]?.dueAt?.getTime(), rows[0]?.dueAt?.getTime());
  assert.equal(transportCalls, 1);
});

databaseTest('a stale preparer that lost its lease makes zero transport calls after the fence', async () => {
  integrationClock = new Date(now);
  const flowId = `lease-fence-lost-${randomUUID().slice(0, 8)}`;
  const providerMessageId = `provider-lease-fence-${randomUUID()}`;
  const delivery = await repository.enqueue(
    input({ flowId, flowName: 'Lease fence lost', steps: [pdfStep(0)] })
  );
  let staleTransportCalls = 0;
  let competingTransportCalls = 0;
  const enteredPreparation = Promise.withResolvers<void>();
  const releasePreparation = Promise.withResolvers<void>();

  const staleModule = createQuotationDeliveryModule({
    repository: integrationRepository,
    planner: async () => ({
      revisionId: ids.revision,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId,
      flowName: 'Lease fence lost',
      steps: [pdfStep(0)],
    }),
    // Preparation is gated so the lease can expire — and a competing worker can
    // recover the delivery — before the stale worker reaches the provider.
    prepareDeliveryDocument: async () => {
      enteredPreparation.resolve();
      await releasePreparation.promise;
      return {
        pdf: Buffer.from('%PDF-fence'),
        pdfSize: 10,
        pdfSignature: 'fence',
        validUntil: new Date(integrationClock.getTime() + 86_400_000),
      };
    },
    transport: async () => {
      staleTransportCalls += 1;
      return { accepted: true as const, providerMessageId };
    },
    now: () => new Date(integrationClock),
    logger: () => {},
  });

  const running = staleModule.process(delivery.id);
  await enteredPreparation.promise;
  assert.equal(staleTransportCalls, 0);

  // The worker is not dead, only slow: the database lease elapses while it is
  // still in preparation. Recovery and renewal both read the database clock, so
  // moving the injectable application clock would prove nothing.
  await setDelivery(delivery.id, { leaseUntil: old });

  // A competing worker recovers the expired lease: the stale step becomes
  // `reconciling` and the lease token is revoked.
  const recovered = await integrationRepository.claim({ deliveryId: delivery.id });
  assert.equal(recovered, null);
  const afterRecovery = await repository.get(delivery.id);
  assert.equal(afterRecovery?.steps[0]?.state, 'reconciling');
  assert.equal(afterRecovery?.state, 'reconciling');

  releasePreparation.resolve();
  const settled = await running;

  // Zero transport from the fenced stale owner: it cannot dispatch after losing
  // ownership, and it must not convert the loss into an ambiguity or a retry of
  // its own.
  assert.equal(staleTransportCalls, 0);
  const durable = await repository.get(delivery.id);
  assert.equal(durable?.steps[0]?.state, 'reconciling');
  assert.equal(durable?.steps[0]?.attemptCount, 1);
  assert.equal(durable?.state, 'reconciling');
  assert.equal(settled?.steps[0]?.state, 'reconciling');

  // Exactly one legitimate durable classification remains available: the
  // reconciliation is the only honest classifier, and once its deadline passes
  // it becomes `needs_review` — never a silent second send.
  await setDelivery(delivery.id, { reconciliationDeadline: old });
  assert.equal(await repository.expireReconciliations(10), 1);
  const classified = await repository.get(delivery.id);
  assert.equal(classified?.state, 'needs_review');

  // A later legitimate worker must not resend the ambiguous step.
  const followUpModule = createQuotationDeliveryModule({
    repository: integrationRepository,
    transport: async () => {
      competingTransportCalls += 1;
      return { accepted: true as const, providerMessageId };
    },
    now: () => new Date(integrationClock),
    logger: () => {},
  });
  const resumed = await followUpModule.process(delivery.id);
  assert.equal(competingTransportCalls, 0);
  assert.equal(resumed?.state, 'needs_review');
  assert.equal((await repository.get(delivery.id))?.steps[0]?.state, 'needs_review');
});

databaseTest('a worker that still owns the lease renews it and dispatches exactly once', async () => {
  integrationClock = new Date(now);
  const flowId = `lease-fence-kept-${randomUUID().slice(0, 8)}`;
  const providerMessageId = `provider-lease-kept-${randomUUID()}`;
  const delivery = await repository.enqueue(
    input({ flowId, flowName: 'Lease fence kept', steps: [pdfStep(0)] })
  );
  let transportCalls = 0;
  const enteredPreparation = Promise.withResolvers<void>();
  const releasePreparation = Promise.withResolvers<void>();

  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    prepareDeliveryDocument: async () => {
      enteredPreparation.resolve();
      await releasePreparation.promise;
      return {
        pdf: Buffer.from('%PDF-fence'),
        pdfSize: 10,
        pdfSignature: 'fence',
        validUntil: new Date(integrationClock.getTime() + 86_400_000),
      };
    },
    planner: async () => ({
      revisionId: ids.revision,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId,
      flowName: 'Lease fence kept',
      steps: [pdfStep(0)],
    }),
    transport: async () => {
      transportCalls += 1;
      return { accepted: true as const, providerMessageId };
    },
    now: () => new Date(integrationClock),
    logger: () => {},
  });

  const running = module.process(delivery.id);
  await enteredPreparation.promise;

  // The lease has not expired: the pre-dispatch renewal succeeds and the
  // dispatch result stays persistable.
  releasePreparation.resolve();
  const settled = await running;
  assert.equal(transportCalls, 1);
  assert.equal(settled?.state, 'provider_accepted');
  assert.equal(settled?.steps[0]?.state, 'server_ack');
  const [stored] = await db
    .select({
      providerMessageId: quotationDeliverySteps.providerMessageId,
      state: quotationDeliverySteps.state,
    })
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.deliveryId, delivery.id));
  assert.equal(stored?.providerMessageId, providerMessageId);
  assert.equal(stored?.state, 'server_ack');
});

databaseTest('renewLease refuses a step that is no longer sending or whose token was revoked', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'renew-lease-guard', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);

  // Wrong token: never renews.
  assert.equal(
    await repository.renewLease({
      deliveryId: delivery.id,
      stepId: claim.step.id,
      leaseToken: randomUUID(),
    }),
    false,
  );

  // The owning token renews while the step is still `sending`.
  assert.equal(
    await repository.renewLease({
      deliveryId: delivery.id,
      stepId: claim.step.id,
      leaseToken: claim.leaseToken,
    }),
    true,
  );

  // Once the step leaves `sending`, renewal is impossible even with the token.
  await setStep(claim.step.id, { state: 'reconciling' });
  assert.equal(
    await repository.renewLease({
      deliveryId: delivery.id,
      stepId: claim.step.id,
      leaseToken: claim.leaseToken,
    }),
    false,
  );
});

databaseTest('expired recovery and an overlapping pre-dispatch renewal serialize on the delivery row', async () => {
  // Real overlapping sessions, not sequential calls: the stale worker's lease
  // expires, recovery takes the delivery row and is paused before it revokes the
  // step, and the pre-dispatch renewal contends for the exact same fence. The
  // winner is decided by the row lock and the exact provider POST count is zero.
  integrationClock = new Date(now);
  const flowId = `lease-race-${randomUUID().slice(0, 8)}`;
  const delivery = await repository.enqueue(
    input({ flowId, flowName: 'Lease race', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);

  // The worker is only slow: the database lease elapses while it is still in
  // preparation. Recovery reads `clock_timestamp()`, so the expiry is expressed
  // in database time instead of a mutable application clock.
  await setDelivery(delivery.id, { leaseUntil: old });

  const recoveryClient = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: 'adv-lease-recovery' },
  });
  const renewalClient = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: 'adv-lease-renewal' },
  });
  const pauseClient = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: 'adv-lease-pause' },
  });
  const recoveryRepository = createPostgresQuotationDeliveryOutboxRepository(
    () => drizzle(recoveryClient, { schema }),
    { now: () => new Date(integrationClock) },
  );
  const renewalRepository = createPostgresQuotationDeliveryOutboxRepository(
    () => drizzle(renewalClient, { schema }),
    { now: () => new Date(integrationClock) },
  );

  const stepLockHeld = Promise.withResolvers<void>();
  const releaseStepLock = Promise.withResolvers<void>();
  const holdStep = pauseClient.begin(async (tx) => {
    await tx`SELECT id FROM quotation_delivery_steps WHERE id = ${claim.step.id}::uuid FOR UPDATE`;
    stepLockHeld.resolve();
    await releaseStepLock.promise;
  });

  try {
    await stepLockHeld.promise;
    // Recovery locks the delivery row (FOR UPDATE) and then blocks on the held
    // step row, exactly between its first and second durable transitions.
    const recovery = recoveryRepository.claim({ deliveryId: delivery.id });
    await waitForBackendLock('adv-lease-recovery');

    let renewalSettled = false;
    const renewal = renewalRepository.renewLease({
      deliveryId: delivery.id,
      stepId: claim.step.id,
      leaseToken: claim.leaseToken,
    });
    renewal.then(
      () => {
        renewalSettled = true;
      },
      () => {
        renewalSettled = true;
      },
    );
    const outcome = await waitForRenewalOutcome('adv-lease-renewal', () => renewalSettled);

    releaseStepLock.resolve();
    await holdStep;
    await recovery;
    const renewed = await renewal;

    // The loser of the fence is exactly the worker that may not dispatch: an
    // expired recovery revokes the lease, so the provider POST count is zero.
    // Repairing the serialization makes this deterministic regardless of the
    // observed interleaving; with recovery uncommitted and the token intact the
    // old unlocked renewal would have returned true here and produced a POST.
    let providerPosts = 0;
    if (renewed) providerPosts += 1;
    assert.equal(
      outcome === 'settled' && renewed,
      false,
      'a renewal that settles while recovery is mid-transition must not win',
    );
    assert.equal(renewed, false, 'renewal must lose to committed expired recovery');
    assert.equal(providerPosts, 0);

    const durable = await repository.get(delivery.id);
    assert.equal(durable?.steps[0]?.state, 'reconciling');
    assert.equal(durable?.state, 'reconciling');
    assert.equal(durable?.leaseToken ?? null, null);
  } finally {
    releaseStepLock.resolve();
    await holdStep.catch(() => {});
    await recoveryClient.end({ timeout: 5 });
    await renewalClient.end({ timeout: 5 });
    await pauseClient.end({ timeout: 5 });
  }
});

databaseTest('a renewal whose row-lock wait outlives the offered lease still persists a live database-time lease', async () => {
  // Red-capable adversarial case: the renewal call blocks on the delivery row
  // for longer than the lease it is about to grant. A timestamp captured before
  // the lock wait would persist an already-expired lease and still return true,
  // letting the worker dispatch into a lease recovery already revoked.
  const flowId = `lease-short-renewal-${randomUUID().slice(0, 8)}`;
  const delivery = await repository.enqueue(
    input({ flowId, flowName: 'Short renewal', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);

  const pauseClient = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: 'adv-lease-short-pause' },
  });
  const renewalClient = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: 'adv-lease-short-renewal' },
  });
  const renewalRepository = createPostgresQuotationDeliveryOutboxRepository(
    () => drizzle(renewalClient, { schema }),
    { now: () => new Date(now), leaseMs: 500 },
  );

  const rowLockHeld = Promise.withResolvers<void>();
  const releaseRowLock = Promise.withResolvers<void>();
  const holdRow = pauseClient.begin(async (tx) => {
    await tx`SELECT id FROM quotation_deliveries WHERE id = ${delivery.id}::uuid FOR UPDATE`;
    rowLockHeld.resolve();
    await releaseRowLock.promise;
  });

  try {
    await rowLockHeld.promise;
    let renewalSettled = false;
    const renewal = renewalRepository.renewLease({
      deliveryId: delivery.id,
      stepId: claim.step.id,
      leaseToken: claim.leaseToken,
    });
    renewal.then(
      () => {
        renewalSettled = true;
      },
      () => {
        renewalSettled = true;
      },
    );
    const outcome = await waitForRenewalOutcome('adv-lease-short-renewal', () => renewalSettled);
    assert.equal(outcome, 'blocked', 'the renewal must wait behind the held delivery row');

    // The lock wait exceeds the lease the renewal will offer, in real time.
    await new Promise((resolve) => setTimeout(resolve, 900));
    releaseRowLock.resolve();
    await holdRow;
    assert.equal(await renewal, true, 'the renewal owns the fence');

    const [liveRow] = (await db.execute(sql`
      SELECT lease_until > clock_timestamp() AS live
      FROM quotation_deliveries
      WHERE id = ${delivery.id}::uuid
    `)) as unknown as Array<{ live: boolean }>;
    assert.equal(
      liveRow?.live,
      true,
      'a true renewal must persist a lease that is live on the database clock',
    );
    const [leaseRow] = await db
      .select({ leaseToken: quotationDeliveries.leaseToken })
      .from(quotationDeliveries)
      .where(eq(quotationDeliveries.id, delivery.id));
    assert.equal(leaseRow?.leaseToken, claim.leaseToken);

    // A live renewal must not be revoked by a later recovery pass.
    assert.equal(await integrationRepository.claim({ deliveryId: delivery.id }), null);
    const durable = await repository.get(delivery.id);
    assert.equal(durable?.steps[0]?.state, 'sending');
  } finally {
    releaseRowLock.resolve();
    await holdRow.catch(() => {});
    await pauseClient.end({ timeout: 5 });
    await renewalClient.end({ timeout: 5 });
  }
});

databaseTest('a committed renewal prevents a later expired recovery from revoking the owner', async () => {
  integrationClock = new Date(now);
  const delivery = await repository.enqueue(
    input({ flowId: 'renewal-first', flowName: 'Renewal first', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);

  // The pre-dispatch fence succeeds first and extends the lease on the database
  // clock; no mutable application-clock advance is involved.
  assert.equal(
    await integrationRepository.renewLease({
      deliveryId: delivery.id,
      stepId: claim.step.id,
      leaseToken: claim.leaseToken,
    }),
    true,
  );
  const [renewed] = (await db.execute(sql`
    SELECT lease_until > clock_timestamp() AS live
    FROM quotation_deliveries
    WHERE id = ${delivery.id}::uuid
  `)) as unknown as Array<{ live: boolean }>;
  assert.equal(renewed?.live, true, 'the committed renewal must be live on the database clock');

  // Recovery now reads the extended lease under the same row lock and
  // must not revoke a live owner or touch its `sending` step.
  assert.equal(await integrationRepository.claim({ deliveryId: delivery.id }), null);
  const durable = await repository.get(delivery.id);
  assert.equal(durable?.steps[0]?.state, 'sending');
  const [lease] = await db
    .select({ leaseToken: quotationDeliveries.leaseToken })
    .from(quotationDeliveries)
    .where(eq(quotationDeliveries.id, delivery.id));
  assert.equal(lease?.leaseToken, claim.leaseToken);
});

databaseTest('receipt reconciliation makes bounded progress past a poison row and still claims due outbound work', async () => {
  integrationClock = new Date(now);
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  const poisonDeliveryId = randomUUID();
  const poisonFollowUpId = randomUUID();
  const poisonProviderId = `provider-poison-${randomUUID()}`;

  async function seedAwaitingReceipt(
    index: number,
    createdAt: Date,
    deliveryId = randomUUID(),
    followUpId = randomUUID(),
    providerMessageId = `provider-window-${index}-${randomUUID()}`,
  ): Promise<string> {
    const phone = `55119${String(900000 + index).padStart(8, '0')}`;
    const clientId = randomUUID();
    const quotationId = randomUUID();
    const revisionId = randomUUID();
    const crmDealId = randomUUID();
    await db.insert(clients).values({ id: clientId, nome: `Receipt window ${index}` });
    await db.insert(quotations).values({
      id: quotationId,
      businessNumber: `ORC-${String(followUpBusinessSequence++).padStart(8, '0')}`,
      clientId,
      status: 'emitido',
      issuedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(crmDeals).values({
      id: crmDealId,
      quotationId,
      clientId,
      nome: `Receipt window ${index}`,
      status: 'Orcamento Enviado',
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(quoteRevisions).values({
      ...fixtureFields,
      id: revisionId,
      quotationId,
      version: 1,
      status: 'emitido',
      issuedAt: createdAt,
      validadeDias: 15,
      entrega: '',
      fretePadrao: '0.00',
      frete: '0.00',
      clienteNome: `Receipt window ${index}`,
      companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
      subtotal: '0.00',
      total: '0.00',
      createdAt,
    });
    followUpCleanupIds.push({ clientId, quotationId, revisionId, crmDealId });
    await db.insert(quotationDeliveries).values({
      id: deliveryId,
      revisionId,
      phone,
      flowId: `receipt-window-${index}-${randomUUID().slice(0, 8)}`,
      flowName: 'Receipt window',
      state: 'delivered',
      completionSource: 'provider_receipt',
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(quotationDeliverySteps).values({
      id: randomUUID(),
      deliveryId,
      position: 0,
      type: 'text',
      payloadSnapshot: { text: `window-${index}`, delayMs: 0 },
      state: 'delivered',
      providerMessageId,
      attemptCount: 1,
      acceptedAt: createdAt,
      deliveredAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(quotationFollowUps).values({
      id: followUpId,
      quotationId,
      revisionId,
      deliveryId,
      instance: followUpInstance,
      providerConversationId: `${phone}@s.whatsapp.net`,
      canonicalPhone: phone,
      state: 'awaiting_receipt',
      createdAt,
      updatedAt: createdAt,
    });
    return deliveryId;
  }

  // An entire reconciliation slice of oldest candidates fails forever. Without
  // durable retry-order rotation those same rows are re-selected by every pass,
  // so later recoverable candidates starve; with rotation the failures move to
  // the tail and the recoverable window is reached.
  const oldest = new Date(now.getTime() - 10_000_000);
  const poisonIds: string[] = [poisonDeliveryId];
  await seedAwaitingReceipt(0, oldest, poisonDeliveryId, poisonFollowUpId, poisonProviderId);
  for (let index = 1; index < FOLLOW_UP_RECONCILIATION_BATCH; index += 1) {
    poisonIds.push(
      await seedAwaitingReceipt(index, new Date(oldest.getTime() + index * 1_000)),
    );
  }

  // 51+ candidates total: the recoverable rows sit behind a full failing slice.
  const recoverableIds: string[] = [];
  for (let index = FOLLOW_UP_RECONCILIATION_BATCH; index <= 52; index += 1) {
    recoverableIds.push(
      await seedAwaitingReceipt(index, new Date(oldest.getTime() + index * 1_000)),
    );
  }
  const pending: string[] = [...poisonIds, ...recoverableIds];

  const poisonSet = new Set(poisonIds);
  const followUpDeps = {
    upsertAwaitingReceiptFromAcceptedDelivery: (value: Parameters<
      NonNullable<typeof followUp.upsertAwaitingReceiptFromAcceptedDelivery>
    >[0]) => followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value),
    listAcceptedDeliveriesMissingFollowUp: () => Promise.resolve({ data: [], hasMore: false }),
    listAwaitingReceiptWithCompletedDelivery: (filter) =>
      followUp.listAwaitingReceiptWithCompletedDelivery!(filter),
    markReceiptProjectionAttempt: (value) =>
      followUp.markReceiptProjectionAttempt!(value),
    upsertFromDeliveryReceipt: async (value) => {
      if (poisonSet.has(value.deliveryId)) throw new Error('poison projection');
      return followUp.upsertFromDeliveryReceipt!(value as never);
    },
  };

  // A due outbound claim shares the invocation. Reconciliation failures and
  // bound must never consume the claim path's capacity.
  const dueRevisionId = await createIssuedRevision();
  const dueFlowId = `due-with-reconciliation-${randomUUID().slice(0, 8)}`;
  const dueDelivery = await repository.enqueue(
    input({ revisionId: dueRevisionId, flowId: dueFlowId, steps: [textStep(0)] })
  );
  let transportCalls = 0;
  const workerModule = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: followUpDeps,
    transport: async () => {
      transportCalls += 1;
      return { accepted: true as const, providerMessageId: `provider-due-${randomUUID()}` };
    },
    now: () => new Date(integrationClock),
    instance: followUpInstance,
    logger: () => {},
  });

  const batch = await workerModule.processDue(3);
  assert.equal(transportCalls, 1);
  assert.equal((await repository.get(dueDelivery.id))?.state, 'provider_accepted');
  // Reconciliation had far more than one slice of candidates, so the next
  // invocation must be told there is work left.
  assert.equal(batch.remaining, true);

  // Bounded slices plus rotation: repeated invocations keep making progress
  // instead of re-processing the same oldest window, and the persistent failure
  // cannot monopolize it.
  const remainingAwaiting = async (): Promise<string[]> =>
    (
      await db
        .select({ deliveryId: quotationFollowUps.deliveryId })
        .from(quotationFollowUps)
        .where(
          and(
            inArray(quotationFollowUps.deliveryId, pending),
            eq(quotationFollowUps.state, 'awaiting_receipt')
          )
        )
    ).map((row) => row.deliveryId);

  const firstRemaining = await remainingAwaiting();
  assert.equal(firstRemaining.includes(poisonDeliveryId), true);
  // Progress already happened within the first invocation: the failing head
  // rotated and the recoverable window behind it was projected.
  assert.equal(
    firstRemaining.length < pending.length,
    true,
    'the first invocation must already make progress past the poison slice',
  );
  // ...but the work is bounded: one invocation cannot drain all 53 candidates,
  // so a slow or poisoned slice can never monopolize the function budget.
  assert.equal(
    firstRemaining.length > poisonIds.length,
    true,
    'one invocation must not reconcile the whole backlog',
  );

  // Rotation: each later invocation moves attempted rows to the tail, so the
  // recoverable rows behind the failing slice are eventually reached. With
  // head-of-line selection they never would be.
  for (let pass = 0; pass < 8; pass += 1) {
    await workerModule.processDue(3);
    if ((await remainingAwaiting()).length <= poisonIds.length) break;
  }

  // Only the honest poison candidates stay `awaiting_receipt`; every recoverable
  // seeded candidate converged to its projected state.
  const converged = await remainingAwaiting();
  assert.deepEqual([...converged].sort(), [...poisonIds].sort());
  assert.equal(pending.length, 53);
  assert.equal(poisonIds.length, FOLLOW_UP_RECONCILIATION_BATCH);
});

databaseTest('duplicate callbacks stay idempotent in the durable inbox', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'duplicate-inbox', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  const providerMessageId = `provider-inbox-duplicate-${randomUUID()}`;
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId,
  });

  const first = await repository.receiveReceipt({ providerMessageId, status: 'DELIVERY_ACK' });
  const second = await repository.receiveReceipt({ providerMessageId, status: 'DELIVERY_ACK' });
  assert.equal(first?.steps[0]?.state, 'delivered');
  assert.equal(second?.steps[0]?.state, 'delivered');
  const rows = await db
    .select()
    .from(evolutionReceiptInbox)
    .where(eq(evolutionReceiptInbox.providerMessageId, providerMessageId));
  assert.equal(rows.length, 1);
  assert.equal(rows.filter((row) => row.status === 'DELIVERY_ACK').length, 1);
});

databaseTest('a receipt never resurrects an operator-cancelled step', async () => {
  const delivery = await repository.enqueue(
    input({ flowId: 'cancelled-receipt', steps: [textStep(0)] })
  );
  const claim = await repository.claim({ deliveryId: delivery.id });
  assert.ok(claim);
  const providerMessageId = `provider-cancelled-${randomUUID()}`;
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim.step.id,
    leaseToken: claim.leaseToken,
    providerMessageId,
  });
  await setStep(claim.step.id, { state: 'failed', publicError: 'Cancelada pelo operador.' });
  await setDelivery(delivery.id, {
    state: 'failed',
    completionSource: 'operator',
    publicError: 'Cancelada pelo operador.',
  });

  const receipt = await repository.receiveReceipt({ providerMessageId, status: 'READ' });
  assert.equal(receipt?.state, 'failed');
  assert.equal(receipt?.completionSource, 'operator');
  assert.equal(receipt?.steps[0]?.state, 'failed');
});

databaseTest('the durable inbox is pruned by receipt age', async () => {
  const stale = new Date(now.getTime() - 31 * 86_400_000);
  await db.insert(evolutionReceiptInbox).values([
    {
      id: randomUUID(),
      providerMessageId: `prune-applied-${randomUUID()}`,
      status: 'DELIVERY_ACK',
      receivedAt: stale,
      appliedAt: stale,
    },
    {
      id: randomUUID(),
      providerMessageId: `prune-pending-${randomUUID()}`,
      status: 'SERVER_ACK',
      receivedAt: stale,
    },
    {
      id: randomUUID(),
      providerMessageId: `prune-fresh-${randomUUID()}`,
      status: 'SERVER_ACK',
      receivedAt: now,
    },
  ]);

  await repository.receiveReceipt({
    providerMessageId: `prune-trigger-${randomUUID()}`,
    status: 'PENDING',
  });

  const remaining = await db.select().from(evolutionReceiptInbox);
  assert.equal(remaining.length, 2);
  assert.equal(remaining.some((row) => row.providerMessageId.startsWith('prune-fresh-')), true);
  assert.equal(remaining.some((row) => row.providerMessageId.startsWith('prune-trigger-')), true);
});

// ---------------------------------------------------------------------------
// Correction round 5: durable rotation and fairness, honest saturation
// reporting, and PLAYED receipt clock folding.
// ---------------------------------------------------------------------------

interface ProjectionFixture {
  deliveryId: string;
  followUpId: string | null;
  providerMessageId: string;
  revisionId: string;
  phone: string;
}

async function seedProjectionFixture(
  index: number,
  createdAt: Date,
  mode: 'accepted' | 'receipt'
): Promise<ProjectionFixture> {
  const phone = `55118${String(700000 + index).padStart(8, '0')}`;
  const clientId = randomUUID();
  const quotationId = randomUUID();
  const revisionId = randomUUID();
  const crmDealId = randomUUID();
  const deliveryId = randomUUID();
  const providerMessageId = `provider-${mode}-${index}-${randomUUID()}`;
  await db.insert(clients).values({ id: clientId, nome: `Projection ${mode} ${index}` });
  await db.insert(quotations).values({
    id: quotationId,
    businessNumber: `ORC-${String(followUpBusinessSequence++).padStart(8, '0')}`,
    clientId,
    status: 'emitido',
    issuedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(crmDeals).values({
    id: crmDealId,
    quotationId,
    clientId,
    nome: `Projection ${mode} ${index}`,
    status: 'Orcamento Enviado',
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(quoteRevisions).values({
    ...fixtureFields,
    id: revisionId,
    quotationId,
    version: 1,
    status: 'emitido',
    issuedAt: createdAt,
    validadeDias: 15,
    entrega: '',
    fretePadrao: '0.00',
    frete: '0.00',
    clienteNome: `Projection ${mode} ${index}`,
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    subtotal: '0.00',
    total: '0.00',
    createdAt,
  });
  followUpCleanupIds.push({ clientId, quotationId, revisionId, crmDealId });
  if (mode === 'receipt') {
    await db.insert(quotationDeliveries).values({
      id: deliveryId,
      revisionId,
      phone,
      flowId: `projection-receipt-${index}-${randomUUID().slice(0, 8)}`,
      flowName: 'Projection receipt',
      state: 'delivered',
      completionSource: 'provider_receipt',
      deliveredAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(quotationDeliverySteps).values({
      id: randomUUID(),
      deliveryId,
      position: 0,
      type: 'text',
      payloadSnapshot: { text: `projection-${index}`, delayMs: 0 },
      state: 'delivered',
      providerMessageId,
      attemptCount: 1,
      acceptedAt: createdAt,
      deliveredAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
    const followUpId = randomUUID();
    await db.insert(quotationFollowUps).values({
      id: followUpId,
      quotationId,
      revisionId,
      deliveryId,
      instance: followUpInstance,
      providerConversationId: `${phone}@s.whatsapp.net`,
      canonicalPhone: phone,
      state: 'awaiting_receipt',
      createdAt,
      updatedAt: createdAt,
    });
    return { deliveryId, followUpId, providerMessageId, revisionId, phone };
  }
  await db.insert(quotationDeliveries).values({
    id: deliveryId,
    revisionId,
    phone,
    flowId: `projection-accepted-${index}-${randomUUID().slice(0, 8)}`,
    flowName: 'Projection accepted',
    state: 'provider_accepted',
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(quotationDeliverySteps).values({
    id: randomUUID(),
    deliveryId,
    position: 0,
    type: 'text',
    payloadSnapshot: { text: `projection-${index}`, delayMs: 0 },
    state: 'server_ack',
    providerMessageId,
    attemptCount: 1,
    acceptedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });
  return { deliveryId, followUpId: null, providerMessageId, revisionId, phone };
}

databaseTest('PLAYED before acceptance folds the durable inbox clock, not the acceptance clock', async () => {
  integrationClock = new Date(now);
  const revisionId = await createIssuedRevision();
  const flowId = `played-clock-${randomUUID().slice(0, 8)}`;
  const providerMessageId = `provider-played-clock-${randomUUID()}`;
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  const enteredTransport = Promise.withResolvers<void>();
  const releaseTransport = Promise.withResolvers<void>();

  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: {
      upsertAwaitingReceiptFromAcceptedDelivery: (value) =>
        followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value),
      upsertFromDeliveryReceipt: (value) =>
        followUp.upsertFromDeliveryReceipt!(value),
      listAcceptedDeliveriesMissingFollowUp: (filter) =>
        followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
    },
    planner: async () => ({
      revisionId,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId,
      flowName: 'Played clock',
      steps: [textStep(0)],
    }),
    transport: async () => {
      enteredTransport.resolve();
      await releaseTransport.promise;
      return { accepted: true as const, providerMessageId };
    },
    now: () => new Date(integrationClock),
    instance: followUpInstance,
    logger: () => {},
  });

  const running = enqueueAndProcess(module, { revisionId, flowId });
  await enteredTransport.promise;

  // The PLAYED receipt lands first, at t0. The acceptance is persisted only at
  // t0 + 3h: folding must use the inbox receipt time, not the acceptance clock.
  const receiptAt = new Date(integrationClock);
  assert.equal(
    await module.applyEvolutionEvent({
      instance: followUpInstance,
      providerMessageId,
      fromMe: true,
      status: 'PLAYED',
    }),
    null,
  );
  integrationClock = new Date(receiptAt.getTime() + 3 * 3_600_000);
  releaseTransport.resolve();
  const accepted = await running;
  assert.equal(accepted.state, 'delivered');
  assert.equal(accepted.steps[0]?.state, 'read');

  const rows = await db
    .select()
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.state, 'waiting');
  assert.equal(rows[0]?.firstProviderReceiptAt?.getTime(), receiptAt.getTime());
  assert.equal(
    rows[0]?.dueAt?.getTime(),
    rows[0]!.firstProviderReceiptAt!.getTime() + 24 * 60 * 60 * 1000,
  );

  const [step] = await db
    .select({ readAt: quotationDeliverySteps.readAt })
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.deliveryId, accepted.id));
  assert.equal(step?.readAt?.getTime(), receiptAt.getTime());
  assert.notEqual(step?.readAt?.getTime(), integrationClock.getTime());
});

databaseTest('an immediate PLAYED receipt projects a follow-up from the inbox clock', async () => {
  integrationClock = new Date(now);
  const revisionId = await createIssuedRevision();
  const flowId = `played-immediate-${randomUUID().slice(0, 8)}`;
  const providerMessageId = `provider-played-immediate-${randomUUID()}`;
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  let transportCalls = 0;
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: {
      upsertAwaitingReceiptFromAcceptedDelivery: (value) =>
        followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value),
      upsertFromDeliveryReceipt: (value) =>
        followUp.upsertFromDeliveryReceipt!(value),
      listAcceptedDeliveriesMissingFollowUp: (filter) =>
        followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
    },
    planner: async () => ({
      revisionId,
      businessNumber,
      clientName: 'Cliente outbox',
      phone: '5511999999999',
      flowId,
      flowName: 'Played immediate',
      steps: [textStep(0)],
    }),
    transport: async () => {
      transportCalls += 1;
      return { accepted: true as const, providerMessageId };
    },
    now: () => new Date(integrationClock),
    instance: followUpInstance,
    logger: () => {},
  });

  const accepted = await enqueueAndProcess(module, { revisionId, flowId });
  assert.equal(accepted.state, 'provider_accepted');

  // Skew the clock forward before the PLAYED arrives: the inbox `received_at`
  // is the projection clock, exactly as it was stored at webhook time.
  const playedAt = new Date(integrationClock.getTime() + 5 * 3_600_000);
  integrationClock = playedAt;
  const receipt = await module.applyEvolutionEvent({
    instance: followUpInstance,
    providerMessageId,
    fromMe: true,
    status: 'PLAYED',
  });
  assert.equal(receipt?.steps[0]?.state, 'read');

  const rows = await db
    .select()
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.state, 'waiting');
  assert.equal(rows[0]?.firstProviderReceiptAt?.getTime(), playedAt.getTime());
  assert.equal(transportCalls, 1);
});

databaseTest('51+ poison acceptance candidates cannot starve candidate 51 and outbound claims still run', async () => {
  integrationClock = new Date(now);
  process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT = new Date(
    now.getTime() - 86_400_000,
  ).toISOString();
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  const oldest = new Date(now.getTime() - 1_000_000);
  const poison: string[] = [];
  for (let index = 0; index < 51; index += 1) {
    const fixture = await seedProjectionFixture(
      index,
      new Date(oldest.getTime() + index * 1_000),
      'accepted',
    );
    poison.push(fixture.deliveryId);
  }
  const recoverable = await seedProjectionFixture(51, new Date(oldest.getTime() + 51_000), 'accepted');
  const poisonSet = new Set(poison);
  const attempted = new Set<string>();
  const followUpDeps = {
    listAcceptedDeliveriesMissingFollowUp: (filter: { limit?: number }) =>
      followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
    markAcceptanceProjectionAttempt: (value: { deliveryId: string }) =>
      followUp.markAcceptanceProjectionAttempt!(value),
    upsertAwaitingReceiptFromAcceptedDelivery: async (value: { deliveryId: string }) => {
      attempted.add(value.deliveryId);
      if (poisonSet.has(value.deliveryId)) throw new Error('poison acceptance');
      return followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value as never);
    },
  };

  const dueRevisionId = await createIssuedRevision();
  const dueFlowId = `due-with-acceptance-${randomUUID().slice(0, 8)}`;
  const due = await repository.enqueue(
    input({ revisionId: dueRevisionId, flowId: dueFlowId, steps: [textStep(0)] }),
  );
  let transportCalls = 0;
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: followUpDeps,
    transport: async () => {
      transportCalls += 1;
      return { accepted: true as const, providerMessageId: `provider-due-${randomUUID()}` };
    },
    now: () => new Date(now),
    instance: followUpInstance,
    logger: () => {},
  });

  try {
    for (let pass = 0; pass < 8; pass += 1) await module.processDue(1);
    assert.equal(
      attempted.has(recoverable.deliveryId),
      true,
      'candidate 51 must be reached despite 51 poison candidates',
    );
    const rows = await db
      .select()
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.deliveryId, recoverable.deliveryId));
    assert.equal(rows.length, 1);
    assert.equal((await repository.get(due.id))?.state, 'provider_accepted');
    assert.equal(transportCalls, 1);
  } finally {
    delete process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT;
  }
});

databaseTest('a saturated acceptance source reports remaining even when every attempted projection succeeds', async () => {
  process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT = new Date(
    now.getTime() - 86_400_000,
  ).toISOString();
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  const oldest = new Date(now.getTime() - 1_000_000);
  for (let index = 0; index < 101; index += 1) {
    await seedProjectionFixture(index, new Date(oldest.getTime() + index * 1_000), 'accepted');
  }
  const attempted = new Set<string>();
  const followUpDeps = {
    listAcceptedDeliveriesMissingFollowUp: (filter: { limit?: number }) =>
      followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
    markAcceptanceProjectionAttempt: (value: { deliveryId: string }) =>
      followUp.markAcceptanceProjectionAttempt!(value),
    // Successful no-op: the candidate never leaves the source, so a saturated
    // source is the only reason work remains.
    upsertAwaitingReceiptFromAcceptedDelivery: async (value: { deliveryId: string }) => {
      attempted.add(value.deliveryId);
    },
  };
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: followUpDeps,
    transport: async () => ({ accepted: true as const, providerMessageId: `provider-${randomUUID()}` }),
    now: () => new Date(now),
    instance: followUpInstance,
    logger: () => {},
  });

  try {
    const first = await module.processDue(1);
    assert.equal(first.remaining, true, 'a saturated source must never report drained');
    for (let pass = 0; pass < 10 && attempted.size < 101; pass += 1) {
      await module.processDue(1);
    }
    assert.equal(attempted.size, 101, 'rotation must eventually reach every candidate');
  } finally {
    delete process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT;
  }
});

// ---------------------------------------------------------------------------
// Correction round 6: activity convergence and sticky-vs-saturated
// `remaining` semantics.
// ---------------------------------------------------------------------------

databaseTest('a final acceptance pass that drains a 21-candidate source returns remaining false', async () => {
  process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT = new Date(
    now.getTime() - 86_400_000,
  ).toISOString();
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  const oldest = new Date(now.getTime() - 1_000_000);
  for (let index = 0; index < 21; index += 1) {
    await seedProjectionFixture(index, new Date(oldest.getTime() + index * 1_000), 'accepted');
  }
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: {
      listAcceptedDeliveriesMissingFollowUp: (filter) =>
        followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
      markAcceptanceProjectionAttempt: (value) =>
        followUp.markAcceptanceProjectionAttempt!(value),
      upsertAwaitingReceiptFromAcceptedDelivery: (value) =>
        followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value),
    },
    transport: async () => ({
      accepted: true as const,
      providerMessageId: `provider-${randomUUID()}`,
    }),
    now: () => new Date(now),
    instance: followUpInstance,
    logger: () => {},
  });
  try {
    const result = await module.processDue(1);
    const stillPending = await followUp.listAcceptedDeliveriesMissingFollowUp!({ limit: 100 });
    assert.equal(stillPending.data.length, 0, 'the final pass must drain the source');
    assert.equal(result.remaining, false, 'a drained final pass must not report remaining work');
  } finally {
    delete process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT;
  }
});

databaseTest('a saturated receipt source keeps remaining true while a due outbound claim still runs', async () => {
  process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT = new Date(
    now.getTime() - 86_400_000,
  ).toISOString();
  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  const oldest = new Date(now.getTime() - 1_000_000);
  for (let index = 0; index < FOLLOW_UP_RECONCILIATION_BATCH * 2 + 1; index += 1) {
    await seedProjectionFixture(index, new Date(oldest.getTime() + index * 1_000), 'receipt');
  }
  const dueRevisionId = await createIssuedRevision();
  const dueFlowId = `r6-mixed-${randomUUID().slice(0, 8)}`;
  const due = await repository.enqueue(
    input({ revisionId: dueRevisionId, flowId: dueFlowId, steps: [textStep(0)] }),
  );
  let transportCalls = 0;
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: {
      listAcceptedDeliveriesMissingFollowUp: async () => ({ data: [], hasMore: false }),
      upsertAwaitingReceiptFromAcceptedDelivery: async () => {},
      listAwaitingReceiptWithCompletedDelivery: (filter) =>
        followUp.listAwaitingReceiptWithCompletedDelivery!(filter),
      markReceiptProjectionAttempt: (value) =>
        followUp.markReceiptProjectionAttempt!(value),
      upsertFromDeliveryReceipt: (value) =>
        followUp.upsertFromDeliveryReceipt!(value as never),
    },
    transport: async () => {
      transportCalls += 1;
      return { accepted: true as const, providerMessageId: `provider-due-${randomUUID()}` };
    },
    now: () => new Date(now),
    instance: followUpInstance,
    logger: () => {},
  });
  try {
    const result = await module.processDue(1);
    assert.equal(result.remaining, true, 'a saturated receipt source must keep reporting work');
    assert.equal(transportCalls, 1, 'the due outbound claim must still run');
    assert.equal((await repository.get(due.id))?.state, 'provider_accepted');
  } finally {
    delete process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT;
  }
});

databaseTest('an uninspectable acceptance source fails closed and keeps remaining true', async () => {
  const module = createQuotationDeliveryModule({
    repository: integrationRepository,
    followUpRepository: {
      listAcceptedDeliveriesMissingFollowUp: async () => {
        throw new Error('source down');
      },
      upsertAwaitingReceiptFromAcceptedDelivery: async () => {},
    },
    transport: async () => ({
      accepted: true as const,
      providerMessageId: `provider-${randomUUID()}`,
    }),
    now: () => new Date(now),
    instance: followUpInstance,
    logger: () => {},
  });
  const result = await module.processDue(1);
  assert.equal(result.remaining, true, 'an uninspectable source must never report drained');
});

databaseTest('a failed acceptance activity keeps the delivery in the retry source until activity and follow-up are both durable', async () => {
  integrationClock = new Date(now);
  process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT = new Date(
    now.getTime() - 86_400_000,
  ).toISOString();
  const phone = '5511999900001';
  const revisionId = await createIssuedRevision();
  const flowId = `r6-activity-${randomUUID().slice(0, 8)}`;
  const delivery = await repository.enqueue(input({ revisionId, flowId, phone, steps: [textStep(0)] }));

  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  const activity = createPostgresWhatsappContactActivityRepository(() => db);
  const conversation = `${phone}@s.whatsapp.net`;
  let activityFails = true;
  const activityDeps = {
    recordActivity: (value: Parameters<typeof activity.recordActivity>[0]) =>
      activityFails ? Promise.reject(new Error('activity down')) : activity.recordActivity(value),
  };
  const followUpDeps = {
    upsertAwaitingReceiptFromAcceptedDelivery: (value: never) =>
      followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value),
    upsertFromDeliveryReceipt: (value: never) =>
      followUp.upsertFromDeliveryReceipt!(value),
    listAcceptedDeliveriesMissingFollowUp: (filter: never) =>
      followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
    markAcceptanceProjectionAttempt: (value: never) =>
      followUp.markAcceptanceProjectionAttempt!(value),
    listAwaitingReceiptWithCompletedDelivery: (filter: never) =>
      followUp.listAwaitingReceiptWithCompletedDelivery!(filter),
    markReceiptProjectionAttempt: (value: never) =>
      followUp.markReceiptProjectionAttempt!(value),
  };
  let transportCalls = 0;
  const providerMessageId = `provider-activity-${randomUUID()}`;
  const buildModule = () =>
    createQuotationDeliveryModule({
      repository: integrationRepository,
      followUpRepository: followUpDeps,
      activityRepository: activityDeps,
      transport: async () => {
        transportCalls += 1;
        return { accepted: true as const, providerMessageId };
      },
      now: () => new Date(integrationClock),
      instance: followUpInstance,
      logger: () => {},
    });

  try {
    const first = await buildModule().processDue(1);
    assert.equal(transportCalls, 1, 'exactly one provider POST');
    assert.equal((await repository.get(delivery.id))?.state, 'provider_accepted');
    const [storedStep] = await db
      .select({ providerMessageId: quotationDeliverySteps.providerMessageId })
      .from(quotationDeliverySteps)
      .where(eq(quotationDeliverySteps.deliveryId, delivery.id));
    assert.equal(storedStep?.providerMessageId, providerMessageId, 'the provider id stays durable');
    assert.equal(
      (await db.select().from(quotationFollowUps).where(eq(quotationFollowUps.revisionId, revisionId)))
        .length,
      0,
      'the follow-up must not exist while the activity is missing',
    );
    assert.equal(first.remaining, true, 'the failed activity must keep the source non-drained');

    // Fresh module retry: the activity source is healthy now.
    activityFails = false;
    const second = await buildModule().processDue(1);
    assert.equal(second.remaining, false, 'both effects must converge');

    const followUps = await db
      .select()
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.revisionId, revisionId));
    assert.equal(followUps.length, 1, 'exactly one follow-up');
    assert.equal(followUps[0]?.state, 'awaiting_receipt');
    const activities = await db
      .select()
      .from(whatsappContactActivity)
      .where(eq(whatsappContactActivity.providerConversationId, conversation));
    assert.equal(activities.length, 1, 'exactly one activity row');
    assert.equal(activities[0]?.lastOutboundProviderMessageId, providerMessageId);
    assert.equal(transportCalls, 1, 'recovery must never replay the provider POST');
  } finally {
    await db
      .delete(whatsappContactActivity)
      .where(eq(whatsappContactActivity.providerConversationId, conversation));
    delete process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT;
  }
});

databaseTest('a failed follow-up upsert retries after a durable activity without duplicating it', async () => {
  integrationClock = new Date(now);
  process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT = new Date(
    now.getTime() - 86_400_000,
  ).toISOString();
  const phone = '5511999900002';
  const revisionId = await createIssuedRevision();
  const flowId = `r6-followup-${randomUUID().slice(0, 8)}`;
  const delivery = await repository.enqueue(input({ revisionId, flowId, phone, steps: [textStep(0)] }));

  const followUp = createPostgresQuotationFollowUpRepository(() => db);
  const activity = createPostgresWhatsappContactActivityRepository(() => db);
  const conversation = `${phone}@s.whatsapp.net`;
  let upsertFails = true;
  const followUpDeps = {
    upsertAwaitingReceiptFromAcceptedDelivery: async (value: never) => {
      if (upsertFails) throw new Error('follow-up down');
      return followUp.upsertAwaitingReceiptFromAcceptedDelivery!(value);
    },
    upsertFromDeliveryReceipt: (value: never) =>
      followUp.upsertFromDeliveryReceipt!(value),
    listAcceptedDeliveriesMissingFollowUp: (filter: never) =>
      followUp.listAcceptedDeliveriesMissingFollowUp!(filter),
    markAcceptanceProjectionAttempt: (value: never) =>
      followUp.markAcceptanceProjectionAttempt!(value),
    listAwaitingReceiptWithCompletedDelivery: (filter: never) =>
      followUp.listAwaitingReceiptWithCompletedDelivery!(filter),
    markReceiptProjectionAttempt: (value: never) =>
      followUp.markReceiptProjectionAttempt!(value),
  };
  let transportCalls = 0;
  const providerMessageId = `provider-followup-${randomUUID()}`;
  const buildModule = () =>
    createQuotationDeliveryModule({
      repository: integrationRepository,
      followUpRepository: followUpDeps,
      activityRepository: {
        recordActivity: (value: never) => activity.recordActivity(value),
      },
      transport: async () => {
        transportCalls += 1;
        return { accepted: true as const, providerMessageId };
      },
      now: () => new Date(integrationClock),
      instance: followUpInstance,
      logger: () => {},
    });

  try {
    const first = await buildModule().processDue(1);
    assert.equal(transportCalls, 1);
    assert.equal(first.remaining, true, 'the failed follow-up must keep the source non-drained');
    const activitiesDuringFailure = await db
      .select()
      .from(whatsappContactActivity)
      .where(eq(whatsappContactActivity.providerConversationId, conversation));
    assert.equal(activitiesDuringFailure.length, 1, 'the activity is durable before the follow-up');

    upsertFails = false;
    const second = await buildModule().processDue(1);
    assert.equal(second.remaining, false);
    const followUps = await db
      .select()
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.revisionId, revisionId));
    assert.equal(followUps.length, 1, 'exactly one follow-up');
    const activities = await db
      .select()
      .from(whatsappContactActivity)
      .where(eq(whatsappContactActivity.providerConversationId, conversation));
    assert.equal(activities.length, 1, 'the retry must not duplicate the activity');
    assert.equal(transportCalls, 1);
  } finally {
    await db
      .delete(whatsappContactActivity)
      .where(eq(whatsappContactActivity.providerConversationId, conversation));
    delete process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT;
  }
});
