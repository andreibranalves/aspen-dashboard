import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';

import { handler as _handler } from '../../api/_functions/typebot-lead-capture.js';

type HandlerResult = { statusCode: number; body: string };
const handler = _handler as (event: unknown) => Promise<HandlerResult>;
type FetchCall = { url: string; options: RequestInit };

const ORIGINAL_ENV = {
  TYPEBOT_LEAD_WEBHOOK_TOKEN: process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN,
  TYPEBOT_LEAD_CAPTURE_ENABLED: process.env.TYPEBOT_LEAD_CAPTURE_ENABLED,
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
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
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

    assert.equal(result.statusCode, 200);
    assert.equal(parseBody(result).action, 'created');
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

    assert.equal(result.statusCode, 200);
    assert.equal(parseBody(result).action, 'updated');
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

    assert.equal(result.statusCode, 200);
    assert.equal(parseBody(result).action, 'updated');
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
});
