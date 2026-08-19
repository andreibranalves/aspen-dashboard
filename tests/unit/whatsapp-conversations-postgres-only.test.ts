import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/_modules/whatsapp-conversations.js';
import {
  resolveWhatsappCrmMatch,
  validateWhatsappConversationLinks,
  type LocalClientRecord,
  type LocalDealRecord,
  type LocalQuoteLeadRecord,
  type LocalQuotationRecord,
  type LocalWhatsappCrmRepository,
} from '../../api/_modules/whatsapp-crm-match.js';
import {
  normalizeWhatsappMessageInput,
  upsertWhatsappConversation,
  upsertWhatsappMessages,
  type WhatsappConversation,
  type WhatsappConversationStoreDeps,
} from '../../api/_modules/whatsapp-conversations-store.js';
import { syncWhatsappConversations } from '../../api/_modules/whatsapp-conversations-sync.js';

const IDS = {
  leadA: '11111111-1111-4111-8111-111111111111',
  leadB: '22222222-2222-4222-8222-222222222222',
  clientA: '33333333-3333-4333-8333-333333333333',
  dealA: '44444444-4444-4444-8444-444444444444',
  quotationA: '55555555-5555-4555-8555-555555555555',
};

function baseConversation(overrides: Partial<WhatsappConversation> = {}): WhatsappConversation {
  return {
    id: 'wa_1',
    providerConversationId: '5511999999999@s.whatsapp.net',
    remoteJid: '5511999999999@s.whatsapp.net',
    canonicalPhone: '5511999999999',
    phone: '5511999999999',
    displayLabel: 'Maria Silva',
    displayName: 'Maria Silva',
    identityStatus: 'verified',
    identitySource: 'chat.phone',
    identityConfidence: 'high',
    lastMessageAt: '2026-07-01T12:00:00.000Z',
    lastMessagePreview: 'Olá',
    source: 'evolution',
    status: 'new',
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeStore(overrides: Partial<WhatsappConversationStoreDeps> = {}) {
  let conversations: WhatsappConversation[] = [];
  const messages = new Map<string, any[]>();
  let id = 0;
  const deps: WhatsappConversationStoreDeps = {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => `generated-${++id}`,
    readConversations: async () => conversations,
    writeConversations: async (value) => {
      conversations = value;
    },
    readMessages: async (conversationId) => messages.get(conversationId) || [],
    writeMessages: async (conversationId, value) => {
      messages.set(conversationId, value);
    },
    ...overrides,
  };
  return { deps, conversations: () => conversations, messages };
}

function makeLocalRepo(input: {
  leads?: LocalQuoteLeadRecord[];
  clients?: LocalClientRecord[];
  deals?: LocalDealRecord[];
  quotations?: LocalQuotationRecord[];
} = {}): LocalWhatsappCrmRepository {
  const leads = input.leads || [];
  const clients = input.clients || [];
  const deals = input.deals || [];
  const quotations = input.quotations || [];
  return {
    listQuoteLeads: async () => leads,
    listClients: async () => clients,
    listDeals: async () => deals,
    listQuotations: async () => quotations,
    getQuoteLead: async (id) => leads.find((row) => row.id === id) || null,
    getClient: async (id) => clients.find((row) => row.id === id) || null,
    getDeal: async (id) => deals.find((row) => row.id === id) || null,
    getQuotation: async (id) => quotations.find((row) => row.id === id) || null,
  };
}

function crmDeps(repo: LocalWhatsappCrmRepository, store = makeStore()) {
  return { ...store.deps, localCrm: repo };
}

const activeLead = (overrides: Partial<LocalQuoteLeadRecord> = {}): LocalQuoteLeadRecord => ({
  id: IDS.leadA,
  nome: 'Maria Silva',
  telefone: '5511999999999',
  email: 'maria@example.com',
  status: 'ready',
  quotationId: null,
  crmDealId: null,
  ...overrides,
});

const activeClient = (overrides: Partial<LocalClientRecord> = {}): LocalClientRecord => ({
  id: IDS.clientA,
  nome: 'Maria Silva',
  telefone: '5511999999999',
  email: 'maria@example.com',
  arquivado: false,
  ...overrides,
});

describe('whatsapp PostgreSQL-only conversation seams', () => {
  it('matches a local UUID by phone before email or name', async () => {
    const match = await resolveWhatsappCrmMatch({
      conversation: baseConversation(),
      deps: crmDeps(makeLocalRepo({ leads: [activeLead()], clients: [] })),
    });
    assert.deepEqual(match, {
      id: IDS.leadA,
      tipo: 'lead',
      nome: 'Maria Silva',
      telefone: '5511999999999',
      email: 'maria@example.com',
      matchSource: 'phone',
    });
  });

  it('returns null on ambiguous phone matches', async () => {
    const match = await resolveWhatsappCrmMatch({
      conversation: baseConversation({ displayLabel: 'Outro nome' }),
      deps: crmDeps(makeLocalRepo({
        leads: [activeLead(), activeLead({ id: IDS.leadB, nome: 'Outra Pessoa' })],
      })),
    });
    assert.equal(match, null);
  });

  it('does not auto-match archived clients, discarded leads, or lost deals', async () => {
    const match = await resolveWhatsappCrmMatch({
      conversation: baseConversation(),
      deps: crmDeps(makeLocalRepo({
        leads: [activeLead({ status: 'discarded' })],
        clients: [activeClient({ arquivado: true })],
        deals: [{
          id: IDS.dealA,
          quoteLeadId: null,
          clientId: null,
          quotationId: null,
          nome: 'Maria Silva',
          telefone: '5511999999999',
          email: null,
          status: 'Perdido',
        }],
      })),
    });
    assert.equal(match, null);
  });

  it('reuses an explicitly saved discarded lead link as historical context', async () => {
    const lead = activeLead({ status: 'discarded' });
    const match = await resolveWhatsappCrmMatch({
      conversation: baseConversation({ linkedLeadId: IDS.leadA, identityStatus: 'unresolved' }),
      deps: crmDeps(makeLocalRepo({ leads: [lead] })),
    });
    assert.equal(match?.id, IDS.leadA);
    assert.equal(match?.tipo, 'lead');
  });

  it('matches quotation snapshot data through an active local client', async () => {
    const client = activeClient({ nome: 'Cliente sem dados atuais', telefone: null, email: null });
    const quotation: LocalQuotationRecord = {
      id: IDS.quotationA,
      businessNumber: 'ORC-20260001',
      clientId: IDS.clientA,
      status: 'perdido',
      snapshot: { nome: 'Maria Silva', telefone: '5511999999999', email: 'maria@example.com' },
    };
    const match = await resolveWhatsappCrmMatch({
      conversation: baseConversation(),
      deps: crmDeps(makeLocalRepo({ clients: [client], quotations: [quotation] })),
    });
    assert.equal(match?.id, IDS.clientA);
    assert.equal(match?.tipo, 'cliente');
    assert.equal(match?.matchSource, 'phone');
  });

  it('fails closed with Portuguese 503 on local repository failure', async () => {
    const failing: LocalWhatsappCrmRepository = {
      ...makeLocalRepo(),
      listQuoteLeads: async () => {
        throw new Error('database down');
      },
    };
    await assert.rejects(
      () => resolveWhatsappCrmMatch({ conversation: baseConversation(), deps: crmDeps(failing) }),
      (error: any) => error.statusCode === 503 && /dados comerciais locais/.test(error.message)
    );
  });

  it('rejects external media and raw provider payload while retaining owned local media', () => {
    const external = normalizeWhatsappMessageInput({
      providerMessageId: 'provider-1',
      type: 'image',
      mediaUrl: 'https://provider.invalid/image.jpg',
      raw: { apikey: 'secret' },
    });
    assert.equal(external.mediaUrl, '');
    assert.equal(external.attachments, undefined);
    assert.equal(external.raw, undefined);

    const local = normalizeWhatsappMessageInput({
      providerMessageId: 'local-1',
      direction: 'outbound',
      type: 'document',
      attachments: [{
        kind: 'document',
        mediaUrl: '/media/owned/document.pdf',
        mimeType: 'application/pdf',
        fileName: 'document.pdf',
      }],
    });
    assert.equal(local.attachments?.[0].mediaUrl, '/media/owned/document.pdf');
  });

  it('keeps conversation and message upserts idempotent under concurrent writers', async () => {
    const store = makeStore();
    await Promise.all([
      upsertWhatsappConversation({ remoteJid: '5511999999999@s.whatsapp.net', phone: '5511999999999', lastMessagePreview: 'a' }, store.deps),
      upsertWhatsappConversation({ remoteJid: '5511999999999@s.whatsapp.net', phone: '5511999999999', lastMessagePreview: 'b' }, store.deps),
    ]);
    const conversation = store.conversations()[0];
    await Promise.all([
      upsertWhatsappMessages(conversation.id, [{ providerMessageId: 'm1', body: 'one' }], store.deps),
      upsertWhatsappMessages(conversation.id, [{ providerMessageId: 'm2', body: 'two' }], store.deps),
    ]);
    assert.equal(store.conversations().length, 1);
    assert.deepEqual(
      (await store.deps.readMessages(conversation.id)).map((message) => message.providerMessageId),
      ['m1', 'm2']
    );
  });

  it('uses sync snapshots without raw payloads and remains idempotent', async () => {
    const store = makeStore();
    const deps = {
      ...store.deps,
      fetchChats: async () => [{
        remoteJid: '5511999999999@s.whatsapp.net',
        pushName: 'Maria Silva',
        updatedAt: 1782916800,
        lastMessage: { text: 'Olá' },
      }],
      fetchMessages: async () => [{
        key: { id: 'm1', fromMe: false },
        messageTimestamp: 1782916800,
        message: { conversation: 'Olá' },
        secret: 'must not persist',
      }],
    };
    await syncWhatsappConversations({ chatLimit: 1, messageLimit: 10 }, deps);
    await syncWhatsappConversations({ chatLimit: 1, messageLimit: 10 }, deps);
    const conversation = store.conversations()[0];
    const messages = await store.deps.readMessages(conversation.id);
    assert.equal(messages.length, 1);
    assert.equal('raw' in messages[0], false);
    assert.equal('secret' in messages[0], false);
  });

  it('blocks sending when identity cannot provide a canonical phone', async () => {
    const store = makeStore();
    const conversation = baseConversation({ id: 'wa_send', identityStatus: 'unresolved', canonicalPhone: '', phone: '5511999999999' });
    await store.deps.writeConversations([conversation]);
    let sends = 0;
    const result = await createHandler({
      ...store.deps,
      sendTextMessage: async () => {
        sends += 1;
        return {};
      },
    })({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'send-message', id: conversation.id, text: 'Oi' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    assert.equal(result.statusCode, 400);
    assert.equal(sends, 0);
  });

  it('validates local UUID links and cross-links before PATCH persistence', async () => {
    const store = makeStore();
    const conversation = baseConversation({ id: 'wa_patch', canonicalPhone: '', phone: '', identityStatus: 'unresolved' });
    await store.deps.writeConversations([conversation]);
    const lead = activeLead({ telefone: null, email: null });
    const deal: LocalDealRecord = {
      id: IDS.dealA,
      quoteLeadId: IDS.leadA,
      clientId: null,
      quotationId: null,
      nome: 'Maria Silva',
      telefone: null,
      email: null,
      status: 'Novo Lead',
    };
    const repo = makeLocalRepo({ leads: [lead], deals: [deal] });
    const handler = createHandler({ ...store.deps, localCrm: repo });
    const invalid = await handler({
      httpMethod: 'PATCH', body: JSON.stringify({ id: conversation.id, linkedLeadId: 'not-a-uuid' }),
      queryStringParameters: {}, headers: {},
    } as any);
    assert.equal(invalid.statusCode, 400);

    const valid = await handler({
      httpMethod: 'PATCH', body: JSON.stringify({ id: conversation.id, linkedLeadId: IDS.leadA, linkedDealId: IDS.dealA }),
      queryStringParameters: {}, headers: {},
    } as any);
    assert.equal(valid.statusCode, 200);
    assert.equal((await store.deps.readConversations())[0].linkedLeadId, IDS.leadA);

    await assert.rejects(
      () => validateWhatsappConversationLinks({
        patch: { linkedLeadId: IDS.leadA, linkedDealId: IDS.dealA, linkedQuotationId: IDS.quotationA },
        deps: crmDeps(repo, store),
      }),
      (error: any) => error.statusCode === 400
    );
  });

  it('returns Portuguese 405 and maps storage failures to 503', async () => {
    const method = await createHandler()( {
      httpMethod: 'DELETE', body: '{not-json}', queryStringParameters: {}, headers: {},
    } as any);
    assert.equal(method.statusCode, 405);

    const failing = makeStore({ readConversations: async () => { throw new Error('kv down'); } });
    const result = await createHandler(failing.deps)({
      httpMethod: 'GET', queryStringParameters: {}, headers: {},
    } as any);
    assert.equal(result.statusCode, 503);
    const errorBody = JSON.parse(String(result.body || '{}')) as { error?: unknown };
    assert.match(String(errorBody.error || ''), /conversas do WhatsApp/);
  });
});
