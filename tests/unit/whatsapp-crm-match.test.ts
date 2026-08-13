import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  messageEmails,
  normalizeCrmMatchName,
  resolveWhatsappCrmMatch,
  validateWhatsappConversationLinks,
  type LocalClientRecord,
  type LocalDealRecord,
  type LocalQuoteLeadRecord,
  type LocalQuotationRecord,
  type LocalWhatsappCrmRepository,
} from '../../api/_functions/lib/whatsapp-crm-match.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from '../../api/_functions/lib/whatsapp-conversations-store.js';

const IDS = {
  lead: '11111111-1111-4111-8111-111111111111',
  leadTwo: '22222222-2222-4222-8222-222222222222',
  client: '33333333-3333-4333-8333-333333333333',
  deal: '44444444-4444-4444-8444-444444444444',
  quotation: '55555555-5555-4555-8555-555555555555',
};

function deps(): WhatsappConversationStoreDeps {
  return {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => 'wa-1',
    readConversations: async () => [],
    writeConversations: async () => {},
    readMessages: async () => [],
    writeMessages: async () => {},
  };
}

function conversation(overrides: Partial<WhatsappConversation> = {}): WhatsappConversation {
  return {
    id: 'wa-1',
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

function repository(input: {
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

describe('whatsapp-crm-match local repository', () => {
  it('matches by phone before email and exact name', async () => {
    const match = await resolveWhatsappCrmMatch({
      conversation: conversation(),
      deps: { ...deps(), localCrm: repository({ leads: [lead()] }) },
    });
    assert.deepEqual(match, {
      id: IDS.lead,
      tipo: 'lead',
      nome: 'Maria Silva',
      telefone: '5511999999999',
      email: 'maria@example.com',
      matchSource: 'phone',
    });
  });

  it('uses a deterministic limit of two to fail closed on ambiguity', async () => {
    const match = await resolveWhatsappCrmMatch({
      conversation: conversation(),
      deps: {
        ...deps(),
        localCrm: repository({ leads: [lead(), lead({ id: IDS.leadTwo, nome: 'Outra Pessoa' })] }),
      },
    });
    assert.equal(match, null);
  });

  it('does not turn unlinked or inactive deals into leads', async () => {
    const deal: LocalDealRecord = {
      id: IDS.deal,
      quoteLeadId: null,
      clientId: null,
      quotationId: null,
      nome: 'Maria Silva',
      telefone: '5511999999999',
      email: null,
      status: 'Novo Lead',
    };
    const lost: LocalDealRecord = { ...deal, id: IDS.leadTwo, status: 'Perdido' };
    const match = await resolveWhatsappCrmMatch({
      conversation: conversation(),
      deps: { ...deps(), localCrm: repository({ deals: [deal, lost] }) },
    });
    assert.equal(match, null);
  });

  it('keeps explicit discarded links as historical context with valid relationships', async () => {
    const match = await resolveWhatsappCrmMatch({
      conversation: conversation({ linkedLeadId: IDS.lead }),
      deps: {
        ...deps(),
        localCrm: repository({ leads: [lead({ status: 'discarded' })] }),
      },
    });
    assert.equal(match?.id, IDS.lead);
  });

  it('uses latest quotation snapshot data through an active client', async () => {
    const client: LocalClientRecord = {
      id: IDS.client,
      nome: 'Cliente sem telefone atual',
      telefone: null,
      email: null,
      arquivado: false,
    };
    const quotation: LocalQuotationRecord = {
      id: IDS.quotation,
      businessNumber: 'ORC-20260001',
      clientId: IDS.client,
      status: 'perdido',
      snapshot: { nome: 'Maria Silva', telefone: '5511999999999', email: 'maria@example.com' },
    };
    const match = await resolveWhatsappCrmMatch({
      conversation: conversation(),
      deps: { ...deps(), localCrm: repository({ clients: [client], quotations: [quotation] }) },
    });
    assert.equal(match?.id, IDS.client);
    assert.equal(match?.matchSource, 'phone');
  });

  it('ignores malformed message bodies while extracting inbound emails', () => {
    assert.deepEqual(
      messageEmails([
        { direction: 'inbound', body: null },
        { direction: 'inbound', body: 'Contato: maria@example.com' },
        { direction: 'outbound', body: 'other@example.com' },
      ]),
      ['maria@example.com'],
    );
  });

  it('rejects oversized, malformed, and control-character email matches', async () => {
    assert.deepEqual(
      messageEmails([
        { direction: 'inbound', body: `${'x'.repeat(10_000)}@example.com` },
        { direction: 'inbound', body: 'cliente@example.com\u0000' },
        { direction: 'inbound', body: 'CLIENTE@EXAMPLE.COM' },
      ]),
      ['cliente@example.com'],
    );
    const conversationWithoutPhone = conversation({
      canonicalPhone: '',
      phone: '',
      displayLabel: 'Sem correspondência',
      displayName: 'Sem correspondência',
    });
    const matchingMessage = { direction: 'inbound', body: 'cliente@example.com' };
    assert.equal(
      (await resolveWhatsappCrmMatch({
        conversation: conversationWithoutPhone,
        deps: { ...deps(), readMessages: async () => [matchingMessage as any], localCrm: repository({ leads: [lead({ email: '  cliente@example.com  ' })] }) },
      }))?.id,
      IDS.lead,
    );
    for (const email of ['\ncliente@example.com', '\tcliente@example.com', `${' '.repeat(240)}cliente@example.com`]) {
      assert.equal(
        await resolveWhatsappCrmMatch({
          conversation: conversationWithoutPhone,
          deps: { ...deps(), readMessages: async () => [matchingMessage as any], localCrm: repository({ leads: [lead({ email })] }) },
        }),
        null,
      );
    }
  });

  it('maps local repository failure to 503', async () => {
    const failing: LocalWhatsappCrmRepository = {
      ...repository(),
      listQuoteLeads: async () => {
        throw new Error('database down');
      },
    };
    await assert.rejects(
      () => resolveWhatsappCrmMatch({ conversation: conversation(), deps: { ...deps(), localCrm: failing } }),
      (error: any) => error.statusCode === 503,
    );
  });

  it('rejects inconsistent entity, deal, lead, client, and quotation saved links', async () => {
    const quotationTwo = '66666666-6666-4666-8666-666666666666';
    const localLead = lead({ quotationId: IDS.quotation });
    const quotation: LocalQuotationRecord = {
      id: IDS.quotation,
      businessNumber: 'ORC-20260001',
      clientId: IDS.client,
      status: 'enviado',
      snapshot: null,
    };
    const localDeal: LocalDealRecord = {
      id: IDS.deal,
      quoteLeadId: IDS.lead,
      clientId: null,
      quotationId: IDS.quotation,
      nome: 'Maria Silva',
      telefone: '5511999999999',
      email: null,
      status: 'Novo Lead',
    };
    const entityConversation = conversation({
      linkedCrmEntityId: IDS.lead,
      linkedCrmEntityType: 'lead',
      linkedDealId: IDS.deal,
      linkedQuotationId: IDS.quotation,
    });
    const local = repository({ leads: [localLead], deals: [localDeal], quotations: [quotation] });
    assert.equal(
      (await resolveWhatsappCrmMatch({ conversation: entityConversation, deps: { ...deps(), localCrm: local } }))?.id,
      IDS.lead,
    );
    assert.equal(
      await resolveWhatsappCrmMatch({
        conversation: entityConversation,
        deps: { ...deps(), localCrm: repository({
          leads: [localLead],
          deals: [{ ...localDeal, quoteLeadId: IDS.leadTwo }],
          quotations: [quotation],
        }) },
      }),
      null,
    );
    assert.equal(
      await resolveWhatsappCrmMatch({
        conversation: entityConversation,
        deps: { ...deps(), localCrm: repository({
          leads: [localLead],
          deals: [{ ...localDeal, quotationId: quotationTwo }],
          quotations: [quotation],
        }) },
      }),
      null,
    );
    assert.equal(
      await resolveWhatsappCrmMatch({
        conversation: { ...entityConversation, linkedDealId: null },
        deps: { ...deps(), localCrm: repository({ leads: [lead({ quotationId: null })], quotations: [quotation] }) },
      }),
      null,
    );
  });

  it('validates UUID links and lead, deal, quotation relationships', async () => {
    const localLead = lead({ quotationId: IDS.quotation });
    const localDeal: LocalDealRecord = {
      id: IDS.deal,
      quoteLeadId: IDS.lead,
      clientId: null,
      quotationId: IDS.quotation,
      nome: 'Maria Silva',
      telefone: '5511999999999',
      email: null,
      status: 'Novo Lead',
    };
    const quotation: LocalQuotationRecord = {
      id: IDS.quotation,
      businessNumber: 'ORC-20260001',
      clientId: IDS.client,
      status: 'enviado',
      snapshot: null,
    };
    const local = repository({ leads: [localLead], deals: [localDeal], quotations: [quotation] });
    await validateWhatsappConversationLinks({
      patch: { linkedLeadId: IDS.lead, linkedDealId: IDS.deal, linkedQuotationId: IDS.quotation },
      deps: { ...deps(), localCrm: local },
    });
    await assert.rejects(
      () => validateWhatsappConversationLinks({
        patch: { linkedLeadId: 'not-a-uuid', linkedDealId: null, linkedQuotationId: null },
        deps: { ...deps(), localCrm: local },
      }),
      (error: any) => error.statusCode === 400,
    );
  });

  it('scopes external-id matching to one WhatsApp lead and ignores Typebot or missing sources', async () => {
    const match = await resolveWhatsappCrmMatch({
      conversation: conversation({
        id: 'external-scope-1',
        canonicalPhone: '',
        phone: '',
        displayLabel: 'Sem match',
        displayName: 'Sem match',
      }),
      deps: {
        ...deps(),
        localCrm: repository({
          leads: [
            lead({ externalId: 'external-scope-1', source: 'typebot' }),
            lead({ id: IDS.leadTwo, nome: 'WhatsApp Lead', externalId: 'external-scope-1', source: 'whatsapp' }),
          ],
        }),
      },
    });
    assert.equal(match?.id, IDS.leadTwo);

    const missingSource = await resolveWhatsappCrmMatch({
      conversation: conversation({
        id: 'external-scope-2',
        canonicalPhone: '',
        phone: '',
        displayLabel: 'Sem match',
        displayName: 'Sem match',
      }),
      deps: {
        ...deps(),
        localCrm: repository({ leads: [lead({ externalId: 'external-scope-2', source: undefined })] }),
      },
    });
    assert.equal(missingSource, null);
  });

  it('fails closed when duplicate WhatsApp external IDs are present', async () => {
    await assert.rejects(
      () => resolveWhatsappCrmMatch({
        conversation: conversation({
          id: 'external-duplicate',
          canonicalPhone: '',
          phone: '',
          displayLabel: 'Sem match',
          displayName: 'Sem match',
        }),
        deps: {
          ...deps(),
          localCrm: repository({
            leads: [
              lead({ externalId: 'external-duplicate', source: 'whatsapp' }),
              lead({ id: IDS.leadTwo, externalId: 'external-duplicate', source: 'whatsapp' }),
            ],
          }),
        },
      }),
      (error: any) => error.statusCode === 409,
    );
  });

  it('uses explicit CRM whitespace normalization and preserves NBSP literally', async () => {
    assert.equal(normalizeCrmMatchName('  Ana\t\n  Silva  '), 'ana silva');
    assert.equal(normalizeCrmMatchName('\fAna\vSilva\f'), 'ana silva');
    assert.equal(normalizeCrmMatchName('  Ana\u00a0Silva  '), 'ana\u00a0silva');

    const asciiWhitespace = await resolveWhatsappCrmMatch({
      conversation: conversation({
        canonicalPhone: '',
        phone: '',
        displayLabel: 'Ana   Silva',
        displayName: 'Ana   Silva',
      }),
      deps: {
        ...deps(),
        localCrm: repository({
          leads: [lead({ nome: '  Ana\t\n  Silva  ', telefone: null, email: null })],
        }),
      },
    });
    assert.equal(asciiWhitespace?.id, IDS.lead);

    const nbspRepository = repository({
      leads: [lead({ nome: 'Ana\u00a0Silva Pessoa', telefone: null, email: null })],
    });
    const nbspAsSpace = await resolveWhatsappCrmMatch({
      conversation: conversation({
        canonicalPhone: '',
        phone: '',
        displayLabel: 'Ana Silva Pessoa',
        displayName: 'Ana Silva Pessoa',
      }),
      deps: { ...deps(), localCrm: nbspRepository },
    });
    assert.equal(nbspAsSpace, null);
    const nbspExact = await resolveWhatsappCrmMatch({
      conversation: conversation({
        canonicalPhone: '',
        phone: '',
        displayLabel: 'Ana\u00a0Silva Pessoa',
        displayName: 'Ana\u00a0Silva Pessoa',
      }),
      deps: { ...deps(), localCrm: nbspRepository },
    });
    assert.equal(nbspExact?.id, IDS.lead);
  });

  it('treats wildcard-only and embedded wildcard names as literal exact names', async () => {
    const wildcardOnly = await resolveWhatsappCrmMatch({
      conversation: conversation({
        canonicalPhone: '',
        phone: '',
        displayLabel: '%',
        displayName: '%',
      }),
      deps: { ...deps(), localCrm: repository({ leads: [lead({ nome: 'Maria Silva' })] }) },
    });
    assert.equal(wildcardOnly, null);

    const embeddedWildcard = await resolveWhatsappCrmMatch({
      conversation: conversation({
        canonicalPhone: '',
        phone: '',
        displayLabel: 'Maria% SILVA',
        displayName: 'Maria% SILVA',
      }),
      deps: {
        ...deps(),
        localCrm: repository({
          leads: [
            lead({ nome: 'MariaX Silva' }),
            lead({ id: IDS.leadTwo, nome: 'Maria% Silva' }),
          ],
        }),
      },
    });
    assert.equal(embeddedWildcard?.id, IDS.leadTwo);
  });
});
