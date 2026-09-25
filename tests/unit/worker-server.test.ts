import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createWorkerServer } from '../../api/_worker/server.js';

async function withWorker(sha: string) {
  const server = createWorkerServer({ sha });
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

test('worker: /health answers with the deployed commit', async () => {
  const worker = await withWorker('0123abcd');
  try {
    const response = await fetch(`${worker.baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', sha: '0123abcd' });
  } finally {
    await worker.close();
  }
});

test('worker: /health stays up without a reachable database', async () => {
  const saved = process.env.DATABASE_URL;
  // Porta fechada: se o healthcheck tocasse o banco, a resposta demoraria ou falharia.
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:9/none';
  const worker = await withWorker('sha');
  try {
    const response = await fetch(`${worker.baseUrl}/health`);
    assert.equal(response.status, 200);
  } finally {
    await worker.close();
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test('worker: other paths and methods are refused', async () => {
  const worker = await withWorker('sha');
  try {
    const unknown = await fetch(`${worker.baseUrl}/api/quotations`);
    assert.equal(unknown.status, 404);
    const post = await fetch(`${worker.baseUrl}/health`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');
  } finally {
    await worker.close();
  }
});
