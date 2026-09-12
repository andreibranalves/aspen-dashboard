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
