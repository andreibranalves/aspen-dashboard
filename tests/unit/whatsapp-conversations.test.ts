import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/_functions/whatsapp-conversations.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from '../../api/_functions/lib/whatsapp-conversations-store.js';

function parse(result: any): any {
  try {
    return JSON.parse(result.body || '{}');
  } catch {
    return {};
  }
}

function makeDeps(): WhatsappConversationStoreDeps & {
  listLeads: any;
  getDoc: any;
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
    listLeads: async () => [
      {
        name: 'LEAD-100',
        lead_name: 'Maria',
        first_name: 'Maria',
        email_id: null,
        mobile_no: '5511999999999',
      },
    ],
    getDoc: async () => null,
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

const API = '/api/whatsapp-conversations';

describe('whatsapp-conversations handler', () => {
  it('syncs conversations with POST action=sync', async () => {
    const handler = createHandler(makeDeps());
    const result = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'sync' }),
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
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    const result = await handler({
      httpMethod: 'GET',
      url: API,
      queryStringParameters: { limit: '50' },
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data[0].displayName, 'Maria');
  });

  it('returns messages via query param ?messages=id', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    const syncResult = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'GET',
      url: API,
      queryStringParameters: { messages: id },
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data[0].body, 'Quero orçamento');
  });

  it('patches conversation via body id + status', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    const syncResult = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'PATCH',
      url: API,
      body: JSON.stringify({ id, status: 'waiting_customer' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data.status, 'waiting_customer');
  });

  it('returns safe Portuguese 404 for missing conversation', async () => {
    const handler = createHandler(makeDeps());
    const result = await handler({
      httpMethod: 'GET',
      url: API,
      queryStringParameters: { id: 'missing' },
      headers: {},
    } as any);

    assert.equal(result.statusCode, 404);
    assert.match(parse(result).error, /Conversa do WhatsApp não encontrada/);
  });

  it('returns crmMatch when fetching a single conversation by id', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    const syncResult = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'GET',
      url: API,
      queryStringParameters: { id },
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.ok(parse(result).data.crmMatch !== undefined);
  });

  it('returns null crmMatch when no CRM match is found', async () => {
    const deps = makeDeps();
    deps.listLeads = async () => []; // no leads exist
    const handler = createHandler(deps);
    const syncResult = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'GET',
      url: API,
      queryStringParameters: { id },
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data.crmMatch, null);
  });

  it('returns crmMatch even when CRM helpers are omitted from injected deps', async () => {
    const deps = makeDeps();
    const { listLeads: _listLeads, getDoc: _getDoc, ...depsWithoutCrm } = deps as any;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/resource/Lead?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                name: 'LEAD-100',
                lead_name: 'Maria',
                first_name: 'Maria',
                email_id: null,
                mobile_no: '5511999999999',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    try {
      const handler = createHandler(depsWithoutCrm);
      const syncResult = await handler({
        httpMethod: 'POST',
        url: API,
        body: JSON.stringify({ action: 'sync' }),
        queryStringParameters: {},
        headers: {},
      } as any);
      const id = parse(syncResult).data.conversations[0].id;

      const result = await handler({
        httpMethod: 'GET',
        url: API,
        queryStringParameters: { id },
        headers: {},
      } as any);

      assert.equal(result.statusCode, 200);
      assert.equal(parse(result).data.crmMatch?.id, 'LEAD-100');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('syncs 100 messages when refreshing a single conversation', async () => {
    const deps = makeDeps();
    let requestedLimit = 0;
    deps.fetchMessages = async (_remoteJid: string, limit: number) => {
      requestedLimit = limit;
      return [
        {
          key: { id: 'm1', fromMe: false },
          messageTimestamp: 1782916800,
          message: { conversation: 'Quero orçamento' },
        },
      ];
    };

    const handler = createHandler(deps);
    const syncResult = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'sync-messages', id }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(requestedLimit, 100);
  });

  it('extracts quote payload via POST action=extract-quote', async () => {
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
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'extract-quote', id }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parse(result).data.extractedPayload.orders, [
      { produto: 'Canga', quantidade: 100 },
    ]);
  });

  it('creates whatsapp pre-quote via POST action=create-quote-lead', async () => {
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
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({
        action: 'create-quote-lead',
        id,
        extractedPayload: { produto: 'Canga', quantidade: 100 },
      }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 201);
    assert.equal(parse(result).data.source, 'whatsapp');
    assert.equal(parse(result).data.id, 'quote_lead_1');
  });

  it('does not backfill legacy conversations when running sync', async () => {
    const deps = makeDeps();
    await deps.writeConversations([
      {
        id: 'wa_legacy',
        providerConversationId: '183792384719283741@lid',
        remoteJid: '183792384719283741@lid',
        canonicalPhone: '',
        phone: '5521981858541',
        displayLabel: '',
        displayName: 'Maria Legado',
        identityStatus: 'unresolved',
        identitySource: null,
        identityConfidence: null,
        source: 'evolution',
        status: 'new',
        lastMessageAt: '2026-07-01T12:00:00.000Z',
        lastMessagePreview: 'Oi',
        createdAt: '2026-07-01T12:00:00.000Z',
        updatedAt: '2026-07-01T12:00:00.000Z',
      },
    ] as WhatsappConversation[]);
    deps.fetchChats = async () => [];
    deps.fetchMessages = async () => [];

    const handler = createHandler(deps);
    const result = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    const stored = (await deps.readConversations())[0];
    // Backfill is NOT called during sync — legacy phone stays in `phone`, not promoted
    assert.equal(stored.canonicalPhone, '');
    assert.equal(stored.phone, '5521981858541');
    assert.equal(stored.identityStatus, 'unresolved');
  });

  it('sync does not promote legacy phone into canonical identity', async () => {
    const deps = makeDeps();
    await deps.writeConversations([
      {
        id: 'wa_legacy',
        providerConversationId: '183792384719283741@lid',
        remoteJid: '183792384719283741@lid',
        canonicalPhone: '',
        phone: '5521981858541',
        displayLabel: '',
        displayName: 'Maria Legado',
        identityStatus: 'unresolved',
        identitySource: null,
        identityConfidence: null,
        source: 'evolution',
        status: 'new',
        lastMessageAt: '2026-07-02T12:00:00.000Z',
        lastMessagePreview: 'Oi',
        createdAt: '2026-07-02T12:00:00.000Z',
        updatedAt: '2026-07-02T12:00:00.000Z',
      },
    ] as WhatsappConversation[]);
    deps.fetchChats = async () => [];
    deps.fetchMessages = async () => [];

    const handler = createHandler(deps);
    const result = await handler({
      httpMethod: 'POST',
      url: API,
      body: JSON.stringify({ action: 'sync' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    const stored = (await deps.readConversations())[0];
    assert.equal(stored.canonicalPhone, '');
    assert.equal(stored.phone, '5521981858541');
    assert.equal(stored.identityStatus, 'unresolved');
  });
});
