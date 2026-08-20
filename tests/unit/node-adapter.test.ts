import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { afterEach } from 'node:test';
import { createNodeHandler } from '../../api/_http/node-adapter.js';

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
    assert.equal(res.headers.get('access-control-allow-methods'), 'GET, POST, PUT, DELETE, OPTIONS');
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
