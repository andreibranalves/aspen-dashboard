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
  step: randomUUID(),
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
  process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT = tracking.toISOString();
});

test.after(async () => {
  if (!databaseUrl || !db || !client) return;
  await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, ids.quotation));
  await db.delete(whatsappContactActivity).where(eq(whatsappContactActivity.instance, instance));
  await db.delete(quotationDeliverySteps).where(eq(quotationDeliverySteps.deliveryId, ids.delivery));
  await db.delete(quotationDeliveries).where(eq(quotationDeliveries.id, ids.delivery));
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
