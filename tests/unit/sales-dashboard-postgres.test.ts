import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  ensureFixtureTemplateVersion,
  type FixtureRevisionFields,
} from '../fixtures/quotation-revision-seeds.ts';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import {
  createPostgresSalesOrdersRepository,
  type SalesOrdersRepository,
} from '../../api/_infrastructure/db/repositories/sales-orders-repository.js';
import { createSalesDashboardHandler } from '../../api/_modules/sales-dashboard.js';
import type { FunctionEvent } from '../../api/_http/types.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import { DEFAULT_SETTINGS } from '../../api/_infrastructure/db/repositories/settings-repository.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env, ['TEST_SALES_DATABASE_URL', 'TEST_DATABASE_URL']);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const NOW = new Date('2098-08-10T12:00:00.000Z');

const profitDependencies = {
  settings: { get: async () => ({ ...DEFAULT_SETTINGS }) },
  adsSpend: {
    get: async (yearMonth: string) => ({ year_month: yearMonth, meta_spend: '0.00' }),
    upsert: async (yearMonth: string, metaSpend: string) => ({
      year_month: yearMonth,
      meta_spend: metaSpend,
    }),
  },
  googleAds: {
    fetchSpend: async () => ({ amount: 0, available: false }),
  },
};

function profitOverlay(
  faturamento: number,
  { custo = 0, metaEditable = false }: { custo?: number; metaEditable?: boolean } = {}
) {
  const imposto = Math.round((faturamento * 4) / 100 * 100) / 100;
  return {
    faturamento,
    custo,
    ads: 0,
    ads_google: 0,
    ads_meta: 0,
    imposto,
    lucro: Math.round((faturamento - custo - imposto) * 100) / 100,
    ads_google_unavailable: true,
    meta_editable: metaEditable,
  };
}


function event(
  httpMethod: string,
  body?: unknown,
  queryStringParameters: Record<string, string> = {}
): FunctionEvent {
  return {
    httpMethod,
    headers: {},
    body: body === undefined ? '' : JSON.stringify(body),
    queryStringParameters,
  };
}

async function resetSharedCommerce(db: AppDatabase) {
  await db.update(schema.quoteLeads).set({ crmDealId: null, quotationId: null });
  await db.delete(schema.quotationFollowUps);
  await db.delete(schema.opportunityDeliveryAnchors);
  await db.delete(schema.manualContactEvents);
  await db.delete(schema.opportunityNextActions);
  await db.delete(schema.crmDeals);
  await db.delete(schema.quoteLeads);
  await db.delete(schema.quotationIssueRequests);
  await db.delete(schema.quotationDeliveries);
  await db.delete(schema.salesOrders);
  await db.delete(schema.quotations);
}

test(
  'returns a zero-valued dashboard when no local orders exist',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 2,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const repository = createPostgresSalesOrdersRepository(() => db, { now: () => NOW });

    try {
      await migrate(db, { migrationsFolder });
      await resetSharedCommerce(db);
      const fixtureFields: FixtureRevisionFields = await ensureFixtureTemplateVersion(db as any);
      const handler = createSalesDashboardHandler({ repository, ...profitDependencies });
      const response = await handler(event('GET', undefined, { period: '30d' }));
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body || '{}');
      assert.deepEqual(body.summary, {
        total_revenue: 0,
        custo: 0,
        orders_count: 0,
        avg_ticket: 0,
        open_orders: 0,
        conversion_rate: 0,
        revenue_delta: 0,
        orders_delta: 0,
        avg_ticket_delta: 0,
        conversion_delta: 0,
        ...profitOverlay(0, { metaEditable: false }),
      });
      assert.deepEqual(body.top_products, []);
      assert.deepEqual(body.top_customers, []);
      assert.deepEqual(body.sales_by_day, []);
      assert.equal('stale_quotations' in body, false);
    } finally {
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'aggregates local orders and quotes with inclusive period boundaries',
  { skip: !TEST_DATABASE_URL },
  async () => {
    let queryCount = 0;
    const client = postgres(TEST_DATABASE_URL!, {
      max: 4,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
      debug: (_connection, query) => {
        if (!query.trim().startsWith('select b.oid')) queryCount += 1;
      },
    });
    const db = drizzle(client, { schema });
    const repository = createPostgresSalesOrdersRepository(() => db, { now: () => NOW });
    const handler = createSalesDashboardHandler({ repository, ...profitDependencies });
    const clientIds = [randomUUID(), randomUUID()];
    const quotationIds = [randomUUID(), randomUUID(), randomUUID()];
    const revisionIds = [randomUUID(), randomUUID(), randomUUID()];
    const fixtureTag = randomUUID().slice(0, 8);
    const extraProductSkus = Array.from(
      { length: 12 },
      (_, index) => `DASH-${fixtureTag}-EX${String(index).padStart(2, '0')}`
    );
    const productSkus = [`DASH-${fixtureTag}-A`, `DASH-${fixtureTag}-B`, ...extraProductSkus];
    const orderIds = [randomUUID(), randomUUID(), randomUUID()];
    const itemIds = [randomUUID(), randomUUID(), randomUUID()];
    const extraOrderIds = Array.from({ length: extraProductSkus.length }, () => randomUUID());
    const extraItemIds = Array.from({ length: extraProductSkus.length }, () => randomUUID());
    const allOrderIds = [...orderIds, ...extraOrderIds];
    const allItemIds = [...itemIds, ...extraItemIds];
    let migrated = false;

    try {
      await migrate(db, { migrationsFolder });
      const fixtureFields: FixtureRevisionFields = await ensureFixtureTemplateVersion(db as any);
      migrated = true;
      await resetSharedCommerce(db);
      await db.insert(schema.clients).values([
        { id: clientIds[0]!, nome: 'Cliente Dashboard A' },
        { id: clientIds[1]!, nome: 'Cliente Dashboard B' },
      ]);
      await db.insert(schema.products).values([
        { sku: productSkus[0]!, nome: 'Produto Dashboard A', unidade: 'Und' },
        { sku: productSkus[1]!, nome: 'Produto Dashboard B', unidade: 'Und' },
        ...extraProductSkus.map((sku, index) => ({
          sku,
          nome: `Produto Dashboard Extra ${index}`,
          unidade: 'Und',
        })),
      ]);
      await db.insert(schema.quotations).values([
        {
          id: quotationIds[0]!,
          businessNumber: 'ORC-20980001',
          clientId: clientIds[0]!,
          status: 'emitido',
          createdAt: new Date('2098-08-01T12:00:00.000Z'),
          updatedAt: NOW,
        },
        {
          id: quotationIds[1]!,
          businessNumber: 'ORC-20980002',
          clientId: clientIds[1]!,
          status: 'emitido',
          createdAt: new Date('2098-08-05T12:00:00.000Z'),
          updatedAt: NOW,
        },
        {
          id: quotationIds[2]!,
          businessNumber: 'ORC-20980003',
          clientId: clientIds[1]!,
          status: 'emitido',
          createdAt: new Date('2098-08-01T12:00:00.000Z'),
          updatedAt: NOW,
        },
      ]);
      await db.insert(schema.quoteRevisions).values([
        {
          ...fixtureFields,
          id: revisionIds[0]!,
          quotationId: quotationIds[0]!,
          version: 1,
          status: 'emitido',
          validadeDias: 30,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Cliente Dashboard A',
          subtotal: '100.00',
          total: '100.00',
          createdAt: new Date('2098-08-01T12:00:00.000Z'),
        },
        {
          ...fixtureFields,
          id: revisionIds[1]!,
          quotationId: quotationIds[1]!,
          version: 1,
          status: 'emitido',
          validadeDias: 30,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Cliente Dashboard B',
          subtotal: '50.00',
          total: '50.00',
          createdAt: new Date('2098-08-05T12:00:00.000Z'),
        },
        {
          ...fixtureFields,
          id: revisionIds[2]!,
          quotationId: quotationIds[2]!,
          version: 1,
          status: 'emitido',
          validadeDias: 30,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Cliente Dashboard B',
          subtotal: '75.00',
          total: '75.00',
          createdAt: new Date('2098-08-01T12:00:00.000Z'),
        },
      ]);
      await db.insert(schema.salesOrders).values([
        {
          id: orderIds[0]!,
          orderNumber: 'PED-2098-9101',
          quotationId: quotationIds[0]!,
          quotationRevisionId: revisionIds[0]!,
          clientId: clientIds[0]!,
          status: 'To Deliver and Bill',
          transactionDate: '2098-08-01',
          subtotal: '100.00',
          grandTotal: '100.00',
        },
        {
          id: orderIds[1]!,
          orderNumber: 'PED-2098-9102',
          clientId: clientIds[1]!,
          status: 'Completed',
          transactionDate: '2098-08-10',
          subtotal: '61.70',
          grandTotal: '61.70',
        },
        {
          id: orderIds[2]!,
          orderNumber: 'PED-2098-9103',
          clientId: clientIds[1]!,
          status: 'To Deliver and Bill',
          transactionDate: '2098-07-31',
          subtotal: '40.00',
          grandTotal: '40.00',
        },
        ...extraOrderIds.map((id, index) => ({
          id,
          orderNumber: `PED-2098-${String(9200 + index)}`,
          clientId: clientIds[1]!,
          status: 'Completed' as const,
          transactionDate: '2098-08-10',
          subtotal: '0.00',
          grandTotal: '0.00',
        })),
      ]);
      await db.insert(schema.salesOrderItems).values([
        {
          id: itemIds[0]!,
          salesOrderId: orderIds[0]!,
          position: 0,
          productSku: productSkus[0]!,
          productName: 'Produto Dashboard A',
          unit: 'Und',
          quantity: '2.000',
          unitPrice: '50.00',
          lineTotal: '100.00',
        },
        {
          id: itemIds[1]!,
          salesOrderId: orderIds[1]!,
          position: 0,
          productSku: productSkus[1]!,
          productName: 'Produto Dashboard B',
          unit: 'Und',
          quantity: '1.234',
          unitPrice: '50.00',
          lineTotal: '61.70',
        },
        ...extraItemIds.map((id, index) => ({
          id,
          salesOrderId: extraOrderIds[index]!,
          position: 0,
          productSku: extraProductSkus[index]!,
          productName: `Produto Dashboard Extra ${index}`,
          unit: 'Und',
          quantity: '0.001',
          unitPrice: '0.00',
          lineTotal: '0.00',
        })),
      ]);

      queryCount = 0;
      const response = await handler(
        event('GET', undefined, { from: '2098-08-01', to: '2098-08-10' })
      );
      assert.equal(response.statusCode, 200);
      assert.equal(queryCount, 9, `dashboard used ${queryCount} SQL queries`);
      const body = JSON.parse(response.body || '{}');
      assert.deepEqual(body.period, {
        label: 'De 01/08/2098 a 10/08/2098',
        from: '2098-08-01',
        to: '2098-08-10',
      });
      assert.deepEqual(body.summary, {
        total_revenue: 161.7,
        custo: 0,
        orders_count: 14,
        avg_ticket: 11.55,
        open_orders: 1,
        conversion_rate: 0.33,
        revenue_delta: 304.25,
        orders_delta: 1300,
        avg_ticket_delta: -71.12,
        conversion_delta: 100,
        ...profitOverlay(161.7, { metaEditable: false }),
      });
      assert.deepEqual(body.top_products, [
        {
          sku: productSkus[0],
          product: 'Produto Dashboard A',
          quantity: 2,
          revenue: 100,
          custo: 0,
          margem: 1,
          orders: 1,
        },
        {
          sku: productSkus[1],
          product: 'Produto Dashboard B',
          quantity: 1.234,
          revenue: 61.7,
          custo: 0,
          margem: 1,
          orders: 1,
        },
        ...extraProductSkus.slice(0, 8).map((sku, index) => ({
          sku,
          product: `Produto Dashboard Extra ${index}`,
          quantity: 0.001,
          revenue: 0,
          custo: 0,
          margem: 0,
          orders: 1,
        })),
      ]);
      assert.deepEqual(body.top_customers, [
        { name: 'Cliente Dashboard A', revenue: 100, orders: 1 },
        { name: 'Cliente Dashboard B', revenue: 61.7, orders: 13 },
      ]);
      assert.deepEqual(body.sales_by_day, [
        { date: '2098-08-01', revenue: 100, orders: 1 },
        { date: '2098-08-10', revenue: 61.7, orders: 13 },
      ]);
      assert.equal('stale_quotations' in body, false);
    } finally {
      if (migrated) {
        await db
          .delete(schema.salesOrderItems)
          .where(inArray(schema.salesOrderItems.id, allItemIds));
        await db.delete(schema.salesOrders).where(inArray(schema.salesOrders.id, allOrderIds));
        await db
          .delete(schema.quoteRevisions)
          .where(inArray(schema.quoteRevisions.id, revisionIds));
        await db.delete(schema.quotations).where(inArray(schema.quotations.id, quotationIds));
        await db.delete(schema.clients).where(inArray(schema.clients.id, clientIds));
        await db.delete(schema.products).where(inArray(schema.products.sku, productSkus));
      }
      await client.end({ timeout: 5 });
    }
  }
);

test('sales dashboard handler does not call external fetch', async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('external fetch is not allowed');
  }) as typeof fetch;
  try {
    const handler = createSalesDashboardHandler({
      ...profitDependencies,
      repository: {
        async dashboard() {
          return {
            success: true,
            period: { label: 'Hoje', from: '2098-08-10', to: '2098-08-10' },
            summary: {
              total_revenue: 0,
              orders_count: 0,
              avg_ticket: 0,
              open_orders: 0,
              conversion_rate: 0,
              revenue_delta: 0,
              orders_delta: 0,
              avg_ticket_delta: 0,
              conversion_delta: 0,
            },
            top_products: [],
            top_customers: [],
            sales_by_day: [],
          };
        },
      },
    });
    const response = await handler(event('GET'));
    assert.equal(response.statusCode, 200);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('PUT rejects Meta spend outside Este mês and Mês passado', async () => {
  const handler = createSalesDashboardHandler({
    ...profitDependencies,
    repository: {
      async dashboard() {
        return {
          success: true,
          period: { label: 'Últimos 30 dias', from: '2098-07-12', to: '2098-08-10' },
          summary: {
            total_revenue: 0,
            custo: 0,
            orders_count: 0,
            avg_ticket: 0,
            open_orders: 0,
            conversion_rate: 0,
          },
          top_products: [],
          top_customers: [],
          sales_by_day: [],
        };
      },
    },
  });
  const response = await handler(event('PUT', { period: '30d', meta_spend: '10.00' }));
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body || '{}').error, /Este mês ou Mês passado/);
});

test('sales dashboard runtime has no network or rollout dependency', () => {
  const source = readFileSync(path.resolve('api/_modules/sales-dashboard.ts'), 'utf8');
  assert.doesNotMatch(source, /fetch\(|process\.env\./);
});

// Keep the repository type in this test so a future dashboard implementation
// cannot accidentally bypass the local sales-order contract.
const _repositoryTypeCheck: SalesOrdersRepository | undefined = undefined;
void _repositoryTypeCheck;
