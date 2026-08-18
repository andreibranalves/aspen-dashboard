import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';

import {
  createHandler,
  findConvertedQuotation,
  formatLeadText,
  getWhatsappLeadQuality,
  isLikelyAttendantName,
  normalizeLeadEmail,
  normalizeWhatsappPhone,
  prioritizeWhatsappLeads,
  readResponseJson,
  requestOpenRouter,
  resolveWhatsappDisplayName,
  shouldIncludeWhatsappLead,
} from '../../api/modules/whatsapp-leads.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from '../../api/modules/whatsapp-conversations-store.js';
import type { LocalWhatsappCrmRepository } from '../../api/modules/whatsapp-crm-match.js';

describe('whatsapp-leads helpers', () => {
  it('normaliza telefone brasileiro sem confundir DDD 55 com o país', () => {
    assert.equal(normalizeWhatsappPhone('(11) 99999-9999'), '5511999999999');
    assert.equal(normalizeWhatsappPhone('55 1234-5678'), '555512345678');
    assert.equal(normalizeWhatsappPhone('55 91234-5678'), '5555912345678');
    assert.equal(normalizeWhatsappPhone('+55 (11) 99999-9999'), '5511999999999');
    assert.equal(normalizeWhatsappPhone('5511999999999'), '5511999999999');
    assert.equal(normalizeWhatsappPhone('5511999999999@s.whatsapp.net'), '');
    assert.equal(normalizeWhatsappPhone('telefone 5511999999999'), '');
    assert.equal(normalizeWhatsappPhone('\t(11) 99999-9999'), '');
  });

  it('formata texto para preencher textarea sem disparar extração', () => {
    const text = formatLeadText({
      nome: 'João Silva',
      email: 'joao@example.com',
      telefone: '5511999999999',
      produto: 'canga',
      quantidade: 100,
    });

    assert.equal(
      text,
      [
        'Nome: João Silva',
        'E-mail: joao@example.com',
        'Telefone: 11999999999',
        'Pedido: canga — 100 un',
      ].join('\n')
    );
  });

  it('mantém campos vazios quando dados não existem', () => {
    const text = formatLeadText({ nome: '', email: '', telefone: '5511988887777' });

    assert.equal(text, ['Nome:', 'E-mail:', 'Telefone: 11988887777', 'Pedido:'].join('\n'));
  });

  it('retorna as 5 conversas mais recentes, sem priorizar por orçamento', () => {
    const leads = [
      { id: 'orcado-antigo', timestamp: 100, hasQuotation: true },
      { id: 'sem-email-novo', timestamp: 900, hasQuotation: false },
      { id: 'orcado-novo', timestamp: 800, hasQuotation: true },
      { id: 'pronto-meio', timestamp: 700, hasQuotation: false },
      { id: 'sem-nome', timestamp: 600, hasQuotation: false },
      { id: 'sem-telefone', timestamp: 500, hasQuotation: false },
      { id: 'antigo', timestamp: 400, hasQuotation: false },
    ];

    assert.deepEqual(
      prioritizeWhatsappLeads(leads).map((lead) => lead.id),
      ['sem-email-novo', 'orcado-novo', 'pronto-meio', 'sem-nome', 'sem-telefone']
    );
  });

  it('deduplica conversas pelo mesmo telefone mantendo a mais completa', () => {
    const leads = [
      {
        id: 'lid-sem-email',
        remoteJid: 'lid-sem-email',
        nome: 'Almir',
        telefone: '5516992433731',
        email: '',
        quotationId: 'ORC-20261702',
        timestamp: 1000,
      },
      {
        id: 'phone-com-email',
        remoteJid: '5516992433731@s.whatsapp.net',
        nome: 'Almir',
        telefone: '5516992433731',
        email: 'aatonello@hotmail.com',
        quotationId: 'ORC-20261702',
        timestamp: 900,
      },
    ];

    const [lead] = prioritizeWhatsappLeads(leads);

    assert.equal(prioritizeWhatsappLeads(leads).length, 1);
    assert.equal(lead.telefone, '5516992433731');
    assert.equal(lead.email, 'aatonello@hotmail.com');
    assert.equal(lead.quotationId, 'ORC-20261702');
    assert.equal(lead.timestamp, 1000);
  });

  it('não deduplica somente pelo nome', () => {
    const leads = prioritizeWhatsappLeads([
      { id: 'same-name-a', nome: 'Pessoa Igual', timestamp: 2 },
      { id: 'same-name-b', nome: 'Pessoa Igual', timestamp: 1 },
    ]);
    assert.equal(leads.length, 2);
  });

  it('mantém identidade autoritativa e não inventa dimensão conflitante', () => {
    const rows = [
      { id: 'newest', telefone: '5511999999999', email: '', quotationId: null, nome: 'Atual', timestamp: 300 },
      { id: 'older-a', telefone: '5511999999999', email: 'a@example.com', quotationId: null, nome: 'Antigo A', timestamp: 200 },
      { id: 'older-b', telefone: '5511999999999', email: 'b@example.com', quotationId: null, nome: 'Antigo B', timestamp: 100 },
    ];
    const [lead] = prioritizeWhatsappLeads(rows);
    assert.equal(lead.id, 'newest');
    assert.equal(lead.telefone, '5511999999999');
    assert.equal(lead.email, '');
    assert.equal(lead.nome, 'Atual');

    const [unique] = prioritizeWhatsappLeads([
      rows[0],
      { ...rows[1], email: 'a@example.com' },
    ]);
    assert.equal(unique.email, 'a@example.com');
  });

  it('deduplica componentes conectados por múltiplas pontes em qualquer ordem', () => {
    const rows = [
      {
        id: 'a-x',
        telefone: '5511999999999',
        email: 'x@example.com',
        nome: 'Pessoa A',
        resumo: 'resumo mais novo',
        timestamp: 300,
      },
      {
        id: 'a-y',
        telefone: '5511999999999',
        email: 'y@example.com',
        nome: 'Pessoa A antiga',
        timestamp: 200,
      },
      {
        id: 'b-y',
        telefone: '5521888888888',
        email: 'y@example.com',
        nome: 'Pessoa B',
        produto: 'canga',
        timestamp: 100,
      },
    ];
    const expected = prioritizeWhatsappLeads(rows);
    for (const permutation of [rows, [rows[2], rows[0], rows[1]], [rows[1], rows[2], rows[0]]]) {
      assert.deepEqual(prioritizeWhatsappLeads(permutation), expected);
    }
    assert.equal(expected.length, 1);
    assert.equal(expected[0].id, 'a-x');
    assert.equal(expected[0].email, 'x@example.com');
    assert.equal(expected[0].telefone, '5511999999999');
    assert.equal(expected[0].produto, 'canga');
  });

  it('não aceita e-mail oversized, padding de controle ou limite após trim', async () => {
    assert.equal(normalizeLeadEmail(`${'x'.repeat(10_000)}@example.com`), '');
    assert.equal(normalizeLeadEmail('cliente@example.com\u0000'), '');
    assert.equal(normalizeLeadEmail('\ncliente@example.com'), '');
    assert.equal(normalizeLeadEmail('\tcliente@example.com'), '');
    assert.equal(normalizeLeadEmail(`${' '.repeat(240)}cliente@example.com`), '');
    assert.equal(normalizeLeadEmail('  CLIENTE@EXAMPLE.COM  '), 'cliente@example.com');

    const saved = conversation({
      id: 'oversized-email',
      linkedLeadId: '11111111-1111-4111-8111-111111111111',
      linkedDealId: '44444444-4444-4444-8444-444444444444',
      linkedQuotationId: '55555555-5555-4555-8555-555555555555',
      linkedCrmEntityId: '11111111-1111-4111-8111-111111111111',
      linkedCrmEntityType: 'lead',
      linkedCrmMatchSource: 'email',
    });
    const result = await createHandler({
      ...storeFor([saved], { [saved.id]: [{ direction: 'inbound', body: 'Oi', timestamp: saved.lastMessageAt }] }),
      localCrm: null,
      extractLead: async () => ({ email: `${'x'.repeat(10_000)}@example.com` }),
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    assert.equal(result.statusCode, 200);
    const [lead] = parseBody(result).data;
    assert.equal(lead.email, '');
    for (const field of ['linkedLeadId', 'linkedDealId', 'linkedQuotationId', 'linkedCrmEntityId', 'linkedCrmEntityType', 'linkedCrmMatchSource']) {
      assert.equal(Object.prototype.hasOwnProperty.call(lead, field), false, field);
    }
  });

  it('usa o primeiro e-mail quando a conversa contém mais de um', () => {
    assert.equal(
      normalizeLeadEmail('financeiro@difratellirv.com.br e katia.souza@difratellirv.com.br'),
      'financeiro@difratellirv.com.br'
    );
  });

  it('marca qualidade do lead com pronto, orçamento ou campos faltantes', () => {
    assert.deepEqual(
      getWhatsappLeadQuality({
        nome: 'Difratelli Rio Verde Go',
        email: 'financeiro@difratellirv.com.br',
        telefone: '556499735283',
      }),
      { isReady: true, missingFields: [], statusLabel: 'Pronto para gerar' }
    );
    assert.deepEqual(
      getWhatsappLeadQuality({ nome: 'Karine', email: '', telefone: '554288025687' }),
      { isReady: false, missingFields: ['email'], statusLabel: 'Sem e-mail' }
    );
    assert.deepEqual(getWhatsappLeadQuality({ nome: '', email: '', telefone: '' }), {
      isReady: false,
      missingFields: ['nome', 'email', 'telefone'],
      statusLabel: 'Sem nome, e-mail e telefone',
    });
  });

  it('usa o nome do WhatsApp quando nome inferido pela IA está vazio', () => {
    assert.equal(
      resolveWhatsappDisplayName({ nome: '' }, { pushName: 'Dra Mahiara Liell' }, '554799632052'),
      'Dra Mahiara Liell'
    );
  });

  it('encontra o orçamento convertido por telefone, e-mail ou nome', () => {
    const converted = {
      phones: new Map([['4799632052', 'ORC-20261234']]),
      emails: new Map([['dra@example.com', 'ORC-20261235']]),
      names: new Map([['dra mahiara liell', 'ORC-20261236']]),
    };

    assert.equal(findConvertedQuotation({ telefone: '554799632052' }, converted), 'ORC-20261234');
    assert.equal(findConvertedQuotation({ email: 'DRA@example.com' }, converted), 'ORC-20261235');
    assert.equal(findConvertedQuotation({ nome: 'Dra Mahiara Liell' }, converted), 'ORC-20261236');
    assert.equal(findConvertedQuotation({ telefone: '5511999999999' }, converted), '');
  });

  it('inclui apenas leads com nome, e-mail e telefone real', () => {
    assert.equal(
      shouldIncludeWhatsappLead({
        nome: 'Dra Mahiara Liell',
        email: 'dramahiara@gmail.com',
        telefone: '554799632052',
      }),
      true
    );
    assert.equal(
      shouldIncludeWhatsappLead({ nome: 'Dra Mahiara Liell', email: '', telefone: '554799632052' }),
      false
    );
    assert.equal(
      shouldIncludeWhatsappLead({
        nome: '',
        email: 'dramahiara@gmail.com',
        telefone: '554799632052',
      }),
      false
    );
    assert.equal(
      shouldIncludeWhatsappLead({
        nome: 'Kátia',
        email: 'katia@example.com',
        telefone: '254881025777751',
      }),
      false
    );
  });

  it('identifica nome de atendente que só aparece no lado Aspen da conversa', () => {
    const normalized = [
      { fromMe: false, text: 'Olá, gostaria de um orçamento' },
      { fromMe: true, text: 'Claro! Meu nome é Juliana, vou te ajudar' },
      { fromMe: false, text: 'Meu nome é Viviane Correa' },
      { fromMe: true, text: 'Certo Viviane, qual seu email?' },
      { fromMe: false, text: 'viviane@email.com' },
    ];
    // "Juliana" aparece apenas nas mensagens Aspen (fromMe: true) → atendente
    assert.equal(isLikelyAttendantName('Juliana', normalized), true);
    // "Viviane" aparece no lado Cliente (fromMe: false) → cliente legítimo
    assert.equal(isLikelyAttendantName('Viviane', normalized), false);
    // Nome vazio ou curto demais → ignora
    assert.equal(isLikelyAttendantName('', normalized), false);
    assert.equal(isLikelyAttendantName('Jo', normalized), false);
  });
});

describe('OpenRouter response limits', () => {
  it('cancels declared and streamed oversized bodies before buffering', async () => {
    let declaredCancels = 0;
    const declared = {
      headers: new Headers({ 'content-length': String(300 * 1024) }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true }),
          cancel: async () => { declaredCancels += 1; },
        }),
      },
    } as unknown as Response;
    await assert.rejects(() => readResponseJson(declared), /response too large/);
    assert.equal(declaredCancels, 1);

    let streamedCancels = 0;
    const streamed = {
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array(256 * 1024 + 1) }),
          cancel: async () => { streamedCancels += 1; },
        }),
      },
    } as unknown as Response;
    await assert.rejects(() => readResponseJson(streamed), /response too large/);
    assert.equal(streamedCancels, 1);
  });

  it('aborts and cancels a body that never completes', async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key';
    let cancelled = 0;
    let aborted = false;
    try {
      await assert.rejects(
        () => requestOpenRouter({}, {
          timeoutMs: 5,
          fetchImpl: async (_url, init) => {
            init?.signal?.addEventListener('abort', () => { aborted = true; });
            return {
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              body: {
                getReader: () => ({
                  read: () => new Promise<never>(() => undefined),
                  cancel: async () => { cancelled += 1; },
                }),
              },
            } as unknown as Response;
          },
        }),
        /OpenRouter timeout/,
      );
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(aborted, true);
    assert.equal(cancelled, 1);
  });

  it('bounds late response cleanup after fetch ignores abort without reading its body', async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key';
    let resolveFetch: ((response: Response) => void) | undefined;
    let cancelled = 0;
    let reads = 0;
    const response = {
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: {
        getReader: () => ({
          read: async () => { reads += 1; return { done: true }; },
          cancel: async () => { cancelled += 1; },
        }),
      },
    } as unknown as Response;
    try {
      await assert.rejects(
        () => requestOpenRouter({}, {
          timeoutMs: 5,
          fetchImpl: (_url, init) => new Promise<Response>((resolve) => {
            resolveFetch = resolve;
            init?.signal?.addEventListener('abort', () => setTimeout(() => resolve(response), 10));
          }),
        }),
        /OpenRouter timeout/,
      );
      resolveFetch?.(response);
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
    assert.equal(cancelled, 1);
    assert.equal(reads, 0);
  });

  it('does not cancel a successful streamed JSON response', async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key';
    let cancelled = 0;
    let aborted = false;
    const chunks = [new TextEncoder().encode('{"ok":'), new TextEncoder().encode('true}')];
    try {
      const result = await requestOpenRouter({}, {
        timeoutMs: 100,
        fetchImpl: async (_url, init) => {
          init?.signal?.addEventListener('abort', () => { aborted = true; });
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
            body: {
              getReader: () => ({
                read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true },
                cancel: async () => { cancelled += 1; },
              }),
            },
          } as unknown as Response;
        },
      });
      assert.deepEqual(result, { ok: true });
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
    }
    assert.equal(cancelled, 0);
    assert.equal(aborted, false);
  });

  it('cancels malformed JSON bodies', async () => {
    let cancelled = 0;
    await assert.rejects(
      () => readResponseJson({
        headers: new Headers({ 'content-length': '8' }),
        body: {
          getReader: () => {
            let pending = true;
            return {
              read: async () => {
                if (!pending) return { done: true };
                pending = false;
                return { done: false, value: new TextEncoder().encode('not-json') };
              },
              cancel: async () => { cancelled += 1; },
            };
          },
        },
      } as unknown as Response),
      /invalid response JSON/,
    );
    assert.equal(cancelled, 1);
  });

  it('cancels bad status and MIME responses before consuming content', async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key';
    let cancelled = 0;
    let reads = 0;
    try {
      for (const response of [
        { ok: false, contentType: 'application/json' },
        { ok: true, contentType: 'text/html' },
      ]) {
        await assert.rejects(
          () => requestOpenRouter({}, {
            timeoutMs: 100,
            fetchImpl: async () => ({
              ok: response.ok,
              headers: new Headers({ 'content-type': response.contentType }),
              body: {
                getReader: () => ({
                  read: async () => { reads += 1; return { done: true }; },
                  cancel: async () => { cancelled += 1; },
                }),
              },
            } as unknown as Response),
          }),
        );
      }
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
    }
    assert.equal(cancelled, 2);
    assert.equal(reads, 0);
  });
});

function parseBody(result: { body?: string }): Record<string, any> {
  return JSON.parse(result.body || '{}');
}

function conversation(overrides: Partial<WhatsappConversation> = {}): WhatsappConversation {
  return {
    id: 'local-conversation',
    providerConversationId: 'provider-secret',
    remoteJid: 'provider-secret',
    canonicalPhone: '5511999999999',
    phone: '5511999999999',
    displayLabel: 'Snapshot Maria',
    displayName: 'Snapshot Maria',
    identityStatus: 'verified',
    identitySource: 'stored',
    identityConfidence: 'high',
    lastMessageAt: '2026-07-01T12:00:00.000Z',
    lastMessagePreview: 'preview',
    source: 'evolution',
    status: 'new',
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
}

function storeFor(
  conversations: unknown[],
  messages: Record<string, unknown[]> = {},
): WhatsappConversationStoreDeps {
  return {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => 'generated-id',
    readConversations: async () => conversations as WhatsappConversation[],
    writeConversations: async () => {},
    readMessages: async (id) => (messages[id] || []) as any,
    writeMessages: async () => {},
  };
}

function localQuotationRepository(
  findCandidatesByPhone: LocalWhatsappCrmRepository['findCandidatesByPhone'],
): LocalWhatsappCrmRepository {
  return {
    getQuoteLead: async () => null,
    getClient: async () => null,
    getDeal: async () => null,
    getQuotation: async () => null,
    findCandidatesByPhone,
  };
}

describe('whatsapp-leads snapshot handler', () => {
  it('has no external lead dependencies and never exposes transport data', async () => {
    const source = await readFile(new URL('../../api/modules/whatsapp-leads.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /external|operational-mode|findContacts/i);

    const saved = conversation();
    const unresolved = conversation({ id: 'unresolved', identityStatus: 'unresolved', canonicalPhone: '' });
    const result = await createHandler({
      ...storeFor([saved, unresolved], {
        [saved.id]: [{
          id: 'local-message',
          providerMessageId: 'provider-message-secret',
          direction: 'inbound',
          type: 'image',
          body: 'Olá maria@example.com',
          mediaUrl: 'https://provider.invalid/media.jpg',
          raw: { apikey: 'secret' },
          timestamp: saved.lastMessageAt,
        }],
      }),
      localCrm: null,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);

    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal(body.data.length, 1);
    assert.equal(JSON.stringify(body).includes('provider-secret'), false);
    assert.equal(JSON.stringify(body).includes('provider-message-secret'), false);
    assert.equal(JSON.stringify(body).includes('provider.invalid'), false);
    assert.equal(JSON.stringify(body).includes('apikey'), false);
  });

  it('runs bounded sync before reading stored snapshots', async () => {
    const events: string[] = [];
    const saved = conversation({ id: 'synced-local' });
    const result = await createHandler({
      ...storeFor([saved], { [saved.id]: [{ direction: 'inbound', body: 'Oi', timestamp: saved.lastMessageAt }] }),
      localCrm: null,
      sync: async (options) => events.push(`sync:${options.chatLimit}:${options.messageLimit}`),
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    events.push('response');
    assert.equal(result.statusCode, 200);
    assert.deepEqual(events, ['sync:5:50', 'response']);
    assert.equal(parseBody(result).data[0].id, saved.id);
  });

  it('caps snapshots at twenty and limits extraction/CRM concurrency to four', async () => {
    const conversations = Array.from({ length: 30 }, (_, index) => conversation({
      id: `bounded-${index}`,
      canonicalPhone: String(5511000000000 + index),
      phone: String(5511000000000 + index),
      lastMessageAt: new Date(Date.UTC(2026, 6, 1, 12, index)).toISOString(),
    }));
    const seen: string[] = [];
    let calls = 0;
    let active = 0;
    let maximum = 0;
    const result = await createHandler({
      ...storeFor(conversations),
      readMessages: async (id) => {
        seen.push(id);
        return [];
      },
      localCrm: null,
      extractLead: async () => {
        calls += 1;
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {};
      },
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    assert.equal(result.statusCode, 200);
    assert.equal(calls, 20);
    assert.deepEqual(
      [...new Set(seen)].sort(),
      Array.from({ length: 20 }, (_, offset) => `bounded-${29 - offset}`).sort(),
    );
    assert.ok(maximum <= 4);
  });

  it('drena workers ativos antes do 503 e não agenda novos itens após falha', async () => {
    const conversations = Array.from({ length: 12 }, (_, index) => conversation({
      id: index === 0 ? 'worker-fail' : `worker-${index}`,
      canonicalPhone: String(5511000000000 + index),
      phone: String(5511000000000 + index),
      lastMessageAt: new Date(Date.UTC(2026, 6, 1, 13, 12 - index)).toISOString(),
    }));
    let active = 0;
    let calls = 0;
    const events: string[] = [];
    const result = await createHandler({
      ...storeFor(conversations),
      readMessages: async (id) => {
        calls += 1;
        active += 1;
        try {
          if (id === 'worker-fail') {
            await new Promise((resolve) => setTimeout(resolve, 5));
            throw new Error('worker failed');
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
          return [];
        } finally {
          active -= 1;
          events.push(`settled:${id}`);
        }
      },
      localCrm: null,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    events.push('response');
    assert.equal(result.statusCode, 503);
    assert.equal(active, 0);
    assert.equal(calls, 4);
    assert.equal(events.at(-1), 'response');
  });

  it('normalizes provider phone prefix and accepts only valid formatted snapshots', async () => {
    const formatted = conversation({
      id: 'formatted-phone',
      canonicalPhone: '+55 (11) 99999-9999',
      phone: '+55 (11) 99999-9999',
    });
    const providerPrefix = conversation({
      id: 'provider-prefix',
      canonicalPhone: '',
      phone: '21 98888-7777',
    });
    const jid = conversation({
      id: 'jid-phone',
      canonicalPhone: '5511999999999@s.whatsapp.net',
      phone: '5511999999999@s.whatsapp.net',
    });
    const result = await createHandler({
      ...storeFor([formatted, providerPrefix, jid]),
      localCrm: null,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    const data = parseBody(result).data;
    assert.equal(result.statusCode, 200);
    assert.equal(data.find((lead: any) => lead.id === formatted.id)?.telefone, '5511999999999');
    assert.equal(data.find((lead: any) => lead.id === providerPrefix.id)?.telefone, '5521988887777');
    assert.equal(data.some((lead: any) => lead.id === jid.id), false);
  });

  it('correlates entity-only saved lead links with a linked quotation', async () => {
    const leadId = '11111111-1111-4111-8111-111111111111';
    const quotationId = '55555555-5555-4555-8555-555555555555';
    const saved = conversation({
      id: 'entity-only-link',
      linkedCrmEntityId: leadId,
      linkedCrmEntityType: 'lead',
      linkedCrmMatchSource: 'email',
      linkedQuotationId: quotationId,
    });
    const localLead = {
      id: leadId,
      nome: 'Maria Silva',
      telefone: saved.canonicalPhone,
      email: 'maria@example.com',
      status: 'ready',
      quotationId,
      crmDealId: null,
    };
    const localQuotation = {
      id: quotationId,
      businessNumber: 'ORC-20260001',
      clientId: '66666666-6666-4666-8666-666666666666',
      status: 'enviado',
      snapshot: null,
    };
    const result = await createHandler({
      ...storeFor([saved], { [saved.id]: [{ direction: 'inbound', body: 'Oi', timestamp: saved.lastMessageAt }] }),
      localCrm: {
        getQuoteLead: async (id) => id === leadId ? localLead : null,
        getClient: async () => null,
        getDeal: async () => null,
        getQuotation: async (id) => id === quotationId ? localQuotation : null,
      },
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    const [lead] = parseBody(result).data;
    assert.equal(result.statusCode, 200);
    assert.equal(lead.quotationId, quotationId);
  });

  it('does not publish an inconsistent saved quotation link', async () => {
    const leadId = '11111111-1111-4111-8111-111111111111';
    const dealId = '44444444-4444-4444-8444-444444444444';
    const quotationId = '55555555-5555-4555-8555-555555555555';
    const otherQuotationId = '66666666-6666-4666-8666-666666666666';
    const saved = conversation({
      id: 'inconsistent-saved-links',
      linkedLeadId: leadId,
      linkedDealId: dealId,
      linkedQuotationId: quotationId,
    });
    const result = await createHandler({
      ...storeFor([saved], { [saved.id]: [{ direction: 'inbound', body: 'Oi', timestamp: saved.lastMessageAt }] }),
      localCrm: {
        getQuoteLead: async (id) => id === leadId ? {
          id: leadId,
          nome: 'Maria Silva',
          telefone: saved.canonicalPhone,
          email: 'maria@example.com',
          status: 'ready',
          quotationId,
          crmDealId: dealId,
        } : null,
        getClient: async () => null,
        getDeal: async (id) => id === dealId ? {
          id: dealId,
          quoteLeadId: leadId,
          clientId: null,
          quotationId: otherQuotationId,
          nome: 'Maria Silva',
          telefone: saved.canonicalPhone,
          email: null,
          status: 'Novo Lead',
        } : null,
        getQuotation: async (id) => id === quotationId ? {
          id: quotationId,
          businessNumber: 'ORC-20260001',
          clientId: '77777777-7777-4777-8777-777777777777',
          status: 'enviado',
          snapshot: null,
        } : null,
      },
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    const [lead] = parseBody(result).data;
    assert.equal(result.statusCode, 200);
    assert.equal(lead.quotationId, null);
    assert.equal(lead.hasQuotation, false);
  });

  it('does not publish an injected linked quotation without a local resolver candidate', async () => {
    const injectedQuotationId = '88888888-8888-4888-8888-888888888888';
    const saved = conversation({
      id: 'injected-linked-quotation',
      linkedQuotationId: injectedQuotationId,
    });
    const result = await createHandler({
      ...storeFor([saved], { [saved.id]: [{ direction: 'inbound', body: 'Oi', timestamp: saved.lastMessageAt }] }),
      localCrm: {
        getQuoteLead: async () => null,
        getClient: async () => null,
        getDeal: async () => null,
        getQuotation: async () => null,
      },
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    const [lead] = parseBody(result).data;
    assert.equal(result.statusCode, 200);
    assert.equal(lead.quotationId, null);
    assert.equal(lead.hasQuotation, false);
  });

  it('publishes a consistent direct saved quotation resolved through local CRM', async () => {
    const clientId = '77777777-7777-4777-8777-777777777777';
    const quotationId = '55555555-5555-4555-8555-555555555555';
    const saved = conversation({
      id: 'direct-saved-quotation',
      linkedQuotationId: quotationId,
    });
    const result = await createHandler({
      ...storeFor([saved], { [saved.id]: [{ direction: 'inbound', body: 'Oi', timestamp: saved.lastMessageAt }] }),
      localCrm: {
        getQuoteLead: async () => null,
        getClient: async (id) => id === clientId ? {
          id: clientId,
          nome: 'Maria Silva',
          telefone: saved.canonicalPhone,
          email: 'maria@example.com',
          arquivado: false,
        } : null,
        getDeal: async () => null,
        getQuotation: async (id) => id === quotationId ? {
          id: quotationId,
          businessNumber: 'ORC-20260001',
          clientId,
          status: 'enviado',
          snapshot: null,
        } : null,
      },
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    const [lead] = parseBody(result).data;
    assert.equal(result.statusCode, 200);
    assert.equal(lead.quotationId, quotationId);
    assert.equal(lead.hasQuotation, true);
  });

  it('keeps resolver failures as Portuguese 503 responses', async () => {
    const quotationId = '55555555-5555-4555-8555-555555555555';
    const saved = conversation({
      id: 'resolver-failure',
      linkedQuotationId: quotationId,
    });
    const result = await createHandler({
      ...storeFor([saved], { [saved.id]: [{ direction: 'inbound', body: 'Oi', timestamp: saved.lastMessageAt }] }),
      localCrm: {
        getQuoteLead: async () => null,
        getClient: async () => null,
        getDeal: async () => null,
        getQuotation: async () => { throw new Error('database failure'); },
      },
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    assert.equal(result.statusCode, 503);
    assert.match(parseBody(result).error, /dados comerciais locais/);
  });

  it('formats verified snapshots and correlates one unambiguous local quotation', async () => {
    const quotationId = '55555555-5555-4555-8555-555555555555';
    const saved = conversation({ displayLabel: 'Snapshot Maria', displayName: 'Mutable Catalog Name' });
    const localCrm = localQuotationRepository(async () => [{
      id: 'client-1',
      tipo: 'cliente',
      nome: 'Mutable Catalog Name',
      telefone: saved.canonicalPhone,
      email: null,
      quotationId,
    }]);
    const result = await createHandler({
      ...storeFor([saved], {
        [saved.id]: [{
          direction: 'inbound',
          body: 'Meu e-mail é maria@example.com e preciso de 10 cangas.',
          timestamp: saved.lastMessageAt,
        }],
      }),
      localCrm,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    const [lead] = parseBody(result).data;
    assert.equal(result.statusCode, 200);
    assert.equal(lead.nome, 'Snapshot Maria');
    assert.equal(lead.email, 'maria@example.com');
    assert.equal(lead.quotationId, quotationId);
    assert.equal(lead.hasQuotation, true);
    assert.equal(lead.isReady, true);
  });

  it('fails closed on ambiguous local correlation and excludes unresolved identities', async () => {
    const saved = conversation({ id: 'ambiguous-local' });
    const unresolved = conversation({ id: 'unresolved-local', identityStatus: 'conflict', canonicalPhone: '' });
    const localCrm = localQuotationRepository(async () => [
      { id: 'client-a', tipo: 'cliente', nome: 'Catalog A', telefone: saved.canonicalPhone, email: null, quotationId: 'ORC-20260001' },
      { id: 'client-b', tipo: 'cliente', nome: 'Catalog B', telefone: saved.canonicalPhone, email: null, quotationId: 'ORC-20260002' },
    ]);
    const result = await createHandler({
      ...storeFor([saved, unresolved], { [saved.id]: [{ direction: 'inbound', body: 'Oi', timestamp: saved.lastMessageAt }] }),
      localCrm,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    const data = parseBody(result).data;
    assert.equal(result.statusCode, 200);
    assert.equal(data.length, 1);
    assert.equal(data[0].quotationId, null);
    assert.equal(data[0].nome, 'Snapshot Maria');
  });

  it('deduplicates by identity, keeps newest first, and limits output to five', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => conversation({
      id: `local-${index}`,
      canonicalPhone: `55119999999${String(index).padStart(2, '0')}`,
      phone: `55119999999${String(index).padStart(2, '0')}`,
      displayLabel: `Pessoa ${index}`,
      displayName: `Pessoa ${index}`,
      lastMessageAt: new Date(Date.UTC(2026, 6, 1, 12, index)).toISOString(),
    }));
    rows[1] = conversation({ ...rows[1], id: 'duplicate-newer', canonicalPhone: rows[0].canonicalPhone, phone: rows[0].phone, lastMessageAt: new Date(Date.UTC(2026, 6, 1, 13)).toISOString() });
    const result = await createHandler({
      ...storeFor(rows, Object.fromEntries(rows.map((row) => [row.id, [{ direction: 'inbound', body: 'Oi', timestamp: row.lastMessageAt }]]))),
      localCrm: null,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    const leads = parseBody(result).data;
    assert.equal(result.statusCode, 200);
    assert.equal(leads.length, 5);
    assert.equal(leads[0].id, 'duplicate-newer');
    assert.equal(leads.some((lead: any) => lead.id === rows[0].id), false);
  });

  it('sanitizes malformed historical conversation and message snapshots', async () => {
    const malformed = {
      ...conversation({ id: 'malformed-local' }),
      canonicalPhone: { leaked: 'provider-phone' },
      displayLabel: { leaked: 'provider-name' },
      secret: 'must disappear',
    } as any;
    const result = await createHandler({
      ...storeFor([malformed], {
        'malformed-local': [{
          direction: 'inbound',
          body: { leaked: 'message-body' },
          mediaUrl: 'https://provider.invalid/raw.jpg',
          raw: { token: 'secret' },
          timestamp: malformed.lastMessageAt,
        }],
      }),
      localCrm: null,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal(body.data.length, 0);
    assert.equal(JSON.stringify(body).includes('provider'), false);
    assert.equal(JSON.stringify(body).includes('secret'), false);
  });

  it('falls back to sanitized inbound text when OpenRouter is unavailable', async () => {
    const saved = conversation({ id: 'fallback-local' });
    const result = await createHandler({
      ...storeFor([saved], {
        [saved.id]: [{ direction: 'outbound', body: 'atendente@example.com', timestamp: saved.lastMessageAt }, {
          direction: 'inbound',
          body: `Mensagem ${'x'.repeat(10_000)} contato maria@example.com`,
          timestamp: saved.lastMessageAt,
        }],
      }),
      localCrm: null,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    const [lead] = parseBody(result).data;
    assert.equal(result.statusCode, 200);
    assert.equal(lead.email, 'maria@example.com');
    assert.ok(lead.resumo.length <= 2_000);
    assert.equal(lead.resumo.includes('atendente@example.com'), false);
  });

  it('returns Portuguese errors for sync, store, and CRM failures, plus 405', async () => {
    const method = await createHandler({ localCrm: null })({
      httpMethod: 'POST', queryStringParameters: {}, headers: {}, body: '',
    } as any);
    assert.equal(method.statusCode, 405);
    assert.match(parseBody(method).error, /Método não permitido/);

    const syncFailure = await createHandler({
      sync: async () => { throw Object.assign(new Error('sync failure'), { statusCode: 503, message: 'Sincronização indisponível.' }); },
      localCrm: null,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    assert.equal(syncFailure.statusCode, 503);
    assert.match(parseBody(syncFailure).error, /Sincronização indisponível/);

    const storeFailure = await createHandler({
      ...storeFor([]),
      readConversations: async () => { throw new Error('KV failure'); },
      localCrm: null,
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    assert.equal(storeFailure.statusCode, 503);
    assert.match(parseBody(storeFailure).error, /acessar as conversas/);

    const saved = conversation({ id: 'crm-failure' });
    const crmFailure = await createHandler({
      ...storeFor([saved], { [saved.id]: [{ direction: 'inbound', body: 'Oi', timestamp: saved.lastMessageAt }] }),
      localCrm: localQuotationRepository(async () => { throw new Error('database failure'); }),
    })({ httpMethod: 'GET', queryStringParameters: {}, headers: {} } as any);
    assert.equal(crmFailure.statusCode, 503);
    assert.match(parseBody(crmFailure).error, /dados comerciais locais/);
  });
});
