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
import { createPostgresWhatsappBackfillRepository } from '../../api/_infrastructure/db/repositories/whatsapp-backfill-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { createHttpError } from '../../api/_shared/http-error.js';
import type { EvolutionMessagePage } from '../../api/_modules/evolution-history.js';
import {
  BACKFILL_PAGE_SIZE,
  handler,
  runWhatsappBackfill,
  type WhatsappBackfillDependencies,
} from '../../api/_modules/whatsapp-backfill.js';
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

const PN = '5511999990000@s.whatsapp.net';
const LID = '183792384719283741@lid';

function providerMessage(jid: string, index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `evolution-row-${jid}-${index}`,
    key: { id: `${jid}-m${index}`, remoteJid: jid, fromMe: index % 2 === 1 },
    pushName: index % 2 === 1 ? 'Operador' : 'Cliente Exemplo',
    messageTimestamp: 1_756_000_000 + index * 60,
    message: { conversation: `linha ${index}\nsegunda linha` },
    ...overrides,
  };
}

function deps(instance: string, history: Record<string, Array<Record<string, unknown>>>, paginated = true) {
  const requested: string[] = [];
  const dependencies: WhatsappBackfillDependencies = {
    instance: () => instance,
    repository: createPostgresWhatsappBackfillRepository(() => db),
    attendanceRepository: createPostgresWhatsappAttendanceRepository(() => db),
    fetchChats: async () => [
      ...Object.keys(history).map((remoteJid) => ({ remoteJid })),
      { remoteJid: '120363000000000000@g.us' },
      { remoteJid: 'status@broadcast' },
    ],
    fetchMessagePage: async (jid, page, pageSize): Promise<EvolutionMessagePage> => {
      requested.push(`${jid}#${page}`);
      const all = history[jid] || [];
      const pages = Math.max(1, Math.ceil(all.length / pageSize));
      return {
        records: all.slice((page - 1) * pageSize, page * pageSize),
        pages: paginated ? pages : null,
      };
    },
  };
  return { dependencies, requested };
}

async function conversationRows(instance: string) {
  return sql`SELECT id, provider_conversation_id, status, unread_count, revision FROM whatsapp_conversations WHERE instance = ${instance} ORDER BY provider_conversation_id`;
}

test('backfill pages through history, skips groups and keeps PN and LID apart', { skip: databaseSkip }, async () => {
  const instance = `test-${randomUUID()}`;
  const history = {
    [PN]: Array.from({ length: BACKFILL_PAGE_SIZE + 20 }, (_, index) => providerMessage(PN, index)),
    [LID]: [providerMessage(LID, 0)],
  };
  const { dependencies, requested } = deps(instance, history);

  const result = await runWhatsappBackfill({ discover: false }, dependencies);
  assert.equal(result.discovered, 2);
  assert.equal(result.messagesInserted, BACKFILL_PAGE_SIZE + 21);
  assert.deepEqual(requested, [`${LID}#1`, `${PN}#1`, `${PN}#2`]);
  assert.deepEqual(result.summary, {
    conversations: 2,
    pending: 0,
    done: 2,
    gaps: 0,
    messagesSeen: BACKFILL_PAGE_SIZE + 21,
    messagesInserted: BACKFILL_PAGE_SIZE + 21,
    lastRunAt: result.summary.lastRunAt,
  });

  const rows = await conversationRows(instance);
  assert.equal(rows.length, 2, 'PN and LID histories are separate conversations');
  for (const row of rows) {
    assert.equal(row.status, 'closed', 'history does not open attendances');
    assert.equal(row.unread_count, 0, 'history does not create unread messages');
  }
  const [stored] = await sql`SELECT body, origin FROM whatsapp_messages m JOIN whatsapp_conversations c ON c.id = m.conversation_id WHERE c.instance = ${instance} AND m.provider_message_id = ${`${PN}-m0`}`;
  assert.equal(stored.body, 'linha 0\nsegunda linha');
  assert.equal(stored.origin, 'backfill');
  const [name] = await sql`SELECT display_name FROM whatsapp_conversations WHERE instance = ${instance} AND provider_conversation_id = ${PN}`;
  assert.equal(name.display_name, 'Cliente Exemplo', 'the operator pushName never names the contact');
  const effects = await sql`SELECT count(*)::int AS total FROM whatsapp_webhook_effects WHERE instance = ${instance}`;
  assert.equal(effects[0].total, 0, 'history never triggers activity or follow-up effects');
});

test('repeating the backfill keeps local ids and counts', { skip: databaseSkip }, async () => {
  const instance = `test-${randomUUID()}`;
  const { dependencies } = deps(instance, { [PN]: [providerMessage(PN, 0), providerMessage(PN, 1)] });
  await runWhatsappBackfill({ discover: false }, dependencies);
  const before = await conversationRows(instance);
  const messagesBefore = await sql`SELECT id FROM whatsapp_messages WHERE conversation_id = ${before[0].id} ORDER BY id`;

  await sql`UPDATE whatsapp_backfill_progress SET state = 'pending', next_page = 1 WHERE instance = ${instance}`;
  const again = await runWhatsappBackfill({ discover: true }, dependencies);
  assert.equal(again.discovered, 0);
  assert.equal(again.messagesInserted, 0);
  const after = await conversationRows(instance);
  assert.deepEqual(after, before);
  const messagesAfter = await sql`SELECT id FROM whatsapp_messages WHERE conversation_id = ${before[0].id} ORDER BY id`;
  assert.deepEqual(messagesAfter, messagesBefore);
});

test('a full page without pagination metadata is declared as a gap', { skip: databaseSkip }, async () => {
  const instance = `test-${randomUUID()}`;
  const history = { [PN]: Array.from({ length: BACKFILL_PAGE_SIZE }, (_, index) => providerMessage(PN, index)) };
  const { dependencies, requested } = deps(instance, history, false);
  const result = await runWhatsappBackfill({ discover: false }, dependencies);
  assert.equal(result.summary.gaps, 1);
  assert.deepEqual(requested, [`${PN}#1`]);
  const [row] = await sql`SELECT state, gap_reason FROM whatsapp_backfill_progress WHERE instance = ${instance}`;
  assert.deepEqual({ ...row }, { state: 'gap', gap_reason: 'pagination_unavailable' });
});

test('records without a real message id or timestamp are skipped, never invented', { skip: databaseSkip }, async () => {
  const instance = `test-${randomUUID()}`;
  const history = {
    [PN]: [
      providerMessage(PN, 0),
      providerMessage(PN, 2, { key: { remoteJid: PN, fromMe: false } }),
      providerMessage(PN, 4, { messageTimestamp: undefined }),
    ],
  };
  const { dependencies } = deps(instance, history);
  const result = await runWhatsappBackfill({ discover: false }, dependencies);
  assert.equal(result.messagesInserted, 1);
  assert.equal(result.skipped, 2);
});

test('a provider failure keeps progress and the next run resumes the same page', { skip: databaseSkip }, async () => {
  const instance = `test-${randomUUID()}`;
  const history = { [PN]: Array.from({ length: BACKFILL_PAGE_SIZE + 5 }, (_, index) => providerMessage(PN, index)) };
  const { dependencies } = deps(instance, history);
  const fetchPage = dependencies.fetchMessagePage!;
  let calls = 0;
  dependencies.fetchMessagePage = async (jid, page, size) => {
    calls += 1;
    if (calls === 2) throw createHttpError(504, 'Tempo limite ao sincronizar conversas do WhatsApp.');
    return fetchPage(jid, page, size);
  };

  const failed = await runWhatsappBackfill({ discover: false }, dependencies);
  assert.equal(failed.providerUnavailable, true);
  assert.equal(failed.summary.pending, 1);

  const resumed = await runWhatsappBackfill({ discover: false }, dependencies);
  assert.equal(resumed.providerUnavailable, false);
  assert.equal(resumed.messagesInserted, 5);
  assert.equal(resumed.summary.done, 1);
});

test('backfill endpoint requires the machine secret', { skip: databaseSkip }, async () => {
  const instance = `test-${randomUUID()}`;
  const { dependencies } = deps(instance, {});
  const secret = 's'.repeat(32);
  const denied = await handler(
    { httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '' },
    { ...dependencies, environment: { CRON_SECRET: secret } },
  );
  assert.equal(denied.statusCode, 401);
  const status = await handler(
    { httpMethod: 'GET', headers: { authorization: `Bearer ${secret}` }, queryStringParameters: {}, body: '' },
    { ...dependencies, environment: { CRON_SECRET: secret } },
  );
  assert.equal(status.statusCode, 200);
  assert.equal(JSON.parse(status.body || '{}').summary.conversations, 0);
});
