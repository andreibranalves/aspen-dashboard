import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/modules/whatsapp-conversations.js';
import {
  validateWhatsappConversationLinks,
  type LocalClientRecord,
  type LocalDealRecord,
  type LocalQuoteLeadRecord,
  type LocalQuotationRecord,
  type LocalWhatsappCrmRepository,
} from '../../api/modules/whatsapp-crm-match.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from '../../api/modules/whatsapp-conversations-store.js';

const IDS = {
  lead: '11111111-1111-4111-8111-111111111111',
  leadTwo: '22222222-2222-4222-8222-222222222222',
  deal: '33333333-3333-4333-8333-333333333333',
  quotation: '44444444-4444-4444-8444-444444444444',
  client: '55555555-5555-4555-8555-555555555555',
};

function parse(result: { body?: string }): Record<string, any> {
  return JSON.parse(result.body || '{}');
}

function conversation(overrides: Partial<WhatsappConversation> = {}): WhatsappConversation {
  return {
    id: 'wa-local-1',
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
    lastMessagePreview: 'Oi',
    source: 'evolution',
    status: 'new',
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeStore() {
  let conversations: WhatsappConversation[] = [];
  const messages = new Map<string, any[]>();
  let writeFailures = 0;
  const deps: WhatsappConversationStoreDeps = {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => `wa-generated-${Math.random().toString(36).slice(2, 8)}`,
    readConversations: async () => conversations,
    writeConversations: async (value) => {
      if (writeFailures > 0) {
        writeFailures -= 1;
        throw new Error('KV link unavailable');
      }
      conversations = value;
    },
    readMessages: async (id) => messages.get(id) || [],
    writeMessages: async (id, value) => {
      messages.set(id, value);
    },
  };
  return {
    deps,
    seed: async (value: WhatsappConversation) => {
      conversations = [value];
    },
    failNextWrite: () => {
      writeFailures += 1;
    },
    conversations: () => conversations,
    messages,
  };
}

function repo(input: {
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

const lead = (overrides: Partial<LocalQuoteLeadRecord> = {}): LocalQuoteLeadRecord => ({
  id: IDS.lead,
  nome: 'Maria Silva',
  telefone: '5511999999999',
  email: 'maria@example.com',
  status: 'ready',
  quotationId: null,
  crmDealId: null,
  ...overrides,
});

const deal = (overrides: Partial<LocalDealRecord> = {}): LocalDealRecord => ({
  id: IDS.deal,
  quoteLeadId: IDS.lead,
  clientId: null,
  quotationId: null,
  nome: 'Maria Silva',
  telefone: '5511999999999',
  email: null,
  status: 'Novo Lead',
  ...overrides,
});

describe('whatsapp-conversations handler', () => {
  it('projects every conversation and message response without provider internals', async () => {
    const store = makeStore();
    const saved = conversation();
    await store.seed(saved);
    await (store.deps.writeMessages as any)(saved.id, [{
      id: 'message-local',
      conversationId: saved.id,
      providerMessageId: 'provider-secret',
      direction: 'inbound',
      type: 'image',
      body: 'foto',
      mediaUrl: 'https://foreign.invalid/private.jpg',
      attachments: [{
        id: 'attachment-local',
        kind: 'image',
        mediaUrl: '/media/../secret.jpg',
        origin: 'provider',
        secret: 'must disappear',
      } as any],
      raw: { apikey: 'secret' },
      secret: 'must disappear',
      timestamp: saved.lastMessageAt,
    } as any]);
    const result = await createHandler(store.deps)({
      httpMethod: 'GET',
      queryStringParameters: {},
      headers: {},
    } as any);
    assert.equal(result.statusCode, 200);
    const body = parse(result);
    assert.equal('providerConversationId' in body.data, false);
    assert.equal('remoteJid' in body.data, false);
    assert.equal('providerMessageId' in body.data, false);
    assert.equal('raw' in body.data, false);

    const messages = await createHandler(store.deps)({
      httpMethod: 'GET',
      queryStringParameters: { messages: saved.id },
      headers: {},
    } as any);
    const message = parse(messages).data[0];
    assert.equal('providerMessageId' in message, false);
    assert.equal('raw' in message, false);
    assert.equal(message.mediaUrl, '');
    assert.equal(message.attachments, undefined);
  });

  it('keeps omitted PATCH links and validates mismatches against local entities', async () => {
    const store = makeStore();
    await store.seed(conversation());
    const local = repo({ leads: [lead()], deals: [deal()] });
    const handler = createHandler({ ...store.deps, localCrm: local });

    const first = await handler({
      httpMethod: 'PATCH',
      body: JSON.stringify({ id: 'wa-local-1', linkedLeadId: IDS.lead }),
      queryStringParameters: {},
      headers: {},
    } as any);
    assert.equal(first.statusCode, 200);

    const second = await handler({
      httpMethod: 'PATCH',
      body: JSON.stringify({ id: 'wa-local-1', linkedDealId: IDS.deal }),
      queryStringParameters: {},
      headers: {},
    } as any);
    assert.equal(second.statusCode, 200);
    assert.equal(store.conversations()[0].linkedLeadId, IDS.lead);
    assert.equal(store.conversations()[0].linkedDealId, IDS.deal);

    const [racedLead, racedDeal] = await Promise.all([
      handler({
        httpMethod: 'PATCH',
        body: JSON.stringify({ id: 'wa-local-1', linkedLeadId: IDS.lead }),
        queryStringParameters: {},
        headers: {},
      } as any),
      handler({
        httpMethod: 'PATCH',
        body: JSON.stringify({ id: 'wa-local-1', linkedDealId: IDS.deal }),
        queryStringParameters: {},
        headers: {},
      } as any),
    ]);
    assert.equal(racedLead.statusCode, 200);
    assert.equal(racedDeal.statusCode, 200);
    assert.equal(store.conversations()[0].linkedLeadId, IDS.lead);
    assert.equal(store.conversations()[0].linkedDealId, IDS.deal);

    const mismatch = await handler({
      httpMethod: 'PATCH',
      body: JSON.stringify({ id: 'wa-local-1', linkedQuotationId: IDS.quotation }),
      queryStringParameters: {},
      headers: {},
    } as any);
    assert.equal(mismatch.statusCode, 400);

    const otherClient = '66666666-6666-4666-8666-666666666666';
    const crossLinkError = validateWhatsappConversationLinks({
      patch: { linkedLeadId: null, linkedDealId: IDS.deal, linkedQuotationId: IDS.quotation },
      deps: {
        ...store.deps,
        localCrm: repo({
          deals: [deal({ clientId: IDS.client, quotationId: IDS.quotation })],
          quotations: [{
            id: IDS.quotation,
            businessNumber: 'ORC-20260001',
            clientId: otherClient,
            status: 'rascunho',
            snapshot: null,
          }],
        }),
      },
    });
    await assert.rejects(crossLinkError, (error: any) => error.statusCode === 400);
  });

  it('returns 503 when local CRM reads fail instead of crmMatch null', async () => {
    const store = makeStore();
    await store.seed(conversation());
    const failing: LocalWhatsappCrmRepository = {
      ...repo(),
      listQuoteLeads: async () => {
        throw new Error('database down');
      },
    };
    const result = await createHandler({ ...store.deps, localCrm: failing })({
      httpMethod: 'GET',
      queryStringParameters: { id: 'wa-local-1' },
      headers: {},
    } as any);
    assert.equal(result.statusCode, 503);
    assert.match(parse(result).error, /dados comerciais locais/);
  });

  it('reuses one local lead and deal after a KV link failure', async () => {
    const store = makeStore();
    await store.seed(conversation());
    store.failNextWrite();
    const leads = [lead({ externalId: 'wa-local-1', source: 'whatsapp', crmDealId: IDS.deal })];
    const deals = [deal()];
    let upserts = 0;
    const local = repo({ leads, deals });
    const handler = createHandler({
      ...store.deps,
      localCrm: local,
      upsertQuoteLead: async () => {
        upserts += 1;
        return { ...leads[0], crmDealId: IDS.deal };
      },
    });

    const first = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'create-quote-lead', id: 'wa-local-1' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    assert.equal(first.statusCode, 503);

    const second = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'create-quote-lead', id: 'wa-local-1' }),
      queryStringParameters: {},
      headers: {},
    } as any);
    assert.equal(second.statusCode, 200);
    assert.equal(upserts, 0);
    assert.equal(store.conversations()[0].linkedLeadId, IDS.lead);
    assert.equal(store.conversations()[0].linkedDealId, IDS.deal);
  });
});
