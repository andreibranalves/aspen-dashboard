import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import { createPostgresQuotationDeliveryOutboxRepository } from '../../api/_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';
import { createPostgresQuotationFollowUpRepository } from '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.js';
import { createPostgresWhatsappAttendanceRepository } from '../../api/_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import { createPostgresWhatsappContactActivityRepository } from '../../api/_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';
import { createPostgresWhatsappMessageOutboxRepository } from '../../api/_infrastructure/db/repositories/whatsapp-message-outbox-repository.js';
import { createPostgresWhatsappWebhookEffectsRepository } from '../../api/_infrastructure/db/repositories/whatsapp-webhook-effects-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { handler as webhook } from '../../api/_modules/evolution-webhook.js';
import { createQuotationDeliveryModule } from '../../api/_modules/quotation-delivery-outbox.js';
import {
  createWhatsappConversationsHandler,
  createWhatsappMessagesHandler,
} from '../../api/_modules/whatsapp-attendance.js';
import type { SendText } from '../../api/_modules/whatsapp-message-dispatch.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

// AC-35 at handler level: receive → open → reply → receipt, every step through
// the real handlers and PostgreSQL. Only the Evolution transport is simulated.

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

const webhookSecret = 'w'.repeat(32);
const PHONE = '5511988887777';
const JID = `${PHONE}@s.whatsapp.net`;

function request(httpMethod: string, body?: unknown, query: Record<string, string> = {}) {
  return {
    httpMethod,
    headers: { authorization: `Bearer ${webhookSecret}` },
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function parsed(result: { statusCode: number; body?: string }) {
  return JSON.parse(result.body || '{}');
}

function journey() {
  const getDb = () => db;
  const instance = `journey-${randomUUID()}`;
  const attendance = createPostgresWhatsappAttendanceRepository(getDb);
  const outbox = createPostgresWhatsappMessageOutboxRepository(getDb);
  const activity = createPostgresWhatsappContactActivityRepository(getDb);
  const followUps = createPostgresQuotationFollowUpRepository(getDb);
  const receive = (payload: unknown) =>
    webhook(request('POST', payload), {
      deliveryModule: createQuotationDeliveryModule({
        instance,
        repository: createPostgresQuotationDeliveryOutboxRepository(getDb),
        followUpRepository: followUps,
        activityRepository: activity,
      }),
      activityRepository: activity,
      followUpRepository: followUps,
      attendanceRepository: attendance,
      effectsRepository: createPostgresWhatsappWebhookEffectsRepository(getDb),
      outboxRepository: outbox,
      environment: { EVOLUTION_WEBHOOK_SECRET: webhookSecret, EVOLUTION_INSTANCE: instance },
    });
  const sent: string[] = [];
  const providerMessageId = `prov-${randomUUID()}`;
  const send: SendText = async ({ text }) => {
    sent.push(text);
    return { providerMessageId };
  };
  const dependencies = { repository: attendance, instance: () => instance, send: { repository: outbox, send } };
  return {
    instance,
    receive,
    sent,
    providerMessageId,
    conversations: createWhatsappConversationsHandler(dependencies),
    messages: createWhatsappMessagesHandler(dependencies),
  };
}

test('AC-35: an inbound message is opened, answered and its receipt reaches the timeline', { skip: databaseSkip }, async () => {
  const flow = journey();

  // Receive.
  const inbound = await flow.receive({
    event: 'MESSAGES_UPSERT',
    instance: flow.instance,
    data: {
      key: { id: `in-${randomUUID()}`, remoteJid: JID, fromMe: false },
      pushName: 'Cliente Jornada',
      messageTimestamp: Math.floor(Date.now() / 1000) - 60,
      message: { conversation: 'Bom dia, queria um orçamento' },
    },
  });
  assert.equal(inbound.statusCode, 200);

  // Open: the conversation is listed unread and its timeline shows the message.
  const list = parsed(await flow.conversations(request('GET', undefined, { status: 'active' })));
  assert.equal(list.items.length, 1);
  const [listed] = list.items;
  assert.equal(listed.unreadCount, 1);
  assert.equal(listed.lastMessagePreview, 'Bom dia, queria um orçamento');

  const opened = parsed(await flow.messages(request('GET', undefined, { conversationId: listed.id })));
  assert.deepEqual(opened.items.map((item: { direction: string }) => item.direction), ['inbound']);
  const read = parsed(await flow.conversations(request('PATCH', { id: listed.id, readRevision: opened.revision })));
  assert.equal(read.conversation.unreadCount, 0);

  // Reply: one transport, accepted synchronously.
  const reply = await flow.messages(
    request('POST', {
      clientRequestId: randomUUID(),
      conversationId: listed.id,
      expectedIdentityVersion: opened.conversation.identityVersion,
      body: 'Bom dia! Já te envio.',
    }),
  );
  assert.equal(reply.statusCode, 202);
  assert.equal(parsed(reply).message.state, 'provider_accepted');
  assert.deepEqual(flow.sent, ['Bom dia! Já te envio.']);

  // The provider echo of the reply converges instead of adding a second bubble.
  const echo = await flow.receive({
    event: 'MESSAGES_UPSERT',
    instance: flow.instance,
    data: {
      key: { id: flow.providerMessageId, remoteJid: JID, fromMe: true },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: 'Bom dia! Já te envio.' },
    },
  });
  assert.equal(echo.statusCode, 200);

  // Receipt.
  const receipt = await flow.receive({
    event: 'MESSAGES_UPDATE',
    instance: flow.instance,
    data: { keyId: flow.providerMessageId, remoteJid: JID, fromMe: true, status: 'DELIVERY_ACK' },
  });
  assert.equal(receipt.statusCode, 200);

  // The incremental read the open conversation polls with sees the receipt.
  const changes = parsed(
    await flow.messages(request('GET', undefined, { conversationId: listed.id, afterRevision: String(read.conversation.readRevision) })),
  );
  const outbound = changes.items.filter((item: { direction: string }) => item.direction === 'outbound');
  assert.equal(outbound.length, 1, 'the echo never shows as a second bubble');
  assert.equal(outbound[0].outboxState, 'provider_accepted');
  assert.equal(outbound[0].deliveryStatus, 'delivered');

  const timeline = parsed(await flow.messages(request('GET', undefined, { conversationId: listed.id })));
  assert.deepEqual(
    timeline.items.map((item: { direction: string; deliveryStatus: string | null }) => [item.direction, item.deliveryStatus]),
    [
      ['inbound', null],
      ['outbound', 'delivered'],
    ],
  );
  assert.equal(timeline.conversation.unreadCount, 0, 'the own reply and its echo never count as unread');
  assert.deepEqual(flow.sent, ['Bom dia! Já te envio.'], 'no step transported again');
});
