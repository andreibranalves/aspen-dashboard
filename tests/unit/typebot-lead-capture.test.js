import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';

import { handler } from '../../api/_functions/typebot-lead-capture.js';

const ORIGINAL_ENV = {
  TYPEBOT_LEAD_WEBHOOK_TOKEN: process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN,
  TYPEBOT_LEAD_CAPTURE_ENABLED: process.env.TYPEBOT_LEAD_CAPTURE_ENABLED,
};
const ORIGINAL_FETCH = globalThis.fetch;

function parseBody(result) {
  return JSON.parse(result.body);
}

function buildEvent({
  method = 'POST',
  token = 'secret',
  body = {},
  authHeader = 'authorization',
} = {}) {
  const headers = token
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

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
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
      lead: {
        nome: 'Teste Pi',
        email: 'teste@example.com',
        telefone: '5511999999999',
        origem: 'Website',
        canal: 'whatsapp',
        produto: '',
        mensagem_contexto: '',
        result_id: null,
        page_url: null,
        utm_source: null,
        utm_campaign: null,
      },
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
      lead: {
        nome: 'Ana',
        email: '',
        telefone: '5511988887777',
        origem: 'Website',
        canal: 'whatsapp',
        produto: '',
        mensagem_contexto: '',
        result_id: null,
        page_url: null,
        utm_source: null,
        utm_campaign: null,
      },
    });
  });

  it('simula atualização por email quando enabled + dry_run', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';

    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({
        data: [{ name: 'LEAD-0001', email_id: 'ana@example.com', mobile_no: '5511999999999' }],
      });
    };

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
      lead: {
        nome: 'Ana',
        email: 'ana@example.com',
        telefone: '5511999999999',
        origem: 'Website',
        canal: 'whatsapp',
        produto: '',
        mensagem_contexto: '',
        result_id: null,
        page_url: null,
        utm_source: null,
        utm_campaign: null,
      },
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

    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      const method = options.method || 'GET';
      if (method === 'GET') return jsonResponse({ data: [] });
      if (method === 'POST') {
        return jsonResponse({ data: { name: 'LEAD-NEW' } });
      }
      throw new Error(`Unexpected method ${method}`);
    };

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
      lead: {
        nome: 'Cliente Novo',
        email: 'novo@example.com',
        telefone: '5511988887777',
        origem: 'Website',
        canal: 'whatsapp',
        produto: '',
        mensagem_contexto: '',
        result_id: null,
        page_url: null,
        utm_source: null,
        utm_campaign: null,
      },
    });

    assert.equal(calls.length, 3);
    assert.equal(calls[2].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[2].options.body), {
      lead_name: 'Cliente Novo',
      email_id: 'novo@example.com',
      mobile_no: '5511988887777',
      source: 'Website',
    });
  });

  it('atualiza lead existente por telefone quando enabled', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';

    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      const method = options.method || 'GET';
      const parsedUrl = new URL(url);
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
    };

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
      lead: {
        nome: 'Cliente Existente',
        email: '',
        telefone: '5511988887777',
        origem: 'Website',
        canal: 'whatsapp',
        produto: 'lenço',
        mensagem_contexto: '',
        result_id: null,
        page_url: null,
        utm_source: null,
        utm_campaign: null,
      },
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
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      lead_name: 'Cliente Existente',
      mobile_no: '5511988887777',
      source: 'Website',
    });
  });

  it('retorna 400 no modo enabled sem nome', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';

    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return jsonResponse({ data: [] });
    };

    const result = await handler(buildEvent({ body: { telefone: '11999999999' } }));

    assert.equal(result.statusCode, 400);
    assert.deepEqual(parseBody(result), { error: 'Nome é obrigatório.' });
    assert.equal(called, false);
  });
});
