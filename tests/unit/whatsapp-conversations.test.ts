import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/_functions/whatsapp-conversations.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from '../../api/_functions/lib/whatsapp-conversations-store.js';

function parse(result: any): any {
  return JSON.parse(result.body || '{}');
}

function makeDeps(): WhatsappConversationStoreDeps & {
  fetchChats: any;
  fetchMessages: any;
} {
  let conversations: WhatsappConversation[] = [];
  const messages = new Map<string, any[]>();
  let nextId = 1;

  return {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => `wa_${nextId++}`,
    readConversations: async () => conversations,
    writeConversations: async (value) => {
      conversations = value;
    },
    readMessages: async (conversationId) => messages.get(conversationId) || [],
    writeMessages: async (conversationId, value) => {
      messages.set(conversationId, value);
    },
    fetchChats: async () => [
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        pushName: 'Maria',
        updatedAt: 1782916800,
        lastMessage: { text: 'Quero orçamento' },
      },
    ],
    fetchMessages: async () => [
      {
        key: { id: 'm1', fromMe: false },
        messageTimestamp: 1782916800,
        message: { conversation: 'Quero orçamento' },
      },
    ],
  };
}

describe('whatsapp-conversations handler', () => {
  it('syncs conversations with POST /sync', async () => {
    const handler = createHandler(makeDeps());
    const result = await handler({
      httpMethod: 'POST',
      url: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).success, true);
    assert.equal(parse(result).data.conversations.length, 1);
  });

  it('lists conversations', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    await handler({
      httpMethod: 'POST',
      url: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);

    const result = await handler({
      httpMethod: 'GET',
      url: '/api/whatsapp-conversations',
      queryStringParameters: { limit: '50' },
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data[0].displayName, 'Maria');
  });

  it('returns messages for a conversation', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    const syncResult = await handler({
      httpMethod: 'POST',
      url: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'GET',
      url: `/api/whatsapp-conversations/${id}/messages`,
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data[0].body, 'Quero orçamento');
  });

  it('patches conversation status', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    const syncResult = await handler({
      httpMethod: 'POST',
      url: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'PATCH',
      url: `/api/whatsapp-conversations/${id}`,
      body: JSON.stringify({ status: 'waiting_customer' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data.status, 'waiting_customer');
  });

  it('returns safe Portuguese errors', async () => {
    const handler = createHandler(makeDeps());
    const result = await handler({
      httpMethod: 'GET',
      url: '/api/whatsapp-conversations/missing/messages',
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 404);
    assert.match(parse(result).error, /Conversa do WhatsApp não encontrada/);
  });

  it('extracts quote payload from recent messages', async () => {
    const deps = makeDeps();
    const handler = createHandler({
      ...deps,
      extractOrders: async (text: string) => {
        assert.match(text, /Quero orçamento/);
        return [{ produto: 'Canga', quantidade: 100 }];
      },
      upsertQuoteLead: async () => ({ id: 'unused' }),
    } as any);
    const syncResult = await handler({
      httpMethod: 'POST',
      url: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'POST',
      url: `/api/whatsapp-conversations/${id}/extract-quote`,
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parse(result).data.extractedPayload.orders, [
      { produto: 'Canga', quantidade: 100 },
    ]);
  });

  it('creates whatsapp pre-quote from conversation messages', async () => {
    const deps = makeDeps();
    const handler = createHandler({
      ...deps,
      upsertQuoteLead: async (input: any) => ({
        id: 'quote_lead_1',
        source: input.source,
        telefone: input.telefone,
        pedidoTexto: input.pedidoTexto,
        status: 'ready',
        createdAt: '2026-07-01T12:00:00.000Z',
        updatedAt: '2026-07-01T12:00:00.000Z',
      }),
      extractOrders: async () => [{ produto: 'Canga', quantidade: 100 }],
    } as any);
    const syncResult = await handler({
      httpMethod: 'POST',
      url: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'POST',
      url: `/api/whatsapp-conversations/${id}/create-quote-lead`,
      body: JSON.stringify({ extractedPayload: { produto: 'Canga', quantidade: 100 } }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 201);
    assert.equal(parse(result).data.source, 'whatsapp');
    assert.equal(parse(result).data.id, 'quote_lead_1');
  });
});
