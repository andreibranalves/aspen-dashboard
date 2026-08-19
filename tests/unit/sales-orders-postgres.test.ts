import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresSalesOrdersRepository,
  type CreateSalesOrderResult,
  type SalesOrderDetail,
  type SalesOrderListOptions,
  type SalesOrdersRepository,
} from '../../api/_infrastructure/db/repositories/sales-orders-repository.js';
import { createSalesOrderFromQuotationHandler } from '../../api/_modules/sales-order-from-quotation.js';
import { createSalesOrdersHandler } from '../../api/_modules/sales-orders.js';
import type { FunctionEvent } from '../../api/_http/types.js';

const TEST_DATABASE_URL = process.env.TEST_SALES_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const NOW = new Date('2098-08-10T12:00:00.000Z');

function isLocalDatabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

test('PostgreSQL integration guard accepts loopback URL forms only', () => {
  assert.equal(isLocalDatabaseUrl('postgres://localhost:5432/test'), true);
  assert.equal(isLocalDatabaseUrl('postgres://127.0.0.1:5432/test'), true);
  assert.equal(isLocalDatabaseUrl('postgres://[::1]:5432/test'), true);
  assert.equal(isLocalDatabaseUrl('postgres://database.example/test'), false);
  assert.equal(isLocalDatabaseUrl('mysql://localhost:5432/test'), false);
});

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

function orderDetail(overrides: Partial<SalesOrderDetail> = {}): SalesOrderDetail {
  return {
    id: 'PED-2098-0001',
    order_number: 'PED-2098-0001',
    internal_id: 'order-1',
    status: 'To Deliver and Bill',
    docstatus: 1,
    date: '2098-08-10',
    customer: 'client-1',
    customer_name: 'Cliente local',
    quotation_id: null,
    quotation_revision_id: null,
    grand_total: 123.45,
    rounded_total: 123.45,
    delivery_date: '2098-09-09',
    per_delivered: 0,
    per_billed: 0,
    source_quotation: 'ORC-20980001',
    items: [],
    ...overrides,
  };
}

function memoryRepository(): SalesOrdersRepository & {
  calls: { list?: Record<string, unknown>; get?: string; create?: string };
} {
  const calls: { list?: Record<string, unknown>; get?: string; create?: string } = {};
  const detail = orderDetail();
  return {
    calls,
    async list(options: SalesOrderListOptions = {}) {
      calls.list = options as Record<string, unknown>;
      return {
        success: true,
        items: [detail],
        page: options.page || 1,
        limit: options.limit || 25,
        total: 1,
        has_more: false,
      };
    },
    async get(id) {
      calls.get = id;
      return id === detail.id ? detail : null;
    },
    async createFromQuotation(quotationId) {
      calls.create = quotationId;
      return {
        success: true,
        id: detail.id,
        order_number: detail.id,
        internal_id: detail.internal_id,
        quotation_id: quotationId,
        quotation_revision_id: 'revision-1',
        status: detail.status,
        docstatus: detail.docstatus,
        alreadyExists: false,
        crmUpdated: true,
      } satisfies CreateSalesOrderResult;
    },
  } as unknown as SalesOrdersRepository & {
    calls: { list?: Record<string, unknown>; get?: string; create?: string };
  };
}

test('sales handlers use local repository contracts and preserve response fields', async () => {
  const repository = memoryRepository();
  const listHandler = createSalesOrdersHandler({ repository });
  const listResult = await listHandler(
    event('GET', undefined, {
      page: '2',
      limit: '10',
      status: 'Completed',
      from: '2098-08-01',
      to: '2098-08-31',
      search: 'CLIENTE',
    })
  );
  assert.equal(listResult.statusCode, 200);
  assert.deepEqual(JSON.parse(listResult.body || '{}'), {
    success: true,
    items: [orderDetail()],
    page: 2,
    limit: 10,
    total: 1,
    has_more: false,
  });
  assert.deepEqual(repository.calls.list, {
    page: 2,
    limit: 10,
    status: 'Completed',
    from: '2098-08-01',
    to: '2098-08-31',
    search: 'CLIENTE',
    period: undefined,
  });

  const detailResult = await listHandler(event('GET', undefined, { id: 'PED-2098-0001' }));
  assert.equal(detailResult.statusCode, 200);
  assert.deepEqual(JSON.parse(detailResult.body || '{}'), orderDetail());
  assert.equal(repository.calls.get, 'PED-2098-0001');

  const conversion = createSalesOrderFromQuotationHandler({ repository });
  const conversionResult = await conversion(event('POST', { quotation_id: 'ORC-20980001' }));
  assert.equal(conversionResult.statusCode, 200);
  assert.deepEqual(JSON.parse(conversionResult.body || '{}'), {
    success: true,
    quotation_id: 'ORC-20980001',
    sales_order_id: 'PED-2098-0001',
    sales_order_status: 'To Deliver and Bill',
    docstatus: 1,
    already_exists: false,
    crm_updated: true,
  });
  assert.equal(repository.calls.create, 'ORC-20980001');
});

test('sales handlers keep Portuguese validation and not-found contracts', async () => {
  const repository = memoryRepository();
  const listHandler = createSalesOrdersHandler({ repository });
  const methodNotAllowed = await listHandler(event('POST'));
  assert.equal(methodNotAllowed.statusCode, 405);
  assert.deepEqual(methodNotAllowed.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(methodNotAllowed.body || '{}'), {
    error: 'Método não permitido.',
  });
  const badStatus = await listHandler(event('GET', undefined, { status: 'NotAStatus' }));
  assert.equal(badStatus.statusCode, 400);
  assert.match(JSON.parse(badStatus.body || '{}').error, /Status inválido/);

  const conversion = createSalesOrderFromQuotationHandler({
    repository: {
      ...repository,
      async createFromQuotation() {
        const error = new Error('Orçamento não encontrado.') as Error & { statusCode: number };
        error.statusCode = 404;
        throw error;
      },
    },
  });
  const result = await conversion(event('POST', { quotation_id: 'ORC-404' }));
  assert.equal(result.statusCode, 404);
  assert.equal(JSON.parse(result.body || '{}').error, 'Orçamento não encontrado.');
});

test('sales order runtime contains no network or rollout dependency', () => {
  for (const relative of [
    'api/_infrastructure/db/repositories/sales-orders-repository.ts',
    'api/_modules/sales-orders.ts',
    'api/_modules/sales-order-from-quotation.ts',
  ]) {
    const source = readFileSync(path.resolve(relative), 'utf8');
    assert.doesNotMatch(source, /fetch\(|process\.env\./);
  }
});

test(
  'PostgreSQL conversion is idempotent, concurrent-safe, snapshots money, and closes the local deal',
  { skip: !isLocalDatabaseUrl(TEST_DATABASE_URL) },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 8,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const clientId = randomUUID();
    const quotationId = randomUUID();
    const secondQuotationId = randomUUID();
    const concurrentQuotationId = randomUUID();
    const revisionId = randomUUID();
    const latestRevisionId = randomUUID();
    const draftRevisionId = randomUUID();
    const secondRevisionId = randomUUID();
    const concurrentRevisionId = randomUUID();
    const itemId = randomUUID();
    const latestItemId = randomUUID();
    const dealId = randomUUID();
    const outsidePeriodOrderId = randomUUID();
    const fixtureTag = randomUUID().slice(0, 8);
    const sku = `SALES-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const businessNumber = `ORC-2098${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    const secondBusinessNumber = `ORC-2098${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    const concurrentBusinessNumber = `ORC-2098${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    const outsidePeriodOrderNumber = `PED-2098-${String(9000 + Math.floor(Math.random() * 1000))}`;
    const repository = createPostgresSalesOrdersRepository(() => db, { now: () => NOW });
    let migrated = false;
    let initialSequence: { year: number; lastNumber: number } | undefined;

    try {
      await migrate(db, { migrationsFolder });
      migrated = true;
      [initialSequence] = await db
        .select()
        .from(schema.salesOrderSequences)
        .where(eq(schema.salesOrderSequences.year, NOW.getUTCFullYear()));
      await db.insert(schema.clients).values({
        id: clientId,
        nome: `Cliente pedido local ${fixtureTag}`,
        email: 'sales-test@example.com',
        telefone: '5511999990000',
      });
      await db.insert(schema.products).values({
        sku,
        nome: 'Produto pedido original',
        descricao: 'Snapshot original',
        unidade: 'Cx',
        precoBase: '999.99',
        ativo: true,
      });
      await db.insert(schema.quotations).values({
        id: quotationId,
        businessNumber,
        clientId,
        status: 'aprovado',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.insert(schema.quoteRevisions).values([
        {
          id: revisionId,
          quotationId,
          version: 1,
          status: 'aprovado',
          validadeDias: 30,
          clienteNome: `Cliente pedido local ${fixtureTag}`,
          subtotal: '123.45',
          total: '130.00',
          createdAt: NOW,
        },
        {
          id: latestRevisionId,
          quotationId,
          version: 2,
          status: 'aprovado',
          validadeDias: 30,
          clienteNome: `Cliente pedido local ${fixtureTag}`,
          subtotal: '222.22',
          total: '230.00',
          createdAt: NOW,
        },
        {
          id: draftRevisionId,
          quotationId,
          version: 3,
          status: 'rascunho',
          validadeDias: 30,
          clienteNome: `Cliente pedido local ${fixtureTag}`,
          subtotal: '999.99',
          total: '999.99',
          createdAt: NOW,
        },
      ]);
      await db.insert(schema.quoteRevisionItems).values([
        {
          id: itemId,
          revisionId,
          position: 0,
          productSku: sku,
          quantidade: '2.500',
          produtoSku: sku,
          produtoNome: 'Produto snapshot na revisão anterior',
          produtoDescricao: 'Descrição snapshot na revisão anterior',
          produtoUnidade: 'Cx',
          precoFonte: 'base',
          precoSugerido: '50.00',
          precoAplicado: '49.38',
          diferencaPreco: '-0.62',
          totalLinha: '123.45',
          manualRate: true,
        },
        {
          id: latestItemId,
          revisionId: latestRevisionId,
          position: 0,
          productSku: sku,
          quantidade: '3.500',
          produtoSku: sku,
          produtoNome: 'Produto snapshot na revisão mais recente',
          produtoDescricao: 'Descrição snapshot na revisão mais recente',
          produtoUnidade: 'Cx',
          precoFonte: 'base',
          precoSugerido: '70.00',
          precoAplicado: '63.49',
          diferencaPreco: '-6.51',
          totalLinha: '222.22',
          manualRate: true,
        },
      ]);
      await db.insert(schema.crmDeals).values({
        id: dealId,
        clientId,
        quotationId,
        nome: `Cliente pedido local ${fixtureTag}`,
        status: 'Em Negociacao',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.insert(schema.quotations).values({
        id: secondQuotationId,
        businessNumber: secondBusinessNumber,
        clientId,
        status: 'aprovado',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.insert(schema.quoteRevisions).values({
        id: secondRevisionId,
        quotationId: secondQuotationId,
        version: 1,
        status: 'aprovado',
        validadeDias: 30,
        clienteNome: `Cliente pedido local ${fixtureTag}`,
        subtotal: '10.00',
        total: '10.00',
        createdAt: NOW,
      });
      await db.insert(schema.quotations).values({
        id: concurrentQuotationId,
        businessNumber: concurrentBusinessNumber,
        clientId,
        status: 'aprovado',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.insert(schema.quoteRevisions).values({
        id: concurrentRevisionId,
        quotationId: concurrentQuotationId,
        version: 1,
        status: 'aprovado',
        validadeDias: 30,
        clienteNome: `Cliente pedido local ${fixtureTag}`,
        subtotal: '20.00',
        total: '20.00',
        createdAt: NOW,
      });
      await db.insert(schema.salesOrders).values({
        id: outsidePeriodOrderId,
        orderNumber: outsidePeriodOrderNumber,
        clientId,
        status: 'To Deliver and Bill',
        transactionDate: '2098-08-09',
        subtotal: '5.00',
        grandTotal: '5.00',
      });

      const failingRepository = createPostgresSalesOrdersRepository(() => db, {
        now: () => NOW,
        idFactory: () => {
          throw new Error('falha simulada após reserva');
        },
      });
      await assert.rejects(
        () => failingRepository.createFromQuotation(quotationId),
        /acessar os pedidos locais/
      );
      const [rolledBackSequence] = await db
        .select()
        .from(schema.salesOrderSequences)
        .where(eq(schema.salesOrderSequences.year, NOW.getUTCFullYear()));
      assert.deepEqual(rolledBackSequence, initialSequence);

      const sameQuotation = await Promise.all([
        repository.createFromQuotation(concurrentQuotationId),
        repository.createFromQuotation(concurrentQuotationId),
      ]);
      assert.equal(sameQuotation.filter((result) => result.alreadyExists === false).length, 1);
      assert.equal(sameQuotation.filter((result) => result.alreadyExists === true).length, 1);
      assert.equal(new Set(sameQuotation.map((result) => result.id)).size, 1);
      assert.equal(new Set(sameQuotation.map((result) => result.order_number)).size, 1);
      assert.equal(new Set(sameQuotation.map((result) => result.internal_id)).size, 1);
      const materializedSameQuotation = await db
        .select({ id: schema.salesOrders.id, status: schema.salesOrders.status })
        .from(schema.salesOrders)
        .where(eq(schema.salesOrders.quotationId, concurrentQuotationId));
      assert.equal(materializedSameQuotation.length, 1);
      assert.notEqual(materializedSameQuotation[0]?.status, 'Cancelled');
      assert.equal(materializedSameQuotation[0]?.id, sameQuotation[0]?.internal_id);

      const [first, second] = await Promise.all([
        repository.createFromQuotation(quotationId),
        repository.createFromQuotation(secondQuotationId),
      ]);
      assert.equal(first.alreadyExists, false);
      assert.equal(second.alreadyExists, false);
      assert.notEqual(first.id, second.id);
      assert.notEqual(first.order_number, second.order_number);
      assert.equal(new Set([first.order_number, second.order_number]).size, 2);

      const duplicate = await repository.createFromQuotation(quotationId);
      assert.equal(duplicate.alreadyExists, true);
      assert.equal(duplicate.id, first.id);
      assert.equal(duplicate.order_number, first.order_number);
      assert.match(first.id, /^PED-2098-\d{4}$/);
      assert.match(second.id, /^PED-2098-\d{4}$/);
      const activityRows = await db
        .select()
        .from(schema.productActivityEvents)
        .where(eq(schema.productActivityEvents.productSku, sku));
      assert.equal(activityRows.filter((row) => row.tipo === 'pedido').length, 1);

      const [storedOrder] = await db
        .select()
        .from(schema.salesOrders)
        .where(eq(schema.salesOrders.id, first.internal_id));
      assert.equal(storedOrder?.quotationRevisionId, latestRevisionId);
      assert.equal(storedOrder?.subtotal, '222.22');
      assert.equal(storedOrder?.grandTotal, '230.00');
      assert.equal(storedOrder?.status, 'To Deliver and Bill');
      assert.equal(first.quotation_revision_id, latestRevisionId);
      const items = await db
        .select()
        .from(schema.salesOrderItems)
        .where(eq(schema.salesOrderItems.salesOrderId, first.internal_id));
      assert.equal(items.length, 1);
      assert.equal(items[0]?.quantity, '3.500');
      assert.equal(items[0]?.unitPrice, '63.49');
      assert.equal(items[0]?.lineTotal, '222.22');

      const [latestRevision] = await db
        .select({
          orderLinkage: schema.quoteRevisions.orderLinkage,
          orderPending: schema.quoteRevisions.orderPending,
        })
        .from(schema.quoteRevisions)
        .where(eq(schema.quoteRevisions.id, latestRevisionId));
      assert.equal(latestRevision?.orderLinkage, 'ordered');
      assert.equal(latestRevision?.orderPending, false);
      const [previousRevision] = await db
        .select({
          orderLinkage: schema.quoteRevisions.orderLinkage,
          orderPending: schema.quoteRevisions.orderPending,
        })
        .from(schema.quoteRevisions)
        .where(eq(schema.quoteRevisions.id, revisionId));
      assert.equal(previousRevision?.orderLinkage, null);
      assert.equal(previousRevision?.orderPending, false);

      await db
        .update(schema.products)
        .set({ nome: 'Produto catálogo alterado' })
        .where(eq(schema.products.sku, sku));
      const detail = await repository.get(first.id);
      assert.equal(detail?.items[0]?.item_name, 'Produto snapshot na revisão mais recente');
      assert.equal(detail?.items[0]?.rate, 63.49);
      const [deal] = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.id, dealId));
      assert.equal(deal?.status, 'Pedido Fechado');
      assert.equal(await repository.itemCount(first.id), 1);

      const expectedOrderNumbers = [
        first.order_number,
        second.order_number,
        sameQuotation[0]!.order_number,
      ].sort();
      const defaultPeriod = await repository.list({ search: fixtureTag, limit: 100 });
      assert.equal(defaultPeriod.total, 3);
      assert.deepEqual(defaultPeriod.items.map((item) => item.id).sort(), expectedOrderNumbers);
      assert.equal(
        defaultPeriod.items.some((item) => item.id === outsidePeriodOrderNumber),
        false
      );
      const unknownPeriod = await repository.list({
        period: 'unsupported',
        search: fixtureTag,
        limit: 100,
      });
      assert.equal(unknownPeriod.total, 3);
      assert.deepEqual(unknownPeriod.items.map((item) => item.id).sort(), expectedOrderNumbers);
      assert.equal(
        unknownPeriod.items.some((item) => item.id === outsidePeriodOrderNumber),
        false
      );
    } finally {
      if (migrated) {
        const orders = await db
          .select({ id: schema.salesOrders.id })
          .from(schema.salesOrders)
          .where(
            inArray(schema.salesOrders.quotationId, [
              quotationId,
              secondQuotationId,
              concurrentQuotationId,
            ])
          );
        await db
          .delete(schema.salesOrders)
          .where(
            inArray(schema.salesOrders.id, [...orders.map((row) => row.id), outsidePeriodOrderId])
          );
        await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, dealId));
        await db
          .delete(schema.quotations)
          .where(
            inArray(schema.quotations.id, [quotationId, secondQuotationId, concurrentQuotationId])
          );
        await db.delete(schema.clients).where(eq(schema.clients.id, clientId));
        await db.delete(schema.productActivityEvents).where(eq(schema.productActivityEvents.productSku, sku));
        await db.delete(schema.products).where(eq(schema.products.sku, sku));
        if (initialSequence) {
          await db
            .insert(schema.salesOrderSequences)
            .values(initialSequence)
            .onConflictDoUpdate({
              target: schema.salesOrderSequences.year,
              set: { lastNumber: initialSequence.lastNumber },
            });
        } else {
          await db
            .delete(schema.salesOrderSequences)
            .where(eq(schema.salesOrderSequences.year, NOW.getUTCFullYear()));
        }
      }
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'PostgreSQL list supports pagination, status/date filters, and case-insensitive search',
  { skip: !isLocalDatabaseUrl(TEST_DATABASE_URL) },
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
    const clientId = randomUUID();
    const quotationId = randomUUID();
    const orderIds = [randomUUID(), randomUUID()];
    const sku = `LIST-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    try {
      await migrate(db, { migrationsFolder });
      await db.insert(schema.clients).values({ id: clientId, nome: 'Busca Case Cliente' });
      await db.insert(schema.products).values({ sku, nome: 'Lista', unidade: 'Und' });
      await db.insert(schema.quotations).values({
        id: quotationId,
        businessNumber: `ORC-2098${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
        clientId,
        status: 'aprovado',
      });
      await db.insert(schema.salesOrders).values([
        {
          id: orderIds[0]!,
          orderNumber: 'PED-2098-9001',
          quotationId,
          clientId,
          status: 'To Deliver and Bill',
          transactionDate: '2098-08-10',
          subtotal: '10.00',
          grandTotal: '10.00',
        },
        {
          id: orderIds[1]!,
          orderNumber: 'PED-2098-9002',
          quotationId: null,
          clientId,
          status: 'Cancelled',
          transactionDate: '2098-07-01',
          subtotal: '20.00',
          grandTotal: '20.00',
        },
      ]);
      const result = await repository.list({
        page: 1,
        limit: 1,
        from: '2098-08-01',
        to: '2098-08-31',
        search: 'CASE CLIENTE',
      });
      assert.equal(result.total, 1);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.id, 'PED-2098-9001');
      assert.equal(result.has_more, false);
      const cancelled = await repository.list({
        status: 'Cancelled',
        from: '2098-01-01',
        to: '2098-12-31',
      });
      assert.equal(cancelled.total, 1);
      assert.equal(cancelled.items[0]?.id, 'PED-2098-9002');
    } finally {
      await db.delete(schema.salesOrders).where(inArray(schema.salesOrders.id, orderIds));
      await db.delete(schema.quotations).where(eq(schema.quotations.id, quotationId));
      await db.delete(schema.clients).where(eq(schema.clients.id, clientId));
      await db.delete(schema.productActivityEvents).where(eq(schema.productActivityEvents.productSku, sku));
      await db.delete(schema.products).where(eq(schema.products.sku, sku));
      await client.end({ timeout: 5 });
    }
  }
);
