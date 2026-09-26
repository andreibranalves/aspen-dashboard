import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { and, eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

import {
  ensureFixtureTemplateVersion,
  type FixtureRevisionFields,
} from '../fixtures/quotation-revision-seeds.ts';
import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  clients,
  crmDeals,
  quotationDeliveries,
  quotationDeliverySteps,
  quoteRevisions,
  quotations,
} from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresQuotationDeliveryOutboxRepository,
  QuotationDeliveryOutboxConflictError,
} from '../../api/_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';
import { QuotationDeliveryConflictError } from '../../api/_infrastructure/db/repositories/quotation-delivery-repository.js';
import { createPostgresQuotationFollowUpRepository } from '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.js';
import { createPostgresWhatsappContactActivityRepository } from '../../api/_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';
import { createQuotationDeliveryModule } from '../../api/_modules/quotation-delivery-outbox.js';
import { EvolutionTransportError } from '../../api/_modules/evolution-transport.js';
import { toPublicDeliveryView } from '../../api/_modules/quotation-deliveries.js';
import { REVISION_UNAVAILABLE_PUBLIC_ERROR } from '../../api/_modules/quotation-delivery-state.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import { fetchDelivery, projectDelivery } from '../../src/lib/api/quotationDeliveryApi.ts';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';
import { clearCommercialFixtures } from '../support/commercial-fixtures.ts';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const databaseSkip = 'TEST_DATABASE_URL is required for PostgreSQL-backed delivery recovery tests.';

function databaseTest(name: string, fn: () => Promise<void>) {
  return test(name, { skip: TEST_DATABASE_URL ? false : databaseSkip }, fn);
}

let sqlClient: Sql | undefined;
let db: PostgresJsDatabase<typeof schema>;
let fixtureFields: FixtureRevisionFields;

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
  fixtureFields = await ensureFixtureTemplateVersion(db as never);
});

test.after(async () => {
  // Leave no fixture behind: later files in the lane delete `quotations` whole.
  if (db) await clearCommercialFixtures(db as never);
  if (sqlClient) await sqlClient.end({ timeout: 5 });
});

async function seedQuotation(options: { dealStatus?: string; dealId?: string | null } = {}) {
  const clientId = randomUUID();
  const quotationId = randomUUID();
  const revisionId = randomUUID();
  const createdAt = new Date('2026-09-18T10:00:00.000Z');
  await db.insert(clients).values({ id: clientId, nome: 'Cliente recuperação' });
  await db.insert(quotations).values({
    id: quotationId,
    businessNumber: `ORC-${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-8)}`,
    clientId,
    status: 'emitido',
    issuedAt: createdAt,
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
    clienteNome: 'Cliente recuperação',
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    subtotal: '0.00',
    total: '0.00',
    createdAt,
  });
  let dealId: string | null = null;
  if (options.dealId !== null) {
    dealId = options.dealId || randomUUID();
    await db.insert(crmDeals).values({
      id: dealId,
      clientId,
      quotationId,
      nome: 'Cliente recuperação',
      status: options.dealStatus || 'Novo Lead',
      createdAt,
      updatedAt: createdAt,
    });
  }
  return { clientId, quotationId, revisionId, dealId, createdAt };
}

type FixtureStep =
  | { position: number; type: 'text'; payload: { text: string }; delayMs: number }
  | {
      position: number;
      type: 'quotation_pdf';
      payload: { revisionId: string; fileName: string; caption: string };
      delayMs: number;
    };

function moduleFixture(options: {
  transport: (input: {
    step: { type: string };
  }) => Promise<{ accepted: true; providerMessageId: string }>;
  clockRef: { value: Date };
  revisionId: string;
  flowId: string;
  steps: FixtureStep[];
  prepareDocument?: () => Promise<never>;
}) {
  const repository = createPostgresQuotationDeliveryOutboxRepository(() => db, {
    now: () => new Date(options.clockRef.value),
    leaseMs: 90_000,
    reconciliationMs: 120_000,
  });
  const module = createQuotationDeliveryModule({
    repository,
    now: () => new Date(options.clockRef.value),
    planner: async (input) => ({
      revisionId: input.revisionId,
      businessNumber: 'ORC-REC-TEST',
      clientName: 'Cliente recuperação',
      phone: '5511900000001',
      flowId: input.flowId,
      flowName: 'Fluxo recuperação',
      steps: options.steps,
    }),
    transport: options.transport as never,
    prepareDeliveryDocument: options.prepareDocument as never,
    followUpRepository: createPostgresQuotationFollowUpRepository(() => db as never),
    activityRepository: createPostgresWhatsappContactActivityRepository(() => db as never),
  });
  return { repository, module };
}

const textStep = (position: number) => ({
  position,
  type: 'text' as const,
  payload: { text: `Mensagem ${position}` },
  delayMs: 0,
});

const pdfStep = (position: number, revisionId: string) => ({
  position,
  type: 'quotation_pdf' as const,
  payload: { revisionId, fileName: 'ORC.pdf', caption: '' },
  delayMs: 0,
});

async function readDeal(quotationId: string) {
  const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.quotationId, quotationId));
  return deal || null;
}

/**
 * Projects one durable aggregate exactly as the screen does: the public payload
 * goes through the real client parser before the projection reads it, so the
 * assertion covers the wire shape (snake_case `failure_kind`, `progress.accepted`)
 * and not only the in-process object.
 */
async function projectPublicDelivery(delivery: { id: string } & Record<string, unknown>) {
  const payload = toPublicDeliveryView(delivery as never, { includePhone: true });
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
  try {
    const parsed = await fetchDelivery({ id: delivery.id });
    assert.ok(parsed, 'the public payload must parse');
    return { parsed, projection: projectDelivery(parsed) };
  } finally {
    globalThis.fetch = original;
  }
}

databaseTest(
  'an unreachable provider freezes the delivery until the worker runs, and the screen never claims it was sent',
  async () => {
    const { quotationId, revisionId } = await seedQuotation();
    const clockRef = { value: new Date('2026-09-18T10:26:00.000Z') };
    let transportCalls = 0;
    const { module } = moduleFixture({
      clockRef,
      revisionId,
      flowId: `flow-${revisionId}`,
      steps: [textStep(0), textStep(1)],
      transport: async () => {
        transportCalls += 1;
        throw new EvolutionTransportError(
          'Falha ao conectar com o WhatsApp.',
          'ambiguous',
          'EVOLUTION_NETWORK'
        );
      },
    });

    const delivery = await module.enqueue({
      revisionId,
      flowId: `flow-${revisionId}`,
      quotationId,
      phone: '5511900000001',
      flowName: 'Fluxo recuperação',
    });
    assert.equal(delivery.state, 'reconciling');
    assert.equal(transportCalls, 1);
    const { parsed, projection } = await projectPublicDelivery(delivery);
    assert.deepEqual(parsed.progress, { accepted: 0, delivered: 0, total: 2 });
    assert.equal(projection.sendConfirmed, false);
    assert.doesNotMatch(projection.sendBlockedReason, /já foi enviado/i);

    // Without a worker invocation nothing moves: a whole day of clock does not
    // change the state, which is exactly the incident's frozen screen.
    clockRef.value = new Date('2026-09-19T10:26:00.000Z');
    const frozen = await module.get({ deliveryId: delivery.id });
    assert.equal(frozen?.state, 'reconciling');
    assert.equal((await projectPublicDelivery(frozen!)).projection.requiresAction, false);

    // The expiry counts as processed; nothing is claimed for transport.
    const processed = await module.processDue(3, 5_000);
    assert.equal(processed.processed, 1);
    const recovered = await module.get({ deliveryId: delivery.id });
    assert.equal(recovered?.state, 'needs_review');
    const recoveredProjection = (await projectPublicDelivery(recovered!)).projection;
    assert.equal(recoveredProjection.requiresAction, true);
    assert.equal(recoveredProjection.canRetrySameRevision, false);
    assert.equal(transportCalls, 1, 'no blind re-send happened');

    // The commercial stage was never claimed by the failed dispatch.
    const deal = await readDeal(quotationId);
    assert.equal(deal?.status, 'Novo Lead');
  }
);

databaseTest(
  'a permanent pre-transport rejection can be re-sent on the same revision after explicit confirmation',
  async () => {
    const { quotationId, revisionId, dealId } = await seedQuotation();
    const clockRef = { value: new Date('2026-09-18T11:00:00.000Z') };
    let accept = false;
    const accepted: string[] = [];
    const { module } = moduleFixture({
      clockRef,
      revisionId,
      flowId: `flow-${revisionId}`,
      steps: [textStep(0)],
      transport: async () => {
        if (!accept) {
          throw new EvolutionTransportError(
            'O provedor rejeitou o transporte.',
            'permanent_pre_transport',
            'EVOLUTION_HTTP_422'
          );
        }
        const providerMessageId = `fake-${randomUUID()}`;
        accepted.push(providerMessageId);
        return { accepted: true, providerMessageId };
      },
    });

    const delivery = await module.enqueue({
      revisionId,
      flowId: `flow-${revisionId}`,
      quotationId,
      phone: '5511900000001',
      flowName: 'Fluxo recuperação',
    });
    assert.equal(delivery.state, 'failed');
    const failedStep = delivery.steps[0];
    assert.equal(failedStep?.state, 'failed');
    assert.equal(failedStep?.failureKind, 'permanent_pre_transport');
    assert.equal((await projectPublicDelivery(delivery)).projection.canRetrySameRevision, true);
    assert.equal((await readDeal(quotationId))?.status, 'Novo Lead');

    // A blind retry without the explicit decision is refused: the only path is
    // the operator's confirmed same-revision re-send.
    await assert.rejects(
      () =>
        module.resolve({
          deliveryId: delivery.id,
          decision: 'confirmed_not_received' as never,
          note: 'tentativa sem confirmação',
          resolvedBy: 'authenticated-operator',
        }),
      (error: unknown) => error instanceof QuotationDeliveryOutboxConflictError
    );

    const resolved = await module.resolve({
      deliveryId: delivery.id,
      decision: 'retry_same_revision',
      note: 'Provedor rejeitou antes do envio.',
      resolvedBy: 'authenticated-operator',
    });
    assert.equal(resolved.steps[0]?.state, 'queued');
    assert.equal(resolved.steps[0]?.failureKind, null);

    accept = true;
    await module.processDue(3, 5_000);
    const finished = await module.get({ deliveryId: delivery.id });
    assert.equal(finished?.state, 'provider_accepted');
    assert.equal(finished?.steps[0]?.state, 'server_ack');
    assert.equal(
      accepted.length,
      1,
      'the same revision was dispatched exactly once after the decision'
    );
    // Same revision: no new commercial revision was created to bypass the failure.
    const revisions = await db
      .select()
      .from(quoteRevisions)
      .where(eq(quoteRevisions.quotationId, quotationId));
    assert.equal(revisions.length, 1);
    // The accepted dispatch is what authorizes the commercial stage.
    assert.equal((await readDeal(quotationId))?.status, 'Orcamento Enviado');
    assert.ok(dealId);
  }
);

databaseTest('an operator-cancelled delivery never offers the same-revision re-send', async () => {
  const cancelledSeed = await seedQuotation();
  const clockRef = { value: new Date('2026-09-18T12:00:00.000Z') };
  const cancelled = moduleFixture({
    clockRef,
    revisionId: cancelledSeed.revisionId,
    flowId: `flow-${cancelledSeed.revisionId}`,
    steps: [textStep(0)],
    transport: async () => {
      // 429: a retry is scheduled automatically, which is what the operator
      // then clears from the queue.
      throw new EvolutionTransportError(
        'O provedor limitou temporariamente o transporte.',
        'transient_pre_transport',
        'EVOLUTION_RATE_LIMIT'
      );
    },
  });
  const delivery = await cancelled.module.enqueue({
    revisionId: cancelledSeed.revisionId,
    flowId: `flow-${cancelledSeed.revisionId}`,
    quotationId: cancelledSeed.quotationId,
    phone: '5511900000001',
    flowName: 'Fluxo recuperação',
  });
  assert.equal(delivery.state, 'retry_scheduled');
  assert.equal(await cancelled.repository.cancelPending(), 1);
  const cancelledAggregate = await cancelled.module.get({ deliveryId: delivery.id });
  assert.equal(cancelledAggregate?.state, 'failed');
  assert.equal(cancelledAggregate?.completionSource, 'operator');
  assert.equal(
    (await projectPublicDelivery(cancelledAggregate!)).projection.canRetrySameRevision,
    false
  );
  await assert.rejects(
    () =>
      cancelled.module.resolve({
        deliveryId: delivery.id,
        decision: 'retry_same_revision',
        note: 'cancelada não volta',
        resolvedBy: 'authenticated-operator',
      }),
    (error: unknown) => error instanceof QuotationDeliveryOutboxConflictError
  );
  const afterCancel = await db
    .select()
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.deliveryId, delivery.id));
  assert.equal(afterCancel[0]?.state, 'failed');
});

databaseTest('an undeliverable revision is never offered as a same-revision re-send', async () => {
  const { quotationId, revisionId, dealId } = await seedQuotation();
  const clockRef = { value: new Date('2026-09-18T14:00:00.000Z') };
  let transportCalls = 0;
  const { module } = moduleFixture({
    clockRef,
    revisionId,
    flowId: `flow-${revisionId}`,
    steps: [pdfStep(0, revisionId)],
    // The revision expires while the worker is stopped (INC-W02): preparing the
    // document is what fails, never the transport.
    prepareDocument: async () => {
      throw new QuotationDeliveryConflictError(
        'A revisão do orçamento está vencida. Emita uma nova revisão.'
      );
    },
    transport: async () => {
      transportCalls += 1;
      return { accepted: true as const, providerMessageId: `fake-${randomUUID()}` };
    },
  });

  const delivery = await module.enqueue({
    revisionId,
    flowId: `flow-${revisionId}`,
    quotationId,
    phone: '5511900000001',
    flowName: 'Fluxo recuperação',
  });

  // The failure is provably pre-transport, but its cause is the revision itself:
  // re-sending the same revision can only fail again the same way.
  assert.equal(delivery.state, 'failed');
  assert.equal(delivery.steps[0]?.state, 'failed');
  assert.equal(delivery.steps[0]?.failureKind, 'permanent_pre_transport');
  assert.equal(delivery.steps[0]?.publicError, REVISION_UNAVAILABLE_PUBLIC_ERROR);
  assert.equal(transportCalls, 0);

  const { parsed, projection } = await projectPublicDelivery(delivery);
  assert.equal(parsed.steps[0]?.retryBlocked, true);
  assert.equal(projection.canRetrySameRevision, false);
  assert.equal(
    projection.sendBlockedReason,
    'A revisão não está disponível para envio. Emita uma nova revisão.'
  );

  await assert.rejects(
    () =>
      module.resolve({
        deliveryId: delivery.id,
        decision: 'retry_same_revision',
        note: 'Reenvio da mesma revisão vencida.',
        resolvedBy: 'authenticated-operator',
      }),
    (error: unknown) =>
      error instanceof QuotationDeliveryOutboxConflictError &&
      /Emita uma nova revisão/.test((error as Error).message)
  );

  // The refused decision changed nothing: the step stays failed, never requeued.
  const after = await db
    .select()
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.deliveryId, delivery.id));
  assert.equal(after[0]?.state, 'failed');
  assert.ok(dealId);
});

databaseTest(
  'a sequence only claims the commercial stage when its terminal step is decided',
  async () => {
    const { quotationId, revisionId } = await seedQuotation();
    const clockRef = { value: new Date('2026-09-18T13:00:00.000Z') };
    let calls = 0;
    const { module } = moduleFixture({
      clockRef,
      revisionId,
      flowId: `flow-${revisionId}`,
      steps: [textStep(0), textStep(1)],
      transport: async () => {
        calls += 1;
        if (calls === 2) {
          throw new EvolutionTransportError(
            'Falha ao conectar com o WhatsApp.',
            'ambiguous',
            'EVOLUTION_NETWORK'
          );
        }
        return { accepted: true, providerMessageId: `fake-${randomUUID()}` };
      },
    });

    const delivery = await module.enqueue({
      revisionId,
      flowId: `flow-${revisionId}`,
      quotationId,
      phone: '5511900000001',
      flowName: 'Fluxo recuperação',
    });
    assert.deepEqual(
      delivery.steps.map((entry) => entry.state),
      ['server_ack', 'reconciling']
    );
    assert.equal(delivery.state, 'reconciling');
    assert.equal((await readDeal(quotationId))?.status, 'Novo Lead');

    clockRef.value = new Date('2026-09-18T13:05:00.000Z');
    await module.processDue(3, 5_000);
    const needsReview = await module.get({ deliveryId: delivery.id });
    assert.equal(needsReview?.state, 'needs_review');
    assert.equal((await readDeal(quotationId))?.status, 'Novo Lead');

    const resolved = await module.resolve({
      deliveryId: delivery.id,
      decision: 'confirmed_received',
      note: 'Cliente confirmou recebimento.',
      resolvedBy: 'authenticated-operator',
    });
    assert.equal(resolved.state, 'delivered');
    // The operator confirmation closed the terminal step without any provider
    // acceptance of its own; the sequence is decided and the stage advances.
    assert.equal(resolved.completionSource, 'operator');
    const terminal = resolved.steps.reduce((last, entry) =>
      entry.position > last.position ? entry : last
    );
    assert.equal(terminal.acceptedAt, null);
    assert.equal((await readDeal(quotationId))?.status, 'Orcamento Enviado');
  }
);

databaseTest(
  'an already advanced or lost stage is never regressed by an accepted dispatch',
  async () => {
    const advanced = await seedQuotation({ dealStatus: 'Em Negociacao' });
    const clockRef = { value: new Date('2026-09-18T14:00:00.000Z') };
    const advancedFixture = moduleFixture({
      clockRef,
      revisionId: advanced.revisionId,
      flowId: `flow-${advanced.revisionId}`,
      steps: [textStep(0)],
      transport: async () => ({ accepted: true, providerMessageId: `fake-${randomUUID()}` }),
    });
    await advancedFixture.module.enqueue({
      revisionId: advanced.revisionId,
      flowId: `flow-${advanced.revisionId}`,
      quotationId: advanced.quotationId,
      phone: '5511900000001',
      flowName: 'Fluxo recuperação',
    });
    assert.equal((await readDeal(advanced.quotationId))?.status, 'Em Negociacao');

    const lost = await seedQuotation({ dealStatus: 'Perdido' });
    const lostFixture = moduleFixture({
      clockRef,
      revisionId: lost.revisionId,
      flowId: `flow-${lost.revisionId}`,
      steps: [textStep(0)],
      transport: async () => ({ accepted: true, providerMessageId: `fake-${randomUUID()}` }),
    });
    await lostFixture.module.enqueue({
      revisionId: lost.revisionId,
      flowId: `flow-${lost.revisionId}`,
      quotationId: lost.quotationId,
      phone: '5511900000001',
      flowName: 'Fluxo recuperação',
    });
    assert.equal((await readDeal(lost.quotationId))?.status, 'Perdido');
  }
);
