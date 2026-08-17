import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';

import * as schema from '../../api/_db/schema.js';
import {
  clients,
  quoteRevisions,
  quotations,
  quotationDeliveries,
  quotationDeliverySteps,
} from '../../api/_db/schema.js';
import {
  createPostgresQuotationDeliveryOutboxRepository,
  type EnqueueDeliveryRecord,
} from '../../api/_db/quotation-delivery-outbox-repository.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const databaseSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; PostgreSQL outbox tests must run without skips.';
const now = new Date('2026-08-17T12:00:00.000Z');
const old = new Date(now.getTime() - 2 * 86_400_000);

const ids = {
  client: randomUUID(),
  quotation: randomUUID(),
  revision: randomUUID(),
};
const businessNumber = `ORC-${String(Date.now()).slice(-8)}`;

let sqlClient: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createPostgresQuotationDeliveryOutboxRepository>;

const textStep = (position = 0, text = `step-${position}`) => ({
  position,
  type: 'text' as const,
  payload: { text },
  delayMs: 0,
});

function input(
  options: Partial<Pick<EnqueueDeliveryRecord, 'flowId' | 'flowName' | 'phone' | 'steps'>> = {}
): EnqueueDeliveryRecord {
  const flowId = options.flowId || `flow-${randomUUID().slice(0, 8)}`;
  return {
    revisionId: ids.revision,
    phone: options.phone || '5511999999999',
    flowId,
    flowName: options.flowName || `Flow ${flowId}`,
    steps: options.steps || [textStep(0), textStep(1)],
  };
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
  await db.insert(quoteRevisions).values({
    id: ids.revision,
    quotationId: ids.quotation,
    version: 1,
    status: 'emitido',
    issuedAt: now,
    validadeDias: 15,
    pagamento: '',
    entrega: '',
    fretePadrao: '0.00',
    frete: '0.00',
    observacoes: '',
    prazoProducao: '',
    templatePadrao: 'padrao',
    clienteNome: 'Cliente outbox',
    subtotal: '0.00',
    total: '0.00',
    createdAt: now,
  });
  repository = createPostgresQuotationDeliveryOutboxRepository(() => db, { now: () => now });
});

test.after(async () => {
  if (!TEST_DATABASE_URL || !db || !sqlClient) return;
  await db.delete(quotationDeliveries).where(eq(quotationDeliveries.revisionId, ids.revision));
  await db.delete(quoteRevisions).where(eq(quoteRevisions.id, ids.revision));
  await db.delete(quotations).where(eq(quotations.id, ids.quotation));
  await db.delete(clients).where(eq(clients.id, ids.client));
  await sqlClient.end({ timeout: 5 });
});

test(
  'enqueue is idempotent by revision and flow but independent across flows',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const first = await repository.enqueue(input({ flowId: 'flow-a', flowName: 'Flow A' }));
    const replay = await repository.enqueue(input({ flowId: 'flow-a', flowName: 'Flow A' }));
    const other = await repository.enqueue(input({ flowId: 'flow-b', flowName: 'Flow B' }));
    assert.equal(replay.id, first.id);
    assert.notEqual(other.id, first.id);
    assert.equal((await repository.get(first.id))?.steps.length, 2);
    await assert.rejects(
      repository.enqueue(input({ flowId: 'flow-a', flowName: 'Flow A', phone: '5521999999999' }))
    );
  }
);

test(
  'two claims produce one lease and accepted steps never reclaim',
  { skip: databaseSkip, concurrency: false },
  async () => {
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
  }
);

test('expired lease is reclaimable', { skip: databaseSkip, concurrency: false }, async () => {
  const delivery = await repository.enqueue(
    input({
      flowId: 'claim-expired',
      flowName: 'Claim expired',
      steps: [textStep()],
    })
  );
  const first = await repository.claim({ deliveryId: delivery.id });
  assert.ok(first);
  await setDelivery(delivery.id, { leaseUntil: new Date(now.getTime() - 1_000) });
  const second = await repository.claim({ deliveryId: delivery.id });
  assert.ok(second);
  assert.equal(second.step.id, first.step.id);
});

test(
  'providerMessageId is unique and invalid leases cannot update a step',
  { skip: databaseSkip, concurrency: false },
  async () => {
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

    const second = await repository.enqueue(
      input({
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
  }
);

test(
  'duplicate and out-of-order receipts are monotonic',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const delivery = await repository.enqueue(
      input({
        flowId: 'receipts',
        flowName: 'Receipts',
        steps: [textStep()],
      })
    );
    const claim = await repository.claim({ deliveryId: delivery.id });
    assert.ok(claim);
    await repository.markAccepted({
      deliveryId: delivery.id,
      stepId: claim.step.id,
      leaseToken: claim.leaseToken,
      providerMessageId: 'provider-receipt-order',
    });
    const delivered = await repository.applyReceipt({
      providerMessageId: 'provider-receipt-order',
      status: 'DELIVERY_ACK',
    });
    assert.equal(delivered?.state, 'delivered');
    const duplicate = await repository.applyReceipt({
      providerMessageId: 'provider-receipt-order',
      status: 'DELIVERY_ACK',
    });
    assert.deepEqual(duplicate, delivered);
    const late = await repository.applyReceipt({
      providerMessageId: 'provider-receipt-order',
      status: 'SERVER_ACK',
    });
    assert.equal(late?.state, 'delivered');
    assert.equal(late?.steps[0]?.state, 'delivered');
  }
);

test(
  'list supports filtering and pagination without provider payloads',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const deliveries = await Promise.all([
      repository.enqueue(
        input({ flowId: 'list-unique-a', flowName: 'List unique A', steps: [textStep()] })
      ),
      repository.enqueue(
        input({ flowId: 'list-unique-b', flowName: 'List unique B', steps: [textStep()] })
      ),
      repository.enqueue(
        input({ flowId: 'list-unique-c', flowName: 'List unique C', steps: [textStep()] })
      ),
    ]);
    await setDelivery(deliveries[1].id, {
      state: 'needs_review',
      updatedAt: old,
      publicError: 'operator-safe',
    });
    await setDelivery(deliveries[2].id, { state: 'provider_accepted', updatedAt: old });
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
  }
);

test(
  'markFailure schedules safe retries and expires ambiguous reconciliation',
  { skip: databaseSkip, concurrency: false },
  async () => {
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

    const ambiguousDelivery = await repository.enqueue(
      input({
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
  }
);

test(
  'confirmed_received records operator completion',
  { skip: databaseSkip, concurrency: false },
  async () => {
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
    await setDelivery(delivery.id, { state: 'provider_accepted', updatedAt: old });
    const resolved = await repository.resolve({
      deliveryId: delivery.id,
      decision: 'confirmed_received',
      note: 'Cliente confirmou recebimento.',
      resolvedBy: 'authenticated-operator',
    });
    assert.equal(resolved.state, 'delivered');
    assert.equal(resolved.completionSource, 'operator');
    assert.equal(resolved.steps[0]?.state, 'delivered');
  }
);

test(
  'confirmed_not_received requeues only unresolved steps',
  { skip: databaseSkip, concurrency: false },
  async () => {
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
    await setStep(unresolved.id, { state: 'needs_review', updatedAt: old });
    await setDelivery(delivery.id, { state: 'needs_review', updatedAt: old });
    const resolved = await repository.resolve({
      deliveryId: delivery.id,
      decision: 'confirmed_not_received',
      note: 'Etapa pendente será reenviada.',
      resolvedBy: 'authenticated-operator',
    });
    assert.equal(resolved.state, 'queued');
    assert.equal(resolved.steps.find((step) => step.id === accepted.id)?.state, 'server_ack');
    assert.equal(resolved.steps.find((step) => step.id === unresolved.id)?.state, 'queued');
    assert.equal(resolved.steps.find((step) => step.id === accepted.id)?.publicError, null);
    const stored = await db
      .select({ providerMessageId: quotationDeliverySteps.providerMessageId })
      .from(quotationDeliverySteps)
      .where(eq(quotationDeliverySteps.id, accepted.id));
    assert.equal(stored[0]?.providerMessageId, 'provider-resolve-accepted');
  }
);
