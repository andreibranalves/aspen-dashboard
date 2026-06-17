import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractLeadCapturePayload,
  handler,
  inferProductFromContext,
  normalizeLeadPhone,
  parseBoolean,
} from '../../api/_functions/typebot-lead-capture.js';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

function makeEvent(body, headers = {}) {
  return {
    httpMethod: 'POST',
    body: JSON.stringify(body),
    headers,
  };
}

describe('typebot-lead-capture helpers', () => {
  it('normaliza telefone brasileiro para E.164 simplificado com 55', () => {
    assert.equal(normalizeLeadPhone('(11) 99999-9999'), '5511999999999');
    assert.equal(normalizeLeadPhone('5511999999999'), '5511999999999');
    assert.equal(normalizeLeadPhone('9999'), '');
  });

  it('detecta produto a partir da mensagem de contexto', () => {
    assert.equal(
      inferProductFromContext('Olá, gostaria de mais informações sobre as toalhas personalizadas.'),
      'toalhas'
    );
    assert.equal(
      inferProductFromContext('Olá, gostaria de mais informações sobre os lenços personalizados.'),
      'lenços'
    );
  });

  it('extrai payload tanto direto quanto aninhado', () => {
    const payload = extractLeadCapturePayload({
      fields: {
        nome: 'Maria Silva',
        telefone: '(11) 99999-9999',
        email: 'MARIA@EXEMPLO.COM',
      },
      mensagem_contexto: 'Olá, gostaria de mais informações sobre as cangas personalizadas.',
    });

    assert.deepEqual(payload, {
      nome: 'Maria Silva',
      email: 'maria@exemplo.com',
      telefone: '5511999999999',
      mensagemContexto: 'Olá, gostaria de mais informações sobre as cangas personalizadas.',
      origem: 'Website',
      canal: 'whatsapp',
      resultId: '',
      pageUrl: '',
      utmSource: '',
      utmCampaign: '',
      produto: 'cangas',
    });
  });

  it('interpreta strings booleanas do ambiente', () => {
    assert.equal(parseBoolean('true'), true);
    assert.equal(parseBoolean('1'), true);
    assert.equal(parseBoolean('false'), false);
  });
});

describe('typebot-lead-capture handler', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      TYPEBOT_LEAD_WEBHOOK_TOKEN: 'segredo-typebot',
      TYPEBOT_LEAD_CAPTURE_ENABLED: 'false',
      ERPNEXT_TOKEN: 'erp-token-teste',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
  });

  it('bloqueia requisição sem token', async () => {
    const response = await handler(makeEvent({ nome: 'Maria', telefone: '11999999999', email: 'maria@exemplo.com' }));
    assert.equal(response.statusCode, 401);
    assert.match(response.body, /Não autorizado/);
  });

  it('permite dry-run com feature flag desligada sem tocar no ERP', async () => {
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    };

    const response = await handler(makeEvent({
      nome: 'Maria Silva',
      telefone: '(11) 99999-9999',
      email: 'maria@exemplo.com',
      mensagem_contexto: 'Olá, gostaria de mais informações sobre as cangas personalizadas.',
      dry_run: true,
    }, {
      authorization: 'Bearer segredo-typebot',
    }));

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.enabled, false);
    assert.equal(body.dry_run, true);
    assert.equal(body.action, 'would_create');
    assert.equal(body.lead.produto, 'cangas');
    assert.equal(calls, 0);
  });

  it('impede escrita real enquanto a feature flag estiver desligada', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const response = await handler(makeEvent({
      nome: 'Maria Silva',
      telefone: '(11) 99999-9999',
      email: 'maria@exemplo.com',
    }, {
      authorization: 'Bearer segredo-typebot',
    }));

    assert.equal(response.statusCode, 503);
    assert.match(response.body, /ainda não está ativa/i);
  });

  it('cria lead quando a flag está ativa e não existe duplicata', async () => {
    process.env.TYPEBOT_LEAD_CAPTURE_ENABLED = 'true';

    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url, options });
      if ((options.method || 'GET') === 'POST') {
        return {
          ok: true,
          json: async () => ({ data: { name: 'LEAD-0001' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    };

    const response = await handler(makeEvent({
      nome: 'Maria Silva',
      telefone: '(11) 99999-9999',
      email: 'maria@exemplo.com',
      origem: 'site-whatsapp',
    }, {
      authorization: 'Bearer segredo-typebot',
    }));

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.action, 'create');
    assert.equal(body.lead_id, 'LEAD-0001');
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /\/api\/resource\/Lead$/);
  });
});
