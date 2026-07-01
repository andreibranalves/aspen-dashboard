import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';

import { createHandler, handler as _handler } from '../../api/_functions/typebot-lead-capture.js';

type HandlerResult = { statusCode: number; body: string };
const handler = _handler as (event: unknown) => Promise<HandlerResult>;
type FetchCall = { url: string; options: RequestInit };

const ORIGINAL_ENV = {
  TYPEBOT_LEAD_WEBHOOK_TOKEN: process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN,
  TYPEBOT_LEAD_CAPTURE_ENABLED: process.env.TYPEBOT_LEAD_CAPTURE_ENABLED,
  META_CAPI_ACCESS_TOKEN: process.env.META_CAPI_ACCESS_TOKEN,
};
const ORIGINAL_FETCH = globalThis.fetch;

function parseBody(result: HandlerResult) {
  return JSON.parse(result.body);
}

function baseExpectedLead(overrides: Record<string, unknown> = {}) {
  return {
    nome: '',
    email: '',
    telefone: '',
    origem: 'Website',
    canal: 'whatsapp',
    produto: '',
    mensagem_contexto: '',
    empresa: '',
    quantidade: '',
    finalidade: '',
    prazo: '',
    arte: '',
    result_id: null,
    page_url: null,
    utm_source: null,
    utm_campaign: null,
    utm_medium: null,
    utm_content: null,
    utm_term: null,
    campaign: null,
    gclid: null,
    gbraid: null,
    wbraid: null,
    fbclid: null,
    source_cta: null,
    ...overrides,
  };
}

function buildEvent({
  method = 'POST',
  token = 'secret',
  body = {},
  authHeader = 'authorization',
}: {
  method?: string;
  token?: string;
  body?: unknown;
  authHeader?: string;
} = {}) {
  const headers: Record<string, string> = token
    ? authHeader === 'Authorization'
      ? { Authorization: `Bearer ${token}` }
      : { authorization: `Bearer ${token}` }
    : {};

  return {
    httpMethod: method,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function jsonResponse(
  body: unknown,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}
) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  if (ORIGINAL_ENV.TYPEBOT_LEAD_WEBHOOK_TOKEN === undefined) {
    delete process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN;
  } else {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = ORIGINAL_ENV.TYPEBOT_LEAD_WEBHOOK_TOKEN;
  }

  if (ORIGINAL_ENV.TYPEBOT_LEAD_CAPTURE_ENABLED === undefined) {
    delete process.env.TYPEBOT_LEAD_CAPTURE_ENABLED;
  } else {
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = ORIGINAL_ENV.TYPEBOT_LEAD_CAPTURE_ENABLED;
  }

  if (ORIGINAL_ENV.META_CAPI_ACCESS_TOKEN === undefined) {
    delete process.env.META_CAPI_ACCESS_TOKEN;
  } else {
    process.env.META_CAPI_ACCESS_TOKEN = ORIGINAL_ENV.META_CAPI_ACCESS_TOKEN;
  }

  globalThis.fetch = ORIGINAL_FETCH;
});

describe('typebot-lead-capture handler', () => {
  it('retorna 405 para método diferente de POST', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';

    const result = await handler(buildEvent({ method: 'GET' }));

    assert.equal(result.statusCode, 405);
    assert.deepEqual(parseBody(result), { error: 'Method Not Allowed' });
  });

  it('retorna 401 sem bearer válido', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';

    const result = await handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ nome: 'Teste' }),
    });

    assert.equal(result.statusCode, 401);
    assert.deepEqual(parseBody(result), { error: 'Não autorizado.' });
  });

  it('retorna 400 para JSON inválido', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';

    const result = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: '{nome:',
    });

    assert.equal(result.statusCode, 400);
    assert.deepEqual(parseBody(result), { error: 'JSON inválido.' });
  });

  it('reproduz o contrato atual de produção quando desativado', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'false';

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Teste Pi',
          email: 'TESTE@EXAMPLE.COM',
          telefone: '(11) 99999-9999',
          origem: 'teste',
          canal: 'whatsapp',
          dry_run: true,
        },
      })
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result), {
      success: true,
      enabled: false,
      dry_run: true,
      action: 'would_create',
      lead_id: null,
      existing_lead: null,
      activation_required: true,
      lead: baseExpectedLead({
        nome: 'Teste Pi',
        email: 'teste@example.com',
        telefone: '5511999999999',
      }),
    });
  });

  it('normaliza defaults opcionais sem perder o contrato', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'false';

    const result = await handler(
      buildEvent({
        body: { nome: '  Ana  ', telefone: '11988887777' },
        authHeader: 'Authorization',
      })
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result), {
      success: true,
      enabled: false,
      dry_run: false,
      action: 'would_create',
      lead_id: null,
      existing_lead: null,
      activation_required: true,
      lead: baseExpectedLead({
        nome: 'Ana',
        telefone: '5511988887777',
      }),
    });
  });

  it('simula atualização por email quando enabled + dry_run', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';

    const calls: FetchCall[] = [];
    globalThis.fetch = (async (url, options = {}) => {
      calls.push({ url: url as string, options: options as RequestInit });
      return jsonResponse({
        data: [{ name: 'LEAD-0001', email_id: 'ana@example.com', mobile_no: '5511999999999' }],
      });
    }) as typeof globalThis.fetch;

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Ana',
          email: 'ana@example.com',
          telefone: '11999999999',
          dry_run: true,
        },
      })
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result), {
      success: true,
      enabled: true,
      dry_run: true,
      action: 'would_update',
      lead_id: 'LEAD-0001',
      existing_lead: 'LEAD-0001',
      activation_required: false,
      lead: baseExpectedLead({
        nome: 'Ana',
        email: 'ana@example.com',
        telefone: '5511999999999',
      }),
      quote_lead: null,
    });

    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(
      url.searchParams.get('filters'),
      JSON.stringify([['email_id', '=', 'ana@example.com']])
    );
  });

  it('cria lead novo quando enabled sem duplicata', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    delete process.env.META_CAPI_ACCESS_TOKEN;

    const calls: FetchCall[] = [];
    globalThis.fetch = (async (url, options = {}) => {
      calls.push({ url: url as string, options: options as RequestInit });
      const method = options.method || 'GET';
      if (method === 'GET') return jsonResponse({ data: [] });
      if (method === 'POST') {
        return jsonResponse({ data: { name: 'LEAD-NEW' } });
      }
      throw new Error(`Unexpected method ${method}`);
    }) as typeof globalThis.fetch;

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Cliente Novo',
          email: 'novo@example.com',
          telefone: '(11) 98888-7777',
        },
      })
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result), {
      success: true,
      enabled: true,
      dry_run: false,
      action: 'created',
      lead_id: 'LEAD-NEW',
      existing_lead: null,
      activation_required: false,
      lead: baseExpectedLead({
        nome: 'Cliente Novo',
        email: 'novo@example.com',
        telefone: '5511988887777',
      }),
      meta_capi: { sent: false, reason: 'missing_token' },
      quote_lead: null,
      quote_lead_error: 'Lead salvo no ERP, mas não entrou na fila de orçamento.',
    });

    assert.equal(calls.length, 3);
    assert.equal(calls[2].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[2].options.body as string), {
      lead_name: 'Cliente Novo',
      email_id: 'novo@example.com',
      mobile_no: '5511988887777',
      source: 'Website',
    });
  });

  it('atualiza lead existente por telefone quando enabled', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    delete process.env.META_CAPI_ACCESS_TOKEN;

    const calls: FetchCall[] = [];
    globalThis.fetch = (async (url, options = {}) => {
      calls.push({ url: url as string, options: options as RequestInit });
      const method = options.method || 'GET';
      const parsedUrl = new URL(url as string);
      if (method === 'GET' && parsedUrl.searchParams.get('filters')) {
        return jsonResponse({ data: [] });
      }
      if (method === 'GET' && parsedUrl.searchParams.get('or_filters')) {
        return jsonResponse({ data: [{ name: 'LEAD-EXIST', mobile_no: '(11) 98888-7777' }] });
      }
      if (method === 'PUT') {
        return jsonResponse({ data: { name: 'LEAD-EXIST' } });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    }) as typeof globalThis.fetch;

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Cliente Existente',
          telefone: '11988887777',
          produto: 'lenço',
        },
      })
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result), {
      success: true,
      enabled: true,
      dry_run: false,
      action: 'updated',
      lead_id: 'LEAD-EXIST',
      existing_lead: 'LEAD-EXIST',
      activation_required: false,
      lead: baseExpectedLead({
        nome: 'Cliente Existente',
        telefone: '5511988887777',
        produto: 'lenço',
      }),
      meta_capi: { sent: false, reason: 'missing_token' },
      quote_lead: null,
      quote_lead_error: 'Lead salvo no ERP, mas não entrou na fila de orçamento.',
    });

    const phoneLookupUrl = new URL(calls[0].url);
    assert.equal(
      phoneLookupUrl.searchParams.get('or_filters'),
      JSON.stringify([
        ['mobile_no', '=', '5511988887777'],
        ['mobile_no', '=', '11988887777'],
        ['mobile_no', '=', '(11) 98888-7777'],
      ])
    );
    assert.equal(calls[1].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1].options.body as string), {
      lead_name: 'Cliente Existente',
      mobile_no: '5511988887777',
      source: 'Website',
      notes: [{ note: 'Produto: lenço' }],
    });
  });

  it('repassa campos de attribution no lead quando desativado', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'false';

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Teste Attribution',
          email: 'attr@example.com',
          result_id: 'r-123',
          page_url: 'https://aspen.com/produto',
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: 'verao',
          utm_content: 'banner-a',
          utm_term: 'lenco',
          campaign: 'campanha-vendas',
          gclid: 'gclid-abc',
          gbraid: 'gbraid-def',
          wbraid: 'wbraid-ghi',
          fbclid: 'fbclid-jkl',
          source: 'topbar',
        },
      })
    );

    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.deepEqual(
      body.lead,
      baseExpectedLead({
        nome: 'Teste Attribution',
        email: 'attr@example.com',
        result_id: 'r-123',
        page_url: 'https://aspen.com/produto',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'verao',
        utm_content: 'banner-a',
        utm_term: 'lenco',
        campaign: 'campanha-vendas',
        gclid: 'gclid-abc',
        gbraid: 'gbraid-def',
        wbraid: 'wbraid-ghi',
        fbclid: 'fbclid-jkl',
        source_cta: 'topbar',
      })
    );
  });

  it('cria lead novo com custom fields de attribution quando presentes', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    delete process.env.META_CAPI_ACCESS_TOKEN;

    const calls: FetchCall[] = [];
    globalThis.fetch = (async (url, options = {}) => {
      calls.push({ url: url as string, options: options as RequestInit });
      const method = options.method || 'GET';
      if (method === 'GET') return jsonResponse({ data: [] });
      if (method === 'POST') return jsonResponse({ data: { name: 'LEAD-ATTR' } });
      throw new Error(`Unexpected method ${method}`);
    }) as typeof globalThis.fetch;

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Cliente Attribution',
          email: 'attr@example.com',
          telefone: '11999999999',
          page_url: 'https://aspen.com/produto',
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: 'verao',
          utm_content: 'banner-a',
          utm_term: 'lenco',
          gclid: 'gclid-abc',
          gbraid: 'gbraid-def',
          wbraid: 'wbraid-ghi',
          fbclid: 'fbclid-jkl',
          source: 'topbar',
        },
      })
    );

    const body = parseBody(result);
    assert.equal(result.statusCode, 200);
    assert.equal(body.action, 'created');
    assert.deepEqual(body.meta_capi, { sent: false, reason: 'missing_token' });
    assert.equal(calls.length, 3);
    assert.equal(calls[2].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[2].options.body as string), {
      lead_name: 'Cliente Attribution',
      email_id: 'attr@example.com',
      mobile_no: '5511999999999',
      source: 'Website',
      custom_page_url: 'https://aspen.com/produto',
      custom_utm_source: 'google',
      custom_utm_medium: 'cpc',
      custom_utm_campaign: 'verao',
      custom_utm_content: 'banner-a',
      custom_utm_term: 'lenco',
      custom_gclid: 'gclid-abc',
      custom_gbraid: 'gbraid-def',
      custom_wbraid: 'wbraid-ghi',
      custom_fbclid: 'fbclid-jkl',
      custom_source_cta: 'topbar',
    });
  });

  it('não sobrescreve attribution já preenchido no lead existente (first-touch)', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    delete process.env.META_CAPI_ACCESS_TOKEN;

    const calls: FetchCall[] = [];
    globalThis.fetch = (async (url, options = {}) => {
      calls.push({ url: url as string, options: options as RequestInit });
      const method = options.method || 'GET';
      const parsedUrl = new URL(url as string);
      if (method === 'GET' && parsedUrl.searchParams.get('filters')) {
        const fields = JSON.parse(parsedUrl.searchParams.get('fields') || '[]');
        assert.ok(fields.includes('custom_utm_source'));
        assert.ok(fields.includes('custom_gclid'));
        assert.ok(fields.includes('custom_page_url'));
        return jsonResponse({
          data: [
            {
              name: 'LEAD-OLD',
              email_id: 'old@example.com',
              mobile_no: '5511999999999',
              custom_gclid: 'gclid-antigo',
              custom_utm_source: 'google',
            },
          ],
        });
      }
      if (method === 'PUT') {
        return jsonResponse({ data: { name: 'LEAD-OLD' } });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    }) as typeof globalThis.fetch;

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Cliente Velho',
          email: 'old@example.com',
          page_url: 'https://aspen.com/novo',
          utm_source: 'facebook',
          utm_medium: 'social',
          gclid: 'gclid-novo',
        },
      })
    );

    const body = parseBody(result);
    assert.equal(result.statusCode, 200);
    assert.equal(body.action, 'updated');
    assert.deepEqual(body.meta_capi, { sent: false, reason: 'missing_token' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1].options.body as string), {
      lead_name: 'Cliente Velho',
      email_id: 'old@example.com',
      source: 'Website',
      custom_page_url: 'https://aspen.com/novo',
      custom_utm_medium: 'social',
    });
  });

  it('preenche attribution em lead existente sem custom fields (first-touch)', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    delete process.env.META_CAPI_ACCESS_TOKEN;

    const calls: FetchCall[] = [];
    globalThis.fetch = (async (url, options = {}) => {
      calls.push({ url: url as string, options: options as RequestInit });
      const method = options.method || 'GET';
      if (method === 'GET') {
        return jsonResponse({
          data: [
            {
              name: 'LEAD-EMPTY',
              email_id: 'empty@example.com',
              mobile_no: null,
              custom_gclid: null,
              custom_utm_source: '',
            },
          ],
        });
      }
      if (method === 'PUT') {
        return jsonResponse({ data: { name: 'LEAD-EMPTY' } });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    }) as typeof globalThis.fetch;

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Cliente Vazio',
          email: 'empty@example.com',
          gclid: 'gclid-novo',
          utm_source: 'google',
        },
      })
    );

    const body = parseBody(result);
    assert.equal(result.statusCode, 200);
    assert.equal(body.action, 'updated');
    assert.deepEqual(body.meta_capi, { sent: false, reason: 'missing_token' });
    assert.equal(calls[1].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1].options.body as string), {
      lead_name: 'Cliente Vazio',
      email_id: 'empty@example.com',
      source: 'Website',
      custom_gclid: 'gclid-novo',
      custom_utm_source: 'google',
    });
  });

  it('retorna 400 no modo enabled sem nome', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';

    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse({ data: [] });
    }) as typeof globalThis.fetch;

    const result = await handler(buildEvent({ body: { telefone: '11999999999' } }));

    assert.equal(result.statusCode, 400);
    assert.deepEqual(parseBody(result), { error: 'Nome é obrigatório.' });
    assert.equal(called, false);
  });

  it('rejects unqualified Typebot submissions below 30 units', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';

    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse({ data: [] });
    }) as typeof globalThis.fetch;

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Teste Sem Qualificação',
          email: 'teste@example.com',
          telefone: '11999999999',
          quantidade: 'Menos de 30 unidades',
          dry_run: false,
        },
      })
    );

    assert.equal(result.statusCode, 400);
    assert.deepEqual(parseBody(result), { error: 'minimum_quantity_required' });
    assert.equal(called, false);
  });

  it('includes company and qualification context in ERP payload', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    delete process.env.META_CAPI_ACCESS_TOKEN;

    const calls: { url: string; options: RequestInit }[] = [];
    globalThis.fetch = (async (url, options = {}) => {
      calls.push({ url: url as string, options: options as RequestInit });
      const method = (options.method || 'GET') as string;
      if (method === 'GET') return jsonResponse({ data: [] });
      if (method === 'POST') {
        return jsonResponse({ data: { name: 'LEAD-QUALIFIED' } });
      }
      throw new Error(`Unexpected method ${method}`);
    }) as typeof globalThis.fetch;

    const result = await handler(
      buildEvent({
        body: {
          nome: 'Empresa Teste Ltda',
          email: 'contato@empresa.com',
          telefone: '11988887777',
          empresa: 'Empresa Teste Ltda',
          quantidade: '100 unidades',
          produto: 'Lenços Personalizados',
          finalidade: 'Brindes Corporativos',
          prazo: '30 dias',
          arte: 'Sim',
          origem: 'Meta Ads',
          page_url: 'https://aspen.com/produto',
          result_id: 'r-999',
          utm_source: 'meta',
          utm_medium: 'ads',
        },
      })
    );

    assert.equal(result.statusCode, 200);

    const body = parseBody(result);
    assert.equal(body.action, 'created');
    assert.equal(body.lead_id, 'LEAD-QUALIFIED');
    assert.deepEqual(
      body.lead,
      baseExpectedLead({
        nome: 'Empresa Teste Ltda',
        email: 'contato@empresa.com',
        telefone: '5511988887777',
        origem: 'Meta Ads',
        produto: 'Lenços Personalizados',
        empresa: 'Empresa Teste Ltda',
        quantidade: '100 unidades',
        finalidade: 'Brindes Corporativos',
        prazo: '30 dias',
        arte: 'Sim',
        result_id: 'r-999',
        page_url: 'https://aspen.com/produto',
        utm_source: 'meta',
        utm_medium: 'ads',
      })
    );

    // Verify ERP POST has company_name, notes, and correct source
    assert.ok(calls.length >= 3);
    const postCall = calls.find((c) => c.options.method === 'POST');
    assert.ok(postCall, 'Expected a POST call');

    const postBody = JSON.parse(postCall.options.body as string);
    assert.equal(postBody.lead_name, 'Empresa Teste Ltda');
    assert.equal(postBody.email_id, 'contato@empresa.com');
    assert.equal(postBody.mobile_no, '5511988887777');
    assert.equal(postBody.source, 'Meta Ads');
    assert.equal(postBody.company_name, 'Empresa Teste Ltda');
    assert.deepEqual(postBody.notes, [
      {
        note: 'Quantidade: 100 unidades\nProduto: Lenços Personalizados\nFinalidade: Brindes Corporativos\nPrazo: 30 dias\nArte: Sim',
      },
    ]);
    assert.equal(postBody.custom_page_url, 'https://aspen.com/produto');
    assert.equal(postBody.custom_result_id, 'r-999');
    assert.equal(postBody.custom_utm_source, 'meta');
    assert.equal(postBody.custom_utm_medium, 'ads');

    // Verify meta_capi appears in response
    assert.ok(body.meta_capi !== undefined);
    assert.deepEqual(body.meta_capi, { sent: false, reason: 'missing_token' });
  });

  it('salva lead estruturado na fila quando enabled sem dry_run', async () => {
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';

    const quoteLeadWrites: Record<string, unknown>[] = [];
    const h = createHandler({
      erpGetList: async () => [],
      erpPost: async () => ({ name: 'CRM-LEAD-0001' }),
      erpPut: async () => ({}),
      upsertQuoteLead: async (input: Record<string, unknown>) => {
        quoteLeadWrites.push(input);
        return {
          id: 'quote_lead_1',
          nome: String(input.nome),
          email: String(input.email),
          telefone: String(input.telefone),
          pedidoTexto: 'Produto: lenço',
          source: 'typebot',
          status: 'new',
          erpLeadId: 'CRM-LEAD-0001',
          createdAt: '2026-06-29T12:00:00.000Z',
          updatedAt: '2026-06-29T12:00:00.000Z',
        };
      },
      sendMetaLeadEvent: async () => ({ skipped: true }),
    });

    const result = await h(
      buildEvent({
        body: {
          nome: 'Viviane Correa',
          email: 'viviane@example.com',
          telefone: '(11) 97808-6811',
          produto: 'lenço',
        },
      })
    );
    const body = JSON.parse(result.body);

    assert.equal(result.statusCode, 200);
    assert.equal(body.quote_lead.id, 'quote_lead_1');
    assert.equal(quoteLeadWrites.length, 1);
    assert.equal(quoteLeadWrites[0].erpLeadId, 'CRM-LEAD-0001');
    assert.equal(quoteLeadWrites[0].source, 'typebot');
  });

  it('não grava fila de orçamento em dry_run', async () => {
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';

    let writes = 0;
    const h = createHandler({
      erpGetList: async () => [],
      erpPost: async () => ({ name: 'CRM-LEAD-0001' }),
      erpPut: async () => ({}),
      upsertQuoteLead: async () => {
        writes += 1;
        throw new Error('dry_run should not write');
      },
      sendMetaLeadEvent: async () => ({ skipped: true }),
    });

    const result = await h(
      buildEvent({
        body: {
          dry_run: true,
          nome: 'Viviane Correa',
          email: 'viviane@example.com',
          telefone: '(11) 97808-6811',
        },
      })
    );
    const body = JSON.parse(result.body);

    assert.equal(result.statusCode, 200);
    assert.equal(body.quote_lead, null);
    assert.equal(writes, 0);
  });

  it('não falha o webhook se a fila de orçamento falhar', async () => {
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';

    const h = createHandler({
      erpGetList: async () => [],
      erpPost: async () => ({ name: 'CRM-LEAD-0001' }),
      erpPut: async () => ({}),
      upsertQuoteLead: async () => {
        throw new Error('KV indisponível');
      },
      sendMetaLeadEvent: async () => ({ skipped: true }),
    });

    const result = await h(
      buildEvent({
        body: {
          nome: 'Viviane Correa',
          email: 'viviane@example.com',
          telefone: '(11) 97808-6811',
        },
      })
    );
    const body = JSON.parse(result.body);

    assert.equal(result.statusCode, 200);
    assert.equal(body.lead_id, 'CRM-LEAD-0001');
    assert.equal(body.quote_lead, null);
    assert.equal(body.quote_lead_error, 'Lead salvo no ERP, mas não entrou na fila de orçamento.');
  });

  it('salva lead estruturado com attribution na fila de pré-orçamentos', async () => {
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';

    const quoteLeadWrites: Record<string, unknown>[] = [];
    const h = createHandler({
      erpGetList: async () => [],
      erpPost: async () => ({ name: 'CRM-LEAD-ATTR' }),
      erpPut: async () => ({}),
      upsertQuoteLead: async (input: Record<string, unknown>) => {
        quoteLeadWrites.push(input);
        return {
          id: 'quote_lead_attr',
          nome: String(input.nome),
          email: String(input.email),
          telefone: String(input.telefone),
          pedidoTexto: 'Produto: Bolsas',
          source: 'typebot',
          status: 'ready',
          erpLeadId: 'CRM-LEAD-ATTR',
          createdAt: '2026-07-01T12:00:00.000Z',
          updatedAt: '2026-07-01T12:00:00.000Z',
        };
      },
      sendMetaLeadEvent: async () => ({ skipped: true }),
    });

    const result = await h(
      buildEvent({
        body: {
          nome: 'Cliente Typebot',
          email: 'cliente@example.com',
          telefone: '(21) 99999-0000',
          empresa: 'Empresa Cliente',
          produto: 'Bolsas',
          quantidade: '120',
          finalidade: 'Evento',
          prazo: '20 dias',
          arte: 'Sim',
          page_url: 'https://aspenestamparia.com/orcamento?utm_source=meta',
          utm_source: 'meta',
          utm_medium: 'paid_social',
          utm_campaign: 'meta_lead_qualificado_b2b',
          gclid: 'gclid-typebot',
          fbclid: 'fbclid-typebot',
          source_cta: 'meta-orcamento-corporativo',
          result_id: 'typebot-session-1',
        },
      })
    );

    const body = JSON.parse(result.body);
    assert.equal(result.statusCode, 200);
    assert.equal(body.quote_lead.id, 'quote_lead_attr');
    assert.equal(quoteLeadWrites.length, 1);
    assert.deepEqual(quoteLeadWrites[0], {
      nome: 'Cliente Typebot',
      email: 'cliente@example.com',
      telefone: '5521999990000',
      origem: 'Website',
      canal: 'whatsapp',
      produto: 'Bolsas',
      mensagem_contexto: '',
      empresa: 'Empresa Cliente',
      quantidade: '120',
      finalidade: 'Evento',
      prazo: '20 dias',
      arte: 'Sim',
      result_id: 'typebot-session-1',
      page_url: 'https://aspenestamparia.com/orcamento?utm_source=meta',
      utm_source: 'meta',
      utm_campaign: 'meta_lead_qualificado_b2b',
      utm_medium: 'paid_social',
      utm_content: null,
      utm_term: null,
      campaign: null,
      gclid: 'gclid-typebot',
      gbraid: null,
      wbraid: null,
      fbclid: 'fbclid-typebot',
      source_cta: 'meta-orcamento-corporativo',
      source: 'typebot',
      sourceDetail: 'whatsapp',
      erpLeadId: 'CRM-LEAD-ATTR',
    });
  });
});
