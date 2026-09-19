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
import { clients, crmDeals, quoteRevisions, quotations } from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresQuotationEmailDeliveryRepository,
} from '../../api/_infrastructure/db/repositories/quotation-email-delivery-repository.js';
import { promoteDealOnProviderAcceptance } from '../../api/_infrastructure/db/repositories/crm-deals-repository.js';
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
const databaseSkip = 'TEST_DATABASE_URL is required for PostgreSQL-backed commercial stage tests.';

function databaseTest(name: string, fn: () => Promise<void>) {
  return test(name, { skip: TEST_DATABASE_URL ? false : databaseSkip }, fn);
}

const RENDERED_EMAIL = {
  subject: 'Orçamento - Aspen',
  html: '<!doctype html><html><body>Orçamento</body></html>',
  text: 'Orçamento',
};

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

async function seedQuotation(dealStatus: string) {
  const clientId = randomUUID();
  const quotationId = randomUUID();
  const revisionId = randomUUID();
  const dealId = randomUUID();
  const createdAt = new Date('2026-09-18T09:00:00.000Z');
  await db.insert(clients).values({ id: clientId, nome: 'Cliente etapa' });
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
    clienteNome: 'Cliente etapa',
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    subtotal: '0.00',
    total: '0.00',
    createdAt,
  });
  await db.insert(crmDeals).values({
    id: dealId,
    clientId,
    quotationId,
    nome: 'Cliente etapa',
    status: dealStatus,
    createdAt,
    updatedAt: createdAt,
  });
  return { clientId, quotationId, revisionId, dealId, createdAt };
}

async function dealStatus(quotationId: string) {
  const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.quotationId, quotationId));
  return deal?.status || null;
}

databaseTest('a provider acceptance advances an earlier stage to Orcamento Enviado', async () => {
  const earlier = await seedQuotation('Contato Feito');
  await promoteDealOnProviderAcceptance(db as never, { revisionId: earlier.revisionId });
  assert.equal(await dealStatus(earlier.quotationId), 'Orcamento Enviado');

  // Idempotent: a replayed acceptance changes nothing.
  await promoteDealOnProviderAcceptance(db as never, { revisionId: earlier.revisionId });
  assert.equal(await dealStatus(earlier.quotationId), 'Orcamento Enviado');
});

databaseTest('an acceptance never regresses an advanced stage nor revives a lost deal', async () => {
  const advanced = await seedQuotation('Em Negociacao');
  await promoteDealOnProviderAcceptance(db as never, { revisionId: advanced.revisionId });
  assert.equal(await dealStatus(advanced.quotationId), 'Em Negociacao');

  const won = await seedQuotation('Pedido Fechado');
  await promoteDealOnProviderAcceptance(db as never, { revisionId: won.revisionId });
  assert.equal(await dealStatus(won.quotationId), 'Pedido Fechado');

  const lost = await seedQuotation('Perdido');
  await promoteDealOnProviderAcceptance(db as never, { revisionId: lost.revisionId });
  assert.equal(await dealStatus(lost.quotationId), 'Perdido');
});

databaseTest('an accepted e-mail attempt authorizes the commercial stage', async () => {
  const { quotationId, revisionId } = await seedQuotation('Novo Lead');
  const repository = createPostgresQuotationEmailDeliveryRepository(() => db as never);
  const attemptId = randomUUID();
  await repository.reserve({
    attemptId,
    revisionId,
    recipient: 'cliente@example.com',
    publicToken: 'stable-public-token',
    templateSnapshot: RENDERED_EMAIL,
  });
  assert.equal(await dealStatus(quotationId), 'Novo Lead', 'a pending attempt proves nothing');

  await repository.markAccepted({ attemptId, providerEmailId: 'resend-email-1' });
  assert.equal(await dealStatus(quotationId), 'Orcamento Enviado');
});

databaseTest('a failed e-mail attempt never claims the commercial stage', async () => {
  const { quotationId, revisionId } = await seedQuotation('Novo Lead');
  const repository = createPostgresQuotationEmailDeliveryRepository(() => db as never);
  const attemptId = randomUUID();
  await repository.reserve({
    attemptId,
    revisionId,
    recipient: 'cliente@example.com',
    publicToken: 'stable-public-token',
    templateSnapshot: RENDERED_EMAIL,
  });
  await repository.markFailed({ attemptId, publicError: 'O provedor recusou o envio.' });
  assert.equal(await dealStatus(quotationId), 'Novo Lead');
});
