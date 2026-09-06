import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import test, { afterEach } from 'node:test';
import { createNodeHandler } from '../../api/_http/node-adapter.js';
import { routes } from '../../api/_app/routes.js';
import { createSiteQuoteLeadsHandler } from '../../api/_modules/site-quote-leads.js';

async function withServer() {
  const server = createServer(createNodeHandler());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
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

test('node adapter: OPTIONS responde 204 com cabeçalhos CORS', async () => {
  const { baseUrl, close } = await withServer();
  try {
    const res = await fetch(`${baseUrl}/api/anything`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(
      res.headers.get('access-control-allow-methods'),
      'GET, POST, PUT, DELETE, OPTIONS'
    );
  } finally {
    await close();
  }
});

test('node adapter: rota inexistente responde 404 pelo pipeline', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: 'true' });
  const { baseUrl, close } = await withServer();
  try {
    const res = await fetch(`${baseUrl}/api/rota-inexistente`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Endpoint não encontrado.' });
  } finally {
    await close();
  }
});

test('node adapter: limita bytes raw em JSON inflado enviado em chunks sem Content-Length', async () => {
  const token = 'n'.repeat(32);
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
  const rawBody = `${' '.repeat(16_384)}${JSON.stringify(validPayload)}`;
  assert.ok(Buffer.byteLength(rawBody, 'utf8') > 16_384);
  assert.ok(Buffer.byteLength(JSON.stringify(validPayload), 'utf8') < 16_384);
  const { baseUrl, close } = await withServer();
  try {
    for (const routePath of [
      '/api/site-quote-leads',
      '/api/site-quote-leads/',
      '/api/site-quote-leads/nested',
      '/api/unrelated?path=site-quote-leads',
    ]) {
      const target = new URL(routePath, baseUrl);
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(
          {
            hostname: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode || 0, body }));
          }
        );
        req.on('error', reject);
        const rawBytes = Buffer.from(rawBody, 'utf8');
        for (let offset = 0; offset < rawBytes.length; offset += 257) {
          req.write(rawBytes.subarray(offset, offset + 257));
        }
        req.end();
      });
      assert.equal(response.status, 413, routePath);
      assert.deepEqual(JSON.parse(response.body), {
        error: 'Corpo da requisição excede o limite permitido.',
      });
    }
    assert.equal(writes, 0);
  } finally {
    routes['site-quote-leads'] = original;
    await close();
  }
});

test('node adapter: query.path não amplia a política raw para rota não relacionada', async () => {
  withEnv({
    NODE_ENV: 'test',
    APP_AUTH_BYPASS: 'false',
    APP_PASSWORD_HASH: '',
    APP_SESSION_SECRET: '',
  });
  const rawBody = JSON.stringify({ padding: 'á'.repeat(9_000) });
  assert.ok(Buffer.byteLength(rawBody, 'utf8') > 16_384);
  const { baseUrl, close } = await withServer();
  try {
    const target = new URL('/api/site-quote-leads?path=unrelated', baseUrl);
    const response = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode || 0));
        }
      );
      req.on('error', reject);
      const bytes = Buffer.from(rawBody, 'utf8');
      for (let offset = 0; offset < bytes.length; offset += 193) {
        req.write(bytes.subarray(offset, offset + 193));
      }
      req.end();
    });
    assert.equal(response, 401);
  } finally {
    await close();
  }
});
