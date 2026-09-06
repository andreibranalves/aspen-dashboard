import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import type { VercelResponseLike } from '../../api/_http/types.js';
import { createHttpError } from '../../api/_shared/http-error.js';
import { createSessionToken } from '../../api/_shared/session.js';
import { handleApiRequest, normalizeHandlerError } from '../../api/_app/handle-request.js';
import { routes } from '../../api/_app/routes.js';
import { createSiteQuoteLeadsHandler } from '../../api/_modules/site-quote-leads.js';

function fakeResponse() {
  let statusCode = 200;
  const bodies: unknown[] = [];
  const headers: Record<string, string | number | string[]> = {};
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      bodies.push(data);
    },
    send(data: unknown) {
      bodies.push(data);
    },
    setHeader(key: string, value: string | number | string[]) {
      headers[key] = value;
    },
  } satisfies VercelResponseLike;
  return { res, lastStatus: () => statusCode, lastBody: () => bodies[bodies.length - 1], headers };
}

const SAVED_ENV: Record<string, string | undefined> = {};
afterEach(() => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(SAVED_ENV)) delete SAVED_ENV[key];
});

function withEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in SAVED_ENV)) SAVED_ENV[key] = process.env[key];
    process.env[key] = value;
  }
}

test('normalizeHandlerError: public-quotation vira 503 com mensagem fixa', () => {
  const result = normalizeHandlerError('public-quotation', new Error('detalhe interno'));
  assert.deepEqual(result, {
    statusCode: 503,
    message: 'Não foi possível consultar o orçamento. Tente novamente.',
  });
});

test('normalizeHandlerError: HttpError preserva statusCode e mensagem pública', () => {
  const result = normalizeHandlerError('quotations', createHttpError(422, 'Dados inválidos.'));
  assert.deepEqual(result, { statusCode: 422, message: 'Dados inválidos.' });
});

test('normalizeHandlerError: statusCode 503 sem marcador não vaza mensagem interna', () => {
  const err = Object.assign(new Error('WhatsApp lead worker failed.'), { statusCode: 503 });
  const result = normalizeHandlerError('whatsapp-leads', err);
  assert.deepEqual(result, { statusCode: 503, message: 'Erro interno. Tente novamente.' });
});

test('normalizeHandlerError: expose=false cai na mensagem genérica', () => {
  const err = Object.assign(new Error('detalhe interno do storage'), {
    statusCode: 503,
    expose: false,
  });
  const result = normalizeHandlerError('quotations', err);
  assert.deepEqual(result, { statusCode: 503, message: 'Erro interno. Tente novamente.' });
});

test('normalizeHandlerError: expose=true preserva mensagem pública', () => {
  const err = Object.assign(new Error('Produto não encontrado.'), {
    statusCode: 404,
    expose: true,
  });
  const result = normalizeHandlerError('products', err);
  assert.deepEqual(result, { statusCode: 404, message: 'Produto não encontrado.' });
});

test('normalizeHandlerError: erro genérico vira 500 sem vazar detalhes', () => {
  const result = normalizeHandlerError('quotations', new Error('secret SQL detail'));
  assert.deepEqual(result, { statusCode: 500, message: 'Erro interno. Tente novamente.' });
});

test('handleApiRequest: sem autenticação responde 401', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: '', APP_PASSWORD_HASH: '', APP_SESSION_SECRET: '' });
  const req = {
    method: 'GET',
    url: '/api/products',
    headers: {},
  } as unknown as import('node:http').IncomingMessage;
  const { res, lastStatus, lastBody } = fakeResponse();
  await handleApiRequest(req, res);
  assert.equal(lastStatus(), 401);
  assert.deepEqual(lastBody(), { error: 'Não autorizado. Faça login em /api/login.' });
});

test('handleApiRequest: contexto WhatsApp mantém CORS na resposta 401 da sessão', async () => {
  withEnv({
    NODE_ENV: 'test',
    APP_AUTH_BYPASS: '',
    APP_PASSWORD_HASH: '',
    APP_SESSION_SECRET: '',
    WHATSAPP_CONTEXT_EXTENSION_ORIGIN: 'chrome-extension://test',
  });
  const req = {
    method: 'GET',
    url: '/api/whatsapp-context?phone=5511999999999',
    headers: { origin: 'chrome-extension://test' },
  } as unknown as import('node:http').IncomingMessage;
  const { res, lastStatus, headers } = fakeResponse();
  await handleApiRequest(req, res);
  assert.equal(lastStatus(), 401);
  assert.equal(headers['Access-Control-Allow-Origin'], 'chrome-extension://test');
  assert.equal(headers['Access-Control-Allow-Credentials'], 'true');
});

test('handleApiRequest: rota inexistente responde 404 via pipeline completo', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: 'true' });
  const req = {
    method: 'GET',
    url: '/api/rota-inexistente',
    headers: {},
  } as unknown as import('node:http').IncomingMessage;
  const { res, lastStatus, lastBody } = fakeResponse();
  await handleApiRequest(req, res);
  assert.equal(lastStatus(), 404);
  assert.deepEqual(lastBody(), { error: 'Endpoint não encontrado.' });
});

test('handleApiRequest: endpoints aposentados respondem 404 com bypass autenticado', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: 'true' });
  for (const routeName of ['quote-leads', 'typebot-lead-capture']) {
    const req = {
      method: 'GET',
      url: `/api/${routeName}`,
      headers: {},
    } as unknown as import('node:http').IncomingMessage;
    const { res, lastStatus, lastBody } = fakeResponse();
    await handleApiRequest(req, res);
    assert.equal(lastStatus(), 404, routeName);
    assert.deepEqual(lastBody(), { error: 'Endpoint não encontrado.' });
  }
});

test('handleApiRequest: rate limit nega 429 na 11a chamada do login', async () => {
  withEnv({ NODE_ENV: 'test' });
  const ip = `198.51.100.${Date.now() % 250}`;
  const { res, lastStatus, lastBody } = fakeResponse();
  for (let i = 0; i < 11; i++) {
    const req = {
      method: 'POST',
      url: '/api/login',
      headers: { 'x-real-ip': ip },
    } as unknown as import('node:http').IncomingMessage;
    await handleApiRequest(req, res);
  }
  assert.equal(lastStatus(), 429);
  assert.deepEqual(lastBody(), { error: 'Muitas requisições. Aguarde um minuto.' });
});

test('handleApiRequest: dispatch com sucesso passa pelo wrapFunctionHandler', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: 'true' });
  const routeName = 'task3-success-dispatch';
  routes[routeName] = async () => ({ statusCode: 201, body: JSON.stringify({ ok: true }) });
  try {
    const req = {
      method: 'GET',
      url: `/api/${routeName}`,
      headers: {},
    } as unknown as import('node:http').IncomingMessage;
    const { res, lastStatus, lastBody } = fakeResponse();
    await handleApiRequest(req, res);
    assert.equal(lastStatus(), 201);
    assert.equal(lastBody(), JSON.stringify({ ok: true }));
  } finally {
    delete routes[routeName];
  }
});

test('handleApiRequest: erro do handler vira 500 sem vazar detalhes', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: 'true' });
  const routeName = 'task3-throwing-handler';
  routes[routeName] = async () => {
    throw new Error('secret SQL detail');
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const req = {
      method: 'GET',
      url: `/api/${routeName}`,
      headers: {},
    } as unknown as import('node:http').IncomingMessage;
    const { res, lastStatus, lastBody } = fakeResponse();
    await handleApiRequest(req, res);
    assert.equal(lastStatus(), 500);
    assert.deepEqual(lastBody(), { error: 'Erro interno. Tente novamente.' });
    assert.ok(!JSON.stringify(lastBody()).includes('secret SQL detail'));
  } finally {
    console.error = originalConsoleError;
    delete routes[routeName];
  }
});

test('handleApiRequest: ingestão do site exige bearer próprio e recebe rate limit pelo pipeline completo', async () => {
  const token = 'i'.repeat(32);
  const validBody = {
    externalId: 'siteQuote.018f47a8-7b6c-7d3e-8f90-123456789abc',
    payloadFingerprint: 'a'.repeat(64),
    originalCreatedAt: '2026-09-05T12:00:00.000Z',
    nome: 'Cliente Sintético',
    email: 'synthetic@example.invalid',
    whatsapp: '21999990000',
    produto: 'Cangas',
    quantidade: '100',
    consent: { given: true, source: 'site_quote_form' },
  };
  let writes = 0;
  const original = routes['site-quote-leads'];
  routes['site-quote-leads'] = createSiteQuoteLeadsHandler({
    environment: { QUOTE_LEADS_INGEST_TOKEN: token },
    ingest: async () => {
      writes += 1;
      return { result: 'created' };
    },
    correlationId: () => 'correlation-fixture',
  });
  try {
    const unauthorized = {
      method: 'POST',
      url: '/api/site-quote-leads',
      headers: { cookie: 'aspen_token=session' },
      body: validBody,
    } as unknown as import('node:http').IncomingMessage;
    const unauthorizedResponse = fakeResponse();
    await handleApiRequest(unauthorized, unauthorizedResponse.res);
    assert.equal(unauthorizedResponse.lastStatus(), 401);

    const ip = `192.0.2.${Date.now() % 250}`;
    let last = fakeResponse();
    for (let index = 0; index < 31; index += 1) {
      last = fakeResponse();
      const req = {
        method: 'POST',
        url: '/api/site-quote-leads',
        headers: { authorization: `Bearer ${token}`, 'x-real-ip': ip },
        body: validBody,
      } as unknown as import('node:http').IncomingMessage;
      await handleApiRequest(req, last.res);
    }
    assert.equal(last.lastStatus(), 429);
    assert.equal(writes, 30);
  } finally {
    routes['site-quote-leads'] = original;
  }
});

test('handleApiRequest: rotação exige token atual forte e sessão não autentica a máquina', async () => {
  const currentToken = 'c'.repeat(32);
  const previousToken = 'p'.repeat(32);
  const sessionToken = createSessionToken('s'.repeat(32));
  assert.ok(sessionToken);
  const validBody = {
    externalId: 'siteQuote.018f47a8-7b6c-7d3e-8f90-123456789abc',
    payloadFingerprint: 'a'.repeat(64),
    originalCreatedAt: '2026-09-05T12:00:00.000Z',
    nome: 'Cliente Sintético',
    email: 'synthetic@example.invalid',
    whatsapp: '21999990000',
    produto: 'Cangas',
    quantidade: '100',
    consent: { given: true, source: 'site_quote_form' },
  };
  let writes = 0;
  const original = routes['site-quote-leads'];
  const invoke = async (
    environment: { QUOTE_LEADS_INGEST_TOKEN?: string; QUOTE_LEADS_INGEST_PREVIOUS_TOKEN?: string },
    authorization?: string
  ) => {
    routes['site-quote-leads'] = createSiteQuoteLeadsHandler({
      environment,
      ingest: async () => {
        writes += 1;
        return { result: 'created' };
      },
      correlationId: () => 'correlation-fixture',
    });
    const response = fakeResponse();
    await handleApiRequest(
      {
        method: 'POST',
        url: '/api/site-quote-leads',
        headers: {
          ...(authorization ? { authorization } : {}),
          cookie: `aspen_token=${sessionToken}`,
          'x-real-ip': `203.0.113.${writes + 1}`,
        },
        body: validBody,
      } as unknown as import('node:http').IncomingMessage,
      response.res
    );
    return response.lastStatus();
  };

  try {
    assert.equal(
      await invoke({ QUOTE_LEADS_INGEST_PREVIOUS_TOKEN: previousToken }, `Bearer ${previousToken}`),
      401
    );
    assert.equal(
      await invoke(
        {
          QUOTE_LEADS_INGEST_TOKEN: 'weak-current',
          QUOTE_LEADS_INGEST_PREVIOUS_TOKEN: previousToken,
        },
        `Bearer ${previousToken}`
      ),
      401
    );
    assert.equal(
      await invoke(
        {
          QUOTE_LEADS_INGEST_TOKEN: currentToken,
          QUOTE_LEADS_INGEST_PREVIOUS_TOKEN: previousToken,
        },
        `Bearer ${previousToken}`
      ),
      201
    );
    assert.equal(
      await invoke({ QUOTE_LEADS_INGEST_TOKEN: currentToken }, `Bearer ${previousToken}`),
      401
    );
    assert.equal(await invoke({ QUOTE_LEADS_INGEST_TOKEN: currentToken }), 401);
    assert.equal(
      await invoke({ QUOTE_LEADS_INGEST_TOKEN: currentToken }, `Bearer ${currentToken}`),
      201
    );
    assert.equal(writes, 2);
  } finally {
    routes['site-quote-leads'] = original;
  }
});
