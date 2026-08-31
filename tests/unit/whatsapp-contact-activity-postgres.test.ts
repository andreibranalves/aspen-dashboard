import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresWhatsappContactActivityRepository,
  type WhatsappContactActivityRepository,
} from '../../api/_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const databaseUrl = resolveDisposableTestDatabaseUrl(process.env);
const databaseSkip = 'TEST_DATABASE_URL is required for PostgreSQL-backed activity tests.';
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

function databaseTest(name: string, fn: () => Promise<void>) {
  return test(name, { ...(databaseUrl ? {} : { skip: databaseSkip }) }, fn);
}

let sqlClient: { end(options: { timeout: number }): Promise<void> } | undefined;
let repository: WhatsappContactActivityRepository;

const instance = `activity-test-${randomUUID()}`;
const conversation = `${randomUUID()}@s.whatsapp.net`;
const old = new Date('2026-01-01T00:00:00.000Z');
const newer = new Date('2026-01-01T00:00:01.000Z');

test.before(async () => {
  if (!databaseUrl) return;
  sqlClient = postgres(databaseUrl, {
    max: 2,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });
  const db = drizzle(sqlClient, { schema });
  await migrate(db, { migrationsFolder });
  repository = createPostgresWhatsappContactActivityRepository(() => db);
});

test.after(async () => {
  if (sqlClient) await sqlClient.end({ timeout: 5 });
});

databaseTest('records activity monotonically and upgrades unresolved identity', async () => {
  await repository.recordActivity({
    instance,
    providerConversationId: conversation,
    providerMessageId: 'z-old',
    fromMe: false,
    occurredAt: old,
    identityStatus: 'unresolved',
    canonicalPhone: null,
  });
  await repository.recordActivity({
    instance,
    providerConversationId: conversation,
    providerMessageId: 'a-newer-id',
    fromMe: false,
    occurredAt: newer,
    identityStatus: 'verified',
    canonicalPhone: '5511999990000',
  });
  // A stale event, even with a lexicographically larger ID, must not regress the watermark.
  await repository.recordActivity({
    instance,
    providerConversationId: conversation,
    providerMessageId: 'z-stale',
    fromMe: false,
    occurredAt: old,
    identityStatus: 'unresolved',
    canonicalPhone: null,
  });

  const row = await repository.getActivity({
    instance,
    providerConversationId: conversation,
  });
  assert.ok(row);
  assert.equal(row.lastInboundAt?.toISOString(), newer.toISOString());
  assert.equal(row.lastInboundProviderMessageId, 'a-newer-id');
  assert.equal(row.canonicalPhone, '5511999990000');
  assert.equal(row.identityStatus, 'verified');
  assert.equal(row.lastOutboundAt, null);
});

databaseTest('blocks ingestion and clears only when the exact event key retries', async () => {
  const eventKey = `${instance}:upsert:4:message-id`;
  await repository.blockIngestion({ instance, eventKey, now: newer });
  const blocked = await repository.getHealth(instance);
  assert.ok(blocked);
  assert.equal(blocked.blockReason, 'unparsed_upsert');
  assert.equal(blocked.blockedEventKey, eventKey);

  assert.equal(
    await repository.unblockIngestionIfEvent({ instance, eventKey: `${instance}:upsert:4:other-id` }),
    false,
  );
  assert.equal(await repository.unblockIngestionIfEvent({ instance, eventKey }), true);
  const clear = await repository.getHealth(instance);
  assert.ok(clear);
  assert.equal(clear.blockedAt, null);
  assert.equal(clear.blockedEventKey, null);
});

databaseTest('stores and detects a do-not-contact block without message content', async () => {
  const blockedConversation = `${randomUUID()}@s.whatsapp.net`;
  await repository.blockContact({
    instance,
    canonicalPhone: '5511888777666',
    providerConversationId: blockedConversation,
    now: newer,
  });
  assert.equal(await repository.isContactBlocked({ instance, canonicalPhone: '5511888777666' }), true);
  assert.equal(await repository.isContactBlocked({ instance, canonicalPhone: '5511888777665' }), false);
  const row = await repository.getActivity({
    instance,
    providerConversationId: blockedConversation,
  });
  assert.ok(row);
  assert.equal(row.blockReason, 'do_not_contact');
  assert.equal(row.lastInboundAt, null);
  assert.equal(row.lastOutboundAt, null);
});
