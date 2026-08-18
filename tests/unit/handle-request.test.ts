import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import type { VercelResponseLike } from '../../api/_lib/types.js';
import { createHttpError } from '../../api/_lib/http-error.js';
import { handleApiRequest, normalizeHandlerError } from '../../api/_app/handle-request.js';
import { routes } from '../../api/_app/routes.js';

function fakeResponse() {
  let statusCode = 200;
  const bodies: unknown[] = [];
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
    setHeader(_key: string, _value: string | number | string[]) {},
  } satisfies VercelResponseLike;
  return { res, lastStatus: () => statusCode, lastBody: () => bodies[bodies.length - 1] };
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

test('normalizeHandlerError: erro genérico vira 500 sem vazar detalhes', () => {
  const result = normalizeHandlerError('quotations', new Error('secret SQL detail'));
  assert.deepEqual(result, { statusCode: 500, message: 'Erro interno. Tente novamente.' });
});

test('handleApiRequest: sem autenticação responde 401', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: '', APP_PASSWORD_HASH: '', APP_SESSION_SECRET: '' });
  const req = { method: 'GET', url: '/api/products', headers: {} } as unknown as import('node:http').IncomingMessage;
  const { res, lastStatus, lastBody } = fakeResponse();
  await handleApiRequest(req, res);
  assert.equal(lastStatus(), 401);
  assert.deepEqual(lastBody(), { error: 'Não autorizado. Faça login em /api/login.' });
});

test('handleApiRequest: rota inexistente responde 404 via pipeline completo', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: 'true' });
  const req = { method: 'GET', url: '/api/rota-inexistente', headers: {} } as unknown as import('node:http').IncomingMessage;
  const { res, lastStatus, lastBody } = fakeResponse();
  await handleApiRequest(req, res);
  assert.equal(lastStatus(), 404);
  assert.deepEqual(lastBody(), { error: 'Endpoint não encontrado.' });
});

test('handleApiRequest: rate limit nega 429 na 11a chamada do login', async () => {
  withEnv({ NODE_ENV: 'test' });
  const ip = `198.51.100.${Date.now() % 250}`;
  const { res, lastStatus, lastBody } = fakeResponse();
  for (let i = 0; i < 11; i++) {
    const req = { method: 'POST', url: '/api/login', headers: { 'x-real-ip': ip } } as unknown as import('node:http').IncomingMessage;
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
    const req = { method: 'GET', url: `/api/${routeName}`, headers: {} } as unknown as import('node:http').IncomingMessage;
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
    const req = { method: 'GET', url: `/api/${routeName}`, headers: {} } as unknown as import('node:http').IncomingMessage;
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
