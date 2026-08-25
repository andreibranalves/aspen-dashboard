import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import {
  createPostgresQuotationEmailDeliveryRepository,
  QuotationEmailDeliveryRepositoryError,
} from '../../api/_infrastructure/db/repositories/quotation-email-delivery-repository.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';

const TEST_DATABASE_URL = process.env.TEST_QUOTE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const NOW = new Date('2026-08-17T12:00:00.000Z');
const RENDERED_EMAIL = {
  subject: 'Orçamento ORC-42 - Aspen',
  html: '<!doctype html><html><body>Orçamento ORC-42 - Aspen</body></html>',
  text: 'Orçamento ORC-42 - Aspen',
};

async function withDatabase<T>(callback: (db: AppDatabase) => Promise<T>): Promise<T> {
  const client = postgres(TEST_DATABASE_URL!, {
    max: 2,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema }) as AppDatabase;
  try {
    await migrate(db, { migrationsFolder });
    return await callback(db);
  } finally {
    await client.end({ timeout: 5 });
  }
}

function businessNumber(): string {
  const suffix = BigInt(`0x${randomUUID().split('-').join('').slice(0, 12)}`) % 100000000n;
  return `ORC-${String(suffix).padStart(8, '0')}`;
}

test(
  'quotation email delivery reservations and transitions are idempotent in PostgreSQL',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () =>
    withDatabase(async (db) => {
      const ids = {
        client: randomUUID(),
        quotation: randomUUID(),
        firstRevision: randomUUID(),
        secondRevision: randomUUID(),
        firstAttempt: randomUUID(),
        secondAttempt: randomUUID(),
      };
      try {
        await db.insert(schema.clients).values({ id: ids.client, nome: 'Cliente e-mail' });
        await db.insert(schema.quotations).values({
          id: ids.quotation,
          businessNumber: businessNumber(),
          clientId: ids.client,
          status: 'emitido',
          issuedAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
        });
        await db.insert(schema.quoteRevisions).values([
          {
            id: ids.firstRevision,
            quotationId: ids.quotation,
            version: 1,
            status: 'emitido',
            issuedAt: NOW,
            validadeDias: 15,
            companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
            templateHash: 'a'.repeat(64),
            clienteNome: 'Cliente e-mail',
            subtotal: '10.00',
            total: '10.00',
            createdAt: NOW,
          },
          {
            id: ids.secondRevision,
            quotationId: ids.quotation,
            version: 2,
            status: 'emitido',
            issuedAt: NOW,
            validadeDias: 15,
            companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
            templateHash: 'b'.repeat(64),
            clienteNome: 'Cliente e-mail',
            subtotal: '12.00',
            total: '12.00',
            createdAt: NOW,
          },
        ]);

        const repository = createPostgresQuotationEmailDeliveryRepository(() => db, {
          now: () => new Date(NOW),
        });
        const templateSnapshot = {
          ...RENDERED_EMAIL,
          subject: 'Proposta ORC-42',
        };
        const first = await repository.reserve({
          attemptId: ids.firstAttempt,
          revisionId: ids.firstRevision,
          recipient: 'cliente@example.com',
          publicToken: 'stable-public-token',
          templateSnapshot,
        });
        assert.equal(first.kind, 'reserved');
        assert.equal(first.delivery.state, 'pending');
        assert.equal(first.delivery.publicToken, 'stable-public-token');
        assert.deepEqual(first.delivery.templateSnapshot, templateSnapshot);

        const duplicate = await repository.reserve({
          attemptId: ids.firstAttempt,
          revisionId: ids.firstRevision,
          recipient: 'cliente@example.com',
          publicToken: 'discarded-racing-token',
          templateSnapshot: RENDERED_EMAIL,
        });
        assert.equal(duplicate.kind, 'existing');
        assert.equal(duplicate.delivery.id, ids.firstAttempt);
        assert.equal(duplicate.delivery.publicToken, 'stable-public-token');

        await assert.rejects(
          repository.reserve({
            attemptId: ids.firstAttempt,
            revisionId: ids.secondRevision,
            recipient: 'outro@example.com',
            publicToken: 'other-public-token',
            templateSnapshot,
          }),
          /identificador.*outra tentativa/i
        );

        const accepted = await repository.markAccepted({
          attemptId: ids.firstAttempt,
          providerEmailId: 'resend-email-1',
        });
        assert.equal(accepted.state, 'accepted');
        assert.equal(accepted.publicToken, null);
        assert.equal(accepted.templateSnapshot, null);
        assert.equal(accepted.acceptedAt?.toISOString(), '2026-08-17T12:00:00.000Z');

        const repeated = await repository.markAccepted({
          attemptId: ids.firstAttempt,
          providerEmailId: 'resend-email-1',
        });
        assert.equal(repeated.state, 'accepted');
        assert.equal(repeated.acceptedAt?.toISOString(), '2026-08-17T12:00:00.000Z');

        await assert.rejects(
          repository.markFailed({ attemptId: ids.firstAttempt, publicError: 'Falha conhecida.' }),
          /já (?:foi )?aceita/i
        );

        const second = await repository.reserve({
          attemptId: ids.secondAttempt,
          revisionId: ids.firstRevision,
          recipient: 'cliente@example.com',
          publicToken: 'second-public-token',
          templateSnapshot,
        });
        assert.equal(second.delivery.state, 'pending');
        const failed = await repository.markFailed({
          attemptId: ids.secondAttempt,
          publicError: 'Falha conhecida.',
        });
        assert.equal(failed.state, 'failed');
        assert.equal(failed.publicToken, null);
        assert.equal(failed.templateSnapshot, null);
        assert.equal(failed.publicError, 'Falha conhecida.');
        const repeatedFailed = await repository.markFailed({
          attemptId: ids.secondAttempt,
          publicError: 'Falha conhecida.',
        });
        assert.equal(repeatedFailed.state, 'failed');
        assert.equal(repeatedFailed.publicError, 'Falha conhecida.');
      } finally {
        await db
          .delete(schema.quotationEmailDeliveries)
          .where(
            inArray(schema.quotationEmailDeliveries.id, [ids.firstAttempt, ids.secondAttempt])
          );
        await db
          .delete(schema.quoteRevisions)
          .where(inArray(schema.quoteRevisions.id, [ids.firstRevision, ids.secondRevision]));
        await db.delete(schema.quotations).where(eq(schema.quotations.id, ids.quotation));
        await db.delete(schema.clients).where(eq(schema.clients.id, ids.client));
      }
    })
);

test('quotation email delivery hides unknown database errors', async () => {
  const database = {
    select: () => {
      throw new Error('database secret must not escape');
    },
  } as unknown as AppDatabase;
  const repository = createPostgresQuotationEmailDeliveryRepository(() => database);

  await assert.rejects(
    repository.get(randomUUID()),
    (error: unknown) =>
      error instanceof QuotationEmailDeliveryRepositoryError &&
      error instanceof Error &&
      !error.message.includes('database secret')
  );
});
