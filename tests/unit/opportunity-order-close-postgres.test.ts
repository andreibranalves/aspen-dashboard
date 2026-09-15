import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import { createPostgresSalesOrdersRepository } from '../../api/_infrastructure/db/repositories/sales-orders-repository.js';
import { createPostgresOpportunityActionRepository } from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import {
  ensureFixtureTemplateVersion,
  type FixtureRevisionFields,
} from '../fixtures/quotation-revision-seeds.ts';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env, [
  'TEST_SALES_DATABASE_URL',
  'TEST_DATABASE_URL',
]);
const databaseSkip = TEST_DATABASE_URL
  ? false
  : 'Set TEST_DATABASE_URL (or TEST_SALES_DATABASE_URL) to a disposable Postgres instance.';
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);
const NOW = new Date('2098-08-10T12:00:00.000Z');

test(
  'pedido comercial efetivo encerra oportunidade e ação; lead/proposta/rascunho não',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, { max: 1 });
    const db = drizzle(client, { schema });
    const tag = randomUUID().slice(0, 8);
    const clientId = randomUUID();
    const closedDealId = randomUUID();
    const siblingDealId = randomUUID();
    const quotationId = randomUUID();
    const draftQuotationId = randomUUID();
    const revisionId = randomUUID();
    const draftRevisionId = randomUUID();
    const itemId = randomUUID();
    const sku = `SKU-CLOSE-${tag}`;
    const businessNumber = `ORC-${String(Date.now()).slice(-8)}`;
    const draftBusinessNumber = `ORC-${String(Date.now() + 1).slice(-8)}`;

    try {
      await migrate(db, { migrationsFolder });
      const fixtureFields: FixtureRevisionFields = await ensureFixtureTemplateVersion(db as any);

      await db.insert(schema.clients).values({
        id: clientId,
        nome: `Cliente pedido ${tag}`,
        email: `close-${tag}@example.com`,
        telefone: '5511988776655',
      });
      await db.insert(schema.products).values({
        sku,
        nome: 'Produto fechamento',
        descricao: 'Produto',
        unidade: 'un',
        precoBase: '100.00',
        ativo: true,
      });
      await db.insert(schema.crmDeals).values([
        {
          id: closedDealId,
          clientId,
          nome: `Demanda com pedido ${tag}`,
          status: 'Em Negociacao',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: siblingDealId,
          clientId,
          nome: `Outra demanda ${tag}`,
          status: 'Novo Lead',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      await db.insert(schema.quotations).values([
        {
          id: quotationId,
          businessNumber,
          clientId,
          opportunityId: closedDealId,
          status: 'aprovado',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: draftQuotationId,
          businessNumber: draftBusinessNumber,
          clientId,
          opportunityId: siblingDealId,
          status: 'rascunho',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      await db
        .update(schema.crmDeals)
        .set({ quotationId })
        .where(eq(schema.crmDeals.id, closedDealId));

      await db.insert(schema.quoteRevisions).values([
        {
          ...fixtureFields,
          id: revisionId,
          quotationId,
          version: 1,
          status: 'aprovado',
          validadeDias: 30,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: `Cliente pedido ${tag}`,
          subtotal: '100.00',
          total: '100.00',
          createdAt: NOW,
        },
        {
          ...fixtureFields,
          id: draftRevisionId,
          quotationId: draftQuotationId,
          version: 1,
          status: 'rascunho',
          validadeDias: 30,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: `Cliente pedido ${tag}`,
          subtotal: '50.00',
          total: '50.00',
          createdAt: NOW,
        },
      ]);
      await db.insert(schema.quoteRevisionItems).values({
        id: itemId,
        revisionId,
        position: 0,
        productSku: sku,
        quantidade: '1.000',
        produtoSku: sku,
        produtoNome: 'Produto fechamento',
        produtoDescricao: 'Produto',
        produtoUnidade: 'un',
        precoFonte: 'base',
        precoSugerido: '100.00',
        precoAplicado: '100.00',
        diferencaPreco: '0.00',
        totalLinha: '100.00',
        manualRate: false,
      });

      const actions = createPostgresOpportunityActionRepository(() => db, {
        now: () => NOW,
      });
      const sales = createPostgresSalesOrdersRepository(() => db, { now: () => NOW });

      const primary = await actions.createAction({
        opportunityId: closedDealId,
        kind: 'customer_contact',
        dueDate: '2098-08-11',
        dueTime: null,
        reason: 'Acompanhar proposta',
        actor: 'operator-a',
      });
      const sibling = await actions.createAction({
        opportunityId: siblingDealId,
        kind: 'first_contact',
        dueDate: '2098-08-12',
        dueTime: null,
        reason: 'Primeiro contato',
        actor: 'operator-a',
      });

      // Lead / proposta / rascunho: opportunity stays open with active action.
      assert.equal(
        (
          await db
            .select({ status: schema.crmDeals.status })
            .from(schema.crmDeals)
            .where(eq(schema.crmDeals.id, siblingDealId))
        )[0]?.status,
        'Novo Lead',
      );
      assert.equal(
        (
          await db
            .select({ status: schema.quotations.status })
            .from(schema.quotations)
            .where(eq(schema.quotations.id, draftQuotationId))
        )[0]?.status,
        'rascunho',
      );
      await assert.rejects(() => sales.createFromQuotation(draftQuotationId), /não pode|rascunho|aprovado/i);
      await db.insert(schema.salesOrders).values({
        id: randomUUID(),
        orderNumber: 'PED-2098-9999',
        quotationId: draftQuotationId,
        quotationRevisionId: draftRevisionId,
        clientId,
        status: 'Draft',
        transactionDate: '2098-08-10',
        subtotal: '50.00',
        grandTotal: '50.00',
        createdAt: NOW,
        updatedAt: NOW,
      });
      const existingDraft = await sales.createFromQuotation(draftQuotationId);
      assert.equal(existingDraft.alreadyExists, true);
      assert.equal(existingDraft.crmUpdated, false);
      const [stillOpenDraft] = await db
        .select({ status: schema.crmDeals.status })
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.id, siblingDealId));
      assert.equal(stillOpenDraft?.status, 'Novo Lead');
      const [stillActivePrimary] = await db
        .select({ state: schema.opportunityNextActions.state })
        .from(schema.opportunityNextActions)
        .where(eq(schema.opportunityNextActions.id, primary.actionId));
      assert.equal(stillActivePrimary?.state, 'active');

      const created = await sales.createFromQuotation(quotationId);
      assert.equal(created.alreadyExists, false);
      assert.equal(created.crmUpdated, true);

      const [closedDeal] = await db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.id, closedDealId));
      assert.equal(closedDeal?.status, 'Pedido Fechado');

      const [completedAction] = await db
        .select()
        .from(schema.opportunityNextActions)
        .where(eq(schema.opportunityNextActions.id, primary.actionId));
      assert.equal(completedAction?.state, 'completed');
      assert.equal(completedAction?.transitionReason, 'Pedido comercial vinculado');

      const [siblingDeal] = await db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.id, siblingDealId));
      assert.equal(siblingDeal?.status, 'Novo Lead');
      const [siblingAction] = await db
        .select()
        .from(schema.opportunityNextActions)
        .where(eq(schema.opportunityNextActions.id, sibling.actionId));
      assert.equal(siblingAction?.state, 'active');

      const active = await actions.listActive();
      assert.equal(active.data.some((row) => row.opportunityId === closedDealId), false);
      assert.equal(active.data.some((row) => row.opportunityId === siblingDealId), true);

      // Repeated order event is idempotent: no second active action, terminal unchanged.
      const again = await sales.createFromQuotation(quotationId);
      assert.equal(again.alreadyExists, true);
      const [stillClosed] = await db
        .select({ status: schema.crmDeals.status })
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.id, closedDealId));
      assert.equal(stillClosed?.status, 'Pedido Fechado');
      const completedRows = await db
        .select()
        .from(schema.opportunityNextActions)
        .where(eq(schema.opportunityNextActions.opportunityId, closedDealId));
      assert.equal(completedRows.filter((row) => row.state === 'active').length, 0);
      assert.equal(completedRows.filter((row) => row.state === 'completed').length, 1);
    } finally {
      // Children of quotations don't all cascade and crm_deals keeps a
      // restrict foreign key, so leaving fixtures behind breaks the
      // delete-based cleanup of every later DB-gated suite.
      await db.delete(schema.salesOrders).where(eq(schema.salesOrders.quotationId, draftQuotationId));
      await db.delete(schema.salesOrders).where(eq(schema.salesOrders.quotationId, quotationId));
      await db
        .delete(schema.opportunityNextActions)
        .where(eq(schema.opportunityNextActions.opportunityId, closedDealId));
      await db
        .delete(schema.opportunityNextActions)
        .where(eq(schema.opportunityNextActions.opportunityId, siblingDealId));
      await db.delete(schema.quoteRevisionItems).where(eq(schema.quoteRevisionItems.revisionId, itemId));
      await db
        .delete(schema.salesOrderItems)
        .where(eq(schema.salesOrderItems.productSku, sku));
      await db
        .delete(schema.productActivityEvents)
        .where(eq(schema.productActivityEvents.productSku, sku));
      await db
        .delete(schema.productPricingTiers)
        .where(eq(schema.productPricingTiers.productSku, sku));
      await db.delete(schema.quoteRevisions).where(eq(schema.quoteRevisions.quotationId, draftQuotationId));
      await db.delete(schema.quoteRevisions).where(eq(schema.quoteRevisions.quotationId, quotationId));
      await db.update(schema.crmDeals).set({ quotationId: null }).where(eq(schema.crmDeals.id, closedDealId));
      await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, siblingDealId));
      await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, closedDealId));
      await db.delete(schema.quotations).where(eq(schema.quotations.id, draftQuotationId));
      await db.delete(schema.quotations).where(eq(schema.quotations.id, quotationId));
      await db.delete(schema.products).where(eq(schema.products.sku, sku));
      await db.delete(schema.clients).where(eq(schema.clients.id, clientId));
      await client.end({ timeout: 5 });
    }
  },
);
