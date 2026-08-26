import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  ensureFixtureTemplateVersion,
  type FixtureRevisionFields,
} from '../fixtures/quotation-revision-seeds.ts';
import postgres from 'postgres';

import {
  BetaCleanupBlockedError,
  BetaCleanupRepositoryError,
  createPostgresBetaCleanupRepository,
} from '../../api/_infrastructure/db/repositories/beta-cleanup-repository.js';
import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import {
  clients,
  crmDeals,
  productActivityEvents,
  products,
  quotationDeliveries,
  quotationDeliverySteps,
  quotationEmailDeliveries,
  quotationIssueRequests,
  quotations,
  quoteLeads,
  quoteRevisions,
  quoteRevisionItems,
  salesOrders,
} from '../../api/_infrastructure/db/schema.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

test('beta cleanup plans exact graphs, preserves shared data, blocks orders and rolls back', { skip: !TEST_DATABASE_URL }, async () => {
  const client = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  const sku = `BETA-CLEANUP-${Date.now()}`;
  const tracked = {
    clients: new Set<string>(), leads: new Set<string>(), deals: new Set<string>(), quotations: new Set<string>(),
    revisions: new Set<string>(), items: new Set<string>(), deliveries: new Set<string>(), steps: new Set<string>(),
    emails: new Set<string>(), issues: new Set<string>(), activities: new Set<string>(), orders: new Set<string>(),
  };
  let sequence = 9000;
  let fixtureFields: FixtureRevisionFields;

  async function insertGraph(options: { clientId?: string; createClient?: boolean; order?: boolean } = {}) {
    const clientId = options.clientId || randomUUID();
    const quotationId = randomUUID();
    const revisionId = randomUUID();
    const leadId = randomUUID();
    const dealId = randomUUID();
    const itemId = randomUUID();
    const deliveryId = randomUUID();
    const stepId = randomUUID();
    const emailId = randomUUID();
    const issueId = randomUUID();
    const activityId = randomUUID();
    const ambiguousActivityId = randomUUID();
    const orderId = randomUUID();
    sequence += 1;
    tracked.clients.add(clientId);
    tracked.quotations.add(quotationId);
    tracked.revisions.add(revisionId);
    tracked.leads.add(leadId);
    tracked.deals.add(dealId);
    tracked.items.add(itemId);
    tracked.deliveries.add(deliveryId);
    tracked.steps.add(stepId);
    tracked.emails.add(emailId);
    tracked.issues.add(issueId);
    tracked.activities.add(activityId);
    tracked.activities.add(ambiguousActivityId);
    if (options.order) tracked.orders.add(orderId);

    if (options.createClient !== false) await db.insert(clients).values({ id: clientId, nome: 'Cliente beta cleanup' });
    await db.insert(quotations).values({ id: quotationId, businessNumber: `ORC-2099${sequence}`, clientId });
    await db.insert(quoteRevisions).values({
      ...fixtureFields,
      id: revisionId, quotationId, version: 1, validadeDias: 15, clienteNome: 'Cliente beta cleanup',
      companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    });
    await db.insert(quoteRevisionItems).values({
      id: itemId, revisionId, position: 0, productSku: sku, quantidade: '1.000', produtoSku: sku,
      produtoNome: 'Produto beta', precoFonte: 'manual', precoSugerido: '10.00', precoAplicado: '10.00', totalLinha: '10.00',
    });
    await db.insert(quoteLeads).values({ id: leadId, identityKey: `beta:${leadId}`, quotationId });
    await db.insert(crmDeals).values({ id: dealId, quoteLeadId: leadId, clientId, quotationId, nome: 'Deal beta cleanup' });
    await db.update(quoteLeads).set({ crmDealId: dealId }).where(eq(quoteLeads.id, leadId));
    const now = new Date();
    await db.insert(quotationIssueRequests).values({
      id: issueId, idempotencyKey: randomUUID(), fingerprint: `fingerprint-${issueId}`, state: 'completed',
      quotationId, revisionId, createdAt: now, updatedAt: now,
    });
    await db.insert(quotationDeliveries).values({
      id: deliveryId, revisionId, phone: '5511999999999', flowId: `flow-${deliveryId}`, flowName: 'Fluxo beta',
      state: 'queued', createdAt: now, updatedAt: now,
    });
    await db.insert(quotationDeliverySteps).values({
      id: stepId, deliveryId, position: 0, type: 'text', payloadSnapshot: { text: 'teste' }, state: 'queued',
      createdAt: now, updatedAt: now,
    });
    await db.insert(quotationEmailDeliveries).values({
      id: emailId, revisionId, recipient: 'beta@example.com', state: 'accepted', createdAt: now, updatedAt: now,
    });
    await db.insert(productActivityEvents).values([
      { id: activityId, productSku: sku, tipo: 'orcamento', texto: 'Atividade exclusiva', referenceId: `orcamento:${quotationId}:created` },
      { id: ambiguousActivityId, productSku: sku, tipo: 'orcamento', texto: 'Atividade ambígua', referenceId: `referencia:${quotationId}` },
    ]);
    if (options.order) await db.insert(salesOrders).values({
      id: orderId, orderNumber: `PED-2099-${sequence}`, quotationId, quotationRevisionId: revisionId, clientId,
      transactionDate: '2099-01-01', subtotal: '10.00', grandTotal: '10.00',
    });
    return { clientId, quotationId, revisionId, leadId, dealId, deliveryId, stepId, issueId, activityId, ambiguousActivityId, orderId };
  }

  async function hasRow(table: any, column: any, id: string) {
    return (await db.select({ id: column }).from(table).where(eq(column, id))).length === 1;
  }

  try {
    await migrate(db, { migrationsFolder });
    fixtureFields = await ensureFixtureTemplateVersion(db as any);
    await db.insert(products).values({ sku, nome: 'Produto beta cleanup', precoBase: '10.00' });
    const repository = createPostgresBetaCleanupRepository(() => db);

    const removable = await insertGraph();
    const before = await repository.plan([{ type: 'quotation', id: removable.quotationId }]);
    assert.deepEqual(before.counts, {
      clients: 1, leads: 1, deals: 1, quotations: 1, revisions: 1, items: 1,
      deliveries: 1, deliverySteps: 1, emailDeliveries: 1, issueRequests: 1, activities: 1, salesOrders: 0,
    });
    assert.equal(await hasRow(quotations, quotations.id, removable.quotationId), true, 'dry-run must not write');
    assert.equal(before.ids.activities.includes(removable.ambiguousActivityId), false);

    await repository.apply([{ type: 'quotation', id: removable.quotationId }]);
    assert.equal(await hasRow(quotations, quotations.id, removable.quotationId), false);
    assert.equal(await hasRow(clients, clients.id, removable.clientId), false);
    assert.equal(await hasRow(productActivityEvents, productActivityEvents.id, removable.ambiguousActivityId), true);
    const repeated = await repository.plan([{ type: 'quotation', id: removable.quotationId }]);
    assert.equal(Object.values(repeated.counts).every((count) => count === 0), true);
    assert.equal(Object.values(repeated.ids).every((ids) => ids.length === 0), true);

    const sharedClientId = randomUUID();
    const selectedShared = await insertGraph({ clientId: sharedClientId });
    const retained = await insertGraph({ clientId: sharedClientId, createClient: false });
    const sharedPlan = await repository.plan([{ type: 'quotation', id: selectedShared.quotationId }]);
    assert.deepEqual(sharedPlan.retainedSharedClients, [sharedClientId]);
    assert.equal(sharedPlan.counts.clients, 0);
    await repository.apply([{ type: 'quotation', id: selectedShared.quotationId }]);
    assert.equal(await hasRow(clients, clients.id, sharedClientId), true);
    assert.equal(await hasRow(quotations, quotations.id, retained.quotationId), true);

    const blocked = await insertGraph({ order: true });
    const blockedPlan = await repository.plan([{ type: 'quotation', id: blocked.quotationId }]);
    assert.deepEqual(blockedPlan.blockers, [{ type: 'sales_order', id: blocked.orderId }]);
    await assert.rejects(repository.apply([{ type: 'quotation', id: blocked.quotationId }]), BetaCleanupBlockedError);
    assert.equal(await hasRow(quotations, quotations.id, blocked.quotationId), true);

    const rollback = await insertGraph();
    const failingDatabase = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver);
        return (callback: (tx: AppDatabase) => Promise<unknown>) => target.transaction(async (tx) => callback(new Proxy(tx as AppDatabase, {
          get(transaction, transactionProperty, transactionReceiver) {
            if (transactionProperty !== 'delete') return Reflect.get(transaction, transactionProperty, transactionReceiver);
            return (table: unknown) => {
              if (table === quotationDeliveries) throw new Error('injected rollback failure');
              return (transaction.delete as (selected: any) => any)(table);
            };
          },
        })));
      },
    }) as AppDatabase;
    const failingRepository = createPostgresBetaCleanupRepository(() => failingDatabase);
    await assert.rejects(failingRepository.apply([{ type: 'quotation', id: rollback.quotationId }]), BetaCleanupRepositoryError);
    assert.equal(await hasRow(quotationIssueRequests, quotationIssueRequests.id, rollback.issueId), true);
    assert.equal(await hasRow(quotationDeliverySteps, quotationDeliverySteps.id, rollback.stepId), true);
    assert.equal(await hasRow(quotations, quotations.id, rollback.quotationId), true);
  } finally {
    if (tracked.orders.size) await db.delete(salesOrders).where(inArray(salesOrders.id, [...tracked.orders]));
    if (tracked.issues.size) await db.delete(quotationIssueRequests).where(inArray(quotationIssueRequests.id, [...tracked.issues]));
    if (tracked.steps.size) await db.delete(quotationDeliverySteps).where(inArray(quotationDeliverySteps.id, [...tracked.steps]));
    if (tracked.deliveries.size) await db.delete(quotationDeliveries).where(inArray(quotationDeliveries.id, [...tracked.deliveries]));
    if (tracked.emails.size) await db.delete(quotationEmailDeliveries).where(inArray(quotationEmailDeliveries.id, [...tracked.emails]));
    if (tracked.activities.size) await db.delete(productActivityEvents).where(inArray(productActivityEvents.id, [...tracked.activities]));
    if (tracked.deals.size) await db.update(crmDeals).set({ quoteLeadId: null, clientId: null, quotationId: null }).where(inArray(crmDeals.id, [...tracked.deals]));
    if (tracked.leads.size) await db.update(quoteLeads).set({ quotationId: null, crmDealId: null }).where(inArray(quoteLeads.id, [...tracked.leads]));
    if (tracked.revisions.size) await db.delete(quoteRevisions).where(inArray(quoteRevisions.id, [...tracked.revisions]));
    if (tracked.quotations.size) await db.delete(quotations).where(inArray(quotations.id, [...tracked.quotations]));
    if (tracked.deals.size) await db.delete(crmDeals).where(inArray(crmDeals.id, [...tracked.deals]));
    if (tracked.leads.size) await db.delete(quoteLeads).where(inArray(quoteLeads.id, [...tracked.leads]));
    if (tracked.clients.size) await db.delete(clients).where(inArray(clients.id, [...tracked.clients]));
    await db.delete(products).where(eq(products.sku, sku));
    await client.end();
  }
});
