import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  clients,
  crmDeals,
  opportunityDeliveryAnchors,
  opportunityNextActions,
  quoteRevisions,
  quotations,
  quotationDeliveries,
  quotationDeliverySteps,
  whatsappContactActivity,
  quotationFollowUps,
} from '../../api/_infrastructure/db/schema.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import { ensureFixtureTemplateVersion } from '../fixtures/quotation-revision-seeds.ts';
import { createPostgresQuotationFollowUpRepository } from '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.js';
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
const businessNumber = `ORC-${String(Date.now()).slice(-8)}`;
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
  const localBusinessNumber = `ORC-${String(70000000 + extraFixtureSequence).padStart(8, '0')}`;
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
      await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, localIds.quotation));
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
      if (ownOpportunity) await db.delete(crmDeals).where(eq(crmDeals.id, opportunityId));
      await db.delete(quotations).where(eq(quotations.id, localIds.quotation));
      await db.delete(clients).where(eq(clients.id, localIds.client));
    },
  };
}

async function projectReady(
  repository: ReturnType<typeof createPostgresQuotationFollowUpRepository>,
  fixture: { ids: { quotation: string; revision: string; delivery: string }; phone: string },
) {
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
    });
    const allowedAfterSent = await repository.approve({
      quotationId: alternative.ids.quotation,
      eligibilityVersion: alternativeReady.eligibilityVersion!,
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
    });
    const approvedB = await repository.approve({
      quotationId: fixtureB.ids.quotation,
      eligibilityVersion: readyB.eligibilityVersion!,
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
    .from(quotationFollowUps);
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
