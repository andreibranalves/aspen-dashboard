import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
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
  evolutionReceiptInbox,
  quotationDeliveries,
  quotationDeliverySteps,
  quoteRevisions,
  quotations,
} from '../../api/_infrastructure/db/schema.js';
import {
  QUOTATION_DELIVERY_WORKER_NAME,
  readQuotationDeliveryDiagnostics,
  recordQuotationDeliveryWorkerRun,
} from '../../api/_infrastructure/db/repositories/quotation-delivery-diagnostics-repository.js';
import { handler as diagnosticsHandler } from '../../api/_modules/whatsapp-delivery-diagnostics.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';
import { clearCommercialFixtures } from '../support/commercial-fixtures.ts';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const databaseSkip = 'TEST_DATABASE_URL is required for PostgreSQL-backed diagnostics tests.';

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

async function seedDeliveryWithStep(options: {
  stepState: string;
  reconciliationDeadline: Date | null;
}) {
  const clientId = randomUUID();
  const quotationId = randomUUID();
  const revisionId = randomUUID();
  const deliveryId = randomUUID();
  const createdAt = new Date('2026-09-18T10:26:00.000Z');
  await db.insert(clients).values({ id: clientId, nome: 'Cliente diagnóstico' });
  await db.insert(quotations).values({
    id: quotationId,
    businessNumber: `ORC-${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-8)}`,
    clientId,
    status: 'emitido',
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(quoteRevisions).values({
    ...fixtureFields,
    id: revisionId,
    quotationId,
    version: 1,
    status: 'emitido',
    validadeDias: 15,
    entrega: '',
    fretePadrao: '0.00',
    frete: '0.00',
    clienteNome: 'Cliente diagnóstico',
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    subtotal: '0.00',
    total: '0.00',
    createdAt,
  });
  await db.insert(quotationDeliveries).values({
    id: deliveryId,
    revisionId,
    phone: '5511900000001',
    flowId: `flow-${deliveryId}`,
    flowName: 'Fluxo diagnóstico',
    state: options.stepState === 'reconciling' ? 'reconciling' : 'queued',
    reconciliationDeadline: options.reconciliationDeadline,
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(quotationDeliverySteps).values({
    id: randomUUID(),
    deliveryId,
    position: 0,
    type: 'text',
    payloadSnapshot: { text: 'mensagem', delayMs: 0 },
    state: options.stepState,
    reconciliationDeadline: options.reconciliationDeadline,
    createdAt,
    updatedAt: createdAt,
  });
  return deliveryId;
}

test(
  'diagnostics report the worker heartbeat, the reconciled steps and the uncorrelated receipts',
  { skip: TEST_DATABASE_URL ? false : databaseSkip },
  async () => {
    await db.delete(evolutionReceiptInbox);
    await db.delete(quotationDeliverySteps);
    await db.delete(quotationDeliveries);
    const overdueDeadline = new Date(Date.now() - 60_000);
    const futureDeadline = new Date(Date.now() + 600_000);
    await seedDeliveryWithStep({ stepState: 'reconciling', reconciliationDeadline: overdueDeadline });
    await seedDeliveryWithStep({ stepState: 'reconciling', reconciliationDeadline: futureDeadline });
    await seedDeliveryWithStep({ stepState: 'queued', reconciliationDeadline: null });
    await db.insert(evolutionReceiptInbox).values([
      {
        id: randomUUID(),
        providerMessageId: `orphan-${randomUUID()}`,
        status: 'DELIVERY_ACK',
        receivedAt: new Date('2026-09-18T10:30:00.000Z'),
        appliedAt: null,
      },
      {
        id: randomUUID(),
        providerMessageId: `applied-${randomUUID()}`,
        status: 'READ',
        receivedAt: new Date('2026-09-18T10:31:00.000Z'),
        appliedAt: new Date('2026-09-18T10:32:00.000Z'),
      },
    ]);
    const runAt = new Date('2026-09-19T12:00:00.000Z');
    await recordQuotationDeliveryWorkerRun(
      { result: 'success', processed: 2, remaining: true, now: runAt },
      () => db as never
    );

    const diagnostics = await readQuotationDeliveryDiagnostics(() => db as never);
    assert.equal(diagnostics.reconcilingSteps, 2);
    assert.equal(diagnostics.pendingReceipts, 1);
    assert.equal(diagnostics.worker?.worker, QUOTATION_DELIVERY_WORKER_NAME);
    assert.equal(diagnostics.worker?.lastRunAt.toISOString(), runAt.toISOString());
    assert.equal(diagnostics.worker?.result, 'success');
    assert.equal(diagnostics.worker?.processed, 2);
    assert.equal(diagnostics.worker?.remaining, true);

    // A later run overwrites the same heartbeat row instead of appending.
    await recordQuotationDeliveryWorkerRun(
      {
        result: 'success',
        processed: 0,
        remaining: false,
        now: new Date('2026-09-19T12:02:00.000Z'),
      },
      () => db as never
    );
    const rows = await db
      .select()
      .from(schema.quotationDeliveryWorkerRuns)
      .where(eq(schema.quotationDeliveryWorkerRuns.worker, QUOTATION_DELIVERY_WORKER_NAME));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.processed, 0);
    assert.equal(rows[0]?.remaining, false);

    await recordQuotationDeliveryWorkerRun(
      { result: 'failure', now: new Date('2026-09-19T12:03:00.000Z') },
      () => db as never
    );
    const failed = await readQuotationDeliveryDiagnostics(() => db as never);
    assert.equal(failed.worker?.lastRunAt.toISOString(), '2026-09-19T12:03:00.000Z');
    assert.equal(failed.worker?.result, 'failure');
    assert.equal(failed.worker?.processed, 0);
    assert.equal(failed.worker?.remaining, false);
  }
);

test(
  'the diagnostics endpoint exposes the operational numbers without touching the pipeline',
  { skip: TEST_DATABASE_URL ? false : databaseSkip },
  async () => {
    await recordQuotationDeliveryWorkerRun(
      {
        result: 'success',
        processed: 3,
        remaining: false,
        now: new Date('2026-09-19T12:05:00.000Z'),
      },
      () => db as never
    );
    const response = await diagnosticsHandler(
      { httpMethod: 'GET', headers: {}, queryStringParameters: {}, body: '' } as never,
      { readDiagnostics: () => readQuotationDeliveryDiagnostics(() => db as never) }
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body || '{}');
    assert.equal(typeof body.reconciling_steps, 'number');
    assert.equal(typeof body.pending_receipts, 'number');
    assert.equal(body.worker.name, QUOTATION_DELIVERY_WORKER_NAME);
    assert.equal(body.worker.last_run_at, '2026-09-19T12:05:00.000Z');
    assert.equal(body.worker.result, 'success');
    assert.equal(body.overdue_reconciling_steps, undefined);
    assert.equal(body.oldest_reconciliation_deadline, undefined);
    assert.equal(body.oldest_pending_receipt_at, undefined);

    const rejected = await diagnosticsHandler(
      { httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '' } as never,
      { readDiagnostics: () => readQuotationDeliveryDiagnostics(() => db as never) }
    );
    assert.equal(rejected.statusCode, 405);
  }
);
