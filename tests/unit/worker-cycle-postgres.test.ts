// O aspen-worker de ponta a ponta (ADR 0013): /wake → agendador → ciclo real →
// PostgreSQL descartável → stub do Evolution, e a agenda lida do banco. Nenhum
// transporte real.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { eq, sql } from 'drizzle-orm';
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
  quotationDeliveries,
  quotationDeliverySteps,
  quotationDeliveryWorkerRuns,
  quoteRevisions,
  quotations,
} from '../../api/_infrastructure/db/schema.js';
import { closeDatabase } from '../../api/_infrastructure/db/client.js';
import { createPostgresQuotationDeliveryOutboxRepository } from '../../api/_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';
import { readWorkerSchedule } from '../../api/_infrastructure/db/repositories/worker-schedule-repository.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import { createLiveWorkerCycle } from '../../api/_worker/live-cycle.js';
import { createWorkerScheduler } from '../../api/_worker/scheduler.js';
import { createWorkerServer } from '../../api/_worker/server.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';
import { clearCommercialFixtures } from '../support/commercial-fixtures.ts';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
const databaseSkip = 'TEST_DATABASE_URL is required for the PostgreSQL-backed worker test.';
const WAKE_SECRET = 'w'.repeat(32);
const INSTANCE = 'worker-test-instance';

let sqlClient: Sql | undefined;
let db: PostgresJsDatabase<typeof schema>;
let fixtureFields: FixtureRevisionFields;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.before(async () => {
  if (!TEST_DATABASE_URL) return;
  sqlClient = postgres(TEST_DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
  db = drizzle(sqlClient, { schema });
  await migrate(db, { migrationsFolder });
  fixtureFields = await ensureFixtureTemplateVersion(db as never);
});

test.after(async () => {
  if (db) await clearCommercialFixtures(db as never);
  await closeDatabase();
  if (sqlClient) await sqlClient.end({ timeout: 5 });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function seedRevision() {
  const clientId = randomUUID();
  const quotationId = randomUUID();
  const revisionId = randomUUID();
  const createdAt = new Date();
  await db.insert(clients).values({ id: clientId, nome: 'Cliente worker' });
  await db.insert(quotations).values({
    id: quotationId,
    businessNumber: `ORC-${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-8)}`,
    clientId,
    status: 'emitido',
    issuedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(quoteRevisions).values({
    ...fixtureFields,
    id: revisionId,
    quotationId,
    version: 1,
    status: 'emitido',
    issuedAt: createdAt,
    validadeDias: 15,
    entrega: '',
    fretePadrao: '0.00',
    frete: '0.00',
    clienteNome: 'Cliente worker',
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    subtotal: '0.00',
    total: '0.00',
    createdAt,
  });
  return revisionId;
}

async function withEvolutionStub(fn: (stub: { url: string; requests: Array<{ path: string; apikey: string }> }) => Promise<void>) {
  const requests: Array<{ path: string; apikey: string }> = [];
  const server: Server = createServer((req, res) => {
    req.resume();
    requests.push({ path: req.url || '', apikey: String(req.headers.apikey || '') });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: { id: `stub-${requests.length}` }, status: 'PENDING' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await fn({ url: `http://127.0.0.1:${address.port}`, requests });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function until(condition: () => Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('o worker não concluiu o envio a tempo');
}

test(
  'a /wake makes the worker send a queued envio through Evolution and record its heartbeat',
  { skip: TEST_DATABASE_URL ? false : databaseSkip },
  async () => {
    await withEvolutionStub(async (stub) => {
      setEnv({
        DATABASE_URL: TEST_DATABASE_URL,
        VERCEL_ENV: undefined,
        APP_ENV: 'production',
        EXTERNAL_WRITES_ENABLED: '1',
        EVOLUTION_BASE_URL: stub.url,
        EVOLUTION_API_KEY: 'stub-key',
        EVOLUTION_INSTANCE: INSTANCE,
      });
      const errors: string[] = [];
      const scheduler = createWorkerScheduler({
        runCycle: createLiveWorkerCycle((task) => errors.push(task)),
        reportError: (task) => errors.push(task),
      });
      const worker = createWorkerServer({ sha: 'test', wakeSecret: WAKE_SECRET, onWake: () => scheduler.wake() });
      worker.listen(0, '127.0.0.1');
      await once(worker, 'listening');
      const address = worker.address();
      assert.ok(address && typeof address === 'object');
      try {
        const revisionId = await seedRevision();
        const delivery = await createPostgresQuotationDeliveryOutboxRepository(() => db as never).enqueue({
          revisionId,
          flowId: `flow-${revisionId}`,
          phone: '5511900000001',
          flowName: 'Fluxo worker',
          steps: [
            { position: 0, type: 'text', payload: { text: 'Olá.' }, delayMs: 0 },
            { position: 1, type: 'text', payload: { text: 'Segue o orçamento.' }, delayMs: 0 },
          ],
        } as never);

        const refused = await fetch(`http://127.0.0.1:${address.port}/wake`, { method: 'POST' });
        assert.equal(refused.status, 401);
        const accepted = await fetch(`http://127.0.0.1:${address.port}/wake`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${WAKE_SECRET}` },
        });
        assert.equal(accepted.status, 202);

        await until(async () => {
          const steps = await db
            .select({ providerMessageId: quotationDeliverySteps.providerMessageId })
            .from(quotationDeliverySteps)
            .where(eq(quotationDeliverySteps.deliveryId, delivery.id));
          return steps.every((step) => Boolean(step.providerMessageId));
        });
        await scheduler.stop();

        assert.deepEqual(errors, []);
        assert.deepEqual(
          stub.requests.map((request) => [request.path, request.apikey]),
          [
            [`/message/sendText/${INSTANCE}`, 'stub-key'],
            [`/message/sendText/${INSTANCE}`, 'stub-key'],
          ],
        );
        const [row] = await db
          .select({ state: quotationDeliveries.state })
          .from(quotationDeliveries)
          .where(eq(quotationDeliveries.id, delivery.id));
        assert.equal(row.state, 'provider_accepted');
        const [heartbeat] = await db
          .select()
          .from(quotationDeliveryWorkerRuns)
          .where(eq(quotationDeliveryWorkerRuns.worker, 'quotation-delivery-worker'));
        assert.ok(heartbeat && heartbeat.lastRunAt.getTime() > Date.now() - 60_000);
      } finally {
        await scheduler.stop();
        worker.close();
        await once(worker, 'close');
      }
    });
  },
);

test(
  'a lease left between two steps holds the next step until it expires',
  { skip: TEST_DATABASE_URL ? false : databaseSkip },
  async () => {
    await clearCommercialFixtures(db as never);
    await db.execute(sql`DELETE FROM whatsapp_message_outbox`);
    const revisionId = await seedRevision();
    const delivery = await createPostgresQuotationDeliveryOutboxRepository(() => db as never).enqueue({
      revisionId,
      flowId: `flow-${revisionId}`,
      phone: '5511900000002',
      flowName: 'Fluxo agenda',
      steps: [{ position: 0, type: 'text', payload: { text: 'Olá.' }, delayMs: 0 }],
    } as never);
    const leaseUntil = new Date(Date.now() + 90_000);
    await db
      .update(quotationDeliveries)
      .set({ leaseToken: randomUUID(), leaseUntil })
      .where(eq(quotationDeliveries.id, delivery.id));

    const schedule = await readWorkerSchedule(
      { instance: `schedule-${randomUUID()}`, now: new Date() },
      () => db as never,
    );
    assert.equal(schedule.dueNow, false);
    assert.equal(schedule.nextAt?.getTime(), leaseUntil.getTime());
  },
);
