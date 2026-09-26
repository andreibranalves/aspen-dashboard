// Contract tests against sanitized fixtures captured from the installed Evolution
// 2.3.7 (#296). Regenerate with scripts/capture-evolution-fixtures.mjs.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { receiveEvolutionWebhook } from '../../api/_modules/evolution-webhook.js';
import { createReceivedMediaHandler } from '../../api/_modules/whatsapp-message-media.js';
import { sendOperatorMedia } from '../../api/_modules/evolution-transport.js';
import type { IngestWhatsappConversationInput } from '../../api/_infrastructure/db/repositories/whatsapp-attendance-repository.js';

function fixture<T = Record<string, unknown>>(name: string): T {
  const url = new URL(`../fixtures/evolution-installed/${name}.json`, import.meta.url);
  return (JSON.parse(readFileSync(url, 'utf8')) as { payload: T }).payload;
}

const secret = 's'.repeat(32);
const instance = 'instance-test';

/** Como o worker atende: responde e depois aplica os efeitos adiados. */
async function webhook(...args: Parameters<typeof receiveEvolutionWebhook>) {
  const { response, afterResponse } = await receiveEvolutionWebhook(...args);
  if (afterResponse) assert.equal(await afterResponse(), true);
  return response;
}

function webhookDependencies() {
  const history: IngestWhatsappConversationInput[] = [];
  const receipts: string[] = [];
  return {
    history,
    receipts,
    deliveryModule: { applyEvolutionEvent: async () => ({ id: 'delivery-test' }) },
    activityRepository: {
      recordActivity: async () => undefined,
      getHealth: async () => null,
      blockIngestion: async () => undefined,
      unblockIngestionIfEvent: async () => false,
      markIngestion: async () => undefined,
    },
    followUpRepository: { applyConversationToOpenFollowUps: async () => undefined },
    effectsRepository: {
      register: async (inputs: Array<Record<string, unknown>>) =>
        inputs.map((input, index) => ({ ...input, id: `effect-${index}`, activityDone: true, followUpDone: true, attempts: 0 })),
      markDone: async () => undefined,
      markFailed: async () => undefined,
    },
    outboxRepository: {
      applyReceipts: async (providerMessageId: string) => {
        receipts.push(providerMessageId);
        return 1;
      },
    },
    attendanceRepository: {
      ingestConversation: async (value: IngestWhatsappConversationInput) => {
        history.push(value);
        return { conversationId: 'conversation-test', inserted: value.messages.length, duplicates: 0 };
      },
    },
    environment: { EVOLUTION_WEBHOOK_SECRET: secret, EVOLUTION_INSTANCE: instance },
  };
}

function post(body: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    queryStringParameters: {},
    body: JSON.stringify(body),
  } as const;
}

const upserts = [
  ['upsert-inbound-text', 'inbound', 'text'],
  ['upsert-outbound-echo', 'outbound', 'text'],
  ['upsert-inbound-image', 'inbound', 'image'],
  ['upsert-inbound-pdf', 'inbound', 'document'],
  ['upsert-inbound-audio', 'inbound', 'audio'],
] as const;

for (const [name, direction, messageType] of upserts) {
  test(`installed ${name} lands in the LID conversation with the phone from remoteJidAlt`, async () => {
    const data = fixture<{ key: { id: string; remoteJid: string; remoteJidAlt: string } }>(name);
    const deps = webhookDependencies();
    const result = await webhook(post({ event: 'messages.upsert', instance, data }), deps as never);

    assert.equal(result.statusCode, 200);
    assert.equal(deps.history.length, 1);
    const [ingest] = deps.history;
    assert.equal(ingest.providerConversationId, data.key.remoteJid);
    assert.match(ingest.providerConversationId, /@lid$/);
    assert.equal(ingest.messages[0].providerMessageId, data.key.id);
    assert.equal(ingest.messages[0].direction, direction);
    assert.equal(ingest.messages[0].messageType, messageType);
    const identity = ingest.resolveIdentity(null);
    assert.equal(identity.canonicalPhone, data.key.remoteJidAlt.split('@')[0]);
  });
}

test('installed messages.update receipts reach the outbox by keyId', async () => {
  const [receipt] = fixture<Array<Record<string, unknown>>>('update-receipts');
  const deps = webhookDependencies();
  const result = await webhook(post({ event: 'messages.update', instance, data: receipt }), deps as never);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(deps.receipts, [receipt.keyId]);
});

test('installed findMessages paginates newest first without overlap', () => {
  const pagination = fixture<{ pages: number; page1: Array<{ id: string; messageTimestamp: number }>; page2: Array<{ id: string; messageTimestamp: number }> }>('find-messages-pagination');
  assert.ok(pagination.pages >= 2);
  const first = new Set(pagination.page1.map((entry) => entry.id));
  assert.ok(pagination.page2.every((entry) => !first.has(entry.id)));
  const timestamps = [...pagination.page1, ...pagination.page2].map((entry) => entry.messageTimestamp);
  assert.deepEqual(timestamps, [...timestamps].sort((a, b) => b - a));
});

const samples: Record<string, Buffer> = {
  image: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]),
  document: Buffer.from('%PDF-1.4\n%%EOF\n'),
  audio: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(24), Buffer.from('OpusHead'), Buffer.alloc(16)]),
};

for (const [type, name, expectedMime] of [
  ['image', 'media-base64-image', 'image/jpeg'],
  ['document', 'media-base64-pdf', 'application/pdf'],
  ['audio', 'media-base64-audio', 'audio/ogg'],
] as const) {
  test(`installed getBase64FromMediaMessage response for ${type} is served privately`, async () => {
    const captured = fixture<{ status: number; response: Record<string, unknown> }>(name);
    const id = '00000000-0000-4000-8000-000000000001';
    const handler = createReceivedMediaHandler({
      findMessage: async () => ({
        id, conversationId: '00000000-0000-4000-8000-000000000002', providerMessageId: 'provider-1',
        direction: 'inbound', type, instance: 'installed', providerConversationId: '100000000001@lid',
      }),
      client: {
        config: () => ({ instance: 'installed', baseUrl: 'https://example.test', apiKey: 'test' }),
        request: async () =>
          new Response(JSON.stringify({ ...captured.response, base64: samples[type].toString('base64') }), { status: captured.status }),
      },
    } as never);

    const result = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id }, body: '' });
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers?.['Content-Type'], expectedMime);
    assert.deepEqual(Buffer.from(result.body || '', 'base64'), samples[type]);
  });
}

for (const [name, mediaType, mimeType, bytes] of [
  ['send-media-image', 'image', 'image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')],
  ['send-media-pdf', 'document', 'application/pdf', Buffer.from('%PDF-1.4\n%%EOF\n')],
] as const) {
  test(`installed sendMedia ${mediaType} request matches and its response yields key.id`, async () => {
    const captured = fixture<{ request: Record<string, unknown>; status: number; response: { key: { id: string } } }>(name);
    let sent: Record<string, unknown> | undefined;
    const result = await sendOperatorMedia(
      { phone: String(captured.request.number), mediaType, mimeType, base64: bytes.toString('base64'), fileName: String(captured.request.fileName), caption: 'Legenda' },
      {
        client: {
          config: () => ({ instance: 'installed', baseUrl: 'https://example.test', apiKey: 'test' }),
          request: async (_path, body) => {
            sent = body;
            return new Response(JSON.stringify(captured.response), { status: captured.status });
          },
        },
      },
    );
    assert.deepEqual(Object.keys(sent || {}).sort(), Object.keys(captured.request).sort());
    assert.equal(sent?.mediatype, captured.request.mediatype);
    assert.equal(result.providerMessageId, captured.response.key.id);
  });
}
