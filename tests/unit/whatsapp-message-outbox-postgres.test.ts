import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import { createPostgresWhatsappAttendanceRepository } from '../../api/_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import {
  createPostgresWhatsappMessageOutboxRepository,
  OutboxActionRefused,
  OutboxIntentRefused,
} from '../../api/_infrastructure/db/repositories/whatsapp-message-outbox-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { EvolutionTransportError } from '../../api/_modules/evolution-transport.js';
import {
  dispatchOutboxMessage,
  sweepOperatorMessages,
  type SendText,
} from '../../api/_modules/whatsapp-message-dispatch.js';
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

const PHONE = '5511999990000';

async function conversation(identity: 'verified' | 'unresolved' | 'conflict' = 'verified') {
  const attendance = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const { conversationId } = await attendance.ingestConversation({
    instance,
    providerConversationId: `${PHONE}@s.whatsapp.net`,
    origin: 'live',
    contactName: 'Cliente',
    resolveIdentity: () => ({
      canonicalPhone: identity === 'verified' ? PHONE : '',
      identityStatus: identity,
      identitySource: identity === 'verified' ? 'chat.phone' : null,
      identityConfidence: identity === 'verified' ? 'high' : null,
    }),
    messages: [
      {
        providerMessageId: `in-${randomUUID()}`,
        direction: 'inbound',
        messageType: 'text',
        body: 'Oi',
        preview: 'Oi',
        providerTimestamp: new Date('2026-09-01T10:00:00Z'),
      },
    ],
  });
  return { attendance, conversationId, instance };
}

function accepting(providerMessageId: string, calls: string[] = []): SendText {
  return async ({ text }) => {
    calls.push(text);
    return { providerMessageId };
  };
}

async function timeline(conversationId: string) {
  const page = await createPostgresWhatsappAttendanceRepository(() => db).listMessagesBefore({
    conversationId,
    limit: 50,
  });
  return page.items;
}

test('same key and content recovers the same intent; a changed body is an idempotency conflict', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const clientRequestId = randomUUID();
  const body = 'Linha 1\n\nLinha 2';

  const first = await repository.createIntent({ clientRequestId, conversationId, expectedIdentityVersion: 1, body });
  const again = await repository.createIntent({ clientRequestId, conversationId, expectedIdentityVersion: 1, body });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.record.messageId, first.record.messageId);

  await assert.rejects(
    repository.createIntent({ clientRequestId, conversationId, expectedIdentityVersion: 1, body: 'outro' }),
    (error: unknown) => error instanceof OutboxIntentRefused && error.reason === 'idempotency_conflict',
  );
  const bubbles = (await timeline(conversationId)).filter((item) => item.origin === 'operator');
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].body, body, 'multi-line body kept verbatim');
  assert.equal(bubbles[0].outboxState, 'queued');
});

test('identity conflict, unresolved phone and a stale identity version refuse the send', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  for (const [identity, reason, version] of [
    ['conflict', 'identity_conflict', 1],
    ['unresolved', 'identity_unresolved', 1],
    ['verified', 'identity_changed', 7],
  ] as const) {
    const { conversationId } = await conversation(identity);
    await assert.rejects(
      repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: version, body: 'Oi' }),
      (error: unknown) => error instanceof OutboxIntentRefused && error.reason === reason,
    );
  }
});

test('request dispatch and concurrent sweeps transport an intent exactly once', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const { record } = await repository.createIntent({
    clientRequestId: randomUUID(),
    conversationId,
    expectedIdentityVersion: 1,
    body: 'Uma vez só',
  });
  const calls: string[] = [];
  const send: SendText = async ({ text }) => {
    calls.push(text);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { providerMessageId: `prov-${randomUUID()}` };
  };
  const results = await Promise.all([
    dispatchOutboxMessage(record.id, { repository, send }),
    dispatchOutboxMessage(record.id, { repository, send }),
    dispatchOutboxMessage(record.id, { repository, send }),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await repository.findByMessageId(record.messageId))?.state, 'provider_accepted');
});

test('an ambiguous failure goes to review and is never retried; a proven pre-transport one is', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();

  const ambiguous = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'A' });
  await dispatchOutboxMessage(ambiguous.record.id, {
    repository,
    send: async () => {
      throw new EvolutionTransportError('timeout', 'ambiguous', 'EVOLUTION_NETWORK');
    },
  });
  assert.equal((await repository.findByMessageId(ambiguous.record.messageId))?.state, 'needs_review');
  assert.equal(await dispatchOutboxMessage(ambiguous.record.id, { repository, send: accepting('x') }), null);

  const limited = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'B' });
  await dispatchOutboxMessage(limited.record.id, {
    repository,
    send: async () => {
      throw new EvolutionTransportError('rate', 'transient_pre_transport', 'EVOLUTION_RATE_LIMIT');
    },
  });
  const retry = await repository.findByMessageId(limited.record.messageId);
  assert.equal(retry?.state, 'retry_scheduled');

  const writesOff = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'C' });
  await dispatchOutboxMessage(writesOff.record.id, {
    repository,
    send: async () => {
      throw new EvolutionTransportError('off', 'permanent_pre_transport', 'EXTERNAL_WRITES_DISABLED');
    },
  });
  const off = await repository.findByMessageId(writesOff.record.messageId);
  assert.equal(off?.state, 'failed');
  assert.equal(off?.failureCode, 'EXTERNAL_WRITES_DISABLED');
});

test('an expired lease returns to the queue before transport and goes to review after it', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const before = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'antes' });
  const after = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'depois' });

  const past = new Date(Date.now() - 10 * 60_000);
  await repository.claim(before.record.id, { leaseMs: 1, now: past });
  const started = await repository.claim(after.record.id, { leaseMs: 1, now: past });
  await repository.markTransportStarted(after.record.id, started!.leaseToken, past);

  const recovered = await repository.recoverExpiredLeases(new Date());
  assert.ok(recovered.requeued >= 1 && recovered.toReview >= 1);
  assert.equal((await repository.findByMessageId(before.record.messageId))?.state, 'queued');
  const review = await repository.findByMessageId(after.record.messageId);
  assert.equal(review?.state, 'needs_review');
  assert.equal(review?.failureCode, 'LEASE_EXPIRED_AFTER_TRANSPORT');
});

test('a destination change between intent and dispatch blocks the transport', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const { record } = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'x' });
  await sql`UPDATE whatsapp_conversations SET canonical_phone = '5511888880000', identity_version = 2 WHERE id = ${conversationId}`;
  const calls: string[] = [];
  assert.equal(await dispatchOutboxMessage(record.id, { repository, send: accepting('p', calls) }), null);
  assert.equal(calls.length, 0);
  const failed = await repository.findByMessageId(record.messageId);
  assert.equal(failed?.state, 'failed');
  assert.equal(failed?.failureCode, 'DESTINATION_CHANGED');
});

test('an echo stored before acceptance converges into the operator message', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { attendance, conversationId, instance } = await conversation();
  const { record } = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'Eco' });
  const providerId = `prov-${randomUUID()}`;
  const claimed = await repository.claim(record.id, { leaseMs: 45_000 });
  await repository.markTransportStarted(record.id, claimed!.leaseToken);
  // The provider echo arrives through the webhook before markAccepted commits.
  await attendance.ingestConversation({
    instance,
    providerConversationId: `${PHONE}@s.whatsapp.net`,
    origin: 'live',
    contactName: null,
    resolveIdentity: (stored) => stored!,
    messages: [{ providerMessageId: providerId, direction: 'outbound', messageType: 'text', body: 'Eco', preview: 'Eco', providerTimestamp: new Date() }],
  });
  await repository.markAccepted(record.id, claimed!.leaseToken, providerId);

  const outbound = (await timeline(conversationId)).filter((item) => item.direction === 'outbound');
  assert.equal(outbound.length, 1, 'one bubble after convergence');
  assert.equal(outbound[0].id, record.messageId);

  // A replayed echo after acceptance is deduplicated by the provider id.
  const replay = await attendance.ingestConversation({
    instance,
    providerConversationId: `${PHONE}@s.whatsapp.net`,
    origin: 'live',
    contactName: null,
    resolveIdentity: (stored) => stored!,
    messages: [{ providerMessageId: providerId, direction: 'outbound', messageType: 'text', body: 'Eco', preview: 'Eco', providerTimestamp: new Date() }],
  });
  assert.equal(replay.inserted, 0);
});

test('receipts arriving early converge on acceptance and never regress', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const { record } = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'Recibo' });
  const providerId = `prov-${randomUUID()}`;
  await sql`INSERT INTO evolution_receipt_inbox (id, provider_message_id, status, received_at) VALUES (${randomUUID()}, ${providerId}, 'DELIVERY_ACK', now())`;

  await dispatchOutboxMessage(record.id, { repository, send: accepting(providerId) });
  let [message] = (await timeline(conversationId)).filter((item) => item.id === record.messageId);
  assert.equal(message.deliveryStatus, 'delivered', 'early receipt applied on acceptance');

  await sql`INSERT INTO evolution_receipt_inbox (id, provider_message_id, status, received_at) VALUES (${randomUUID()}, ${providerId}, 'READ', now())`;
  await repository.applyReceipts(providerId);
  await sql`INSERT INTO evolution_receipt_inbox (id, provider_message_id, status, received_at) VALUES (${randomUUID()}, ${providerId}, 'SERVER_ACK', now())`;
  await repository.applyReceipts(providerId);
  [message] = (await timeline(conversationId)).filter((item) => item.id === record.messageId);
  assert.equal(message.deliveryStatus, 'read', 'a late SERVER_ACK does not regress read');
});

test('cancel and reservation race with a single winner', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  for (let round = 0; round < 5; round += 1) {
    const { record } = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: `r${round}` });
    const [cancel, claim] = await Promise.allSettled([
      repository.cancel(record.messageId),
      repository.claim(record.id, { leaseMs: 45_000 }),
    ]);
    const cancelled = cancel.status === 'fulfilled';
    const claimed = claim.status === 'fulfilled' && claim.value !== null;
    assert.notEqual(cancelled, claimed, 'exactly one of cancel or claim wins');
    if (!cancelled) assert.ok(cancel.status === 'rejected' && cancel.reason instanceof OutboxActionRefused);
    const state = (await repository.findByMessageId(record.messageId))?.state;
    assert.equal(state, cancelled ? 'cancelled' : 'dispatching');
  }
});

test('review resolution records the operator finding without retrying', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const { record } = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'r' });
  await dispatchOutboxMessage(record.id, {
    repository,
    send: async () => {
      throw new EvolutionTransportError('t', 'ambiguous', 'EVOLUTION_NETWORK');
    },
  });
  const resolved = await repository.resolveReview(record.messageId, 'confirmed_sent');
  assert.equal(resolved.state, 'provider_accepted');
  assert.equal(resolved.resolution, 'confirmed_sent');
  assert.equal(resolved.providerMessageId, null, 'no sentinel provider id');
  await assert.rejects(repository.resolveReview(record.messageId, 'confirmed_not_sent'), OutboxActionRefused);
});

test('the sweep dispatches only old intents and stops before the budget runs out', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const old = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'velha', now: new Date(Date.now() - 10 * 60_000) });
  const calls: string[] = [];
  const noRoom = await sweepOperatorMessages({ repository, deadlineAt: Date.now() + 10_000, send: accepting('p', calls) });
  assert.equal(noRoom.dispatched, 0, 'no transport without room for a full timeout');

  await sweepOperatorMessages({ repository, deadlineAt: Date.now() + 60_000, send: accepting(`p-${randomUUID()}`, calls) });
  assert.ok(calls.includes('velha'));
  assert.equal((await repository.findByMessageId(old.record.messageId))?.state, 'provider_accepted');
});

test('the same key raced by two requests yields one intent and an idempotent answer', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const clientRequestId = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      repository.createIntent({ clientRequestId, conversationId, expectedIdentityVersion: 1, body: 'corrida' }),
    ),
  );
  assert.equal(new Set(results.map((result) => result.record.messageId)).size, 1);
  assert.equal(results.filter((result) => result.created).length, 1);
});

test('receipts folded concurrently with acceptance never deadlock or duplicate', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { attendance, conversationId, instance } = await conversation();
  for (let round = 0; round < 8; round += 1) {
    const { record } = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: `c${round}` });
    const providerId = `prov-${randomUUID()}`;
    const claimed = await repository.claim(record.id, { leaseMs: 45_000 });
    await repository.markTransportStarted(record.id, claimed!.leaseToken);
    await sql`INSERT INTO evolution_receipt_inbox (id, provider_message_id, status, received_at) VALUES (${randomUUID()}, ${providerId}, 'SERVER_ACK', now())`;
    await Promise.all([
      attendance.ingestConversation({
        instance,
        providerConversationId: `${PHONE}@s.whatsapp.net`,
        origin: 'live',
        contactName: null,
        resolveIdentity: (stored) => stored!,
        messages: [{ providerMessageId: providerId, direction: 'outbound', messageType: 'text', body: `c${round}`, preview: 'c', providerTimestamp: new Date() }],
      }),
      repository.applyReceipts(providerId),
      repository.markAccepted(record.id, claimed!.leaseToken, providerId),
    ]);
    await repository.applyReceipts(providerId);
    const outbound = (await timeline(conversationId)).filter((item) => item.body === `c${round}`);
    assert.equal(outbound.length, 1, `round ${round}: one bubble`);
    assert.equal(outbound[0].deliveryStatus, 'server_ack');
  }
});

test('a late provider answer after the lease expired into review is still recorded', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const { record } = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'tarde' });
  const past = new Date(Date.now() - 10 * 60_000);
  const claimed = await repository.claim(record.id, { leaseMs: 1, now: past });
  await repository.markTransportStarted(record.id, claimed!.leaseToken, past);
  await repository.recoverExpiredLeases(new Date());
  assert.equal((await repository.findByMessageId(record.messageId))?.state, 'needs_review');

  const accepted = await repository.markAccepted(record.id, claimed!.leaseToken, 'prov-late');
  assert.equal(accepted?.state, 'provider_accepted');
  assert.equal(accepted?.providerMessageId, 'prov-late');
});

test('receipts consumed by an attendance message stop counting as pending in the inbox', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappMessageOutboxRepository(() => db);
  const { conversationId } = await conversation();
  const { record } = await repository.createIntent({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'inbox' });
  const providerId = `prov-${randomUUID()}`;
  await dispatchOutboxMessage(record.id, { repository, send: accepting(providerId) });
  await sql`INSERT INTO evolution_receipt_inbox (id, provider_message_id, status, received_at) VALUES (${randomUUID()}, ${providerId}, 'DELIVERY_ACK', now())`;
  await repository.applyReceipts(providerId);
  const [{ pending }] = await sql`SELECT count(*)::int AS pending FROM evolution_receipt_inbox WHERE provider_message_id = ${providerId} AND applied_at IS NULL`;
  assert.equal(pending, 0);
});
