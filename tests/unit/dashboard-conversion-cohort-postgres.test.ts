import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import { clients, quotations, salesOrders } from '../../api/_infrastructure/db/schema.js';
import { createPostgresSalesOrdersRepository } from '../../api/_infrastructure/db/repositories/sales-orders-repository.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';
import { clearCommercialFixtures } from '../support/commercial-fixtures.ts';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const databaseSkip = 'TEST_DATABASE_URL is required for PostgreSQL-backed dashboard tests.';

let sqlClient: Sql | undefined;
let db: PostgresJsDatabase<typeof schema>;

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
});

test.after(async () => {
  // Leave no fixture behind: later files in the lane delete `quotations` whole.
  if (db) await clearCommercialFixtures(db as never);
  if (sqlClient) await sqlClient.end({ timeout: 5 });
});

// A window no other fixture uses, so the aggregate only sees this cohort.
const START = '2099-05-01';
const END = '2099-05-31';

/**
 * The disposable database survives repeated runs of this file, so the cohort
 * window is cleared first: the metric aggregates by period and would otherwise
 * count leftovers from an earlier run.
 */
async function clearCohortWindows() {
  await db.execute(sql`
    DELETE FROM sales_orders
    WHERE transaction_date BETWEEN DATE '2099-05-01' AND DATE '2099-07-31'
  `);
  await db.execute(sql`
    DELETE FROM crm_deals
    WHERE quotation_id IN (
      SELECT id FROM quotations
      WHERE (created_at AT TIME ZONE 'UTC')::date BETWEEN DATE '2099-05-01' AND DATE '2099-07-31'
    )
  `);
  await db.execute(sql`
    DELETE FROM quotations
    WHERE (created_at AT TIME ZONE 'UTC')::date BETWEEN DATE '2099-05-01' AND DATE '2099-07-31'
  `);
}

async function insertQuotation(options: {
  createdAt: string;
  status: string;
  order?: { transactionDate: string; status: string };
}) {
  const clientId = randomUUID();
  const quotationId = randomUUID();
  await db.insert(clients).values({ id: clientId, nome: 'Cliente coorte' });
  await db.insert(quotations).values({
    id: quotationId,
    businessNumber: `ORC-${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-8)}`,
    clientId,
    status: options.status,
    createdAt: new Date(`${options.createdAt}T12:00:00.000Z`),
    updatedAt: new Date(`${options.createdAt}T12:00:00.000Z`),
  });
  if (options.order) {
    await db.insert(salesOrders).values({
      id: randomUUID(),
      orderNumber: `PED-2099-${String(1000 + Math.floor(Math.random() * 8999))}`,
      quotationId,
      clientId,
      status: options.order.status,
      transactionDate: options.order.transactionDate,
      subtotal: '10.00',
      grandTotal: '10.00',
    });
  }
  return quotationId;
}

test(
  'conversion measures one single cohort: quotations created in the period that became an order',
  { skip: TEST_DATABASE_URL ? false : databaseSkip },
  async () => {
    await clearCohortWindows();
    const repository = createPostgresSalesOrdersRepository(() => db as never, {
      now: () => new Date('2099-06-01T12:00:00.000Z'),
    });
    // Converted inside the window.
    await insertQuotation({
      createdAt: '2099-05-10',
      status: 'emitido',
      order: { transactionDate: '2099-05-20', status: 'To Deliver and Bill' },
    });
    // Converted after the window: the cohort is the quotation, not the order date.
    await insertQuotation({
      createdAt: '2099-05-12',
      status: 'aprovado',
      order: { transactionDate: '2099-06-15', status: 'Completed' },
    });
    // Created in the window and never converted.
    await insertQuotation({ createdAt: '2099-05-15', status: 'emitido' });
    // Draft: never part of the cohort.
    await insertQuotation({ createdAt: '2099-05-16', status: 'rascunho' });
    // An old quotation closed as an order inside the window: the previous
    // behaviour counted this order and produced a ratio above 100%.
    await insertQuotation({
      createdAt: '2099-01-10',
      status: 'emitido',
      order: { transactionDate: '2099-05-05', status: 'Completed' },
    });

    const result = await repository.dashboard({ from: START, to: END });
    assert.equal(result.summary.orders_count, 2, 'both orders are inside the window');
    // 2 of the 3 non-draft quotations created in the window converted.
    assert.equal(result.summary.conversion_rate, 0.67);
    assert.ok(result.summary.conversion_rate <= 1);
  }
);

test(
  'a period without quotations reports zero conversion instead of an undefined ratio',
  { skip: TEST_DATABASE_URL ? false : databaseSkip },
  async () => {
    const repository = createPostgresSalesOrdersRepository(() => db as never, {
      now: () => new Date('2099-06-01T12:00:00.000Z'),
    });
    const result = await repository.dashboard({ from: '2099-07-01', to: '2099-07-31' });
    assert.equal(result.summary.conversion_rate, 0);
    assert.equal(Number.isFinite(result.summary.conversion_rate), true);
  }
);
