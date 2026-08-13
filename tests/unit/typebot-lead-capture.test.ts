import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/_functions/typebot-lead-capture.js';
import { sendMetaLeadEvent } from '../../api/_functions/lib/meta-capi.js';

type HandlerResult = { statusCode: number; body: string };
type QuoteLeadWrite = {
  id: string;
  status: 'new' | 'incomplete' | 'ready' | 'reviewing' | 'converted' | 'discarded';
  nome: string;
  email: string;
  telefone: string;
  pedidoTexto: string;
  source: string;
  created: boolean;
  crmDealId: string | null;
};

type CaptureDeps = {
  upsertQuoteLead: (input: Record<string, unknown>) => Promise<QuoteLeadWrite>;
  sendMetaLeadEvent: typeof sendMetaLeadEvent;
};

const ORIGINAL_ENV = {
  TYPEBOT_LEAD_WEBHOOK_TOKEN: process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN,
  TYPEBOT_LEAD_CAPTURE_ENABLED: process.env.TYPEBOT_LEAD_CAPTURE_ENABLED,
};

function parseBody(result: HandlerResult) {
  return JSON.parse(result.body);
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
    queryStringParameters: {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
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
    externalId: null,
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

function captureDeps() {
  const writes: Record<string, unknown>[] = [];
  let sequence = 0;
  const deps: CaptureDeps = {
    async upsertQuoteLead(input) {
      writes.push(input);
      sequence += 1;
      return {
        id: 'local-lead-1',
        status: 'ready',
        nome: String(input.nome || ''),
        email: String(input.email || ''),
        telefone: String(input.telefone || ''),
        pedidoTexto: 'Produto: Canga',
        source: 'typebot',
        created: sequence === 1,
        crmDealId: 'local-deal-1',
      };
    },
    async sendMetaLeadEvent() {
      return { sent: false, reason: 'missing_token' };
    },
  };
  return { deps, writes };
}

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('typebot-lead-capture handler', () => {
  it('retorna erro em português para método diferente de POST', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    const { deps } = captureDeps();
    const result = await createHandler(deps)(buildEvent({ method: 'GET' }));

    assert.equal(result.statusCode, 405);
    assert.deepEqual(parseBody(result as HandlerResult), { error: 'Método não permitido.' });
  });

  it('retorna 401 sem bearer válido', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    const { deps } = captureDeps();
    const result = await createHandler(deps)({
      httpMethod: 'POST',
      headers: {},
      queryStringParameters: {},
      body: JSON.stringify({ nome: 'Teste' }),
    });

    assert.equal(result.statusCode, 401);
    assert.deepEqual(parseBody(result as HandlerResult), { error: 'Não autorizado.' });
  });

  it('retorna 400 para JSON inválido', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    const { deps } = captureDeps();
    const result = await createHandler(deps)({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer secret' },
      queryStringParameters: {},
      body: '{nome:',
    });

    assert.equal(result.statusCode, 400);
    assert.deepEqual(parseBody(result as HandlerResult), { error: 'JSON inválido.' });
  });

  it('mantém o contrato desativado sem efeitos locais', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'false';
    const { deps, writes } = captureDeps();

    const result = await createHandler(deps)(
      buildEvent({
        body: {
          nome: 'Teste Pi',
          email: 'TESTE@EXAMPLE.COM',
          telefone: '(11) 99999-9999',
          dry_run: true,
        },
      })
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result as HandlerResult), {
      success: true,
      enabled: false,
      dry_run: true,
      action: 'would_create',
      lead_id: null,
      existing_lead: null,
      activation_required: true,
      quote_lead: null,
      lead: baseExpectedLead({
        nome: 'Teste Pi',
        email: 'teste@example.com',
        telefone: '5511999999999',
      }),
    });
    assert.equal(writes.length, 0);
  });

  it('mantém dry_run sem gravar lead, deal ou evento de conversão', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    const { deps, writes } = captureDeps();
    let metaCalls = 0;
    deps.sendMetaLeadEvent = async () => {
      metaCalls += 1;
      return { sent: true };
    };

    const result = await createHandler(deps)(
      buildEvent({
        body: {
          nome: 'Ana',
          email: 'ana@example.com',
          telefone: '11999999999',
          quantidade: '100',
          dry_run: true,
        },
      })
    );
    const body = parseBody(result as HandlerResult);

    assert.equal(result.statusCode, 200);
    assert.equal(body.action, 'would_create');
    assert.equal(body.lead_id, null);
    assert.equal(body.existing_lead, null);
    assert.equal(body.activation_required, false);
    assert.equal(body.quote_lead, null);
    assert.equal(writes.length, 0);
    assert.equal(metaCalls, 0);
  });

  it('grava lead e deal locais antes de retornar sucesso', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    const { deps, writes } = captureDeps();

    const result = await createHandler(deps)(
      buildEvent({
        body: {
          nome: 'Ana',
          email: 'ANA@EXAMPLE.COM',
          telefone: '(11) 99999-9999',
          produto: 'Canga',
          quantidade: '100',
          result_id: 'typebot-1',
        },
      })
    );
    const body = parseBody(result as HandlerResult);

    assert.equal(result.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.enabled, true);
    assert.equal(body.dry_run, false);
    assert.equal(body.action, 'created');
    assert.equal(body.lead_id, 'local-lead-1');
    assert.equal(body.existing_lead, null);
    assert.equal(body.activation_required, false);
    assert.deepEqual(body.quote_lead, { id: 'local-lead-1', status: 'ready' });
    assert.deepEqual(writes[0], {
      nome: 'Ana',
      email: 'ana@example.com',
      telefone: '5511999999999',
      origem: 'Website',
      canal: 'whatsapp',
      produto: 'Canga',
      mensagem_contexto: '',
      empresa: '',
      quantidade: '100',
      finalidade: '',
      prazo: '',
      arte: '',
      result_id: 'typebot-1',
      externalId: 'typebot-1',
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
      source: 'typebot',
      sourceDetail: 'whatsapp',
    });
  });

  it('mapeia result_id para externalId sem contato', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    const { deps, writes } = captureDeps();

    const result = await createHandler(deps)(
      buildEvent({ body: { nome: 'Ana Result', quantidade: '100', result_id: 'result-42' } })
    );

    assert.equal(result.statusCode, 200);
    assert.equal(parseBody(result as HandlerResult).lead.externalId, 'result-42');
    assert.equal(writes[0]?.externalId, 'result-42');
  });

  it('retorna updated e existing_lead em entrega repetida', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    const { deps } = captureDeps();

    const first = await createHandler(deps)(
      buildEvent({ body: { nome: 'Ana', telefone: '11999999999', quantidade: '100' } })
    );
    const second = await createHandler(deps)(
      buildEvent({ body: { nome: 'Ana', telefone: '(11) 99999-9999', quantidade: '100' } })
    );

    assert.equal(parseBody(first as HandlerResult).action, 'created');
    assert.equal(parseBody(second as HandlerResult).action, 'updated');
    assert.equal(parseBody(second as HandlerResult).existing_lead, 'local-lead-1');
  });

  it('não descarta captura válida', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    const { deps, writes } = captureDeps();

    const result = await createHandler(deps)(
      buildEvent({ body: { nome: 'Ana', telefone: '11999999999', quantidade: '100' } })
    );

    assert.equal(result.statusCode, 200);
    assert.equal(parseBody(result as HandlerResult).activation_required, false);
    assert.equal(writes.length, 1);
  });

  it('preserva attribution normalizada no payload local e na resposta', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    const { deps } = captureDeps();

    const result = await createHandler(deps)(
      buildEvent({
        body: {
          nome: 'Cliente Attribution',
          email: 'attr@example.com',
          telefone: '11999999999',
          page_url: 'https://aspen.example/orcamento',
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: 'verao',
          gclid: 'gclid-1',
          source: 'topbar',
          source_cta: 'typebot-corporativo',
        },
      })
    );
    const body = parseBody(result as HandlerResult);

    assert.equal(body.lead.page_url, 'https://aspen.example/orcamento');
    assert.equal(body.lead.utm_source, 'google');
    assert.equal(body.lead.gclid, 'gclid-1');
    assert.equal(body.lead.source_cta, 'typebot-corporativo');
  });

  it('rejeita lead sem nome e quantidade abaixo do mínimo sem gravar', async () => {
    process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN = 'secret';
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';
    const { deps, writes } = captureDeps();

    const missingName = await createHandler(deps)(
      buildEvent({ body: { telefone: '11999999999' } })
    );
    assert.equal(missingName.statusCode, 400);
    assert.deepEqual(parseBody(missingName as HandlerResult), { error: 'Nome é obrigatório.' });

    const belowMinimum = await createHandler(deps)(
      buildEvent({
        body: {
          nome: 'Sem qualificação',
          telefone: '11999999999',
          quantidade: 'Menos de 30 unidades',
        },
      })
    );
    assert.equal(belowMinimum.statusCode, 400);
    assert.deepEqual(parseBody(belowMinimum as HandlerResult), {
      error: 'minimum_quantity_required',
    });
    assert.equal(writes.length, 0);
  });
});
