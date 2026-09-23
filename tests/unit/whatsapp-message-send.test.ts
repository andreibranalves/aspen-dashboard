import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  OutboxActionRefused,
  OutboxIntentRefused,
  type ClaimedOutbox,
  type OutboxRecord,
  type WhatsappMessageOutboxRepository,
} from '../../api/_infrastructure/db/repositories/whatsapp-message-outbox-repository.js';
import {
  createWhatsappMessageActionsHandler,
  getOperatorMessageByRequest,
  postOperatorMessage,
} from '../../api/_modules/whatsapp-message-send.js';

const conversationId = '0b9f1e52-7c1f-4d0e-9a51-3f7d3c1a2b40';

function record(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: randomUUID(),
    messageId: randomUUID(),
    conversationId,
    clientRequestId: randomUUID(),
    destinationPhone: '5511999990000',
    identityVersion: 1,
    body: 'Oi',
    state: 'queued',
    attempts: 0,
    transportStartedAt: null,
    providerMessageId: null,
    failureCode: null,
    resolution: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeRepository(overrides: Partial<WhatsappMessageOutboxRepository> = {}) {
  const intents = new Map<string, OutboxRecord>();
  const repository: WhatsappMessageOutboxRepository = {
    async createIntent(input) {
      const existing = intents.get(input.clientRequestId);
      if (existing) {
        if (existing.body !== input.body) throw new OutboxIntentRefused('idempotency_conflict');
        return { record: existing, created: false };
      }
      const created = record({ clientRequestId: input.clientRequestId, body: input.body });
      intents.set(input.clientRequestId, created);
      return { record: created, created: true };
    },
    async findByClientRequestId(id) {
      return intents.get(id) || null;
    },
    async findByMessageId(id) {
      return [...intents.values()].find((item) => item.messageId === id) || null;
    },
    async claim(id) {
      const item = [...intents.values()].find((entry) => entry.id === id);
      if (!item || item.state !== 'queued') return null;
      item.state = 'dispatching';
      return { ...item, leaseToken: 'lease' } as ClaimedOutbox;
    },
    async markTransportStarted() {
      return true;
    },
    async markAccepted(id, _lease, providerMessageId) {
      const item = [...intents.values()].find((entry) => entry.id === id)!;
      Object.assign(item, { state: 'provider_accepted', providerMessageId });
      return item;
    },
    async markFailed(id, _lease, input) {
      const item = [...intents.values()].find((entry) => entry.id === id)!;
      Object.assign(item, { state: input.state, failureCode: input.failureCode });
      return item;
    },
    async recoverExpiredLeases() {
      return { requeued: 0, toReview: 0 };
    },
    async nextDue() {
      return null;
    },
    async cancel() {
      throw new OutboxActionRefused(record({ state: 'dispatching' }));
    },
    async resolveReview(messageId, resolution) {
      return record({ messageId, state: resolution === 'confirmed_sent' ? 'provider_accepted' : 'failed', resolution });
    },
    async applyReceipts() {
      return 0;
    },
    ...overrides,
  };
  return repository;
}

function post(body: unknown) {
  return { httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: JSON.stringify(body) };
}

describe('operator message send', () => {
  it('records, dispatches once and answers 202 with the persisted state; a repeat never transports again', async () => {
    const repository = fakeRepository();
    const sent: string[] = [];
    const send = async ({ text }: { text: string }) => {
      sent.push(text);
      return { providerMessageId: 'prov-1' };
    };
    const payload = {
      clientRequestId: randomUUID(),
      conversationId,
      expectedIdentityVersion: 1,
      body: 'Olá!\r\n\r\nSegue a proposta.',
    };
    const first = await postOperatorMessage(post(payload), { repository, send });
    const repeat = await postOperatorMessage(post(payload), { repository, send });

    assert.equal(first.statusCode, 202);
    assert.equal(JSON.parse(first.body || '{}').message.state, 'provider_accepted');
    assert.deepEqual(sent, ['Olá!\n\nSegue a proposta.'], 'CRLF normalized, one transport');
    assert.equal(repeat.statusCode, 202);
    assert.equal(JSON.parse(repeat.body || '{}').message.state, 'provider_accepted');

    const lost = await getOperatorMessageByRequest(conversationId, payload.clientRequestId, { repository });
    assert.equal(JSON.parse(lost.body || '{}').message.state, 'provider_accepted');
  });

  it('maps refusals to stable pt-BR codes', async () => {
    const cases = [
      ['identity_conflict', 409, 'IDENTITY_CONFLICT'],
      ['identity_unresolved', 409, 'IDENTITY_CONFLICT'],
      ['identity_changed', 409, 'IDENTITY_CONFLICT'],
      ['idempotency_conflict', 409, 'IDEMPOTENCY_CONFLICT'],
      ['conversation_not_found', 404, 'CONVERSATION_NOT_FOUND'],
    ] as const;
    for (const [reason, status, code] of cases) {
      const repository = fakeRepository({
        createIntent: async () => {
          throw new OutboxIntentRefused(reason);
        },
      });
      const result = await postOperatorMessage(
        post({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'x' }),
        { repository },
      );
      const body = JSON.parse(result.body || '{}');
      assert.equal(result.statusCode, status);
      assert.equal(body.code, code);
      assert.ok(body.error.length > 10);
    }
  });

  it('validates body, size, controls, key and attachments before recording anything', async () => {
    let recorded = 0;
    const repository = fakeRepository({
      createIntent: async () => {
        recorded += 1;
        throw new Error('not reached');
      },
    });
    const base = { clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1 };
    const results = [
      await postOperatorMessage(post({ ...base, body: '   ' }), { repository }),
      await postOperatorMessage(post({ ...base, body: 'x'.repeat(4_001) }), { repository }),
      await postOperatorMessage(post({ ...base, body: 'a\u0007b' }), { repository }),
      await postOperatorMessage(post({ ...base, clientRequestId: 'x', body: 'ok' }), { repository }),
      await postOperatorMessage(post({ ...base, body: 'ok', attachmentIds: ['a'] }), { repository }),
    ];
    assert.deepEqual(results.map((result) => result.statusCode), [400, 400, 400, 400, 400]);
    assert.equal(JSON.parse(results[1].body || '{}').code, 'MESSAGE_TOO_LARGE');
    assert.equal(recorded, 0);
  });

  it('hides unexpected failures behind a neutral message', async () => {
    const repository = fakeRepository({
      createIntent: async () => {
        throw new Error('relation "whatsapp_message_outbox" does not exist');
      },
    });
    const result = await postOperatorMessage(
      post({ clientRequestId: randomUUID(), conversationId, expectedIdentityVersion: 1, body: 'x' }),
      { repository },
    );
    assert.equal(result.statusCode, 503);
    assert.doesNotMatch(result.body || '', /relation|outbox/);
  });

  it('answers a cancel that lost the race with 409 and the current state', async () => {
    const handler = createWhatsappMessageActionsHandler({ repository: fakeRepository() });
    const result = await handler(post({ messageId: randomUUID(), action: 'cancel' }));
    const body = JSON.parse(result.body || '{}');
    assert.equal(result.statusCode, 409);
    assert.equal(body.code, 'SEND_ALREADY_RESERVED');
    assert.equal(body.message.state, 'dispatching');

    const resolved = await handler(post({ messageId: randomUUID(), action: 'confirm_not_sent' }));
    assert.equal(JSON.parse(resolved.body || '{}').message.resolution, 'confirmed_not_sent');
    assert.equal((await handler(post({ messageId: randomUUID(), action: 'retry' }))).statusCode, 400);
  });
});
