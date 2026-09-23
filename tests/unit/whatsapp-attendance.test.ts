import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createWhatsappConversationsHandler,
  createWhatsappMessagesHandler,
  encodeCursor,
} from '../../api/_modules/whatsapp-attendance.js';
import {
  WhatsappConversationChangedError,
  type WhatsappAttendanceRepository,
  type WhatsappConversationRecord,
  type WhatsappMessageRecord,
} from '../../api/_infrastructure/db/repositories/whatsapp-attendance-repository.js';

const conversationId = '0b9f1e52-7c1f-4d0e-9a51-3f7d3c1a2b40';

const conversation: WhatsappConversationRecord = {
  id: conversationId,
  canonicalPhone: '5511999990000',
  identityStatus: 'verified',
  identityVersion: 1,
  displayName: 'Cliente Exemplo',
  status: 'open',
  revision: 7,
  readRevision: 5,
  unreadCount: 2,
  lastMessageAt: new Date('2026-09-01T10:00:00Z'),
  lastMessagePreview: 'Olá',
  lastMessageDirection: 'inbound',
};

function messageRecord(id: string, revision: number): WhatsappMessageRecord {
  return {
    id,
    conversationId,
    direction: 'inbound',
    messageType: 'text',
    body: 'linha 1\nlinha 2',
    origin: 'live',
    providerTimestamp: new Date('2026-09-01T10:00:00Z'),
    createdRevision: revision,
    revision,
  };
}

function repository(overrides: Partial<WhatsappAttendanceRepository> = {}): WhatsappAttendanceRepository {
  return {
    ingestConversation: async () => {
      throw new Error('not used');
    },
    updateStatus: async (input) => ({ ...conversation, status: input.status, revision: input.expectedRevision + 1 }),
    markRead: async (input) => ({ ...conversation, readRevision: input.readRevision, unreadCount: 0 }),
    listConversations: async () => ({ items: [conversation], hasMore: true }),
    getConversation: async (id) => (id === conversationId ? conversation : null),
    listMessagesBefore: async () => ({ items: [messageRecord('a1b2c3d4-0000-4000-8000-000000000001', 7)], hasMore: false }),
    listMessagesAfterRevision: async () => ({ items: [], hasMore: false }),
    ...overrides,
  };
}

function get(query: Record<string, string>) {
  return { httpMethod: 'GET', headers: {}, queryStringParameters: query, body: '' };
}

describe('whatsapp attendance handlers', () => {
  it('lists conversations without exposing provider identifiers', async () => {
    let received: unknown;
    const handler = createWhatsappConversationsHandler({
      instance: () => 'aspen',
      repository: repository({
        listConversations: async (input) => {
          received = input;
          return { items: [conversation], hasMore: true };
        },
      }),
    });
    const result = await handler(get({ status: 'active', q: 'Maria', limit: '20' }));
    const body = JSON.parse(result.body || '{}');

    assert.equal(result.statusCode, 200);
    assert.deepEqual(received, { instance: 'aspen', status: 'active', search: 'Maria', limit: 20, cursor: null });
    assert.equal(body.items[0].phone, '5511999990000');
    assert.equal(JSON.stringify(body).includes('providerConversationId'), false);
    assert.equal(JSON.stringify(body).includes('@s.whatsapp.net'), false);
    assert.equal(
      body.nextCursor,
      encodeCursor({ at: conversation.lastMessageAt!, id: conversation.id }),
    );
  });

  it('rejects invalid ids, cursors, statuses and limits with pt-BR messages', async () => {
    const conversations = createWhatsappConversationsHandler({
      instance: () => 'aspen',
      repository: repository(),
    });
    const messages = createWhatsappMessagesHandler({ repository: repository() });

    for (const result of [
      await conversations(get({ id: 'x' })),
      await conversations(get({ cursor: 'lixo' })),
      await conversations(get({ status: 'pending' })),
      await conversations(get({ limit: '101' })),
      await messages(get({ conversationId: conversationId, afterRevision: '-1' })),
      await messages(get({ conversationId: conversationId, afterRevision: '1', before: 'x' })),
    ]) {
      assert.equal(result.statusCode, 400);
      assert.match(JSON.parse(result.body || '{}').error, /inválid|Use before|limite/);
    }
    assert.equal((await conversations(get({ id: 'a1b2c3d4-0000-4000-8000-00000000ffff' }))).statusCode, 404);
    assert.equal((await conversations({ ...get({}), httpMethod: 'POST' })).statusCode, 405);
  });

  it('returns the history page with body verbatim and the pre-read revision', async () => {
    const handler = createWhatsappMessagesHandler({ repository: repository() });
    const result = await handler(get({ conversationId }));
    const body = JSON.parse(result.body || '{}');

    assert.equal(result.statusCode, 200);
    assert.equal(body.items[0].body, 'linha 1\nlinha 2');
    assert.equal(body.revision, 7);
    assert.equal(body.nextCursor, null);
  });

  it('never advances the incremental revision past an unreturned page', async () => {
    const handler = createWhatsappMessagesHandler({
      repository: repository({
        listMessagesAfterRevision: async () => ({
          items: [messageRecord('a1b2c3d4-0000-4000-8000-000000000002', 6)],
          hasMore: true,
        }),
      }),
    });
    const partial = JSON.parse((await handler(get({ conversationId, afterRevision: '5', limit: '1' }))).body || '{}');
    assert.equal(partial.revision, 6);
    assert.equal(partial.hasMore, true);

    const complete = createWhatsappMessagesHandler({ repository: repository() });
    const done = JSON.parse((await complete(get({ conversationId, afterRevision: '5' }))).body || '{}');
    assert.equal(done.revision, 7);
  });

  it('hides database failures behind a neutral message', async () => {
    const handler = createWhatsappConversationsHandler({
      instance: () => 'aspen',
      repository: repository({
        listConversations: async () => {
          throw new Error('relation "whatsapp_conversations" does not exist');
        },
      }),
    });
    const result = await handler(get({}));
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.parse(result.body || '{}').error, 'Não foi possível carregar as conversas. Tente novamente.');
  });

  it('patches status with the expected revision and read position separately', async () => {
    const handler = createWhatsappConversationsHandler({ repository: repository() });
    const patch = (body: unknown) =>
      handler({ httpMethod: 'PATCH', headers: {}, queryStringParameters: {}, body: JSON.stringify(body) });

    const closed = await patch({ id: conversationId, status: 'closed', expectedRevision: 7 });
    assert.equal(closed.statusCode, 200);
    assert.equal(JSON.parse(closed.body || '{}').conversation.status, 'closed');

    const read = await patch({ id: conversationId, readRevision: 7 });
    assert.equal(JSON.parse(read.body || '{}').conversation.unreadCount, 0);

    assert.equal((await patch({ id: conversationId, status: 'closed' })).statusCode, 400);
    assert.equal((await patch({ id: conversationId, status: 'closed', readRevision: 1, expectedRevision: 7 })).statusCode, 400);
    assert.equal((await patch({ id: conversationId, status: 'archived', expectedRevision: 7 })).statusCode, 400);
  });

  it('answers 409 CONVERSATION_CHANGED with the current state on a stale status change', async () => {
    const handler = createWhatsappConversationsHandler({
      repository: repository({
        updateStatus: async () => {
          throw new WhatsappConversationChangedError({ ...conversation, revision: 8 });
        },
      }),
    });
    const result = await handler({
      httpMethod: 'PATCH',
      headers: {},
      queryStringParameters: {},
      body: JSON.stringify({ id: conversationId, status: 'closed', expectedRevision: 7 }),
    });
    const body = JSON.parse(result.body || '{}');
    assert.equal(result.statusCode, 409);
    assert.equal(body.code, 'CONVERSATION_CHANGED');
    assert.equal(body.conversation.revision, 8);
  });
});
