import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, sql, inArray} from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  clients,
  crmDeals,
  opportunityDeliveryAnchors,
  opportunityNextActions,
  manualContactEvents,
  quoteRevisions,
  quotations,
  quotationDeliveries,
  quotationDeliverySteps,
  whatsappContactActivity,
  quotationFollowUps,
  quotationFollowUpAttemptHistory,
} from '../../api/_infrastructure/db/schema.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import { ensureFixtureTemplateVersion } from '../fixtures/quotation-revision-seeds.ts';
import { createPostgresQuotationFollowUpRepository } from '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.js';
import { createPostgresOpportunityActionRepository } from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import { materializeQuotationFollowUpQueue } from '../../api/_infrastructure/db/repositories/quotation-follow-up-facts.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const databaseUrl = resolveDisposableTestDatabaseUrl(process.env);
const skip = 'TEST_DATABASE_URL is required for PostgreSQL-backed follow-up tests.';
const instance = `follow-up-${randomUUID()}`;
const now = new Date('2026-08-31T12:00:00.000Z');
const tracking = new Date('2026-08-01T00:00:00.000Z');
const ids = {
  client: randomUUID(),
  quotation: randomUUID(),
  revision: randomUUID(),
  delivery: randomUUID(),
  resendDelivery: randomUUID(),
  step: randomUUID(),
  secondStep: randomUUID(),
  activity: randomUUID(),
  crm: randomUUID(),
};
const businessNumber = `ORC-${String(Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 8), 16) % 100000000).padStart(8, '0')}`;
let client: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>>;

function deliveryValues(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.delivery,
    revisionId: ids.revision,
    phone: '5511999999999',
    flowId: `flow-${ids.delivery}`,
    flowName: 'Follow-up test',
    state: 'delivered',
    completionSource: 'provider_receipt',
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
    updatedAt: now,
    ...overrides,
  };
}

function databaseTest(name: string, fn: () => Promise<void>) {
  return test(name, { ...(databaseUrl ? {} : { skip }) }, fn);
}

let extraFixtureSequence = 0;

async function createExtraEligibleFixture(options: {
  opportunityId?: string;
  createOpportunity?: boolean;
  linkQuotation?: boolean;
  instanceName?: string;
} = {}) {
  extraFixtureSequence += 1;
  const localIds = {
    client: randomUUID(),
    quotation: randomUUID(),
    revision: randomUUID(),
    delivery: randomUUID(),
    step: randomUUID(),
    activity: randomUUID(),
  };
  const phone = `5511999${String(10000 + extraFixtureSequence).slice(-5)}`;
  const localBusinessNumber = `ORC-${String(Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 8), 16) % 100000000).padStart(8, '0')}`;
  const ownOpportunity = options.createOpportunity !== false;
  const fixtureInstance = options.instanceName || instance;
  const opportunityId = options.opportunityId || randomUUID();
  const fixture = await ensureFixtureTemplateVersion(db as never);

  await db.insert(clients).values({ id: localIds.client, nome: `Cliente extra ${extraFixtureSequence}` });
  await db.insert(quotations).values({
    id: localIds.quotation,
    businessNumber: localBusinessNumber,
    clientId: localIds.client,
    status: 'emitido',
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (ownOpportunity) {
    await db.insert(crmDeals).values({
      id: opportunityId,
      quotationId: localIds.quotation,
      clientId: localIds.client,
      nome: `Cliente extra ${extraFixtureSequence}`,
      status: 'Orcamento Enviado',
      createdAt: now,
      updatedAt: now,
    });
  }
  if (options.linkQuotation !== false) {
    await db.update(quotations).set({ opportunityId }).where(eq(quotations.id, localIds.quotation));
  }
  await db.insert(quoteRevisions).values({
    ...fixture,
    id: localIds.revision,
    quotationId: localIds.quotation,
    version: 1,
    status: 'emitido',
    issuedAt: now,
    validadeDias: 30,
    entrega: '',
    fretePadrao: '0.00',
    frete: '0.00',
    clienteNome: `Cliente extra ${extraFixtureSequence}`,
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    subtotal: '100.00',
    total: '100.00',
    createdAt: now,
  });
  await db.insert(quotationDeliveries).values({
    id: localIds.delivery,
    revisionId: localIds.revision,
    phone,
    flowId: `flow-${localIds.delivery}`,
    flowName: 'Follow-up extra',
    state: 'delivered',
    completionSource: 'provider_receipt',
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
    updatedAt: now,
  } as never);
  await db.insert(quotationDeliverySteps).values({
    id: localIds.step,
    deliveryId: localIds.delivery,
    position: 0,
    type: 'text',
    payloadSnapshot: { text: 'extra' },
    state: 'delivered',
    providerMessageId: `provider-${localIds.step}`,
    acceptedAt: new Date('2026-08-02T00:00:00.000Z'),
    deliveredAt: new Date('2026-08-02T00:01:00.000Z'),
    readAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(whatsappContactActivity).values({
    id: localIds.activity,
    instance: fixtureInstance,
    providerConversationId: `${phone}@s.whatsapp.net`,
    canonicalPhone: phone,
    identityStatus: 'verified',
    lastInboundAt: null,
    lastOutboundAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    ids: localIds,
    phone,
    opportunityId,
    cleanup: async () => {
      await db.delete(manualContactEvents).where(eq(manualContactEvents.opportunityId, opportunityId));
      await db.delete(quotationFollowUpAttemptHistory).where(eq(quotationFollowUpAttemptHistory.quotationId, localIds.quotation));
      await db.delete(quotationFollowUpAttemptHistory).where(eq(quotationFollowUpAttemptHistory.opportunityId, opportunityId));
      await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, localIds.quotation));
      await db.execute(sql`
        DELETE FROM quotation_follow_ups follow_up
        USING quotations quotation
        WHERE follow_up.quotation_id = quotation.id
          AND quotation.opportunity_id = ${opportunityId}
      `);
      await db
        .delete(opportunityDeliveryAnchors)
        .where(eq(opportunityDeliveryAnchors.opportunityId, opportunityId));
      await db
        .delete(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      await db.delete(whatsappContactActivity).where(eq(whatsappContactActivity.id, localIds.activity));
      await db.delete(quotationDeliverySteps).where(eq(quotationDeliverySteps.id, localIds.step));
      await db.delete(quotationDeliveries).where(eq(quotationDeliveries.id, localIds.delivery));
      await db.delete(quoteRevisions).where(eq(quoteRevisions.id, localIds.revision));
      // An accepted dispatch promotes (and may create) the deal behind the
      // quotation, so the fixture clears every deal pointing at its own
      // quotation. A shared opportunity passed in by the caller belongs to
      // another fixture and is never deleted here.
      await db.delete(crmDeals).where(eq(crmDeals.quotationId, localIds.quotation));
      await db.delete(quotations).where(eq(quotations.id, localIds.quotation));
      await db.delete(clients).where(eq(clients.id, localIds.client));
    },
  };
}

async function projectReady(
  repository: ReturnType<typeof createPostgresQuotationFollowUpRepository>,
  fixture: { ids: { quotation: string; revision: string; delivery: string }; phone: string },
) {
  await db.update(crmDeals).set({ followUpStage: 0 }).where(eq(crmDeals.id, ids.crm));
  await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
    deliveryId: fixture.ids.delivery,
    revisionId: fixture.ids.revision,
    phone: fixture.phone,
    providerMessageId: `provider-accepted-${fixture.ids.delivery}`,
  });
  await repository.upsertFromDeliveryReceipt!({
    deliveryId: fixture.ids.delivery,
    revisionId: fixture.ids.revision,
    phone: fixture.phone,
    providerConversationId: `${fixture.phone}@s.whatsapp.net`,
    allStepsDelivered: true,
    receivedAt: new Date('2026-08-02T00:01:00.000Z'),
  });
  const listed = await repository.list({ now, pageSize: 100 });
  const ready = listed.data.find((row) => row.quotationId === fixture.ids.quotation);
  assert.ok(ready);
  assert.equal(ready.state, 'ready');
  return ready;
}

async function resetSharedFollowUpGraph() {
  await db.delete(manualContactEvents).where(eq(manualContactEvents.opportunityId, ids.crm));
  await db.delete(quotationFollowUpAttemptHistory).where(eq(quotationFollowUpAttemptHistory.quotationId, ids.quotation));
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  await db.delete(opportunityDeliveryAnchors).where(eq(opportunityDeliveryAnchors.opportunityId, ids.crm));
  await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, ids.crm));
  await db
    .update(crmDeals)
    .set({ followUpStage: 0, status: 'Orcamento Enviado', lostReason: null, updatedAt: now })
    .where(eq(crmDeals.id, ids.crm));
}

test.before(async () => {
  if (!databaseUrl) return;
  client = postgres(databaseUrl, { max: 3, prepare: false, onnotice: () => {} });
  db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle'),
  });
  await db.insert(clients).values({ id: ids.client, nome: 'Follow-up test' });
  await db.insert(quotations).values({
    id: ids.quotation,
    businessNumber,
    clientId: ids.client,
    status: 'emitido',
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const fixture = await ensureFixtureTemplateVersion(db as never);
  await db.insert(quoteRevisions).values({
    ...fixture,
    id: ids.revision,
    quotationId: ids.quotation,
    version: 1,
    status: 'emitido',
    issuedAt: now,
    validadeDias: 30,
    entrega: '',
    fretePadrao: '0.00',
    frete: '0.00',
    clienteNome: 'Follow-up test',
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    subtotal: '100.00',
    total: '100.00',
    createdAt: now,
  });
  await db.insert(crmDeals).values({
    id: ids.crm,
    quotationId: ids.quotation,
    clientId: ids.client,
    nome: 'Follow-up test',
    status: 'Orcamento Enviado',
    createdAt: now,
    updatedAt: now,
  });
  await db
    .update(quotations)
    .set({ opportunityId: ids.crm })
    .where(eq(quotations.id, ids.quotation));
  await db.insert(quotationDeliveries).values(
    deliveryValues({
      id: ids.resendDelivery,
      phone: '5511888888888',
      flowId: `flow-${ids.resendDelivery}`,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    }) as never,
  );
  await db.insert(quotationDeliveries).values(deliveryValues() as never);
  await db.insert(quotationDeliverySteps).values({
    id: ids.step,
    deliveryId: ids.delivery,
    position: 0,
    type: 'text',
    payloadSnapshot: { text: 'x' },
    state: 'delivered',
    providerMessageId: `provider-${ids.step}`,
    acceptedAt: new Date('2026-08-02T00:00:00.000Z'),
    deliveredAt: new Date('2026-08-02T00:01:00.000Z'),
    readAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(quotationDeliverySteps).values({
    id: ids.secondStep,
    deliveryId: ids.delivery,
    position: 1,
    type: 'text',
    payloadSnapshot: { text: 'y' },
    state: 'delivered',
    providerMessageId: `provider-${ids.secondStep}`,
    acceptedAt: new Date('2026-08-02T23:00:00.000Z'),
    deliveredAt: new Date('2026-08-02T23:01:00.000Z'),
    readAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(whatsappContactActivity).values({
    id: ids.activity,
    instance,
    providerConversationId: `${ids.activity}@s.whatsapp.net`,
    canonicalPhone: '5511999999999',
    identityStatus: 'verified',
    lastInboundAt: null,
    lastOutboundAt: null,
    createdAt: now,
    updatedAt: now,
  });
  process.env.EVOLUTION_INSTANCE = instance;
  await materializeQuotationFollowUpQueue(db, {
    trackingStartedAt: tracking,
    instance,
    now: new Date('2026-08-02T12:00:00.000Z'),
  });
  process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT = tracking.toISOString();
});

test.after(async () => {
  if (!databaseUrl || !db || !client) return;
  await db.delete(manualContactEvents).where(eq(manualContactEvents.opportunityId, ids.crm));
  await db.delete(quotationFollowUpAttemptHistory).where(eq(quotationFollowUpAttemptHistory.quotationId, ids.quotation));
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  await db
    .delete(opportunityDeliveryAnchors)
    .where(eq(opportunityDeliveryAnchors.opportunityId, ids.crm));
  await db
    .delete(opportunityNextActions)
    .where(eq(opportunityNextActions.opportunityId, ids.crm));
  await db.delete(whatsappContactActivity).where(eq(whatsappContactActivity.instance, instance));
  await db.delete(quotationDeliverySteps).where(eq(quotationDeliverySteps.deliveryId, ids.delivery));
  await db.delete(quotationDeliverySteps).where(eq(quotationDeliverySteps.deliveryId, ids.resendDelivery));
  await db.delete(quotationDeliveries).where(eq(quotationDeliveries.id, ids.delivery));
  await db.delete(quotationDeliveries).where(eq(quotationDeliveries.id, ids.resendDelivery));
  // An accepted dispatch now creates or advances the deal behind the quotation,
  // so the fixture clears every deal that points at it before the client goes.
  await db.delete(crmDeals).where(eq(crmDeals.quotationId, ids.quotation));
  await db.delete(crmDeals).where(eq(crmDeals.clientId, ids.client));
  await db.delete(crmDeals).where(eq(crmDeals.id, ids.crm));
  await db.delete(quoteRevisions).where(eq(quoteRevisions.id, ids.revision));
  await db.delete(quotations).where(eq(quotations.id, ids.quotation));
  await db.delete(clients).where(eq(clients.id, ids.client));
  await client.end({ timeout: 5 });
});

databaseTest('lists waiting then ready, rejects stale approve, claims and reaps leases', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const waiting = await repository.list({ now: new Date('2026-08-02T12:00:00.000Z') });
  const waitingRow = waiting.data.find((row) => row.quotationId === ids.quotation);
  assert.ok(waitingRow);
  assert.equal(waitingRow.state, 'waiting');
  assert.equal(waitingRow.dueAt?.toISOString(), '2026-08-03T23:01:00.000Z');
  const beforeCompletionDue = await repository.list({ now: new Date('2026-08-03T00:01:00.000Z') });
  const stillWaiting = beforeCompletionDue.data.find((row) => row.quotationId === ids.quotation);
  assert.ok(stillWaiting);
  assert.equal(stillWaiting.state, 'waiting');
  assert.equal(stillWaiting.dueAt?.toISOString(), '2026-08-03T23:01:00.000Z');
  const ready = await repository.list({ now });
  const readyRow = ready.data.find((row) => row.quotationId === ids.quotation);
  assert.ok(readyRow);
  assert.equal(readyRow.state, 'ready');
  assert.equal(readyRow.amount, '100.00');

  await assert.rejects(
    repository.approve({ quotationId: ids.quotation, eligibilityVersion: '0'.repeat(64), message: 'Olá', now }),
    { statusCode: 409 },
  );
  const approved = await repository.approve({
    quotationId: ids.quotation,
    eligibilityVersion: readyRow.eligibilityVersion,
    message: 'Olá',
    now,
  });
  assert.equal(approved.state, 'approved');
  assert.equal(approved.approvedOpportunityId, ids.crm);
  assert.equal(approved.canonicalPhone, '5511999999999');
  assert.equal(approved.providerConversationId, '5511999999999@s.whatsapp.net');
  assert.equal(approved.messageSnapshot, 'Olá');
  assert.equal(approved.eligibilityVersion, readyRow.eligibilityVersion);
  await assert.rejects(
    repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: readyRow.eligibilityVersion,
      message: 'Olá',
      now,
    }),
    { statusCode: 409 },
  );

  const claimed = await repository.claimApproved(approved.followUpId!);
  assert.ok(claimed);
  assert.equal(claimed.followUp.state, 'processing');
  await db
    .update(quotationFollowUps)
    .set({ leaseUntil: new Date('2026-08-01T00:00:00.000Z') })
    .where(eq(quotationFollowUps.id, claimed.followUp.followUpId!));
  assert.equal(await repository.reapExpiredLeases(), 1);

  const reclaimed = await repository.claimApproved(approved.followUpId!);
  assert.ok(reclaimed);
  await repository.markTransportStarted(reclaimed.followUp.followUpId!, reclaimed.leaseToken);
  await db
    .update(quotationFollowUps)
    .set({ leaseUntil: new Date('2026-08-01T00:00:00.000Z') })
    .where(eq(quotationFollowUps.id, reclaimed.followUp.followUpId!));
  assert.equal(await repository.reapExpiredLeases(), 1);
});

databaseTest('client and opportunity changes invalidate approval before claim', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const changedOpportunityId = randomUUID();
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  const ready = await projectReady(repository, {
    ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
    phone: '5511999999999',
  });
  const approved = await repository.approve({
    quotationId: ids.quotation,
    eligibilityVersion: ready.eligibilityVersion!,
    message: 'Olá, cliente',
    now,
  });

  await db.update(clients).set({ nome: 'Cliente alterado' }).where(eq(clients.id, ids.client));
  try {
    assert.equal(await repository.claimApproved(approved.followUpId!), null);
    let persisted = await db
      .select({
        state: quotationFollowUps.state,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(persisted[0], {
      state: 'ready',
      approvedOpportunityId: null,
      eligibilityVersion: null,
      messageSnapshot: null,
    });

    const readyAgain = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const approvedAgain = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: readyAgain.eligibilityVersion!,
      message: 'Olá, cliente',
      now,
    });
    await db.insert(crmDeals).values({
      id: changedOpportunityId,
      clientId: ids.client,
      nome: 'Outra demanda do mesmo cliente',
      status: 'Orcamento Enviado',
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(quotations)
      .set({ opportunityId: changedOpportunityId })
      .where(eq(quotations.id, ids.quotation));
    assert.equal(await repository.claimApproved(approvedAgain.followUpId!), null);
    persisted = await db
      .select({
        state: quotationFollowUps.state,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(persisted[0], {
      state: 'ready',
      approvedOpportunityId: null,
      eligibilityVersion: null,
    });
  } finally {
    await db.update(clients).set({ nome: 'Follow-up test' }).where(eq(clients.id, ids.client));
    await db.update(quotations).set({ opportunityId: ids.crm }).where(eq(quotations.id, ids.quotation));
    await db.delete(crmDeals).where(eq(crmDeals.id, changedOpportunityId));
  }
});

databaseTest('fact change after claim prevents transport start', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  const ready = await projectReady(repository, {
    ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
    phone: '5511999999999',
  });
  const approved = await repository.approve({
    quotationId: ids.quotation,
    eligibilityVersion: ready.eligibilityVersion!,
    message: 'Olá',
    now,
  });
  const claimed = await repository.claimApproved(approved.followUpId!);
  assert.ok(claimed);

  await db.update(clients).set({ nome: 'Cliente mudou após claim' }).where(eq(clients.id, ids.client));
  try {
    assert.equal(
      await repository.markTransportStarted(claimed.followUp.followUpId!, claimed.leaseToken),
      false,
    );
    const persisted = await db
      .select({ state: quotationFollowUps.state, transportStartedAt: quotationFollowUps.transportStartedAt })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.equal(persisted[0]?.state, 'ready');
    assert.equal(persisted[0]?.transportStartedAt, null);
  } finally {
    await db.update(clients).set({ nome: 'Follow-up test' }).where(eq(clients.id, ids.client));
  }
});

databaseTest('stale approved row is skipped and a later eligible row is claimed in one call', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  const later = await createExtraEligibleFixture();
  try {
    const firstReady = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const laterReady = await projectReady(repository, later);
    const firstApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: firstReady.eligibilityVersion!,
      message: 'Primeiro',
      now: new Date('2026-08-30T12:00:00.000Z'),
    });
    const laterApproved = await repository.approve({
      quotationId: later.ids.quotation,
      eligibilityVersion: laterReady.eligibilityVersion!,
      message: 'Segundo',
      now,
    });
    await db.update(clients).set({ nome: 'Primeiro alterado' }).where(eq(clients.id, ids.client));
    const claimed = await repository.claimApproved();
    assert.ok(claimed);
    assert.equal(claimed.followUp.followUpId, laterApproved.followUpId);
    assert.notEqual(claimed.followUp.followUpId, firstApproved.followUpId);
    const stale = await db
      .select({ state: quotationFollowUps.state, eligibilityVersion: quotationFollowUps.eligibilityVersion })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(stale[0], { state: 'ready', eligibilityVersion: null });
  } finally {
    await db.update(clients).set({ nome: 'Follow-up test' }).where(eq(clients.id, ids.client));
    await later.cleanup();
  }
});

databaseTest('concurrent claims yield one live authorization', async () => {
  const repositoryA = createPostgresQuotationFollowUpRepository(() => db);
  const repositoryB = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  const ready = await projectReady(repositoryA, {
    ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
    phone: '5511999999999',
  });
  const approved = await repositoryA.approve({
    quotationId: ids.quotation,
    eligibilityVersion: ready.eligibilityVersion!,
    message: 'Uma vez',
    now,
  });

  const [claimA, claimB] = await Promise.all([
    repositoryA.claimApproved(approved.followUpId!),
    repositoryB.claimApproved(approved.followUpId!),
  ]);
  assert.equal(Number(Boolean(claimA)) + Number(Boolean(claimB)), 1);
});

databaseTest('confirmed first return advances the cycle and queues exactly one second return', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUpAttemptHistory).where(eq(quotationFollowUpAttemptHistory.quotationId, ids.quotation));
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  await db.delete(opportunityDeliveryAnchors).where(eq(opportunityDeliveryAnchors.opportunityId, ids.crm));
  await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, ids.crm));
  await db.update(crmDeals).set({ followUpStage: 0 }).where(eq(crmDeals.id, ids.crm));
  try {
    const ready = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const approved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Primeiro retorno',
      now,
    });
    const claimed = await repository.claimApproved(approved.followUpId!);
    assert.ok(claimed);
    assert.equal(
      await repository.markTransportStarted(claimed.followUp.followUpId!, claimed.leaseToken),
      true,
    );

    await repository.completeSent({
      id: claimed.followUp.followUpId!,
      leaseToken: claimed.leaseToken,
      providerMessageId: `provider-first-return-${randomUUID()}`,
      now,
    });

    const [deal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(deal?.followUpStage, 1);
    const followUps = await db
      .select({
        state: quotationFollowUps.state,
        cycleNumber: quotationFollowUps.cycleNumber,
        attemptNumber: quotationFollowUps.attemptNumber,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(followUps, [{ state: 'waiting', cycleNumber: 1, attemptNumber: 2, approvedOpportunityId: null }]);
    const archived = await db
      .select({ state: quotationFollowUpAttemptHistory.state, attemptNumber: quotationFollowUpAttemptHistory.attemptNumber })
      .from(quotationFollowUpAttemptHistory)
      .where(eq(quotationFollowUpAttemptHistory.quotationId, ids.quotation));
    assert.deepEqual(archived, [{ state: 'sent', attemptNumber: 1 }]);
    const actions = await db
      .select({ reasonCode: opportunityNextActions.reasonCode, state: opportunityNextActions.state })
      .from(opportunityNextActions)
      .where(eq(opportunityNextActions.opportunityId, ids.crm));
    assert.equal(actions.filter((row) => row.state === 'active').length, 1);
    assert.equal(actions.find((row) => row.state === 'active')?.reasonCode, 'follow_up_second_return');

    const secondReady = await repository.get(ids.quotation, {
      now: new Date('2026-09-03T03:00:00.000Z'),
    });
    assert.equal(secondReady?.attemptNumber, 2);
    assert.equal(secondReady?.dueAt?.toISOString(), '2026-09-03T03:00:00.000Z');
    assert.equal(
      await repository.promoteDueWaitingToReady!(new Date('2026-09-03T03:00:00.000Z')),
      1,
    );
    const [promoted] = await db
      .select({ state: quotationFollowUps.state, dueAt: quotationFollowUps.dueAt })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.equal(promoted?.state, 'ready');
    assert.equal(promoted?.dueAt?.toISOString(), '2026-09-03T03:00:00.000Z');
    assert.equal(secondReady?.state, 'ready');
    const listed = await repository.list({ view: 'ready', now: new Date('2026-09-03T03:00:00.000Z') });
    assert.deepEqual(listed.data.map((row) => ({ quotationId: row.quotationId, attemptNumber: row.attemptNumber })), [
      { quotationId: ids.quotation, attemptNumber: 2 },
    ]);
    const dismissed = await repository.dismiss({
      quotationId: ids.quotation,
      eligibilityVersion: secondReady!.eligibilityVersion!,
      reason: 'already_handled',
      now: new Date('2026-09-03T03:00:00.000Z'),
    });
    assert.equal(dismissed.attemptNumber, 2);
    assert.equal(dismissed.state, 'dismissed');
  } finally {
    await db.delete(quotationFollowUpAttemptHistory).where(eq(quotationFollowUpAttemptHistory.quotationId, ids.quotation));
    await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
    await db.delete(opportunityDeliveryAnchors).where(eq(opportunityDeliveryAnchors.opportunityId, ids.crm));
    await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, ids.crm));
    await db.update(crmDeals).set({ followUpStage: 0 }).where(eq(crmDeals.id, ids.crm));
  }
});

databaseTest('manual silence follows the same two-attempt transition and is idempotent', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const actionRepository = createPostgresOpportunityActionRepository(() => db);
  await resetSharedFollowUpGraph();
  try {
    const ready = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const [firstAction] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(
        and(
          eq(opportunityNextActions.opportunityId, ids.crm),
          eq(opportunityNextActions.state, 'active'),
        ),
      );
    assert.ok(firstAction);

    const firstInput = {
      commandId: randomUUID(),
      opportunityId: ids.crm,
      actionId: firstAction.id,
      expectedVersion: firstAction.version,
      contactType: 'phone_call' as const,
      occurredAt: now,
      note: 'Sem resposta na ligação.',
      resultCode: 'no_response' as const,
      countsAsFollowUp: true,
      actor: 'operator',
      continuation: {
        type: 'wait' as const,
        schedule: {
          kind: 'customer_contact' as const,
          dueDate: '2026-09-20',
          dueTime: null,
          reason: 'Agenda enviada pelo operador deve ser ignorada para silêncio',
        },
      },
      now,
    };
    const first = await actionRepository.recordManualContact(firstInput);
    const firstReplay = await actionRepository.recordManualContact(firstInput);
    assert.deepEqual(firstReplay, first);

    const [afterFirstDeal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(afterFirstDeal?.followUpStage, 1);
    const [afterFirstFollowUp] = await db
      .select({ state: quotationFollowUps.state, attemptNumber: quotationFollowUps.attemptNumber })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(afterFirstFollowUp, { state: 'waiting', attemptNumber: 2 });

    const [secondAction] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version, reasonCode: opportunityNextActions.reasonCode })
      .from(opportunityNextActions)
      .where(
        and(
          eq(opportunityNextActions.opportunityId, ids.crm),
          eq(opportunityNextActions.state, 'active'),
        ),
      );
    assert.equal(secondAction?.reasonCode, 'follow_up_second_return');
    const secondInput = {
      ...firstInput,
      commandId: randomUUID(),
      actionId: secondAction!.id,
      expectedVersion: secondAction!.version,
      note: 'Segundo silêncio.',
      now: new Date('2026-09-03T12:00:00.000Z'),
    };
    const second = await actionRepository.recordManualContact(secondInput);
    const secondReplay = await actionRepository.recordManualContact(secondInput);
    assert.deepEqual(secondReplay, second);

    const [afterSecondDeal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(afterSecondDeal?.followUpStage, 2);
    const [afterSecondFollowUp] = await db
      .select({ state: quotationFollowUps.state, attemptNumber: quotationFollowUps.attemptNumber })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(afterSecondFollowUp, { state: 'sent', attemptNumber: 2 });
    const archived = await db
      .select({ attemptNumber: quotationFollowUpAttemptHistory.attemptNumber, state: quotationFollowUpAttemptHistory.state })
      .from(quotationFollowUpAttemptHistory)
      .where(eq(quotationFollowUpAttemptHistory.quotationId, ids.quotation));
    assert.deepEqual(archived, [
      { attemptNumber: 1, state: 'manual' },
      { attemptNumber: 2, state: 'manual' },
    ]);
    const [decision] = await db
      .select({ reasonCode: opportunityNextActions.reasonCode })
      .from(opportunityNextActions)
      .where(
        and(
          eq(opportunityNextActions.opportunityId, ids.crm),
          eq(opportunityNextActions.state, 'active'),
        ),
      );
    assert.equal(decision?.reasonCode, 'follow_up_decide_continuity');
  } finally {
    await resetSharedFollowUpGraph();
  }
});

databaseTest('legacy manual silence follows the fixed cycle without a technical row', async () => {
  const actionRepository = createPostgresOpportunityActionRepository(() => db);
  await resetSharedFollowUpGraph();
  try {
    await projectReady(createPostgresQuotationFollowUpRepository(() => db), {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));

    const [firstAction] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(
        and(
          eq(opportunityNextActions.opportunityId, ids.crm),
          eq(opportunityNextActions.state, 'active'),
        ),
      );
    assert.ok(firstAction);
    const first = await actionRepository.recordManualContact({
      commandId: randomUUID(),
      opportunityId: ids.crm,
      actionId: firstAction.id,
      expectedVersion: firstAction.version,
      contactType: 'phone_call',
      occurredAt: now,
      note: 'Registro legado sem linha técnica.',
      resultCode: 'no_response',
      countsAsFollowUp: true,
      actor: 'operator',
      continuation: {
        type: 'wait',
        schedule: {
          kind: 'customer_contact',
          dueDate: '2026-12-31',
          dueTime: null,
          reason: 'Agenda arbitrária não vale para silêncio',
        },
      },
      now,
    });
    assert.equal(first.successor?.reasonCode, 'follow_up_second_return');
    assert.equal(first.successor?.dueDate, '2026-09-03');
    assert.equal(first.successor?.dueAt, '2026-09-03T03:00:00.000Z');

    const [afterFirstDeal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(afterFirstDeal?.followUpStage, 1);
    assert.equal(
      (await db
        .select({ id: quotationFollowUps.id })
        .from(quotationFollowUps)
        .where(eq(quotationFollowUps.quotationId, ids.quotation))).length,
      0,
    );
    assert.equal(
      (await db
        .select({ id: quotationFollowUpAttemptHistory.id })
        .from(quotationFollowUpAttemptHistory)
        .where(eq(quotationFollowUpAttemptHistory.quotationId, ids.quotation))).length,
      0,
    );

    const secondNow = new Date('2026-09-03T12:00:00.000Z');
    const second = await actionRepository.recordManualContact({
      commandId: randomUUID(),
      opportunityId: ids.crm,
      actionId: first.successor!.actionId,
      expectedVersion: first.successor!.version,
      contactType: 'phone_call',
      occurredAt: secondNow,
      note: 'Segundo registro legado.',
      resultCode: 'no_response',
      countsAsFollowUp: true,
      actor: 'operator',
      continuation: {
        type: 'wait',
        schedule: {
          kind: 'customer_contact',
          dueDate: '2026-12-31',
          dueTime: null,
          reason: 'Outra agenda arbitrária não vale para silêncio',
        },
      },
      now: secondNow,
    });
    assert.equal(second.successor?.reasonCode, 'follow_up_decide_continuity');
    assert.equal(second.successor?.dueDate, '2026-09-08');
    assert.equal(second.successor?.dueAt, '2026-09-08T03:00:00.000Z');

    const [afterSecondDeal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(afterSecondDeal?.followUpStage, 2);
    const continuityInput = {
      commandId: randomUUID(),
      opportunityId: ids.crm,
      actionId: second.successor!.actionId,
      expectedVersion: second.successor!.version,
      type: 'new_cycle' as const,
      schedule: {
        kind: 'customer_contact' as const,
        dueDate: '2026-09-10',
        dueTime: null,
        reason: 'Novo ciclo legado',
      },
      actor: 'operator',
      now: new Date('2026-09-08T12:00:00.000Z'),
    };
    const continued = await actionRepository.continueFollowUp(continuityInput);
    assert.equal(continued.successor?.state, 'active');
    assert.equal(continued.successor?.reasonCode, 'proposal_delivery_confirmed');
    const [materialized] = await db
      .select({
        cycleNumber: quotationFollowUps.cycleNumber,
        attemptNumber: quotationFollowUps.attemptNumber,
        sourceActionId: quotationFollowUps.sourceActionId,
        state: quotationFollowUps.state,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(materialized, {
      cycleNumber: 1,
      attemptNumber: 1,
      sourceActionId: continued.successor?.actionId,
      state: 'waiting',
    });
    const actionRows = await actionRepository.listActive({ filter: 'active', pageSize: 100 });
    assert.equal(
      actionRows.data.find((row) => row.opportunityId === ids.crm)?.actionId,
      continued.successor?.actionId,
    );
    const revisable = await createPostgresQuotationFollowUpRepository(() => db).get(ids.quotation, {
      now: new Date('2026-09-08T12:00:00.000Z'),
      expectedOpportunityId: ids.crm,
      expectedActionId: continued.successor!.actionId,
    });
    assert.equal(revisable?.cycleNumber, 1);
    assert.equal(revisable?.attemptNumber, 1);
    assert.equal(revisable?.state, 'waiting');
    assert.equal(revisable?.sourceActionId, continued.successor?.actionId);
  } finally {
    await resetSharedFollowUpGraph();
  }
});

databaseTest('a counted non-silent contact advances the terminal successor identity without creating attempt three', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const actionRepository = createPostgresOpportunityActionRepository(() => db);
  await resetSharedFollowUpGraph();
  try {
    await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const [firstAction] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(and(eq(opportunityNextActions.opportunityId, ids.crm), eq(opportunityNextActions.state, 'active')));
    assert.ok(firstAction);
    const firstInput = {
      commandId: randomUUID(),
      opportunityId: ids.crm,
      actionId: firstAction.id,
      expectedVersion: firstAction.version,
      contactType: 'phone_call' as const,
      occurredAt: now,
      note: 'Cliente pediu retorno e combinou continuidade.',
      resultCode: 'follow_up_agreed' as const,
      countsAsFollowUp: true,
      actor: 'operator',
      continuation: {
        type: 'successor' as const,
        schedule: {
          kind: 'customer_contact' as const,
          dueDate: '2026-09-02',
          dueTime: null,
          reason: 'Retorno combinado',
        },
      },
      now,
    };
    const first = await actionRepository.recordManualContact(firstInput);
    assert.deepEqual(await actionRepository.recordManualContact(firstInput), first);
    const [afterFirst] = await db
      .select({
        state: quotationFollowUps.state,
        attemptNumber: quotationFollowUps.attemptNumber,
        sourceActionId: quotationFollowUps.sourceActionId,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(afterFirst, {
      state: 'sent',
      attemptNumber: 2,
      sourceActionId: first.successor?.actionId,
    });
    const secondInput = {
      ...firstInput,
      commandId: randomUUID(),
      actionId: first.successor!.actionId,
      expectedVersion: first.successor!.version,
      note: 'Segundo retorno também contado.',
      resultCode: 'interested' as const,
      now: new Date('2026-09-03T12:00:00.000Z'),
    };
    const second = await actionRepository.recordManualContact(secondInput);
    assert.deepEqual(await actionRepository.recordManualContact(secondInput), second);
    const [deal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(deal?.followUpStage, 2);
    const archived = await db
      .select({ cycleNumber: quotationFollowUpAttemptHistory.cycleNumber, attemptNumber: quotationFollowUpAttemptHistory.attemptNumber })
      .from(quotationFollowUpAttemptHistory)
      .where(eq(quotationFollowUpAttemptHistory.opportunityId, ids.crm));
    assert.deepEqual(archived.map((row) => ({ cycleNumber: Number(row.cycleNumber), attemptNumber: Number(row.attemptNumber) })), [
      { cycleNumber: 1, attemptNumber: 1 },
      { cycleNumber: 1, attemptNumber: 2 },
    ]);
    const [terminal] = await db
      .select({ state: quotationFollowUps.state, attemptNumber: quotationFollowUps.attemptNumber })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(terminal, { state: 'sent', attemptNumber: 2 });
  } finally {
    await resetSharedFollowUpGraph();
  }
});

databaseTest('manual silence and worker completion race to confirm one attempt', async () => {
  let manualClient: ReturnType<typeof postgres> | undefined;
  let workerClient: ReturnType<typeof postgres> | undefined;
  try {
    await resetSharedFollowUpGraph();
    const setupRepository = createPostgresQuotationFollowUpRepository(() => db);
    const actionRepository = createPostgresOpportunityActionRepository(() => db);
    const ready = await projectReady(setupRepository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const approved = await setupRepository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Retorno em disputa',
      now,
    });
    const claimed = await setupRepository.claimApproved(approved.followUpId!);
    assert.ok(claimed);

    const [activeAction] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(
        and(
          eq(opportunityNextActions.opportunityId, ids.crm),
          eq(opportunityNextActions.state, 'active'),
        ),
      );
    assert.ok(activeAction);

    manualClient = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
    workerClient = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
    const manualDb = drizzle(manualClient, { schema });
    const workerDb = drizzle(workerClient, { schema });
    const [manualPidResult, workerPidResult] = await Promise.all([
      manualDb.execute(sql`SELECT pg_backend_pid() AS pid`),
      workerDb.execute(sql`SELECT pg_backend_pid() AS pid`),
    ]);
    const manualPid = String(Array.from(manualPidResult)[0]?.pid || '');
    const workerPid = String(Array.from(workerPidResult)[0]?.pid || '');
    assert.ok(manualPid);
    assert.ok(workerPid);
    assert.notEqual(manualPid, workerPid);

    const manualRepository = createPostgresOpportunityActionRepository(() => manualDb as never);
    const workerRepository = createPostgresQuotationFollowUpRepository(() => workerDb as never);
    const [manualOutcome, workerOutcome] = await Promise.allSettled([
      manualRepository.recordManualContact({
        commandId: randomUUID(),
        opportunityId: ids.crm,
        actionId: activeAction.id,
        expectedVersion: activeAction.version,
        contactType: 'phone_call',
        occurredAt: now,
        note: 'Silêncio confirmado manualmente.',
        resultCode: 'no_response',
        countsAsFollowUp: true,
        actor: 'operator',
        continuation: {
          type: 'wait',
          schedule: {
            kind: 'customer_contact',
            dueDate: '2026-12-31',
            dueTime: null,
            reason: 'A corrida não deve aceitar agenda arbitrária',
          },
        },
        now,
      }),
      workerRepository.completeSent({
        id: claimed.followUp.followUpId!,
        leaseToken: claimed.leaseToken,
        providerMessageId: `provider-race-${randomUUID()}`,
        now,
      }),
    ]);

    const manualWon = manualOutcome.status === 'fulfilled';
    const workerWon = workerOutcome.status === 'fulfilled' && workerOutcome.value !== null;
    assert.equal(Number(manualWon) + Number(workerWon), 1);
    if (manualWon) {
      assert.equal(workerOutcome.status, 'fulfilled');
      assert.equal(workerOutcome.value, null);
    } else {
      assert.equal(manualOutcome.status, 'rejected');
      assert.equal((manualOutcome.reason as { statusCode?: number }).statusCode, 409);
    }

    const history = await db
      .select({ cycleNumber: quotationFollowUpAttemptHistory.cycleNumber, attemptNumber: quotationFollowUpAttemptHistory.attemptNumber })
      .from(quotationFollowUpAttemptHistory)
      .where(
        and(
          eq(quotationFollowUpAttemptHistory.opportunityId, ids.crm),
          eq(quotationFollowUpAttemptHistory.cycleNumber, 1),
          eq(quotationFollowUpAttemptHistory.attemptNumber, 1),
        ),
      );
    assert.deepEqual(history, [{ cycleNumber: 1, attemptNumber: 1 }]);

    const [deal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(deal?.followUpStage, 1);
    const [currentFollowUp] = await db
      .select({ attemptNumber: quotationFollowUps.attemptNumber, state: quotationFollowUps.state })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(currentFollowUp, { attemptNumber: 2, state: 'waiting' });
    assert.equal(
      (await db
        .select({ id: opportunityNextActions.id })
        .from(opportunityNextActions)
        .where(
          and(
            eq(opportunityNextActions.opportunityId, ids.crm),
            eq(opportunityNextActions.state, 'active'),
          ),
        )).length,
      1,
    );
    assert.equal(
      (await db
        .select({ attemptNumber: quotationFollowUpAttemptHistory.attemptNumber })
        .from(quotationFollowUpAttemptHistory)
        .where(eq(quotationFollowUpAttemptHistory.opportunityId, ids.crm)))
        .filter((row) => Number(row.attemptNumber) === 3).length,
      0,
    );
  } finally {
    await Promise.allSettled([
      manualClient?.end({ timeout: 5 }) || Promise.resolve(),
      workerClient?.end({ timeout: 5 }) || Promise.resolve(),
    ]);
    await resetSharedFollowUpGraph();
  }
});

databaseTest('confirmed second return opens the final window and then requires continuity', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const actionRepository = createPostgresOpportunityActionRepository(() => db);
  await resetSharedFollowUpGraph();
  try {
    const ready = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const firstApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Primeiro retorno',
      now,
    });
    const firstClaim = await repository.claimApproved(firstApproved.followUpId!);
    assert.ok(firstClaim);
    assert.equal(
      await repository.markTransportStarted(firstClaim.followUp.followUpId!, firstClaim.leaseToken),
      true,
    );
    const firstProviderMessageId = `provider-first-${randomUUID()}`;
    await repository.completeSent({
      id: firstClaim.followUp.followUpId!,
      leaseToken: firstClaim.leaseToken,
      providerMessageId: firstProviderMessageId,
      now,
    });
    const firstReplay = await repository.completeSent({
      id: firstClaim.followUp.followUpId!,
      leaseToken: firstClaim.leaseToken,
      providerMessageId: firstProviderMessageId,
      now,
    });
    assert.equal(firstReplay?.state, 'sent');

    const secondDue = new Date('2026-09-03T03:00:00.000Z');
    const secondReady = await repository.get(ids.quotation, { now: secondDue });
    assert.ok(secondReady);
    assert.equal(secondReady.state, 'ready');
    assert.equal(secondReady.attemptNumber, 2);
    const [secondAction] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(
        and(
          eq(opportunityNextActions.opportunityId, ids.crm),
          eq(opportunityNextActions.state, 'active'),
          eq(opportunityNextActions.reasonCode, 'follow_up_second_return'),
        ),
      );
    assert.ok(secondAction);
    const genericReplacement = await actionRepository.rescheduleAction({
      actionId: secondAction.id,
      expectedVersion: secondAction.version,
      kind: 'internal',
      dueDate: '2026-09-04',
      dueTime: null,
      reason: 'Atividade genérica não deve liberar terceiro retorno',
      actor: 'operator',
      now: secondDue,
    });
    assert.equal(genericReplacement.successor?.reason, 'Atividade genérica não deve liberar terceiro retorno');
    const secondReadyAfterGeneric = await repository.get(ids.quotation, { now: secondDue });
    assert.ok(secondReadyAfterGeneric);
    assert.equal(secondReadyAfterGeneric.state, 'ready');
    const secondApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: secondReadyAfterGeneric.eligibilityVersion!,
      message: 'Segundo retorno',
      now: secondDue,
    });
    const secondClaim = await repository.claimApproved(secondApproved.followUpId!);
    assert.ok(secondClaim);
    assert.equal(
      await repository.markTransportStarted(secondClaim.followUp.followUpId!, secondClaim.leaseToken),
      true,
    );
    const secondProviderMessageId = `provider-second-${randomUUID()}`;
    await repository.completeSent({
      id: secondClaim.followUp.followUpId!,
      leaseToken: secondClaim.leaseToken,
      providerMessageId: secondProviderMessageId,
      now: new Date('2026-09-03T12:00:00.000Z'),
    });
    const secondReplay = await repository.completeSent({
      id: secondClaim.followUp.followUpId!,
      leaseToken: secondClaim.leaseToken,
      providerMessageId: secondProviderMessageId,
      now: new Date('2026-09-03T12:00:00.000Z'),
    });
    assert.equal(secondReplay?.state, 'sent');

    const [deal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(deal?.followUpStage, 2);
    const actions = await db
      .select({
        id: opportunityNextActions.id,
        state: opportunityNextActions.state,
        reasonCode: opportunityNextActions.reasonCode,
        dueDate: opportunityNextActions.dueDate,
        version: opportunityNextActions.version,
      })
      .from(opportunityNextActions)
      .where(eq(opportunityNextActions.opportunityId, ids.crm));
    const activeDecision = actions.find(
      (action) => action.state === 'active' && action.reasonCode === 'follow_up_decide_continuity',
    );
    assert.ok(activeDecision);
    assert.equal(activeDecision.dueDate, '2026-09-08');
    assert.equal(actions.filter((action) => action.state === 'active').length, 1);

    const followUps = await db
      .select({
        state: quotationFollowUps.state,
        cycleNumber: quotationFollowUps.cycleNumber,
        attemptNumber: quotationFollowUps.attemptNumber,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(
      followUps.map((row) => ({ ...row, cycleNumber: Number(row.cycleNumber), attemptNumber: Number(row.attemptNumber) })),
      [{ state: 'sent', cycleNumber: 1, attemptNumber: 2 }],
    );
    const archived = await db
      .select({ cycleNumber: quotationFollowUpAttemptHistory.cycleNumber, attemptNumber: quotationFollowUpAttemptHistory.attemptNumber })
      .from(quotationFollowUpAttemptHistory)
      .where(eq(quotationFollowUpAttemptHistory.quotationId, ids.quotation));
    assert.deepEqual(
      archived.map((row) => ({ cycleNumber: Number(row.cycleNumber), attemptNumber: Number(row.attemptNumber) })),
      [
        { cycleNumber: 1, attemptNumber: 1 },
        { cycleNumber: 1, attemptNumber: 2 },
      ],
    );
    assert.equal((await repository.list({ view: 'ready', now: new Date('2026-09-08T12:00:00.000Z') })).total, 0);
    assert.equal((await repository.list({ view: 'waiting', now: new Date('2026-09-08T12:00:00.000Z') })).total, 0);

    await assert.rejects(
      actionRepository.rescheduleAction({
        actionId: activeDecision.id,
        expectedVersion: activeDecision.version,
        kind: 'customer_contact',
        dueDate: '2026-09-10',
        dueTime: null,
        reason: 'Tentativa genérica',
        actor: 'operator',
        now,
      }),
      { statusCode: 409 },
    );
    await assert.rejects(
      actionRepository.completeAction({
        actionId: activeDecision.id,
        expectedVersion: activeDecision.version,
        actor: 'operator',
        close: { reason: 'Fechar sem decisão específica' },
        now,
      }),
      { statusCode: 409 },
    );

    const continuityInput = {
      commandId: randomUUID(),
      opportunityId: ids.crm,
      actionId: activeDecision.id,
      expectedVersion: activeDecision.version,
      type: 'manual_date' as const,
      schedule: {
        kind: 'customer_contact' as const,
        dueDate: '2026-09-10',
        dueTime: null,
        reason: 'Retomar na data confirmada',
      },
      actor: 'operator',
      now,
    };
    const continued = await actionRepository.continueFollowUp(continuityInput);
    assert.equal(continued.successor?.state, 'active');
    assert.equal(continued.successor?.dueDate, '2026-09-10');
    const replayed = await actionRepository.continueFollowUp(continuityInput);
    assert.equal(replayed.successor?.actionId, continued.successor?.actionId);
    assert.equal(replayed.actionId, continued.actionId);
    const [afterContinuity] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(afterContinuity?.followUpStage, 2);
    const continuityRows = await db
      .select({ continuityCommandId: opportunityNextActions.continuityCommandId })
      .from(opportunityNextActions)
      .where(eq(opportunityNextActions.continuityCommandId, continuityInput.commandId));
    assert.equal(continuityRows.length, 1);
  } finally {
    await resetSharedFollowUpGraph();
  }
});

databaseTest('new-cycle continuity resets the stage and opens the review pipeline', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const actionRepository = createPostgresOpportunityActionRepository(() => db);
  await resetSharedFollowUpGraph();
  try {
    const ready = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const firstApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Primeiro retorno',
      now,
    });
    const firstClaim = await repository.claimApproved(firstApproved.followUpId!);
    assert.ok(firstClaim);
    await repository.markTransportStarted(firstClaim.followUp.followUpId!, firstClaim.leaseToken);
    await repository.completeSent({
      id: firstClaim.followUp.followUpId!,
      leaseToken: firstClaim.leaseToken,
      providerMessageId: `provider-cycle-one-first-${randomUUID()}`,
      now,
    });

    const secondDue = new Date('2026-09-03T03:00:00.000Z');
    const secondReady = await repository.get(ids.quotation, { now: secondDue });
    assert.ok(secondReady);
    const secondApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: secondReady.eligibilityVersion!,
      message: 'Segundo retorno',
      now: secondDue,
    });
    const secondClaim = await repository.claimApproved(secondApproved.followUpId!);
    assert.ok(secondClaim);
    await repository.markTransportStarted(secondClaim.followUp.followUpId!, secondClaim.leaseToken);
    await repository.completeSent({
      id: secondClaim.followUp.followUpId!,
      leaseToken: secondClaim.leaseToken,
      providerMessageId: `provider-cycle-one-second-${randomUUID()}`,
      now: new Date('2026-09-03T12:00:00.000Z'),
    });

    const [decision] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(
        and(
          eq(opportunityNextActions.opportunityId, ids.crm),
          eq(opportunityNextActions.state, 'active'),
          eq(opportunityNextActions.reasonCode, 'follow_up_decide_continuity'),
        ),
      );
    assert.ok(decision);
    const continuityInput = {
      commandId: randomUUID(),
      opportunityId: ids.crm,
      actionId: decision.id,
      expectedVersion: decision.version,
      type: 'new_cycle' as const,
      schedule: {
        kind: 'customer_contact' as const,
        dueDate: '2026-09-10',
        dueTime: null,
        reason: 'Novo ciclo autorizado',
      },
      actor: 'operator',
      now: new Date('2026-09-08T12:00:00.000Z'),
    };
    const continued = await actionRepository.continueFollowUp(continuityInput);
    assert.equal(continued.successor?.state, 'active');
    assert.equal(continued.successor?.dueDate, '2026-09-10');
    const [deal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(deal?.followUpStage, 0);

    const [current] = await db
      .select({
        cycleNumber: quotationFollowUps.cycleNumber,
        attemptNumber: quotationFollowUps.attemptNumber,
        state: quotationFollowUps.state,
        sourceActionId: quotationFollowUps.sourceActionId,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, ids.quotation));
    assert.deepEqual(
      {
        cycleNumber: Number(current?.cycleNumber),
        attemptNumber: Number(current?.attemptNumber),
        state: current?.state,
        sourceActionId: current?.sourceActionId,
      },
      {
        cycleNumber: 2,
        attemptNumber: 1,
        state: 'waiting',
        sourceActionId: continued.successor?.actionId,
      },
    );
    const activeReview = await actionRepository.listActive({ filter: 'active', pageSize: 100 });
    const reviewAction = activeReview.data.find((row) => row.opportunityId === ids.crm);
    assert.equal(reviewAction?.actionId, continued.successor?.actionId);
    assert.equal(reviewAction?.reasonCode, 'proposal_delivery_confirmed');
    const review = await repository.get(ids.quotation, {
      now: new Date('2026-09-08T12:00:00.000Z'),
      expectedOpportunityId: ids.crm,
      expectedActionId: continued.successor!.actionId,
    });
    assert.equal(review?.cycleNumber, 2);
    assert.equal(review?.attemptNumber, 1);
    assert.equal(review?.state, 'waiting');
    const replayed = await actionRepository.continueFollowUp(continuityInput);
    assert.equal(replayed.successor?.actionId, continued.successor?.actionId);
  } finally {
    await resetSharedFollowUpGraph();
  }
});

databaseTest('alternative quotations inherit the opportunity cycle in both producers and complete the next attempt', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const actionRepository = createPostgresOpportunityActionRepository(() => db);
  const alternativeFromDelivery = await createExtraEligibleFixture({
    opportunityId: ids.crm,
    createOpportunity: false,
  });
  const alternativeFromMaterializer = await createExtraEligibleFixture({
    opportunityId: ids.crm,
    createOpportunity: false,
  });
  await resetSharedFollowUpGraph();
  try {
    const ready = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const firstApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Primeiro retorno do ciclo um',
      now,
    });
    const firstClaim = await repository.claimApproved(firstApproved.followUpId!);
    assert.ok(firstClaim);
    await repository.markTransportStarted(firstClaim.followUp.followUpId!, firstClaim.leaseToken);
    await repository.completeSent({
      id: firstClaim.followUp.followUpId!,
      leaseToken: firstClaim.leaseToken,
      providerMessageId: `provider-cycle-three-first-${randomUUID()}`,
      now,
    });
    const secondReady = await repository.get(ids.quotation, { now: new Date('2026-09-03T03:00:00.000Z') });
    assert.ok(secondReady);
    const secondApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: secondReady.eligibilityVersion!,
      message: 'Segundo retorno do ciclo um',
      now: new Date('2026-09-03T03:00:00.000Z'),
    });
    const secondClaim = await repository.claimApproved(secondApproved.followUpId!);
    assert.ok(secondClaim);
    await repository.markTransportStarted(secondClaim.followUp.followUpId!, secondClaim.leaseToken);
    await repository.completeSent({
      id: secondClaim.followUp.followUpId!,
      leaseToken: secondClaim.leaseToken,
      providerMessageId: `provider-cycle-three-second-${randomUUID()}`,
      now: new Date('2026-09-03T12:00:00.000Z'),
    });
    const [decision] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(and(
        eq(opportunityNextActions.opportunityId, ids.crm),
        eq(opportunityNextActions.state, 'active'),
        eq(opportunityNextActions.reasonCode, 'follow_up_decide_continuity'),
      ));
    assert.ok(decision);
    const continued = await actionRepository.continueFollowUp({
      commandId: randomUUID(),
      opportunityId: ids.crm,
      actionId: decision.id,
      expectedVersion: decision.version,
      type: 'new_cycle',
      schedule: {
        kind: 'customer_contact',
        dueDate: '2026-09-10',
        dueTime: null,
        reason: 'Novo ciclo para alternativas',
      },
      actor: 'operator',
      now: new Date('2026-09-08T12:00:00.000Z'),
    });
    assert.ok(continued.successor);

    await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
      deliveryId: alternativeFromDelivery.ids.delivery,
      revisionId: alternativeFromDelivery.ids.revision,
      phone: alternativeFromDelivery.phone,
      providerMessageId: `provider-accepted-${alternativeFromDelivery.ids.delivery}`,
    });
    const [acceptedAlternative] = await db
      .select({ cycleNumber: quotationFollowUps.cycleNumber, attemptNumber: quotationFollowUps.attemptNumber })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, alternativeFromDelivery.ids.quotation));
    assert.deepEqual(acceptedAlternative, { cycleNumber: 2, attemptNumber: 1 });
    await repository.upsertFromDeliveryReceipt!({
      deliveryId: alternativeFromDelivery.ids.delivery,
      revisionId: alternativeFromDelivery.ids.revision,
      phone: alternativeFromDelivery.phone,
      providerConversationId: `${alternativeFromDelivery.phone}@s.whatsapp.net`,
      allStepsDelivered: true,
      receivedAt: new Date('2026-08-02T00:01:00.000Z'),
    });
    const alternativeReady = await repository.get(alternativeFromDelivery.ids.quotation, { now: new Date('2026-09-10T12:00:00.000Z') });
    assert.equal(alternativeReady?.cycleNumber, 2);
    assert.equal(alternativeReady?.attemptNumber, 1);
    const alternativeApproved = await repository.approve({
      quotationId: alternativeFromDelivery.ids.quotation,
      eligibilityVersion: alternativeReady!.eligibilityVersion!,
      message: 'Alternativa do ciclo dois',
      now: new Date('2026-09-10T12:00:00.000Z'),
    });
    const alternativeClaim = await repository.claimApproved(alternativeApproved.followUpId!);
    assert.ok(alternativeClaim);
    await repository.markTransportStarted(alternativeClaim.followUp.followUpId!, alternativeClaim.leaseToken);
    const completedAlternative = await repository.completeSent({
      id: alternativeClaim.followUp.followUpId!,
      leaseToken: alternativeClaim.leaseToken,
      providerMessageId: `provider-alternative-cycle-two-${randomUUID()}`,
      now: new Date('2026-09-10T12:00:00.000Z'),
    });
    assert.equal(completedAlternative?.state, 'waiting');
    const history = await db
      .select({ cycleNumber: quotationFollowUpAttemptHistory.cycleNumber, attemptNumber: quotationFollowUpAttemptHistory.attemptNumber })
      .from(quotationFollowUpAttemptHistory)
      .where(eq(quotationFollowUpAttemptHistory.opportunityId, ids.crm));
    assert.deepEqual(history.map((row) => ({ cycleNumber: Number(row.cycleNumber), attemptNumber: Number(row.attemptNumber) })), [
      { cycleNumber: 1, attemptNumber: 1 },
      { cycleNumber: 1, attemptNumber: 2 },
      { cycleNumber: 2, attemptNumber: 1 },
    ]);

    const materializedCount = await materializeQuotationFollowUpQueue(db, {
      trackingStartedAt: tracking,
      instance,
      now: new Date('2026-09-10T12:00:00.000Z'),
    });
    assert.equal(materializedCount, 1);
    const [materializedAlternative] = await db
      .select({ cycleNumber: quotationFollowUps.cycleNumber, attemptNumber: quotationFollowUps.attemptNumber })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, alternativeFromMaterializer.ids.quotation));
    assert.deepEqual(materializedAlternative, { cycleNumber: 2, attemptNumber: 2 });
  } finally {
    await alternativeFromDelivery.cleanup();
    await alternativeFromMaterializer.cleanup();
    await resetSharedFollowUpGraph();
  }
});

databaseTest('alternative quotation cannot create a second live authorization but can start after sent', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  const alternative = await createExtraEligibleFixture({
    opportunityId: ids.crm,
    createOpportunity: false,
  });
  try {
    const firstReady = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const alternativeReady = await projectReady(repository, alternative);
    const firstApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: firstReady.eligibilityVersion!,
      message: 'Primeiro retorno',
      now,
    });
    await assert.rejects(
      repository.approve({
        quotationId: alternative.ids.quotation,
        eligibilityVersion: alternativeReady.eligibilityVersion!,
        message: 'Segundo retorno',
        now,
      }),
      { statusCode: 409 },
    );

    const firstClaim = await repository.claimApproved(firstApproved.followUpId!);
    assert.ok(firstClaim);
    assert.equal(
      await repository.markTransportStarted(firstClaim.followUp.followUpId!, firstClaim.leaseToken),
      true,
    );
    await repository.completeSent({
      id: firstClaim.followUp.followUpId!,
      leaseToken: firstClaim.leaseToken,
      providerMessageId: `provider-sent-${randomUUID()}`,
      now,
    });
    const alternativeAfterSent = await repository.get(alternative.ids.quotation, { now });
    assert.equal(alternativeAfterSent?.state, 'ready');
    const allowedAfterSent = await repository.approve({
      quotationId: alternative.ids.quotation,
      eligibilityVersion: alternativeAfterSent!.eligibilityVersion!,
      message: 'Segundo retorno',
      now,
    });
    assert.equal(allowedAfterSent.state, 'approved');
  } finally {
    await alternative.cleanup();
  }
});

databaseTest('instance rotation retires the old authorization before approving and claiming', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const originalInstance = process.env.EVOLUTION_INSTANCE;
  const instanceB = `follow-up-rotated-${randomUUID()}`;
  const alternative = await createExtraEligibleFixture({
    opportunityId: ids.crm,
    createOpportunity: false,
    instanceName: instanceB,
  });
  try {
    await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
    process.env.EVOLUTION_INSTANCE = instance;
    const firstReady = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const firstApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: firstReady.eligibilityVersion!,
      message: 'Retorno A',
      now,
    });

    process.env.EVOLUTION_INSTANCE = instanceB;
    const alternativeReady = await projectReady(repository, alternative);
    const currentApproved = await repository.approve({
      quotationId: alternative.ids.quotation,
      eligibilityVersion: alternativeReady.eligibilityVersion!,
      message: 'Retorno B',
      now,
    });

    const [retired] = await db
      .select({
        state: quotationFollowUps.state,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
        approvedAt: quotationFollowUps.approvedAt,
        leaseToken: quotationFollowUps.leaseToken,
        leaseUntil: quotationFollowUps.leaseUntil,
        transportStartedAt: quotationFollowUps.transportStartedAt,
        closedReason: quotationFollowUps.closedReason,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, firstApproved.followUpId!));
    assert.deepEqual(retired, {
      state: 'cancelled',
      approvedOpportunityId: null,
      eligibilityVersion: null,
      messageSnapshot: null,
      approvedAt: null,
      leaseToken: null,
      leaseUntil: null,
      transportStartedAt: null,
      closedReason: 'instance_changed',
    });

    const claimed = await repository.claimApproved(currentApproved.followUpId!);
    assert.equal(claimed?.followUp.followUpId, currentApproved.followUpId);

    process.env.EVOLUTION_INSTANCE = instance;
    assert.equal(await repository.claimApproved(firstApproved.followUpId!), null);
    const [oldAgain] = await db
      .select({ state: quotationFollowUps.state })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, firstApproved.followUpId!));
    assert.equal(oldAgain?.state, 'cancelled');
  } finally {
    process.env.EVOLUTION_INSTANCE = originalInstance;
    await alternative.cleanup();
    await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  }
});

databaseTest('new cycle rotates the current attempt to a verified conversation in the configured instance', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const actionRepository = createPostgresOpportunityActionRepository(() => db);
  const originalInstance = process.env.EVOLUTION_INSTANCE;
  const instanceB = `follow-up-new-cycle-b-${randomUUID()}`;
  const activityB = randomUUID();
  await resetSharedFollowUpGraph();
  try {
    process.env.EVOLUTION_INSTANCE = instance;
    const ready = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const firstApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Tentativa na instância A',
      now,
    });
    const firstClaim = await repository.claimApproved(firstApproved.followUpId!);
    assert.ok(firstClaim);
    await repository.markTransportStarted(firstClaim.followUp.followUpId!, firstClaim.leaseToken);
    await repository.completeSent({
      id: firstClaim.followUp.followUpId!,
      leaseToken: firstClaim.leaseToken,
      providerMessageId: `provider-rotation-new-cycle-first-${randomUUID()}`,
      now,
    });
    const secondReady = await repository.get(ids.quotation, { now: new Date('2026-09-03T03:00:00.000Z') });
    assert.ok(secondReady);
    const secondApproved = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: secondReady.eligibilityVersion!,
      message: 'Segunda tentativa na instância A',
      now: new Date('2026-09-03T03:00:00.000Z'),
    });
    const secondClaim = await repository.claimApproved(secondApproved.followUpId!);
    assert.ok(secondClaim);
    await repository.markTransportStarted(secondClaim.followUp.followUpId!, secondClaim.leaseToken);
    await repository.completeSent({
      id: secondClaim.followUp.followUpId!,
      leaseToken: secondClaim.leaseToken,
      providerMessageId: `provider-rotation-new-cycle-second-${randomUUID()}`,
      now: new Date('2026-09-03T12:00:00.000Z'),
    });
    const [decision] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(and(
        eq(opportunityNextActions.opportunityId, ids.crm),
        eq(opportunityNextActions.state, 'active'),
        eq(opportunityNextActions.reasonCode, 'follow_up_decide_continuity'),
      ));
    assert.ok(decision);

    process.env.EVOLUTION_INSTANCE = instanceB;
    const noIdentityInput = {
      commandId: randomUUID(),
      opportunityId: ids.crm,
      actionId: decision.id,
      expectedVersion: decision.version,
      type: 'new_cycle' as const,
      schedule: {
        kind: 'customer_contact' as const,
        dueDate: '2026-09-10',
        dueTime: null,
        reason: 'Novo ciclo sem identidade B',
      },
      actor: 'operator',
      now: new Date('2026-09-08T12:00:00.000Z'),
    };
    await assert.rejects(actionRepository.continueFollowUp(noIdentityInput), { statusCode: 409 });
    const [stillDecision] = await db
      .select({ state: opportunityNextActions.state, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(eq(opportunityNextActions.id, decision.id));
    assert.deepEqual(stillDecision, { state: 'active', version: decision.version });

    await db.insert(whatsappContactActivity).values({
      id: activityB,
      instance: instanceB,
      providerConversationId: '5511999999999@s.whatsapp.net',
      canonicalPhone: '5511999999999',
      identityStatus: 'derived',
      lastInboundAt: null,
      lastOutboundAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.update(whatsappContactActivity)
      .set({ blockedAt: now, blockReason: 'do_not_contact' })
      .where(eq(whatsappContactActivity.id, activityB));
    await assert.rejects(actionRepository.continueFollowUp(noIdentityInput), { statusCode: 409 });
    await db.update(whatsappContactActivity)
      .set({ blockedAt: null, blockReason: null })
      .where(eq(whatsappContactActivity.id, activityB));
    const continued = await actionRepository.continueFollowUp(noIdentityInput);
    assert.ok(continued.successor);
    const rotated = await repository.get(ids.quotation, {
      now: new Date('2026-09-10T12:00:00.000Z'),
      expectedOpportunityId: ids.crm,
      expectedActionId: continued.successor!.actionId,
    });
    assert.equal(rotated?.instance, instanceB);
    assert.equal(rotated?.providerConversationId, '5511999999999@s.whatsapp.net');
    assert.equal(rotated?.canonicalPhone, '5511999999999');
    assert.equal(rotated?.cycleNumber, 2);
    assert.equal(rotated?.attemptNumber, 1);
    assert.equal(rotated?.state, 'ready');
    const approvedInB = await repository.approve({
      quotationId: ids.quotation,
      eligibilityVersion: rotated!.eligibilityVersion!,
      message: 'Aprovação na instância B',
      now: new Date('2026-09-10T12:00:00.000Z'),
    });
    assert.equal(approvedInB.state, 'approved');
    assert.equal((await repository.claimApproved(approvedInB.followUpId!))?.followUp.instance, instanceB);
  } finally {
    process.env.EVOLUTION_INSTANCE = originalInstance;
    await db.delete(whatsappContactActivity).where(eq(whatsappContactActivity.id, activityB));
    await resetSharedFollowUpGraph();
  }
});

databaseTest('foreign processing with a live started transport lease remains untouched', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const originalInstance = process.env.EVOLUTION_INSTANCE;
  const oldInstance = `follow-up-processing-old-${randomUUID()}`;
  const fixture = await createExtraEligibleFixture({ instanceName: oldInstance });
  const leaseToken = randomUUID();
  const transportStartedAt = new Date('2026-08-31T11:59:00.000Z');
  try {
    process.env.EVOLUTION_INSTANCE = oldInstance;
    const ready = await projectReady(repository, fixture);
    const approved = await repository.approve({
      quotationId: fixture.ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Preservar snapshot',
      now,
    });
    const approvedRow = await db
      .select({
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
        approvedAt: quotationFollowUps.approvedAt,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, approved.followUpId!));
    await db.update(quotationFollowUps).set({
      state: 'processing',
      leaseToken,
      leaseUntil: new Date('2030-01-01T00:00:00.000Z'),
      transportStartedAt,
    }).where(eq(quotationFollowUps.id, approved.followUpId!));

    process.env.EVOLUTION_INSTANCE = instance;
    assert.equal(await repository.claimApproved(), null);
    const [stillProcessing] = await db
      .select({
        state: quotationFollowUps.state,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
        approvedAt: quotationFollowUps.approvedAt,
        leaseToken: quotationFollowUps.leaseToken,
        leaseUntil: quotationFollowUps.leaseUntil,
        transportStartedAt: quotationFollowUps.transportStartedAt,
        closedReason: quotationFollowUps.closedReason,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, approved.followUpId!));
    assert.deepEqual(stillProcessing, {
      state: 'processing',
      approvedOpportunityId: approvedRow[0].approvedOpportunityId,
      eligibilityVersion: approvedRow[0].eligibilityVersion,
      messageSnapshot: 'Preservar snapshot',
      approvedAt: approvedRow[0].approvedAt,
      leaseToken,
      leaseUntil: new Date('2030-01-01T00:00:00.000Z'),
      transportStartedAt,
      closedReason: null,
    });

    process.env.EVOLUTION_INSTANCE = oldInstance;
    assert.equal(await repository.claimApproved(approved.followUpId!), null);
  } finally {
    process.env.EVOLUTION_INSTANCE = originalInstance;
    await fixture.cleanup();
  }
});

databaseTest('foreign processing with an expired started transport lease becomes review-only', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const originalInstance = process.env.EVOLUTION_INSTANCE;
  const oldInstance = `follow-up-expired-processing-old-${randomUUID()}`;
  const fixture = await createExtraEligibleFixture({ instanceName: oldInstance });
  const leaseToken = randomUUID();
  const transportStartedAt = new Date('2026-08-31T11:59:00.000Z');
  try {
    process.env.EVOLUTION_INSTANCE = oldInstance;
    const ready = await projectReady(repository, fixture);
    const approved = await repository.approve({
      quotationId: fixture.ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Preservar após expiração',
      now,
    });
    const approvedRow = await db
      .select({
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
        approvedAt: quotationFollowUps.approvedAt,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, approved.followUpId!));
    await db
      .update(quotationFollowUps)
      .set({
        state: 'processing',
        leaseToken,
        leaseUntil: new Date('2026-08-01T00:00:00.000Z'),
        transportStartedAt,
      })
      .where(eq(quotationFollowUps.id, approved.followUpId!));

    process.env.EVOLUTION_INSTANCE = instance;
    assert.equal(await repository.claimApproved(), null);
    const [review] = await db
      .select({
        state: quotationFollowUps.state,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
        approvedAt: quotationFollowUps.approvedAt,
        leaseToken: quotationFollowUps.leaseToken,
        leaseUntil: quotationFollowUps.leaseUntil,
        transportStartedAt: quotationFollowUps.transportStartedAt,
        closedReason: quotationFollowUps.closedReason,
        closedAt: quotationFollowUps.closedAt,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, approved.followUpId!));
    assert.deepEqual(review, {
      state: 'needs_review',
      approvedOpportunityId: approvedRow[0].approvedOpportunityId,
      eligibilityVersion: approvedRow[0].eligibilityVersion,
      messageSnapshot: 'Preservar após expiração',
      approvedAt: approvedRow[0].approvedAt,
      leaseToken: null,
      leaseUntil: null,
      transportStartedAt,
      closedReason: 'lease_expired_after_transport',
      closedAt: review.closedAt,
    });
    assert.ok(review.closedAt instanceof Date);

    process.env.EVOLUTION_INSTANCE = oldInstance;
    assert.equal(await repository.claimApproved(approved.followUpId!), null);
    const [notReclaimed] = await db
      .select({ state: quotationFollowUps.state })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, approved.followUpId!));
    assert.equal(notReclaimed?.state, 'needs_review');
  } finally {
    process.env.EVOLUTION_INSTANCE = originalInstance;
    await fixture.cleanup();
  }
});

databaseTest('foreign processing without a started transport is cancelled during rotation', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const originalInstance = process.env.EVOLUTION_INSTANCE;
  const oldInstance = `follow-up-pre-transport-old-${randomUUID()}`;
  const fixture = await createExtraEligibleFixture({ instanceName: oldInstance });
  const leaseToken = randomUUID();
  try {
    process.env.EVOLUTION_INSTANCE = oldInstance;
    const ready = await projectReady(repository, fixture);
    const approved = await repository.approve({
      quotationId: fixture.ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Cancelar antes do transporte',
      now,
    });
    await db
      .update(quotationFollowUps)
      .set({
        state: 'processing',
        leaseToken,
        leaseUntil: new Date('2030-01-01T00:00:00.000Z'),
        transportStartedAt: null,
      })
      .where(eq(quotationFollowUps.id, approved.followUpId!));

    process.env.EVOLUTION_INSTANCE = instance;
    assert.equal(await repository.claimApproved(), null);
    const [cancelled] = await db
      .select({
        state: quotationFollowUps.state,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
        approvedAt: quotationFollowUps.approvedAt,
        leaseToken: quotationFollowUps.leaseToken,
        leaseUntil: quotationFollowUps.leaseUntil,
        transportStartedAt: quotationFollowUps.transportStartedAt,
        closedReason: quotationFollowUps.closedReason,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, approved.followUpId!));
    assert.deepEqual(cancelled, {
      state: 'cancelled',
      approvedOpportunityId: null,
      eligibilityVersion: null,
      messageSnapshot: null,
      approvedAt: null,
      leaseToken: null,
      leaseUntil: null,
      transportStartedAt: null,
      closedReason: 'instance_changed',
    });
  } finally {
    process.env.EVOLUTION_INSTANCE = originalInstance;
    await fixture.cleanup();
  }
});

databaseTest('a live transport lease from instance A keeps instance B approval exclusive', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const originalInstance = process.env.EVOLUTION_INSTANCE;
  const instanceA = `follow-up-live-a-${randomUUID()}`;
  const instanceB = `follow-up-live-b-${randomUUID()}`;
  const fixtureA = await createExtraEligibleFixture({ instanceName: instanceA });
  const fixtureB = await createExtraEligibleFixture({
    opportunityId: fixtureA.opportunityId,
    createOpportunity: false,
    instanceName: instanceB,
  });
  try {
    process.env.EVOLUTION_INSTANCE = instanceA;
    const readyA = await projectReady(repository, fixtureA);
    const approvedA = await repository.approve({
      quotationId: fixtureA.ids.quotation,
      eligibilityVersion: readyA.eligibilityVersion!,
      message: 'Mensagem A',
      now,
    });
    const claimA = await repository.claimApproved(approvedA.followUpId!);
    assert.ok(claimA);
    assert.equal(await repository.markTransportStarted(claimA.followUp.followUpId!, claimA.leaseToken), true);
    const [activeBefore] = await db
      .select({
        state: quotationFollowUps.state,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
        approvedAt: quotationFollowUps.approvedAt,
        leaseToken: quotationFollowUps.leaseToken,
        leaseUntil: quotationFollowUps.leaseUntil,
        transportStartedAt: quotationFollowUps.transportStartedAt,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, approvedA.followUpId!));

    process.env.EVOLUTION_INSTANCE = instanceB;
    const readyB = await projectReady(repository, fixtureB);
    await assert.rejects(
      repository.approve({
        quotationId: fixtureB.ids.quotation,
        eligibilityVersion: readyB.eligibilityVersion!,
        message: 'Mensagem B',
        now,
      }),
      { statusCode: 409 },
    );
    const [activeAfter] = await db
      .select({
        state: quotationFollowUps.state,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
        approvedAt: quotationFollowUps.approvedAt,
        leaseToken: quotationFollowUps.leaseToken,
        leaseUntil: quotationFollowUps.leaseUntil,
        transportStartedAt: quotationFollowUps.transportStartedAt,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, approvedA.followUpId!));
    assert.deepEqual(activeAfter, activeBefore);

    await repository.completeSent({
      id: approvedA.followUpId!,
      leaseToken: claimA.leaseToken,
      providerMessageId: `provider-sent-${randomUUID()}`,
      now,
    });
    const readyBAfterSent = await repository.get(fixtureB.ids.quotation, { now });
    assert.equal(readyBAfterSent?.state, 'ready');
    const approvedB = await repository.approve({
      quotationId: fixtureB.ids.quotation,
      eligibilityVersion: readyBAfterSent!.eligibilityVersion!,
      message: 'Mensagem B',
      now,
    });
    assert.equal(approvedB.state, 'approved');
    assert.equal(approvedB.approvedOpportunityId, fixtureA.opportunityId);
  } finally {
    process.env.EVOLUTION_INSTANCE = originalInstance;
    await fixtureB.cleanup();
    await fixtureA.cleanup();
  }
});

databaseTest('legacy quotation approval resolves its deal and blocks a linked alternative', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  const legacy = await createExtraEligibleFixture({ linkQuotation: false });
  const alternative = await createExtraEligibleFixture({
    opportunityId: legacy.opportunityId,
    createOpportunity: false,
  });
  try {
    const legacyReady = await projectReady(repository, legacy);
    const alternativeReady = await projectReady(repository, alternative);
    const approved = await repository.approve({
      quotationId: legacy.ids.quotation,
      eligibilityVersion: legacyReady.eligibilityVersion!,
      message: 'Retorno legado',
      now,
    });
    assert.equal(approved.approvedOpportunityId, legacy.opportunityId);
    await assert.rejects(
      repository.approve({
        quotationId: alternative.ids.quotation,
        eligibilityVersion: alternativeReady.eligibilityVersion!,
        message: 'Retorno alternativo',
        now,
      }),
      { statusCode: 409 },
    );
  } finally {
    await legacy.cleanup();
    await alternative.cleanup();
  }
});

databaseTest('untargeted claim retires more than 50 approved rows from an old instance', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  const oldInstance = `follow-up-old-${randomUUID()}`;
  const oldFixtures: Awaited<ReturnType<typeof createExtraEligibleFixture>>[] = [];
  const originalInstance = process.env.EVOLUTION_INSTANCE;
  try {
    process.env.EVOLUTION_INSTANCE = oldInstance;
    for (let index = 0; index < 51; index += 1) {
      const oldFixture = await createExtraEligibleFixture({ instanceName: oldInstance });
      oldFixtures.push(oldFixture);
      const ready = await projectReady(repository, oldFixture);
      await repository.approve({
        quotationId: oldFixture.ids.quotation,
        eligibilityVersion: ready.eligibilityVersion!,
        message: `Retorno antigo ${index}`,
        now: new Date('2026-08-20T12:00:00.000Z'),
      });
    }

    process.env.EVOLUTION_INSTANCE = instance;
    const currentFixture = await createExtraEligibleFixture();
    try {
      const currentReady = await projectReady(repository, currentFixture);
      const currentApproved = await repository.approve({
        quotationId: currentFixture.ids.quotation,
        eligibilityVersion: currentReady.eligibilityVersion!,
        message: 'Retorno atual',
        now,
      });
      const claimed = await repository.claimApproved();
      assert.equal(claimed?.followUp.followUpId, currentApproved.followUpId);
      const oldStates = await db
        .select({ state: quotationFollowUps.state, closedReason: quotationFollowUps.closedReason })
        .from(quotationFollowUps)
        .where(eq(quotationFollowUps.instance, oldInstance));
      assert.equal(oldStates.length, 51);
      assert.ok(oldStates.every((row) => row.state === 'cancelled' && row.closedReason === 'instance_changed'));
    } finally {
      await currentFixture.cleanup();
    }
  } finally {
    process.env.EVOLUTION_INSTANCE = originalInstance;
    for (const oldFixture of oldFixtures) await oldFixture.cleanup();
  }
});

databaseTest('markTransportStarted fences and holds a processing row that is not projectable', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  const oldInstance = `follow-up-unprojectable-${randomUUID()}`;
  const fixture = await createExtraEligibleFixture({ instanceName: oldInstance });
  const originalInstance = process.env.EVOLUTION_INSTANCE;
  const leaseToken = randomUUID();
  try {
    process.env.EVOLUTION_INSTANCE = oldInstance;
    const ready = await projectReady(repository, fixture);
    const approved = await repository.approve({
      quotationId: fixture.ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      message: 'Não iniciar',
      now,
    });
    await db.update(quotationFollowUps).set({
      state: 'processing',
      leaseToken,
      leaseUntil: new Date('2030-01-01T00:00:00.000Z'),
    }).where(eq(quotationFollowUps.id, approved.followUpId!));

    process.env.EVOLUTION_INSTANCE = instance;
    assert.equal(await repository.markTransportStarted(approved.followUpId!, leaseToken), false);
    const [persisted] = await db
      .select({
        state: quotationFollowUps.state,
        approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
        eligibilityVersion: quotationFollowUps.eligibilityVersion,
        messageSnapshot: quotationFollowUps.messageSnapshot,
        approvedAt: quotationFollowUps.approvedAt,
        leaseToken: quotationFollowUps.leaseToken,
        leaseUntil: quotationFollowUps.leaseUntil,
        transportStartedAt: quotationFollowUps.transportStartedAt,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, approved.followUpId!));
    assert.deepEqual(persisted, {
      state: 'held',
      approvedOpportunityId: null,
      eligibilityVersion: null,
      messageSnapshot: null,
      approvedAt: null,
      leaseToken: null,
      leaseUntil: null,
      transportStartedAt: null,
    });
  } finally {
    process.env.EVOLUTION_INSTANCE = originalInstance;
    await fixture.cleanup();
  }
});

databaseTest('source action changes invalidate the opened follow-up before approval', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  let actionId: string | undefined;
  try {
    await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const [anchor] = await db
      .select({ createdActionId: opportunityDeliveryAnchors.createdActionId })
      .from(opportunityDeliveryAnchors)
      .where(eq(opportunityDeliveryAnchors.opportunityId, ids.crm));
    actionId = anchor?.createdActionId || undefined;
    assert.ok(actionId);

    const opened = await repository.get(ids.quotation, {
      trackingStartedAt: tracking,
      now,
      expectedOpportunityId: ids.crm,
      expectedActionId: actionId,
    });
    assert.ok(opened);
    assert.ok(opened.eligibilityVersion);

    await db.update(opportunityNextActions).set({
      state: 'completed',
      version: 2,
      updatedAt: new Date('2026-08-31T12:01:00.000Z'),
    }).where(eq(opportunityNextActions.id, actionId));

    await assert.rejects(
      repository.get(ids.quotation, {
        trackingStartedAt: tracking,
        now,
        expectedOpportunityId: ids.crm,
        expectedActionId: actionId,
      }),
      { statusCode: 409 },
    );
    await assert.rejects(
      repository.approve({
        quotationId: ids.quotation,
        eligibilityVersion: opened.eligibilityVersion!,
        message: 'Não aprovar ação alterada',
        trackingStartedAt: tracking,
        now,
      }),
      { statusCode: 409 },
    );
  } finally {
    await db.delete(opportunityDeliveryAnchors).where(eq(opportunityDeliveryAnchors.opportunityId, ids.crm));
    if (actionId) await db.delete(opportunityNextActions).where(eq(opportunityNextActions.id, actionId));
  }
});

databaseTest('accept upsert creates one awaiting row without copying the delivery provider id', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));

  await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: '55 (11) 99999-9999',
    providerMessageId: `provider-${ids.step}`,
  });
  await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: '5511999999999',
    providerMessageId: `provider-${ids.step}`,
  });

  const persisted = await db
    .select({
      state: quotationFollowUps.state,
      canonicalPhone: quotationFollowUps.canonicalPhone,
      providerConversationId: quotationFollowUps.providerConversationId,
      eligibilityVersion: quotationFollowUps.eligibilityVersion,
      messageSnapshot: quotationFollowUps.messageSnapshot,
      firstProviderReceiptAt: quotationFollowUps.firstProviderReceiptAt,
      dueAt: quotationFollowUps.dueAt,
      providerMessageId: quotationFollowUps.providerMessageId,
    })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0], {
    state: 'awaiting_receipt',
    canonicalPhone: '5511999999999',
    providerConversationId: '5511999999999@s.whatsapp.net',
    eligibilityVersion: null,
    messageSnapshot: null,
    firstProviderReceiptAt: null,
    dueAt: null,
    providerMessageId: null,
  });

  const beforeGet = persisted.length;
  const attention = await repository.list({ view: 'attention', now });
  const afterGet = await db
    .select({ id: quotationFollowUps.id })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(attention.data[0]?.state, 'awaiting_receipt');
  assert.equal(attention.data[0]?.firstProviderReceiptAt, null);
  assert.equal(attention.data[0]?.dueAt, null);
  assert.equal(attention.data[0]?.reason, 'awaiting_receipt');
  assert.equal(attention.data[0]?.reasonLabel, 'Aguardando recibo do WhatsApp');

  assert.equal(attention.data[0]?.canonicalPhone, '5511999999999');
  assert.equal(afterGet.length, beforeGet);
});
databaseTest('same delivery preserves a partial LID over later numeric acceptance and receipt', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));

  await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: '5511999999999',
    providerMessageId: `provider-${ids.step}`,
  });
  await repository.upsertFromDeliveryReceipt!({
    deliveryId: ids.delivery,

    revisionId: ids.revision,
    phone: '5511999999999',
    providerConversationId: 'abc@lid',
    allStepsDelivered: false,
    receivedAt: new Date('2026-08-02T00:01:00.000Z'),
  });
  await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: '5511999999999',
    providerMessageId: `provider-${ids.step}`,
  });
  let persisted = await db
    .select({ providerConversationId: quotationFollowUps.providerConversationId })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(persisted[0]?.providerConversationId, 'abc@lid');

  await repository.upsertFromDeliveryReceipt!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: '5511999999999',
    providerConversationId: '5511999999999@s.whatsapp.net',
    allStepsDelivered: false,
    receivedAt: new Date('2026-08-02T23:01:00.000Z'),
  });
  persisted = await db
    .select({ providerConversationId: quotationFollowUps.providerConversationId })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(persisted[0]?.providerConversationId, 'abc@lid');
});

databaseTest('resend resets the receipt clock and the next receipt starts it again', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  await db
    .update(quotationDeliveries)
    .set({ createdAt: new Date('2026-08-03T00:00:00.000Z') })
    .where(eq(quotationDeliveries.id, ids.resendDelivery));

  const firstReceiptAt = new Date('2026-08-04T12:00:00.000Z');
  const secondReceiptAt = new Date('2026-08-05T12:00:00.000Z');
  await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: '5511999999999',
    providerMessageId: `provider-${ids.step}`,
  });
  await repository.upsertFromDeliveryReceipt!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: '5511999999999',
    providerConversationId: '5511999999999@s.whatsapp.net',
    allStepsDelivered: true,
    receivedAt: firstReceiptAt,
  });

  await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
    deliveryId: ids.resendDelivery,
    revisionId: ids.revision,
    phone: '5511888888888',
    providerMessageId: 'provider-resend',
  });
  let persisted = await db
    .select({
      state: quotationFollowUps.state,
      deliveryId: quotationFollowUps.deliveryId,
      canonicalPhone: quotationFollowUps.canonicalPhone,
      firstProviderReceiptAt: quotationFollowUps.firstProviderReceiptAt,
      dueAt: quotationFollowUps.dueAt,
    })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.deepEqual(persisted[0], {
    state: 'awaiting_receipt',
    deliveryId: ids.resendDelivery,
    canonicalPhone: '5511888888888',
    firstProviderReceiptAt: null,
    dueAt: null,
  });

  await repository.upsertFromDeliveryReceipt!({
    deliveryId: ids.resendDelivery,
    revisionId: ids.revision,
    phone: '5511888888888',
    providerConversationId: '5511888888888@s.whatsapp.net',
    allStepsDelivered: true,
    receivedAt: secondReceiptAt,
  });
  persisted = await db
    .select({
      state: quotationFollowUps.state,
      deliveryId: quotationFollowUps.deliveryId,
      canonicalPhone: quotationFollowUps.canonicalPhone,
      firstProviderReceiptAt: quotationFollowUps.firstProviderReceiptAt,
      dueAt: quotationFollowUps.dueAt,
    })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.deepEqual(persisted[0], {
    state: 'waiting',
    deliveryId: ids.resendDelivery,
    canonicalPhone: '5511888888888',
    firstProviderReceiptAt: secondReceiptAt,
    dueAt: new Date('2026-08-06T12:00:00.000Z'),
  });
});

databaseTest('acceptance recovery retries a newer delivery over a reopenable cancelled row', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  const resendStepId = randomUUID();
  await db.insert(quotationDeliverySteps).values({
    id: resendStepId,
    deliveryId: ids.resendDelivery,
    position: 0,
    type: 'text',
    payloadSnapshot: { text: 'resend' },
    state: 'server_ack',
    providerMessageId: 'provider-resend-accepted',
    acceptedAt: new Date('2026-08-03T00:00:00.000Z'),
    deliveredAt: null,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: '5511999999999',
    providerMessageId: `provider-${ids.step}`,
  });
  await db
    .update(quotationFollowUps)
    .set({
      state: 'cancelled',
      closedReason: 'delivery_incomplete',
      closedAt: now,
      updatedAt: now,
    })
    .where(eq(quotationFollowUps.quotationId, ids.quotation));

  assert.deepEqual(
    await repository.listAcceptedDeliveriesMissingFollowUp!({ deliveryId: ids.resendDelivery }),
    {
      data: [{
        deliveryId: ids.resendDelivery,
        revisionId: ids.revision,
        phone: '5511888888888',
        providerMessageId: 'provider-resend-accepted',
        acceptedAt: new Date('2026-08-03T00:00:00.000Z'),
      }],
      hasMore: false,
    },
  );
  assert.deepEqual(
    await repository.listAcceptedDeliveriesMissingFollowUp!({ deliveryId: ids.delivery }),
    { data: [], hasMore: false },
  );
  await db
    .update(quotationFollowUps)
    .set({ state: 'waiting', closedReason: null, closedAt: null, updatedAt: now })
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.equal(
    (await repository.listAcceptedDeliveriesMissingFollowUp!({ deliveryId: ids.resendDelivery })).data.length,
    1,
  );

  await db
    .update(quotationFollowUps)
    .set({ state: 'cancelled', closedReason: 'delivery_incomplete', closedAt: now, updatedAt: now })
    .where(eq(quotationFollowUps.quotationId, ids.quotation));

  await db
    .update(quotationFollowUps)
    .set({ closedReason: 'crm_not_eligible', updatedAt: now })
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.deepEqual(
    await repository.listAcceptedDeliveriesMissingFollowUp!({ deliveryId: ids.resendDelivery }),
    { data: [], hasMore: false },
  );
});

databaseTest('LID without a phone appears in attention as identity_unresolved', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));

  await repository.upsertAwaitingReceiptFromAcceptedDelivery!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: 'abc123@lid',
    providerMessageId: `provider-${ids.step}`,
  });

  const persisted = await db
    .select({
      state: quotationFollowUps.state,
      canonicalPhone: quotationFollowUps.canonicalPhone,
      providerConversationId: quotationFollowUps.providerConversationId,
      closedReason: quotationFollowUps.closedReason,
    })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.deepEqual(persisted[0], {
    state: 'held',
    canonicalPhone: '',
    providerConversationId: 'abc123@lid',
    closedReason: null,
  });

  const attention = await repository.list({ view: 'attention', now });
  const row = attention.data.find((item) => item.quotationId === ids.quotation);
  assert.equal(row?.state, 'held');
  assert.equal(row?.reason, 'identity_unresolved');
  assert.equal(row?.reasonLabel, 'Contato sem telefone confiável');
});

databaseTest('receipt keeps a phone-less LID in attention and records its receipt clock', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));

  const receivedAt = new Date('2026-08-02T23:01:00.000Z');
  await repository.upsertFromDeliveryReceipt!({
    deliveryId: ids.delivery,
    revisionId: ids.revision,
    phone: 'abc123@lid',
    providerConversationId: 'abc123@lid',
    allStepsDelivered: true,
    receivedAt,
  });

  const attention = await repository.list({ view: 'attention', now });
  const row = attention.data.find((item) => item.quotationId === ids.quotation);
  assert.equal(row?.state, 'held');
  assert.equal(row?.canonicalPhone, '');
  assert.equal(row?.providerConversationId, 'abc123@lid');
  assert.equal(row?.firstProviderReceiptAt?.toISOString(), receivedAt.toISOString());
  assert.equal(row?.dueAt?.toISOString(), '2026-08-03T23:01:00.000Z');
});

databaseTest('materialization preserves LID identity and ignores operator receipt timestamps', async () => {
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  await db
    .update(quotationDeliveries)
    .set({ phone: 'abc123@lid', completionSource: 'operator' })
    .where(eq(quotationDeliveries.id, ids.resendDelivery));
  await db.update(clients).set({ arquivado: true }).where(eq(clients.id, ids.client));

  await materializeQuotationFollowUpQueue(db, { trackingStartedAt: tracking, instance, now });
  let persisted = await db
    .select({
      state: quotationFollowUps.state,
      canonicalPhone: quotationFollowUps.canonicalPhone,
      providerConversationId: quotationFollowUps.providerConversationId,
      closedReason: quotationFollowUps.closedReason,
      firstProviderReceiptAt: quotationFollowUps.firstProviderReceiptAt,
      dueAt: quotationFollowUps.dueAt,
    })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.deepEqual(persisted[0], {
    state: 'cancelled',
    canonicalPhone: '',
    providerConversationId: 'abc123@lid',
    closedReason: 'client_archived',
    firstProviderReceiptAt: null,
    dueAt: null,
  });

  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  await db.update(clients).set({ arquivado: false }).where(eq(clients.id, ids.client));
  await materializeQuotationFollowUpQueue(db, { trackingStartedAt: tracking, instance, now });
  persisted = await db
    .select({
      state: quotationFollowUps.state,
      canonicalPhone: quotationFollowUps.canonicalPhone,
      providerConversationId: quotationFollowUps.providerConversationId,
      closedReason: quotationFollowUps.closedReason,
      firstProviderReceiptAt: quotationFollowUps.firstProviderReceiptAt,
      dueAt: quotationFollowUps.dueAt,
    })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.quotationId, ids.quotation));
  assert.deepEqual(persisted[0], {
    state: 'held',
    canonicalPhone: '',
    providerConversationId: 'abc123@lid',
    closedReason: null,
    firstProviderReceiptAt: null,
    dueAt: null,
  });
});

databaseTest('manual counted contact fences a started alternative before changing the opportunity', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const actionRepository = createPostgresOpportunityActionRepository(() => db);
  const alternative = await createExtraEligibleFixture({
    opportunityId: ids.crm,
    createOpportunity: false,
  });
  try {
    await db
      .update(quotationDeliveries)
      .set({
        phone: '5511888888888',
        completionSource: 'provider_receipt',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      })
      .where(eq(quotationDeliveries.id, ids.resendDelivery));
    await db
      .delete(quotationDeliverySteps)
      .where(eq(quotationDeliverySteps.deliveryId, ids.resendDelivery));
    await resetSharedFollowUpGraph();
    const mainReady = await projectReady(repository, {
      ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
      phone: '5511999999999',
    });
    const alternativeReady = await projectReady(repository, alternative);
    const alternativeApproved = await repository.approve({
      quotationId: alternative.ids.quotation,
      eligibilityVersion: alternativeReady.eligibilityVersion!,
      message: 'Alternativa em envio',
      now,
    });
    const alternativeClaim = await repository.claimApproved(alternativeApproved.followUpId!);
    assert.ok(alternativeClaim);
    assert.equal(
      await repository.markTransportStarted(
        alternativeClaim.followUp.followUpId!,
        alternativeClaim.leaseToken,
      ),
      true,
    );

    const [mainAction] = await db
      .select({ id: opportunityNextActions.id, version: opportunityNextActions.version })
      .from(opportunityNextActions)
      .where(and(
        eq(opportunityNextActions.opportunityId, ids.crm),
        eq(opportunityNextActions.state, 'active'),
        eq(opportunityNextActions.reasonCode, 'proposal_delivery_confirmed'),
      ));
    assert.ok(mainAction);
    assert.equal(mainReady.quotationId, ids.quotation);

    await assert.rejects(
      actionRepository.recordManualContact({
        commandId: randomUUID(),
        opportunityId: ids.crm,
        actionId: mainAction.id,
        expectedVersion: mainAction.version,
        contactType: 'phone_call',
        occurredAt: now,
        note: 'Compromisso manual concorrente.',
        resultCode: 'follow_up_agreed',
        countsAsFollowUp: true,
        actor: 'operator',
        continuation: {
          type: 'successor',
          schedule: {
            kind: 'customer_contact',
            dueDate: '2026-09-04',
            dueTime: null,
            reason: 'Compromisso manual',
          },
        },
        now,
      }),
      { statusCode: 409 },
    );

    const [unchangedDeal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(unchangedDeal?.followUpStage, 0);
    assert.equal(
      (await db
        .select({ id: manualContactEvents.id })
        .from(manualContactEvents)
        .where(eq(manualContactEvents.opportunityId, ids.crm))).length,
      0,
    );
    assert.equal(
      (await db
        .select({ id: quotationFollowUpAttemptHistory.id })
        .from(quotationFollowUpAttemptHistory)
        .where(eq(quotationFollowUpAttemptHistory.opportunityId, ids.crm))).length,
      0,
    );
    const [alternativeProcessing] = await db
      .select({ state: quotationFollowUps.state, transportStartedAt: quotationFollowUps.transportStartedAt })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.quotationId, alternative.ids.quotation));
    assert.equal(alternativeProcessing?.state, 'processing');
    assert.ok(alternativeProcessing?.transportStartedAt);

    const completed = await repository.completeSent({
      id: alternativeClaim.followUp.followUpId!,
      leaseToken: alternativeClaim.leaseToken,
      providerMessageId: `provider-alternative-${randomUUID()}`,
      now,
    });
    assert.equal(completed?.state, 'waiting');

    const history = await db
      .select({ cycleNumber: quotationFollowUpAttemptHistory.cycleNumber, attemptNumber: quotationFollowUpAttemptHistory.attemptNumber })
      .from(quotationFollowUpAttemptHistory)
      .where(eq(quotationFollowUpAttemptHistory.opportunityId, ids.crm));
    assert.deepEqual(history.map((row) => ({
      cycleNumber: Number(row.cycleNumber),
      attemptNumber: Number(row.attemptNumber),
    })), [{ cycleNumber: 1, attemptNumber: 1 }]);

    const [advancedDeal] = await db
      .select({ followUpStage: crmDeals.followUpStage })
      .from(crmDeals)
      .where(eq(crmDeals.id, ids.crm));
    assert.equal(advancedDeal?.followUpStage, 1);
    assert.equal(
      (await db
        .select({ id: opportunityNextActions.id })
        .from(opportunityNextActions)
        .where(and(
          eq(opportunityNextActions.opportunityId, ids.crm),
          eq(opportunityNextActions.state, 'active'),
        ))).length,
      1,
    );
    assert.equal(
      (await db
        .select({ attemptNumber: quotationFollowUpAttemptHistory.attemptNumber })
        .from(quotationFollowUpAttemptHistory)
        .where(eq(quotationFollowUpAttemptHistory.opportunityId, ids.crm)))
        .filter((row) => Number(row.attemptNumber) > 2).length,
      0,
    );
  } finally {
    await alternative.cleanup();
    await resetSharedFollowUpGraph();
  }
});

databaseTest('confirmed inbound replaces return with Preciso responder and cancels undelivered approval', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const actions = createPostgresOpportunityActionRepository(() => db, { now: () => now });
  await resetSharedFollowUpGraph();
  const ready = await projectReady(repository, {
    ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
    phone: '5511999999999',
  });
  const approved = await repository.approve({
    quotationId: ids.quotation,
    eligibilityVersion: ready.eligibilityVersion!,
    message: 'Retorno pendente',
    now,
  });
  assert.equal(approved.state, 'approved');

  const occurredAt = new Date('2026-09-01T15:30:00.000Z');
  const providerMessageId = `inbound-${randomUUID()}`;
  await repository.applyConversationToOpenFollowUps!({
    instance,
    providerConversationId: '5511999999999@s.whatsapp.net',
    providerMessageId,
    fromMe: false,
    occurredAt,
    identityStatus: 'verified',
    canonicalPhone: '5511999999999',
  });

  const followUps = await db
    .select({
      state: quotationFollowUps.state,
      closedReason: quotationFollowUps.closedReason,
      approvedOpportunityId: quotationFollowUps.approvedOpportunityId,
      eligibilityVersion: quotationFollowUps.eligibilityVersion,
      messageSnapshot: quotationFollowUps.messageSnapshot,
    })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.id, approved.followUpId!));
  assert.deepEqual(followUps[0], {
    state: 'cancelled',
    closedReason: 'inbound_after_anchor',
    approvedOpportunityId: null,
    eligibilityVersion: null,
    messageSnapshot: null,
  });
  assert.equal(await repository.claimApproved(approved.followUpId!), null);

  const active = await db
    .select({
      id: opportunityNextActions.id,
      reason: opportunityNextActions.reason,
      reasonCode: opportunityNextActions.reasonCode,
      state: opportunityNextActions.state,
      version: opportunityNextActions.version,
    })
    .from(opportunityNextActions)
    .where(and(
      eq(opportunityNextActions.opportunityId, ids.crm),
      eq(opportunityNextActions.state, 'active'),
    ));
  assert.equal(active.length, 1);
  assert.equal(active[0]?.reason, 'Preciso responder');
  assert.equal(active[0]?.reasonCode, 'inbound_needs_response');

  await actions.completeAction({
    actionId: active[0]!.id,
    expectedVersion: active[0]!.version,
    actor: 'operator-a',
    successor: {
      kind: 'internal',
      dueDate: '2026-09-02',
      dueTime: null,
      reason: 'Aguardar análise interna',
    },
  });
  await repository.applyConversationToOpenFollowUps!({
    instance,
    providerConversationId: '5511999999999@s.whatsapp.net',
    providerMessageId,
    fromMe: false,
    occurredAt,
    identityStatus: 'verified',
    canonicalPhone: '5511999999999',
  });
  const afterReplay = await db
    .select({ reasonCode: opportunityNextActions.reasonCode })
    .from(opportunityNextActions)
    .where(and(
      eq(opportunityNextActions.opportunityId, ids.crm),
      eq(opportunityNextActions.state, 'active'),
    ));
  assert.deepEqual(afterReplay, [{ reasonCode: 'manual_action' }]);

  await repository.applyConversationToOpenFollowUps!({
    instance,
    providerConversationId: '5511999999999@s.whatsapp.net',
    providerMessageId: `inbound-new-${randomUUID()}`,
    fromMe: false,
    occurredAt: new Date('2026-09-01T16:00:00.000Z'),
    identityStatus: 'verified',
    canonicalPhone: '5511999999999',
  });
  const activeAgain = await db
    .select({ reasonCode: opportunityNextActions.reasonCode })
    .from(opportunityNextActions)
    .where(and(
      eq(opportunityNextActions.opportunityId, ids.crm),
      eq(opportunityNextActions.state, 'active'),
    ));
  assert.deepEqual(activeAgain, [{ reasonCode: 'inbound_needs_response' }]);
});

databaseTest('confirmed inbound reaches a pre-proposal opportunity through its durable phone', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  const actions = createPostgresOpportunityActionRepository(() => db, { now: () => now });
  const clientId = randomUUID();
  const opportunityId = randomUUID();
  const phone = '5511977776655';
  await db.insert(clients).values({ id: clientId, nome: 'Cliente pré-proposta' });
  await db.insert(crmDeals).values({
    id: opportunityId,
    clientId,
    nome: 'Demanda sem orçamento',
    telefone: phone,
    status: 'Novo Lead',
    createdAt: now,
    updatedAt: now,
  });
  try {
    await actions.createAction({
      opportunityId,
      kind: 'first_contact',
      dueDate: '2026-09-01',
      dueTime: null,
      reason: 'Primeiro atendimento',
      actor: 'system',
    });
    await repository.applyConversationToOpenFollowUps!({
      instance,
      providerConversationId: `${phone}@s.whatsapp.net`,
      providerMessageId: `inbound-preproposal-${randomUUID()}`,
      fromMe: false,
      occurredAt: new Date('2026-09-01T17:00:00.000Z'),
      identityStatus: 'verified',
      canonicalPhone: phone,
    });
    const [active] = await db
      .select({ reasonCode: opportunityNextActions.reasonCode })
      .from(opportunityNextActions)
      .where(and(
        eq(opportunityNextActions.opportunityId, opportunityId),
        eq(opportunityNextActions.state, 'active'),
      ));
    assert.equal(active?.reasonCode, 'inbound_needs_response');
  } finally {
    await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, opportunityId));
    await db.delete(crmDeals).where(eq(crmDeals.id, opportunityId));
    await db.delete(clients).where(eq(clients.id, clientId));
  }
});

databaseTest('inbound racing claimApproved never leaves a live undelivered authorization', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await resetSharedFollowUpGraph();
  const ready = await projectReady(repository, {
    ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
    phone: '5511999999999',
  });
  const approved = await repository.approve({
    quotationId: ids.quotation,
    eligibilityVersion: ready.eligibilityVersion!,
    message: 'Corrida inbound',
    now,
  });

  const occurredAt = new Date('2026-09-01T16:00:00.000Z');
  const [claimed] = await Promise.all([
    repository.claimApproved(approved.followUpId!),
    repository.applyConversationToOpenFollowUps!({
      instance,
      providerConversationId: '5511999999999@s.whatsapp.net',
      providerMessageId: `inbound-race-${randomUUID()}`,
      fromMe: false,
      occurredAt,
      identityStatus: 'verified',
      canonicalPhone: '5511999999999',
    }),
  ]);

  const [row] = await db
    .select({
      state: quotationFollowUps.state,
      closedReason: quotationFollowUps.closedReason,
      transportStartedAt: quotationFollowUps.transportStartedAt,
      leaseToken: quotationFollowUps.leaseToken,
    })
    .from(quotationFollowUps)
    .where(eq(quotationFollowUps.id, approved.followUpId!));

  assert.equal(row.state, 'cancelled');
  assert.equal(row.closedReason, 'inbound_after_anchor');
  assert.equal(row.transportStartedAt, null);
  assert.equal(row.leaseToken, null);
  if (claimed) {
    assert.equal(
      await repository.markTransportStarted(approved.followUpId!, claimed.leaseToken),
      false,
    );
  }
});

databaseTest('ambiguous phone association creates one Associar resposta and suspends that contact only', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await resetSharedFollowUpGraph();
  const ready = await projectReady(repository, {
    ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
    phone: '5511999999999',
  });
  const approved = await repository.approve({
    quotationId: ids.quotation,
    eligibilityVersion: ready.eligibilityVersion!,
    message: 'Aprovação da demanda A',
    now,
  });

  const other = await createExtraEligibleFixture({ createOpportunity: true });
  await db
    .update(crmDeals)
    .set({ clientId: ids.client })
    .where(eq(crmDeals.id, other.opportunityId));
  await db
    .update(quotationDeliveries)
    .set({ phone: '5511999999999' })
    .where(eq(quotationDeliveries.id, other.ids.delivery));
  const otherReady = await projectReady(repository, {
    ids: {
      quotation: other.ids.quotation,
      revision: other.ids.revision,
      delivery: other.ids.delivery,
    },
    phone: '5511999999999',
  });
  const otherApproved = await repository.approve({
    quotationId: other.ids.quotation,
    eligibilityVersion: otherReady.eligibilityVersion!,
    message: 'Aprovação da demanda B',
    now,
  });

  // Independent contact must keep its undelivered approval.
  const foreign = await createExtraEligibleFixture({ createOpportunity: true });
  await db
    .update(quotationDeliveries)
    .set({ phone: '5511888777666' })
    .where(eq(quotationDeliveries.id, foreign.ids.delivery));
  const foreignReady = await projectReady(repository, {
    ids: {
      quotation: foreign.ids.quotation,
      revision: foreign.ids.revision,
      delivery: foreign.ids.delivery,
    },
    phone: '5511888777666',
  });
  const foreignApproved = await repository.approve({
    quotationId: foreign.ids.quotation,
    eligibilityVersion: foreignReady.eligibilityVersion!,
    message: 'Outro contato',
    now,
  });

  try {
    await repository.applyConversationToOpenFollowUps!({
      instance,
      providerConversationId: '5511999999999@s.whatsapp.net',
      providerMessageId: `inbound-ambiguous-${randomUUID()}`,
      fromMe: false,
      occurredAt: new Date('2026-09-01T17:00:00.000Z'),
      identityStatus: 'verified',
      canonicalPhone: '5511999999999',
    });

    for (const followUpId of [approved.followUpId!, otherApproved.followUpId!]) {
      const [row] = await db
        .select({
          state: quotationFollowUps.state,
          closedReason: quotationFollowUps.closedReason,
          eligibilityVersion: quotationFollowUps.eligibilityVersion,
        })
        .from(quotationFollowUps)
        .where(eq(quotationFollowUps.id, followUpId));
      assert.equal(row.state, 'cancelled');
      assert.equal(row.closedReason, 'inbound_after_anchor');
      assert.equal(row.eligibilityVersion, null);
    }

    const [foreignRow] = await db
      .select({ state: quotationFollowUps.state, closedReason: quotationFollowUps.closedReason })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, foreignApproved.followUpId!));
    assert.equal(foreignRow.state, 'approved');
    assert.equal(foreignRow.closedReason, null);

    const associateAlerts = await db
      .select({
        opportunityId: opportunityNextActions.opportunityId,
        reason: opportunityNextActions.reason,
        reasonCode: opportunityNextActions.reasonCode,
      })
      .from(opportunityNextActions)
      .where(and(
        eq(opportunityNextActions.state, 'active'),
        eq(opportunityNextActions.reasonCode, 'associate_response'),
      ));
    const relevant = associateAlerts.filter((row) =>
      [ids.crm, other.opportunityId].includes(row.opportunityId),
    );
    assert.equal(relevant.length, 1);
    assert.ok(relevant.every((row) => row.reason === 'Associar resposta'));

    const ambiguityActions = await db
      .select({
        id: opportunityNextActions.id,
        opportunityId: opportunityNextActions.opportunityId,
        state: opportunityNextActions.state,
        reasonCode: opportunityNextActions.reasonCode,
        replacedById: opportunityNextActions.replacedById,
        version: opportunityNextActions.version,
      })
      .from(opportunityNextActions)
      .where(inArray(opportunityNextActions.opportunityId, [ids.crm, other.opportunityId!]));
    const alert = ambiguityActions.find(
      (row) => row.state === 'active' && row.reasonCode === 'associate_response',
    );
    const suspended = ambiguityActions.find((row) => row.state === 'suspended');
    assert.ok(alert);
    assert.ok(suspended);
    assert.equal(suspended.replacedById, alert.id);

    for (const opportunityId of [ids.crm, other.opportunityId]) {
      const inboundActions = await db
        .select({ id: opportunityNextActions.id })
        .from(opportunityNextActions)
        .where(and(
          eq(opportunityNextActions.opportunityId, opportunityId),
          eq(opportunityNextActions.state, 'active'),
          eq(opportunityNextActions.reasonCode, 'inbound_needs_response'),
        ));
      assert.equal(inboundActions.length, 0);
    }

    await repository.applyConversationToOpenFollowUps!({
      instance,
      providerConversationId: '5511999999999@s.whatsapp.net',
      providerMessageId: `inbound-ambiguous-again-${randomUUID()}`,
      fromMe: false,
      occurredAt: new Date('2026-09-01T17:05:00.000Z'),
      identityStatus: 'verified',
      canonicalPhone: '5511999999999',
    });
    const associateAgain = await db
      .select({ id: opportunityNextActions.id })
      .from(opportunityNextActions)
      .where(and(
        eq(opportunityNextActions.state, 'active'),
        eq(opportunityNextActions.reasonCode, 'associate_response'),
        inArray(opportunityNextActions.opportunityId, [ids.crm, other.opportunityId!]),
      ));
    assert.equal(associateAgain.length, 1);

    const actionRepository = createPostgresOpportunityActionRepository(() => db, {
      now: () => new Date('2026-09-01T17:10:00.000Z'),
    });
    await actionRepository.associateInboundResponse({
      actionId: alert.id,
      expectedVersion: alert.version,
      opportunityId: suspended.opportunityId,
      actor: 'operator-a',
    });
    const afterAssociation = await db
      .select({
        opportunityId: opportunityNextActions.opportunityId,
        state: opportunityNextActions.state,
        reasonCode: opportunityNextActions.reasonCode,
      })
      .from(opportunityNextActions)
      .where(inArray(opportunityNextActions.opportunityId, [ids.crm, other.opportunityId!]));
    assert.equal(
      afterAssociation.filter(
        (row) =>
          row.opportunityId === suspended.opportunityId &&
          row.state === 'active' &&
          row.reasonCode === 'inbound_needs_response',
      ).length,
      1,
    );
    const losingOpportunityId = suspended.opportunityId === ids.crm ? other.opportunityId : ids.crm;
    assert.equal(
      afterAssociation.filter(
        (row) => row.opportunityId === losingOpportunityId && row.state === 'active',
      ).length,
      1,
    );
  } finally {
    await foreign.cleanup();
    await other.cleanup();
    await resetSharedFollowUpGraph();
  }
});

databaseTest('do-not-contact cancels undelivered approvals for every opportunity of the phone', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await resetSharedFollowUpGraph();
  const ready = await projectReady(repository, {
    ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
    phone: '5511999999999',
  });

  const other = await createExtraEligibleFixture({ createOpportunity: true });
  await db
    .update(quotationDeliveries)
    .set({ phone: '5511999999999' })
    .where(eq(quotationDeliveries.id, other.ids.delivery));
  const otherReady = await projectReady(repository, {
    ids: {
      quotation: other.ids.quotation,
      revision: other.ids.revision,
      delivery: other.ids.delivery,
    },
    phone: '5511999999999',
  });
  const otherApproved = await repository.approve({
    quotationId: other.ids.quotation,
    eligibilityVersion: otherReady.eligibilityVersion!,
    message: 'Outra demanda do mesmo telefone',
    now,
  });
  assert.equal(otherApproved.state, 'approved');

  try {
    await repository.dismiss({
      quotationId: ids.quotation,
      eligibilityVersion: ready.eligibilityVersion!,
      reason: 'do_not_contact',
      now,
    });

    const [otherRow] = await db
      .select({
        state: quotationFollowUps.state,
        closedReason: quotationFollowUps.closedReason,
      })
      .from(quotationFollowUps)
      .where(eq(quotationFollowUps.id, otherApproved.followUpId!));
    assert.equal(otherRow.state, 'cancelled');
    assert.equal(otherRow.closedReason, 'contact_blocked');
    assert.equal(await repository.claimApproved(otherApproved.followUpId!), null);

    await assert.rejects(
      () => repository.approve({
        quotationId: other.ids.quotation,
        eligibilityVersion: otherReady.eligibilityVersion!,
        message: 'Não deve aprovar com contato bloqueado',
        now,
      }),
    );
  } finally {
    await db
      .update(whatsappContactActivity)
      .set({ blockedAt: null, blockReason: null, updatedAt: now })
      .where(eq(whatsappContactActivity.canonicalPhone, '5511999999999'));
    await other.cleanup();
    await resetSharedFollowUpGraph();
  }
});

databaseTest('closing an opportunity does not mark the contact as do-not-contact', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await db
    .update(whatsappContactActivity)
    .set({ blockedAt: null, blockReason: null, updatedAt: now })
    .where(eq(whatsappContactActivity.canonicalPhone, '5511999999999'));
  await resetSharedFollowUpGraph();
  await projectReady(repository, {
    ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
    phone: '5511999999999',
  });

  await db
    .update(crmDeals)
    .set({ status: 'Perdido', lostReason: 'Sem interesse comercial', updatedAt: now })
    .where(eq(crmDeals.id, ids.crm));

  const activityRows = await db
    .select({
      blockedAt: whatsappContactActivity.blockedAt,
      blockReason: whatsappContactActivity.blockReason,
    })
    .from(whatsappContactActivity)
    .where(eq(whatsappContactActivity.canonicalPhone, '5511999999999'));
  assert.ok(activityRows.length >= 1);
  for (const row of activityRows) {
    assert.equal(row.blockedAt, null);
    assert.equal(row.blockReason, null);
  }
  await resetSharedFollowUpGraph();
});


databaseTest('uncertain identity creates Verificar conversa without claiming Sem resposta', async () => {
  const repository = createPostgresQuotationFollowUpRepository(() => db);
  await resetSharedFollowUpGraph();
  await projectReady(repository, {
    ids: { quotation: ids.quotation, revision: ids.revision, delivery: ids.delivery },
    phone: '5511999999999',
  });
  try {
    await repository.applyConversationToOpenFollowUps!({
      instance,
      providerConversationId: '5511999999999@s.whatsapp.net',
      providerMessageId: `inbound-uncertain-${randomUUID()}`,
      fromMe: false,
      occurredAt: new Date('2026-09-01T18:00:00.000Z'),
      identityStatus: 'unresolved',
      canonicalPhone: null,
    });
    const active = await db
      .select({
        reason: opportunityNextActions.reason,
        reasonCode: opportunityNextActions.reasonCode,
      })
      .from(opportunityNextActions)
      .where(and(
        eq(opportunityNextActions.opportunityId, ids.crm),
        eq(opportunityNextActions.state, 'active'),
      ));
    assert.equal(active[0]?.reasonCode, 'verify_conversation');
    assert.equal(active[0]?.reason, 'Verificar conversa');
    assert.notEqual(active[0]?.reason, 'Sem resposta');
  } finally {
    await resetSharedFollowUpGraph();
  }
});
