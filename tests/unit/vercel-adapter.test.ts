import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import vercelHandler from '../../api/[...path].js';
import type { VercelRequestLike, VercelResponseLike } from '../../api/_http/types.js';
import { routes } from '../../api/_app/routes.js';
import { createSiteQuoteLeadsHandler } from '../../api/_modules/site-quote-leads.js';

function fakeResponse() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      body = value;
    },
    send(value: unknown) {
      body = value;
    },
    setHeader() {},
  } satisfies VercelResponseLike;
  return { response, status: () => statusCode, body: () => body };
}

test('Vercel entrypoint limits restored raw stream bytes before its lazy parsed-body helper', async () => {
  const token = 'v'.repeat(32);
  let writes = 0;
  const original = routes['site-quote-leads'];
  routes['site-quote-leads'] = createSiteQuoteLeadsHandler({
    environment: { QUOTE_LEADS_INGEST_TOKEN: token },
    ingest: async () => {
      writes += 1;
      return { result: 'created' };
    },
  });
  const validPayload = {
    externalId: 'siteQuote.018f47a8-7b6c-7d3e-8f90-123456789abc',
    payloadFingerprint: 'a'.repeat(64),
    originalCreatedAt: '2026-09-05T12:00:00.000Z',
    nome: 'Cliente Sintético',
    email: 'synthetic@example.invalid',
    whatsapp: '21999990000',
    produto: 'Cangas',
    quantidade: '100',
    mensagem: 'ação multibyte',
    consent: { given: true, source: 'site_quote_form' },
  };
  const rawBody = `${'\n\t '.repeat(5_500)}${JSON.stringify(validPayload)}`;
  assert.ok(Buffer.byteLength(rawBody, 'utf8') > 16_384);
  assert.ok(Buffer.byteLength(JSON.stringify(validPayload), 'utf8') < 16_384);

  const bytes = Buffer.from(rawBody, 'utf8');
  try {
    for (const route of [
      { url: '/api/site-quote-leads', query: { path: 'site-quote-leads' } },
      { url: '/api/site-quote-leads/', query: { path: 'site-quote-leads' } },
      { url: '/api/unrelated', query: { path: 'site-quote-leads' } },
      { url: '/api/unrelated', query: { path: ['site-quote-leads', 'nested'] } },
      { url: '/api/site-quote-leads/nested', query: {} },
    ] satisfies Array<Pick<VercelRequestLike, 'url' | 'query'>>) {
      const stream = new PassThrough();
      const request = stream as PassThrough & VercelRequestLike;
      request.method = 'POST';
      request.url = route.url;
      request.query = route.query;
      request.headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-real-ip': '198.51.100.202',
      };
      Object.defineProperty(request, 'body', {
        configurable: true,
        enumerable: true,
        get: () => JSON.parse(rawBody),
        set(value) {
          Object.defineProperty(request, 'body', {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
          });
        },
      });
      for (let offset = 0; offset < bytes.length; offset += 131) {
        stream.write(bytes.subarray(offset, offset + 131));
      }
      stream.end();

      const result = fakeResponse();
      await vercelHandler(request, result.response);
      assert.equal(result.status(), 413, JSON.stringify(route));
      assert.deepEqual(result.body(), {
        error: 'Corpo da requisição excede o limite permitido.',
      });
    }
    assert.equal(writes, 0);
  } finally {
    routes['site-quote-leads'] = original;
  }
});

test('Vercel entrypoint does not apply the site lead policy when canonical routing selects another route', async () => {
  const savedEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    APP_AUTH_BYPASS: process.env.APP_AUTH_BYPASS,
    APP_PASSWORD_HASH: process.env.APP_PASSWORD_HASH,
    APP_SESSION_SECRET: process.env.APP_SESSION_SECRET,
  };
  process.env.NODE_ENV = 'test';
  process.env.APP_AUTH_BYPASS = 'false';
  delete process.env.APP_PASSWORD_HASH;
  delete process.env.APP_SESSION_SECRET;

  const rawBody = JSON.stringify({ padding: 'á'.repeat(9_000) });
  assert.ok(Buffer.byteLength(rawBody, 'utf8') > 16_384);
  const stream = new PassThrough();
  const request = stream as PassThrough & VercelRequestLike;
  request.method = 'POST';
  request.url = '/api/site-quote-leads';
  request.query = { path: 'unrelated' };
  request.headers = { 'content-type': 'application/json' };
  request.body = JSON.parse(rawBody);
  stream.end(rawBody);
  const result = fakeResponse();
  try {
    await vercelHandler(request, result.response);
    assert.equal(result.status(), 401);
  } finally {
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
