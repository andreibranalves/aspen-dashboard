import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import {
  createPostgresWhatsappWebhookEffectsRepository,
  type WebhookEffectInput,
} from '../../api/_infrastructure/db/repositories/whatsapp-webhook-effects-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  applyWebhookEffects,
  drainWebhookEffects,
  type WebhookEffectRunners,
} from '../../api/_modules/whatsapp-webhook-effects.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const databaseSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; this seam must run against disposable PostgreSQL.';
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

let sql: postgres.Sql;
let db: AppDatabase;

test.before(async () => {
  if (!TEST_DATABASE_URL) return;
  sql = postgres(TEST_DATABASE_URL, { max: 4, prepare: false, onnotice: () => {} });
  db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder });
});

test.after(async () => {
  await sql?.end({ timeout: 5 });
});

function effect(instance: string, id: string, at = '2026-09-01T10:00:00Z'): WebhookEffectInput {
  return {
    instance,
    providerConversationId: '5511999990000@s.whatsapp.net',
    providerMessageId: id,
    fromMe: false,
    occurredAt: new Date(at),
    identityStatus: 'derived',
    canonicalPhone: '5511999990000',
  };
}

async function age(instance: string, ms: number) {
  await sql`UPDATE whatsapp_webhook_effects SET created_at = now() - ${`${ms} milliseconds`}::interval WHERE instance = ${instance}`;
}

test('register is idempotent and keeps completed effects across retries', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappWebhookEffectsRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const [first] = await repository.register([effect(instance, 'e1')]);
  await repository.markDone(first.id, 'activity');
  const [again] = await repository.register([effect(instance, 'e1')]);

  assert.equal(again.id, first.id);
  assert.equal(again.activityDone, true);
  assert.equal(again.followUpDone, false);
});

test('a failed follow-up is resumed by the drain without repeating the activity', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappWebhookEffectsRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const calls: string[] = [];
  let followUpDown = true;
  const runners: WebhookEffectRunners = {
    recordActivity: async (input) => {
      calls.push(`activity:${input.providerMessageId}`);
    },
    applyFollowUp: async (input) => {
      if (followUpDown) throw new Error('down');
      calls.push(`follow-up:${input.providerMessageId}`);
    },
  };

  const [record] = await repository.register([effect(instance, 'e1')]);
  await assert.rejects(applyWebhookEffects(record, runners, repository));
  assert.deepEqual(calls, ['activity:e1']);

  // Not yet due: the failure scheduled a retry in the future.
  await age(instance, 120_000);
  let drained = await drainWebhookEffects({ instance, runners, limit: 10, deadlineAt: Date.now() + 10_000, repository });
  assert.deepEqual(drained, { applied: 0, failed: 0 });

  followUpDown = false;
  await sql`UPDATE whatsapp_webhook_effects SET next_attempt_at = now() - interval '1 second' WHERE instance = ${instance}`;
  drained = await drainWebhookEffects({ instance, runners, limit: 10, deadlineAt: Date.now() + 10_000, repository });
  assert.deepEqual(drained, { applied: 1, failed: 0 });
  assert.deepEqual(calls, ['activity:e1', 'follow-up:e1']);

  const [done] = await repository.register([effect(instance, 'e1')]);
  assert.equal(done.activityDone && done.followUpDone, true);
  assert.equal(done.attempts, 1);
});

test('the drain leaves fresh rows to the live webhook and leases each row once', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappWebhookEffectsRepository(() => db);
  const instance = `test-${randomUUID()}`;
  await repository.register([effect(instance, 'fresh')]);
  const now = new Date();
  assert.equal((await repository.claimDue({ instance, limit: 50, now, leaseMs: 60_000, minAgeMs: 60_000 })).length, 0);

  await repository.register(
    Array.from({ length: 6 }, (_, index) => effect(instance, `old-${index}`, `2026-09-01T10:00:0${index}Z`)),
  );
  await age(instance, 120_000);
  const [left, right] = await Promise.all([
    repository.claimDue({ instance, limit: 50, now: new Date(), leaseMs: 60_000, minAgeMs: 60_000 }),
    repository.claimDue({ instance, limit: 50, now: new Date(), leaseMs: 60_000, minAgeMs: 60_000 }),
  ]);
  const mine = [...left, ...right].filter((row) => row.instance === instance).map((row) => row.providerMessageId);
  assert.equal(mine.length, 7);
  assert.equal(new Set(mine).size, 7, 'no row is leased twice');
});
