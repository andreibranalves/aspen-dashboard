import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/_modules/whatsapp-conversations.js';
import {
  validateWhatsappConversationLinks,
  type LocalClientRecord,
  type LocalDealRecord,
  type LocalQuoteLeadRecord,
  type LocalQuotationRecord,
  type LocalWhatsappCrmRepository,
} from '../../api/_modules/whatsapp-crm-match.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from '../../api/_modules/whatsapp-conversations-store.js';

const IDS = {
  lead: '11111111-1111-4111-8111-111111111111',
  leadTwo: '22222222-2222-4222-8222-222222222222',
  deal: '33333333-3333-4333-8333-333333333333',
  dealTwo: '66666666-6666-4666-8666-666666666666',
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
    seed: async (value: WhatsappConversation | WhatsappConversation[]) => {
      conversations = Array.isArray(value) ? [...value] : [value];
    },
    failNextWrite: () => {
      writeFailures += 1;
    },
    conversations: () => conversations,
    messages,
  };
}

/**
 * Store with a real optimistic CAS seam, mirroring `liveAtomicConversations`:
 * every mutation sees the latest snapshot and the write only lands when no
 * other mutation landed in between. There is deliberately no direct
 * read/write fallback, so a test that needs concurrent behavior agrees to the
 * same single-key contract production uses.
 */
function makeAtomicStore() {
  let conversations: WhatsappConversation[] = [];
  let revision = 0;
  const messages = new Map<string, any[]>();
  const deps: WhatsappConversationStoreDeps = {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => `wa-generated-${Math.random().toString(36).slice(2, 8)}`,
    readConversations: async () => conversations,
    writeConversations: async () => {
      throw new Error('direct write must not run when the CAS seam is supplied');
    },
    readMessages: async (id) => messages.get(id) || [],
    writeMessages: async (id, value) => {
      messages.set(id, value);
    },
    atomicUpdateConversations: async (mutation) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const seenRevision = revision;
        const snapshot = conversations;
        const changed = await mutation(snapshot);
        if (revision !== seenRevision) continue;
        conversations = changed.conversations;
        revision += 1;
        return changed.result;
      }
      throw new Error('CAS contention');
    },
  };
  return {
    deps,
    seed: async (value: WhatsappConversation | WhatsappConversation[]) => {
      conversations = Array.isArray(value) ? [...value] : [value];
      revision += 1;
    },
    conversations: () => conversations,
    messages,
  };
}

function repo(
  input: {
  leads?: LocalQuoteLeadRecord[];
  clients?: LocalClientRecord[];
  deals?: LocalDealRecord[];
  quotations?: LocalQuotationRecord[];
  } = {}
): LocalWhatsappCrmRepository {
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

/**
 * Narrow admission finders injected as WhatsappActionDeps, mirroring the
 * production quote lead repository lookups. They are deliberately NOT part of
 * the CRM matcher contract (#240 review): live admission reads the quote lead
 * repository directly.
 */
function admissionFinders(leads: LocalQuoteLeadRecord[]) {
  return {
    findQuoteLeadByDemandId: async (demandId: string, source?: string) =>
      leads.find((row) => row.demandId === demandId && (!source || row.source === source)) || null,
    findQuoteLeadByExternalIdWithoutDemand: async (externalId: string, source?: string) =>
      leads.find(
        (row) =>
          row.externalId === externalId && !row.demandId && (!source || row.source === source)
      ) || null,
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
  it('blocks the default send-message caller before network when Evolution config is incomplete', async () => {
    const previous = {
      baseUrl: process.env.EVOLUTION_BASE_URL,
      apiKey: process.env.EVOLUTION_API_KEY,
      instance: process.env.EVOLUTION_INSTANCE,
      appEnv: process.env.APP_ENV,
      writes: process.env.EXTERNAL_WRITES_ENABLED,
    };
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    process.env.EVOLUTION_BASE_URL = 'https://evolution.test';
    delete process.env.EVOLUTION_API_KEY;
    process.env.EVOLUTION_INSTANCE = 'test-instance';
    process.env.APP_ENV = 'production';
    process.env.EXTERNAL_WRITES_ENABLED = '1';
    globalThis.fetch = (async () => {
      providerCalls += 1;
      throw new Error('fetch must not run');
    }) as typeof globalThis.fetch;

    try {
      const store = makeStore();
      await store.seed(conversation());
      const result = await createHandler(store.deps)({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'send-message', id: 'wa-local-1', text: 'Olá' }),
        queryStringParameters: {},
        headers: {},
      } as any);
      assert.equal(result.statusCode, 500);
      assert.match(parse(result).error, /integração do whatsapp não configurada/i);
      assert.equal(providerCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries({
        EVOLUTION_BASE_URL: previous.baseUrl,
        EVOLUTION_API_KEY: previous.apiKey,
        EVOLUTION_INSTANCE: previous.instance,
        APP_ENV: previous.appEnv,
        EXTERNAL_WRITES_ENABLED: previous.writes,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('projects every conversation and message response without provider internals', async () => {
    const store = makeStore();
    const saved = conversation();
    await store.seed(saved);
    await (store.deps.writeMessages as any)(saved.id, [
      {
      id: 'message-local',
      conversationId: saved.id,
      providerMessageId: 'provider-secret',
      direction: 'inbound',
      type: 'image',
      body: 'foto',
      mediaUrl: 'https://foreign.invalid/private.jpg',
        attachments: [
          {
        id: 'attachment-local',
        kind: 'image',
        mediaUrl: '/media/../secret.jpg',
        origin: 'provider',
        secret: 'must disappear',
          } as any,
        ],
      raw: { apikey: 'secret' },
      secret: 'must disappear',
      timestamp: saved.lastMessageAt,
      } as any,
    ]);
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
          quotations: [
            {
            id: IDS.quotation,
            businessNumber: 'ORC-20260001',
            clientId: otherClient,
            status: 'rascunho',
            snapshot: null,
            },
          ],
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
      ...admissionFinders(leads),
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

  it('maps a repeated explicit demand identity to the same admitted demand', async () => {
    const store = makeStore();
    await store.seed(conversation());
    const stored: LocalQuoteLeadRecord[] = [];
    let upserts = 0;
    const handler = createHandler({
      ...store.deps,
      localCrm: repo({ leads: stored, deals: [deal()] }),
      ...admissionFinders(stored),
      upsertQuoteLead: async (input) => {
        upserts += 1;
        const record = lead({
          externalId: String(input.externalId),
          source: 'whatsapp',
          demandId: String(input.demandId),
          crmDealId: IDS.deal,
        });
        stored.push(record);
        return record;
      },
    });

    const body = JSON.stringify({
      action: 'create-quote-lead',
      id: 'wa-local-1',
      demandId: 'demand-alpha',
    });
    const first = await handler({
      httpMethod: 'POST',
      body,
      queryStringParameters: {},
      headers: {},
    } as any);
    const second = await handler({
      httpMethod: 'POST',
      body,
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 200, 'the exact demand retry must reuse the admitted demand');
    assert.equal(upserts, 1, 'a retry must not create a second admission');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].demandId, 'demand-alpha');
    assert.equal(store.conversations()[0].linkedLeadId, IDS.lead);
  });

  it('keeps independently supplied demands in one conversation apart', async () => {
    const store = makeStore();
    await store.seed(conversation());
    const stored = new Map<string, LocalQuoteLeadRecord>();
    const leadIdFor = (demandId: string) => (demandId === 'demand-alpha' ? IDS.lead : IDS.leadTwo);
    const byDealId = (id: string): LocalDealRecord | null => {
      const record = [...stored.values()].find((row) => row.crmDealId === id);
      return record
        ? {
            id,
            quoteLeadId: record.id,
            clientId: null,
            quotationId: null,
            nome: 'Maria Silva',
            telefone: '5511999999999',
            email: null,
            status: 'Novo Lead',
          }
        : null;
    };
    const handler = createHandler({
      ...store.deps,
      localCrm: {
        listQuoteLeads: async () => [...stored.values()],
        listClients: async () => [],
        listDeals: async () => [],
        listQuotations: async () => [],
        getQuoteLead: async (id) => [...stored.values()].find((row) => row.id === id) || null,
        getClient: async () => null,
        getDeal: async (id) => byDealId(id),
        getQuotation: async () => null,
      },
      findQuoteLeadByDemandId: async (demandId) => stored.get(demandId) || null,
      findQuoteLeadByExternalIdWithoutDemand: async (externalId) =>
        [...stored.values()].find((row) => row.externalId === externalId && !row.demandId) || null,
      upsertQuoteLead: async (input) => {
        const demandId = String(input.demandId);
        const record: LocalQuoteLeadRecord = {
          id: leadIdFor(demandId),
          nome: 'Maria Silva',
          telefone: '5511999999999',
          email: 'maria@example.com',
          status: 'ready',
          quotationId: null,
          crmDealId:
            demandId === 'demand-alpha' ? IDS.deal : '66666666-6666-4666-8666-666666666666',
          source: 'whatsapp',
          externalId: 'wa-local-1',
          demandId,
        };
        stored.set(demandId, record);
        return record;
      },
    });

    const create = (demandId: string) =>
      handler({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'create-quote-lead', id: 'wa-local-1', demandId }),
        queryStringParameters: {},
        headers: {},
      } as any);

    const alpha = await create('demand-alpha');
    const beta = await create('demand-beta');

    assert.equal(alpha.statusCode, 201);
    assert.equal(beta.statusCode, 201);
    assert.equal(stored.size, 2, 'two demands must not fuse into one admission');
    assert.equal(parse(alpha).data.id, IDS.lead);
    assert.equal(parse(beta).data.id, IDS.leadTwo);

    // A retry of the first demand reuses it instead of creating a third.
    const alphaRetry = await create('demand-alpha');
    assert.equal(alphaRetry.statusCode, 200);
    assert.equal(stored.size, 2);
  });

  it('rejects a demand identity already bound to a different conversation', async () => {
    const store = makeStore();
    await store.seed([
      conversation(),
      conversation({
        id: 'wa-other',
        providerConversationId: '5521888888888@s.whatsapp.net',
        remoteJid: '5521888888888@s.whatsapp.net',
        canonicalPhone: '5521888888888',
        phone: '5521888888888',
        displayLabel: 'Outro Cliente',
        displayName: 'Outro Cliente',
      }),
    ]);
    let upserts = 0;
    const leads = [
      lead({
        id: IDS.lead,
        externalId: 'wa-local-1',
        source: 'whatsapp',
        demandId: 'demand-alpha',
        crmDealId: IDS.deal,
      }),
    ];
    const handler = createHandler({
      ...store.deps,
      localCrm: repo({ leads, deals: [deal()] }),
      ...admissionFinders(leads),
      upsertQuoteLead: async () => {
        upserts += 1;
        return { id: IDS.leadTwo };
      },
    });

    const result = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        action: 'create-quote-lead',
        id: 'wa-other',
        demandId: 'demand-alpha',
      }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 409);
    assert.equal(upserts, 0, 'a conflicting binding must never create or merge an admission');
    const other = store.conversations().find((item) => item.id === 'wa-other');
    assert.equal(other?.linkedLeadId ?? null, null, 'the other conversation must stay unlinked');
    assert.equal(other?.linkedDealId ?? null, null);
  });

  it('retry of an older admission never overwrites a newer saved CRM selection', async () => {
    const store = makeStore();
    await store.seed(
      conversation({
        linkedLeadId: IDS.leadTwo,
        linkedDealId: IDS.dealTwo,
        status: 'quote_lead_created',
      })
    );
    let upserts = 0;
    const leads = [
      lead({
        id: IDS.lead,
        externalId: 'wa-local-1',
        source: 'whatsapp',
        crmDealId: IDS.deal,
      }),
      lead({
        id: IDS.leadTwo,
        externalId: 'wa-local-1',
        source: 'whatsapp',
        demandId: 'demand-beta',
        crmDealId: IDS.dealTwo,
      }),
    ];
    const handler = createHandler({
      ...store.deps,
      localCrm: repo({ leads, deals: [deal(), deal({ id: IDS.dealTwo, quoteLeadId: IDS.leadTwo })] }),
      ...admissionFinders(leads),
      upsertQuoteLead: async () => {
        upserts += 1;
        return { id: IDS.lead };
      },
    });

    const result = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'create-quote-lead', id: 'wa-local-1' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data.id, IDS.lead, 'the retry returns the original admission');
    assert.equal(upserts, 0);
    assert.equal(
      store.conversations()[0].linkedLeadId,
      IDS.leadTwo,
      'the newer saved selection must be preserved'
    );
    assert.equal(store.conversations()[0].linkedDealId, IDS.dealTwo);
  });

  it('retry of an older admission completes links that are still missing', async () => {
    const store = makeStore();
    await store.seed(conversation());
    const leads = [
      lead({
        id: IDS.lead,
        externalId: 'wa-local-1',
        source: 'whatsapp',
        crmDealId: IDS.deal,
      }),
    ];
    const handler = createHandler({
      ...store.deps,
      localCrm: repo({ leads, deals: [deal()] }),
      ...admissionFinders(leads),
      upsertQuoteLead: async () => ({ id: IDS.lead }),
    });

    const result = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'create-quote-lead', id: 'wa-local-1' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(store.conversations()[0].linkedLeadId, IDS.lead);
    assert.equal(store.conversations()[0].linkedDealId, IDS.deal);
  });

  it('a stale new admission in flight never overwrites a newer saved CRM selection', async () => {
    const store = makeAtomicStore();
    await store.seed(conversation());
    const records = new Map<string, LocalQuoteLeadRecord>();
    const deals = new Map<string, LocalDealRecord>();
    const localCrm: LocalWhatsappCrmRepository = {
      listQuoteLeads: async () => [...records.values()],
      listClients: async () => [],
      listDeals: async () => [...deals.values()],
      listQuotations: async () => [],
      getQuoteLead: async (id) => [...records.values()].find((row) => row.id === id) || null,
      getClient: async () => null,
      getDeal: async (id) => deals.get(id) || null,
      getQuotation: async () => null,
    };
    let releaseAlpha!: () => void;
    const alphaGate = new Promise<void>((resolve) => {
      releaseAlpha = resolve;
    });
    let alphaReachedUpsert!: () => void;
    const alphaReached = new Promise<void>((resolve) => {
      alphaReachedUpsert = resolve;
    });

    const handler = createHandler({
      ...store.deps,
      localCrm,
      findQuoteLeadByDemandId: async (demandId) => records.get(demandId) || null,
      findQuoteLeadByExternalIdWithoutDemand: async () => null,
      upsertQuoteLead: async (input) => {
        const demandId = String(input.demandId);
        if (demandId === 'demand-A') {
          alphaReachedUpsert();
          await alphaGate;
        }
        const record = lead({
          id: demandId === 'demand-A' ? IDS.lead : IDS.leadTwo,
          source: 'whatsapp',
          externalId: 'wa-local-1',
          demandId,
          crmDealId: demandId === 'demand-A' ? IDS.deal : IDS.dealTwo,
        });
        records.set(demandId, record);
        deals.set(record.crmDealId!, deal({ id: record.crmDealId!, quoteLeadId: record.id }));
        return record;
      },
    });

    const create = (demandId: string) =>
      handler({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'create-quote-lead', id: 'wa-local-1', demandId }),
        queryStringParameters: {},
        headers: {},
      } as any);

    // A starts first and stalls inside the repository upsert; B enters after,
    // completes and saves its selection. A then finishes and must not revert it.
    const alpha = create('demand-A');
    await alphaReached;
    const beta = await create('demand-B');
    releaseAlpha();
    const alphaResult = await alpha;

    assert.equal(alphaResult.statusCode, 201);
    assert.equal(beta.statusCode, 201);
    assert.equal(
      store.conversations()[0].linkedLeadId,
      IDS.leadTwo,
      'the newer saved selection must not be overwritten by the stale admission'
    );
    assert.equal(store.conversations()[0].linkedDealId, IDS.dealTwo);
  });

  it('a failed newer reservation never blocks the older successful admission', async () => {
    const store = makeAtomicStore();
    await store.seed(conversation());
    const records = new Map<string, LocalQuoteLeadRecord>();
    const deals = new Map<string, LocalDealRecord>();
    const localCrm: LocalWhatsappCrmRepository = {
      listQuoteLeads: async () => [...records.values()],
      listClients: async () => [],
      listDeals: async () => [...deals.values()],
      listQuotations: async () => [],
      getQuoteLead: async (id) => [...records.values()].find((row) => row.id === id) || null,
      getClient: async () => null,
      getDeal: async (id) => deals.get(id) || null,
      getQuotation: async () => null,
    };
    let releaseAlpha!: () => void;
    const alphaGate = new Promise<void>((resolve) => {
      releaseAlpha = resolve;
    });
    let alphaReachedUpsert!: () => void;
    const alphaReached = new Promise<void>((resolve) => {
      alphaReachedUpsert = resolve;
    });

    const handler = createHandler({
      ...store.deps,
      localCrm,
      findQuoteLeadByDemandId: async (demandId) => records.get(demandId) || null,
      findQuoteLeadByExternalIdWithoutDemand: async () => null,
      upsertQuoteLead: async (input) => {
        const demandId = String(input.demandId);
        if (demandId === 'demand-B') throw new Error('repository unavailable');
        alphaReachedUpsert();
        await alphaGate;
        const record = lead({
          id: IDS.lead,
          source: 'whatsapp',
          externalId: 'wa-local-1',
          demandId,
          crmDealId: IDS.deal,
        });
        records.set(demandId, record);
        deals.set(record.crmDealId!, deal({ id: record.crmDealId!, quoteLeadId: record.id }));
        return record;
      },
    });

    const create = (demandId: string) =>
      handler({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'create-quote-lead', id: 'wa-local-1', demandId }),
        queryStringParameters: {},
        headers: {},
      } as any);

    const alpha = create('demand-A');
    await alphaReached;
    const beta = await create('demand-B');
    releaseAlpha();
    const alphaResult = await alpha;

    assert.equal(beta.statusCode, 503, 'the failed newer admission surfaces a 503');
    assert.equal(alphaResult.statusCode, 201);
    assert.equal(
      store.conversations()[0].linkedLeadId,
      IDS.lead,
      'the successful older admission still becomes the selection'
    );
  });

  it('a newly admitted demand becomes the selection in sequential admissions', async () => {
    const store = makeAtomicStore();
    await store.seed(conversation());
    const records = new Map<string, LocalQuoteLeadRecord>();
    const deals = new Map<string, LocalDealRecord>();
    const localCrm: LocalWhatsappCrmRepository = {
      listQuoteLeads: async () => [...records.values()],
      listClients: async () => [],
      listDeals: async () => [...deals.values()],
      listQuotations: async () => [],
      getQuoteLead: async (id) => [...records.values()].find((row) => row.id === id) || null,
      getClient: async () => null,
      getDeal: async (id) => deals.get(id) || null,
      getQuotation: async () => null,
    };
    const handler = createHandler({
      ...store.deps,
      localCrm,
      findQuoteLeadByDemandId: async (demandId) => records.get(demandId) || null,
      findQuoteLeadByExternalIdWithoutDemand: async () => null,
      upsertQuoteLead: async (input) => {
        const demandId = String(input.demandId);
        const record = lead({
          id: demandId === 'demand-A' ? IDS.lead : IDS.leadTwo,
          source: 'whatsapp',
          externalId: 'wa-local-1',
          demandId,
          crmDealId: demandId === 'demand-A' ? IDS.deal : IDS.dealTwo,
        });
        records.set(demandId, record);
        deals.set(record.crmDealId!, deal({ id: record.crmDealId!, quoteLeadId: record.id }));
        return record;
      },
    });

    const create = (demandId: string) =>
      handler({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'create-quote-lead', id: 'wa-local-1', demandId }),
        queryStringParameters: {},
        headers: {},
      } as any);

    const alpha = await create('demand-A');
    const beta = await create('demand-B');

    assert.equal(alpha.statusCode, 201);
    assert.equal(beta.statusCode, 201);
    assert.equal(
      store.conversations()[0].linkedLeadId,
      IDS.leadTwo,
      'the current operation (newest sequential demand) must be selected'
    );
    assert.equal(store.conversations()[0].linkedDealId, IDS.dealTwo);
  });

  it('rejects a malformed explicit demand identity before touching the repository', async () => {
    const store = makeStore();
    await store.seed(conversation());
    let upserts = 0;
    const handler = createHandler({
      ...store.deps,
      localCrm: repo(),
      upsertQuoteLead: async () => {
        upserts += 1;
        return { id: IDS.lead };
      },
    });

    const result = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        action: 'create-quote-lead',
        id: 'wa-local-1',
        demandId: 'a'.repeat(300),
      }),
      queryStringParameters: {},
      headers: {},
    } as any);
    assert.equal(result.statusCode, 400);
    assert.equal(upserts, 0);
  });
});
