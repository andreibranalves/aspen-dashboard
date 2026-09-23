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
  createPostgresWhatsappAttendanceRepository,
  WhatsappConversationChangedError,
  type IngestWhatsappConversationInput,
  type IngestWhatsappMessage,
  type WhatsappTransportIdentity,
} from '../../api/_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
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

const verified: WhatsappTransportIdentity = {
  canonicalPhone: '5511999990000',
  identityStatus: 'verified',
  identitySource: 'chat.senderPn',
  identityConfidence: 'high',
};

function message(id: string, at: string, overrides: Partial<IngestWhatsappMessage> = {}): IngestWhatsappMessage {
  return {
    providerMessageId: id,
    direction: 'inbound',
    messageType: 'text',
    body: `mensagem ${id}`,
    preview: `mensagem ${id}`,
    providerTimestamp: new Date(at),
    ...overrides,
  };
}

function input(
  instance: string,
  messages: IngestWhatsappMessage[],
  overrides: Partial<IngestWhatsappConversationInput> = {},
): IngestWhatsappConversationInput {
  return {
    instance,
    providerConversationId: '5511999990000@s.whatsapp.net',
    origin: 'live',
    contactName: 'Cliente Exemplo',
    resolveIdentity: () => verified,
    messages,
    ...overrides,
  };
}

test('ingestion deduplicates provider ids, keeps bodies verbatim and counts live unread', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const body = 'Olá!\n\n  200 canecas\n- azul';

  const first = await repository.ingestConversation(
    input(instance, [message('m1', '2026-09-01T10:00:00Z', { body })]),
  );
  const repeat = await repository.ingestConversation(
    input(instance, [message('m1', '2026-09-01T10:00:00Z', { body })]),
  );

  assert.equal(first.inserted, 1);
  assert.equal(repeat.inserted, 0);
  assert.equal(repeat.duplicates, 1);
  assert.equal(repeat.conversationId, first.conversationId);

  const conversation = await repository.getConversation(first.conversationId);
  assert.equal(conversation?.unreadCount, 1);
  assert.equal(conversation?.revision, 1);
  assert.equal(conversation?.displayName, 'Cliente Exemplo');
  assert.equal(conversation?.canonicalPhone, '5511999990000');

  const page = await repository.listMessagesBefore({ conversationId: first.conversationId, limit: 50 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].body, body);
});

test('backfill history does not raise unread, reopen or create open work', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;

  const backfilled = await repository.ingestConversation(
    input(instance, [message('b1', '2026-08-01T10:00:00Z'), message('b2', '2026-08-01T10:01:00Z')], {
      origin: 'backfill',
    }),
  );
  let conversation = await repository.getConversation(backfilled.conversationId);
  assert.equal(conversation?.status, 'closed');
  assert.equal(conversation?.unreadCount, 0);

  await repository.ingestConversation(input(instance, [message('live-1', '2026-09-01T10:00:00Z')]));
  conversation = await repository.getConversation(backfilled.conversationId);
  assert.equal(conversation?.status, 'open', 'a new live inbound message reopens the attendance');
  assert.equal(conversation?.unreadCount, 1);
  assert.equal(conversation?.lastMessagePreview, 'mensagem live-1');
});

test('older backfilled messages do not replace the latest summary but appear by revision', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;

  const live = await repository.ingestConversation(input(instance, [message('new', '2026-09-02T10:00:00Z')]));
  const before = await repository.getConversation(live.conversationId);
  await repository.ingestConversation(
    input(instance, [message('old', '2026-07-01T10:00:00Z')], { origin: 'backfill' }),
  );
  const after = await repository.getConversation(live.conversationId);

  assert.equal(after?.lastMessagePreview, 'mensagem new');
  assert.equal(after?.unreadCount, before?.unreadCount);
  const changes = await repository.listMessagesAfterRevision({
    conversationId: live.conversationId,
    afterRevision: before!.revision,
    limit: 100,
  });
  assert.deepEqual(changes.items.map((item) => item.body), ['mensagem old']);
});

test('identity version increases only when phone or status changes', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const seen: Array<WhatsappTransportIdentity | null> = [];

  const created = await repository.ingestConversation(input(instance, [message('i1', '2026-09-01T10:00:00Z')]));
  await repository.ingestConversation(
    input(instance, [message('i2', '2026-09-01T10:01:00Z')], {
      resolveIdentity: (stored) => {
        seen.push(stored);
        return stored!;
      },
    }),
  );
  assert.equal((await repository.getConversation(created.conversationId))?.identityVersion, 1);
  assert.deepEqual(seen, [verified], 'the resolver receives the stored identity');

  await repository.ingestConversation(
    input(instance, [message('i3', '2026-09-01T10:02:00Z')], {
      resolveIdentity: () => ({ canonicalPhone: '', identityStatus: 'conflict', identitySource: null, identityConfidence: null }),
    }),
  );
  const conflicted = await repository.getConversation(created.conversationId);
  assert.equal(conflicted?.identityVersion, 2);
  assert.equal(conflicted?.identityStatus, 'conflict');
  assert.equal(conflicted?.canonicalPhone, null);
});

test('history pages stay complete beyond the old KV window', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const start = Date.parse('2026-01-01T00:00:00Z');
  const batch = Array.from({ length: 150 }, (_, index) =>
    message(`p${index}`, new Date(start + index * 60_000).toISOString()),
  );
  const { conversationId } = await repository.ingestConversation(input(instance, batch));

  const seen: string[] = [];
  let before = null;
  for (;;) {
    const page = await repository.listMessagesBefore({ conversationId, before, limit: 50 });
    seen.unshift(...page.items.map((item) => item.body || ''));
    if (!page.hasMore) break;
    const oldest = page.items[0];
    before = { at: oldest.providerTimestamp, id: oldest.id };
  }
  assert.equal(seen.length, 150);
  assert.equal(seen[0], 'mensagem p0');
  assert.equal(seen[149], 'mensagem p149');
});

test('concurrent ingestion of the same event stores one message and sequential revisions', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const { conversationId } = await repository.ingestConversation(input(instance, [message('c0', '2026-09-01T09:00:00Z')]));

  const results = await Promise.all([
    repository.ingestConversation(input(instance, [message('c1', '2026-09-01T10:00:00Z')])),
    repository.ingestConversation(input(instance, [message('c1', '2026-09-01T10:00:00Z')])),
    repository.ingestConversation(input(instance, [message('c2', '2026-09-01T10:00:01Z')])),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.inserted, 0), 2);

  const changes = await repository.listMessagesAfterRevision({ conversationId, afterRevision: 0, limit: 100 });
  assert.deepEqual(
    changes.items.map((item) => item.revision),
    [1, 2, 3],
  );
  assert.equal((await repository.getConversation(conversationId))?.unreadCount, 3);
});

test('read cursor only advances and never marks a message that arrived after the viewed position', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const { conversationId } = await repository.ingestConversation(
    input(instance, [message('r1', '2026-09-01T10:00:00Z'), message('r2', '2026-09-01T10:01:00Z')]),
  );
  const viewed = await repository.getConversation(conversationId);
  // A message arrives while the operator is still looking at revision 2.
  await repository.ingestConversation(input(instance, [message('r3', '2026-09-01T10:02:00Z')]));

  const read = await repository.markRead({ id: conversationId, readRevision: viewed!.revision });
  assert.equal(read?.readRevision, 2);
  assert.equal(read?.unreadCount, 1, 'the unseen message stays unread');

  const stale = await repository.markRead({ id: conversationId, readRevision: 1 });
  assert.equal(stale?.readRevision, 2, 'the cursor never moves back');
  assert.equal(stale?.unreadCount, 1);

  const beyond = await repository.markRead({ id: conversationId, readRevision: 999 });
  assert.equal(beyond?.readRevision, 3, 'the cursor is clamped to the committed revision');
  assert.equal(beyond?.unreadCount, 0);
});

test('status change is refused when a message arrived after the operator view', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const { conversationId } = await repository.ingestConversation(input(instance, [message('s1', '2026-09-01T10:00:00Z')]));
  const viewed = await repository.getConversation(conversationId);
  await repository.ingestConversation(input(instance, [message('s2', '2026-09-01T10:01:00Z')]));

  await assert.rejects(
    repository.updateStatus({ id: conversationId, status: 'closed', expectedRevision: viewed!.revision }),
    WhatsappConversationChangedError,
  );
  const current = await repository.getConversation(conversationId);
  const closed = await repository.updateStatus({ id: conversationId, status: 'closed', expectedRevision: current!.revision });
  assert.equal(closed?.status, 'closed');
  assert.equal(closed?.revision, current!.revision + 1);

  await repository.updateStatus({ id: conversationId, status: 'ignored', expectedRevision: closed!.revision });
  await repository.ingestConversation(input(instance, [message('s3', '2026-09-01T10:02:00Z')]));
  assert.equal((await repository.getConversation(conversationId))?.status, 'ignored', 'ignored is never reopened');
});

test('250 conversations stay reachable through the cursor with status and search filters', { skip: databaseSkip }, async () => {
  const repository = createPostgresWhatsappAttendanceRepository(() => db);
  const instance = `test-${randomUUID()}`;
  const start = Date.parse('2026-06-01T00:00:00Z');
  for (let index = 0; index < 250; index += 1) {
    await repository.ingestConversation(
      input(instance, [message(`l${index}`, new Date(start + index * 1000).toISOString())], {
        providerConversationId: `55119${String(index).padStart(8, '0')}@s.whatsapp.net`,
        contactName: index === 42 ? 'Maria 50% Souza' : `Contato ${index}`,
        resolveIdentity: () => ({ ...verified, canonicalPhone: `55119${String(index).padStart(8, '0')}` }),
      }),
    );
  }

  const ids = new Set<string>();
  let cursor = null;
  for (;;) {
    const page = await repository.listConversations({ instance, limit: 100, cursor });
    for (const item of page.items) ids.add(item.id);
    if (!page.hasMore) break;
    const last = page.items.at(-1)!;
    cursor = { at: last.lastMessageAt!, id: last.id };
  }
  assert.equal(ids.size, 250);

  const byName = await repository.listConversations({ instance, limit: 10, search: '50%' });
  assert.deepEqual(byName.items.map((item) => item.displayName), ['Maria 50% Souza']);
  const byPhone = await repository.listConversations({ instance, limit: 10, search: '(11) 9 0000-0042' });
  assert.equal(byPhone.items.length, 1);
  assert.equal((await repository.listConversations({ instance, limit: 10, status: 'ignored' })).items.length, 0);
  assert.equal((await repository.listConversations({ instance: `other-${randomUUID()}`, limit: 10 })).items.length, 0);
});
